/**
 * Where a turn's time goes, one log line per turn ("turn timing"), so a slow reply is traced to
 * its step instead of guessed at: history, model resolution (and whether it probed), compaction,
 * attachments, the provider's first event, and the stream.
 */
export class TurnTiming {
  private readonly startedAt = Date.now();
  private last = this.startedAt;
  private readonly phases: Record<string, number> = {};
  private readonly facts: Record<string, unknown> = {};

  /** Records the time since the previous mark under `phase`, adding to it if seen before. */
  mark(phase: string): void {
    const now = Date.now();
    this.phases[phase] = (this.phases[phase] ?? 0) + (now - this.last);
    this.last = now;
  }

  note(key: string, value: unknown): void {
    this.facts[key] = value;
  }

  get since(): number {
    return this.startedAt;
  }

  summary(): { phasesMs: Record<string, number>; totalMs: number } & Record<string, unknown> {
    return { phasesMs: { ...this.phases }, totalMs: Date.now() - this.startedAt, ...this.facts };
  }
}

/**
 * Where a provider stream's time went: waiting on the model (from a request, or a tool result,
 * to the model's next event) or on tools (from a tool_use to its tool_result). Parallel calls
 * count once: tool time runs while any call is outstanding.
 */
export class StreamTimeSplit {
  private last: number;
  private pendingTools = 0;
  private modelMs = 0;
  private toolMs = 0;
  private longestModelWaitMs = 0;
  private modelRequests = 1;

  constructor(private readonly now: () => number = Date.now) {
    this.last = now();
  }

  observe(type: string): void {
    const t = this.now();
    const dt = t - this.last;
    this.last = t;
    if (this.pendingTools > 0) this.toolMs += dt;
    else {
      this.modelMs += dt;
      this.longestModelWaitMs = Math.max(this.longestModelWaitMs, dt);
    }
    if (type === 'tool_use') this.pendingTools += 1;
    if (type === 'tool_result' && this.pendingTools > 0) {
      this.pendingTools -= 1;
      // The last result of a round sends the next request.
      if (this.pendingTools === 0) this.modelRequests += 1;
    }
  }

  summary(): { model: number; tools: number; longestModelWait: number; modelRequests: number } {
    return {
      model: this.modelMs,
      tools: this.toolMs,
      longestModelWait: this.longestModelWaitMs,
      modelRequests: this.modelRequests,
    };
  }
}
