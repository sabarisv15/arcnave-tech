import { describe, expect, it } from 'vitest';
import { activityCopy, responseParts } from './activity';
import type { ToolCall } from './types';

const call = (id: string, offset?: number): ToolCall => ({ toolCallId: id, name: 'run_python', input: {}, ok: true, textOffset: offset });
describe('response activity ordering', () => {
  it('interleaves explanations and groups only adjacent actions, including Unicode', () => {
    const intro = 'Counting தமிழ் 🔎.\n\n';
    const explanation = 'Read the rows.\n\n';
    const text = intro + explanation + 'File ready.';
    expect(responseParts(text, [call('1', intro.length), call('2', intro.length), call('3', (intro + explanation).length)]).map(p => p.kind === 'text' ? p.text : p.calls.map(c => c.toolCallId))).toEqual([intro, ['1', '2'], explanation, ['3'], 'File ready.']);
  });
  it('keeps old transcripts readable without inventing historical order', () => {
    expect(responseParts('Answer', [call('old')])[0]).toEqual({kind: 'text', text: 'Answer'});
  });
  it('does not report failed or interrupted work as success', () => {
    expect(activityCopy({...call('1'), ok: false}).title).toContain('failed');
    expect(activityCopy({...call('1'), ok: undefined}, true).title).toContain('interrupted');
    expect(activityCopy({...call('1'), ok: undefined}).title).toBe('Running a calculation');
  });
  it('uses action descriptions but claims file creation only from confirmed output metadata', () => {
    const action = {...call('1'), input: {description: 'Counting transaction rows', expected_outputs: ['planned.json']}};
    expect(activityCopy(action).title).toBe('Counting transaction rows — complete');
    expect(activityCopy({...action,outputFiles:['saved.json']}).title).toBe('Created a file');
    expect(activityCopy({...action,ok:false,outputFiles:['saved.json']}).title).toContain('failed');
  });
  it('preserves every character as streaming grows and clamps invalid offsets', () => {
    for (const text of ['First', 'First\n\nSecond']) {
      const parts = responseParts(text, [call('1', 5), call('2', 500)]);
      expect(parts.filter(p => p.kind === 'text').map(p => p.text).join('')).toBe(text);
    }
  });
});
