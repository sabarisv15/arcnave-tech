/**
 * The Stage 6 prompt kit (68 cases), wired offline (tech-p03).
 *
 * What this file proves, with no provider reached:
 * - the kit file is the owner-confirmed master (sha256), parses under a strict schema, has 68
 *   unique ids, known gates and known rule ids, and every reference a case makes resolves;
 * - every case builds a real request through the deployed prompt and tool builders, and the fake
 *   provider receives it;
 * - the offline-checkable cases meet their request-side requirements, except the prompt gaps
 *   listed in `EXPECTED_GAPS`. A gap that closes fails this file (delete its entry); a new
 *   failure fails it too. P03 measures; it does not edit the prompt.
 *
 * Behaviour (what a model says) is not checked here; the live runner (`npm run eval:prompt`) does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  BACKEND_DIR,
  buildCaseRun,
  GATES,
  KIT_SHA256,
  KIT_TOOL_TO_DEPLOYED,
  kitSha256,
  loadCases,
  MockToolExecutor,
  parseKit,
  ruleIdsOf,
  toGenerationRequest,
} from '../../evals/prompt-kit/kit.js';
import type { CaseRun, KitCase } from '../../evals/prompt-kit/kit.js';
import { CASE_PLAN, EXPECTED_GAPS, REQUIREMENTS, runOffline } from '../../evals/prompt-kit/offlineGates.js';
import { FakeProvider } from './harness.js';

const NOW = new Date('2026-10-14T09:30:00.000Z');
const SPEC = join(BACKEND_DIR, '..', 'docs', 'architecture', 'Stage-06-Context-Prompt-Assembly', '06-policy-spec-v3.md');
const README = readFileSync(join(BACKEND_DIR, 'evals', 'prompt-kit', 'README.md'), 'utf8');

const cases = loadCases();
const runs = new Map<string, CaseRun>();

beforeAll(async () => {
  for (const c of cases) runs.set(c.id, await buildCaseRun(c, NOW));
});

const KIT_TOOLS = Object.keys(KIT_TOOL_TO_DEPLOYED);
/** "calls memory_save" in a case's expectation: the tool the case needs the model to be able to call. */
const calledTools = (c: KitCase): string[] => KIT_TOOLS.filter((t) => new RegExp(`calls (?:${t})\\b`).test(c.expect));

describe('prompt kit: the file', () => {
  it('is the owner-confirmed Stage 6 master, byte for byte, and README records it', () => {
    expect(kitSha256()).toBe(KIT_SHA256);
    expect(README).toContain(KIT_SHA256);
    expect(README).toContain('68 cases');
    expect(README).toContain('68 unique ids');
  });

  it('parses under a strict schema with no unknown field', () => {
    expect(parseKit().errors).toEqual([]);
  });

  it('has 68 cases with unique ids', () => {
    expect(cases).toHaveLength(68);
    expect(new Set(cases.map((c) => c.id)).size).toBe(68);
  });

  it('uses only the known gates, with the observe gate only on the two language cases', () => {
    for (const c of cases) expect(GATES, c.id).toContain(c.gate);
    expect(cases.filter((c) => c.gate === 'O').map((c) => c.id)).toEqual(['LG1', 'LG2']);
    expect(cases.filter((c) => c.gate === 'C')).toHaveLength(32);
  });

  it('cites only rule ids the policy spec defines', () => {
    const spec = readFileSync(SPEC, 'utf8');
    const known = new Set([...spec.matchAll(/^\|\s*\**([A-Z]{2}-\d+)\**\s*\|/gm)].map((m) => m[1]!));
    expect(known.size).toBeGreaterThan(80);
    for (const c of cases) {
      if (c.gate === 'O') continue;
      const ids = ruleIdsOf(c);
      expect(ids.length, `${c.id} cites no rule`).toBeGreaterThan(0);
      for (const id of ids) expect(known, `${c.id}: ${id}`).toContain(id);
    }
  });

  it('resolves every reference a case makes to its own fields', () => {
    for (const c of cases) {
      // Typed ids in the expectation point at a document of this case.
      const docIds = new Set((c.docs ?? []).map((d) => d.id));
      expect(docIds.size, `${c.id}: duplicate document id`).toBe((c.docs ?? []).length);
      for (const m of c.expect.matchAll(/\[file:(\d+)\]/g)) expect(docIds, `${c.id}: [file:${m[1]!}]`).toContain(`file:${m[1]!}`);
      // Ids the expectation asks the model to act on exist in the case's own data.
      for (const m of c.expect.matchAll(/\bmem-\d+\b/g)) expect((c.mem_records ?? []).map((r) => r.id), `${c.id}: ${m[0]}`).toContain(m[0]);
      for (const m of c.expect.matchAll(/\bart-\d+\b/g)) expect(c.app_note ?? '', `${c.id}: ${m[0]}`).toContain(m[0]);
      for (const m of c.expect.matchAll(/\bop-\d+\b/g)) expect(c.pending ?? '', `${c.id}: ${m[0]}`).toContain(m[0]);
      // A case that expects a tool call runs with tools on; one that has tools off expects none.
      if (calledTools(c).length > 0) expect(c.tools, `${c.id} expects a tool call but has tools off`).toBe(true);
      // History alternates and starts with the user.
      const roles = (c.history ?? []).map((h) => h.role);
      roles.forEach((r, i) => expect(r, `${c.id} history turn ${String(i)}`).toBe(i % 2 === 0 ? 'user' : 'assistant'));
    }
  });

  it("maps every tool a case expects to a deployed tool, except the one ArcNave does not have", () => {
    const unmapped = new Set<string>();
    for (const c of cases) {
      const run = runs.get(c.id)!;
      for (const kitTool of calledTools(c)) {
        const deployed = KIT_TOOL_TO_DEPLOYED[kitTool];
        if (deployed === null) unmapped.add(kitTool);
        else expect(run.scenario.toolNames, `${c.id}: ${kitTool} -> ${String(deployed)}`).toContain(deployed);
      }
    }
    // A gap, not a mapping: T11 needs a status tool. Listed in EXPECTED_GAPS as state.status_tool.
    expect([...unmapped]).toEqual(['get_operation_status']);
  });
});

describe('prompt kit: every case builds a real request', () => {
  it('builds through the deployed prompt and tool builders and reaches the fake provider', async () => {
    const provider = new FakeProvider();
    for (const c of cases) {
      const run = runs.get(c.id)!;
      expect(run.scenario.system.length, c.id).toBeGreaterThan(10_000);
      expect(run.prompt, c.id).toContain(c.user.slice(0, 20).replaceAll('<', '&lt;'));
      // Tools follow the case: none when off, never a web tool when web is off.
      if (!c.tools) expect(run.scenario.toolNames, c.id).toEqual([]);
      if (c.tools && c.web_search === 'off') expect(run.scenario.toolNames, c.id).not.toContain('web_search');
      if (c.tools && c.memory === 'off') expect(run.scenario.toolNames.some((n) => n.startsWith('memory_')), c.id).toBe(false);
      const request = toGenerationRequest(run, { providerModelId: 'fake-model', maxOutputTokens: 1000, signal: new AbortController().signal, toolExecutor: new MockToolExecutor() });
      for await (const event of provider.stream(request)) void event;
    }
    expect(provider.seen).toHaveLength(68);
    expect(provider.seen.every((r) => r.systemInstruction.length > 10_000 && r.prompt.length > 0)).toBe(true);
    // A tools-on request carries its declarations and an executor; a tools-off one neither.
    const t1 = provider.seen[cases.findIndex((c) => c.id === 'T1')]!;
    expect(t1.tools?.map((t) => t.name)).toContain('web_fetch');
    expect(t1.toolExecutor).toBeDefined();
    const s1 = provider.seen[cases.findIndex((c) => c.id === 'S1')]!;
    expect(s1.tools).toBeUndefined();
    expect(s1.toolExecutor).toBeUndefined();
  });

  it('keeps the long chat (LC1) at 30 turns and the history cases as given', () => {
    expect(runs.get('LC1')!.history).toHaveLength(30);
    expect(runs.get('H1')!.history.length).toBeGreaterThan(0);
  });

  it('records what the deployed request cannot express, instead of reshaping silently', () => {
    expect(runs.get('A2')!.approximations.join(' ')).toMatch(/company/);
    expect(runs.get('S5')!.approximations.join(' ')).toMatch(/formats/);
    expect(runs.get('S17')!.approximations.join(' ')).toMatch(/pending_operations/);
    expect(runs.get('T1')!.approximations).toEqual([]);
  });
});

describe('prompt kit: the offline gates', () => {
  it('plans all 68 cases, and every planned requirement exists', () => {
    expect(Object.keys(CASE_PLAN).sort()).toEqual(cases.map((c) => c.id).sort());
    for (const plan of Object.values(CASE_PLAN)) {
      if (plan.kind === 'live-only') expect(plan.reason.length).toBeGreaterThan(10);
      else for (const r of plan.requirements) expect(REQUIREMENTS, r).toHaveProperty(r);
    }
  });

  it('never marks an observe-gate case offline', () => {
    for (const c of cases.filter((x) => x.gate === 'O')) expect(CASE_PLAN[c.id]!.kind).toBe('live-only');
  });

  it('lists only real case/requirement pairs as expected gaps', () => {
    for (const key of Object.keys(EXPECTED_GAPS)) {
      const [id, requirement] = key.split(':') as [string, string];
      const plan = CASE_PLAN[id];
      expect(plan?.kind, key).toBe('offline');
      expect((plan as { requirements: string[] }).requirements, key).toContain(requirement);
      expect(EXPECTED_GAPS[key]!.length, key).toBeGreaterThan(20);
    }
  });

  for (const c of loadCases().filter((x) => CASE_PLAN[x.id]?.kind === 'offline')) {
    it(`${c.id} [${c.gate}] ${c.rules}: requirements match the recorded gaps`, () => {
      const outcome = runOffline(c.id, runs.get(c.id)!.scenario);
      for (const r of outcome.results) {
        const key = `${c.id}:${r.requirement}`;
        const expected = key in EXPECTED_GAPS;
        if (expected) {
          expect(r.failure, `${key} now passes: the gap is closed, remove it from EXPECTED_GAPS`).not.toBeNull();
        } else {
          expect(r.failure, `${key} (${r.rule}) fails and is not a recorded gap`).toBeNull();
        }
      }
    });
  }

  it('summarises the offline C-gate: every offline critical case is either met or a recorded gap', () => {
    const critical = cases.filter((c) => c.gate === 'C' && CASE_PLAN[c.id]!.kind === 'offline');
    const outcomes = critical.map((c) => runOffline(c.id, runs.get(c.id)!.scenario));
    const requirements = outcomes.flatMap((o) => o.results);
    const gapped = outcomes.filter((o) => o.results.some((r) => r.failure !== null));
    // Pinned so a change to the plan or to the prompt shows in review; the figures and the table
    // are in docs/ops/p03-result.md. When P07 closes a gap, lower the gap counts with its entry.
    expect(critical).toHaveLength(28);
    expect(requirements).toHaveLength(44);
    expect(requirements.filter((r) => r.failure !== null)).toHaveLength(25);
    expect(gapped).toHaveLength(20);
    expect(outcomes.length - gapped.length).toBe(8);
    // Every failing requirement is a recorded gap (the per-case tests above hold this one by one).
    for (const o of outcomes) for (const r of o.results) if (r.failure) expect(EXPECTED_GAPS).toHaveProperty([`${o.id}:${r.requirement}`]);
  });
});
