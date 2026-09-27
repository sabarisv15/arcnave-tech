import { describe, expect, it } from 'vitest';
import {
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

  it('determines if current round is the last round', () => {
    expect(isLastRound(0, 1)).toBe(true);
    expect(isLastRound(0, 3)).toBe(false);
    expect(isLastRound(1, 3)).toBe(false);
    expect(isLastRound(2, 3)).toBe(true);
  });

  it('identifies terminal tools', () => {
    expect(isTerminalTool('ask_user_options')).toBe(true);
    expect(isTerminalTool('run_python')).toBe(false);
    expect(isTerminalTool('web_search')).toBe(false);
    expect(TERMINAL_TOOLS.has('ask_user_options')).toBe(true);
  });

  it('detects terminal tool calls in an array', () => {
    expect(hasTerminalToolCall([{ name: 'run_python' }, { name: 'search_tools' }])).toBe(false);
    expect(hasTerminalToolCall([{ name: 'ask_user_options' }])).toBe(true);
    expect(hasTerminalToolCall([{ name: 'run_python' }, { name: 'ask_user_options' }])).toBe(true);
    expect(hasTerminalToolCall([])).toBe(false);
  });
});
