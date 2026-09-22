import { describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../providers/types.js';
import {
  CREATE_ARTIFACT,
  GENERATE_DELIVERABLE,
  RUN_PYTHON,
  SEARCH_TOOLS,
} from './definitions.js';
import { SearchToolsExecutor } from './searchToolsExecutor.js';

describe('SearchToolsExecutor', () => {
  const catalog: ToolDefinition[] = [
    SEARCH_TOOLS,
    GENERATE_DELIVERABLE,
    RUN_PYTHON,
    CREATE_ARTIFACT,
  ];

  it('finds generate_deliverable for excel / spreadsheet queries', async () => {
    let discovered: ToolDefinition[] = [];
    const executor = new SearchToolsExecutor(catalog, (tool) => {
      discovered.push(tool);
    });

    const result = await executor.execute(
      { id: 'c1', name: 'search_tools', input: { query: 'excel spreadsheet generator' } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(result.content[0]?.type).toBe('json');
    const data = (result.content[0] as any).data;
    expect(data.tools.some((t: any) => t.name === 'generate_deliverable')).toBe(true);
    expect(discovered.some((t) => t.name === 'generate_deliverable')).toBe(true);
  });

  it('finds run_python for code / computation queries', async () => {
    const executor = new SearchToolsExecutor(catalog);

    const result = await executor.execute(
      { id: 'c2', name: 'search_tools', input: { query: 'python computation' } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = (result.content[0] as any).data;
    expect(data.tools.some((t: any) => t.name === 'run_python')).toBe(true);
  });

  it('returns empty list gracefully when no tool matches', async () => {
    const executor = new SearchToolsExecutor(catalog);

    const result = await executor.execute(
      { id: 'c3', name: 'search_tools', input: { query: 'quantum teleportation music' } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = (result.content[0] as any).data;
    expect(data.tools).toEqual([]);
  });

  it('handles abort signal gracefully', async () => {
    const executor = new SearchToolsExecutor(catalog);
    const ctrl = new AbortController();
    ctrl.abort();

    const result = await executor.execute(
      { id: 'c4', name: 'search_tools', input: { query: 'excel' } },
      ctrl.signal,
    );

    expect(result.ok).toBe(false);
    expect((result.content[0] as any).text).toContain('aborted');
  });
});
