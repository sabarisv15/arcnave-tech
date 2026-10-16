/**
 * Generation orchestration.
 *
 * The turn generator. Its stages live in `services/turn/` (ADR-0067): `context*.ts` builds the
 * context, `modelRouting.ts` picks the model, `toolset.ts` builds the tool executors,
 * `providerLoop.ts` retries the provider stream, and `persistence.ts` writes the rows.
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
import { asc } from 'drizzle-orm';
import { AnswerProtocolGuard } from './answerProtocolGuard.js';
import { sandboxReadsOfficeFiles, usesWarmSandbox } from '../tools/catalog.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { turnLogs, type MessageSegment } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { type ModelRegistry, AUTO_ALIAS } from '../providers/registry.js';
import { effortFor, getModelCapability } from '../providers/capabilitiesTable.js';
import { type AttachmentBlock, type GenerationRequest, type HistoryToolCall, type ProviderSource, type ProviderUsage, type ReasoningEffort, addRequestUsage, EMPTY_USAGE, isAbort, ModelNotFoundError, toolCallAsText, toolResultPreview, withoutImageBytes } from '../providers/types.js';
import { buildAttachmentManifest, contextNote } from './attachments/manifest.js';
import type { ModelInputStore } from './attachments/modelInputStore.js';
import { applyFileBudget, applyManyImagesRule, familyOf, useNormalisedImages } from './attachments/fileBudget.js';
import { ProjectToolRegistry } from '../tools/registry.js';
import { TurnLog } from './turnLog.js';
import { buildWebSearchAdapter } from './webSearch.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import type { CapabilityRegistry } from '../capabilities/registry.js';
import { StreamTimeSplit, TurnTiming } from './turnTiming.js';
import { compactionService } from './compaction/compactionService.js';
import { WEB_FETCH_WITH_BUILT_IN_SEARCH } from '../tools/definitions.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import type { SandboxClient } from '../tools/sandbox/client.js';
import type { SkillService } from './skills.js';
import type { ObjectStorage } from './storage.js';
import type { Retriever } from './retrieval.js';
import { usdToInr, type UsageService } from './usage.js';
import { routeTurn, type RuntimeDebugTrace } from './routing/turnRouter.js';
import type { TurnServices } from './turn/services.js';
import { type StreamEvent, presentedFiles, type ModelInfo, toUsageDto, toSourceDto, computeCostFor } from './turn/events.js';
import type { GenerateInput } from './turn/input.js';
import { loadPreferences, loadProject, loadHistory, compactIfNeeded, previousContextTokens as previousContextTokensOf } from './turn/context.js';
import { readOfficeFilesWithCode, chatFilesOf, hydrateAttachmentBytes, limitToModel, hydrateHistoryAttachments } from './turn/contextAttachments.js';
import { buildSkillsContext, buildSystemInstruction } from './turn/contextPrompt.js';
import { resolveModel } from './turn/modelRouting.js';
import { buildToolExecutors } from './turn/toolset.js';
import { streamWithRetry, FailedAfterToolRun, refusalError, isTurnDeadline, mapProviderError, visualDrafts } from './turn/providerLoop.js';
import { persistEvent, persistToolCall, finalise } from './turn/persistence.js';

const log = logger.child({ module: 'generation' });

// Every name this module exported before the split is still exported from it (ADR-0067).
export type { ModelInfo, PresentedFileDto, SourceDto, StreamEvent, UsageDto } from './turn/events.js';
export { computeCostFor, presentedFiles, toSourceDto, toUsageDto } from './turn/events.js';
export type { AgentLoopInput, GenerateInput, PreferencesRow } from './turn/input.js';
export { readOfficeFilesWithCode } from './turn/contextAttachments.js';
export {
  FailedAfterToolRun,
  isContextOverflowError,
  mapProviderError,
  reduceHistoryForOverflow,
  refusalError,
  retryDelayMs,
  visualDrafts,
} from './turn/providerLoop.js';
export { asc };

export class GenerationService {
  private readonly capabilities: CapabilityRegistry;
  private readonly executionRuntime: ExecutionRuntime;
  /** What the stage functions read in place of `this` (ADR-0067). */
  private readonly svc: TurnServices;

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
    this.svc = {
      db,
      cfg,
      registry,
      usage,
      retriever,
      storage,
      sandboxClient,
      skills,
      capabilities: this.capabilities,
      executionRuntime: this.executionRuntime,
      modelInputs,
    };
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
      const prefs = await loadPreferences(this.svc, input.userId);

    const project = input.projectId ? await loadProject(this.svc, input.userId, input.projectId) : null;
    let latestCompaction = this.cfg.ENABLE_CONTEXT_COMPACTION
      ? await compactionService.getLatestCompaction(input.chatId, this.db)
      : null;
    // Loaded before model resolution (not its historical position) because whether this turn
    // needs a vision-capable model depends on what's carried forward, not only on what's newly
    // attached. Its character backstop is the model's window, so it is sized by a named model
    // only; under Auto this first read keeps every turn, and the history is read again for the
    // resolved model below (D2 X-2: `Auto` has no window and fell back to 128,000 tokens).
    let historyAlias: string | null = input.modelAlias === AUTO_ALIAS ? null : input.modelAlias;
    const loaded = await loadHistory(
      this.svc,
      input.chatId,
      input.messageId,
      latestCompaction?.throughSeq,
      historyAlias,
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
    const { entry, routing } = await resolveModel(
      this.svc,
      input,
      prefs,
      requiresGrounding,
      requiresVision,
      project?.instructions.length ?? 0,
    );
    timing.mark('model_resolve');
    if (historyAlias !== entry.alias) {
      historyAlias = entry.alias;
      ({ turns: history } = await loadHistory(this.svc, input.chatId, input.messageId, latestCompaction?.throughSeq, historyAlias));
    }
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
      const compacted = yield* compactIfNeeded(this.svc, input, prefs, entry, provider);
      compactedNow = compacted;
      timing.mark('compaction');
      timing.note('compacted', compacted);
      turnLog.stage('compaction', { compacted });
      if (compacted) {
        latestCompaction = await compactionService.getLatestCompaction(input.chatId, this.db);
        ({ turns: history } = await loadHistory(this.svc, input.chatId, input.messageId, latestCompaction?.throughSeq, entry.alias));
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
    const { skillsContext, loadedSkills, skillsEnabled } = await buildSkillsContext(this.svc, input, activeToolNames, latestCompaction);

    // --- assemble context -------------------------------------------------
    timing.mark('skills_tools');
    turnLog.stage('skills', {
      enabled: skillsEnabled,
      listed: skillsEnabled ? this.skills!.listSkills(activeToolNames).filter((s) => s.missingTools.length === 0).map((s) => s.name) : [],
      reinjectedAfterCompaction: loadedSkills.map((s) => s.name),
    });
    const { systemInstruction, contextEvents, promptAssembly } = await buildSystemInstruction(
      this.svc,
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
      await persistEvent(this.svc, input.messageId, event);
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

    // The answer in the order it happened: thinking, text and tool steps
    // interleaved. Kept on the message so a reload shows the same timeline.
    const segments: MessageSegment[] = [];
    const { pendingUiEvents, toolMap, codeExecutor, toolExecutor } = buildToolExecutors(this.svc, {
      input,
      project,
      availableTools,
      history,
      webEnabled,
      webSearchAdapter,
      memoryEnabled,
      chatSearchEnabled,
      generativeUiEnabled,
      allowCode,
      workspace,
      segments,
    });
    timing.mark('tools_setup');
    turnLog.stage('tool executors', { executors: [...new Set([...toolMap.values()].map((e) => e.constructor.name))] });

    // Images go as their normalised copy (D1 #21); then each file whole or by excerpt, and a
    // PDF's pages by the N-13 budget, for this model family (ADR-0063).
    const normalised = await useNormalisedImages(this.db, input.attachments, history);
    const budgeted = await applyFileBudget(
      this.db,
      familyOf(entry.provider),
      input.prompt,
      await hydrateAttachmentBytes(this.svc, normalised.current),
      await hydrateHistoryAttachments(this.svc, normalised.history, input.prompt, entry.alias),
    );
    const sized = await applyManyImagesRule(this.cfg, budgeted.current, budgeted.history);
    const { current: wireAttachments, history: wireHistory } = await limitToModel(this.svc, entry.alias, sized.current, sized.history, releaseReservation);
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

    const chatFiles = await chatFilesOf(this.svc, input.chatId, allAttachmentsMap);
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

    // The previous request's size, for the turn log only: no adapter shortens a request on it,
    // tool results are never cleared before compaction (ADR-0023, ADR-0064). After a compaction
    // the earlier size no longer describes what is sent.
    const previousContextTokens = compactedNow ? null : await previousContextTokensOf(this.svc, input);
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
    // Set when the provider failed after a tool ran (ER-2b): the turn ends with what it has.
    let endedPartial = false;
    const collectedText: string[] = [];
    const collectedThinking: string[] = [];
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
      const stream = streamWithRetry(this.svc, provider.stream.bind(provider), request);
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
              ...(event.result.errorCode ? { errorCode: event.result.errorCode } : {}),
            };
            await persistToolCall(
              this.svc,
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
            await persistEvent(this.svc, input.messageId, out, eventOrdinal++);
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
      if (err instanceof FailedAfterToolRun && !deadlineHit && !input.signal.aborted) {
        // The answer so far, the tool calls already stored, and a typed code: never a second run
        // of a tool, never a failure presented as a finished answer (done carries `partial`).
        endedPartial = true;
        errorCode = 'partial_after_tool_run';
        finishReason = 'partial';
        const cause = mapProviderError(err.failure).code;
        turnLog.stage('provider failed after a tool ran', { code: cause, toolCalls: toolsCalled.length });
        log.warn({ code: cause, chatId: input.chatId, requestId: input.requestId, toolCalls: toolsCalled.length }, 'provider failed after a tool ran; ending the turn partial');
        const tail = answerGuard.finish();
        if (tail) {
          collectedText.push(tail);
          addSegment('text', tail);
          turnLog.text(tail);
          yield { type: 'delta', text: tail };
        }
      } else if (!deadlineHit && (isAbort(err) || input.signal.aborted)) {
        status = 'cancelled';
      } else {
        status = 'error';
        const mapped = mapProviderError(deadlineHit ? input.signal.reason : err);
        errorCode = mapped.code;
        turnLog.fail(err);
        turnLog.stage('provider failed', { code: mapped.code, deadline: deadlineHit, toolCalls: toolsCalled.length });
        log.error({ err, chatId: input.chatId, requestId: input.requestId }, 'generation failed');
        await finalise(this.svc, input, {
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

    // Guaranteed Final Outcome: synthesize text if tool loop finished blank. Not after a provider
    // failure that ended the turn partial: it ends with what it has (ER-2b).
    if (status === 'complete' && !endedPartial && text.trim().length === 0) {
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

    await finalise(this.svc, input, {
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

      const costUsd = computeCostFor(this.cfg, entry.providerModelId!, usage);
      yield {
        type: 'done',
        questions,
        usage: toUsageDto(usage, costUsd, usdToInr(this.cfg, costUsd)),
        finishReason,
        ...(reasoningEffort ? { effort: reasoningEffort } : {}),
        ...(endedPartial ? { partial: true as const, errorCode: 'partial_after_tool_run' as const } : {}),
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
}
