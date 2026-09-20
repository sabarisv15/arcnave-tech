import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { chats, goalEvents, goals } from '../db/schema.js';
import type { ToolContent } from '../providers/types.js';
import { createTestApp, signUp, type TestContext } from '../test/harness.js';
import { GoalToolExecutor, normalizeFailureFingerprint } from './goalExecutor.js';

let ctx: TestContext;
let userId: string;
let cookie: string;

function jsonContent(content: ToolContent[]): Record<string, unknown> {
  const block = content[0];
  if (!block || block.type !== 'json') throw new Error('expected a json content block');
  return block.data as Record<string, unknown>;
}

async function createChat(): Promise<string> {
  const chatRes = await ctx.app.inject({
    method: 'POST',
    url: '/v1/chats',
    headers: { cookie },
    payload: { title: `Goal test chat ${Date.now()}-${Math.random()}` },
  });
  return (chatRes.json() as { id: string }).id;
}

beforeAll(async () => {
  ctx = await createTestApp();
  const user = await signUp(ctx);
  userId = user.id;
  cookie = user.cookie;
});

afterAll(async () => {
  await ctx?.close();
});

describe('normalizeFailureFingerprint', () => {
  it('normalizes timeout errors deterministically', () => {
    const fp1 = normalizeFailureFingerprint('run_python', new Error('Execution timed out after 5000ms'));
    const fp2 = normalizeFailureFingerprint('run_python', new Error('Request deadline exceeded at 2026-09-20T10:00:00Z'));
    expect(fp1).toBe('run_python|timeout|Error');
    expect(fp2).toBe('run_python|timeout|Error');
  });

  it('normalizes not found errors deterministically', () => {
    const err = new Error('File not found: /var/data/foo.txt (ENOENT)');
    const fp = normalizeFailureFingerprint('read_project_file', err);
    expect(fp).toBe('read_project_file|not_found|ENOENT');
  });

  it('normalizes validation and permission errors', () => {
    const valFp = normalizeFailureFingerprint('search_project_files', new Error('Invalid input: query is required'));
    const permFp = normalizeFailureFingerprint('read_project_file', new Error('Permission denied: 403 Forbidden'));
    expect(valFp).toBe('search_project_files|validation_error|Error');
    expect(permFp).toBe('read_project_file|permission_denied|403');
  });
});

describe('GoalToolExecutor', () => {
  it('get_goal returns full goal status, remaining budget and checkpoints', async () => {
    const chatId = await createChat();
    const [goal] = await ctx.db
      .insert(goals)
      .values({
        chatId,
        description: 'Research climate impacts on agriculture',
        status: 'active',
        tokenBudget: 50000,
        spentTokens: 12000,
      })
      .returning();

    await ctx.db.insert(goalEvents).values({
      goalId: goal!.id,
      type: 'checkpoint',
      data: { note: 'Completed initial file scan' },
    });

    const executor = new GoalToolExecutor(ctx.db, goal!.id);
    const result = await executor.execute(
      { id: 'c1', name: 'get_goal', input: {} },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = jsonContent(result.content);
    expect(data.goalId).toBe(goal!.id);
    expect(data.description).toBe('Research climate impacts on agriculture');
    expect(data.tokenBudget).toBe(50000);
    expect(data.spentTokens).toBe(12000);
    expect(data.remainingBudget).toBe(38000);
    expect((data.checkpoints as any[])[0]?.note).toBe('Completed initial file scan');
  });

  it('update_goal enforces B2 rule rejecting blocked status when consecutive failures < 3', async () => {
    const chatId = await createChat();
    const [goal] = await ctx.db
      .insert(goals)
      .values({
        chatId,
        description: 'B2 rule check goal',
        status: 'active',
        consecutiveFailureCount: 2, // only 2 failures
      })
      .returning();

    const executor = new GoalToolExecutor(ctx.db, goal!.id);
    const result = await executor.execute(
      {
        id: 'c2',
        name: 'update_goal',
        input: { status: 'blocked', blockedReason: 'Cannot reach external sandbox' },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content[0]?.type).toBe('text');
    if (result.content[0]?.type === 'text') {
      expect(result.content[0].text).toContain('B2 rule requires 3 consecutive identical failures');
    }
  });

  it('update_goal allows blocked status when consecutive failures >= 3 (B2 rule satisfied)', async () => {
    const chatId = await createChat();
    const [goal] = await ctx.db
      .insert(goals)
      .values({
        chatId,
        description: 'B2 rule satisfied goal',
        status: 'active',
        consecutiveFailureCount: 3, // 3 failures
      })
      .returning();

    const executor = new GoalToolExecutor(ctx.db, goal!.id);
    const result = await executor.execute(
      {
        id: 'c3',
        name: 'update_goal',
        input: { status: 'blocked', blockedReason: 'Sandbox repeatedly unavailable 3x' },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = jsonContent(result.content);
    expect(data.status).toBe('blocked');

    const [updated] = await ctx.db.select().from(goals).where(eq(goals.id, goal!.id));
    expect(updated?.status).toBe('blocked');
    expect(updated?.blockedReason).toBe('Sandbox repeatedly unavailable 3x');
    expect(updated?.completedAt).not.toBeNull();
  });

  it('update_goal allows complete status and records checkpoint notes', async () => {
    const chatId = await createChat();
    const [goal] = await ctx.db
      .insert(goals)
      .values({
        chatId,
        description: 'Complete goal test',
        status: 'active',
      })
      .returning();

    const executor = new GoalToolExecutor(ctx.db, goal!.id);
    const result = await executor.execute(
      {
        id: 'c4',
        name: 'update_goal',
        input: { status: 'complete', note: 'Final report generated successfully' },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = jsonContent(result.content);
    expect(data.status).toBe('complete');

    const [updated] = await ctx.db.select().from(goals).where(eq(goals.id, goal!.id));
    expect(updated?.status).toBe('complete');
  });

  it('get_context_remaining adheres to Invariant 3 (exact values or null)', async () => {
    // 1. With exact measurements
    const exactExecutor = new GoalToolExecutor(ctx.db, 'goal-1', 'run-1', {
      contextLimit: 128000,
      tokensUsed: 45000,
      tokensRemaining: 83000,
    });

    const exactRes = await exactExecutor.execute(
      { id: 'c5', name: 'get_context_remaining', input: {} },
      new AbortController().signal,
    );
    expect(exactRes.ok).toBe(true);
    const exactData = jsonContent(exactRes.content);
    expect(exactData.exact).toBe(true);
    expect(exactData.contextLimit).toBe(128000);
    expect(exactData.tokensUsed).toBe(45000);
    expect(exactData.tokensRemaining).toBe(83000);

    // 2. Without exact measurements -> nulls, never estimate
    const inexactExecutor = new GoalToolExecutor(ctx.db, 'goal-1', 'run-1', null);
    const inexactRes = await inexactExecutor.execute(
      { id: 'c6', name: 'get_context_remaining', input: {} },
      new AbortController().signal,
    );
    expect(inexactRes.ok).toBe(true);
    const inexactData = jsonContent(inexactRes.content);
    expect(inexactData.exact).toBe(false);
    expect(inexactData.contextLimit).toBeNull();
    expect(inexactData.tokensUsed).toBeNull();
    expect(inexactData.tokensRemaining).toBeNull();
  });

  it('persistent failure tracking and G2 detection with recovery reset', async () => {
    const chatId = await createChat();
    const [testGoal] = await ctx.db
      .insert(goals)
      .values({
        chatId,
        description: 'Failure recovery test goal',
        status: 'active',
      })
      .returning();

    // 1st failure
    const f1 = await GoalToolExecutor.recordToolFailure(
      ctx.db,
      testGoal!.id,
      'run_python',
      new Error('ZeroDivisionError: division by zero'),
      'run-1',
    );
    expect(f1.consecutiveFailureCount).toBe(1);
    expect(f1.isG2Blocked).toBe(false);

    // 2nd identical failure -> triggers G2 block
    const f2 = await GoalToolExecutor.recordToolFailure(
      ctx.db,
      testGoal!.id,
      'run_python',
      new Error('ZeroDivisionError: division by zero'),
      'run-1',
    );
    expect(f2.consecutiveFailureCount).toBe(2);
    expect(f2.isG2Blocked).toBe(true);

    const isG2 = await GoalToolExecutor.isToolG2Blocked(ctx.db, testGoal!.id, 'run_python');
    expect(isG2).toBe(true);

    // Successful tool execution (recovery) -> resets counter
    await GoalToolExecutor.recordToolSuccess(ctx.db, testGoal!.id, 'search_project_files', 'run-1');

    const [afterRecovery] = await ctx.db.select().from(goals).where(eq(goals.id, testGoal!.id));
    expect(afterRecovery?.consecutiveFailureCount).toBe(0);
    expect(afterRecovery?.lastFailureFingerprint).toBeNull();

    const isG2After = await GoalToolExecutor.isToolG2Blocked(ctx.db, testGoal!.id, 'run_python');
    expect(isG2After).toBe(false);
  });
});
