import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_TOOL_DEFINITIONS,
  GOAL_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  RUN_PYTHON,
  SKILL_TOOL_DEFINITIONS,
  UPLOAD_TOOL_DEFINITIONS,
  WEB_TOOL_DEFINITIONS,
} from './definitions.js';
import { ProjectToolRegistry } from './registry.js';

describe('ProjectToolRegistry', () => {
  it('returns no tools when disabled, even with a project', () => {
    const registry = new ProjectToolRegistry(false);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual([]);
  });

  it('returns artifact and upload tools when enabled even if there is no project', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: null })).toEqual([
      ...ARTIFACT_TOOL_DEFINITIONS,
      ...UPLOAD_TOOL_DEFINITIONS,
    ]);
  });

  it('returns artifact, upload, and project tools when enabled and project is present', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual([
      ...ARTIFACT_TOOL_DEFINITIONS,
      ...UPLOAD_TOOL_DEFINITIONS,
      ...PROJECT_TOOL_DEFINITIONS,
    ]);
  });

  it('omits run_python when runPythonEnabled defaults to false', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).not.toContainEqual(RUN_PYTHON);
  });

  it('includes run_python when enabled and runPythonEnabled is true (decoupled from project)', () => {
    const registry = new ProjectToolRegistry(true, true);
    expect(registry.getAvailableTools({ projectId: null })).toEqual([
      ...ARTIFACT_TOOL_DEFINITIONS,
      ...UPLOAD_TOOL_DEFINITIONS,
      RUN_PYTHON,
    ]);
  });

  it('includes web tools when webEnabled is true', () => {
    const registry = new ProjectToolRegistry(true, false, false, false, true);
    const tools = registry.getAvailableTools({ projectId: null });
    expect(tools).toContainEqual(WEB_TOOL_DEFINITIONS[0]);
    expect(tools).toContainEqual(WEB_TOOL_DEFINITIONS[1]);
  });

  describe('Exhaustive Tool Surface Matrix', () => {
    it('verifies exact tool counts and definitions in production baseline (TOOL_USE=true, PYTHON=true, SKILLS=false, AGENT=false, WEB=false)', () => {
      const registry = new ProjectToolRegistry(true, true, false, false, false);

      // Without project: 3 artifact + 1 upload + 1 python = 5 tools
      const noProj = registry.getAvailableTools({ projectId: null });
      expect(noProj.map((t) => t.name)).toEqual([
        'create_artifact',
        'read_artifact',
        'update_artifact',
        'read_uploaded_file',
        'run_python',
      ]);
      expect(noProj.length).toBe(5);

      // With project: 3 artifact + 1 upload + 1 python + 2 project = 7 tools
      const withProj = registry.getAvailableTools({ projectId: 'p1' });
      expect(withProj.map((t) => t.name)).toEqual([
        'create_artifact',
        'read_artifact',
        'update_artifact',
        'read_uploaded_file',
        'run_python',
        'search_project_files',
        'read_project_file',
      ]);
      expect(withProj.length).toBe(7);
    });

    it('verifies all 15 defined tools are enabled with all flags active and active goal', () => {
      const allEnabledRegistry = new ProjectToolRegistry(true, true, true, true, true);
      const tools = allEnabledRegistry.getAvailableTools({ projectId: 'p1', activeGoalId: 'g1' });
      expect(tools.length).toBe(15);
      expect(tools.map((t) => t.name)).toEqual([
        'create_artifact',
        'read_artifact',
        'update_artifact',
        'read_uploaded_file',
        'web_search',
        'web_fetch',
        'run_python',
        'search_project_files',
        'read_project_file',
        'get_goal',
        'update_goal',
        'get_context_remaining',
        'list_skills',
        'search_skills',
        'read_skill',
      ]);
    });

    it('omits render_ui when generativeUiEnabled is false', () => {
      const registry = new ProjectToolRegistry(true, false, false, false, false, false, false);
      const tools = registry.getAvailableTools({ projectId: null });
      expect(tools.map((t) => t.name)).not.toContain('render_ui');
    });

    it('includes render_ui when generativeUiEnabled is true', () => {
      const registry = new ProjectToolRegistry(true, false, false, false, false, false, true);
      const tools = registry.getAvailableTools({ projectId: null });
      expect(tools.map((t) => t.name)).toContain('render_ui');
    });
  });
});
