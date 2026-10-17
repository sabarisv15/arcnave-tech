/**
 * Size budgets for the prompt and the tool declarations (tech-p03; re-based by tech-p07).
 *
 * Each figure below is what the deployed builders produce, in characters (the provider's token
 * count needs a live call, and there is no estimator here: Invariant 3). A ceiling is the figure
 * plus 5%. The point is to catch growth by accident.
 *
 * P03 baseline (legacy builder): stable 42,503, full system 60,301, no tools 24,874, tools 45,642.
 * P07 (v3 prompt, ADR-0075): the figures below. The v3 base is fixed text (the drift test guards
 * it); its section sizes are pinned here so a docs-mirror update shows its size change in review.
 * Stage 6 target: Gemini base ≈ 6.5k tokens + tools ≈ 2.2k tokens; whether the base meets it
 * needs the provider's count (owner-run `scripts/live/measureTokens.ts`), not a character figure.
 * The tool declarations are Prompt 6's (unchanged here). No N-id exists for these sizes.
 *
 * Measured on the "full" scenarios of `promptKit/scenarios.ts` (every capability on).
 */
import { describe, expect, it } from 'vitest';

import { topLevelSections, toolChars } from '../../evals/promptSections.js';
import { buildScenarios } from './promptKit/scenarios.js';

const HEADROOM = 1.05;
const ceiling = (baseline: number): number => Math.ceil(baseline * HEADROOM);

/** The sections inside `<arcnave_assistant>` of each rendering. */
const GEMINI_BASE_SECTIONS: Record<string, number> = {
  role: 217, critical_rules: 1649, identity: 151, authority: 318, untrusted_content: 368, profile: 272,
  response_style: 1448, honesty: 590, citations: 641, time: 531, safety: 1044, professional_topics: 1057,
  wellbeing: 679, confidentiality: 393, product_and_limits: 838, files: 692, web_search: 423, memory: 1859,
  tools: 803, artifacts: 838, skills: 422, examples: 1131,
};
const CLAUDE_BASE_SECTIONS: Record<string, number> = {
  identity: 582, authority: 1263, untrusted_content: 834, capabilities: 388, profile: 382, style: 2024,
  honesty: 1375, citations: 1007, time: 775, safety: 2068, professional_topics: 1367, wellbeing: 1032,
  confidentiality: 775, product_knowledge: 661, limits: 631, files: 1242, web_search: 670, memory: 3353,
  tools: 1598, artifacts: 1424, skills: 651, examples: 3266,
};
/** The top-level blocks of the stable text: the base, the skills list and the appendix sections (own budget, ours). */
const STABLE_BLOCKS: Record<string, number> = {
  arcnave_assistant: 16449,
  available_skills: 196,
  uploaded_files: 728,
  project_files: 548,
  computer_use: 5123,
  visuals: 2353,
  memory_files: 3108,
  past_chats_policy: 2768,
  compaction_policy: 492,
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

const TOTALS = { geminiStable: 31781, claudeStable: 42785, claudeSystem: 43886, bare: 17482, noTools: 16943, tools: 45642 };

const s = buildScenarios();
const inner = (t: string): string => t.slice(t.indexOf('<arcnave_assistant>') + '<arcnave_assistant>'.length, t.indexOf('</arcnave_assistant>'));

describe('prompt size budgets (characters, baseline + 5%)', () => {
  for (const [label, text, budget] of [
    ['Gemini', () => s.full.stable, GEMINI_BASE_SECTIONS],
    ['Claude', () => s.fullClaude.stable, CLAUDE_BASE_SECTIONS],
  ] as const) {
    it(`holds every ${label} base section within its budget, and names no section that is gone`, () => {
      const now = Object.fromEntries(topLevelSections(inner(text())).map((x) => [x.tag, x.chars]));
      expect(Object.keys(now).sort()).toEqual(Object.keys(budget).sort());
      for (const [tag, baseline] of Object.entries(budget)) {
        expect(now[tag], `${tag} grew past ${String(ceiling(baseline))} (baseline ${String(baseline)})`).toBeLessThanOrEqual(ceiling(baseline));
      }
    });
  }

  it('holds the base, the skills list and each appendix section within budget', () => {
    const now = Object.fromEntries(topLevelSections(s.full.stable).map((x) => [x.tag, x.chars]));
    expect(Object.keys(now).sort()).toEqual(Object.keys(STABLE_BLOCKS).sort());
    for (const [tag, baseline] of Object.entries(STABLE_BLOCKS)) {
      expect(now[tag], `${tag} grew past ${String(ceiling(baseline))} (baseline ${String(baseline)})`).toBeLessThanOrEqual(ceiling(baseline));
    }
  });

  it('holds the whole stable text and system instruction within budget, with tools off, bare and fully on', () => {
    expect(s.noTools.system.length).toBeLessThanOrEqual(ceiling(TOTALS.noTools));
    expect(s.bare.system.length).toBeLessThanOrEqual(ceiling(TOTALS.bare));
    expect(s.full.stable.length).toBeLessThanOrEqual(ceiling(TOTALS.geminiStable));
    expect(s.fullClaude.stable.length).toBeLessThanOrEqual(ceiling(TOTALS.claudeStable));
    expect(s.fullClaude.system.length).toBeLessThanOrEqual(ceiling(TOTALS.claudeSystem));
  });

  it('is smaller than the legacy builder it replaced (P03 baseline)', () => {
    expect(s.full.stable.length).toBeLessThan(42503);
    expect(s.noTools.system.length).toBeLessThan(24874);
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
