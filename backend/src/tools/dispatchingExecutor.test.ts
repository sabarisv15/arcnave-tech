import { describe, expect, it } from 'vitest';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import { DispatchingToolExecutor, toolTimeouts } from './dispatchingExecutor.js';
import { loadConfig } from '../config.js';

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

describe('tool timers (Stage 15 ER-4c, N-43; P11)', () => {
  const never: ToolExecutor = {
    execute: (_call, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
  };

  it('takes the N-43 values from config: web_search 20 s, file search 2 s, memory 2 s, none for the rest', () => {
    const t = toolTimeouts(loadConfig({ NODE_ENV: 'test' }));
    expect(t('web_search')).toBe(20_000);
    expect(t('search_project_files')).toBe(2_000);
    expect(t('memory_read')).toBe(2_000);
    expect(t('memory_write')).toBe(2_000);
    // fetch_url keeps safeFetch's own 10 s; run_code is P18's.
    expect(t('web_fetch')).toBeUndefined();
    expect(t('bash_tool')).toBeUndefined();
  });

  it('a tool that does not answer in time is stopped and returns an is_error result', async () => {
    let seen: AbortSignal | undefined;
    const slow: ToolExecutor = { execute: (call, signal) => ((seen = signal), never.execute(call, signal)) };
    const dispatcher = new DispatchingToolExecutor(new Map([['search_project_files', slow]]), () => 20);
    const result = await dispatcher.execute({ id: 'c1', name: 'search_project_files', input: {} }, new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result.toolCallId).toBe('c1');
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toMatch(/did not answer within/);
    expect(seen?.aborted).toBe(true);
  });

  it('the turn\'s Stop still reaches a tool under a timer', async () => {
    let seen: AbortSignal | undefined;
    const slow: ToolExecutor = { execute: (call, signal) => ((seen = signal), never.execute(call, signal)) };
    const dispatcher = new DispatchingToolExecutor(new Map([['web_search', slow]]), () => 60_000);
    const stop = new AbortController();
    const pending = dispatcher.execute({ id: 'c2', name: 'web_search', input: {} }, stop.signal);
    stop.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    expect(seen?.aborted).toBe(true);
  });
});
