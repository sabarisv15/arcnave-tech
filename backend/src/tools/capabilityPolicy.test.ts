import { describe, expect, it } from 'vitest';
import { evaluateRunPythonPolicy, shouldExposeRunPython } from './capabilityPolicy.js';

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

  it('excludes Python for explanatory requests even if they mention statistical concepts', () => {
    expect(allowed('Explain Monte Carlo simulation')).toBe(false);
    expect(allowed('What is linear regression?')).toBe(false);
    expect(allowed('Describe how variance calculation works')).toBe(false);
  });

  it('exposes Python for explicit analysis of attached tabular data', () => {
    expect(allowed('Analyze the rows in this CSV attachment', true)).toBe(true);
  });

  it('does not expose Python merely because an unrelated attachment exists', () => {
    expect(allowed('Summarize this letter', true)).toBe(false);
    expect(allowed('Flower name?', true)).toBe(false);
    expect(allowed('What flower is in this photo?', true)).toBe(false);
    expect(allowed('Describe this video', true)).toBe(false);
  });

  it('exposes Python in research mode when genuine computation is requested, but excludes it for ordinary research', () => {
    expect(shouldExposeRunPython({ prompt: 'Deep research these 10 years of CSV data and calculate regression', mode: 'research', hasAttachments: true })).toBe(true);
    expect(shouldExposeRunPython({ prompt: 'Deep research quantum computing market trends', mode: 'research', hasAttachments: false })).toBe(false);
  });

  it('strictly excludes Python for artifact and document drafting', () => {
    expect(shouldExposeRunPython({ prompt: 'Create an artifact with a startup guide', mode: 'chat', hasAttachments: false })).toBe(false);
    expect(shouldExposeRunPython({ prompt: 'Draft an essay about artificial intelligence', mode: 'chat', hasAttachments: false })).toBe(false);
  });

  it('records actionable decision reasons', () => {
    const chatDecision = evaluateRunPythonPolicy({ prompt: 'Hello', mode: 'chat', hasAttachments: false });
    expect(chatDecision.allowed).toBe(false);
    expect(chatDecision.reason).toContain('Ordinary chat');

    const researchDecision = evaluateRunPythonPolicy({ prompt: 'Research quantum market', mode: 'research', hasAttachments: false });
    expect(researchDecision.allowed).toBe(false);
    expect(researchDecision.reason).toContain('Ordinary chat');

    const codeDecision = evaluateRunPythonPolicy({ prompt: 'Run this python script', mode: 'chat', hasAttachments: false });
    expect(codeDecision.allowed).toBe(true);
    expect(codeDecision.reason).toContain('Explicit Python');
  });
});

