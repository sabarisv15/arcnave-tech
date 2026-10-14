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
import { VISUAL_MAX_HTML_BYTES } from './ui/validator.js';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AnswerProtocolGuard } from './answerProtocolGuard.js';
import { sandboxReadsOfficeFiles, usesWarmSandbox } from '../tools/catalog.js';

import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import {
  attachments,
  chats,
  messages,
  messageSources,
  preferences as preferencesTable,
  projects,
  researchEvents,
  toolCalls,
  turnLogs,
} from '../db/schema.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import type { ModelEntry, ModelRegistry } from '../providers/registry.js';
import { AUTO_ALIAS } from '../providers/registry.js';
import type { RoutingDecision } from '../providers/routing.js';
import { routeAuto } from '../providers/routing.js';
import { effortFor, getModelCapability } from '../providers/capabilitiesTable.js';
import { asReadWithCode } from '../providers/attachmentContent.js';
import type {
  AttachmentBlock,
  AttachmentRef,
  GenerationRequest,
  HistoryToolCall,
  Mode,
  Provider,
  ProviderEvent,
  ProviderSource,
  ProviderUsage,
  ToolDefinition,
  ToolExecutor,
  ReasoningEffort,
  ToolResult,
  Turn,
} from '../providers/types.js';
import {
  addRequestUsage,
  EMPTY_USAGE,
  isAbort,
  ModelNotFoundError,
  ProviderError,
  toolCallAsText,
  toolResultPreview,
  totalTokens,
  withoutImageBytes,
} from '../providers/types.js';
import { buildAttachmentManifest, contextNote, type ManifestFile } from './attachments/manifest.js';
import type { ModelInputStore } from './attachments/modelInputStore.js';
import { cachedPdfForModel, pdfForModel, type PdfForModel } from './attachments/pdfPages.js';
import { CodeExecutionToolExecutor } from '../tools/codeExecutionExecutor.js';
import { DispatchingToolExecutor } from '../tools/dispatchingExecutor.js';
import { ProjectToolExecutor } from '../tools/executor.js';
import { ProjectToolRegistry } from '../tools/registry.js';
import { SKILLS_ROOT } from '../tools/codeExecutionExecutor.js';
import { TurnLog } from './turnLog.js';
import { WebToolExecutor } from '../tools/webExecutor.js';
import { WebFetchService } from './webFetch.js';
import { WebSearchService, buildWebSearchAdapter } from './webSearch.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import type { CapabilityRegistry } from '../capabilities/registry.js';
import type { MessageSegment } from '../db/schema.js';
import { buildBaseSystemPrompt, buildDynamicRuntimeContext, currentDateLine, mobileClientLine } from './systemPrompt.js';
import { assemblePrompt } from './promptCache/promptAssembly.js';
import { loadToolCalls, toolCallChars } from './history/toolHistory.js';
import type { PromptAssembly } from './promptCache/types.js';
import { memoryService } from './memory/memoryService.js';
import { compact, shouldCompact, lastContextTokens } from './compaction/autoCompact.js';
import { StreamTimeSplit, TurnTiming } from './turnTiming.js';
import { compactionService } from './compaction/compactionService.js';
import { toAttachmentRef } from './attachments/attachmentRef.js';
import { enforceModelLimits } from './attachments/modelLimits.js';
import { MemoryToolExecutor } from '../tools/memoryExecutor.js';
import { ChatToolExecutor } from '../tools/chatExecutor.js';
import { CHAT_TOOL_DEFINITIONS, CODE_TOOL_NAMES, MEMORY_TOOL_DEFINITIONS, UI_TOOL_DEFINITIONS, WEB_FETCH_WITH_BUILT_IN_SEARCH } from '../tools/definitions.js';
import { UIToolExecutor } from '../tools/uiExecutor.js';
import { AskUserInputExecutor } from '../tools/optionsExecutor.js';
import { UIAuthorizer } from './ui/authorizer.js';
import type { UIBlock } from './ui/types.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import type { SandboxClient } from '../tools/sandbox/client.js';
import type { SkillDetail, SkillService } from './skills.js';
import type { ObjectStorage } from './storage.js';
import type { Retriever } from './retrieval.js';
import { formatContext, formatWholeFiles, projectFileTexts } from './retrieval.js';
import type { UsageService } from './usage.js';
import { routeTurn, type RuntimeDebugTrace } from './routing/turnRouter.js';
import { resolveStyle } from './styles.js';

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
  | { type: 'thinking'; text: string }
  | { type: 'sources'; sources: SourceDto[]; searchEntryPoint?: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  /** `files`: what present_files gave the user, so the client shows (and opens) them at once. */
  | { type: 'tool_result'; toolCallId: string; name: string; ok: boolean; preview: string; files?: PresentedFileDto[] }
  | { type: 'artifact_created'; artifactId: string; title: string; kind: string; version: number }
  | { type: 'ui_block'; block: UIBlock }
  /**
   * ADR-0037: a visual's HTML while the model is still writing it. `text` continues the draft
   * `draftId` from character `from`. Drafts are shown, never kept: the checked block replaces
   * them when the call completes.
   */
  | { type: 'ui_draft'; draftId: string; title: string; from: number; text: string }
  | { type: 'debug'; trace: RuntimeDebugTrace }
  | { type: 'done'; questions: string[]; usage: UsageDto; finishReason: string; effort?: ReasoningEffort }
  | { type: 'error'; code: string; title: string; detail: string; usage?: UsageDto };

export interface PresentedFileDto {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
}

/** The files a successful present_files result holds, without their storage keys. */
export function presentedFiles(name: string, result: ToolResult): PresentedFileDto[] | undefined {
  if (name !== 'present_files' || !result.ok) return undefined;
  const json = result.content.find((c) => c.type === 'json') as { data?: { persistedFiles?: unknown } } | undefined;
  const files = Array.isArray(json?.data?.persistedFiles) ? (json.data.persistedFiles as PresentedFileDto[]) : [];
  return files.map(({ attachmentId, filename, mimeType, sizeBytes, downloadUrl }) => ({ attachmentId, filename, mimeType, sizeBytes, downloadUrl }));
}

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

/**
 * The same attachments with each rendered page image stored for the model to read by URI. New
 * objects, never the cached pages themselves: those are shared with requests to other providers.
 */
async function referencePages(atts: AttachmentBlock[], store: ModelInputStore): Promise<AttachmentBlock[]> {
  return Promise.all(
    atts.map(async (a) => {
      if (!a.pages) return a;
      const pages = await Promise.all(
        a.pages.map(async (p) =>
          p.image?.base64
            ? {
                ...p,
                image: {
                  mimeType: p.image.mimeType,
                  fileUri: await store.uriFor(Buffer.from(p.image.base64, 'base64'), p.image.mimeType),
                },
              }
            : p,
        ),
      );
      return { ...a, pages };
    }),
  );
}

/**
 * A PDF as every provider is shown it (ADR-0013): up to 100 pages, each page's image and text;
 * beyond that, its text only. No provider is handed the PDF's own bytes.
 */
async function asPdfForModel(att: AttachmentBlock, data: Buffer | PdfForModel): Promise<AttachmentBlock> {
  const pdf = Buffer.isBuffer(data) ? await pdfForModel(data, att.storageKey) : data;
  const { base64: _drop, ...rest } = att;
  if (pdf.kind === 'pages') return { ...rest, pages: pdf.pages };
  if (pdf.kind === 'text') return { ...rest, extractedText: pdf.text, textOnlyPageCount: pdf.pageCount };
  return { ...rest, omittedReason: 'unreadable', omittedDetail: pdf.reason };
}

/** What AgentLoop receives: the turn with its attachments already hydrated for the provider. */
export type AgentLoopInput = Omit<GenerateInput, 'attachments'> & {
  attachments: AttachmentBlock[];
  /** Every file in the conversation, as the attachment manifest lists them. */
  chatFiles?: ManifestFile[];
};

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
  /** This turn's attachments, normalised once by `toAttachmentRef`. */
  attachments: AttachmentRef[];
  /** Opt-in per request. Only Gemini has a code-execution sandbox on Vertex — see ADR-0004. */
  codeExecution: boolean;
  effort?: ReasoningEffort;
  /** Optional style override for this turn (preset name or custom style UUID). */
  styleId?: string;
  /** The device the request came from, so visuals are sized for it (ADR-0049). */
  clientPlatform?: 'mobile' | 'desktop';
  signal: AbortSignal;
}

export interface PreferencesRow {
  instructions: string;
  styleId?: string;
  maxOutputTokens: number;
  dailyTokenBudget: number | null;
  monthlyTokenBudget: number | null;
  warnThresholdPct: number;
  routingPreference: string;
  timezone: string;
  effort?: ReasoningEffort | null;
  /** The user's memory setting (ADR-0052). */
  memoryEnabled: boolean;
  /** The user's past-chat search setting (ADR-0052). */
  chatSearchEnabled: boolean;
}

/**
 * With a sandbox on the turn, Office and e-book files are read from the file with code rather
 * than sent as flattened text (ADR-0045): the text loses cell addresses, formulas, hidden sheets
 * and layout. Without one, the text is all the model can read, so it stays.
 */
export function readOfficeFilesWithCode(
  sandbox: boolean,
  current: AttachmentBlock[],
  history: Turn[],
): { current: AttachmentBlock[]; history: Turn[] } {
  if (!sandbox) return { current, history };
  return {
    current: current.map(asReadWithCode),
    history: history.map((t) => (t.attachments ? { ...t, attachments: t.attachments.map(asReadWithCode) } : t)),
  };
}

/* -------------------------------------------------------------------------- service */

/** A view of a skill's instructions: /skills/<name>/SKILL.md. */
const SKILL_FILE = /^\/skills\/([^/]+)\/SKILL\.md$/;

/** Characters of a skill given again after a compaction. ArcNave counts no tokens (Invariant 3), so the cap is in characters. */
const REINJECTED_SKILL_MAX_CHARS = 20_000;

/** A turn without tools gets project excerpts instead of the search tool: how many, and their
 *  character budget (the values the former PROJECT_CONTEXT_MAX_* settings had). */
const PROJECT_EXCERPTS_WITHOUT_TOOLS = 8;
const PROJECT_EXCERPT_CHARS_WITHOUT_TOOLS = 12_000;

export class GenerationService {
  private readonly capabilities: CapabilityRegistry;
  private readonly executionRuntime: ExecutionRuntime;

  constructor(
    private readonly db: Database,
    private readonly cfg: Config,
    private readonly registry: ModelRegistry,
    private readonly usage: UsageService,
    private readonly retriever: Retriever,
    private readonly storage: ObjectStorage,
    /** Undefined when ENABLE_RUN_PYTHON is off or no Vertex project is configured: the computer's
     *  tools are then never declared (see the wiring in `runTurn()`). */
    private readonly sandboxClient?: SandboxClient,
    private readonly skills?: SkillService,
    capabilities?: CapabilityRegistry,
    executionRuntime?: ExecutionRuntime,
    /** Where Gemini reads page images from instead of the request (ADR-0016); unset, inline. */
    private readonly modelInputs?: ModelInputStore,
  ) {
    this.capabilities = capabilities ?? buildCapabilityRegistry(cfg);
    this.executionRuntime = executionRuntime ?? new ExecutionRuntime(sandboxClient);
  }

  /**
   * Run one turn, yielding events for the SSE transport.
   *
   * The generator is the unit of cancellation: when the transport stops pulling (because the
   * client disconnected), the `finally` runs, the provider stream is abandoned, and the usage
   * row is written with whatever the provider had already reported.
   */
  async *run(input: GenerateInput): AsyncGenerator<StreamEvent> {
    // A turn ends on our deadline, not the platform's: Cloud Run cuts the request at its own
    // timeout and nothing is saved but "stopped" (Phase 3 live finding). The deadline aborts
    // with a typed reason, so the turn ends as `turn_deadline_exceeded`, not a user cancel.
    const deadline = new AbortController();
    const onUserAbort = (): void => deadline.abort(input.signal.reason);
    if (input.signal.aborted) onUserAbort();
    else input.signal.addEventListener('abort', onUserAbort, { once: true });
    const timer = setTimeout(() => deadline.abort(new ApiError('turn_deadline_exceeded')), this.cfg.TURN_DEADLINE_MS);
    try {
      yield* this.runTurn({ ...input, signal: deadline.signal });
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', onUserAbort);
    }
  }

  /**
   * Every file of the conversation, oldest first, then any of this turn's not yet stored on a
   * message. Every file of a chat stays in reach for the whole chat: a file whose turn
   * is no longer in the history (compacted, or past the backstop) is still listed and still in
   * run_python's input/ (ADR-0019). Upload order keeps each file's input/ name stable.
   */
  private async chatFilesOf(chatId: string, byId: Map<string, AttachmentBlock>): Promise<ManifestFile[]> {
    const stored = await this.db
      .select({
        id: attachments.id,
        filename: attachments.filename,
        mimeType: attachments.mimeType,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .innerJoin(messages, eq(attachments.messageId, messages.id))
      .where(and(eq(messages.chatId, chatId), eq(attachments.status, 'ready')))
      .orderBy(attachments.createdAt, attachments.id);
    const files: ManifestFile[] = stored.map((a) => ({ ...a, filename: a.filename ?? a.id }));
    const seen = new Set(files.map((f) => f.id));
    for (const a of byId.values()) {
      if (!a.id || seen.has(a.id)) continue;
      files.push({ id: a.id, filename: a.filename ?? a.id, mimeType: a.mimeType, sizeBytes: a.sizeBytes });
    }
    return files;
  }

  private async *runTurn(input: GenerateInput): AsyncGenerator<StreamEvent> {
    const startedAt = new Date();
    const timing = new TurnTiming();
    const runId = `${input.chatId}_${input.messageId}`;
    const workspace = await this.executionRuntime.createWorkspace(runId);
    timing.mark('workspace');
    // ADR-0050: what this reply sent and did, stage by stage, stored for the person to read.
    const turnLog = new TurnLog({
      messageId: input.messageId,
      chatId: input.chatId,
      startedAt,
      ...(input.clientPlatform ? { clientPlatform: input.clientPlatform } : {}),
    });
    turnLog.stage('workspace', { runId });
    const logOutcome: { status: string; finishReason?: string | null; errorCode?: string | null; usage?: object } = {
      status: 'unfinished',
    };

    try {
      // Attachments are not copied into the workspace up front. A tool that needs one names its
      // fileId and the runtime materialises exactly that file (G26, G15): current and historical
      // attachments take the same path, and nothing is downloaded for turns that never use it.
      const prefs = await this.loadPreferences(input.userId);

    const project = input.projectId ? await this.loadProject(input.userId, input.projectId) : null;
    let latestCompaction = this.cfg.ENABLE_CONTEXT_COMPACTION
      ? await compactionService.getLatestCompaction(input.chatId, this.db)
      : null;
    // Loaded before model resolution (not its historical position) because whether this turn
    // needs a vision-capable model depends on what's carried forward, not only on what's newly
    // attached — and loadHistory has no dependency on which model gets picked.
    const loaded = await this.loadHistory(
      input.chatId,
      input.messageId,
      latestCompaction?.throughSeq,
      input.modelAlias,
    );
    timing.mark('history');
    turnLog.stage('history', {
      earlierTurns: loaded.turns.length,
      compactedThroughSeq: latestCompaction?.throughSeq ?? null,
      prompt: `${String(input.prompt.length)} characters`,
      attachmentsOfThisMessage: input.attachments.length || loaded.currentUserAttachments.length,
    });
    let history = loaded.turns;
    const currentUserAttachments = loaded.currentUserAttachments;
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
    timing.mark('model_resolve');
    turnLog.stage('model', {
      requested: input.modelAlias,
      resolved: entry.alias,
      provider: entry.provider,
      providerModelId: entry.providerModelId,
      needsVision: requiresVision,
      needsGrounding: requiresGrounding,
      ...(routing ? { autoRule: routing.rule, considered: routing.considered } : {}),
    });
    // A probe ran inside resolution when the alias's status was checked during this turn.
    timing.note('probed', (this.registry.lastProbedAt(entry.alias) ?? 0) >= timing.since);
    timing.note('model', entry.alias);
    const provider = this.registry.providerFor(entry);
    if (!provider) {
      throw new ApiError('model_unavailable', {
        detail: `No adapter is registered for provider "${entry.provider}".`,
      });
    }

    // The web is searched when it helps, in every chat: the search
    // tool is offered on every turn the web is on, and the model decides whether to use it.
    // Search and Research modes still require it.
    const searchAvailable = entry.supportsGrounding && provider.supportsGrounding();
    const grounded = searchAvailable && (requiresGrounding || this.cfg.ENABLE_WEB);
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
      // The Anthropic adapter has no code-execution tool on Vertex (ADR-0004): never silently run the turn
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

    turnLog.setModel({ requested: input.modelAlias, resolved: entry.alias, providerModelId: entry.providerModelId!, grounded });
    turnLog.stage('capabilities', { builtInSearch: grounded, searchAvailable, codeExecution });

    yield {
      type: 'start',
      messageId: input.messageId,
      chatId: input.chatId,
      requestId: input.requestId,
      model: modelInfo,
    };

    // --- compact a long conversation (ADR-0019) ------------------------------
    let compactedNow = false;
    if (this.cfg.ENABLE_CONTEXT_COMPACTION) {
      timing.mark('before_compaction');
      const compacted = yield* this.compactIfNeeded(input, prefs, entry, provider);
      compactedNow = compacted;
      timing.mark('compaction');
      timing.note('compacted', compacted);
      turnLog.stage('compaction', { compacted });
      if (compacted) {
        latestCompaction = await compactionService.getLatestCompaction(input.chatId, this.db);
        ({ turns: history } = await this.loadHistory(input.chatId, input.messageId, latestCompaction?.throughSeq, input.modelAlias));
      }
    }

    // --- tools this turn may use (ADR-0006, ADR-0047) ---------------------
    const codeEnabled = this.cfg.ENABLE_RUN_PYTHON && this.sandboxClient !== undefined;
    const webEnabled = Boolean(this.cfg.ENABLE_WEB);
    const webSearchAdapter = buildWebSearchAdapter(this.cfg);
    // The deployment allows memory; each user turns memory and past-chat search on or off in
    // Settings (ADR-0052). Off means no tool and no memory text is sent, not just a promise.
    const memoryEnabled = Boolean(this.cfg.ENABLE_MEMORY) && prefs.memoryEnabled;
    const chatSearchEnabled = Boolean(this.cfg.ENABLE_MEMORY) && prefs.chatSearchEnabled;
    const generativeUiEnabled = Boolean(this.cfg.ENABLE_GENERATIVE_UI);
    const routingDecision = routeTurn({
      hasProject: project !== null,
      codeEnabled,
      generativeUiEnabled,
      webEnabled,
      searchProviderLive: webSearchAdapter.isLive,
      builtInSearch: grounded,
      memoryEnabled,
      chatSearchEnabled,
    });
    const toolRegistry = new ProjectToolRegistry(this.cfg.ENABLE_TOOL_USE, {
      codeEnabled,
      persistentSandbox: usesWarmSandbox(this.cfg),
      webEnabled,
      memoryEnabled,
      chatSearchEnabled,
      generativeUiEnabled,
    });
    const allowCode = routingDecision.allowedTools.includes('bash_tool');
    const availableTools = toolRegistry
      .getAvailableTools({ userId: input.userId, projectId: project?.id ?? null, allowCode })
      .filter((t) => routingDecision.allowedTools.includes(t.name))
      .map((t) => (t.name === 'web_fetch' && grounded ? WEB_FETCH_WITH_BUILT_IN_SEARCH : t));
    const activeToolNames = new Set<string>(availableTools.map((t) => t.name));
    turnLog.stage('routing', {
      code: codeEnabled,
      web: webEnabled,
      searchProviderLive: webSearchAdapter.isLive,
      memory: memoryEnabled,
      chatSearch: chatSearchEnabled,
      generativeUi: generativeUiEnabled,
      project: project !== null,
      declared: availableTools.map((t) => t.name),
    });

    // --- skills: names and descriptions up front, each read with view when needed ---------
    // Skills are listed only when view can read them (Invariant 1). After a compaction, the
    // skills read in the summarised turns come back in full (ADR-0027): the summary alone would
    // leave a skill the model believes it has read.
    let skillsContext: string | undefined;
    const loadedSkills: SkillDetail[] = [];
    const skillsEnabled = this.cfg.ENABLE_SKILLS && this.skills !== undefined && activeToolNames.has('view');
    if (skillsEnabled) {
      const availableSkills = this.skills!.listSkills(activeToolNames).filter((s) => s.missingTools.length === 0);
      const parts: string[] = [];
      if (availableSkills.length > 0) {
        parts.push(
          '<available_skills>\n' +
            availableSkills
              .map(
                (s) =>
                  `<skill>\n<name>${s.name}</name>\n<description>${s.description}</description>\n` +
                  `<location>${SKILLS_ROOT}/${s.name}/SKILL.md</location>\n</skill>`,
              )
              .join('\n') +
            '\n</available_skills>',
        );
      }
      const reinjected = latestCompaction
        ? await this.skillsLoadedThrough(input.chatId, latestCompaction.throughSeq)
        : [];
      for (const skillName of reinjected) {
        const detail = this.skills!.getSkill(skillName);
        if (detail && !loadedSkills.some((s) => s.name === detail.name)) loadedSkills.push(detail);
      }
      if (loadedSkills.length > 0) {
        parts.push(
          loadedSkills
            .map((s) => {
              const body =
                s.content.length > REINJECTED_SKILL_MAX_CHARS
                  ? `${s.content.slice(0, REINJECTED_SKILL_MAX_CHARS)}\n[Truncated: view ${SKILLS_ROOT}/${s.name}/SKILL.md for the whole skill.]`
                  : s.content;
              return `### Skill read earlier: ${SKILLS_ROOT}/${s.name}/SKILL.md\n\n${body}`;
            })
            .join('\n\n---\n\n'),
        );
      }
      if (parts.length > 0) skillsContext = parts.join('\n\n');
    }

    // --- assemble context -------------------------------------------------
    timing.mark('skills_tools');
    turnLog.stage('skills', {
      enabled: skillsEnabled,
      listed: skillsEnabled ? this.skills!.listSkills(activeToolNames).filter((s) => s.missingTools.length === 0).map((s) => s.name) : [],
      reinjectedAfterCompaction: loadedSkills.map((s) => s.name),
    });
    const { systemInstruction, contextEvents, promptAssembly } = await this.buildSystemInstruction(
      input,
      prefs,
      project,
      availableTools,
      skillsContext,
      // Every allowed tool is declared (ADR-0047); with tool use off, none is.
      availableTools.map((t) => t.name),
      grounded,
    );
    for (const event of contextEvents) {
      yield event;
      await this.persistEvent(input.messageId, event);
    }

    timing.mark('system_prompt');
    turnLog.stage('system prompt', {
      characters: systemInstruction.length,
      parts: Object.entries(promptAssembly.dynamicSuffix)
        .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
        .map(([k, v]) => `${k} ${String((v as string).length)}`),
    });
    const modelSpec = getModelCapability(entry.alias);
    const maxOutputTokens = Math.min(
      prefs.maxOutputTokens || this.cfg.DEFAULT_MAX_OUTPUT_TOKENS,
      this.cfg.MAX_OUTPUT_TOKENS_CEILING,
      modelSpec.maxOutputTokens ?? Number.POSITIVE_INFINITY,
    );
    const requestedEffort =
      input.effort ?? (prefs.effort as ReasoningEffort | undefined) ?? this.cfg.REASONING_EFFORT;
    const reasoningEffort = effortFor(modelSpec, requestedEffort);
    timing.note('effort', reasoningEffort ?? null);
    if (input.effort) timing.note('requestedEffort', input.effort);

    // --- reserve budget ---------------------------------------------------
    // The reservation is the worst case for this request; it is released as soon as the real
    // numbers land, so a large ceiling does not lock out the rest of the day.
    await this.usage.reserve(input.userId, prefs, maxOutputTokens);
    turnLog.stage('budget', { maxOutputTokens, effortRequested: requestedEffort ?? null, effortUsed: reasoningEffort ?? null });
    let reservationHeld = true;
    const releaseReservation = async (): Promise<void> => {
      if (!reservationHeld) return;
      reservationHeld = false;
      await this.usage.release(input.userId, prefs, maxOutputTokens).catch((err: unknown) => {
        log.error({ err, userId: input.userId }, 'failed to release budget reservation');
      });
    };

    const projectToolExecutor =
      availableTools.length > 0 && project !== null && this.cfg.ENABLE_TOOL_USE
        ? new ProjectToolExecutor(this.db, this.retriever, project.id, this.cfg.READ_PROJECT_FILE_MAX_CHARS)
        : undefined;

    const webToolExecutor = webEnabled
      ? new WebToolExecutor(new WebSearchService(webSearchAdapter), new WebFetchService(), webSearchAdapter)
      : undefined;
    // web_fetch opens only URLs already in the conversation: the user's, or a search's.
    webToolExecutor?.allowUrlsIn(input.prompt, JSON.stringify(history));

    const memoryToolExecutor = memoryEnabled
      ? new MemoryToolExecutor(memoryService, input.userId, project?.id ?? null)
      : undefined;
    const chatToolExecutor = chatSearchEnabled
      ? new ChatToolExecutor(input.userId, project?.id ?? null, input.chatId)
      : undefined;

    const pendingUiEvents: StreamEvent[] = [];
    const uiAuthorizer = new UIAuthorizer(this.db);
    const uiToolExecutor = generativeUiEnabled
      ? new UIToolExecutor(
          uiAuthorizer,
          { userId: input.userId, chatId: input.chatId, projectId: project?.id ?? null },
          this.cfg.UI_MAX_RESPONSE_BYTES,
          (block) => {
            const last = segments.at(-1);
            if (last?.type === 'ui') last.blockIds.push(block.blockId);
            else segments.push({ type: 'ui', blockIds: [block.blockId] });
            pendingUiEvents.push({
              type: 'ui_block',
              block,
            });
          },
          webSearchAdapter,
        )
      : undefined;

    const toolMap = new Map<string, ToolExecutor>();
    if (this.cfg.ENABLE_TOOL_USE) {
      toolMap.set('ask_user_input_v0', new AskUserInputExecutor());
    }
    if (uiToolExecutor) {
      for (const d of UI_TOOL_DEFINITIONS) toolMap.set(d.name, uiToolExecutor);
    }
    if (webToolExecutor) {
      for (const name of ['web_search', 'web_fetch', 'image_search']) toolMap.set(name, webToolExecutor);
    }
    if (memoryToolExecutor) {
      for (const d of MEMORY_TOOL_DEFINITIONS) toolMap.set(d.name, memoryToolExecutor);
    }
    if (chatToolExecutor) {
      for (const d of CHAT_TOOL_DEFINITIONS) toolMap.set(d.name, chatToolExecutor);
    }
    if (projectToolExecutor) {
      toolMap.set('search_project_files', projectToolExecutor);
      toolMap.set('read_project_file', projectToolExecutor);
    }
    let codeExecutor: CodeExecutionToolExecutor | undefined;
    if (allowCode) {
      codeExecutor = new CodeExecutionToolExecutor(this.executionRuntime, this.cfg.RUN_PYTHON_MAX_OUTPUT_CHARS, {
        workspace,
        userId: input.userId,
        messageId: input.messageId,
        chatId: input.chatId,
        db: this.db,
        storage: this.storage,
        skills: this.skills,
      });
      for (const name of CODE_TOOL_NAMES) toolMap.set(name, codeExecutor);
    }

    const toolExecutor = toolMap.size > 0 ? new DispatchingToolExecutor(toolMap) : undefined;
    timing.mark('tools_setup');
    turnLog.stage('tool executors', { executors: [...new Set([...toolMap.values()].map((e) => e.constructor.name))] });

    const { current: wireAttachments, history: wireHistory } = await this.limitToModel(
      entry.alias,
      await this.hydrateAttachmentBytes(input.attachments),
      await this.hydrateHistoryAttachments(history, input.prompt, entry.alias),
      releaseReservation,
    );
    timing.mark('attachments');
    {
      const all = [...wireAttachments, ...wireHistory.flatMap((t) => t.attachments ?? [])];
      turnLog.stage('attachments', {
        current: wireAttachments.length,
        fromHistory: all.length - wireAttachments.length,
        pdfsAsPages: all.filter((a) => a.pages).length,
        pageImages: all.reduce((n, a) => n + (a.pages?.filter((p) => p.image?.fileUri || p.image?.base64).length ?? 0), 0),
        leftOut: all.filter((a) => a.omittedReason).map((a) => `${a.filename ?? a.id}: ${a.omittedReason!}`),
      });
    }

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

    const chatFiles = await this.chatFilesOf(input.chatId, allAttachmentsMap);
    codeExecutor?.setChatFiles(chatFiles);
    const wire = readOfficeFilesWithCode(
      codeExecutor !== undefined && sandboxReadsOfficeFiles(this.cfg),
      wireAttachments,
      wireHistory,
    );
    // Each line says whether the model already sees the file, from what this request carries.
    const sent = new Map<string, AttachmentBlock>();
    for (const a of [...wire.history.flatMap((t) => t.attachments ?? []), ...wire.current]) if (a.id) sent.set(a.id, a);
    const attachmentManifestBlock = buildAttachmentManifest(
      chatFiles.map((f) => {
        const block = sent.get(f.id);
        return block ? { ...f, inContext: contextNote(block) } : f;
      }),
      { sandbox: codeExecutor !== undefined },
    );

    const promptParts: string[] = [];
    if (attachmentManifestBlock) promptParts.push(attachmentManifestBlock);
    promptParts.push(input.prompt);
    const effectivePrompt = promptParts.join('\n\n');

    // Decides whether old tool results are cleared from the first request (contextEditing.ts).
    // After a compaction the earlier size no longer describes what is sent.
    const previousContextTokens = compactedNow ? null : await this.previousContextTokens(input);
    const request: GenerationRequest = {
      prompt: effectivePrompt,
      history: wire.history,
      attachments: wire.current,
      systemInstruction,
      promptAssembly,
      mode: input.mode,
      maxOutputTokens,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(previousContextTokens !== null ? { previousContextTokens } : {}),
      providerModelId: entry.providerModelId!,
      grounded,
      codeExecution: Boolean(input.codeExecution),
      ...(availableTools.length > 0 ? { tools: availableTools } : {}),
      ...(toolExecutor ? { toolExecutor } : {}),
      signal: input.signal,
    };

    turnLog.stage('request built', {
      readWithCode: [...wire.current, ...wire.history.flatMap((t) => t.attachments ?? [])]
        .filter((a) => a.omittedReason === 'read_with_code')
        .map((a) => a.filename ?? a.id),
      previousContextTokens,
    });
    turnLog.sent(request, skillsEnabled ? this.skills!.listSkills(activeToolNames).filter((s) => s.missingTools.length === 0).map((s) => s.name) : []);

    let usage: ProviderUsage = EMPTY_USAGE;
    let finishReason = 'stop';
    let status: 'complete' | 'cancelled' | 'error' = 'complete';
    let errorCode: string | null = null;
    const collectedText: string[] = [];
    const collectedThinking: string[] = [];
    // The answer in the order it happened: thinking, text and tool steps
    // interleaved. Kept on the message so a reload shows the same timeline.
    const segments: MessageSegment[] = [];
    const answerGuard = new AnswerProtocolGuard();
    const addSegment = (type: 'thinking' | 'text', text: string) => {
      const last = segments.at(-1);
      if (last && last.type === type) last.text += text;
      else segments.push({ type, text });
    };
    const collectedSources: ProviderSource[] = [];
    let searchEntryPoint: string | undefined;
    let eventOrdinal = contextEvents.length;
    const pendingToolInputs = new Map<string, unknown>();
    // Gemini's signature for a call, stored so a later turn can replay the call as it was made.
    const pendingSignatures = new Map<string, string>();
    const toolsCalled: string[] = [];
    // This turn's calls with their results. The adapter's loop keeps them in its own request; a
    // forced answer after the loop is a new request, and without these it cannot see the work.
    const turnCalls: HistoryToolCall[] = [];
    // Characters of each visual draft already sent, by draft id.
    const draftSent = new Map<string, number>();

    try {
      const stream = this.streamWithRetry(provider.stream.bind(provider), request);
      timing.mark('before_provider');
      let firstProviderEvent = true;
      let toolCallCount = 0;
      // Splits the stream's time between waiting on the model and waiting on tools, so a slow
      // turn's log says which one it was (a 462 s turn with 2 tool calls said neither).
      const split = new StreamTimeSplit();

      for await (const event of stream) {
        if (firstProviderEvent) {
          firstProviderEvent = false;
          timing.mark('provider_first_event');
          turnLog.stage('provider first event', { event: event.type });
        }
        split.observe(event.type);
        timing.note('streamMs', split.summary());
        if (event.type === 'tool_use') timing.note('toolCalls', (toolCallCount += 1));
        switch (event.type) {
          case 'delta': {
            const safe = answerGuard.push(event.text);
            collectedText.push(safe);
            addSegment('text', safe);
            turnLog.text(safe);
            if (safe) yield { type: 'delta', text: safe };
            break;
          }

          case 'thinking':
            turnLog.thinking(event.text);
            collectedThinking.push(event.text);
            addSegment('thinking', event.text);
            yield { type: 'thinking', text: event.text };
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

          case 'tool_input_partial': {
            if (event.name !== 'show_widget') break;
            // A call's index restarts each response; the calls already made keep the id unique.
            for (const draft of visualDrafts(event.input, `${String(toolsCalled.length + event.index)}`)) {
              const sent = draftSent.get(draft.draftId) ?? 0;
              const html = draft.html.slice(0, VISUAL_MAX_HTML_BYTES);
              if (html.length <= sent) continue;
              draftSent.set(draft.draftId, html.length);
              yield { type: 'ui_draft', draftId: draft.draftId, title: draft.title, from: sent, text: html.slice(sent) };
            }
            break;
          }

          case 'tool_use': {
            toolsCalled.push(event.name);
            {
              const last = segments.at(-1);
              if (last?.type === 'tools') last.toolCallIds.push(event.toolCallId);
              else segments.push({ type: 'tools', toolCallIds: [event.toolCallId] });
            }
            pendingToolInputs.set(event.toolCallId, event.input);
            turnLog.call(event.toolCallId, event.name, event.input);
              if (event.thoughtSignature) pendingSignatures.set(event.toolCallId, event.thoughtSignature);
            yield { type: 'tool_use', toolCallId: event.toolCallId, name: event.name, input: event.input };
            break;
          }

          case 'tool_result': {
            turnLog.result(event.toolCallId, event.result);
            turnCalls.push({
              id: event.toolCallId,
              name: event.name,
              input: pendingToolInputs.get(event.toolCallId),
              result: { ...event.result, content: withoutImageBytes(event.result.content) },
            });
            const preview = toolResultPreview(event.result, this.cfg.TOOL_RESULT_PREVIEW_CHARS);
            const files = presentedFiles(event.name, event.result);
            yield {
              type: 'tool_result',
              toolCallId: event.toolCallId,
              name: event.name,
              ok: event.result.ok,
              preview,
              ...(files?.length ? { files } : {}),
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

          case 'refusal':
            throw refusalError(event);

          case 'completed':
            {
              const tail = answerGuard.finish();
              if (tail) {
                collectedText.push(tail);
                addSegment('text', tail);
                turnLog.text(tail);
                yield { type: 'delta', text: tail };
              }
            }
            usage = event.usage;
            finishReason = event.finishReason;
            this.registry.recordOutcome(entry.alias, { available: true });
            turnLog.stage('provider completed', { finishReason: event.finishReason, toolCalls: toolsCalled.length, stream: split.summary() });
            break;
        }
      }
    } catch (err) {
      if (err instanceof ModelNotFoundError) {
        this.registry.recordOutcome(entry.alias, { available: false, detail: err.message });
      }
      const deadlineHit = isTurnDeadline(input.signal.reason);
      if (!deadlineHit && (isAbort(err) || input.signal.aborted)) {
        status = 'cancelled';
      } else {
        status = 'error';
        const mapped = mapProviderError(deadlineHit ? input.signal.reason : err);
        errorCode = mapped.code;
        turnLog.fail(err);
        turnLog.stage('provider failed', { code: mapped.code, deadline: deadlineHit, toolCalls: toolsCalled.length });
        log.error({ err, chatId: input.chatId, requestId: input.requestId }, 'generation failed');
        await this.finalise(input, {
          text: collectedText.join(''),
          thinking: collectedThinking.join(''),
          segments,
          sources: collectedSources,
          searchEntryPoint,
          status: 'error',
          errorCode: mapped.code,
          finishReason: null,
          entry,
          mode: input.mode,
          effort: reasoningEffort,
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
        Object.assign(logOutcome, { status: 'error', errorCode: mapped.code, usage });
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
      turnLog.stage('empty reply', { note: 'the tool loop ended with no text; one more request, without tools, asks for the answer' });
      try {
        // The loop's tool steps live only in the adapter's own request, so they are written into
        // this one: an answer "from the results above" with no results in the request is a re-do.
        const workDone = turnCalls.map((c) => toolCallAsText(c)).join('\n\n');
        const synthesisRequest: GenerationRequest = {
          ...request,
          tools: [],
          toolExecutor: undefined,
          prompt:
            request.prompt +
            (workDone ? `\n\n<this_turn_tool_steps>\n${workDone}\n</this_turn_tool_steps>` : '') +
            `\n\n[System Instruction: Answer the user now from the conversation${workDone ? " and this turn's tool steps above" : ''}. ` +
            'Do not call a tool. If the work is not finished, say what is done and what remains.]',
        };
        const synthesisStream = provider.stream(synthesisRequest);
        for await (const event of synthesisStream) {
          if (event.type === 'delta' && event.text) {
            const safe = answerGuard.push(event.text);
            collectedText.push(safe);
            addSegment('text', safe);
            turnLog.text(safe);
            if (safe) yield { type: 'delta', text: safe };
          } else if (event.type === 'completed') {
            const tail = answerGuard.finish();
            if (tail) {
              collectedText.push(tail);
              addSegment('text', tail);
              turnLog.text(tail);
              yield { type: 'delta', text: tail };
            }
            // A second request of the same turn: billed on top of the first.
            usage = addRequestUsage(usage, event.usage);
            // A loop that ran out of tool steps stays marked so: the user is offered Continue, and
            // the forced answer's own "stop" must not hide that the work was cut short.
            if (finishReason !== 'tool_limit') finishReason = event.finishReason;
          }
        }
        text = collectedText.join('');
      } catch (synthErr) {
        log.warn({ err: synthErr }, 'Forced synthesis round failed');
        if (synthErr instanceof ApiError && synthErr.code === 'tool_protocol_in_text') {
          status = 'error';
          errorCode = synthErr.code;
          text = collectedText.join('');
          yield { type: 'error', code: synthErr.code, title: synthErr.title, detail: synthErr.detail, usage: toUsageDto(usage, null) };
        }
      }

      if (status !== 'error' && text.trim().length === 0) {
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

    const questions: string[] = [];

    await this.finalise(input, {
      text,
      thinking: collectedThinking.join(''),
      segments,
      sources: collectedSources,
      searchEntryPoint,
      status: status === 'cancelled' ? 'stopped' : status === 'error' ? 'error' : 'complete',
      errorCode,
      finishReason: status === 'cancelled' ? 'cancelled' : finishReason,
      entry,
      mode: input.mode,
      questions,
      effort: reasoningEffort,
    });

    turnLog.stage('saved', { status, textCharacters: text.length, segments: segments.length });
    Object.assign(logOutcome, {
      status: status === 'cancelled' ? 'stopped' : status,
      finishReason: status === 'cancelled' ? 'cancelled' : finishReason,
      errorCode,
      usage,
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

    // A cancelled run has no terminal `done`: the client already knows it stopped, and
    // emitting "done" would claim a completion that did not happen.
    if (status === 'complete') {
      const debugTrace: RuntimeDebugTrace = {
        loadedSkills: loadedSkills.map((s) => s.name),
        allowedTools: routingDecision.allowedTools,
        toolsCalled,
      };
      log.info({ debugTrace }, 'Runtime debug trace');
      yield { type: 'debug', trace: debugTrace };

      yield {
        type: 'done',
        questions,
        usage: toUsageDto(usage, computeCostFor(this.cfg, entry.providerModelId!, usage)),
        finishReason,
        ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      };
    }
    } catch (err) {
      // A failure outside the provider stream (model resolution, a limit, the budget, saving):
      // the log says which stage it came after, then the error goes on as before.
      turnLog.fail(err);
      Object.assign(logOutcome, { status: 'error', errorCode: (err as { code?: string }).code ?? 'internal' });
      throw err;
    } finally {
      timing.mark('stream_and_persist');
      log.info({ chatId: input.chatId, messageId: input.messageId, ...timing.summary() }, 'turn timing');
      {
        turnLog.finish({ ...logOutcome, timing: timing.summary() });
        const markdown = turnLog.markdown();
        await this.db
          .insert(turnLogs)
          .values({ messageId: input.messageId, userId: input.userId, markdown })
          .onConflictDoUpdate({ target: turnLogs.messageId, set: { markdown } })
          .catch((err: unknown) => log.warn({ err, messageId: input.messageId }, 'turn log not saved'));
      }
      await this.executionRuntime.cleanupWorkspace(workspace);
    }
  }

  /* ------------------------------------------------------------------ model resolution */

  /** Exact prompt-plus-answer size of the chat's previous request, or null when not known. */
  private async previousContextTokens(input: GenerateInput): Promise<number | null> {
    const [self] = await this.db
      .select({ seq: messages.seq })
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .limit(1);
    return self ? lastContextTokens(this.db, input.chatId, self.seq) : null;
  }

  /** The model that answered this chat's latest completed turn, if any. */
  private async chatModelAlias(chatId: string, currentMessageId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ alias: messages.modelAlias })
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.role, 'assistant'),
          eq(messages.status, 'complete'),
          sql`${messages.id} <> ${currentMessageId}`,
          sql`${messages.modelAlias} is not null`,
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(1);
    return row?.alias ?? null;
  }

  private async resolveModel(
    input: GenerateInput,
    prefs: PreferencesRow,
    requiresGrounding: boolean,
    requiresVision: boolean,
    contextChars: number,
  ): Promise<{ entry: ModelEntry; routing: RoutingDecision | null }> {
    if (input.modelAlias !== AUTO_ALIAS) {
      const status = await this.registry.status(input.modelAlias, { probe: 'never' });
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

    const available = await this.registry.availableEntries({ probe: 'never' });
    // One model per conversation. Auto picks once, then the chat stays on that
    // model while it is available and can do what the turn needs: a follow-up about a file is
    // not handed to a weaker model, and thinking tied to the model is not lost mid-task.
    const earlier = await this.chatModelAlias(input.chatId, input.messageId);
    const kept = available.find(
      (e) =>
        e.alias === earlier &&
        (!requiresVision || e.supportsVision) &&
        (!requiresGrounding || e.supportsGrounding),
    );
    if (kept) {
      return { entry: kept, routing: { alias: kept.alias, entry: kept, rule: 'same_model_as_chat', considered: [kept.alias] } };
    }
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
            'a model that can.'
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
   *
   * There is no first-token cutoff: a request is bounded by the
   * adapter's PROVIDER_TIMEOUT_MS (10 minutes, the SDK's default) and retried only when it fails
   * (connection error, timeout, 408/409/429/5xx), never for being slow. A 12 s cutoff aborted
   * large follow-ups that were still reading, and each retry repeated the same slow request
   * (ADR-0024).
   */
  private async *streamWithRetry(
    open: (req: GenerationRequest) => AsyncGenerator<ProviderEvent>,
    request: GenerationRequest,
  ): AsyncGenerator<ProviderEvent> {
    let attempt = 0;
    let overflowRetried = false;
    let currentRequest = request;
    for (;;) {
      let firstEventReceived = false;
      let userVisibleOutputEmitted = false;
      const attemptStartedAt = Date.now();
      try {
        // A Stop that landed before this attempt began (while history or files were still
        // loading) must not run the turn anyway.
        if (currentRequest.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        for await (const event of open(currentRequest)) {
          if (!firstEventReceived) {
            firstEventReceived = true;
            log.info({ ttftMs: Date.now() - attemptStartedAt, attempt }, 'provider first event');
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
        if (currentRequest.signal.aborted) throw err;
        // Check who aborted, not the error's shape: the caller did not, so an abort here is a
        // provider-side timeout, typed and retryable, never stored as the user pressing Stop.
        if (isAbort(err)) {
          err = new ProviderError(`Provider request aborted without a cancel: ${String(err)}`, {
            code: 'provider_timeout',
            retryable: true,
          });
        }

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
              t.attachments?.some((a) => Boolean(a.base64 || a.pages)),
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
        styleId: preferencesTable.styleId,
        maxOutputTokens: preferencesTable.maxOutputTokens,
        dailyTokenBudget: preferencesTable.dailyTokenBudget,
        monthlyTokenBudget: preferencesTable.monthlyTokenBudget,
        warnThresholdPct: preferencesTable.warnThresholdPct,
        routingPreference: preferencesTable.routingPreference,
        timezone: preferencesTable.timezone,
        effort: preferencesTable.effort,
        memoryEnabled: preferencesTable.memoryEnabled,
        chatSearchEnabled: preferencesTable.chatSearchEnabled,
      })
      .from(preferencesTable)
      .where(eq(preferencesTable.userId, userId))
      .limit(1);
    if (!row) throw new ApiError('internal_error', { detail: 'Preferences are missing.' });
    return {
      ...row,
      effort: (row.effort as ReasoningEffort | null) ?? null,
    };
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
    if (throughSeq !== undefined) {
      conditions.push(sql`${messages.seq} > ${throughSeq}`);
    }

    const rows = await this.db
      .select({ id: messages.id, role: messages.role, text: messages.text, seq: messages.seq })
      .from(messages)
      .where(and(...conditions))
      // No turn count: the whole conversation goes, up to the model's window. What
      // keeps it inside the window is compaction (ADR-0019); the character budget below is the
      // backstop. A 20-message cap here used to drop a file sent 11 questions ago.
      .orderBy(desc(messages.seq));

    const ordered = rows
      .reverse()
      .map((r) => {
        if (r.role === 'assistant' && r.text.trim() === '') {
          return { ...r, text: '[Response stopped]' };
        }
        return r;
      })
      .filter((r) => r.text.trim() !== '');

    // Earlier turns' tool calls go with them, results in full (ADR-0022, ADR-0023).
    const toolCallsOf = await loadToolCalls(
      this.db,
      ordered.filter((r) => r.role === 'assistant').map((r) => r.id),
    );

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
      const cost = row.text.length + toolCallChars(toolCallsOf.get(row.id));
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
      const calls = r.role === 'assistant' ? toolCallsOf.get(r.id) : undefined;
      // Extracted text travels once, on the attachment itself; the adapters render it (G16).
      return {
        role: r.role === 'user' ? 'user' : 'assistant',
        text: r.text,
        ...(atts ? { attachments: atts } : {}),
        ...(calls?.length ? { toolCalls: calls } : {}),
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
   * Compacts the chat before this turn when the previous request reached the trigger (ADR-0019),
   * with the model this turn runs on. The user sees it happen ("Compacting our conversation").
   * A failed compaction leaves
   * the history whole and the turn goes on; an abort ends the turn.
   */
  private async *compactIfNeeded(
    input: GenerateInput,
    prefs: PreferencesRow,
    entry: ModelEntry,
    provider: Provider,
  ): AsyncGenerator<StreamEvent, boolean> {
    const [self] = await this.db
      .select({ seq: messages.seq })
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .limit(1);
    if (!self) return false;
    // The assistant row is the one after its user message; everything before that user message.
    const beforeSeq = self.seq - 1;
    const window = entry.contextWindow ?? getModelCapability(entry.alias).maxInputTokens ?? null;
    const deps = { db: this.db, cfg: this.cfg };
    if (!(await shouldCompact(deps, input.chatId, beforeSeq, window))) return false;

    const progress = (stage: 'reading' | 'complete', label: string, detail: string): StreamEvent => ({
      type: 'research',
      event: { stage, label, detail, at: new Date().toISOString() },
    });
    yield progress('reading', 'Compacting our conversation', 'Summarizing earlier messages so the chat can continue.');
    const startedAt = new Date();
    let usage = EMPTY_USAGE;
    let status: 'complete' | 'error' | 'cancelled' = 'complete';
    try {
      const out = await compact(deps, input.chatId, beforeSeq, {
        provider,
        providerModelId: entry.providerModelId!,
        providerName: entry.provider,
        contextWindow: window,
      }, input.signal);
      usage = out.usage;
      if (!out.result) {
        yield progress('complete', 'Conversation not compacted', 'No summary came back; the full conversation is sent.');
        return false;
      }
      yield progress('complete', 'Conversation compacted', 'Earlier messages are summarized; recent ones are kept word for word.');
      return true;
    } catch (err) {
      if (isAbort(err) || input.signal.aborted) {
        status = 'cancelled';
        throw err;
      }
      status = 'error';
      log.warn({ err, chatId: input.chatId }, 'compaction failed; sending the full conversation');
      yield progress('complete', 'Conversation not compacted', 'Summarizing failed; the full conversation is sent.');
      return false;
    } finally {
      // Its tokens are spent whether or not a summary came back. No messageId: the compaction is
      // not the turn's answer, and the next trigger check reads the answer's usage.
      await this.usage.record({
        userId: input.userId,
        prefs,
        requestId: `${input.requestId}:compaction`,
        chatId: input.chatId,
        messageId: null,
        projectId: input.projectId,
        modelAlias: entry.alias,
        provider: entry.provider,
        providerModelId: entry.providerModelId!,
        usage,
        startedAt,
        status,
      });
    }
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
        if (sentAsBytes(att) && !att.base64 && !att.pages && att.storageKey) {
          // Pages rendered on an earlier turn are reused before the file is fetched again: the
          // stored bytes behind a key never change (audit B6).
          const rendered = att.mimeType === 'application/pdf' ? cachedPdfForModel(att.storageKey) : undefined;
          if (rendered) return asPdfForModel(att, rendered);
          try {
            const data = await this.storage.get(att.storageKey);
            if (att.mimeType === 'application/pdf') return await asPdfForModel(att, data);
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
  /**
   * G18: the selected model's limits, applied to what is about to be sent. Runs after the budget
   * reservation, so a refusal here must release it before propagating.
   */
  private async limitToModel(
    alias: string,
    current: AttachmentBlock[],
    history: Turn[],
    releaseReservation: () => Promise<void>,
  ): Promise<{ current: AttachmentBlock[]; history: Turn[] }> {
    try {
      const spec = getModelCapability(alias);
      const limited = await enforceModelLimits(spec, current, history);
      // Gemini reads page images from Cloud Storage, keeping a large PDF out of the request
      // (ADR-0016). The Anthropic adapter on Vertex takes base64 only, so it is left as is.
      if (spec.provider !== 'google' || !this.modelInputs) return { current, history: limited };
      const store = this.modelInputs;
      return {
        current: await referencePages(current, store),
        history: await Promise.all(
          limited.map(async (t) => (t.attachments ? { ...t, attachments: await referencePages(t.attachments, store) } : t)),
        ),
      };
    } catch (err) {
      await releaseReservation();
      throw err;
    }
  }

  private async hydrateHistoryAttachments(
    turns: Turn[],
    currentPrompt: string | undefined,
    alias: string,
  ): Promise<Turn[]> {
    const maxBudget = this.cfg.HISTORY_MAX_ATTACHMENT_BYTES ?? 12_000_000;
    let cumulativeBytes = 0;

    // Every earlier image of the chat stays available. The budget only guards bytes that ride inline in a request whose limit is
    // not verified: Gemini's inline data. The Anthropic adapter's request limit is verified and enforced,
    // newest first, by enforceModelLimits; a Gemini PDF with a model-input bucket goes by gs://
    // URI (ADR-0016) and adds nothing inline. Those are loaded whatever their size (ADR-0019).
    const spec = getModelCapability(alias);
    const unbudgeted = (a: AttachmentBlock): boolean =>
      spec.maxRequestBytes !== null ||
      (spec.provider === 'google' && this.modelInputs !== undefined && a.mimeType === 'application/pdf');

    // Only files sent as bytes spend the budget; Office and text files travel as extracted text.
    const allHistoricalAtts = turns.flatMap((t) => t.attachments ?? []).filter((a) => sentAsBytes(a) && !unbudgeted(a));

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
        if (!sentAsBytes(att) || unbudgeted(att) || !att.id || hydrationDecisions.has(att.id)) continue;
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
            if (unbudgeted(att)) return (await this.hydrateAttachmentBytes([att]))[0] ?? att;
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

  /** Skills a view of /skills/<name>/SKILL.md read in this chat's turns up to `throughSeq`. */
  private async skillsLoadedThrough(chatId: string, throughSeq: number): Promise<string[]> {
    const rows = await this.db
      .select({ input: toolCalls.input })
      .from(toolCalls)
      .innerJoin(messages, eq(messages.id, toolCalls.messageId))
      .where(
        and(
          eq(messages.chatId, chatId),
          sql`${messages.seq} <= ${throughSeq}`,
          eq(toolCalls.name, 'view'),
          eq(toolCalls.ok, true),
        ),
      )
      .orderBy(messages.seq, toolCalls.ordinal);
    const names = rows
      .map((r) => (r.input as { path?: unknown } | null)?.path)
      .map((p) => (typeof p === 'string' ? SKILL_FILE.exec(p)?.[1] : undefined))
      .filter((n): n is string => typeof n === 'string');
    return [...new Set(names)];
  }

  private async buildSystemInstruction(
    input: GenerateInput,
    prefs: PreferencesRow,
    project: { id: string; title: string; instructions: string } | null,
    availableTools: ToolDefinition[] = [],
    skillsContext?: string,
    /** Every tool allowed this turn, declared or discoverable; tool policies key on these. */
    allowedToolNames?: string[],
    /** The model's own web search is on this turn (Gemini grounding, the Anthropic adapter's web_search). */
    builtInWebSearch = false,
  ): Promise<{
    systemInstruction: string;
    contextEvents: StreamEvent[];
    promptAssembly: PromptAssembly;
  }> {
    const events: StreamEvent[] = [];

    // 1. Standing preferences: the user's own instructions.
    const combinedStandingPrefs = prefs.instructions.trim();

    // 2. Memory: the listing of every file, and the profile and preferences in full. The same
    // text from turn to turn, so it does not break the prompt cache (ADR-0025, ADR-0047).
    let relevantMemoryText = '';
    if (this.cfg.ENABLE_MEMORY && allowedToolNames?.includes('memory_read')) {
      relevantMemoryText = await memoryService.memoryPrompt(input.userId, project?.id ?? null, this.cfg.MEMORY_CONTEXT_MAX_CHARS);
    }

    // 3. Conversation compaction summary
    let compactionText = '';
    if (this.cfg.ENABLE_CONTEXT_COMPACTION) {
      const latestCompaction = await compactionService.getLatestCompaction(input.chatId, this.db);
      if (latestCompaction) {
        compactionText = compactionService.formatCompactionForPrompt(latestCompaction);
      }
    }

    // 4. Project knowledge. A project's files stay in context, switching to search only when
    // the project knowledge approaches the context window limit (ADR-0020). So: every file whole while they fit, excerpts by relevance past that.
    let retrievedContextText: string | undefined;
    const wholeFiles = project ? await projectFileTexts(this.db, project.id) : [];
    const wholeChars = wholeFiles.reduce((n, f) => n + f.text.length, 0);
    if (
      project &&
      wholeFiles.length > 0 &&
      wholeFiles.every((f) => f.whole) &&
      wholeChars <= this.cfg.PROJECT_FULL_CONTEXT_MAX_CHARS
    ) {
      retrievedContextText = formatWholeFiles(wholeFiles);
      events.push({
        type: 'research',
        event: {
          stage: 'reading',
          label: `Using all ${String(wholeFiles.length)} project file${wholeFiles.length === 1 ? '' : 's'} in full`,
          detail: wholeFiles.map((f) => f.filename).join(', '),
          at: new Date().toISOString(),
        },
      });
    } else if (project && wholeFiles.length > 0 && allowedToolNames?.includes('search_project_files')) {
      // Past the limit the model searches when it needs to. Chunks
      // picked here by the prompt's words changed the system prompt every turn and broke its
      // cache (audit B9, B10).
      retrievedContextText =
        `<project_knowledge>\nThis project's ${String(wholeFiles.length)} file${wholeFiles.length === 1 ? ' is' : 's are'} ` +
        'too large to include here. Search them with search_project_files and read the parts you need with ' +
        'read_project_file before answering from them.\nFiles: ' +
        wholeFiles.map((f) => f.filename).join(', ') +
        '\n</project_knowledge>';
      events.push({
        type: 'research',
        event: {
          stage: 'reading',
          label: 'Project knowledge is searched as needed',
          detail: `${String(wholeFiles.length)} project file${wholeFiles.length === 1 ? '' : 's'}, too large to include whole.`,
          at: new Date().toISOString(),
        },
      });
    } else if (project && wholeFiles.length > 0) {
      // No tools on this turn, so no search tool: excerpts chosen by the question are the only
      // way the model sees the files.
      const chunks = await this.retriever.search(this.db, project.id, input.prompt, PROJECT_EXCERPTS_WITHOUT_TOOLS);
      const context = formatContext(chunks, PROJECT_EXCERPT_CHARS_WITHOUT_TOOLS);
      if (context) {
        retrievedContextText = context;
        events.push({
          type: 'research',
          event: {
            stage: 'reading',
            label: `Retrieved ${String(chunks.length)} excerpt${chunks.length === 1 ? '' : 's'} from project files`,
            detail: `Matched by keyword relevance in: ${[...new Set(chunks.map((c) => c.filename))].join(', ')}.`,
            at: new Date().toISOString(),
          },
        });
      }
    }

    // 5. Mode directive
    const modeDirective =
      input.mode === 'research'
        ? 'Conduct deep, rigorous research using web search and web fetch. Answer with a comprehensive, well-structured research report complete with citations directly in the chat text stream. Do not put the report in a file unless the user asked for one. If live web research fails or search providers are unavailable, state plainly: "Live web research could not be completed at this time due to search provider unavailability."'
        : input.mode === 'search'
          ? 'Answer using the web search results available to you. Cite the sources you actually ' +
            'used. Do not invent citations, and say plainly when the evidence does not settle ' +
            'the question.'
          : undefined;

    // 6. Style instructions (WP-05 / ADR-0033)
    const effectiveStyleId = input.styleId ?? prefs.styleId ?? 'normal';
    const resolvedStyle = await resolveStyle(this.db, input.userId, effectiveStyleId);
    const styleInstructions = resolvedStyle.instructions.trim() || undefined;

    // 7. Assemble prompt separating stable prefix from dynamic suffix
    const promptAssembly = assemblePrompt(availableTools, {
      currentDate:
        currentDateLine(new Date(), prefs.timezone) +
        (input.clientPlatform === 'mobile' ? '\n' + mobileClientLine(availableTools.some((t) => t.name === 'read_me')) : ''),
      runtimeCapabilities: buildDynamicRuntimeContext(this.cfg, this.capabilities, allowedToolNames, builtInWebSearch, availableTools.map((tool) => tool.name)),
      standingPreferences: combinedStandingPrefs || undefined,
      projectInstructions: project?.instructions?.trim() || undefined,
      styleInstructions,
      relevantMemory: relevantMemoryText || undefined,
      compactionSummary: compactionText || undefined,
      retrievedContext: retrievedContextText,
      modePrompt: modeDirective,
      skillsContext,
    }, allowedToolNames);

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
    thoughtSignature?: string,
  ): Promise<void> {
    await this.db
      .insert(toolCalls)
      .values({
        messageId,
        ordinal,
        toolCallId,
        name,
        input: input ?? {},
        content: withoutImageBytes(result.content),
        ok: result.ok,
        thoughtSignature: thoughtSignature ?? null,
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
      thinking?: string;
      segments?: MessageSegment[];
      effort?: ReasoningEffort;
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
        ...(result.thinking ? { thinking: result.thinking } : {}),
        ...(result.segments && result.segments.length > 0 ? { segments: result.segments } : {}),
        status: result.status,
        errorCode: result.errorCode,
        researchStage,
        questions: result.questions ?? [],
        modelAlias: result.entry.alias,
        effort: result.effort ?? null,
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
  // API safety: history must start with a user turn. Walk back to the user turn that opened the
  // kept exchange rather than forward past it: walking forward from a lone assistant reply kept
  // the reply and dropped the question and its files.
  let start = history.length - keepCount;
  while (start > 0 && history[start]!.role !== 'user') start--;
  const slice = history.slice(start);

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

/** G13: a provider refusal as the typed error the client switches on. */
export function refusalError(event: { category: string | null; explanation: string | null }): ApiError {
  const why = event.explanation ?? (event.category ? `Category: ${event.category}.` : null);
  return new ApiError('model_refused', {
    ...(why ? { detail: `The model declined to answer. ${why}` } : {}),
    meta: { category: event.category },
  });
}

function isTurnDeadline(reason: unknown): reason is ApiError {
  return reason instanceof ApiError && reason.code === 'turn_deadline_exceeded';
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
          'This image exceeds the selected model\'s 5 MB image limit. ' +
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
        'This image exceeds the selected model\'s 5 MB image limit. ' +
        'Upload a smaller image or select Gemini 3.8 Flash, which supports larger files.',
    };
  }
  const api = new ApiError('provider_error');
  return { code: api.code, title: api.title, detail: api.detail };
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

/** A show_widget call being written: its code so far, titled by its first loading message. */
export function visualDrafts(input: Record<string, unknown>, callKey: string): { draftId: string; title: string; html: string }[] {
  if (typeof input.widget_code !== 'string') return [];
  const loading = Array.isArray(input.loading_messages) ? input.loading_messages.find((m) => typeof m === 'string') : undefined;
  const title = typeof loading === 'string' ? loading : typeof input.title === 'string' ? input.title : '';
  return [{ draftId: `${callKey}:0`, title, html: input.widget_code }];
}
