/**
 * Prints the 68-case classification as Markdown (tech-p03): id, category, gate and rules, whether
 * the case is offline-checkable or live-only and why, and the offline result. No provider; run it
 * with `npm run kit:table` and paste into docs/ops/p03-result.md when the plan changes.
 */
import { buildCaseRun, loadCases, loadExtraCases } from '../evals/prompt-kit/kit.js';
import { CASE_PLAN, EXPECTED_GAPS, REQUIREMENTS, runOffline } from '../evals/prompt-kit/offlineGates.js';

/** Our grouping of the kit's id prefixes (the file has no category field). */
const CATEGORY: Record<string, string> = {
  S: 'system-prompt rules',
  T: 'tool use',
  A: 'authority',
  C: 'capability off',
  Y: 'style',
  H: 'honesty under pushback',
  CT: 'citations',
  TM: 'time',
  P: 'professional topics',
  W: 'wellbeing',
  K: 'confidentiality',
  CR: 'copyright',
  L: 'product limits',
  M: 'memory',
  LC: 'long chat',
  LG: 'language (observe)',
};

const cell = (s: string): string => s.replaceAll('|', '/');

const NOW = new Date('2026-10-14T09:30:00.000Z');
const rows: string[] = [];
let offline = 0;
let live = 0;
let cOffline = 0;
let cMet = 0;
for (const c of loadCases()) {
  const plan = CASE_PLAN[c.id]!;
  const category = CATEGORY[/^[A-Z]+/.exec(c.id)![0]!] ?? '?';
  if (plan.kind === 'live-only') {
    live += 1;
    rows.push(`| ${c.id} | ${category} | ${c.gate} · ${cell(c.rules)} | live-only | ${cell(plan.reason)} | - |`);
    continue;
  }
  offline += 1;
  const outcome = runOffline(c.id, (await buildCaseRun(c, NOW)).scenario);
  const met = outcome.results.every((r) => r.failure === null);
  if (c.gate === 'C') {
    cOffline += 1;
    if (met) cMet += 1;
  }
  const detail = outcome.results.map((r) => `${r.requirement} ${r.failure === null ? 'met' : EXPECTED_GAPS[`${c.id}:${r.requirement}`] ? 'GAP' : 'UNEXPECTED'}`).join('; ');
  rows.push(`| ${c.id} | ${category} | ${c.gate} · ${cell(c.rules)} | offline-checkable | ${detail} | ${met ? 'met' : 'gap'} |`);
}
console.log('| id | category | gate · rules | class | reason / requirements | offline result |');
console.log('|---|---|---|---|---|---|');
console.log(rows.join('\n'));
console.log(`\noffline-checkable ${String(offline)}, live-only ${String(live)}; offline C cases ${String(cOffline)}, fully met ${String(cMet)}, with a gap ${String(cOffline - cMet)}`);
console.log(`\nRequirements used: ${String(Object.keys(REQUIREMENTS).length)}; recorded gaps: ${String(Object.keys(EXPECTED_GAPS).length)}`);
console.log(`\nExtra cases (owner request, live-only, report-only): ${loadExtraCases().map((c) => c.id).join(', ')}`);
