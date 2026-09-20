/**
 * Generation orchestration.
 *
 * Owns the whole life of one assistant turn: resolve the model, assemble context, reserve
 * budget, stream from the provider, persist what happened, and record usage — including when
 * the run is cancelled or fails.
 *
 * Two behaviours worth naming because they are easy to get subtly wrong:
 *
 * - **Retries only happen before the first token reaches the client.** Once a delta has been
 *   emitted, retrying would duplicate visible text, so a mid-stream failure is reported as a
 *   failure rather than silently restarted.
 * - **Cancellation still writes a usage row.** A run that streamed 800 tokens before the user
 *   pressed stop cost those tokens; dropping the record would understate real spend.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import {
  attachments,
  chats,
  messages,
  messageSources,
  preferences as preferencesTable,
  projectFiles,
  projects,
  researchEvents,
  toolCalls,
} from '../db/schema.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import type { ModelEntry, ModelRegistry } from '../providers/registry.js';
import { AUTO_ALIAS } from '../providers/registry.js';
import type { RoutingDecision } from '../providers/routing.js';
import { routeAuto } from '../providers/routing.js';
import type {
  AttachmentBlock,
  GenerationRequest,
  Mode,
  ProviderEvent,
  ProviderSource,
  ProviderUsage,
  ToolDefinition,
  ToolExecutor,
  ToolResult,
  Turn,
} from '../providers/types.js';
import {
  EMPTY_USAGE,
  isAbort,
  ModelNotFoundError,
  ProviderError,
  toolResultPreview,
  totalTokens,
} from '../providers/types.js';
import { AgentLoop } from './agentLoop.js';
import { ArtifactToolExecutor } from '../tools/artifactExecutor.js';
import { CodeExecutionToolExecutor } from '../tools/codeExecutionExecutor.js';
import { DispatchingToolExecutor } from '../tools/dispatchingExecutor.js';
import { ProjectToolExecutor } from '../tools/executor.js';
import { ProjectToolRegistry } from '../tools/registry.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';
import { UploadToolExecutor } from '../tools/uploadExecutor.js';
import { WebToolExecutor } from '../tools/webExecutor.js';
import { WebFetchService } from './webFetch.js';
import { WebSearchService, buildWebSearchAdapter } from './webSearch.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import type { CapabilityRegistry } from '../capabilities/registry.js';
import { buildBaseSystemPrompt, buildDynamicRuntimeContext } from './systemPrompt.js';
import { assemblePrompt } from './promptCache/promptAssembly.js';
import type { PromptAssembly } from './promptCache/types.js';
import { memoryService } from './memory/memoryService.js';
import { distillUserStatement } from './memory/distiller.js';
import { compactionService } from './compaction/compactionService.js';
import { MemoryToolExecutor } from '../tools/memoryExecutor.js';
import { UIToolExecutor } from '../tools/uiExecutor.js';
import { UIAuthorizer } from './ui/authorizer.js';
import type { UIBlock } from './ui/types.js';
import type { SandboxClient } from '../tools/sandbox/client.js';
import type { SkillService } from './skills.js';
import type { ObjectStorage } from './storage.js';
import type { Retriever } from './retrieval.js';
import { formatContext } from './retrieval.js';
import type { UsageService } from './usage.js';
import { shouldExposeRunPython } from '../tools/capabilityPolicy.js';

const log = logger.child({ module: 'generation' });

/* -------------------------------------------------------------------------- SSE shapes */

/**
 * Events sent to the browser.
 *
 * Intentionally close to the frontend's existing `AdapterEvent` union so the mock generator
 * can be replaced without redesigning the UI, extended with the ids, usage, and routing
 * metadata a real backend has to report.
 */
export type StreamEvent =
  | { type: 'start'; messageId: string; chatId: string; requestId: string; model: ModelInfo }
  | { type: 'research'; event: { stage: string; label: string; detail: string; at: string } }
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: SourceDto[]; searchEntryPoint?: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; name: string; ok: boolean; preview: string }
  | { type: 'artifact_created'; artifactId: string; title: string; kind: string; version: number }
  | { type: 'ui_block'; block: UIBlock }
  | { type: 'done'; questions: string[]; usage: UsageDto; finishReason: string }
  | { type: 'error'; code: string; title: string; detail: string; usage?: UsageDto };

export interface ModelInfo {
  requested: string;
  resolved: string;
  provider: string;
  providerModelId: string;
  /** Present only when the request asked for `Auto`, so routing is never opaque. */
  routing?: { rule: string; considered: string[] };
  grounded: boolean;
  codeExecution: boolean;
}

export interface SourceDto {
  id: number;
  title: string;
  url: string;
  urlResolved: boolean;
  domain: string;
  type: string;
  snippet: string;
  passage: string;
  retrievedAt: string;
}

export interface UsageDto {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** False means the provider reported nothing. The UI must not present zeros as measured. */
  exact: boolean;
  costUsd: number | null;
}

export function toUsageDto(usage: ProviderUsage, costUsd: number | null): UsageDto {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: totalTokens(usage),
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    exact: usage.exact,
    costUsd,
  };
}

/* -------------------------------------------------------------------------- input */

export interface GenerateInput {
  userId: string;
  requestId: string;
  chatId: string;
  /** The assistant message row to fill in. Created by the route before streaming starts. */
  messageId: string;
  prompt: string;
  mode: Mode;
  modelAlias: string;
  projectId: string | null;
  hasAttachments: boolean;
  attachmentText: string;
  attachmentManifest?: string;
  /** This turn's image/PDF attachments, ready as native content blocks. */
  attachments: AttachmentBlock[];
  /** Opt-in per request. Only Gemini has a code-execution sandbox on Vertex — see ADR-0004. */
  codeExecution: boolean;
  signal: AbortSignal;
}

export interface PreferencesRow {
  instructions: string;
  maxOutputTokens: number;
  dailyTokenBudget: number | null;
  monthlyTokenBudget: number | null;
  warnThresholdPct: number;
  routingPreference: string;
  timezone: string;
}

/* -------------------------------------------------------------------------- service */

export class GenerationService {
  private readonly agentLoop: AgentLoop;
  private readonly capabilities: CapabilityRegistry;

  constructor(
    private readonly db: Database,
    private readonly cfg: Config,
    private readonly registry: ModelRegistry,
    private readonly usage: UsageService,
    private readonly retriever: Retriever,
    private readonly storage: ObjectStorage,
    /** Undefined when ENABLE_RUN_PYTHON is off or no Vertex project is configured — run_python
     *  is simply never in the available-tools list in that case (see the wiring in `run()`). */
    private readonly sandboxClient?: SandboxClient,
    agentLoop?: AgentLoop,
    private readonly skills?: SkillService,
    capabilities?: CapabilityRegistry,
  ) {
    this.capabilities = capabilities ?? buildCapabilityRegistry(cfg);
    this.agentLoop =
      agentLoop ??
      new AgentLoop(db, cfg, registry, usage, retriever, storage, sandboxClient, skills);
  }

  /**
   * Run one turn, yielding events for the SSE transport.
   *
   * The generator is the unit of cancellation: when the transport stops pulling (because the
   * client disconnected), the `finally` runs, the provider stream is abandoned, and the usage
   * row is written with whatever the provider had already reported.
   */
  async *run(input: GenerateInput): AsyncGenerator<StreamEvent> {
    const startedAt = new Date();
    const prefs = await this.loadPreferences(input.userId);

    const project = input.projectId ? await this.loadProject(input.userId, input.projectId) : null;
    const latestCompaction = this.cfg.ENABLE_CONTEXT_COMPACTION
      ? await compactionService.getLatestCompaction(input.chatId)
      : null;
    // Loaded before model resolution (not its historical position) because whether this turn
    // needs a vision-capable model depends on what's carried forward, not only on what's newly
    // attached — and loadHistory has no dependency on which model gets picked.
    const history = await this.loadHistory(input.chatId, input.messageId, latestCompaction?.throughSeq);

    // --- resolve the model ------------------------------------------------
    const requiresGrounding = input.mode !== 'chat';
    const requiresVision =
      input.attachments.length > 0 || history.some((t) => (t.attachments?.length ?? 0) > 0);
    const { entry, routing } = await this.resolveModel(
      input,
      prefs,
      requiresGrounding,
      requiresVision,
      project?.instructions.length ?? 0,
    );
    const provider = this.registry.providerFor(entry);
    if (!provider) {
      throw new ApiError('model_unavailable', {
        detail: `No adapter is registered for provider "${entry.provider}".`,
      });
    }

    const grounded = requiresGrounding && entry.supportsGrounding && provider.supportsGrounding();
    if (requiresGrounding && !grounded) {
      // Search and research promise cited answers. Rather than quietly degrade to an
      // uncited chat reply, say the capability is off and let the user choose.
      throw new ApiError('capability_unavailable', {
        detail:
          `${input.mode === 'research' ? 'Research' : 'Search'} needs a grounding provider, ` +
          'which is not enabled for the selected model. Switch to Chat, or enable ' +
          'grounding in the server configuration.',
        meta: { mode: input.mode, alias: entry.alias },
      });
    }

    const codeExecution = input.codeExecution && (provider.supportsCodeExecution?.() ?? false);
    if (input.codeExecution && !codeExecution) {
      // Claude has no code-execution tool on Vertex (ADR-0004) — never silently run the turn
      // on a different model than the one the caller asked for just because it can run code.
      throw new ApiError('capability_unavailable', {
        detail:
          'Code execution needs a provider with a code-execution tool, which the selected ' +
          'model does not have on Vertex. Switch to a Gemini model, or turn code execution off.',
        meta: { alias: entry.alias },
      });
    }

    const modelInfo: ModelInfo = {
      requested: input.modelAlias,
      resolved: entry.alias,
      provider: entry.provider,
      providerModelId: entry.providerModelId!,
      ...(routing ? { routing: { rule: routing.rule, considered: routing.considered } } : {}),
      grounded,
      codeExecution,
    };

    yield {
      type: 'start',
      messageId: input.messageId,
      chatId: input.chatId,
      requestId: input.requestId,
      model: modelInfo,
    };

    // --- resolve available tools -------------------------------------------
    const runPythonEnabled = this.cfg.ENABLE_RUN_PYTHON && this.sandboxClient !== undefined;
    const skillsEnabled = this.cfg.ENABLE_SKILLS && this.skills !== undefined;
    const webEnabled = Boolean(this.cfg.ENABLE_WEB);
    const memoryEnabled = Boolean(this.cfg.ENABLE_MEMORY);
    const generativeUiEnabled = Boolean(this.cfg.ENABLE_GENERATIVE_UI);
    const toolRegistry = new ProjectToolRegistry(
      this.cfg.ENABLE_TOOL_USE,
      runPythonEnabled,
      false,
      skillsEnabled,
      webEnabled,
      memoryEnabled,
      generativeUiEnabled,
    );
    const allowPython =
      runPythonEnabled &&
      shouldExposeRunPython({
        prompt: input.prompt,
        mode: input.mode,
        hasAttachments: input.hasAttachments,
      });
    const availableTools = toolRegistry.getAvailableTools({
      userId: input.userId,
      projectId: project?.id ?? null,
      allowPython,
    });
    const activeToolNames = new Set<string>(availableTools.map((t) => t.name));

    // --- assemble context -------------------------------------------------
    const { systemInstruction, contextEvents, promptAssembly } = await this.buildSystemInstruction(
      input,
      prefs,
      project,
      availableTools,
    );
    for (const event of contextEvents) {
      yield event;
      await this.persistEvent(input.messageId, event);
    }

    const maxOutputTokens = Math.min(
      prefs.maxOutputTokens || this.cfg.DEFAULT_MAX_OUTPUT_TOKENS,
      this.cfg.MAX_OUTPUT_TOKENS_CEILING,
    );

    // --- reserve budget ---------------------------------------------------
    // The reservation is the worst case for this request; it is released as soon as the real
    // numbers land, so a large ceiling does not lock out the rest of the day.
    await this.usage.reserve(input.userId, prefs, maxOutputTokens);
    let reservationHeld = true;
    const releaseReservation = async (): Promise<void> => {
      if (!reservationHeld) return;
      reservationHeld = false;
      await this.usage.release(input.userId, prefs, maxOutputTokens).catch((err: unknown) => {
        log.error({ err, userId: input.userId }, 'failed to release budget reservation');
      });
    };

    // --- AgentLoop Routing Policy ------------------------------------------
    // AgentLoop is reserved for multi-step autonomous tasks (research mode, active goal,
    // or iterative multi-tool tasks) — simple conversational turns stay in GenerationService
    // to preserve low latency and avoid redundant tool loops.
    const shouldRouteToAgentLoop = (inp: GenerateInput): boolean => {
      if (inp.mode === 'research') return true;
      // If client requests code execution with attachments requiring iterative execution
      if (inp.codeExecution && inp.attachments.length > 0) return true;
      // Structured heuristic: multi-turn research/synthesis tasks with explicit query shape
      const p = inp.prompt.toLowerCase();
      const hasSynthesisIntent =
        (p.includes('compare') || p.includes('synthesize') || p.includes('investigate') || p.includes('deep dive')) &&
        (p.includes('across') || p.includes('sources') || p.includes('evidence') || p.includes('documents'));
      return hasSynthesisIntent;
    };

    if (this.cfg.ENABLE_AGENT_LOOP && shouldRouteToAgentLoop(input)) {
      yield* this.agentLoop.stream(input, {
        entry,
        provider,
        maxOutputTokens,
        prefs,
        project: project ? { id: project.id, instructions: project.instructions } : null,
        history,
        systemInstruction,
        startedAt,
        releaseReservation,
        grounded,
        codeExecution,
      });
      return;
    }

    const projectToolExecutor =
      availableTools.length > 0 && project !== null && this.cfg.ENABLE_TOOL_USE
        ? new ProjectToolExecutor(this.db, this.retriever, project.id, this.cfg.READ_PROJECT_FILE_MAX_CHARS)
        : undefined;

    const skillToolExecutor =
      skillsEnabled && this.skills !== undefined
        ? new SkillToolExecutor(this.skills, activeToolNames)
        : undefined;

    const pendingArtifactEvents: StreamEvent[] = [];
    const artifactToolExecutor = this.cfg.ENABLE_TOOL_USE
      ? new ArtifactToolExecutor(
          this.db,
          {
            userId: input.userId,
            projectId: project?.id ?? null,
            chatId: input.chatId,
            assistantMessageId: input.messageId,
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
        )
      : undefined;

    const uploadToolExecutor = this.cfg.ENABLE_TOOL_USE
      ? new UploadToolExecutor(this.db, this.storage, input.userId)
      : undefined;

    const webSearchAdapter = buildWebSearchAdapter(this.cfg);
    const webToolExecutor = webEnabled
      ? new WebToolExecutor(new WebSearchService(webSearchAdapter), new WebFetchService())
      : undefined;

    const memoryToolExecutor = memoryEnabled
      ? new MemoryToolExecutor(memoryService, input.userId, project?.id ?? null)
      : undefined;

    const pendingUiEvents: StreamEvent[] = [];
    const uiAuthorizer = new UIAuthorizer(this.db);
    const uiToolExecutor = generativeUiEnabled
      ? new UIToolExecutor(
          uiAuthorizer,
          { userId: input.userId, chatId: input.chatId, projectId: project?.id ?? null },
          this.cfg.UI_MAX_RESPONSE_BYTES,
          (block) => {
            pendingUiEvents.push({
              type: 'ui_block',
              block,
            });
          },
        )
      : undefined;

    const toolMap = new Map<string, ToolExecutor>();
    if (uiToolExecutor) {
      toolMap.set('render_ui', uiToolExecutor);
    }
    if (artifactToolExecutor) {
      toolMap.set('create_artifact', artifactToolExecutor);
      toolMap.set('read_artifact', artifactToolExecutor);
      toolMap.set('update_artifact', artifactToolExecutor);
    }
    if (uploadToolExecutor) {
      toolMap.set('read_uploaded_file', uploadToolExecutor);
    }
    if (webToolExecutor) {
      toolMap.set('web_search', webToolExecutor);
      toolMap.set('web_fetch', webToolExecutor);
    }
    if (memoryToolExecutor) {
      toolMap.set('search_memory', memoryToolExecutor);
      toolMap.set('read_memory', memoryToolExecutor);
      toolMap.set('update_memory', memoryToolExecutor);
      toolMap.set('forget_memory', memoryToolExecutor);
    }
    if (projectToolExecutor) {
      toolMap.set('search_project_files', projectToolExecutor);
      toolMap.set('read_project_file', projectToolExecutor);
    }
    if (allowPython) {
      toolMap.set(
        'run_python',
        new CodeExecutionToolExecutor(this.sandboxClient!, this.cfg.RUN_PYTHON_MAX_OUTPUT_CHARS),
      );
    }
    if (skillToolExecutor) {
      toolMap.set('list_skills', skillToolExecutor);
      toolMap.set('search_skills', skillToolExecutor);
      toolMap.set('read_skill', skillToolExecutor);
    }

    const toolExecutor = toolMap.size > 0 ? new DispatchingToolExecutor(toolMap) : undefined;

    const request: GenerationRequest = {
      prompt: input.prompt,
      history,
      attachments: input.attachments,
      systemInstruction,
      promptAssembly,
      mode: input.mode,
      maxOutputTokens,
      providerModelId: entry.providerModelId!,
      grounded,
      codeExecution,
      ...(availableTools.length > 0 ? { tools: availableTools } : {}),
      ...(toolExecutor ? { toolExecutor } : {}),
      signal: input.signal,
    };

    let usage: ProviderUsage = EMPTY_USAGE;
    let finishReason = 'stop';
    let status: 'complete' | 'cancelled' | 'error' = 'complete';
    let errorCode: string | null = null;
    const collectedText: string[] = [];
    const collectedSources: ProviderSource[] = [];
    let searchEntryPoint: string | undefined;
    let eventOrdinal = contextEvents.length;
    const pendingToolInputs = new Map<string, unknown>();

    try {
      const stream = this.streamWithRetry(provider.stream.bind(provider), request);

      for await (const event of stream) {
        switch (event.type) {
          case 'delta':
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

          case 'tool_use': {
            pendingToolInputs.set(event.toolCallId, event.input);
            yield { type: 'tool_use', toolCallId: event.toolCallId, name: event.name, input: event.input };
            break;
          }

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
            while (pendingUiEvents.length > 0) {
              yield pendingUiEvents.shift()!;
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
            await this.persistEvent(input.messageId, out, eventOrdinal++);
            break;
          }

          case 'completed':
            usage = event.usage;
            finishReason = event.finishReason;
            break;
        }
      }
    } catch (err) {
      if (isAbort(err) || input.signal.aborted) {
        status = 'cancelled';
      } else {
        status = 'error';
        const mapped = mapProviderError(err);
        errorCode = mapped.code;
        log.error({ err, chatId: input.chatId, requestId: input.requestId }, 'generation failed');
        await this.finalise(input, {
          text: collectedText.join(''),
          sources: collectedSources,
          searchEntryPoint,
          status: 'error',
          errorCode: mapped.code,
          finishReason: null,
          entry,
          mode: input.mode,
        });
        await releaseReservation();
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
          usage,
          startedAt,
          status: 'error',
          errorCode: mapped.code,
        });
        yield {
          type: 'error',
          code: mapped.code,
          title: mapped.title,
          detail: mapped.detail,
          usage: toUsageDto(usage, null),
        };
        return;
      }
    } finally {
      await releaseReservation();
    }

    // --- persist ----------------------------------------------------------
    const text = collectedText.join('');
    const questions = status === 'complete' ? suggestFollowUps(input.mode, collectedSources) : [];

    await this.finalise(input, {
      text,
      sources: collectedSources,
      searchEntryPoint,
      status: status === 'cancelled' ? 'stopped' : 'complete',
      errorCode,
      finishReason: status === 'cancelled' ? 'cancelled' : finishReason,
      entry,
      mode: input.mode,
      questions,
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
      usage,
      startedAt,
      status: status === 'cancelled' ? 'cancelled' : 'complete',
      finishReason: status === 'cancelled' ? 'cancelled' : finishReason,
    });

    if (status === 'complete' && this.cfg.ENABLE_MEMORY && this.cfg.ENABLE_MEMORY_BACKGROUND_DISTILL) {
      distillUserStatement({
        userId: input.userId,
        userMessage: input.prompt,
        chatId: input.chatId,
        messageId: input.messageId,
        projectId: project?.id ?? null,
      }).catch((err) => {
        log.debug({ err }, 'Background memory distillation failed');
      });
    }

    // A cancelled run has no terminal `done`: the client already knows it stopped, and
    // emitting "done" would claim a completion that did not happen.
    if (status === 'complete') {
      yield {
        type: 'done',
        questions,
        usage: toUsageDto(usage, computeCostFor(this.cfg, entry.providerModelId!, usage)),
        finishReason,
      };
    }
  }

  /* ------------------------------------------------------------------ model resolution */

  private async resolveModel(
    input: GenerateInput,
    prefs: PreferencesRow,
    requiresGrounding: boolean,
    requiresVision: boolean,
    contextChars: number,
  ): Promise<{ entry: ModelEntry; routing: RoutingDecision | null }> {
    if (input.modelAlias !== AUTO_ALIAS) {
      const status = await this.registry.status(input.modelAlias);
      if (!status) {
        throw new ApiError('model_unavailable', {
          detail: `"${input.modelAlias}" is not a known model.`,
        });
      }
      if (!status.available) {
        throw new ApiError('model_unavailable', {
          detail: status.detail,
          meta: { alias: input.modelAlias, reason: status.reason },
        });
      }
      if (requiresVision && !status.entry.supportsVision) {
        throw new ApiError('capability_unavailable', {
          detail:
            `"${input.modelAlias}" cannot see images or PDFs. Choose a different model, or ` +
            'remove the attachment.',
          meta: { alias: input.modelAlias, capability: 'vision' },
        });
      }
      return { entry: status.entry, routing: null };
    }

    const available = await this.registry.availableEntries();
    const decision = routeAuto(
      {
        mode: input.mode,
        promptChars: input.prompt.length,
        contextChars,
        hasAttachments: input.hasAttachments,
        requiresVision,
        routingPreference: normalizeTier(prefs.routingPreference),
        requiresGrounding,
      },
      this.cfg,
      available,
    );
    if (!decision) {
      throw new ApiError('no_model_available', {
        detail: requiresVision
          ? 'No configured model can see images or PDFs. Remove the attachment, or configure ' +
            'Claude or Gemini.'
          : requiresGrounding
            ? 'No configured model supports grounded search. Enable grounding or use Chat mode.'
            : 'No model in the registry is configured and reachable. Check the MODEL_* ' +
              'environment variables.',
      });
    }
    return { entry: decision.entry, routing: decision };
  }

  /* ------------------------------------------------------------------ retry */

  /**
   * Retry transient provider failures with exponential backoff.
   *
   * Only retries before the first event is yielded downstream. Once the client has seen a
   * token, a restart would duplicate text, so the failure propagates instead.
   */
  private async *streamWithRetry(
    open: (req: GenerationRequest) => AsyncGenerator<ProviderEvent>,
    request: GenerationRequest,
  ): AsyncGenerator<ProviderEvent> {
    let attempt = 0;
    for (;;) {
      let emitted = false;
      try {
        for await (const event of open(request)) {
          emitted = true;
          yield event;
        }
        return;
      } catch (err) {
        if (isAbort(err) || request.signal.aborted) throw err;
        const retryable = err instanceof ProviderError && err.retryable;
        if (emitted || !retryable || attempt >= this.cfg.PROVIDER_MAX_RETRIES) throw err;
        attempt += 1;
        // Exponential backoff with jitter, so a burst of failed requests does not retry in
        // lockstep and re-create the spike that caused the failure.
        const base = 300 * 2 ** (attempt - 1);
        const delay = base + Math.random() * base * 0.5;
        log.warn({ attempt, delay, err: String(err) }, 'retrying provider call');
        await sleep(delay, request.signal);
      }
    }
  }

  /* ------------------------------------------------------------------ context */

  private async loadPreferences(userId: string): Promise<PreferencesRow> {
    const [row] = await this.db
      .select({
        instructions: preferencesTable.instructions,
        maxOutputTokens: preferencesTable.maxOutputTokens,
        dailyTokenBudget: preferencesTable.dailyTokenBudget,
        monthlyTokenBudget: preferencesTable.monthlyTokenBudget,
        warnThresholdPct: preferencesTable.warnThresholdPct,
        routingPreference: preferencesTable.routingPreference,
        timezone: preferencesTable.timezone,
      })
      .from(preferencesTable)
      .where(eq(preferencesTable.userId, userId))
      .limit(1);
    if (!row) throw new ApiError('internal_error', { detail: 'Preferences are missing.' });
    return row;
  }

  private async loadProject(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; title: string; instructions: string } | null> {
    const [row] = await this.db
      .select({ id: projects.id, title: projects.title, instructions: projects.instructions })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.userId, userId),
          sql`${projects.deletedAt} is null`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Prior turns, oldest first, excluding the assistant row we are about to fill. */
  private async loadHistory(
    chatId: string,
    excludeMessageId: string,
    throughSeq?: number,
  ): Promise<Turn[]> {
    const conditions = [
      eq(messages.chatId, chatId),
      sql`${messages.id} <> ${excludeMessageId}`,
    ];
    if (throughSeq !== undefined && throughSeq > 0) {
      conditions.push(sql`${messages.seq} > ${throughSeq}`);
    }

    const rows = await this.db
      .select({ id: messages.id, role: messages.role, text: messages.text, seq: messages.seq })
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.seq))
      .limit(Math.min(this.cfg.HISTORY_MAX_TURNS, 12));

    const ordered = rows.reverse().filter((r) => r.text.trim() !== '');

    // Keep the newest complete context within a predictable character budget, exactly as
    // before attachments existed. A turn trimmed out here never gets its attachments fetched
    // either — there is no point spending a storage read on a turn that was already dropped.
    const budget = 24_000;
    let used = 0;
    const kept: typeof ordered = [];
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      const row = ordered[i];
      if (!row) continue;
      const cost = row.text.length;
      if (kept.length > 0 && used + cost > budget) break;
      kept.unshift(row);
      used += cost;
    }

    const attachmentRows = kept.length
      ? await this.db
          .select({
            messageId: attachments.messageId,
            mimeType: attachments.mimeType,
            storageKey: attachments.storageKey,
            sizeBytes: attachments.sizeBytes,
          })
          .from(attachments)
          .where(
            and(
              inArray(
                attachments.messageId,
                kept.map((r) => r.id),
              ),
              sql`(${attachments.mimeType} = 'application/pdf' or ${attachments.mimeType} like 'image/%')`,
            ),
          )
          .orderBy(desc(attachments.createdAt))
      : [];

    // Newest carried-forward attachment wins first claim on the byte budget; once the next one
    // wouldn't fit, everything older than it is dropped rather than skipped-and-continued past —
    // a simple, predictable "most recent that fit" rule rather than a bin-packing exercise.
    let budgetBytes = this.cfg.HISTORY_MAX_ATTACHMENT_BYTES;
    const byMessage = new Map<string, { mimeType: string; base64: string }[]>();
    for (const row of attachmentRows) {
      if (!row.messageId) continue;
      if (row.sizeBytes > budgetBytes) break;
      const data = await this.storage.get(row.storageKey);
      budgetBytes -= row.sizeBytes;
      const list = byMessage.get(row.messageId) ?? [];
      list.push({ mimeType: row.mimeType, base64: data.toString('base64') });
      byMessage.set(row.messageId, list);
    }

    // The image/PDF path above re-attaches bytes so vision keeps "seeing" a photo on a later
    // turn. This is the same idea for everything else: a plain text-extracted file's content is
    // stored once at upload time (`attachments.extractedText`, files.ts) and would otherwise
    // only ever reach the model on the turn it was uploaded — the model "forgets" it on the very
    // next message, which is not a model limitation, it is this data never being re-sent.
    const textAttachmentRows = kept.length
      ? await this.db
          .select({
            messageId: attachments.messageId,
            filename: attachments.filename,
            extractedText: attachments.extractedText,
          })
          .from(attachments)
          .where(
            and(
              inArray(
                attachments.messageId,
                kept.map((r) => r.id),
              ),
              sql`${attachments.extractedText} is not null and ${attachments.mimeType} <> 'application/pdf' and ${attachments.mimeType} not like 'image/%'`,
            ),
          )
      : [];

    const extractedByMessage = new Map<string, string>();
    for (const row of textAttachmentRows) {
      if (!row.messageId || !row.extractedText) continue;
      const capped = row.extractedText.slice(0, this.cfg.HISTORY_MAX_ATTACHMENT_TEXT_CHARS);
      const block = `--- ${row.filename} ---\n${capped}`;
      const existing = extractedByMessage.get(row.messageId);
      extractedByMessage.set(row.messageId, existing ? `${existing}\n\n${block}` : block);
    }

    return kept.map((r): Turn => {
      const extracted = extractedByMessage.get(r.id);
      return {
        role: r.role === 'user' ? 'user' : 'assistant',
        text: extracted
          ? `${r.text}\n\n[Text extracted from a file attached to this message]\n${extracted}`
          : r.text,
        ...(byMessage.has(r.id) ? { attachments: byMessage.get(r.id) } : {}),
      };
    });
  }

  private async buildSystemInstruction(
    input: GenerateInput,
    prefs: PreferencesRow,
    project: { id: string; title: string; instructions: string } | null,
    availableTools: ToolDefinition[] = [],
  ): Promise<{
    systemInstruction: string;
    contextEvents: StreamEvent[];
    promptAssembly: PromptAssembly;
  }> {
    const events: StreamEvent[] = [];

    // 1. Standing preferences (User instructions + durable standing memories)
    let standingMemories = '';
    if (this.cfg.ENABLE_MEMORY) {
      standingMemories = await memoryService.getStandingMemories(input.userId, project?.id ?? null);
    }
    const combinedStandingPrefs = [prefs.instructions.trim(), standingMemories.trim()]
      .filter(Boolean)
      .join('\n');

    // 2. Relevant persistent memories
    let relevantMemoryText = '';
    if (this.cfg.ENABLE_MEMORY) {
      const relevant = await memoryService.getRelevantMemories(
        input.userId,
        input.prompt,
        project?.id ?? null,
      );
      if (relevant.length > 0) {
        relevantMemoryText = relevant.map((r) => `- [${r.key}]: ${r.content}`).join('\n');
      }
    }

    // 3. Conversation compaction summary
    let compactionText = '';
    if (this.cfg.ENABLE_CONTEXT_COMPACTION) {
      const latestCompaction = await compactionService.getLatestCompaction(input.chatId);
      if (latestCompaction) {
        compactionText = compactionService.formatCompactionForPrompt(latestCompaction);
      }
    }

    // 4. Project search context
    let retrievedContextText: string | undefined;
    if (project) {
      const chunks = await this.retriever.search(
        this.db,
        project.id,
        input.prompt,
        this.cfg.PROJECT_CONTEXT_MAX_CHUNKS,
      );
      const context = formatContext(chunks, this.cfg.PROJECT_CONTEXT_MAX_CHARS);
      if (context) {
        retrievedContextText = context;
        const files = new Set(chunks.map((c) => c.filename));
        events.push({
          type: 'research',
          event: {
            stage: 'reading',
            label: `Retrieved ${chunks.length} excerpt${chunks.length === 1 ? '' : 's'} from project files`,
            detail: `Matched by keyword relevance in: ${[...files].join(', ')}.`,
            at: new Date().toISOString(),
          },
        });
      } else {
        const [counts] = await this.db
          .select({ total: sql<number>`count(*)::int` })
          .from(projectFiles)
          .where(and(eq(projectFiles.projectId, project.id), eq(projectFiles.status, 'ready')));
        if ((counts?.total ?? 0) > 0) {
          events.push({
            type: 'research',
            event: {
              stage: 'reading',
              label: 'No project files matched this question',
              detail: 'Project instructions are still applied.',
              at: new Date().toISOString(),
            },
          });
        }
      }
    }

    // 5. Mode directive
    const modeDirective =
      input.mode !== 'chat'
        ? 'Answer using the web search results available to you. Cite the sources you actually ' +
          'used. Do not invent citations, and say plainly when the evidence does not settle ' +
          'the question.'
        : undefined;

    // 6. Assemble prompt separating stable prefix from dynamic suffix
    const promptAssembly = assemblePrompt(availableTools, {
      runtimeCapabilities: buildDynamicRuntimeContext(this.cfg, this.capabilities),
      standingPreferences: combinedStandingPrefs || undefined,
      projectInstructions: project?.instructions?.trim() || undefined,
      relevantMemory: relevantMemoryText || undefined,
      compactionSummary: compactionText || undefined,
      retrievedContext: retrievedContextText,
      attachmentManifest: input.attachmentManifest?.trim() || undefined,
      attachmentText: input.attachmentText?.trim() || undefined,
      modePrompt: modeDirective,
    });

    return {
      systemInstruction: promptAssembly.fullSystemInstruction,
      contextEvents: events,
      promptAssembly,
    };
  }

  /* ------------------------------------------------------------------ persistence */

  private async persistEvent(
    messageId: string,
    event: StreamEvent,
    ordinal?: number,
  ): Promise<void> {
    if (event.type !== 'research') return;
    const index =
      ordinal ??
      (
        await this.db
          .select({ next: sql<number>`coalesce(max(${researchEvents.ordinal}), -1) + 1` })
          .from(researchEvents)
          .where(eq(researchEvents.messageId, messageId))
      )[0]?.next ??
      0;
    await this.db
      .insert(researchEvents)
      .values({
        messageId,
        ordinal: index,
        stage: event.event.stage,
        label: event.event.label.slice(0, 300),
        detail: event.event.detail,
        at: new Date(event.event.at),
      })
      .onConflictDoNothing();
  }

  /**
   * Persists the full bounded `ToolResult` the model actually received — not the SSE preview,
   * and never a further-truncated copy. `input` always becomes `{}` when the provider reported
   * none, so this insert can never contradict the column's `NOT NULL` constraint.
   */
  private async persistToolCall(
    messageId: string,
    toolCallId: string,
    name: string,
    input: unknown,
    result: ToolResult,
    ordinal: number,
  ): Promise<void> {
    await this.db
      .insert(toolCalls)
      .values({
        messageId,
        ordinal,
        toolCallId,
        name,
        input: input ?? {},
        content: result.content,
        ok: result.ok,
      })
      .onConflictDoNothing();
  }

  private async finalise(
    input: GenerateInput,
    result: {
      text: string;
      sources: ProviderSource[];
      searchEntryPoint: string | undefined;
      status: 'complete' | 'stopped' | 'error';
      errorCode: string | null;
      finishReason: string | null;
      entry: ModelEntry;
      mode: Mode;
      questions?: string[];
    },
  ): Promise<void> {
    const researchStage =
      result.mode === 'chat'
        ? null
        : result.status === 'error'
          ? 'error'
          : result.status === 'stopped'
            ? 'partial'
            : result.sources.length > 0
              ? 'complete'
              : 'partial';

    await this.db
      .update(messages)
      .set({
        text: result.text,
        status: result.status,
        errorCode: result.errorCode,
        researchStage,
        questions: result.questions ?? [],
        modelAlias: result.entry.alias,
        provider: result.entry.provider,
        providerModelId: result.entry.providerModelId ?? null,
        finishReason: result.finishReason,
        searchEntryPoint: result.searchEntryPoint ?? null,
        completedAt: new Date(),
      })
      .where(eq(messages.id, input.messageId));

    if (result.sources.length > 0) {
      // Replace rather than append: a retry of the same message must not double its citations.
      await this.db.delete(messageSources).where(eq(messageSources.messageId, input.messageId));
      await this.db.insert(messageSources).values(
        result.sources.map((s, i) => ({
          messageId: input.messageId,
          ordinal: i + 1,
          title: s.title.slice(0, 500),
          url: s.url,
          urlResolved: s.urlResolved,
          domain: s.domain.slice(0, 255),
          sourceType: s.sourceType,
          snippet: s.snippet,
          passage: s.passage,
          retrievedAt: s.retrievedAt,
        })),
      );
    }

    await this.db
      .update(chats)
      .set({ updatedAt: new Date() })
      .where(eq(chats.id, input.chatId));
  }
}

/* -------------------------------------------------------------------------- helpers */

function normalizeTier(value: string): 'quality' | 'balanced' | 'economy' {
  return value === 'quality' || value === 'economy' ? value : 'balanced';
}

export function toSourceDto(source: ProviderSource, id: number): SourceDto {
  return {
    id,
    title: source.title,
    url: source.url,
    urlResolved: source.urlResolved,
    domain: source.domain,
    type: source.sourceType,
    snippet: source.snippet,
    passage: source.passage,
    retrievedAt: source.retrievedAt.toISOString(),
  };
}

export function computeCostFor(cfg: Config, providerModelId: string, usage: ProviderUsage): number | null {
  const row = cfg.PRICING_TABLE[providerModelId];
  if (!row || !usage.exact) return null;
  const cost =
    (usage.inputTokens * row.input +
      usage.outputTokens * row.output +
      usage.cacheReadTokens * row.cacheRead +
      usage.cacheWriteTokens * row.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export function mapProviderError(err: unknown): { code: string; title: string; detail: string } {
  if (err instanceof ModelNotFoundError) {
    return {
      code: 'model_unavailable',
      title: 'This model is unavailable',
      detail:
        `The model "${err.modelId}" was not found in "${err.location}". It may not be ` +
        'enabled for this project, or the configured region may not serve it.',
    };
  }
  if (err instanceof ProviderError) {
    const api = new ApiError(err.code);
    return { code: err.code, title: api.title, detail: api.detail };
  }
  if (err instanceof ApiError) {
    return { code: err.code, title: err.title, detail: err.detail };
  }
  const api = new ApiError('provider_error');
  return { code: api.code, title: api.title, detail: api.detail };
}

/**
 * Follow-up suggestions.
 *
 * Deliberately generic and derived from what the turn actually produced. Asking the model for
 * suggestions would double the cost of every reply; inventing topic-specific ones without
 * reading the answer would be theatre.
 */
function suggestFollowUps(mode: Mode, sources: ProviderSource[]): string[] {
  if (mode === 'chat') return [];
  if (sources.length === 0) return [];
  const domains = [...new Set(sources.map((s) => s.domain).filter(Boolean))].slice(0, 2);
  const out = ['What does the strongest evidence here actually establish?'];
  if (domains.length > 0) out.push(`Summarise what ${domains.join(' and ')} say on this.`);
  out.push('What would change this conclusion?');
  return out;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export { asc };
