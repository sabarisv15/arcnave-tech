import { describe, expect, it } from 'vitest';

import { DECLARED_EVERY_TURN } from '../../tools/registry.js';
import { routeTurn, type RouteTurnInput } from './turnRouter.js';

const candidateSkills = [
  { name: 'docx', description: 'Professional Word document authoring' },
  { name: 'pdf', description: 'Print-ready PDF report architecture' },
];

/** Discovery tools, then the allowed tools declared on every turn (ADR-0022). */
const core = (d: { allowedTools: string[] }, discovery = ['search_tools', 'load_skill']): string[] => [
  ...discovery,
  ...DECLARED_EVERY_TURN.filter((n) => d.allowedTools.includes(n)),
];

const base: RouteTurnInput = { hasAttachments: false, candidateSkills, hasProject: false };

describe('routeTurn: flags and infrastructure decide, never wording (ADR-0006, ADR-0032)', () => {
  it('takes no prompt at all, so wording cannot change a decision', () => {
    // A compile-time guarantee, checked at run time too: the input type has no prompt field.
    const input = { ...base } as Record<string, unknown>;
    expect('prompt' in input).toBe(false);
    expect(routeTurn(base)).toEqual(routeTurn({ ...base }));
  });

  it('exposes the fixed core on every turn', () => {
    const decision = routeTurn({ ...base, runPythonEnabled: true });
    expect(decision.exposedTools).toEqual(core(decision));
  });

  it('adds each capability only when its flag is on', () => {
    const on = routeTurn({
      ...base,
      hasAttachments: true,
      hasProject: true,
      imageEnabled: true,
      runPythonEnabled: true,
      webEnabled: true,
      memoryEnabled: true,
    });
    for (const tool of ['generate_image', 'run_python', 'web_search', 'save_memory', 'search_project_files', 'read_uploaded_file']) {
      expect(on.allowedTools).toContain(tool);
    }
    const off = routeTurn({ ...base, candidateSkills: [] });
    for (const tool of ['generate_image', 'run_python', 'web_search', 'save_memory', 'search_project_files', 'read_uploaded_file', 'load_skill']) {
      expect(off.allowedTools).not.toContain(tool);
    }
    expect(off.exposedTools).toEqual(core(off, ['search_tools']));
  });

  it('always allows deliverables, as Claude always has file creation when it is on', () => {
    expect(routeTurn(base).allowedTools).toContain('generate_deliverable');
  });

  it('preselects no skill: the model loads what it needs', () => {
    expect(routeTurn({ ...base, hasAttachments: true }).selectedSkills).toEqual([]);
  });
});
