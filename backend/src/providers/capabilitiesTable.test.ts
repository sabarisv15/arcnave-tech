import { describe, expect, it } from 'vitest';

import { effortFor, getModelCapability, MODEL_CAPABILITIES } from './capabilitiesTable.js';

describe('effortFor', () => {
  it('runs a model at the requested effort, or the highest level below it the model accepts', () => {
    const gemini = getModelCapability('Gemini 3.8 Flash');
    expect(effortFor(gemini, 'high')).toBe('high');
    expect(effortFor(gemini, 'max')).toBe('high');
    expect(effortFor(gemini, 'low')).toBe('low');
    expect(effortFor(getModelCapability('Opus 5.5'), 'xhigh')).toBe('xhigh');
    expect(effortFor(getModelCapability('claude-sonnet-5-5'), 'max')).toBe('max');
  });

  it('sends no effort to a model the table does not know', () => {
    expect(effortFor(getModelCapability('some-unlisted-model'), 'high')).toBeUndefined();
  });
});

describe('the capability table (ADR-0055)', () => {
  it('describes exactly the three served models, by alias and by first-party id', () => {
    const aliases = new Set(Object.values(MODEL_CAPABILITIES).map((spec) => spec.alias));
    expect([...aliases].sort()).toEqual(['Gemini 3.8 Flash', 'Opus 5.5', 'Sonnet 5.5']);
    expect(getModelCapability('claude-opus-5-5').alias).toBe('Opus 5.5');
  });

  it('holds Claude to the first-party request limits, not Vertex ones (ADR-0054)', () => {
    const opus = getModelCapability('Opus 5.5');
    expect(opus.maxRequestBytes).toBe(32_000_000);
    expect(opus.maxPdfPagesPerRequest).toBe(600);
  });
});
