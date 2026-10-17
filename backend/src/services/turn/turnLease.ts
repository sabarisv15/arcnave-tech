/**
 * The runner's side of a durable turn (P08, ADR-0078): it renews the turn's lease (N-73 heartbeat
 * 10 s, lease 30 s), reads the cancel flag a Stop on any instance sets (N-73 2 s), and writes the
 * answer so far to the message row at most every TURN_FLUSH_MS. Every write is fenced on the
 * turn's token: when one finds the token moved (the sweeper took the turn over) the run is aborted
 * with `interrupted` and writes nothing more.
 */
import { and, eq, sql } from 'drizzle-orm';

import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { messages, turns, type MessageSegment } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { errorLogFields } from '../../errorLog.js';
import { logger } from '../../logger.js';
import type { TurnCheckpoint } from './input.js';
import type { TurnBinding } from './turnStore.js';

const log = logger.child({ module: 'turns' });

/** `now() + ms`, on the database's clock: every instance compares leases on that one clock. */
export function dbNowPlus(ms: number) {
  return sql<Date>`now() + (${Math.trunc(ms)} * interval '1 millisecond')`;
}

export class TurnRuntime implements TurnCheckpoint {
  private heartbeat: NodeJS.Timeout | undefined;
  private cancelCheck: NodeJS.Timeout | undefined;
  private lastFlushAt = 0;
  private busy = false;
  /** True once a fenced write found the lease gone. */
  lost = false;
  /** True once this runner's own settle committed: the turn ended here, so nothing is lost. */
  settled = false;

  constructor(
    private readonly db: Database,
    private readonly cfg: Pick<Config, 'TURN_LEASE_MS' | 'TURN_HEARTBEAT_MS' | 'TURN_CANCEL_CHECK_MS' | 'TURN_FLUSH_MS'>,
    readonly binding: TurnBinding,
    private readonly messageId: string,
    private readonly controller: AbortController,
    /** The index of the last stream event published: what a flushed row covers. */
    private readonly publishedSeq: () => number,
  ) {
    binding.onSettled = () => this.markSettled();
  }

  /** The settle committed: stop the timers, and treat any tick still in flight as moot. */
  markSettled(): void {
    this.settled = true;
    this.stop();
  }

  start(): void {
    this.heartbeat = setInterval(() => void this.renew(), this.cfg.TURN_HEARTBEAT_MS);
    this.heartbeat.unref();
    this.cancelCheck = setInterval(() => void this.checkCancel(), this.cfg.TURN_CANCEL_CHECK_MS);
    this.cancelCheck.unref();
  }

  stop(): void {
    clearInterval(this.heartbeat);
    clearInterval(this.cancelCheck);
  }

  private fenced() {
    return and(eq(turns.id, this.binding.turnId), eq(turns.fencingToken, this.binding.fencingToken), eq(turns.state, 'running'));
  }

  private lose(): void {
    if (this.lost || this.settled) return;
    this.lost = true;
    this.stop();
    log.warn({ turnId: this.binding.turnId }, 'turn lease lost; stopping the run');
    if (!this.controller.signal.aborted) this.controller.abort(new ApiError('interrupted'));
  }

  /** Renews the lease; a renewal that finds no row means another instance owns the turn now. */
  async renew(): Promise<void> {
    if (this.lost || this.settled || this.controller.signal.aborted) return;
    try {
      const [row] = await this.db
        .update(turns)
        .set({ heartbeatAt: sql`now()`, leaseExpiresAt: dbNowPlus(this.cfg.TURN_LEASE_MS) })
        .where(this.fenced())
        .returning({ cancel: turns.cancelRequested });
      if (!row) this.lose();
      else if (row.cancel && !this.settled) this.controller.abort();
    } catch (err) {
      // The database is unreachable: the lease may lapse, and the sweeper decides. Nothing here.
      log.warn({ turnId: this.binding.turnId, ...errorLogFields(err) }, 'turn heartbeat failed');
    }
  }

  /** A Stop sent to any instance sets the flag; this one notices within N-73's 2 s. */
  async checkCancel(): Promise<void> {
    if (this.lost || this.settled || this.controller.signal.aborted || this.busy) return;
    this.busy = true;
    try {
      const [row] = await this.db
        .select({ cancel: turns.cancelRequested, token: turns.fencingToken, state: turns.state })
        .from(turns)
        .where(eq(turns.id, this.binding.turnId))
        .limit(1);
      if (!row || row.token !== this.binding.fencingToken || row.state !== 'running') this.lose();
      else if (row.cancel && !this.settled) this.controller.abort();
    } catch (err) {
      log.warn({ turnId: this.binding.turnId, ...errorLogFields(err) }, 'turn cancel check failed');
    } finally {
      this.busy = false;
    }
  }

  /**
   * The answer so far to the message row, with the stream index it covers (`turns.last_seq`): a
   * reconnect that lands on another instance is sent this row as a `snapshot`, and a run that dies
   * keeps it. Throttled to TURN_FLUSH_MS unless forced.
   */
  async flush(answer: { text: string; thinking: string; segments: unknown[] }, force = false): Promise<void> {
    if (this.lost) return;
    const now = Date.now();
    if (!force && now - this.lastFlushAt < this.cfg.TURN_FLUSH_MS) return;
    this.lastFlushAt = now;
    const seq = this.publishedSeq();
    try {
      const held = await this.db.transaction(async (tx) => {
        const [row] = await tx.update(turns).set({ lastSeq: seq }).where(this.fenced()).returning({ id: turns.id });
        if (!row) return false;
        await tx
          .update(messages)
          .set({
            text: answer.text,
            thinking: answer.thinking || null,
            ...(answer.segments.length > 0 ? { segments: answer.segments as MessageSegment[] } : {}),
          })
          .where(and(eq(messages.id, this.messageId), eq(messages.status, 'generating')));
        return true;
      });
      if (!held) this.lose();
    } catch (err) {
      log.warn({ turnId: this.binding.turnId, ...errorLogFields(err) }, 'turn flush failed');
    }
  }
}
