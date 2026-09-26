import { afterEach, describe, expect, it, vi } from 'vitest';

import { TurnTiming } from './turnTiming.js';

afterEach(() => vi.useRealTimers());

describe('TurnTiming', () => {
  it('attributes each gap to the phase that ended it, and sums a repeated phase', () => {
    vi.useFakeTimers();
    const t = new TurnTiming();
    vi.advanceTimersByTime(40);
    t.mark('history');
    vi.advanceTimersByTime(3_000);
    t.mark('model_resolve');
    vi.advanceTimersByTime(10);
    t.mark('history');
    t.note('probed', true);
    expect(t.summary()).toEqual({ phasesMs: { history: 50, model_resolve: 3_000 }, totalMs: 3_050, probed: true });
  });
});
