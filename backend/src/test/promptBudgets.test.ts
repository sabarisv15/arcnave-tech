/**
 * Size budgets for the prompt and the tool declarations (tech-p03).
 *
 * Each figure below is what the deployed builders produce today, in characters (the provider's
 * token count needs a live call, and there is no estimator here: Invariant 3). A ceiling is the
 * figure plus 5%. The point is to catch growth by accident: P07 changes the prompt on purpose and
 * should LOWER these figures, then lower the numbers in this file with it.
 *
 * Baseline P03, P07 reduces. These are not N-register numbers: there is no N-id for a prompt
 * section size, so no register entry is read or written.
 *
 * Measured on the "full" scenario of `promptKit/scenarios.ts` (every capability on). Sections are
 * the top-level `<tag>` blocks; the stable part is the cached prefix, the dynamic part follows it.
 */
import { describe, expect, it } from 'vitest';

import { topLevelSections, toolChars } from '../../evals/promptSections.js';
import { buildScenarios } from './promptKit/scenarios.js';

const HEADROOM = 1.05;
const ceiling = (baseline: number): number => Math.ceil(baseline * HEADROOM);

const STABLE_SECTIONS: Record<string, number> = {
  core_behavior: 1770,
  truthfulness: 1129,
  communication: 3644,
  trust_boundaries: 1152,
  safety: 4329,
  wellbeing: 3089,
  evenhandedness: 1072,
  tool_use: 1243,
  professional_deliverables: 1569,
  source_transformation: 658,
  agent_behavior: 437,
  mistakes: 380,
  knowledge: 444,
  user_preferences: 1847,
  permissions_and_actions: 397,
  final_response: 375,
  memory_policy: 12782,
  past_chats_policy: 2860,
  compaction_policy: 562,
  visuals: 2353,
};
const DYNAMIC_SECTIONS: Record<string, number> = {
  arcNave_capabilities: 1309,
  computer_use: 8033,
  files: 1261,
  research: 690,
  web: 5469,
};
const TOOLS: Record<string, number> = {
  ask_user_input_v0: 1761,
  memory_list: 584,
  memory_read: 452,
  memory_write: 1832,
  memory_append: 1635,
  memory_str_replace: 1735,
  memory_delete: 540,
  conversation_search: 664,
  read_conversation: 613,
  recent_chats: 548,
  read_me: 816,
  show_widget: 1974,
  chart_display_v0: 3984,
  comparison_card_display_v0: 1847,
  featured_card_display_v0: 1598,
  itinerary_display_v0: 1750,
  link_preview_display_v0: 1465,
  message_compose_v1: 1779,
  options_card_display_v0: 1580,
  places_list_display_v0: 1459,
  product_carousel_display_v0: 1605,
  quiz_display_v0: 3080,
  recipe_display_v0: 1959,
  step_card_display_v0: 1507,
  translation_display_v0: 1693,
  web_search: 352,
  web_fetch: 677,
  image_search: 920,
  bash_tool: 809,
  view: 864,
  create_file: 579,
  str_replace: 730,
  present_files: 599,
  search_project_files: 761,
  read_project_file: 891,
};

const TOTALS = { stable: 42503, total: 60301, bare: 25874, noTools: 24874, tools: 45642 };

const s = buildScenarios();

describe('prompt size budgets (characters, baseline + 5%)', () => {
  it('holds every stable section within its budget, and names no section that is gone', () => {
    const now = Object.fromEntries(topLevelSections(s.full.stable).map((x) => [x.tag, x.chars]));
    expect(Object.keys(now).sort()).toEqual(Object.keys(STABLE_SECTIONS).sort());
    for (const [tag, baseline] of Object.entries(STABLE_SECTIONS)) {
      expect(now[tag], `${tag} grew past ${String(ceiling(baseline))} (baseline ${String(baseline)})`).toBeLessThanOrEqual(ceiling(baseline));
    }
  });

  it('holds the capability-dependent sections of the dynamic part within budget', () => {
    const now = Object.fromEntries(topLevelSections(s.full.dynamic).map((x) => [x.tag, x.chars]));
    for (const [tag, baseline] of Object.entries(DYNAMIC_SECTIONS)) {
      expect(now[tag], `${tag} is missing`).toBeDefined();
      expect(now[tag], `${tag} grew past ${String(ceiling(baseline))} (baseline ${String(baseline)})`).toBeLessThanOrEqual(ceiling(baseline));
    }
  });

  it('holds the whole system instruction within budget, with tools off, bare and fully on', () => {
    expect(s.noTools.system.length).toBeLessThanOrEqual(ceiling(TOTALS.noTools));
    expect(s.bare.system.length).toBeLessThanOrEqual(ceiling(TOTALS.bare));
    expect(s.full.stable.length).toBeLessThanOrEqual(ceiling(TOTALS.stable));
    expect(s.full.system.length).toBeLessThanOrEqual(ceiling(TOTALS.total));
  });
});

describe('tool declaration size budgets (characters, baseline + 5%)', () => {
  it('holds every declaration within its budget, and names no tool that is gone', () => {
    expect(s.full.tools.map((t) => t.name).sort()).toEqual(Object.keys(TOOLS).sort());
    for (const tool of s.full.tools) {
      const baseline = TOOLS[tool.name]!;
      expect(toolChars(tool), `${tool.name} grew past ${String(ceiling(baseline))} (baseline ${String(baseline)})`).toBeLessThanOrEqual(ceiling(baseline));
    }
  });

  it('holds all declarations together within budget', () => {
    expect(s.full.tools.reduce((sum, t) => sum + toolChars(t), 0)).toBeLessThanOrEqual(ceiling(TOTALS.tools));
  });
});
