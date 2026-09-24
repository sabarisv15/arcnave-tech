import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { chats, goalEvents, goals, messages } from '../db/schema.js';
import type {
  GenerationRequest,
  Provider,
  ProviderEvent,
  ProviderUsage,
} from '../providers/types.js';
import type { ModelEntry } from '../providers/registry.js';
import { ModelRegistry } from '../providers/registry.js';
import { createTestApp, signUp, type TestContext } from '../test/harness.js';
import { AgentLoop } from './agentLoop.js';
import { LexicalRetriever } from './retrieval.js';
import { SkillService } from './skills.js';
import { buildStorage } from './storage.js';
import { UsageService } from './usage.js';
import type { GenerateInput } from './generation.js';

const dummyEntry: ModelEntry = {
  alias: 'gemini-2.5-flash',
  description: 'Fast and versatile model',
  provider: 'google',
  tier: 'balanced',
  providerModelId: 'gemini-2.5-flash',
  location: 'us-central1',
  supportsVision: true,
  supportsGrounding: true,
  contextWindow: 128000,
};

class ScriptedProvider implements Provider {
  readonly name = 'google';
  private roundIndex = 0;

  constructor(private readonly rounds: ProviderEvent[][]) {}

  async probe(_modelId: string, _signal: AbortSignal): Promise<void> {}
  supportsGrounding() {
    return true;
  }
  supportsCodeExecution() {
    return true;
  }
  async describeMedia() {
    return '';
  }

  async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    const events = this.rounds[this.roundIndex] ?? [
      { type: 'delta', text: 'Final answer' },
      {
        type: 'completed',
        usage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
        finishReason: 'stop',
      },
    ];
    this.roundIndex++;

    for (const ev of events) {
      if (request.signal.aborted) break;
      if (ev.type === 'tool_use' && request.toolExecutor) {
        yield ev;
        const result = await request.toolExecutor.execute(
          { id: ev.toolCallId, name: ev.name, input: (ev.input as Record<string, unknown>) ?? {} },
          request.signal,
        );
        yield { type: 'tool_result', toolCallId: ev.toolCallId, name: ev.name, result };
      } else {
        yield ev;
      }
    }
  }
}

let ctx: TestContext;
let userId: string;
let cookie: string;

beforeAll(async () => {
  ctx = await createTestApp();
  const user = await signUp(ctx);
  userId = user.id;
  cookie = user.cookie;
});

afterAll(async () => {
  await ctx?.close();
});

async function createChatAndMessage(): Promise<{ chatId: string; messageId: string }> {
  const chatRes = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers: { cookie },
    payload: { title: `AgentLoop Test Chat ${Date.now()}-${Math.random()}` },
  });
  const chatId = (chatRes.json() as { id: string }).id;

  const [msg] = await ctx.db
    .insert(messages)
    .values({
      chatId,
      userId,
      role: 'assistant',
      text: '',
      mode: 'chat',
      seq: 1,
    })
    .returning();

  return { chatId, messageId: msg!.id };
}

describe('AgentLoop Service', () => {
  it('creates active goal, executes multi-step tool calls, and updates token budget', async () => {
    const { chatId, messageId } = await createChatAndMessage();

    // Round 1: calls get_goal, Round 2: yields final text
    const scripted = new ScriptedProvider([
      [
        { type: 'tool_use', toolCallId: 'call-1', name: 'get_goal', input: {} },
        {
          type: 'completed',
          usage: { inputTokens: 100, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'tool_use',
        },
      ],
      [
        { type: 'delta', text: 'I reviewed the goal and completed the work.' },
        {
          type: 'completed',
          usage: { inputTokens: 80, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'stop',
        },
      ],
    ]);

    const registry = new ModelRegistry(ctx.cfg, { google: scripted });
    const usage = new UsageService(ctx.db, ctx.cfg);
    const retriever = new LexicalRetriever();
    const storage = buildStorage(ctx.cfg);

    const agentLoop = new AgentLoop(ctx.db, ctx.cfg, registry, usage, retriever, storage);

    const input: GenerateInput = {
      userId,
      requestId: 'req-1',
      chatId,
      messageId,
      prompt: 'Summarize quarterly research findings',
      mode: 'chat',
      modelAlias: 'gemini-2.5-flash',
      projectId: null,
      hasAttachments: false,
      attachments: [],
      codeExecution: false,
      signal: new AbortController().signal,
    };

    const events = [];
    for await (const event of agentLoop.stream(input, {
      entry: dummyEntry,
      provider: scripted,
      maxOutputTokens: 2048,
      prefs: { instructions: '', maxOutputTokens: 2048, dailyTokenBudget: null, monthlyTokenBudget: null, warnThresholdPct: 80, routingPreference: 'balanced', timezone: 'UTC' },
      project: null,
      history: [],
      systemInstruction: 'You are an autonomous agent.',
      startedAt: new Date(),
      releaseReservation: async () => {},
      grounded: false,
      codeExecution: false,
    })) {
      events.push(event);
    }

    // Verify events
    const toolUseEv = events.find((e) => e.type === 'tool_use');
    const toolResEv = events.find((e) => e.type === 'tool_result');
    const doneEv = events.find((e) => e.type === 'done');

    expect(toolUseEv).toBeDefined();
    expect(toolResEv).toBeDefined();
    expect(doneEv).toBeDefined();

    // Verify DB goal creation and spentTokens update
    const [goal] = await ctx.db
      .select()
      .from(goals)
      .where(and(eq(goals.chatId, chatId), eq(goals.status, 'active')));

    expect(goal).toBeDefined();
    expect(goal?.description).toBe('Summarize quarterly research findings');
    expect(goal?.spentTokens).toBeGreaterThan(0);

    // Verify budget_update event recorded in goal_events
    const goalEvs = await ctx.db
      .select()
      .from(goalEvents)
      .where(eq(goalEvents.goalId, goal!.id));

    expect(goalEvs.some((e) => e.type === 'budget_update')).toBe(true);
  });

  it('goal supersession marks old goal abandoned and creates new active goal', async () => {
    const { chatId, messageId } = await createChatAndMessage();

    const registry = new ModelRegistry(ctx.cfg, {});
    const usage = new UsageService(ctx.db, ctx.cfg);
    const retriever = new LexicalRetriever();
    const storage = buildStorage(ctx.cfg);
    const agentLoop = new AgentLoop(ctx.db, ctx.cfg, registry, usage, retriever, storage);

    // Initial goal
    const goal1 = await agentLoop.resolveGoal(chatId, 'First research topic', messageId);
    expect(goal1.status).toBe('active');

    // Reuse existing goal
    const goal1Reused = await agentLoop.resolveGoal(chatId, 'Continue topic', messageId);
    expect(goal1Reused.id).toBe(goal1.id);

    // Supersede goal
    const goal2 = await agentLoop.resolveGoal(chatId, 'Second distinct research topic', messageId, true);
    expect(goal2.id).not.toBe(goal1.id);
    expect(goal2.status).toBe('active');

    const [oldGoal] = await ctx.db.select().from(goals).where(eq(goals.id, goal1.id));
    expect(oldGoal?.status).toBe('abandoned');
  });

  it('enforces G2 rule blocking repeated failed tool and allows recovery via alternate tool', async () => {
    const { chatId, messageId } = await createChatAndMessage();

    const [goal] = await ctx.db
      .insert(goals)
      .values({
        chatId,
        description: 'G2 enforcement test',
        status: 'active',
        consecutiveFailureCount: 2,
        lastFailedTool: 'run_python',
      })
      .returning();

    // Provider attempts to call run_python (which is G2 blocked), then falls back to get_goal
    const scripted = new ScriptedProvider([
      [
        { type: 'tool_use', toolCallId: 'call-g2', name: 'run_python', input: { code: '1/0' } },
        {
          type: 'completed',
          usage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'tool_use',
        },
      ],
      [
        { type: 'tool_use', toolCallId: 'call-rec', name: 'get_goal', input: {} },
        {
          type: 'completed',
          usage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'tool_use',
        },
      ],
      [
        { type: 'delta', text: 'Recovered using goal info' },
        {
          type: 'completed',
          usage: { inputTokens: 40, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'stop',
        },
      ],
    ]);

    const registry = new ModelRegistry(ctx.cfg, { google: scripted });
    const usage = new UsageService(ctx.db, ctx.cfg);
    const retriever = new LexicalRetriever();
    const storage = buildStorage(ctx.cfg);
    const agentLoop = new AgentLoop(ctx.db, ctx.cfg, registry, usage, retriever, storage);

    const input: GenerateInput = {
      userId,
      requestId: 'req-g2',
      chatId,
      messageId,
      prompt: 'Test G2 recovery',
      mode: 'chat',
      modelAlias: 'gemini-2.5-flash',
      projectId: null,
      hasAttachments: false,
      attachments: [],
      codeExecution: false,
      signal: new AbortController().signal,
    };

    const events = [];
    for await (const event of agentLoop.stream(input, {
      entry: dummyEntry,
      provider: scripted,
      maxOutputTokens: 2048,
      prefs: { instructions: '', maxOutputTokens: 2048, dailyTokenBudget: null, monthlyTokenBudget: null, warnThresholdPct: 80, routingPreference: 'balanced', timezone: 'UTC' },
      project: null,
      history: [],
      systemInstruction: 'You are an autonomous agent.',
      startedAt: new Date(),
      releaseReservation: async () => {},
      grounded: false,
      codeExecution: false,
    })) {
      events.push(event);
    }

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.length).toBeGreaterThanOrEqual(1);
    const g2Result = toolResults.find((r) => r.type === 'tool_result' && r.name === 'run_python');
    expect(g2Result).toBeDefined();
    if (g2Result && g2Result.type === 'tool_result') {
      expect(g2Result.ok).toBe(false);
      expect(g2Result.preview).toContain('G2 Rule');
    }
  });

  it('stops cleanly when AbortSignal fires without auto-marking complete', async () => {
    const { chatId, messageId } = await createChatAndMessage();
    const abortCtrl = new AbortController();

    const scripted = new ScriptedProvider([
      [
        { type: 'delta', text: 'Starting long process...' },
      ],
    ]);

    const registry = new ModelRegistry(ctx.cfg, { google: scripted });
    const usage = new UsageService(ctx.db, ctx.cfg);
    const retriever = new LexicalRetriever();
    const storage = buildStorage(ctx.cfg);
    const agentLoop = new AgentLoop(ctx.db, ctx.cfg, registry, usage, retriever, storage);

    const input: GenerateInput = {
      userId,
      requestId: 'req-abort',
      chatId,
      messageId,
      prompt: 'Abort test',
      mode: 'chat',
      modelAlias: 'gemini-2.5-flash',
      projectId: null,
      hasAttachments: false,
      attachments: [],
      codeExecution: false,
      signal: abortCtrl.signal,
    };

    // Abort immediately
    abortCtrl.abort();

    const events = [];
    for await (const event of agentLoop.stream(input, {
      entry: dummyEntry,
      provider: scripted,
      maxOutputTokens: 2048,
      prefs: { instructions: '', maxOutputTokens: 2048, dailyTokenBudget: null, monthlyTokenBudget: null, warnThresholdPct: 80, routingPreference: 'balanced', timezone: 'UTC' },
      project: null,
      history: [],
      systemInstruction: 'You are an autonomous agent.',
      startedAt: new Date(),
      releaseReservation: async () => {},
      grounded: false,
      codeExecution: false,
    })) {
      events.push(event);
    }

    const [goal] = await ctx.db.select().from(goals).where(and(eq(goals.chatId, chatId), eq(goals.status, 'active')));
    // Goal remains active (not complete)
    expect(goal?.status).toBe('active');

    const [msg] = await ctx.db.select().from(messages).where(eq(messages.id, messageId));
    expect(msg?.status).toBe('stopped');
  });

  it('integrates with SkillService: discovers and lazy-loads skills recording skill_loaded events', async () => {
    const { chatId, messageId } = await createChatAndMessage();

    const backendRoot = path.resolve(__dirname, '../../');
    const skills = new SkillService(backendRoot, 'skills');
    await skills.load();

    // Round 1: search_skills, Round 2: read_skill("pptx"), Round 3: final answer
    const scripted = new ScriptedProvider([
      [
        { type: 'tool_use', toolCallId: 'c-search', name: 'search_skills', input: { query: 'presentation' } },
        {
          type: 'completed',
          usage: { inputTokens: 40, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'tool_use',
        },
      ],
      [
        { type: 'tool_use', toolCallId: 'c-read', name: 'read_skill', input: { name: 'pptx' } },
        {
          type: 'completed',
          usage: { inputTokens: 60, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'tool_use',
        },
      ],
      [
        { type: 'delta', text: 'Prepared presentation outline following the 16:9 guidelines.' },
        {
          type: 'completed',
          usage: { inputTokens: 50, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'stop',
        },
      ],
    ]);

    const registry = new ModelRegistry(ctx.cfg, { google: scripted });
    const usage = new UsageService(ctx.db, ctx.cfg);
    const retriever = new LexicalRetriever();
    const storage = buildStorage(ctx.cfg);

    const skillsCfg = { ...ctx.cfg, ENABLE_SKILLS: true };
    const agentLoop = new AgentLoop(ctx.db, skillsCfg as any, registry, usage, retriever, storage, undefined, skills);

    const input: GenerateInput = {
      userId,
      requestId: 'req-skill-test',
      chatId,
      messageId,
      prompt: 'Help me design a slide deck',
      mode: 'chat',
      modelAlias: 'gemini-2.5-flash',
      projectId: null,
      hasAttachments: false,
      attachments: [],
      codeExecution: false,
      signal: new AbortController().signal,
    };

    const events = [];
    for await (const event of agentLoop.stream(input, {
      entry: dummyEntry,
      provider: scripted,
      maxOutputTokens: 2048,
      prefs: { instructions: '', maxOutputTokens: 2048, dailyTokenBudget: null, monthlyTokenBudget: null, warnThresholdPct: 80, routingPreference: 'balanced', timezone: 'UTC' },
      project: null,
      history: [],
      systemInstruction: 'You are an autonomous agent.',
      startedAt: new Date(),
      releaseReservation: async () => {},
      grounded: false,
      codeExecution: false,
    })) {
      events.push(event);
    }

    const toolResults = events.filter((e) => e.type === 'tool_result');
    expect(toolResults.some((r) => r.type === 'tool_result' && r.name === 'search_skills')).toBe(true);
    expect(toolResults.some((r) => r.type === 'tool_result' && r.name === 'read_skill')).toBe(true);

    const [activeGoal] = await ctx.db
      .select()
      .from(goals)
      .where(and(eq(goals.chatId, chatId), eq(goals.status, 'active')));

    const goalEvs = await ctx.db
      .select()
      .from(goalEvents)
      .where(eq(goalEvents.goalId, activeGoal!.id));

    const skillLoadedEv = goalEvs.find((e) => e.type === 'skill_loaded');
    expect(skillLoadedEv).toBeDefined();
    expect((skillLoadedEv?.data as any)?.skill).toBe('pptx');
    expect((skillLoadedEv?.data as any)?.mode).toBe('guidance_only');
  });
});
