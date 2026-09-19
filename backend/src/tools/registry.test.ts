import { describe, expect, it } from 'vitest';

import { PROJECT_TOOL_DEFINITIONS } from './definitions.js';
import { ProjectToolRegistry } from './registry.js';

describe('ProjectToolRegistry', () => {
  it('returns no tools when disabled, even with a project', () => {
    const registry = new ProjectToolRegistry(false);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual([]);
  });

  it('returns no tools when enabled but there is no project', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: null })).toEqual([]);
  });

  it('returns the project tool set when enabled and a project is present', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual(PROJECT_TOOL_DEFINITIONS);
  });
});
