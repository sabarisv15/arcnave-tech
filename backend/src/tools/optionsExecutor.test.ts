import { describe, expect, it } from 'vitest';
import { AskUserInputExecutor, validateAskUserInput } from './optionsExecutor.js';

describe('ask_user_input_v0', () => {
  const executor = new AskUserInputExecutor();
  const signal = new AbortController().signal;
  const run = (input: unknown) => executor.execute({ id: 'c', name: 'ask_user_input_v0', input }, signal);

  it('shows one to three questions of each type, defaulting to single_select', async () => {
    const res = await run({
      questions: [
        { question: 'Goal?', options: ['Strength', 'Cardio'] },
        { question: 'Equipment?', options: ['None', 'Dumbbells', 'Gym'], type: 'multi_select' },
        { question: 'Order these', options: ['Time', 'Cost', 'Fun', 'Health'], type: 'rank_priorities' },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.content).toEqual([{ type: 'json', data: { status: 'shown' } }]);
    const v = validateAskUserInput({ questions: [{ question: ' Q ', options: [' a ', 'b'] }] });
    expect(v).toEqual({ ok: true, data: { questions: [{ question: 'Q', type: 'single_select', options: ['a', 'b'] }] } });
  });

  it('refuses what the card cannot show', async () => {
    const q = { question: 'Q', options: ['a', 'b'] };
    for (const bad of [
      {},
      { questions: [] },
      { questions: [q, q, q, q] },
      { questions: [{ question: 'Q', options: ['a'] }] },
      { questions: [{ question: 'Q', options: ['a', 'b', 'c', 'd', 'e'] }] },
      { questions: [{ question: '', options: ['a', 'b'] }] },
      { questions: [{ question: 'Q', options: ['a', ''] }] },
      { questions: [{ ...q, type: 'rank' }] },
    ]) {
      const res = await run(bad);
      expect(res.ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
