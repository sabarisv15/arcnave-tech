import { describe, expect, it } from 'vitest';
import { AskUserOptionsExecutor, validateAskUserOptionsInput } from './optionsExecutor.js';

describe('AskUserOptionsExecutor', () => {
  const executor = new AskUserOptionsExecutor();
  const dummySignal = new AbortController().signal;

  it('accepts valid single-choice options (2-6 items)', async () => {
    const input = {
      question: 'Which framework do you prefer?',
      kind: 'single',
      options: [
        { label: 'React', description: 'Component-based UI' },
        { label: 'Vue', description: 'Progressive framework' },
      ],
    };

    const result = await executor.execute({ id: 'c1', name: 'ask_user_options', input }, dummySignal);
    expect(result.ok).toBe(true);
    expect(result.content).toEqual([{ type: 'json', data: { status: 'shown' } }]);
  });

  it('accepts valid multi-select options', async () => {
    const input = {
      question: 'Select topics of interest',
      kind: 'multi',
      options: [
        { label: 'Technology' },
        { label: 'Science' },
        { label: 'Art' },
      ],
    };

    const result = await executor.execute({ id: 'c2', name: 'ask_user_options', input }, dummySignal);
    expect(result.ok).toBe(true);
  });

  it('accepts valid rank options up to 6 items', async () => {
    const input = {
      question: 'Rank priorities',
      kind: 'rank',
      options: [
        { label: '1' },
        { label: '2' },
        { label: '3' },
        { label: '4' },
        { label: '5' },
        { label: '6' },
      ],
    };

    const result = await executor.execute({ id: 'c3', name: 'ask_user_options', input }, dummySignal);
    expect(result.ok).toBe(true);
  });

  it('rejects fewer than 2 options', async () => {
    const input = {
      question: 'Choose one',
      kind: 'single',
      options: [{ label: 'Only one' }],
    };

    const result = await executor.execute({ id: 'c4', name: 'ask_user_options', input }, dummySignal);
    expect(result.ok).toBe(false);
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as { text: string }).text).toContain('must be between 2 and 6');
  });

  it('rejects more than 6 options', async () => {
    const input = {
      question: 'Choose one',
      kind: 'single',
      options: [
        { label: '1' },
        { label: '2' },
        { label: '3' },
        { label: '4' },
        { label: '5' },
        { label: '6' },
        { label: '7' },
      ],
    };

    const result = await executor.execute({ id: 'c5', name: 'ask_user_options', input }, dummySignal);
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('must be between 2 and 6');
  });

  it('rejects invalid kind', async () => {
    const input = {
      question: 'Choose one',
      kind: 'dropdown',
      options: [{ label: 'A' }, { label: 'B' }],
    };

    const result = await executor.execute({ id: 'c6', name: 'ask_user_options', input }, dummySignal);
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('kind must be');
  });

  it('rejects empty or missing question', async () => {
    const input = {
      question: '   ',
      kind: 'single',
      options: [{ label: 'A' }, { label: 'B' }],
    };

    const result = await executor.execute({ id: 'c7', name: 'ask_user_options', input }, dummySignal);
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('question must be');
  });

  it('rejects option missing label', async () => {
    const input = {
      question: 'Choose one',
      kind: 'single',
      options: [{ label: 'A' }, { description: 'No label' }],
    };

    const result = await executor.execute({ id: 'c8', name: 'ask_user_options', input }, dummySignal);
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('label must be a non-empty string');
  });
});
