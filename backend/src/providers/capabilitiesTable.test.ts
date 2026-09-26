import { describe, expect, it } from 'vitest';

import { effortFor, getModelCapability } from './capabilitiesTable.js';

describe('effortFor', () => {
  it('runs a model at the requested effort, or the highest level below it the model accepts', () => {
    const gemini = getModelCapability('Gemini 3.8 Flash');
    expect(effortFor(gemini, 'high')).toBe('high');
    expect(effortFor(gemini, 'max')).toBe('high');
    expect(effortFor(gemini, 'low')).toBe('low');
    expect(effortFor(getModelCapability('Opus 5'), 'xhigh')).toBe('xhigh');
  });

  it('sends no effort to a model without an effort control', () => {
    expect(effortFor(getModelCapability('GPT-OSS 120B'), 'high')).toBeUndefined();
  });
});
