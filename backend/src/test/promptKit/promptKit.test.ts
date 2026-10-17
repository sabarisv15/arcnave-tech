/**
 * Prompt test kit runner (offline).
 *
 * Builds the assembled system prompt and tool declarations for each scenario in `scenarios.ts`
 * and runs every case in `cases.ts` against them. No provider is called. Cases that need a
 * model's behaviour are skipped with the id of the live verification that owns them.
 *
 * Gate: a `critical` case is a plain `it`, so one failure fails the suite and CI. The only
 * soft path is `knownFailure`, which turns a case into `it.fails` so a finding stays visible
 * without hiding it, and the file goes red as soon as the prompt is fixed and the marker is stale.
 */
import { describe, expect, it } from 'vitest';

import { CASES } from './cases.js';
import type { Category, KitCase } from './cases.js';
import { buildScenario, buildScenarios } from './scenarios.js';

const scenarios = buildScenarios();

const label = (c: KitCase): string => `${c.id} ${c.critical ? '[critical] ' : ''}${c.title}`;

describe('prompt test kit: structure', () => {
  it('has unique case ids', () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every case exactly one of an offline check or a live verification', () => {
    for (const c of CASES) {
      expect(Boolean(c.check) !== Boolean(c.liveOnly), `${c.id} needs exactly one of check / liveOnly`).toBe(true);
    }
  });

  it('names a live verification as LV-<number> or LV-?', () => {
    for (const c of CASES.filter((x) => x.liveOnly)) {
      expect(c.liveOnly, c.id).toMatch(/^LV-(\d+|\?)$/);
    }
  });

  it('only marks offline cases as known failures', () => {
    for (const c of CASES.filter((x) => x.knownFailure)) {
      expect(c.check, `${c.id} is a known failure but has no check`).toBeDefined();
    }
  });

  it('scaffolds every category', () => {
    const categories: Category[] = [
      'precedence', 'honesty', 'tools', 'cache', 'context', 'language', 'format',
      'tool-use', 'files', 'web', 'memory', 'safety', 'brand',
    ];
    for (const category of categories) {
      expect(CASES.some((c) => c.category === category), category).toBe(true);
    }
  });

  it('keeps scenario building in step with the service (parity control)', () => {
    // If the router, registry or assembler change shape, these controls fail before any case
    // does, so a case never passes on a scenario that no longer resembles a real turn.
    expect(scenarios.full.toolNames).toEqual(expect.arrayContaining(['bash_tool', 'web_search', 'memory_read', 'show_widget', 'search_project_files']));
    expect(scenarios.noTools.toolNames).toEqual([]);
    expect(scenarios.bare.toolNames).toEqual(['ask_user_input_v0']);
    expect(scenarios.full.system.length).toBeGreaterThan(scenarios.bare.system.length);
    expect(buildScenario({}).whole).toBe(scenarios.bare.whole);
  });
});

for (const category of [...new Set(CASES.map((c) => c.category))]) {
  describe(`prompt test kit: ${category}`, () => {
    for (const c of CASES.filter((x) => x.category === category)) {
      if (c.liveOnly) {
        // Vitest has no skip-reason argument; the reason is the last words of the title.
        it.skip(`${label(c)} - needs live model (${c.liveOnly})`, () => {});
      } else if (c.knownFailure) {
        // A finding, not a pass: see `knownFailure` on the case. Fix the prompt, then delete
        // the marker; leaving it makes this test fail because the case now passes.
        it.fails(label(c), () => c.check!(scenarios));
      } else {
        it(label(c), () => c.check!(scenarios));
      }
    }
  });
}
