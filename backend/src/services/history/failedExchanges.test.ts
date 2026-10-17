/**
 * Which stored messages go back to the model (D2 X-3, Stage 6 doc-sync R-3): a failed or empty
 * answer leaves with its question; a stopped answer that has text or tool calls stays, an errored
 * answer that made tool calls stays, and a question that carried files stays.
 */
import { describe, expect, it } from 'vitest';

import type { HistoryToolCall } from '../../providers/types.js';
import { CUT_MARKERS, historyText, withoutFailedExchanges, type StoredMessage } from './failedExchanges.js';

let seq = 0;
const msg = (role: 'user' | 'assistant', text: string, status = 'complete'): StoredMessage => ({ id: `m${String(++seq)}`, role, text, seq, status });
const call = (id: string): HistoryToolCall => ({ id, name: 'bash_tool', input: {}, result: { toolCallId: id, ok: true, content: [] } });

describe('withoutFailedExchanges', () => {
  it('drops an errored answer and its question, keeping the exchanges around it', () => {
    const rows = [msg('user', 'a'), msg('assistant', 'A'), msg('user', 'b'), msg('assistant', 'partial', 'error'), msg('user', 'c'), msg('assistant', 'C')];
    expect(withoutFailedExchanges(rows, new Map()).map((r) => r.text)).toEqual(['a', 'A', 'c', 'C']);
  });

  it('drops an empty answer (no text, no tool call) and its question, whatever its status', () => {
    const rows = [msg('user', 'a'), msg('assistant', '  ', 'stopped'), msg('user', 'b'), msg('assistant', '', 'generating')];
    expect(withoutFailedExchanges(rows, new Map())).toEqual([]);
  });

  it('keeps a stopped answer with text, and an answer with tool calls but no text', () => {
    const rows = [msg('user', 'a'), msg('assistant', 'half', 'stopped'), msg('user', 'b'), msg('assistant', '', 'stopped')];
    const calls = new Map([[rows[3]!.id, [call('t1')]]]);
    expect(withoutFailedExchanges(rows, calls).map((r) => r.text)).toEqual(['a', 'half', 'b', '']);
  });

  it('keeps an errored answer that made tool calls, with its question: the calls ran', () => {
    const rows = [msg('user', 'a'), msg('assistant', 'x', 'error')];
    expect(withoutFailedExchanges(rows, new Map([[rows[1]!.id, [call('t')]]])).map((r) => r.text)).toEqual(['a', 'x']);
  });

  it('keeps the question of a failed exchange when it carried files, and drops only the answer', () => {
    const rows = [msg('user', 'read this file'), msg('assistant', 'partial', 'error'), msg('user', 'b'), msg('assistant', '', 'stopped')];
    const out = withoutFailedExchanges(rows, new Map(), new Set([rows[0]!.id]));
    expect(out.map((r) => r.text)).toEqual(['read this file']);
  });

  it('does not take a question that is not directly before the failed answer', () => {
    const user = msg('user', 'orphan');
    seq += 1; // a gap: the answer is not the next message
    const rows = [user, msg('assistant', '', 'error')];
    expect(withoutFailedExchanges(rows, new Map()).map((r) => r.text)).toEqual(['orphan']);
  });

  it('still leaves out a user message with no text', () => {
    const rows = [msg('user', ' '), msg('assistant', 'A')];
    expect(withoutFailedExchanges(rows, new Map()).map((r) => r.text)).toEqual(['A']);
  });
});

describe('the cut marker on an unfinished answer (P11, ours)', () => {
  it('marks a stopped answer and an interrupted or partial one; leaves the rest as they are', () => {
    expect(historyText({ ...msg('assistant', 'half', 'stopped') })).toBe(`half\n\n${CUT_MARKERS.stopped}`);
    expect(historyText({ ...msg('assistant', 'half'), finishReason: 'interrupted' })).toBe(`half\n\n${CUT_MARKERS.cut}`);
    expect(historyText({ ...msg('assistant', 'half'), finishReason: 'partial' })).toBe(`half\n\n${CUT_MARKERS.cut}`);
    expect(historyText({ ...msg('assistant', 'whole'), finishReason: 'stop' })).toBe('whole');
    expect(historyText({ ...msg('assistant', 'whole'), finishReason: 'MAX_TOKENS' })).toBe('whole');
    // A user message, and an empty answer, are never marked.
    expect(historyText(msg('user', 'stopped?', 'stopped'))).toBe('stopped?');
    expect(historyText(msg('assistant', '', 'stopped'))).toBe('');
  });
});
