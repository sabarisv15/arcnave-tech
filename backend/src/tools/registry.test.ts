import { describe, expect, it } from 'vitest';

import { codeToolDefinitions } from './definitions.js';
import { ProjectToolRegistry } from './registry.js';
import { usesWarmSandbox } from './catalog.js';
import { loadConfig } from '../config.js';

const names = (r: ProjectToolRegistry, ctx: Parameters<ProjectToolRegistry['getAvailableTools']>[0]) =>
  r.getAvailableTools(ctx).map((t) => t.name);

describe('ProjectToolRegistry', () => {
  it('returns no tools when tool use is off, even with a project', () => {
    expect(new ProjectToolRegistry(false, { codeEnabled: true }).getAvailableTools({ projectId: 'p1', allowCode: true })).toEqual([]);
  });

  it('declares every allowed tool, the whole reference set with everything on', () => {
    const registry = new ProjectToolRegistry(true, {
      codeEnabled: true,
      persistentSandbox: true,
      webEnabled: true,
      memoryEnabled: true,
      generativeUiEnabled: true,
    });
    expect(names(registry, { projectId: 'p1', allowCode: true })).toEqual([
      'ask_user_input_v0',
      'memory_list',
      'memory_read',
      'memory_write',
      'memory_append',
      'memory_str_replace',
      'memory_delete',
      'conversation_search',
      'read_conversation',
      'recent_chats',
      'read_me',
      'show_widget',
      'chart_display_v0',
      'comparison_card_display_v0',
      'featured_card_display_v0',
      'itinerary_display_v0',
      'link_preview_display_v0',
      'message_compose_v1',
      'options_card_display_v0',
      'places_list_display_v0',
      'product_carousel_display_v0',
      'quiz_display_v0',
      'recipe_display_v0',
      'step_card_display_v0',
      'translation_display_v0',
      'web_search',
      'web_fetch',
      'image_search',
      'bash_tool',
      'view',
      'create_file',
      'str_replace',
      'present_files',
      'search_project_files',
      'read_project_file',
    ]);
  });

  it('has no discovery or skill-loading tool: skills are read with view', () => {
    const registry = new ProjectToolRegistry(true, { codeEnabled: true, webEnabled: true, memoryEnabled: true });
    const all = names(registry, { projectId: 'p1', allowCode: true });
    for (const gone of ['search_tools', 'load_skill', 'read_skill', 'list_skills', 'search_skills', 'run_python', 'render_ui', 'create_artifact']) {
      expect(all).not.toContain(gone);
    }
  });

  it('offers the code tools only when the deployment and the turn both allow code', () => {
    const on = new ProjectToolRegistry(true, { codeEnabled: true });
    expect(names(on, { projectId: null })).not.toContain('bash_tool');
    expect(names(on, { projectId: null, allowCode: true })).toContain('bash_tool');
    const off = new ProjectToolRegistry(true, { codeEnabled: false });
    expect(names(off, { projectId: null, allowCode: true })).not.toContain('bash_tool');
  });

  it('describes bash_tool as the engine runs it: files persist only on the warm sandbox', () => {
    const bash = (persistent: boolean) => codeToolDefinitions(persistent).find((t) => t.name === 'bash_tool')!.description;
    expect(bash(true)).toMatch(/Files persist between calls/);
    expect(bash(false)).toMatch(/each call starts from an empty machine/);
  });

  it('offers project tools only inside a project', () => {
    const registry = new ProjectToolRegistry(true);
    expect(names(registry, { projectId: null })).not.toContain('search_project_files');
    expect(names(registry, { projectId: 'p1' })).toContain('search_project_files');
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
