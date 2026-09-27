import { describe, expect, it } from 'vitest';
import { AnswerProtocolGuard } from './answerProtocolGuard.js';

describe('answer protocol boundary', () => {
  it('never releases an internal tool marker or its payload at any chunk split', () => {
    const text = '[Tool call] render_ui({"html":"secret source"})';
    for (let split = 1; split < text.length; split++) {
      const guard = new AnswerProtocolGuard();
      let released = '';
      expect(() => {
        released += guard.push(text.slice(0, split));
        released += guard.push(text.slice(split));
      }).toThrow('tool_protocol_in_text');
      expect(released).not.toContain('[Tool call]');
      expect(released).not.toContain('secret source');
    }
  });
  it('preserves intentional fenced and inline code, even character by character', () => {
    const text =
      'Example: `[Tool call]`\n```text\n[Tool call] render_ui({})\n```\nDone.';
    const guard = new AnswerProtocolGuard();
    let output = '';
    for (const character of text) output += guard.push(character);
    expect(output + guard.finish()).toBe(text);
  });
  it('preserves ordinary brackets and partial text', () => {
    const guard = new AnswerProtocolGuard();
    expect(guard.push('[sources] A [T') + guard.finish()).toBe(
      '[sources] A [T',
    );
  });
});
