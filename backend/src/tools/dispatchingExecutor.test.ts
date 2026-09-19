import { describe, expect, it } from 'vitest';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import { DispatchingToolExecutor } from './dispatchingExecutor.js';

function fakeExecutor(result: ToolResult): { executor: ToolExecutor; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  return {
    calls,
    executor: {
      execute: async (call) => {
        calls.push(call);
        return result;
      },
    },
  };
}

describe('DispatchingToolExecutor', () => {
  it('routes a call to the executor registered for that tool name', async () => {
    const project = fakeExecutor({ toolCallId: 'c1', ok: true, content: [{ type: 'text', text: 'project' }] });
    const code = fakeExecutor({ toolCallId: 'c1', ok: true, content: [{ type: 'text', text: 'code' }] });
    const dispatcher = new DispatchingToolExecutor(
      new Map([
        ['search_project_files', project.executor],
        ['run_python', code.executor],
      ]),
    );

    const result = await dispatcher.execute(
      { id: 'c1', name: 'run_python', input: { code: '1' } },
      new AbortController().signal,
    );

    expect(result.content).toEqual([{ type: 'text', text: 'code' }]);
    expect(code.calls).toHaveLength(1);
    expect(project.calls).toHaveLength(0);
  });

  it('returns a typed unknown-tool result without calling any registered executor', async () => {
    const project = fakeExecutor({ toolCallId: 'c1', ok: true, content: [] });
    const dispatcher = new DispatchingToolExecutor(new Map([['search_project_files', project.executor]]));

    const result = await dispatcher.execute(
      { id: 'c1', name: 'delete_everything', input: {} },
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'Unknown tool "delete_everything".' }]);
    expect(project.calls).toHaveLength(0);
  });
});
