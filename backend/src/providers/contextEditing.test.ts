import { describe, expect, it } from 'vitest';
import type { Content } from '@google/genai';

import { CLEARED_TOOL_RESULT, resultsToClear } from './contextEditing.js';
import { clearOldFunctionResponses } from './gemini.js';

const policy = { triggerTokens: 100_000, keep: 3, batch: 5, excludeTools: ['load_skill'] };

const round = (name: string, i: number): Content[] => [
  { role: 'model', parts: [{ functionCall: { id: `c${i}`, name, args: {} }, thoughtSignature: `sig${i}` }] },
  { role: 'user', parts: [{ functionResponse: { id: `c${i}`, name, response: { output: `result ${i}` } } }] },
];

describe('resultsToClear', () => {
  it('keeps the last 3 and clears the rest a batch of 5 at a time', () => {
    expect(resultsToClear(3, policy)).toBe(0);
    expect(resultsToClear(7, policy)).toBe(0); // 4 clearable: below one batch
    expect(resultsToClear(8, policy)).toBe(5);
    expect(resultsToClear(12, policy)).toBe(5);
    expect(resultsToClear(13, policy)).toBe(10);
  });
});

describe('clearOldFunctionResponses', () => {
  it('replaces the oldest results with a placeholder and leaves calls, signatures and skills alone', () => {
    const contents = [
      ...round('load_skill', 0),
      ...Array.from({ length: 8 }, (_, i) => round('run_python', i + 1)).flat(),
    ];
    const edited = clearOldFunctionResponses(contents, policy);
    const outputs = edited
      .flatMap((c) => c.parts ?? [])
      .filter((p) => p.functionResponse)
      .map((p) => (p.functionResponse!.response as { output: string }).output);
    expect(outputs).toEqual([
      'result 0', // load_skill: excluded
      ...Array.from({ length: 5 }, () => CLEARED_TOOL_RESULT),
      'result 6',
      'result 7',
      'result 8',
    ]);
    expect(edited.filter((c) => c.role === 'model')).toEqual(contents.filter((c) => c.role === 'model'));
    // The same history edits the same way on the next request: the cached prefix holds.
    expect(clearOldFunctionResponses(edited, policy)).toEqual(edited);
  });
});
