/**
 * The helper jobs a turn starts (ADR-0080): the title job and the summary job after the settle,
 * the router shadow after the model is picked. Each runs in the background of this process,
 * never awaited by the turn, never failing it; each writes one coded log line with ids, codes,
 * counts and durations only (Stage 17 NO_CONTENT). No durable job queue yet (N-76's worker is
 * deferred): a job lost to a restart is simply not run, and the history stays whole.
 */
import type { Logger } from 'pino';

import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import type { ModelEntry, ModelRegistry } from '../../providers/registry.js';
import type { CallUsage } from '../../providers/types.js';
import type { LedgerService } from '../ledger.js';
import { classifyTurn } from '../routing/routerShadow.js';
import { runSummaryJob } from '../summary/summaryJob.js';
import type { HelperCallUsage } from './helperCall.js';
import { runTitleJob } from './titleJob.js';

export interface SettledTurnInfo {
  userId: string;
  chatId: string;
  messageId: string;
  /** How the turn ended; the jobs run after a complete one only. */
  status: 'complete' | 'error' | 'cancelled';
  /** The chat model's registry row: its family's count API counts the summary trigger. */
  entry: ModelEntry;
}

/** The token counts of a helper call, for its log line (the usage the ledger will record, P22). */
function callFields(call: HelperCallUsage | null | undefined): Record<string, unknown> {
  if (!call) return {};
  return {
    role: call.role,
    providerModelId: call.providerModelId,
    inputTokens: call.usage.exact ? call.usage.inputTokens : null,
    outputTokens: call.usage.exact ? call.usage.outputTokens : null,
    usageSource: call.usageSource,
    finishReason: call.finishReason,
    durationMs: call.durationMs ?? null,
  };
}

export class HelperJobs {
  private readonly running = new Set<Promise<void>>();
  private readonly stop = new AbortController();

  constructor(
    private readonly deps: { db: Database; cfg: Config; registry: ModelRegistry; log: Logger; ledger?: LedgerService },
  ) {}

  /**
   * A helper call's row in the model-call ledger (ADR-0079 / ADR-0080, wave plan §4): its own
   * row, priced on its own, with no usage record (a helper is not the turn's answer). A ledger
   * write that fails costs the row, never the job: a coded line, nothing else.
   */
  private async record(turn: { userId: string; chatId: string; messageId: string }, call: HelperCallUsage | null | undefined): Promise<void> {
    if (!call || !this.deps.ledger) return;
    const { providerRef: _ref, ...rest } = call;
    const row: CallUsage = { ...rest, startedAt: new Date(Date.now() - (call.durationMs ?? 0)) };
    try {
      await this.deps.ledger.recordCalls(this.deps.db, {
        usageRecordId: null,
        turnId: null,
        userId: turn.userId,
        chatId: turn.chatId,
        messageId: turn.messageId,
        // The helper row is Claude Haiku 5.5 only (ADR-0080).
        provider: 'anthropic',
        startedAt: row.startedAt!,
      }, [row]);
    } catch (err) {
      this.deps.log.warn({ code: 'helper_ledger_failed', role: call.role, errorType: err instanceof Error ? err.name : typeof err }, 'helper job');
    }
  }

  /** After the settle transaction committed. Never awaited by the turn, never throws. */
  afterSettle(turn: SettledTurnInfo): void {
    if (turn.status !== 'complete') return;
    this.track(this.title(turn));
    if (this.deps.cfg.ENABLE_HISTORY_SUMMARY) this.track(this.summary(turn));
  }

  /** After the rules picked the model: the router's own pick, logged only. Off: no call at all. */
  routerShadow(turn: { userId: string; chatId: string; messageId: string; prompt: string; resolvedAlias: string }): void {
    if (!this.deps.cfg.ROUTER_SHADOW) return;
    this.track(
      classifyTurn(this.deps.registry, turn.prompt, this.stop.signal).then(async (r) => {
        await this.record(turn, r.call);
        this.deps.log.info(
          {
            code: 'router_shadow',
            chatId: turn.chatId,
            messageId: turn.messageId,
            status: r.status,
            intent: r.intent,
            tier: r.tier,
            errorCode: r.code,
            resolvedAlias: turn.resolvedAlias,
            durationMs: r.durationMs,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
          },
          'helper job',
        );
      }),
    );
  }

  /** Every job started so far has ended (tests; a drain may await it too). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  /** Abort the jobs in flight (shutdown). */
  close(): void {
    this.stop.abort();
  }

  private track(job: Promise<void>): void {
    const tracked = job
      .catch((err: unknown) => {
        // A job never fails the turn; its own failure is a code, never its message (NO_CONTENT).
        this.deps.log.warn({ code: 'helper_job_failed', errorType: err instanceof Error ? err.name : typeof err }, 'helper job');
      })
      .finally(() => this.running.delete(tracked));
    this.running.add(tracked);
  }

  private async title(turn: SettledTurnInfo): Promise<void> {
    const r = await runTitleJob(this.deps, turn, this.stop.signal);
    await this.record(turn, r.call);
    this.deps.log.info(
      {
        code: r.code,
        chatId: turn.chatId,
        messageId: turn.messageId,
        ...(r.code === 'title_skipped' ? { reason: r.reason } : { titleChars: Array.from(r.title).length }),
        ...callFields(r.call),
      },
      'helper job',
    );
  }

  private async summary(turn: SettledTurnInfo): Promise<void> {
    const r = await runSummaryJob(
      this.deps,
      { chatId: turn.chatId, messageId: turn.messageId, countProvider: this.deps.registry.providerFor(turn.entry) },
      this.stop.signal,
    );
    await this.record(turn, r.call);
    this.deps.log.info(
      {
        code: r.code,
        chatId: turn.chatId,
        messageId: turn.messageId,
        ...(r.code === 'summary_skipped'
          ? { reason: r.reason }
          : { summaryVersion: r.summaryVersion, coversUptoSeq: r.coversUptoSeq, coveredTurns: r.coveredTurns }),
        ...callFields(r.call),
      },
      'helper job',
    );
  }
}
