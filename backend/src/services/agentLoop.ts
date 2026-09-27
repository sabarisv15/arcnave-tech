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
import { RUN_PYTHON, RUN_PYTHON_WARM } from '../tools/definitions.js';
import { usesWarmSandbox } from '../tools/catalog.js';
import { z } from 'zod';

import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { goalEvents, goals, messages, toolCalls as toolCallRows } from '../db/schema.js';
import { logger } from '../logger.js';
import type { ModelEntry } from '../providers/registry.js';
import { ModelRegistry } from '../providers/registry.js';
import { getModelCapability } from '../providers/capabilitiesTable.js';
import type { ContextRemainingMeasurement } from '../tools/goalExecutor.js';
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
import { addRequestUsage, EMPTY_USAGE, isAbort, primaryToolContent, toolContentText, withoutImageBytes } from '../providers/types.js';
import { ArtifactToolExecutor } from '../tools/artifactExecutor.js';
import { CodeExecutionToolExecutor } from '../tools/codeExecutionExecutor.js';
import { DispatchingToolExecutor } from '../tools/dispatchingExecutor.js';
import { ProjectToolExecutor } from '../tools/executor.js';
import { GoalToolExecutor } from '../tools/goalExecutor.js';
import { ProjectToolRegistry } from '../tools/registry.js';
import { DeliverableToolExecutor } from '../tools/deliverableExecutor.js';
import { FileOperationExecutor } from '../tools/fileOperationExecutor.js';
import { isTerminalTool } from '../providers/toolLoopPolicy.js';
import { AskUserOptionsExecutor } from '../tools/optionsExecutor.js';
import { FILE_OPERATION_TOOL_DEFINITIONS } from '../tools/definitions.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';
import { SANDBOX_SKILLS_ROOT, SkillToolExecutor } from '../tools/skillExecutor.js';
import { UploadToolExecutor } from '../tools/uploadExecutor.js';
import { WebToolExecutor } from '../tools/webExecutor.js';
import { ImageGenerationExecutor } from '../tools/imageGenerationExecutor.js';
import { WebFetchService } from './webFetch.js';
import { WebSearchService, buildWebSearchAdapter } from './webSearch.js';
import { memoryService } from './memory/memoryService.js';
import { MemoryToolExecutor } from '../tools/memoryExecutor.js';
import { buildStablePrefix } from './promptCache/promptAssembly.js';
import type { SandboxClient } from '../tools/sandbox/client.js';
import type { Retriever } from './retrieval.js';
import type { SkillService } from './skills.js';
import type { ObjectStorage } from './storage.js';
import type { UsageService } from './usage.js';
import type { AgentLoopInput, ModelInfo, PreferencesRow, SourceDto, StreamEvent, UsageDto } from './generation.js';
import { computeCostFor, refusalError, toSourceDto, toUsageDto } from './generation.js';
import { ApiError } from '../errors.js';

const log = logger.child({ module: 'agentLoop' });

function toolResultPreview(result: ToolResult, maxChars: number): string {
  const block = primaryToolContent(result);
  if (!block) return '';
  const text = block.type === 'text' ? block.text : JSON.stringify(block.data);
  return text.slice(0, maxChars);
}

import { ExecutionRuntime, type WorkspaceFiles } from '../tools/execution/executionRuntime.js';
import { TableExtractionToolExecutor, tableExtractionAvailable } from '../tools/tableExtractionExecutor.js';

export interface AgentLoopOptions {
  entry: ModelEntry;
  provider: Provider;
  maxOutputTokens: number;
  reasoningEffort?: import('../providers/types.js').ReasoningEffort;
  prefs: PreferencesRow;
  project: { id: string; instructions: string } | null;
  history: Turn[];
  systemInstruction: string;
  startedAt: Date;
  releaseReservation: () => Promise<void>;
  grounded: boolean;
  codeExecution: boolean;
  workspace?: WorkspaceFiles;
}

export class AgentLoop {
  private readonly executionRuntime: ExecutionRuntime;

  constructor(
    private readonly db: Database,
    private readonly cfg: Config,
    private readonly registry: ModelRegistry,
    private readonly usage: UsageService,
    private readonly retriever: Retriever,
    private readonly storage: ObjectStorage,
    private readonly sandboxClient?: SandboxClient,
    private readonly skills?: SkillService,
    executionRuntime?: ExecutionRuntime,
    private readonly visionProvider?: Provider,
  ) {
    this.executionRuntime = executionRuntime ?? new ExecutionRuntime(sandboxClient);
  }

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
    input: AgentLoopInput,
    options: AgentLoopOptions,
  ): AsyncGenerator<StreamEvent, void, undefined> {
    const {
      entry,
      provider,
      maxOutputTokens,
      reasoningEffort,
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

    const runId = options.workspace ? '' : `agent_${input.chatId}_${input.messageId}`;
    const workspace = options.workspace ?? (await this.executionRuntime.createWorkspace(runId));
    const shouldCleanup = !options.workspace;

    try {
      // Attachments reach the workspace only when a tool names their fileId (G26); see generation.ts.

    // Timeout signal handling
    const timeoutController = new AbortController();
    const timeoutTimer = setTimeout(() => {
      timeoutController.abort(new Error(`Agent loop timed out after ${this.cfg.AGENT_LOOP_TIMEOUT_MS}ms`));
    }, this.cfg.AGENT_LOOP_TIMEOUT_MS);

    const onAbort = () => timeoutController.abort(input.signal.reason);
    // Added after an abort, the listener would never fire (see GenerationService.streamWithRetry).
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener('abort', onAbort, { once: true });

    // Null until the first step: starting from EMPTY_USAGE (exact:false) made every sum inexact.
    let cumulativeUsage: ProviderUsage | null = null;
    let finishReason = 'stop';
    let status: 'complete' | 'cancelled' | 'error' = 'complete';
    let errorCode: string | null = null;
    const collectedText: string[] = [];
    const collectedSources: ProviderSource[] = [];
    let searchEntryPoint: string | undefined;
    let lastStepUsage: ProviderUsage | null = null;
    let eventOrdinal = 0;
    let totalToolCalls = 0;

    const runPythonEnabled = this.cfg.ENABLE_RUN_PYTHON && this.sandboxClient !== undefined;
    const skillsEnabled = this.cfg.ENABLE_SKILLS && this.skills !== undefined;
    const webEnabled = Boolean(this.cfg.ENABLE_WEB);
    const memoryEnabled = Boolean(this.cfg.ENABLE_MEMORY);
    const generativeUiEnabled = Boolean(this.cfg.ENABLE_GENERATIVE_UI);
    const imageEnabled = Boolean(this.cfg.ENABLE_IMAGE_GENERATION);
    const tableExtractionEnabled = tableExtractionAvailable(
      this.cfg.ENABLE_TOOL_USE,
      this.executionRuntime,
      this.visionProvider,
      this.skills,
    );
    const toolRegistry = new ProjectToolRegistry(
      this.cfg.ENABLE_TOOL_USE,
      runPythonEnabled,
      this.cfg.ENABLE_AGENT_LOOP,
      skillsEnabled,
      webEnabled,
      memoryEnabled,
      generativeUiEnabled,
      imageEnabled,
      tableExtractionEnabled,
      usesWarmSandbox(this.cfg) ? RUN_PYTHON_WARM : RUN_PYTHON,
    );
    // Permission alone decides, as in the chat path (ADR-0006, ADR-0032): no keyword gate.
    const allowPython = runPythonEnabled;
    const allowDeliverable = true;

    const activeHistory: Turn[] = [...history];
    const loadedSkillNames = new Set<string>();
    let loadedSkillTokens = 0;
    let effectiveSystemInstruction = systemInstruction;

    // Autoload internal skills if applicable (e.g. python-sandbox-patterns when run_python is active)
    if (allowPython && skillsEnabled) {
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

    const toolContext = {
      userId: input.userId,
      projectId: project?.id ?? null,
      activeGoalId: activeGoal.id,
      allowPython,
      allowDeliverable,
    };

    // Policy-approved catalog of tools that can be discovered on-demand via search_tools
    const policyCatalog: ToolDefinition[] = toolRegistry.getPolicyCatalog
      ? toolRegistry.getPolicyCatalog(toolContext)
      : toolRegistry.getAvailableTools(toolContext);

    // Initial active tools for Round 0: small core tool set (search_tools, load_skill if skills enabled, and goal tools)
    const availableTools: ToolDefinition[] = toolRegistry.getInitialTools
      ? toolRegistry.getInitialTools(toolContext)
      : policyCatalog.filter((t) =>
          t.name === 'search_tools' ||
          t.name === 'load_skill' ||
          t.name === 'get_goal' ||
          t.name === 'update_goal' ||
          t.name === 'get_context_remaining',
        );

    const activeToolNames = new Set<string>(availableTools.map((t) => t.name));

    let hitTerminalTool = false;
    try {
      stepLoop: for (let step = 0; step < this.cfg.AGENT_MAX_STEPS; step++) {
        if (timeoutController.signal.aborted || input.signal.aborted) {
          status = 'cancelled';
          break stepLoop;
        }

        const runId = `run-${input.messageId}-step-${step}`;

        // Exact context remaining calculation:
        // Truthful semantics: previous-request prompt tokens are historical telemetry for that completed
        // request, not current exact request size. If exact current-request measurement is available,
        // populate activeInputTokensExact; otherwise mark available=false and expose lastRequestPromptTokensExact.
        const modelCapability = getModelCapability(entry.providerModelId ?? entry.alias);
        const resolvedMaxInput =
          modelCapability.maxInputTokens ??
          modelCapability.contextWindowTokens ??
          entry.contextWindow ??
          128_000;
        const resolvedCombinedWindow = modelCapability.contextWindowTokens ?? null;

        const exactContextRemaining: ContextRemainingMeasurement = {
          available: false,
          maxInputTokens: resolvedMaxInput,
          contextWindowTokens: resolvedCombinedWindow,
          activeInputTokensExact: null,
          inputTokensRemainingExact: null,
          lastRequestPromptTokensExact: lastStepUsage?.lastRequest?.inputTokens ?? null,
          exact: false,
          contextLimit: resolvedMaxInput,
          tokensUsed: null,
          tokensRemaining: null,
        };

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
            }, { scriptsRoot: runPythonEnabled && usesWarmSandbox(this.cfg) ? SANDBOX_SKILLS_ROOT : undefined })
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
        baseMap.set('ask_user_options', new AskUserOptionsExecutor());
        baseMap.set('create_artifact', artifactToolExecutor);
        baseMap.set('read_artifact', artifactToolExecutor);
        baseMap.set('update_artifact', artifactToolExecutor);

        if (this.cfg.ENABLE_TOOL_USE) {
          baseMap.set('read_uploaded_file', new UploadToolExecutor(this.db, this.storage, input.userId));
          const fileOperationExecutor = new FileOperationExecutor({
            db: this.db,
            visionProvider: this.visionProvider,
            storage: this.storage,
            executionRuntime: this.executionRuntime,
            userId: input.userId,
            chatId: input.chatId,
            messageId: input.messageId,
            workspace,
          });
          for (const def of FILE_OPERATION_TOOL_DEFINITIONS) {
            baseMap.set(def.name, fileOperationExecutor);
          }
          const searchToolsExecutor = new SearchToolsExecutor(policyCatalog, (discoveredTool) => {
            if (!availableTools.some((t) => t.name === discoveredTool.name)) {
              availableTools.push(discoveredTool);
              activeToolNames.add(discoveredTool.name);
            }
          });
          baseMap.set('search_tools', searchToolsExecutor);
        }

        if (webEnabled) {
          const webSearchAdapter = buildWebSearchAdapter(this.cfg);
          const webExecutor = new WebToolExecutor(new WebSearchService(webSearchAdapter), new WebFetchService());
          baseMap.set('web_search', webExecutor);
          baseMap.set('web_fetch', webExecutor);
        }

        if (projectToolExecutor) {
          baseMap.set('search_project_files', projectToolExecutor);
          baseMap.set('read_project_file', projectToolExecutor);
        }
        if (allowPython) {
          baseMap.set(
            'run_python',
            new CodeExecutionToolExecutor(
              this.executionRuntime,
              this.cfg.RUN_PYTHON_MAX_OUTPUT_CHARS,
              {
                workspace,
                userId: input.userId,
                messageId: input.messageId,
                chatId: input.chatId,
                db: this.db,
                storage: this.storage,
                visionProvider: this.visionProvider,
                chatFiles: input.chatFiles,
              },
            ),
          );
        }
        if (tableExtractionEnabled) {
          const tableExecutor = new TableExtractionToolExecutor(
            {
              runtime: this.executionRuntime,
              workspace,
              visionProvider: this.visionProvider!,
              skills: this.skills!,
              storage: this.storage,
              db: this.db,
              userId: input.userId,
            },
            this.cfg.TABLE_EXTRACTION_MAX_PAGES,
          );
          baseMap.set('extract_scanned_table_rows', tableExecutor);
          baseMap.set('analyze_table_rows', tableExecutor);
        }
        baseMap.set('get_goal', goalToolExecutor);
        baseMap.set('update_goal', goalToolExecutor);
        baseMap.set('get_context_remaining', goalToolExecutor);

        if (skillToolExecutor) {
          baseMap.set('load_skill', skillToolExecutor);
          baseMap.set('list_skills', skillToolExecutor);
          baseMap.set('search_skills', skillToolExecutor);
          baseMap.set('read_skill', skillToolExecutor);
        }

        if (memoryEnabled) {
          const memoryToolExecutor = new MemoryToolExecutor(memoryService, input.userId, project?.id ?? null, input.chatId);
          baseMap.set('save_memory', memoryToolExecutor);
          baseMap.set('search_chats', memoryToolExecutor);
          baseMap.set('search_memory', memoryToolExecutor);
          baseMap.set('read_memory', memoryToolExecutor);
          baseMap.set('update_memory', memoryToolExecutor);
          baseMap.set('forget_memory', memoryToolExecutor);
        }

        if (imageEnabled) {
          baseMap.set(
            'generate_image',
            new ImageGenerationExecutor(
              this.cfg,
              this.storage,
              this.db,
              input.userId,
              input.chatId,
              input.messageId,
            ),
          );
        }

        if (this.cfg.ENABLE_TOOL_USE && allowDeliverable) {
          baseMap.set(
            'generate_deliverable',
            new DeliverableToolExecutor(
              this.storage,
              this.db,
              input.userId,
              input.chatId,
              input.messageId,
              undefined,
              this.executionRuntime,
              workspace,
            ),
          );
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
              call.name !== 'read_artifact' &&
              call.name !== 'search_memory' &&
              call.name !== 'read_memory'
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
                .map(toolContentText)
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

        const promptAssembly = {
          stablePrefix: buildStablePrefix(availableTools, policyCatalog.map((t) => t.name)),
          dynamicSuffix: {},
          fullSystemInstruction: effectiveSystemInstruction,
        };

        const request: GenerationRequest = {
          prompt: input.prompt,
          history: activeHistory,
          attachments: input.attachments,
          systemInstruction: effectiveSystemInstruction,
          promptAssembly,
          mode: input.mode,
          maxOutputTokens,
          ...(reasoningEffort ? { reasoningEffort } : {}),
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
    // Gemini's signature for a call, stored so a later turn can replay the call as it was made.
    const pendingSignatures = new Map<string, string>();

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
              if (event.thoughtSignature) pendingSignatures.set(event.toolCallId, event.thoughtSignature);
              if (isTerminalTool(event.name)) {
                hitTerminalTool = true;
              }
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
                pendingSignatures.get(event.toolCallId),
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

            case 'refusal':
              throw refusalError(event);

            case 'completed':
              stepUsage = event.usage;
              finishReason = event.finishReason;
              break;
          }
        }

        // Token accounting: exact accounting per step
        cumulativeUsage = addRequestUsage(cumulativeUsage, stepUsage);
        lastStepUsage = stepUsage;
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

        if (hitTerminalTool) {
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
        // A typed failure (a refusal, a payload limit) keeps its code for the client.
        const typed = err instanceof ApiError ? err : null;
        errorCode = typed?.code ?? 'generation_failed';
        log.error({ err, chatId: input.chatId, requestId: input.requestId }, 'agent loop step failed');
        yield {
          type: 'error',
          code: errorCode,
          title: typed?.title ?? 'Agent Loop Failure',
          detail: typed?.detail ?? (err instanceof Error ? err.message : String(err)),
          usage: toUsageDto(cumulativeUsage ?? EMPTY_USAGE, null),
        };
        return;
      }
    } finally {
      clearTimeout(timeoutTimer);
      input.signal.removeEventListener('abort', onAbort);
      await releaseReservation();
    }

    // Persist final message state
    let text = collectedText.join('');

    // Guaranteed Final Outcome: synthesize text if agent loop produced tool calls but finished with blank text
    if (status === 'complete' && text.trim().length === 0 && !hitTerminalTool) {
      if (input.mode === 'research' && collectedSources.length === 0) {
        text = 'Live web research could not be completed at this time due to search provider unavailability.';
        yield { type: 'delta', text };
      } else {
        try {
          const synthesisStream = provider.stream({
            prompt: `${input.prompt}\n\n[System Instruction: Synthesize a complete final answer based on the previous tool results and evidence above. Do not call any further tools.]`,
            history: activeHistory,
            attachments: input.attachments,
            systemInstruction,
            mode: input.mode,
            maxOutputTokens,
            ...(reasoningEffort ? { reasoningEffort } : {}),
            providerModelId: entry.providerModelId!,
            grounded: false,
            codeExecution: false,
            tools: [],
            toolExecutor: undefined,
            signal: input.signal,
          });
          for await (const ev of synthesisStream) {
            if (ev.type === 'delta' && ev.text) {
              text += ev.text;
              yield { type: 'delta', text: ev.text };
            } else if (ev.type === 'completed') {
              cumulativeUsage = addRequestUsage(cumulativeUsage, ev.usage);
            }
          }
        } catch (synthErr) {
          log.warn({ err: String(synthErr) }, 'agent loop final synthesis round failed');
        }
      }
    }
    const finalFinishReason = status === 'cancelled' ? 'cancelled' : hitTerminalTool ? 'stop' : finishReason;

    await this.finalise(input, {
      text,
      sources: collectedSources,
      searchEntryPoint,
      status: status === 'cancelled' ? 'stopped' : 'complete',
      errorCode,
      finishReason: finalFinishReason,
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
      usage: cumulativeUsage ?? EMPTY_USAGE,
      startedAt,
      status: status === 'cancelled' ? 'cancelled' : 'complete',
      finishReason: finalFinishReason,
    });

    if (status === 'complete') {
      yield {
        type: 'done',
        questions: [],
        usage: toUsageDto(cumulativeUsage ?? EMPTY_USAGE, computeCostFor(this.cfg, entry.providerModelId!, cumulativeUsage ?? EMPTY_USAGE)),
        finishReason: finalFinishReason,
        ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      };
    }
    } finally {
      if (shouldCleanup) {
        await this.executionRuntime.cleanupWorkspace(workspace);
      }
    }
  }

  private async persistToolCall(
    messageId: string,
    toolCallId: string,
    name: string,
    input: unknown,
    result: ToolResult,
    ordinal: number,
    thoughtSignature?: string,
  ): Promise<void> {
    await this.db.insert(toolCallRows).values({
      messageId,
      toolCallId,
      name,
      input: (input as Record<string, unknown>) ?? {},
      ok: result.ok,
      content: withoutImageBytes(result.content),
      ordinal,
      thoughtSignature: thoughtSignature ?? null,
    });
  }

  private async finalise(
    input: AgentLoopInput,
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
