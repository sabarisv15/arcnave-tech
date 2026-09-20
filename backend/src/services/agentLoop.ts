/**
 * AgentLoop Service for Item 10: Multi-Step Agent Loop & Goal Bookkeeping.
 *
 * Implements:
 * - Autonomous multi-step model-tool loop (bounded by AGENT_MAX_STEPS and AGENT_MAX_TOOL_CALLS).
 * - Goal lifecycle resolution (active goal lookup, supersession, auto-creation).
 * - Failure normalization, B2 (blocked at >=3 consecutive failures), and G2 (stop retry at 2 consecutive failures).
 * - Exact atomic token budget tracking per step run.
 * - Graceful timeout and cancellation handling.
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { goalEvents, goals, messages, toolCalls as toolCallRows } from '../db/schema.js';
import { logger } from '../logger.js';
import type { ModelEntry } from '../providers/registry.js';
import { ModelRegistry } from '../providers/registry.js';
import type {
  GenerationRequest,
  Provider,
  ProviderEvent,
  ProviderSource,
  ProviderUsage,
  ToolCall,
  ToolContent,
  ToolDefinition,
  ToolExecutor,
  ToolResult,
  Turn,
} from '../providers/types.js';
import { EMPTY_USAGE, isAbort } from '../providers/types.js';
import { ArtifactToolExecutor } from '../tools/artifactExecutor.js';
import { CodeExecutionToolExecutor } from '../tools/codeExecutionExecutor.js';
import { DispatchingToolExecutor } from '../tools/dispatchingExecutor.js';
import { ProjectToolExecutor } from '../tools/executor.js';
import { GoalToolExecutor } from '../tools/goalExecutor.js';
import { ProjectToolRegistry } from '../tools/registry.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';
import type { SandboxClient } from '../tools/sandbox/client.js';
import type { Retriever } from './retrieval.js';
import type { SkillService } from './skills.js';
import type { ObjectStorage } from './storage.js';
import type { UsageService } from './usage.js';
import type { GenerateInput, ModelInfo, PreferencesRow, SourceDto, StreamEvent, UsageDto } from './generation.js';
import { computeCostFor, toSourceDto, toUsageDto } from './generation.js';

const log = logger.child({ module: 'agentLoop' });

function toolResultPreview(result: ToolResult, maxChars: number): string {
  const block = result.content[0];
  if (!block) return '';
  const text = block.type === 'text' ? block.text : JSON.stringify(block.data);
  return text.slice(0, maxChars);
}

function sumUsage(a: ProviderUsage, b: ProviderUsage): ProviderUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    exact: a.exact && b.exact,
  };
}

export interface AgentLoopOptions {
  entry: ModelEntry;
  provider: Provider;
  maxOutputTokens: number;
  prefs: PreferencesRow;
  project: { id: string; instructions: string } | null;
  history: Turn[];
  systemInstruction: string;
  startedAt: Date;
  releaseReservation: () => Promise<void>;
  grounded: boolean;
  codeExecution: boolean;
}

export class AgentLoop {
  constructor(
    private readonly db: Database,
    private readonly cfg: Config,
    private readonly registry: ModelRegistry,
    private readonly usage: UsageService,
    private readonly retriever: Retriever,
    private readonly storage: ObjectStorage,
    private readonly sandboxClient?: SandboxClient,
    private readonly skills?: SkillService,
  ) {}

  /**
   * Resolves or creates the active goal for a chat.
   * If an active goal exists and is not superseded, reuses it.
   * If superseded or none exists, creates a new active goal.
   */
  async resolveGoal(
    chatId: string,
    prompt: string,
    messageId: string,
    forceNew = false,
  ): Promise<typeof goals.$inferSelect> {
    const [existing] = await this.db
      .select()
      .from(goals)
      .where(and(eq(goals.chatId, chatId), eq(goals.status, 'active')))
      .limit(1);

    if (existing && !forceNew) {
      return existing;
    }

    if (existing && forceNew) {
      await this.db
        .update(goals)
        .set({
          status: 'abandoned',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(goals.id, existing.id));

      await this.db.insert(goalEvents).values({
        goalId: existing.id,
        type: 'status_change',
        data: { status: 'abandoned', reason: 'Superseded by new user goal' },
      });
    }

    const [created] = await this.db
      .insert(goals)
      .values({
        chatId,
        originMessageId: messageId,
        description: prompt.slice(0, 500),
        status: 'active',
        tokenBudget: this.cfg.GOAL_DEFAULT_TOKEN_BUDGET ?? null,
      })
      .returning();

    return created!;
  }

  /**
   * Executes the multi-step agent loop across steps and tools.
   */
  async *stream(
    input: GenerateInput,
    options: AgentLoopOptions,
  ): AsyncGenerator<StreamEvent, void, undefined> {
    const {
      entry,
      provider,
      maxOutputTokens,
      prefs,
      project,
      history,
      systemInstruction,
      startedAt,
      releaseReservation,
      grounded,
      codeExecution,
    } = options;

    // Resolve active goal
    const activeGoal = await this.resolveGoal(input.chatId, input.prompt, input.messageId);

    // Timeout signal handling
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => {
      timeoutController.abort(new Error(`Agent loop timed out after ${this.cfg.AGENT_LOOP_TIMEOUT_MS}ms`));
    }, this.cfg.AGENT_LOOP_TIMEOUT_MS);

    const onAbort = () => timeoutController.abort(input.signal.reason);
    input.signal.addEventListener('abort', onAbort, { once: true });

    let cumulativeUsage: ProviderUsage = EMPTY_USAGE;
    let finishReason = 'stop';
    let status: 'complete' | 'cancelled' | 'error' = 'complete';
    let errorCode: string | null = null;
    const collectedText: string[] = [];
    const collectedSources: ProviderSource[] = [];
    let searchEntryPoint: string | undefined;
    let eventOrdinal = 0;
    let totalToolCalls = 0;

    const runPythonEnabled = this.cfg.ENABLE_RUN_PYTHON && this.sandboxClient !== undefined;
    const skillsEnabled = this.cfg.ENABLE_SKILLS && this.skills !== undefined;
    const toolRegistry = new ProjectToolRegistry(
      this.cfg.ENABLE_TOOL_USE,
      runPythonEnabled,
      this.cfg.ENABLE_AGENT_LOOP,
      skillsEnabled,
    );

    const activeHistory: Turn[] = [...history];
    const loadedSkillNames = new Set<string>();
    let loadedSkillTokens = 0;
    let effectiveSystemInstruction = systemInstruction;

    // Autoload internal skills if applicable (e.g. python-sandbox-patterns when run_python is active)
    if (runPythonEnabled && skillsEnabled) {
      const activeCapabilityNames = new Set<string>(['run_python']);
      const autoloads = this.skills!.getAutoloadSkills(activeCapabilityNames);
      for (const autoSkill of autoloads) {
        if (autoSkill.name === 'python-sandbox-patterns' && !loadedSkillNames.has(autoSkill.name)) {
          loadedSkillNames.add(autoSkill.name);
          loadedSkillTokens += autoSkill.content.length;
          effectiveSystemInstruction += `\n\n[Auto-Loaded Internal Skill: ${autoSkill.name}]\n${autoSkill.content}`;
        }
      }
    }

    try {
      stepLoop: for (let step = 0; step < this.cfg.AGENT_MAX_STEPS; step++) {
        if (timeoutController.signal.aborted || input.signal.aborted) {
          status = 'cancelled';
          break stepLoop;
        }

        const runId = `run-${input.messageId}-step-${step}`;

        // Exact context remaining calculation if usage is exact
        const exactContextRemaining = cumulativeUsage.exact
          ? {
              contextLimit: 128000,
              tokensUsed: cumulativeUsage.inputTokens + cumulativeUsage.outputTokens,
              tokensRemaining: Math.max(
                0,
                128000 - (cumulativeUsage.inputTokens + cumulativeUsage.outputTokens),
              ),
            }
          : null;

        const availableTools = toolRegistry.getAvailableTools({
          projectId: project?.id ?? null,
          activeGoalId: activeGoal.id,
        });

        const activeToolNames = new Set<string>(availableTools.map((t) => t.name));

        const projectToolExecutor =
          project !== null && this.cfg.ENABLE_TOOL_USE
            ? new ProjectToolExecutor(
                this.db,
                this.retriever,
                project.id,
                this.cfg.READ_PROJECT_FILE_MAX_CHARS,
              )
            : undefined;

        const goalToolExecutor = new GoalToolExecutor(
          this.db,
          activeGoal.id,
          runId,
          exactContextRemaining,
        );

        const skillToolExecutor = skillsEnabled
          ? new SkillToolExecutor(this.skills!, activeToolNames, async (skill) => {
              // Deduplication & limit checks
              if (loadedSkillNames.has(skill.name)) return;
              if (loadedSkillNames.size >= this.cfg.MAX_LOADED_SKILLS_PER_STEP) return;
              if (loadedSkillTokens + skill.content.length > this.cfg.MAX_SKILL_CONTEXT_TOKENS) return;

              loadedSkillNames.add(skill.name);
              loadedSkillTokens += skill.content.length;

              await this.db.insert(goalEvents).values({
                goalId: activeGoal.id,
                runId,
                type: 'skill_loaded',
                toolName: 'read_skill',
                data: {
                  skill: skill.name,
                  version: skill.version,
                  mode: skill.mode,
                  missingCapabilities: skill.missingCapabilities,
                },
              });
            })
          : undefined;

        const pendingArtifactEvents: StreamEvent[] = [];
        const artifactToolExecutor = new ArtifactToolExecutor(
          this.db,
          {
            userId: input.userId,
            projectId: project?.id ?? null,
            chatId: input.chatId,
            assistantMessageId: input.messageId,
            runId,
          },
          this.cfg.ARTIFACT_MAX_CONTENT_BYTES,
          (art) => {
            pendingArtifactEvents.push({
              type: 'artifact_created',
              artifactId: art.artifactId,
              title: art.title,
              kind: art.kind,
              version: art.version,
            });
          },
        );

        const baseMap = new Map<string, ToolExecutor>();
        baseMap.set('create_artifact', artifactToolExecutor);
        baseMap.set('read_artifact', artifactToolExecutor);
        baseMap.set('update_artifact', artifactToolExecutor);
        if (projectToolExecutor) {
          baseMap.set('search_project_files', projectToolExecutor);
          baseMap.set('read_project_file', projectToolExecutor);
        }
        if (runPythonEnabled) {
          baseMap.set(
            'run_python',
            new CodeExecutionToolExecutor(this.sandboxClient!, this.cfg.RUN_PYTHON_MAX_OUTPUT_CHARS),
          );
        }
        baseMap.set('get_goal', goalToolExecutor);
        baseMap.set('update_goal', goalToolExecutor);
        baseMap.set('get_context_remaining', goalToolExecutor);

        if (skillToolExecutor) {
          baseMap.set('list_skills', skillToolExecutor);
          baseMap.set('search_skills', skillToolExecutor);
          baseMap.set('read_skill', skillToolExecutor);
        }

        const rawDispatcher = new DispatchingToolExecutor(baseMap);

        // Intercept tools with G2 check, failure tracking, and recovery logging
        const wrappedToolExecutor: ToolExecutor = {
          execute: async (call: ToolCall, signal: AbortSignal): Promise<ToolResult> => {
            totalToolCalls++;

            // G2 Rule Check (exclude goals, skills, and read_artifact queries)
            if (
              call.name !== 'get_goal' &&
              call.name !== 'update_goal' &&
              call.name !== 'get_context_remaining' &&
              call.name !== 'list_skills' &&
              call.name !== 'search_skills' &&
              call.name !== 'read_skill' &&
              call.name !== 'read_artifact'
            ) {
              const isG2 = await GoalToolExecutor.isToolG2Blocked(this.db, activeGoal.id, call.name);
              if (isG2) {
                const g2Msg = `G2 Rule: Tool "${call.name}" has failed 2 consecutive times with the same error. Stop retrying this exact tool and select an alternate strategy.`;
                return {
                  toolCallId: call.id,
                  ok: false,
                  content: [{ type: 'text', text: g2Msg }],
                };
              }
            }

            let result: ToolResult;
            try {
              result = await rawDispatcher.execute(call, signal);
            } catch (err) {
              result = {
                toolCallId: call.id,
                ok: false,
                content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
              };
            }

            if (result.ok) {
              await GoalToolExecutor.recordToolSuccess(this.db, activeGoal.id, call.name, runId);
            } else {
              const errorText = result.content
                .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c.data)))
                .join(' ');
              await GoalToolExecutor.recordToolFailure(
                this.db,
                activeGoal.id,
                call.name,
                errorText,
                runId,
              );
            }

            return result;
          },
        };

        const request: GenerationRequest = {
          prompt: input.prompt,
          history: activeHistory,
          attachments: input.attachments,
          systemInstruction: effectiveSystemInstruction,
          mode: input.mode,
          maxOutputTokens,
          providerModelId: entry.providerModelId!,
          grounded,
          codeExecution,
          tools: availableTools,
          toolExecutor: wrappedToolExecutor,
          signal: timeoutController.signal,
        };

        let stepText = '';
        let stepCallsCount = 0;
        let stepUsage: ProviderUsage = EMPTY_USAGE;
        const pendingToolInputs = new Map<string, unknown>();

        const stream = provider.stream(request);

        for await (const event of stream) {
          if (timeoutController.signal.aborted || input.signal.aborted) {
            status = 'cancelled';
            break stepLoop;
          }

          switch (event.type) {
            case 'delta':
              stepText += event.text;
              collectedText.push(event.text);
              yield { type: 'delta', text: event.text };
              break;

            case 'sources': {
              collectedSources.push(...event.sources);
              if (event.searchEntryPoint) searchEntryPoint = event.searchEntryPoint;
              const dtos = event.sources.map((s, i) => toSourceDto(s, i + 1));
              yield {
                type: 'sources',
                sources: dtos,
                ...(event.searchEntryPoint ? { searchEntryPoint: event.searchEntryPoint } : {}),
              };
              break;
            }

            case 'code':
              yield {
                type: 'code',
                ...(event.code ? { code: event.code } : {}),
                ...(event.language ? { language: event.language } : {}),
                ...(event.output ? { output: event.output } : {}),
              };
              break;

            case 'tool_use':
              stepCallsCount++;
              pendingToolInputs.set(event.toolCallId, event.input);
              yield {
                type: 'tool_use',
                toolCallId: event.toolCallId,
                name: event.name,
                input: event.input,
              };
              break;

            case 'tool_result': {
              const preview = toolResultPreview(event.result, this.cfg.TOOL_RESULT_PREVIEW_CHARS);
              yield {
                type: 'tool_result',
                toolCallId: event.toolCallId,
                name: event.name,
                ok: event.result.ok,
                preview,
              };
              await this.persistToolCall(
                input.messageId,
                event.toolCallId,
                event.name,
                pendingToolInputs.get(event.toolCallId),
                event.result,
                eventOrdinal++,
              );
              while (pendingArtifactEvents.length > 0) {
                yield pendingArtifactEvents.shift()!;
              }
              break;
            }

            case 'progress': {
              const out: StreamEvent = {
                type: 'research',
                event: {
                  stage: event.stage,
                  label: event.label,
                  detail: event.detail,
                  at: new Date().toISOString(),
                },
              };
              yield out;
              break;
            }

            case 'completed':
              stepUsage = event.usage;
              finishReason = event.finishReason;
              break;
          }
        }

        // Token accounting: exact accounting per step
        cumulativeUsage = sumUsage(cumulativeUsage, stepUsage);
        const stepTotalTokens = (stepUsage.inputTokens ?? 0) + (stepUsage.outputTokens ?? 0);

        if (stepTotalTokens > 0) {
          await this.db
            .update(goals)
            .set({
              spentTokens: sql`${goals.spentTokens} + ${stepTotalTokens}`,
              updatedAt: new Date(),
            })
            .where(eq(goals.id, activeGoal.id));

          await this.db.insert(goalEvents).values({
            goalId: activeGoal.id,
            runId,
            type: 'budget_update',
            data: { stepTokens: stepTotalTokens, stepUsage },
          });
        }

        // Check if goal transitioned to complete or blocked
        const [refreshedGoal] = await this.db
          .select()
          .from(goals)
          .where(eq(goals.id, activeGoal.id))
          .limit(1);

        if (refreshedGoal?.status === 'complete' || refreshedGoal?.status === 'blocked') {
          break stepLoop;
        }

        // If no tools were called in this step, model produced its final response
        if (stepCallsCount === 0) {
          break stepLoop;
        }

        // If tool limit reached, record checkpoint and exit
        if (totalToolCalls >= this.cfg.AGENT_MAX_TOOL_CALLS) {
          await this.db.insert(goalEvents).values({
            goalId: activeGoal.id,
            runId,
            type: 'checkpoint',
            data: { note: `Agent reached maximum tool calls limit (${this.cfg.AGENT_MAX_TOOL_CALLS})` },
          });
          break stepLoop;
        }

        // Append this turn's response to history for the next step continuation
        if (stepText) {
          activeHistory.push({ role: 'assistant', text: stepText });
        }
      }
    } catch (err) {
      if (isAbort(err) || timeoutController.signal.aborted || input.signal.aborted) {
        status = 'cancelled';
      } else {
        status = 'error';
        errorCode = 'generation_failed';
        log.error({ err, chatId: input.chatId, requestId: input.requestId }, 'agent loop step failed');
        yield {
          type: 'error',
          code: 'generation_failed',
          title: 'Agent Loop Failure',
          detail: err instanceof Error ? err.message : String(err),
          usage: toUsageDto(cumulativeUsage, null),
        };
        return;
      }
    } finally {
      clearTimeout(timeoutTimer);
      input.signal.removeEventListener('abort', onAbort);
      await releaseReservation();
    }

    // Persist final message state
    const text = collectedText.join('');
    await this.finalise(input, {
      text,
      sources: collectedSources,
      searchEntryPoint,
      status: status === 'cancelled' ? 'stopped' : 'complete',
      errorCode,
      finishReason: status === 'cancelled' ? 'cancelled' : finishReason,
      entry,
      mode: input.mode,
      questions: [],
    });

    await this.usage.record({
      userId: input.userId,
      prefs,
      requestId: input.requestId,
      chatId: input.chatId,
      messageId: input.messageId,
      projectId: input.projectId,
      modelAlias: entry.alias,
      provider: entry.provider,
      providerModelId: entry.providerModelId!,
      usage: cumulativeUsage,
      startedAt,
      status: status === 'cancelled' ? 'cancelled' : 'complete',
      finishReason: status === 'cancelled' ? 'cancelled' : finishReason,
    });

    if (status === 'complete') {
      yield {
        type: 'done',
        questions: [],
        usage: toUsageDto(cumulativeUsage, computeCostFor(this.cfg, entry.providerModelId!, cumulativeUsage)),
        finishReason,
      };
    }
  }

  private async persistToolCall(
    messageId: string,
    toolCallId: string,
    name: string,
    input: unknown,
    result: ToolResult,
    ordinal: number,
  ): Promise<void> {
    await this.db.insert(toolCallRows).values({
      messageId,
      toolCallId,
      name,
      input: (input as Record<string, unknown>) ?? {},
      ok: result.ok,
      content: result.content,
      ordinal,
    });
  }

  private async finalise(
    input: GenerateInput,
    data: {
      text: string;
      sources: ProviderSource[];
      searchEntryPoint?: string;
      status: 'complete' | 'stopped' | 'error';
      errorCode: string | null;
      finishReason: string | null;
      entry: ModelEntry;
      mode: string;
      questions: string[];
    },
  ): Promise<void> {
    await this.db
      .update(messages)
      .set({
        text: data.text,
        status: data.status,
        errorCode: data.errorCode,
        finishReason: data.finishReason,
        modelAlias: data.entry.alias,
        providerModelId: data.entry.providerModelId,
        searchEntryPoint: data.searchEntryPoint ?? null,
        completedAt: new Date(),
      })
      .where(eq(messages.id, input.messageId));
  }
}
