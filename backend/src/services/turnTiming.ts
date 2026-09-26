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
