import { describe, expect, it } from 'vitest';

import { shouldExposeRunPython } from './capabilityPolicy.js';

const allowed = (prompt: string, hasAttachments = false) =>
  shouldExposeRunPython({ prompt, mode: 'chat', hasAttachments });

describe('shouldExposeRunPython', () => {
  it.each([
    'Hi, how are you?',
    'What time is it in Coimbatore?',
    'What is 2 + 2?',
    'Explain photosynthesis',
    'Search the web for today\'s weather',
  ])('keeps Python hidden for ordinary request: %s', (prompt) => {
    expect(allowed(prompt)).toBe(false);
  });

  it.each([
    'Run this Python code and explain the output',
    'Debug this pandas script',
    'Calculate a confidence interval for this sample',
    'Run a Monte Carlo simulation with 10,000 trials',
    'Perform a regression and test statistical significance',
  ])('exposes Python for computational request: %s', (prompt) => {
    expect(allowed(prompt)).toBe(true);
  });

  it('exposes Python for explicit analysis of attached tabular data', () => {
    expect(allowed('Analyze the rows in this CSV attachment', true)).toBe(true);
  });

  it('does not expose Python merely because an unrelated attachment exists', () => {
    expect(allowed('Summarize this letter', true)).toBe(false);
  });
});
