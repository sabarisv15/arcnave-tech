import { describe, expect, it } from 'vitest';

import { PROJECT_TOOL_DEFINITIONS, RUN_PYTHON } from './definitions.js';
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

  it('omits run_python when runPythonEnabled defaults to false', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).not.toContainEqual(RUN_PYTHON);
  });

  it('includes run_python only when both flags are true', () => {
    const registry = new ProjectToolRegistry(true, true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual([...PROJECT_TOOL_DEFINITIONS, RUN_PYTHON]);
  });

  it('omits run_python when enabled is false, even if runPythonEnabled is true', () => {
    const registry = new ProjectToolRegistry(false, true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual([]);
  });

  it('omits run_python when runPythonEnabled is true but there is no project', () => {
    const registry = new ProjectToolRegistry(true, true);
    expect(registry.getAvailableTools({ projectId: null })).toEqual([]);
  });
});
