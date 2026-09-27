import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_TOOL_DEFINITIONS,
  PROJECT_TOOL_DEFINITIONS,
  QUESTION_TOOL_DEFINITIONS,
  RUN_PYTHON,
  RUN_PYTHON_WARM,
  SKILL_TOOL_DEFINITIONS,
  WEB_TOOL_DEFINITIONS,
} from './definitions.js';
import { ProjectToolRegistry } from './registry.js';
import { usesWarmSandbox } from './catalog.js';
import { loadConfig } from '../config.js';

describe('ProjectToolRegistry', () => {
  it('returns no tools when disabled, even with a project', () => {
    const registry = new ProjectToolRegistry(false);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual([]);
  });

  it('returns artifact and question tools when enabled even if there is no project', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: null })).toEqual([
      ...ARTIFACT_TOOL_DEFINITIONS,
      ...QUESTION_TOOL_DEFINITIONS,
    ]);
  });

  it('returns artifact, question, and project tools when enabled and project is present', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).toEqual([
      ...ARTIFACT_TOOL_DEFINITIONS,
      ...QUESTION_TOOL_DEFINITIONS,
      ...PROJECT_TOOL_DEFINITIONS,
    ]);
  });

  it('omits run_python when runPythonEnabled defaults to false', () => {
    const registry = new ProjectToolRegistry(true);
    expect(registry.getAvailableTools({ projectId: 'p1' })).not.toContainEqual(RUN_PYTHON);
  });

  it('includes run_python only when infrastructure and the turn policy both allow it', () => {
    const registry = new ProjectToolRegistry(true, true);
    expect(registry.getAvailableTools({ projectId: null })).not.toContainEqual(RUN_PYTHON);
    expect(registry.getAvailableTools({ projectId: null, allowPython: true })).toEqual([
      ...ARTIFACT_TOOL_DEFINITIONS,
      ...QUESTION_TOOL_DEFINITIONS,
      RUN_PYTHON,
    ]);
  });

  it('includes web tools when webEnabled is true', () => {
    const registry = new ProjectToolRegistry(true, false, false, true);
    const tools = registry.getAvailableTools({ projectId: null });
    expect(tools).toContainEqual(WEB_TOOL_DEFINITIONS[0]);
    expect(tools).toContainEqual(WEB_TOOL_DEFINITIONS[1]);
  });

  describe('Exhaustive Tool Surface Matrix', () => {
    it('verifies exact tool counts and definitions in production baseline (TOOL_USE=true, PYTHON=true, SKILLS=false, WEB=false)', () => {
      const registry = new ProjectToolRegistry(true, true, false, false, false);

      // Without project: 3 artifact + 1 question + 1 python = 5 tools
      const noProj = registry.getAvailableTools({ projectId: null, allowPython: true });
      expect(noProj.map((t) => t.name)).toEqual([
        'create_artifact',
        'read_artifact',
        'update_artifact',
        'ask_user_options',
        'run_python',
      ]);
      expect(noProj.length).toBe(5);

      // With project: 3 artifact + 1 question + 1 python + 2 project = 7 tools
      const withProj = registry.getAvailableTools({ projectId: 'p1', allowPython: true });
      expect(withProj.map((t) => t.name)).toEqual([
        'create_artifact',
        'read_artifact',
        'update_artifact',
        'ask_user_options',
        'run_python',
        'search_project_files',
        'read_project_file',
      ]);
      expect(withProj.length).toBe(7);
    });

    it('verifies the defined tools with python, skills and web on', () => {
      const allEnabledRegistry = new ProjectToolRegistry(true, true, true, true, false);
      const tools = allEnabledRegistry.getAvailableTools({
        projectId: 'p1',
        allowPython: true,
      });
      expect(tools.length).toBe(12);
      expect(tools.map((t) => t.name)).toEqual([
        'create_artifact',
        'read_artifact',
        'update_artifact',
        'ask_user_options',
        'web_search',
        'web_fetch',
        'run_python',
        'search_project_files',
        'read_project_file',
        'list_skills',
        'search_skills',
        'read_skill',
      ]);
    });


    it('omits render_ui when generativeUiEnabled is false', () => {
      const registry = new ProjectToolRegistry(true, false, false, false, false, false);
      const tools = registry.getAvailableTools({ projectId: null });
      expect(tools.map((t) => t.name)).not.toContain('render_ui');
    });

    it('includes render_ui when generativeUiEnabled is true', () => {
      const registry = new ProjectToolRegistry(true, false, false, false, false, true);
      const tools = registry.getAvailableTools({ projectId: null });
      expect(tools.map((t) => t.name)).toContain('render_ui');
    });

  });

  it('describes run_python as the configured engine runs it', () => {
    const warm = new ProjectToolRegistry(true, true, false, false, false, false, RUN_PYTHON_WARM);
    const tools = warm.getAvailableTools({ projectId: null, allowPython: true });
    expect(tools).toContainEqual(RUN_PYTHON_WARM);
    expect(RUN_PYTHON_WARM.description).toMatch(/persist between calls/);
    expect(RUN_PYTHON.description).toMatch(/no persisted state between calls/);
  });
});

describe('usesWarmSandbox', () => {
  it('is on for the warm engine, and for auto only when the service URL is set', () => {
    expect(usesWarmSandbox(loadConfig({ SANDBOX_ENGINE: 'warm' }))).toBe(true);
    expect(usesWarmSandbox(loadConfig({ SANDBOX_ENGINE: 'auto', SANDBOX_SERVICE_URL: 'https://x.run.app' }))).toBe(true);
    expect(usesWarmSandbox(loadConfig({ SANDBOX_ENGINE: 'auto' }))).toBe(false);
    expect(usesWarmSandbox(loadConfig({ SANDBOX_ENGINE: 'cloud-run', SANDBOX_SERVICE_URL: 'https://x.run.app' }))).toBe(false);
  });
});
