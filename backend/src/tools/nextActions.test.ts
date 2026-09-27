import { describe, expect, it } from 'vitest';
import { nextActionsExecutor } from './nextActions.js';

describe('next action proposals', () => {
  it('keeps context-specific actions and a separate composer hint', async () => {
    let actions: string[] = [];
    const result = await nextActionsExecutor((value) => {
      actions = value;
    }).execute(
      {
        id: 'n',
        name: 'suggest_next_actions',
        input: {
          actions: ['Monthly compounding compare pannu'],
          composer: '₹1 lakh-ku monthly interest calculate pannu',
        },
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    expect(actions).toEqual(['Monthly compounding compare pannu']);
    expect(result.content).toEqual([
      {
        type: 'json',
        data: {
          actions,
          composer: '₹1 lakh-ku monthly interest calculate pannu',
        },
      },
    ]);
  });
  it('rejects malformed proposals without updating actions', async () => {
    let called = false;
    const result = await nextActionsExecutor(() => {
      called = true;
    }).execute(
      {
        id: 'n',
        name: 'suggest_next_actions',
        input: { actions: ['a'.repeat(181)], composer: '' },
      },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
