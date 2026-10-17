/**
 * A generation run outlives the HTTP connection that started it.
 *
 * An answer should keep going when the tab sleeps or the phone's network drops, and the
 * reply should be there when the user comes back. Tying the run to the socket (abort on `close`) threw
 * away minutes of tool work on every blip. Here the run publishes its events to a per-chat
 * buffer; the connection that started it, and any later one that reconnects, are subscribers.
 * Only an explicit stop (or shutdown, or the turn deadline) aborts a run.
 *
 * A cache of the durable turn (ADR-0078), not its record: the `turns` row is the truth, and a
 * reconnect that lands on another instance (or reaches past what this buffer still holds) is sent
 * the stored row as a `snapshot` instead. The hub also keeps each run's promise, so a shutdown can
 * wait for the runs it stopped to settle (`services/shutdown.ts`).
 */
import type { StreamEvent } from './generation.js';

/** Events kept per run by default (RUN_BUFFER_MAX_EVENTS). Past it, a reconnect from before the
 *  dropped part is sent the stored row as a `snapshot` (ADR-0078). */
const MAX_BUFFERED_EVENTS = 50_000;
/** How long a finished run stays replayable, so a client that reconnects just after the end
 *  still receives the final `done`/`error` frame instead of a 404. */
const FINISHED_RETENTION_MS = 5 * 60_000;

export type RunListener = (event: StreamEvent, index: number) => void;

export class Run {
  private readonly events: StreamEvent[] = [];
  /** Index of events[0]; grows when the head is dropped past MAX_BUFFERED_EVENTS. */
  private offset = 0;
  private readonly listeners = new Set<RunListener>();
  private readonly endListeners = new Set<() => void>();
  finished = false;
  /** The run itself; resolves once it has settled (or failed to). Set by whoever starts the run. */
  done: Promise<void> = Promise.resolve();

  constructor(
    readonly chatId: string,
    readonly userId: string,
    readonly messageId: string,
    readonly controller: AbortController,
    readonly turnId: string | null = null,
    private readonly maxBuffered = MAX_BUFFERED_EVENTS,
  ) {}

  /** The index of the last event published, -1 before the first. */
  get lastIndex(): number {
    return this.length - 1;
  }

  /** The oldest index still buffered. */
  get firstBuffered(): number {
    return this.offset;
  }

  /** Total events published, including any dropped from the head. */
  get length(): number {
    return this.offset + this.events.length;
  }

  publish(event: StreamEvent): void {
    if (this.finished) return;
    const index = this.length;
    this.events.push(event);
    if (this.events.length > this.maxBuffered) {
      this.events.shift();
      this.offset += 1;
    }
    for (const l of this.listeners) l(event, index);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const l of this.endListeners) l();
    this.listeners.clear();
    this.endListeners.clear();
  }

  /** Whether a subscriber that has seen events up to `after` can be replayed from here. */
  canReplayFrom(after: number): boolean {
    return after + 1 >= this.offset;
  }

  /**
   * Replays every event from `after` (exclusive; -1 for all) and then streams new ones until
   * the run ends. Returns null when the requested start was already dropped from the buffer.
   */
  subscribe(after: number, listener: RunListener, onEnd: () => void): (() => void) | null {
    const from = after + 1;
    if (from < this.offset) return null;
    for (let i = from; i < this.length; i++) listener(this.events[i - this.offset]!, i);
    if (this.finished) {
      onEnd();
      return () => {};
    }
    this.listeners.add(listener);
    this.endListeners.add(onEnd);
    return () => {
      this.listeners.delete(listener);
      this.endListeners.delete(onEnd);
    };
  }
}

export class RunHub {
  private readonly runs = new Map<string, Run>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly maxBuffered = MAX_BUFFERED_EVENTS) {}

  /** The run still working on this chat, if any. A finished, retained run is not active. */
  active(chatId: string): Run | undefined {
    const run = this.runs.get(chatId);
    return run && !run.finished ? run : undefined;
  }

  /** The latest run for this chat, active or recently finished. */
  latest(chatId: string): Run | undefined {
    return this.runs.get(chatId);
  }

  start(chatId: string, userId: string, messageId: string, controller: AbortController, turnId: string | null = null): Run {
    const previous = this.timers.get(chatId);
    if (previous) clearTimeout(previous);
    this.timers.delete(chatId);
    const run = new Run(chatId, userId, messageId, controller, turnId, this.maxBuffered);
    this.runs.set(chatId, run);
    return run;
  }

  finish(run: Run): void {
    run.finish();
    const timer = setTimeout(() => {
      if (this.runs.get(run.chatId) === run) this.runs.delete(run.chatId);
      this.timers.delete(run.chatId);
    }, FINISHED_RETENTION_MS);
    timer.unref();
    this.timers.set(run.chatId, timer);
  }

  /** Every run still working on this instance. */
  activeRuns(): Run[] {
    return [...this.runs.values()].filter((r) => !r.finished);
  }

  /** Stops every run here with `reason`, and resolves when each has settled. */
  async abortAll(reason?: unknown): Promise<void> {
    const runs = this.activeRuns();
    for (const run of runs) run.controller.abort(reason);
    await Promise.allSettled(runs.map((r) => r.done));
  }
}
