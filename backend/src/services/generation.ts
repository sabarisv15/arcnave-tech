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
import type { ModelRegistry } from '../providers/registry.js';
import { ProviderGateway } from '../providers/gateway.js';
import type { ModelInputStore } from './attachments/modelInputStore.js';
import { TurnLog } from './turnLog.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import type { CapabilityRegistry } from '../capabilities/registry.js';
import { TurnTiming } from './turnTiming.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import type { SandboxClient } from '../tools/sandbox/client.js';
import type { SkillService } from './skills.js';
import type { ObjectStorage } from './storage.js';
import type { Retriever } from './retrieval.js';
import type { UsageService } from './usage.js';
import type { TurnServices } from './turn/services.js';
import type { HelperJobs } from './helpers/helperJobs.js';
import type { StreamEvent } from './turn/events.js';
import type { GenerateInput } from './turn/input.js';
import { createTurnState, type TurnLogOutcome, type TurnState } from './turn/turnState.js';
import { logEvent } from '../observability/logEvent.js';
import { settleTurn } from './turn/settle.js';
import { forcedAnswer } from './turn/forcedAnswer.js';
import { streamAndCollect, type TurnHop } from './turn/streamAndCollect.js';
import { loadHistory } from './turn/context.js';
import { buildTurnContext } from './turn/turnContext.js';
import { compactStage, prepareTurn } from './turn/prepareTurn.js';
import { MemoryService } from './memory/memoryService.js';
import { CompactionService } from './compaction/compactionService.js';
import { ChatSearch } from './memory/chatSearch.js';

/** The database-backed stores a turn reads (A-16): the container builds them once. */
export interface TurnStores {
  memory: MemoryService;
  compaction: CompactionService;
  chatSearch: ChatSearch;
}

const log = logger.child({ module: 'generation' });

/** Runs a stage generator whose events are not sent (a quiet rebuild) and returns its result. */
async function drain<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  for (;;) {
    const step = await gen.next();
    if (step.done) return step.value;
  }
}

// Every name this module exported before the split is still exported from it (ADR-0067).
export type { ModelInfo, PresentedFileDto, SourceDto, StreamEvent, UsageDto } from './turn/events.js';
export { presentedFiles, toSourceDto, toUsageDto } from './turn/events.js';
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
    /** P13 (ADR-0080): the helper jobs (title, summary, router shadow). */
    helperJobs?: HelperJobs,
    /** P11 (ADR-0081): one per instance (the container's); a script gets its own. */
    gateway?: ProviderGateway,
    /** P21 (A-16): the container's; built on `db` when a script constructs this service alone. */
    stores?: TurnStores,
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
      helperJobs,
      gateway: gateway ?? new ProviderGateway(cfg),
      memory: stores?.memory ?? new MemoryService(db),
      compaction: stores?.compaction ?? new CompactionService(db),
      chatSearch: stores?.chatSearch ?? new ChatSearch(db),
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
    // ER-4f: the gateway starts no retry and no hop past this instant.
    const deadlineAt = Date.now() + this.cfg.TURN_DEADLINE_MS;
    try {
      yield* this.runTurn({ ...input, signal: deadline.signal, deadlineAt });
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
    // P22: read by the turn's coded log line once the turn has ended.
    let finished: { state: TurnState; entry: { alias: string; provider: string; providerModelId?: string | undefined } } | undefined;

    try {
      // Attachments are not copied into the workspace up front. A tool that needs one names its
      // fileId and the runtime materialises exactly that file (G26, G15): current and historical
      // attachments take the same path, and nothing is downloaded for turns that never use it.
      const prepared = await prepareTurn(this.svc, input, timing, turnLog);
      input = prepared.input;
      const { prefs, project, entry, provider, grounded, modelInfo } = prepared;

      yield {
        type: 'start',
        messageId: input.messageId,
        chatId: input.chatId,
        requestId: input.requestId,
        model: modelInfo,
      };
      // P11 (K-15): the model asked for was unavailable; the label goes out at once.
      if (prepared.switched) {
        yield { type: 'model_switch', from: prepared.switched.from, to: entry.alias, reason: prepared.switched.reason };
      }

      const { compactedNow, latestCompaction, history } = yield* compactStage(this.svc, input, {
        prefs,
        entry,
        provider,
        latestCompaction: prepared.latestCompaction,
        history: prepared.history,
        timing,
        turnLog,
      });

      const { request, routingDecision, loadedSkills, contextEvents, reasoningEffort, segments, pendingUiEvents } =
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
      finished = { state, entry };
      if (prepared.switched) state.fallback = { from: prepared.switched.from, reason: prepared.switched.reason };
      // P11 (7.12, ER-14b): the turn rebuilt for the next model of its chain, quietly (its context
      // events were already sent); the history is read again for that model's window.
      const turnInput = input;
      const hop: TurnHop = {
        needs: prepared.needs,
        entries: await this.svc.registry.availableEntries({ probe: 'never' }),
        canServe: (e) => {
          const p = this.svc.registry.providerFor(e);
          if (!p) return false;
          if (turnInput.mode !== 'chat' && !(e.supportsGrounding && p.supportsGrounding())) return false;
          if (turnInput.codeExecution && !(p.supportsCodeExecution?.() ?? false)) return false;
          return true;
        },
        build: async (next) => {
          const nextProvider = this.svc.registry.providerFor(next);
          if (!nextProvider) return null;
          const { turns: nextHistory } = await loadHistory(this.svc, turnInput.chatId, turnInput.messageId, latestCompaction?.throughSeq, next.alias);
          const nextGrounded = next.supportsGrounding && nextProvider.supportsGrounding() && (turnInput.mode !== 'chat' || Boolean(this.cfg.ENABLE_WEB));
          const built = await drain(
            buildTurnContext(this.svc, turnInput, {
              prefs,
              project,
              history: nextHistory,
              entry: next,
              grounded: nextGrounded,
              compactedNow,
              latestCompaction,
              workspace,
              timing,
              turnLog,
              quiet: true,
            }),
          );
          return {
            target: { entry: next, provider: nextProvider, request: built.request },
            reasoningEffort: built.reasoningEffort,
            pendingUiEvents: built.pendingUiEvents,
            segments: built.segments,
          };
        },
      };
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
          addSegment,
          pendingUiEvents,
          hop,
        })
      ) {
        return;
      }

      // --- persist ----------------------------------------------------------
      let text = state.collectedText.join('');
      // After a hop the forced answer and the settle are the serving model's.
      const served = state.served ?? { entry, provider, request, reasoningEffort };

      text = yield* forcedAnswer(
        state,
        { request: served.request, provider: served.provider, entry: served.entry, gateway: this.svc.gateway, signal: input.signal, ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}), turnLog, addSegment },
        text,
      );

      yield* settleTurn(this.svc, input, state, {
        entry: served.entry,
        prefs,
        text,
        reasoningEffort: served.reasoningEffort,
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
      // LG-3 / OD-8 (P22): one coded, allowlisted line per turn, replacing "turn timing".
      const summary = timing.summary();
      const usage = finished?.state.usage;
      logEvent(log, 'chat_turn_finished', {
        ...summary,
        turnId: input.turn?.turnId,
        chatId: input.chatId,
        messageId: input.messageId,
        requestId: input.requestId,
        status: logOutcome.status,
        finishReason: logOutcome.finishReason ?? null,
        errorCode: logOutcome.errorCode ?? null,
        // After a hop, the model that answered (P11).
        modelAlias: (finished?.state.served?.entry ?? finished?.entry)?.alias,
        provider: (finished?.state.served?.entry ?? finished?.entry)?.provider,
        providerModelId: (finished?.state.served?.entry ?? finished?.entry)?.providerModelId,
        callCount: finished?.state.calls.length ?? 0,
        tokensExact: usage?.exact ?? false,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        cacheReadTokens: usage?.cacheReadTokens,
        cacheWriteTokens: usage?.cacheWriteTokens,
        costUsd: finished ? this.svc.usage.turnCost(finished.state.calls, startedAt) : null,
        providerTtftMs: finished?.state.clocks.providerTtftMs ?? null,
        firstVisibleMs: finished?.state.clocks.firstVisibleMs ?? null,
        turnTotalMs: summary.totalMs,
      });
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
