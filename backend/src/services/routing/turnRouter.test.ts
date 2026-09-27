import { describe, expect, it } from 'vitest';

import { routeTurn, type RouteTurnInput } from './turnRouter.js';

const base: RouteTurnInput = { hasProject: false };

describe('routeTurn: flags and infrastructure decide, never wording (ADR-0006, ADR-0047)', () => {
  it('takes no prompt at all, so wording cannot change a decision', () => {
    // A compile-time guarantee, checked at run time too: the input type has no prompt field.
    const input = { ...base } as Record<string, unknown>;
    expect('prompt' in input).toBe(false);
    expect(routeTurn(base)).toEqual(routeTurn({ ...base }));
  });

  it('always allows the question card, and nothing to discover: artifacts are files (ADR-0048)', () => {
    expect(routeTurn(base).allowedTools).toEqual(['ask_user_input_v0']);
  });

  it('adds each capability only when its flag is on', () => {
    const on = routeTurn({ hasProject: true, codeEnabled: true, webEnabled: true, memoryEnabled: true, generativeUiEnabled: true });
    for (const tool of [
      'bash_tool',
      'view',
      'create_file',
      'str_replace',
      'present_files',
      'web_search',
      'web_fetch',
      'image_search',
      'memory_read',
      'conversation_search',
      'recent_chats',
      'search_project_files',
      'read_me',
      'show_widget',
      'chart_display_v0',
      'recipe_display_v0',
    ]) {
      expect(on.allowedTools).toContain(tool);
    }
    const off = routeTurn(base);
    for (const tool of ['bash_tool', 'web_search', 'memory_read', 'conversation_search', 'search_project_files', 'show_widget', 'chart_display_v0']) {
      expect(off.allowedTools).not.toContain(tool);
    }
  });

  it('never allows a discovery or skill-loading tool', () => {
    const on = routeTurn({ hasProject: true, codeEnabled: true, webEnabled: true, memoryEnabled: true });
    for (const gone of ['search_tools', 'load_skill', 'read_skill', 'list_skills', 'search_skills', 'run_python', 'render_ui', 'create_artifact', 'ask_user_options']) {
      expect(on.allowedTools).not.toContain(gone);
    }
  });
});
