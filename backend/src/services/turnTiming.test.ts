import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamTimeSplit, TurnTiming } from './turnTiming.js';

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

describe('StreamTimeSplit', () => {
  it('counts time before a tool_result as tool time and the rest as model time', () => {
    let t = 0;
    const split = new StreamTimeSplit(() => t);
    t = 30_000; split.observe('thinking'); // model thought 30 s
    t = 31_000; split.observe('tool_use');
    t = 31_000; split.observe('tool_use'); // a parallel call
    t = 40_000; split.observe('tool_result');
    t = 45_000; split.observe('tool_result'); // tools ran 14 s in all
    t = 105_000; split.observe('delta'); // the next request waited 60 s
    expect(split.summary()).toEqual({ model: 91_000, tools: 14_000, longestModelWait: 60_000, modelRequests: 2 });
  });
});
