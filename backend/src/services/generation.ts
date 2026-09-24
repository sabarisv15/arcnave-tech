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
import { getModelCapability } from '../providers/capabilitiesTable.js';
import type {
  AttachmentBlock,
  AttachmentRef,
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
import { DeliverableToolExecutor } from '../tools/deliverableExecutor.js';
import { FileOperationExecutor } from '../tools/fileOperationExecutor.js';
import { FILE_OPERATION_TOOL_DEFINITIONS } from '../tools/definitions.js';
import { ImageGenerationExecutor } from '../tools/imageGenerationExecutor.js';
import { ProjectToolExecutor } from '../tools/executor.js';
import { ProjectToolRegistry } from '../tools/registry.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';
import { shouldExposeGenerateDeliverable } from '../tools/capabilityPolicy.js';
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
import { toAttachmentRef } from './attachments/attachmentRef.js';
import { MemoryToolExecutor } from '../tools/memoryExecutor.js';
import { UIToolExecutor } from '../tools/uiExecutor.js';
import { UIAuthorizer } from './ui/authorizer.js';
import type { UIBlock } from './ui/types.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import type { SandboxClient } from '../tools/sandbox/client.js';
import type { SkillDetail, SkillService } from './skills.js';
import type { ObjectStorage } from './storage.js';
import type { Retriever } from './retrieval.js';
import { formatContext } from './retrieval.js';
import type { UsageService } from './usage.js';
import { shouldExposeRunPython } from '../tools/capabilityPolicy.js';
import { routeTurn, type RuntimeDebugTrace } from './routing/turnRouter.js';

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
  | { type: 'debug'; trace: RuntimeDebugTrace }
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

/** Attachments the providers receive as raw bytes rather than as extracted text. */
function sentAsBytes(att: { mimeType: string }): boolean {
  return (
    att.mimeType === 'application/pdf' ||
    att.mimeType.startsWith('image/') ||
    att.mimeType.startsWith('audio/') ||
    att.mimeType.startsWith('video/')
  );
}

/** What AgentLoop receives: the turn with its attachments already hydrated for the provider. */
export type AgentLoopInput = Omit<GenerateInput, 'attachments'> & { attachments: AttachmentBlock[] };

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
  attachmentManifest?: string;
  /** This turn's attachments, normalised once by `toAttachmentRef`. */
  attachments: AttachmentRef[];
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
  private readonly executionRuntime: ExecutionRuntime;

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
    executionRuntime?: ExecutionRuntime,
  ) {
    this.capabilities = capabilities ?? buildCapabilityRegistry(cfg);
    this.executionRuntime = executionRuntime ?? new ExecutionRuntime(sandboxClient);
    this.agentLoop =
      agentLoop ??
      new AgentLoop(db, cfg, registry, usage, retriever, storage, sandboxClient, skills, this.executionRuntime);
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
    const runId = `${input.chatId}_${input.messageId}`;
    const workspace = await this.executionRuntime.createWorkspace(runId);

    try {
      // Attachments are not copied into the workspace up front. A tool that needs one names its
      // fileId and the runtime materialises exactly that file (G26, G15): current and historical
      // attachments take the same path, and nothing is downloaded for turns that never use it.
      const prefs = await this.loadPreferences(input.userId);

    const project = input.projectId ? await this.loadProject(input.userId, input.projectId) : null;
    const latestCompaction = this.cfg.ENABLE_CONTEXT_COMPACTION
      ? await compactionService.getLatestCompaction(input.chatId)
      : null;
    // Loaded before model resolution (not its historical position) because whether this turn
    // needs a vision-capable model depends on what's carried forward, not only on what's newly
    // attached — and loadHistory has no dependency on which model gets picked.
    const { turns: history, currentUserAttachments } = await this.loadHistory(
      input.chatId,
      input.messageId,
      latestCompaction?.throughSeq,
      input.modelAlias,
    );
    if (input.attachments.length === 0 && currentUserAttachments.length > 0) {
      input = { ...input, attachments: currentUserAttachments, hasAttachments: true };
    }

    // --- resolve the model ------------------------------------------------
    const requiresGrounding = input.mode !== 'chat';
    const requiresVision =
      (input.attachments?.length ?? 0) > 0 || history.some((t) => (t.attachments?.length ?? 0) > 0);
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

    // --- Skill-First -> Tool-Second Routing --------------------------------
    // G6: a file attached on an earlier turn is still available on this one.
    const historyAttachments = history.flatMap((t) => t.attachments ?? []);
    const attachmentNames: string[] = [...input.attachments, ...historyAttachments]
      .map((a) => a.filename)
      .filter((name): name is string => Boolean(name));

    const skillsEnabled = this.cfg.ENABLE_SKILLS && this.skills !== undefined;
    const candidateSkillSummaries = skillsEnabled ? this.skills!.listSkills() : [];
    const routingDecision = routeTurn({
      prompt: input.prompt,
      mode: input.mode,
      hasAttachments: input.hasAttachments || historyAttachments.length > 0,
      attachmentMimeTypes: [...input.attachments, ...historyAttachments].map((a) => a.mimeType),
      attachmentNames,
      candidateSkills: candidateSkillSummaries,
      hasProject: project !== null,
      imageEnabled: Boolean(this.cfg.ENABLE_IMAGE_GENERATION),
      runPythonEnabled: this.cfg.ENABLE_RUN_PYTHON && this.sandboxClient !== undefined,
      generativeUiEnabled: Boolean(this.cfg.ENABLE_GENERATIVE_UI),
      webEnabled: Boolean(this.cfg.ENABLE_WEB),
      memoryEnabled: Boolean(this.cfg.ENABLE_MEMORY),
    });

    // Progressive Skill Disclosure:
    // AI Model evaluates task first with lightweight skill metadata in context.
    // If the model determines a domain skill is relevant, it invokes `load_skill` to disclose full instructions.
    let skillsContext: string | undefined;
    const loadedSkills: SkillDetail[] = [];
    if (this.skills) {
      const availableSkills = this.skills.listSkills();
      const parts: string[] = [];

      if (availableSkills.length > 0) {
        const skillList = availableSkills
          .map((s) => `- ${s.name}: ${s.description}`)
          .join('\n');
        parts.push(
          `<available_skills>\n${skillList}\n</available_skills>\n` +
            'To use any of the above domain skills, invoke `load_skill({ name: "<skill_name>" })` to retrieve detailed instructions, templates, and domain rules before selecting execution tools.',
        );
      }

      // If skills were pre-selected by routing or autoloaded, include their full instructions
      for (const skillName of routingDecision.selectedSkills) {
        const detail = this.skills.getSkill(skillName);
        if (detail && !loadedSkills.some((s) => s.name === detail.name)) {
          loadedSkills.push(detail);
        }
      }
      if (loadedSkills.length > 0) {
        parts.push(
          loadedSkills.map((s) => `### Loaded Skill: ${s.name}\n\n${s.content}`).join('\n\n---\n\n'),
        );
      }

      if (parts.length > 0) {
        skillsContext = parts.join('\n\n');
      }
    }

    // --- resolve available tools -------------------------------------------
    const runPythonEnabled = this.cfg.ENABLE_RUN_PYTHON && this.sandboxClient !== undefined;
    const webEnabled = Boolean(this.cfg.ENABLE_WEB);
    const memoryEnabled = Boolean(this.cfg.ENABLE_MEMORY);
    const generativeUiEnabled = Boolean(this.cfg.ENABLE_GENERATIVE_UI);
    const imageEnabled = Boolean(this.cfg.ENABLE_IMAGE_GENERATION);
    const toolRegistry = new ProjectToolRegistry(
      this.cfg.ENABLE_TOOL_USE,
      runPythonEnabled,
      false,
      skillsEnabled,
      webEnabled,
      memoryEnabled,
      generativeUiEnabled,
      imageEnabled,
    );
    // ADR-0006: permission alone decides. `pythonExposed` is telemetry and gates nothing.
    const allowPython = routingDecision.allowedTools.includes('run_python');
    const allowDeliverable = routingDecision.allowedTools.includes('generate_deliverable');
    const toolContext = {
      userId: input.userId,
      projectId: project?.id ?? null,
      allowPython,
      allowDeliverable,
    };
    // Policy-approved tool catalog for deferred tool discovery
    const policyCatalog = (
      toolRegistry.getPolicyCatalog
        ? toolRegistry.getPolicyCatalog(toolContext)
        : toolRegistry.getAvailableTools(toolContext)
    ).filter((t) => routingDecision.allowedTools.includes(t.name));

    // Initial active tools: small core set sent in Round 0 (search_tools, load_skill if skills enabled)
    const initialTools = toolRegistry.getInitialTools
      ? toolRegistry.getInitialTools(toolContext)
      : [];

    const availableTools = initialTools.filter((t) => routingDecision.exposedTools.includes(t.name));
    const activeToolNames = new Set<string>(availableTools.map((t) => t.name));

    // Never advertise skills the model has no way to load (Invariant 1). This holds when tool use
    // is off: the registry then sends no tools at all, `load_skill` included.
    if (!activeToolNames.has('load_skill')) {
      skillsContext = undefined;
    }

    const isAgentMode =
      Boolean(this.cfg.ENABLE_AGENT_LOOP) &&
      (input.mode === 'research' ||
        Boolean(routingDecision.pythonExposed && input.codeExecution && input.attachments.length > 0) ||
        Boolean(
          (input.prompt.toLowerCase().includes('compare') ||
            input.prompt.toLowerCase().includes('synthesize') ||
            input.prompt.toLowerCase().includes('investigate') ||
            input.prompt.toLowerCase().includes('deep dive')) &&
            (input.prompt.toLowerCase().includes('across') ||
              input.prompt.toLowerCase().includes('sources') ||
              input.prompt.toLowerCase().includes('evidence') ||
              input.prompt.toLowerCase().includes('documents')),
        ));

    // --- assemble context -------------------------------------------------
    const { systemInstruction, contextEvents, promptAssembly } = await this.buildSystemInstruction(
      input,
      prefs,
      project,
      availableTools,
      skillsContext,
      isAgentMode,
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
      if (routingDecision.pythonExposed && inp.codeExecution && inp.attachments.length > 0) return true;
      // Structured heuristic: multi-turn research/synthesis tasks with explicit query shape
      const p = inp.prompt.toLowerCase();
      const hasSynthesisIntent =
        (p.includes('compare') || p.includes('synthesize') || p.includes('investigate') || p.includes('deep dive')) &&
        (p.includes('across') || p.includes('sources') || p.includes('evidence') || p.includes('documents'));
      return hasSynthesisIntent;
    };

    if (this.cfg.ENABLE_AGENT_LOOP && shouldRouteToAgentLoop(input)) {
      const wireHistory = await this.hydrateHistoryAttachments(history, input.prompt);
      const wireAttachments = await this.hydrateAttachmentBytes(input.attachments);

      const allAttachmentsMap = new Map<string, AttachmentBlock>();
      for (const h of wireHistory) {
        if (h.attachments) {
          for (const att of h.attachments) {
            if (att.id) allAttachmentsMap.set(att.id, att);
          }
        }
      }
      for (const att of wireAttachments) {
        if (att.id) allAttachmentsMap.set(att.id, att);
      }

      const availableAttachments = Array.from(allAttachmentsMap.values());
      let attachmentManifestBlock = '';
      if (availableAttachments.length > 0) {
        const lines = availableAttachments.map(
          (a) =>
            `- fileId: "${a.id}" | filename: "${a.filename}" | type: ${a.mimeType} | size: ${a.sizeBytes ?? 0} bytes`,
        );
        attachmentManifestBlock = `<available_attachments>\nAvailable conversation attachments:\n${lines.join('\n')}\n\nUse fileId when filenames are ambiguous.\n</available_attachments>`;
      }

      const promptWithManifest = attachmentManifestBlock
        ? `${attachmentManifestBlock}\n\n${input.prompt}`
        : input.prompt;

      yield* this.agentLoop.stream(
        { ...input, prompt: promptWithManifest, attachments: wireAttachments },
        {
          entry,
          provider,
          maxOutputTokens,
          prefs,
          project: project ? { id: project.id, instructions: project.instructions } : null,
          history: wireHistory,
          systemInstruction,
          startedAt,
          releaseReservation,
          grounded,
          codeExecution,
          workspace,
        },
      );
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
        new CodeExecutionToolExecutor(
          this.executionRuntime,
          this.cfg.RUN_PYTHON_MAX_OUTPUT_CHARS,
          {
            workspace,
            userId: input.userId,
            messageId: input.messageId,
            db: this.db,
            storage: this.storage,
          },
        ),
      );
    }
    if (skillToolExecutor) {
      toolMap.set('load_skill', skillToolExecutor);
      toolMap.set('list_skills', skillToolExecutor);
      toolMap.set('search_skills', skillToolExecutor);
      toolMap.set('read_skill', skillToolExecutor);
    }
    if (imageEnabled) {
      toolMap.set(
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
      toolMap.set(
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

    if (this.cfg.ENABLE_TOOL_USE) {
      const fileOperationExecutor = new FileOperationExecutor({
        db: this.db,
        storage: this.storage,
        executionRuntime: this.executionRuntime,
        userId: input.userId,
        chatId: input.chatId,
        messageId: input.messageId,
        workspace,
      });
      for (const def of FILE_OPERATION_TOOL_DEFINITIONS) {
        toolMap.set(def.name, fileOperationExecutor);
      }

      const searchToolsExecutor = new SearchToolsExecutor(policyCatalog, (discoveredTool) => {
        if (!availableTools.some((t) => t.name === discoveredTool.name)) {
          availableTools.push(discoveredTool);
          activeToolNames.add(discoveredTool.name);
        }
      });
      toolMap.set('search_tools', searchToolsExecutor);
    }

    const toolExecutor = toolMap.size > 0 ? new DispatchingToolExecutor(toolMap) : undefined;

    const wireAttachments = await this.hydrateAttachmentBytes(input.attachments);
    const wireHistory = await this.hydrateHistoryAttachments(history, input.prompt);

    const allAttachmentsMap = new Map<string, AttachmentBlock>();
    for (const h of wireHistory) {
      if (h.attachments) {
        for (const att of h.attachments) {
          if (att.id) allAttachmentsMap.set(att.id, att);
        }
      }
    }
    for (const att of wireAttachments) {
      if (att.id) allAttachmentsMap.set(att.id, att);
    }

    const availableAttachments = Array.from(allAttachmentsMap.values());
    let attachmentManifestBlock = '';
    if (availableAttachments.length > 0) {
      const lines = availableAttachments.map(
        (a) =>
          `- fileId: "${a.id}" | filename: "${a.filename}" | type: ${a.mimeType} | size: ${a.sizeBytes ?? 0} bytes`,
      );
      attachmentManifestBlock = `<available_attachments>\nAvailable conversation attachments:\n${lines.join('\n')}\n\nUse fileId when filenames are ambiguous.\n</available_attachments>`;
    }

    const promptParts: string[] = [];
    if (attachmentManifestBlock) promptParts.push(attachmentManifestBlock);
    promptParts.push(input.prompt);
    const effectivePrompt = promptParts.join('\n\n');

    const request: GenerationRequest = {
      prompt: effectivePrompt,
      history: wireHistory,
      attachments: wireAttachments,
      systemInstruction,
      promptAssembly,
      mode: input.mode,
      maxOutputTokens,
      providerModelId: entry.providerModelId!,
      grounded,
      codeExecution: Boolean(input.codeExecution),
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
    const toolsCalled: string[] = [];

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
            toolsCalled.push(event.name);
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
    let text = collectedText.join('');

    // Guaranteed Final Outcome: synthesize text if tool loop finished blank
    if (status === 'complete' && text.trim().length === 0) {
      try {
        const synthesisRequest: GenerationRequest = {
          ...request,
          tools: [],
          toolExecutor: undefined,
          prompt: `${input.prompt}\n\n[System Instruction: Synthesize a complete final answer based on the previous tool results above. Do not call any further tools.]`,
        };
        const synthesisStream = provider.stream(synthesisRequest);
        for await (const event of synthesisStream) {
          if (event.type === 'delta' && event.text) {
            collectedText.push(event.text);
            yield { type: 'delta', text: event.text };
          } else if (event.type === 'completed') {
            usage = event.usage;
            finishReason = event.finishReason;
          }
        }
        text = collectedText.join('');
      } catch (synthErr) {
        log.warn({ err: synthErr }, 'Forced synthesis round failed');
      }

      if (text.trim().length === 0) {
        status = 'error';
        errorCode = 'empty_response';
        const emptyApi = new ApiError('empty_response');
        yield {
          type: 'error',
          code: emptyApi.code,
          title: emptyApi.title,
          detail: emptyApi.detail,
          usage: toUsageDto(usage, null),
        };
      }
    }

    const questions = status === 'complete' ? suggestFollowUps(input.mode, collectedSources) : [];

    await this.finalise(input, {
      text,
      sources: collectedSources,
      searchEntryPoint,
      status: status === 'cancelled' ? 'stopped' : status === 'error' ? 'error' : 'complete',
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
      status: status === 'cancelled' ? 'cancelled' : status === 'error' ? 'error' : 'complete',
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
      const debugTrace: RuntimeDebugTrace = {
        detectedIntent: routingDecision.detectedIntent,
        candidateSkills: routingDecision.candidateSkills,
        selectedSkills: routingDecision.selectedSkills,
        loadedSkills: loadedSkills.map((s) => s.name),
        allowedTools: routingDecision.allowedTools,
        exposedTools: availableTools.map((t) => t.name),
        toolsCalled,
        pythonExposed: routingDecision.pythonExposed,
      };
      log.info({ debugTrace }, 'Runtime debug trace');
      yield { type: 'debug', trace: debugTrace };

      yield {
        type: 'done',
        questions,
        usage: toUsageDto(usage, computeCostFor(this.cfg, entry.providerModelId!, usage)),
        finishReason,
      };
    }
    } finally {
      await this.executionRuntime.cleanupWorkspace(workspace);
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
      if (status && status.available) {
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
      log.info(
        { requested: input.modelAlias },
        'Requested model is disabled or unavailable; falling back to active Gemini 3.8 Flash via Auto',
      );
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
    let overflowRetried = false;
    let currentRequest = request;
    const ttftBudgetMs =
      request.mode === 'research' ? 20_000 : request.mode === 'search' ? 15_000 : 12_000;

    for (;;) {
      let firstEventReceived = false;
      let userVisibleOutputEmitted = false;
      const ttftController = new AbortController();
      const onParentAbort = () => ttftController.abort();
      currentRequest.signal.addEventListener('abort', onParentAbort, { once: true });

      const ttftTimer = setTimeout(() => {
        if (!firstEventReceived && !ttftController.signal.aborted) {
          ttftController.abort(
            new ProviderError(`First token wait exceeded ${ttftBudgetMs}ms`, {
              code: 'provider_timeout',
              retryable: true,
            }),
          );
        }
      }, ttftBudgetMs);

      try {
        const attemptRequest: GenerationRequest = {
          ...currentRequest,
          signal: ttftController.signal,
        };
        for await (const event of open(attemptRequest)) {
          if (!firstEventReceived) {
            firstEventReceived = true;
            clearTimeout(ttftTimer);
          }
          if (
            (event.type === 'delta' && event.text.length > 0) ||
            (event.type === 'code' && Boolean(event.code || event.output))
          ) {
            userVisibleOutputEmitted = true;
          }
          yield event;
        }
        return;
      } catch (err) {
        clearTimeout(ttftTimer);
        if (isAbort(err) || currentRequest.signal.aborted) throw err;

        // Context Overflow Recovery with Streaming Safety Rule:
        // Retry is allowed strictly if no user-visible assistant output has been committed/emitted (userVisibleOutputEmitted === false).
        // If partial output was emitted, do not silently restart and duplicate content.
        if (!userVisibleOutputEmitted && isContextOverflowError(err)) {
          if (!overflowRetried) {
            overflowRetried = true;
            log.warn(
              { err: String(err) },
              'provider context overflow detected; attempting single bounded history reduction retry',
            );

            const reducedHistory = this.reduceHistoryForOverflow(currentRequest.history);
            const hasHydratedHistorical = currentRequest.history.some((t) =>
              t.attachments?.some((a) => Boolean(a.base64)),
            );

            if (reducedHistory.length < currentRequest.history.length || hasHydratedHistorical) {
              currentRequest = {
                ...currentRequest,
                history: reducedHistory,
              };
              continue;
            }
          }
          throw new ProviderError(
            'Conversation exceeded usable model context and could not be recovered after trimming',
            { code: 'context_overflow', retryable: false },
          );
        }

        if (isContextOverflowError(err)) {
          throw new ProviderError(
            'Conversation exceeded usable model context and could not be recovered after trimming',
            { code: 'context_overflow', retryable: false },
          );
        }

        const retryable = err instanceof ProviderError && err.retryable;
        if (userVisibleOutputEmitted || !retryable || attempt >= this.cfg.PROVIDER_MAX_RETRIES) throw err;
        attempt += 1;
        // Exponential backoff with jitter, so a burst of failed requests does not retry in
        // lockstep and re-create the spike that caused the failure.
        const base = 300 * 2 ** (attempt - 1);
        const delay = base + Math.random() * base * 0.5;
        log.warn({ attempt, delay, err: String(err) }, 'retrying provider call');
        await sleep(delay, currentRequest.signal);
      } finally {
        clearTimeout(ttftTimer);
        currentRequest.signal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  private reduceHistoryForOverflow(history: Turn[]): Turn[] {
    return reduceHistoryForOverflow(history);
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
  /**
   * Prior turns only. The current user message (the row just before this assistant row) is the
   * turn being answered: its prompt and attachments reach the provider as the current turn, so
   * it must not also appear in history. It used to, which sent every prompt and every current
   * attachment twice (G27).
   */
  private async loadHistory(
    chatId: string,
    excludeMessageId: string,
    throughSeq?: number,
    modelAlias?: string,
  ): Promise<{ turns: Turn[]; currentUserAttachments: AttachmentRef[] }> {
    const [self] = await this.db
      .select({ seq: messages.seq })
      .from(messages)
      .where(eq(messages.id, excludeMessageId))
      .limit(1);
    const currentUserSeq = self ? self.seq - 1 : undefined;

    const conditions = [
      eq(messages.chatId, chatId),
      sql`${messages.id} <> ${excludeMessageId}`,
    ];
    if (currentUserSeq !== undefined) {
      conditions.push(sql`${messages.seq} < ${currentUserSeq}`);
    }
    if (throughSeq !== undefined && throughSeq > 0) {
      conditions.push(sql`${messages.seq} > ${throughSeq}`);
    }

    const rows = await this.db
      .select({ id: messages.id, role: messages.role, text: messages.text, seq: messages.seq })
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.seq))
      .limit(Math.min(this.cfg.HISTORY_MAX_TURNS, 20));

    const ordered = rows
      .reverse()
      .map((r) => {
        if (r.role === 'assistant' && r.text.trim() === '') {
          return { ...r, text: '[Response stopped]' };
        }
        return r;
      })
      .filter((r) => r.text.trim() !== '');

    // Dynamic provider/model-aware context budget calculation:
    // available budget = model context window - output reserve (4k tokens) - system/tools reserve (8k tokens)
    const capability = getModelCapability(modelAlias ?? 'Gemini 3.8 Flash');
    const contextLimitTokens =
      capability.maxInputTokens ?? capability.contextWindowTokens ?? 128_000;
    const availableHistoryTokens = Math.max(16_000, contextLimitTokens - 12_288);
    const budget = availableHistoryTokens * 4; // ~4 characters per token average

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

    // Load attachments for all kept messages.
    // Base64 bytes are NOT loaded into history to avoid consuming RAM; only metadata and storageKey
    // are retained. Bytes are fetched on demand when constructing the wire payload.
    const attachmentRows = kept.length
      ? await this.db
          .select({
            id: attachments.id,
            messageId: attachments.messageId,
            filename: attachments.filename,
            mimeType: attachments.mimeType,
            storageKey: attachments.storageKey,
            sizeBytes: attachments.sizeBytes,
            status: attachments.status,
            extractedText: attachments.extractedText,
          })
          .from(attachments)
          .where(
            and(
              inArray(
                attachments.messageId,
                kept.map((r) => r.id),
              ),
              eq(attachments.status, 'ready'),
            ),
          )
          .orderBy(desc(attachments.createdAt))
      : [];

    const byMessage = new Map<string, AttachmentBlock[]>();
    for (const row of attachmentRows) {
      if (!row.messageId) continue;
      const list = byMessage.get(row.messageId) ?? [];
      list.push(toAttachmentRef(row));
      byMessage.set(row.messageId, list);
    }

    const turns = kept.map((r): Turn => {
      const atts = byMessage.get(r.id);
      // Extracted text travels once, on the attachment itself; the adapters render it (G16).
      return {
        role: r.role === 'user' ? 'user' : 'assistant',
        text: r.text,
        ...(atts ? { attachments: atts } : {}),
      };
    });

    // The current user message's own attachments. A retry may not resend attachmentIds, and
    // until G27 those files only reached the provider through the duplicated history copy.
    const currentUserAttachments =
      currentUserSeq === undefined
        ? []
        : (
            await this.db
              .select({
                id: attachments.id,
                filename: attachments.filename,
                mimeType: attachments.mimeType,
                storageKey: attachments.storageKey,
                sizeBytes: attachments.sizeBytes,
                extractedText: attachments.extractedText,
              })
              .from(attachments)
              .innerJoin(messages, eq(attachments.messageId, messages.id))
              .where(
                and(
                  eq(messages.chatId, chatId),
                  eq(messages.seq, currentUserSeq),
                  eq(messages.role, 'user'),
                  eq(attachments.status, 'ready'),
                ),
              )
              .orderBy(attachments.createdAt)
          ).map(toAttachmentRef);

    return { turns, currentUserAttachments };
  }

  /**
   * Hydrates raw storage bytes into base64 on-demand for binary attachments (PDF, images, media)
   * specifically for the ephemeral wire request sent to the provider.
   * Keeps conversation history in RAM free of large Base64 strings.
   */
  private async hydrateAttachmentBytes(
    attachments: AttachmentBlock[] | undefined,
  ): Promise<AttachmentBlock[]> {
    if (!attachments || attachments.length === 0) return [];
    return Promise.all(
      attachments.map(async (att) => {
        if (sentAsBytes(att) && !att.base64 && att.storageKey) {
          try {
            const data = await this.storage.get(att.storageKey);
            return { ...att, base64: data.toString('base64') };
          } catch (err) {
            log.warn({ err, storageKey: att.storageKey }, 'failed to load attachment bytes for wire payload');
            return { ...att, omittedReason: 'storage_unavailable' as const };
          }
        }
        return att;
      }),
    );
  }

  /**
   * Hydrates attachment bytes across history turns for provider wire transmission.
   * Enforces HISTORY_MAX_ATTACHMENT_BYTES (12 MB) budget.
   * If budget is exceeded, historical identity and extracted text survive, but binary base64 is omitted.
   * Explicitly referenced attachments (by fileId or unique filename) are promoted for hydration.
   */
  private async hydrateHistoryAttachments(
    turns: Turn[],
    currentPrompt?: string,
  ): Promise<Turn[]> {
    const maxBudget = this.cfg.HISTORY_MAX_ATTACHMENT_BYTES ?? 12_000_000;
    let cumulativeBytes = 0;

    // Only files sent as bytes spend the budget; Office and text files travel as extracted text.
    const allHistoricalAtts = turns.flatMap((t) => t.attachments ?? []).filter(sentAsBytes);

    // Check for explicit promotions from currentPrompt
    const promotedAttachmentIds = new Set<string>();
    if (currentPrompt?.trim()) {
      for (const att of allHistoricalAtts) {
        if (!att.id) continue;
        // Exact fileId match
        if (currentPrompt.includes(att.id)) {
          promotedAttachmentIds.add(att.id);
        } else if (att.filename && currentPrompt.includes(att.filename)) {
          // Check if filename is unique across historical attachments
          const matching = allHistoricalAtts.filter((a) => a.filename === att.filename);
          if (matching.length === 1) {
            promotedAttachmentIds.add(att.id);
          }
          // If matching.length > 1, duplicate filename: do not auto-promote! Model must specify fileId.
        }
      }
    }

    const hydrationDecisions = new Map<string, boolean>();

    // Pass 1: Promoted attachments always hydrated first
    for (const att of allHistoricalAtts) {
      if (att.id && promotedAttachmentIds.has(att.id)) {
        const size = att.sizeBytes ?? 0;
        if (cumulativeBytes + size <= maxBudget) {
          cumulativeBytes += size;
          hydrationDecisions.set(att.id, true);
        }
      }
    }

    // Pass 2: Remaining attachments from most recent turn to oldest
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (!turn?.attachments) continue;
      for (const att of turn.attachments) {
        if (!sentAsBytes(att) || !att.id || hydrationDecisions.has(att.id)) continue;
        const size = att.sizeBytes ?? 0;
        if (cumulativeBytes + size <= maxBudget) {
          cumulativeBytes += size;
          hydrationDecisions.set(att.id, true);
        } else {
          hydrationDecisions.set(att.id, false);
        }
      }
    }

    return Promise.all(
      turns.map(async (turn) => {
        if (!turn.attachments || turn.attachments.length === 0) return turn;
        const hydrated = await Promise.all(
          turn.attachments.map(async (att) => {
            if (!sentAsBytes(att)) return att;
            const shouldHydrateBinary = att.id ? hydrationDecisions.get(att.id) ?? false : true;
            if (shouldHydrateBinary) {
              const [h] = await this.hydrateAttachmentBytes([att]);
              return h ?? att;
            }
            // Over budget: keep full identity and any genuine extracted text, never the bytes.
            // The adapter tells the model why and how to rehydrate it by fileId (G15).
            return {
              id: att.id,
              filename: att.filename,
              mimeType: att.mimeType,
              sizeBytes: att.sizeBytes,
              storageKey: att.storageKey,
              extractedText: att.extractedText,
              omittedReason: 'history_budget' as const,
            };
          }),
        );
        return { ...turn, attachments: hydrated };
      }),
    );
  }

  private async buildSystemInstruction(
    input: GenerateInput,
    prefs: PreferencesRow,
    project: { id: string; title: string; instructions: string } | null,
    availableTools: ToolDefinition[] = [],
    skillsContext?: string,
    isAgentMode: boolean = false,
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
      input.mode === 'research'
        ? 'Conduct deep, rigorous research using web search and web fetch. Answer with a comprehensive, well-structured research report complete with citations directly in the chat text stream. Do NOT call create_artifact unless the user explicitly commanded creating an artifact or saving to an artifact. If live web research fails or search providers are unavailable, state plainly: "Live web research could not be completed at this time due to search provider unavailability."'
        : input.mode === 'search'
          ? 'Answer using the web search results available to you. Cite the sources you actually ' +
            'used. Do not invent citations, and say plainly when the evidence does not settle ' +
            'the question.'
          : undefined;

    // 6. Assemble prompt separating stable prefix from dynamic suffix
    const promptAssembly = assemblePrompt(availableTools, {
      runtimeCapabilities: buildDynamicRuntimeContext(this.cfg, this.capabilities, isAgentMode),
      standingPreferences: combinedStandingPrefs || undefined,
      projectInstructions: project?.instructions?.trim() || undefined,
      relevantMemory: relevantMemoryText || undefined,
      compactionSummary: compactionText || undefined,
      retrievedContext: retrievedContextText,
      attachmentManifest: input.attachmentManifest?.trim() || undefined,
      modePrompt: modeDirective,
      skillsContext,
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

export function reduceHistoryForOverflow(history: Turn[]): Turn[] {
  if (history.length === 0) return [];
  // Drop oldest half of completed history turns, keeping at least the most recent turn
  const keepCount = Math.max(1, Math.floor(history.length / 2));
  let slice = history.slice(history.length - keepCount);

  // API safety: history must start with a user turn
  while (slice.length > 1 && slice[0]!.role !== 'user') {
    slice.shift();
  }

  // Dehydrate any remaining historical binary attachments in the kept turns (preserve text and metadata)
  return slice.map((turn) => {
    if (!turn.attachments || turn.attachments.length === 0) return turn;
    return {
      ...turn,
      attachments: turn.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        storageKey: a.storageKey,
        extractedText: a.extractedText,
      })),
    };
  });
}

export function isContextOverflowError(err: unknown): boolean {
  if (err instanceof ProviderError && err.code === 'context_overflow') return true;
  const str = String(err).toLowerCase();
  return (
    str.includes('input token count exceeds the maximum') ||
    str.includes('token count exceeds') ||
    str.includes('prompt is too long') ||
    str.includes('maximum context length') ||
    str.includes('context_length_exceeded') ||
    str.includes('exceeds the context window')
  );
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
  if (err instanceof ApiError) {
    return { code: err.code, title: err.title, detail: err.detail };
  }
  if (err instanceof ProviderError) {
    const rawMessage = err.message || '';
    if (
      err.code === 'context_overflow' ||
      rawMessage.includes('input token count exceeds the maximum') ||
      rawMessage.includes('token count exceeds') ||
      rawMessage.includes('prompt is too long') ||
      rawMessage.includes('exceeds the maximum context length') ||
      rawMessage.includes('context_length_exceeded')
    ) {
      const api = new ApiError('context_overflow');
      return { code: api.code, title: api.title, detail: api.detail };
    }
    if (
      rawMessage.includes('image exceeds 5 MB maximum') ||
      rawMessage.includes('exceeds 5 MB') ||
      rawMessage.includes('image exceeds') ||
      rawMessage.includes('request payload size exceeds')
    ) {
      const api = new ApiError('provider_payload_limit');
      return {
        code: 'provider_payload_limit',
        title: 'Image exceeds provider 5 MB limit',
        detail:
          'This image exceeds the provider base64 limit (5 MB on Anthropic Claude). ' +
          'Upload a smaller image or select Gemini 3.8 Flash, which supports larger files.',
      };
    }
    const api = new ApiError(err.code);
    return { code: err.code, title: api.title, detail: api.detail };
  }
  const errStr = String(err);
  if (
    errStr.includes('input token count exceeds the maximum') ||
    errStr.includes('token count exceeds') ||
    errStr.includes('prompt is too long') ||
    errStr.includes('exceeds the maximum context length') ||
    errStr.includes('context_length_exceeded')
  ) {
    const api = new ApiError('context_overflow');
    return { code: api.code, title: api.title, detail: api.detail };
  }
  if (errStr.includes('image exceeds 5 MB') || errStr.includes('exceeds 5 MB maximum')) {
    return {
      code: 'provider_payload_limit',
      title: 'Image exceeds provider 5 MB limit',
      detail:
        'This image exceeds the provider base64 limit (5 MB on Anthropic Claude). ' +
        'Upload a smaller image or select Gemini 3.8 Flash, which supports larger files.',
    };
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
