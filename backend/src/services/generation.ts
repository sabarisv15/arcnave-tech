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
import { asc } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { turnLogs } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import { type ModelRegistry, AUTO_ALIAS } from '../providers/registry.js';
import type { ModelInputStore } from './attachments/modelInputStore.js';
import { TurnLog } from './turnLog.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import type { CapabilityRegistry } from '../capabilities/registry.js';
import { TurnTiming } from './turnTiming.js';
import { compactionService } from './compaction/compactionService.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import type { SandboxClient } from '../tools/sandbox/client.js';
import type { SkillService } from './skills.js';
import type { ObjectStorage } from './storage.js';
import type { Retriever } from './retrieval.js';
import type { UsageService } from './usage.js';
import type { TurnServices } from './turn/services.js';
import type { StreamEvent, ModelInfo } from './turn/events.js';
import type { GenerateInput } from './turn/input.js';
import { loadPreferences, loadProject, loadHistory, compactIfNeeded } from './turn/context.js';
import { resolveModel } from './turn/modelRouting.js';
import { createTurnState, type TurnLogOutcome } from './turn/turnState.js';
import { settleTurn } from './turn/settle.js';
import { forcedAnswer } from './turn/forcedAnswer.js';
import { streamAndCollect } from './turn/streamAndCollect.js';
import { buildTurnContext } from './turn/turnContext.js';

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
    const logOutcome: TurnLogOutcome = {
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

    const { request, routingDecision, loadedSkills, contextEvents, reasoningEffort, releaseReservation, segments, pendingUiEvents } =
      yield* buildTurnContext(this.svc, input, {
        prefs,
        project,
        history,
        entry,
        grounded,
        compactedNow,
        latestCompaction,
        workspace,
        timing,
        turnLog,
      });

    const state = createTurnState(segments, contextEvents.length);
    const addSegment = (type: 'thinking' | 'text', text: string) => {
      const last = state.segments.at(-1);
      if (last && last.type === type) last.text += text;
      else state.segments.push({ type, text });
    };
    if (
      yield* streamAndCollect(this.svc, input, state, {
        provider,
        request,
        entry,
        prefs,
        reasoningEffort,
        startedAt,
        timing,
        turnLog,
        logOutcome,
        releaseReservation,
        addSegment,
        pendingUiEvents,
      })
    ) {
      return;
    }

    // --- persist ----------------------------------------------------------
    let text = state.collectedText.join('');

    text = yield* forcedAnswer(state, { request, provider, turnLog, addSegment }, text);

    yield* settleTurn(this.svc, input, state, {
      entry,
      prefs,
      text,
      reasoningEffort,
      turnLog,
      logOutcome,
      startedAt,
      allowedTools: routingDecision.allowedTools,
      loadedSkills,
    });
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
