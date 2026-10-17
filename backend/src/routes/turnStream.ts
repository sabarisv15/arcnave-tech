/**
 * The SSE side of a durable turn (Stage 14 D-26 / D-29, ADR-0078). One connection, two sources:
 *
 * - **The hub** (the run is on this instance): the buffered frames after the client's last id,
 *   then live ones. Each frame's `id:` is its index in the run.
 * - **The store** (the run is on another instance, finished, or the buffer no longer holds the
 *   gap): a `snapshot` frame with the stored assistant row (its `id:` is `turns.last_seq`, the
 *   index the row covers), then the row polled every N-73 250 ms, a new snapshot whenever it
 *   moved, until the turn ends.
 *
 * Every connection also gets a named `ping` frame every N-24 15 s (no `id:`, so it never moves the
 * client's position), a send timeout (a frame the socket has not taken within N-73 15 s ends the
 * connection), and a session + chat re-check every N-73 60 s: a revoked session ends the stream
 * with an `error` frame `unauthorized`, a deleted chat with `not_found`.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { chats, turns, type TurnRow } from '../db/schema.js';
import { ApiError } from '../errors.js';
import type { Run } from '../services/runHub.js';
import { ACTIVE_STATES } from '../services/turn/turnStore.js';

/** Where a reconnect resumes: `Last-Event-ID` wins over `?after=` (Stage 14 D-26). */
export function resumeFrom(request: FastifyRequest, after: number | undefined): number {
  const header = request.headers['last-event-id'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value !== undefined && /^-?\d{1,9}$/.test(value.trim())) return Math.max(-1, Number(value.trim()));
  return after ?? -1;
}

/** One open event stream, with its ping, send timeout and re-check. */
export class SseConnection {
  private readonly timers: NodeJS.Timeout[] = [];
  private sendTimer: NodeJS.Timeout | undefined;
  private ended = false;
  private resolveClosed!: () => void;
  /** Resolves when the stream ended, from either side. */
  readonly closed = new Promise<void>((resolve) => {
    this.resolveClosed = resolve;
  });

  constructor(
    private readonly request: FastifyRequest,
    private readonly reply: FastifyReply,
    recheck: { userId: string; chatId: string },
  ) {
    const { cfg } = request.services;
    // A-26: the stream is written to the socket, so Fastify is told it no longer sends this reply;
    // the head carries what the plugins set on the reply in their hooks (@fastify/cors, the rate
    // limiter) and, through Node's setHeader merge, the security plugin's headers. No CORS here.
    reply.hijack();
    const fromPlugins = Object.fromEntries(Object.entries(reply.getHeaders()).filter(([, v]) => v !== undefined)) as Record<string, string | string[] | number>;
    reply.raw.writeHead(200, {
      ...fromPlugins,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-ID': request.id,
    });
    request.raw.on('close', this.onClose);
    const ping = setInterval(() => this.write('event: ping\ndata: {"type":"ping"}\n\n'), cfg.SSE_PING_MS);
    ping.unref();
    const again = setInterval(() => void this.recheck(recheck.userId, recheck.chatId), cfg.SSE_SESSION_RECHECK_MS);
    again.unref();
    this.timers.push(ping, again);
  }

  private readonly onClose = (): void => this.end();

  get isOpen(): boolean {
    return !this.ended && !this.reply.raw.writableEnded;
  }

  /** One frame; `id` only for frames that are a position in the run. */
  frame(event: { type: string }, id?: number): void {
    const head = id !== undefined && id >= 0 ? `id: ${String(id)}\n` : '';
    this.write(`${head}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private write(chunk: string): void {
    if (!this.isOpen) return;
    const flushed = this.reply.raw.write(chunk);
    if (flushed || this.sendTimer) return;
    // The socket is not taking frames: a client gone without a close, or one that cannot keep up.
    this.sendTimer = setTimeout(() => this.end(), this.request.services.cfg.SSE_SEND_TIMEOUT_MS);
    this.sendTimer.unref();
    this.reply.raw.once('drain', () => {
      clearTimeout(this.sendTimer);
      this.sendTimer = undefined;
    });
  }

  private async recheck(userId: string, chatId: string): Promise<void> {
    if (!this.isOpen) return;
    const { services } = this.request;
    try {
      const token = this.request.cookies[services.cfg.SESSION_COOKIE_NAME];
      const unsigned = token ? this.request.unsignCookie(token) : null;
      const user = unsigned?.valid && unsigned.value ? await services.auth.resolve(unsigned.value) : null;
      if (!user || user.id !== userId) return this.fail(new ApiError('unauthorized'));
      const [chat] = await services.db
        .select({ id: chats.id })
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, userId), isNull(chats.deletedAt)))
        .limit(1);
      if (!chat) return this.fail(new ApiError('not_found', { detail: 'This conversation was deleted.' }));
    } catch {
      // benign: A failed check is not a revoked session; the next one decides.
    }
  }

  private fail(err: ApiError): void {
    this.frame({ type: 'error', code: err.code, title: err.title, detail: err.detail } as { type: string });
    this.end();
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) clearInterval(t);
    clearTimeout(this.sendTimer);
    this.request.raw.off('close', this.onClose);
    if (!this.reply.raw.writableEnded) this.reply.raw.end();
    this.resolveClosed();
  }
}

/** What a `snapshot` frame carries. */
export interface SnapshotFrame {
  type: 'snapshot';
  turnId: string;
  state: string;
  seq: number;
  message: unknown;
}

export type SnapshotOf = (turn: TurnRow) => Promise<SnapshotFrame>;

/** What `streamLive` writes to (an `SseConnection`; a fake in tests). */
export type LiveConnection = Pick<SseConnection, 'frame' | 'end' | 'closed'>;

/**
 * A run on this instance: the frames after `after`, then live ones until it ends. When the buffer
 * no longer holds the frames after `after`, the stored row goes first as a `snapshot`, and the
 * live frames resume after it only when the buffer still holds every frame after the snapshot.
 * Otherwise (the flushed row is older than the buffer's head, or there is none) resuming live
 * would skip the frames in between, so the connection follows the stored row instead (`stored`:
 * polled until the turn ends, then its final row; review R7).
 */
export async function streamLive(
  conn: LiveConnection,
  run: Run,
  after: number,
  snapshot: () => Promise<SnapshotFrame | null>,
  stored: () => Promise<void>,
): Promise<void> {
  let from = after;
  if (!run.canReplayFrom(from)) {
    const snap = await snapshot();
    if (!snap || !run.canReplayFrom(snap.seq)) {
      await stored();
      return;
    }
    conn.frame(snap, snap.seq);
    from = snap.seq;
  }
  const unsubscribe = run.subscribe(from, (event, index) => conn.frame(event, index), () => conn.end());
  await conn.closed;
  unsubscribe?.();
}

/**
 * A run this instance does not hold: the stored row, then the row again every N-73 250 ms while
 * the turn is active, a new `snapshot` whenever it moved, and the final row once the turn ended.
 */
export async function streamStored(
  conn: SseConnection,
  request: FastifyRequest,
  turnId: string,
  snapshotOf: SnapshotOf,
): Promise<void> {
  const { db, cfg } = request.services;
  let sentSeq: number | null = null;
  while (conn.isOpen) {
    const [turn] = await db.select().from(turns).where(eq(turns.id, turnId)).limit(1);
    if (!turn) break;
    const active = (ACTIVE_STATES as readonly string[]).includes(turn.state);
    if (!active || turn.lastSeq !== sentSeq) {
      const snap = await snapshotOf(turn);
      conn.frame(snap, snap.seq);
      sentSeq = turn.lastSeq;
    }
    if (!active) break;
    await Promise.race([new Promise((r) => setTimeout(r, cfg.SSE_RELAY_POLL_MS)), conn.closed]);
  }
  conn.end();
}
