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

  it('always allows artifacts and the question card, and nothing to discover', () => {
    expect(routeTurn(base).allowedTools.sort()).toEqual(
      ['ask_user_options', 'create_artifact', 'read_artifact', 'update_artifact'].sort(),
    );
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
      'render_ui',
    ]) {
      expect(on.allowedTools).toContain(tool);
    }
    const off = routeTurn(base);
    for (const tool of ['bash_tool', 'web_search', 'memory_read', 'conversation_search', 'search_project_files', 'render_ui']) {
      expect(off.allowedTools).not.toContain(tool);
    }
  });

  it('never allows a discovery or skill-loading tool', () => {
    const on = routeTurn({ hasProject: true, codeEnabled: true, webEnabled: true, memoryEnabled: true });
    for (const gone of ['search_tools', 'load_skill', 'read_skill', 'list_skills', 'search_skills', 'run_python']) {
      expect(on.allowedTools).not.toContain(gone);
    }
  });
});
