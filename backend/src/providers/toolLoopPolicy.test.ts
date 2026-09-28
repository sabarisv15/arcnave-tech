import { describe, expect, it } from 'vitest';
import {
  finalRoundFinishReason,
  hasTerminalToolCall,
  isLastRound,
  isTerminalTool,
  resolveMaxRounds,
  TERMINAL_TOOLS,
} from './toolLoopPolicy.js';

describe('toolLoopPolicy', () => {
  it('resolves max rounds correctly based on useTools', () => {
    expect(resolveMaxRounds(5, true)).toBe(5);
    expect(resolveMaxRounds(5, false)).toBe(1);
    expect(resolveMaxRounds(0, true)).toBe(1);
  });

  it('reports the last allowed round as tool_limit, except an output cut-off or a refusal', () => {
    for (const r of ['stop', 'STOP', 'end_turn', 'tool_use', 'UNEXPECTED_TOOL_CALL', 'OTHER']) {
      expect(finalRoundFinishReason(r)).toBe('tool_limit');
    }
    for (const r of ['max_tokens', 'MAX_TOKENS', 'refusal', 'SAFETY', 'PROHIBITED_CONTENT']) {
      expect(finalRoundFinishReason(r)).toBe(r);
    }
  });

  it('determines if current round is the last round', () => {
    expect(isLastRound(0, 1)).toBe(true);
    expect(isLastRound(0, 3)).toBe(false);
    expect(isLastRound(1, 3)).toBe(false);
    expect(isLastRound(2, 3)).toBe(true);
  });

  it('identifies terminal tools', () => {
    expect(isTerminalTool('ask_user_input_v0')).toBe(true);
    expect(isTerminalTool('run_python')).toBe(false);
    expect(isTerminalTool('web_search')).toBe(false);
    expect(TERMINAL_TOOLS.has('ask_user_input_v0')).toBe(true);
  });

  it('detects terminal tool calls in an array', () => {
    expect(hasTerminalToolCall([{ name: 'run_python' }, { name: 'search_tools' }])).toBe(false);
    expect(hasTerminalToolCall([{ name: 'ask_user_input_v0' }])).toBe(true);
    expect(hasTerminalToolCall([{ name: 'run_python' }, { name: 'ask_user_input_v0' }])).toBe(true);
    expect(hasTerminalToolCall([])).toBe(false);
  });
});
