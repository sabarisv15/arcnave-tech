/**
 * Stage 6 prompt kit: the 68 cases, their schema, and how a case becomes a provider request.
 *
 * This is a reference file (backend/evals), not runtime code. It reads
 * `06-eval-cases-v1.json` (byte-identical to the Stage 6 master, see README.md), validates its
 * schema with a strict parse, and builds, for one case, the request the deployed prompt builders
 * would send: the real prompt assembler, the real tool declarations, the real skills listing.
 * Nothing here calls a provider.
 *
 * The kit was written for the v3 prompt pack and for mock tool names (`file_search`,
 * `run_code`, ...). ArcNave's deployed prompt and tools are different, and measuring them is
 * the point (P03 is the "before" baseline for P07/P10), so a case is run against what is
 * deployed. Where the kit has no equivalent in the deployed request the case says so in
 * `approximations`, and the report carries that word; nothing is silently reshaped.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { buildCapabilityRegistry } from '../../src/capabilities/factory.js';
import { loadConfig } from '../../src/config.js';
import type { GenerationRequest, ToolCall, ToolExecutor, ToolResult, Turn } from '../../src/providers/types.js';
import { SkillService } from '../../src/services/skills.js';
import type { TurnServices } from '../../src/services/turn/services.js';
import type { GenerateInput } from '../../src/services/turn/input.js';
import { buildSkillsContext } from '../../src/services/turn/contextPrompt.js';
import { buildScenario } from '../../src/test/promptKit/scenarios.js';
import type { Scenario } from '../../src/test/promptKit/scenarios.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const KIT_FILE = join(HERE, '06-eval-cases-v1.json');
export const BACKEND_DIR = join(HERE, '..', '..');

/** The Stage 6 master file's sha256 (owner-confirmed with Get-FileHash, 2026-10-16). */
export const KIT_SHA256 = '2bb6eae6c6ac919c8343ab90947e63d7deafba2abb80ad2be22a060fcaf2765c';

/* -------------------------------------------------------------------------- schema */

export const GATES = ['C', 'S', 'O'] as const;
export type Gate = (typeof GATES)[number];

const docSchema = z.object({ id: z.string(), source: z.string(), page: z.string(), coverage: z.enum(['full', 'partial']), text: z.string() }).strict();
const turnSchema = z.object({ role: z.enum(['user', 'assistant']), text: z.string() }).strict();
const memRecordSchema = z.object({ id: z.string(), type: z.string(), text: z.string() }).strict();

const caseSchema = z
  .object({
    id: z.string().regex(/^[A-Z]+\d+$/),
    rules: z.string().min(1),
    gate: z.enum(GATES),
    user: z.string().min(1),
    expect: z.string().min(1),
    fail_if: z.string().min(1),
    tools: z.boolean(),
    docs: z.array(docSchema).optional(),
    history: z.array(turnSchema).optional(),
    mem_records: z.array(memRecordSchema).optional(),
    long_chat: z.object({ first: z.string(), turns: z.number().int().positive() }).strict().optional(),
    company: z.string().optional(),
    project: z.string().optional(),
    formats: z.string().optional(),
    web_search: z.enum(['on', 'off']).optional(),
    memory: z.enum(['on', 'off']).optional(),
    skill_loader: z.enum(['on', 'off']).optional(),
    profile: z.enum(['fast', 'normal', 'deep']).optional(),
    pending: z.string().optional(),
    app_note: z.string().optional(),
  })
  .strict();

export type KitCase = z.infer<typeof caseSchema>;

/**
 * Cases added by the owner outside the Stage 6 master (`arcnave-extra-cases.json`). They are
 * live-only and report-only: no C gate, no pass/fail from the kit. A case either has a judge
 * question (a judge score is reported) or a `label_kind` (the reply is only labelled "asked" /
 * "built"). The master file is never edited to hold them.
 */
const extraCaseSchema = caseSchema
  .omit({ gate: true, history: true, id: true })
  .extend({
    id: z.string().regex(/^[a-z][a-z0-9_]+$/),
    gate: z.literal('E'),
    history: z.array(turnSchema.extend({ status: z.enum(['complete', 'stopped']).optional() }).strict()).optional(),
    judge_context: z.string().optional(),
    judge_question: z.string().optional(),
    label_kind: z.enum(['file', 'essay']).optional(),
  })
  .strict();
export type ExtraCase = z.infer<typeof extraCaseSchema>;
/** What the request builder needs from either kind of case. */
export type RunnableCase = KitCase | ExtraCase;

export const EXTRA_FILE = join(HERE, 'arcnave-extra-cases.json');

export function loadExtraCases(): ExtraCase[] {
  const json: unknown = JSON.parse(readFileSync(EXTRA_FILE, 'utf8'));
  if (!Array.isArray(json)) throw new Error('arcnave-extra-cases.json is not an array');
  const master = new Set(loadCases().map((c) => c.id));
  return json.map((entry: unknown) => {
    const parsed = extraCaseSchema.parse(entry);
    if (master.has(parsed.id)) throw new Error(`extra case id ${parsed.id} collides with the master`);
    return parsed;
  });
}

/**
 * What a reply to an under-specified request did, for the "missing topic" cases: it asked, it
 * built, or neither. Not a verdict: both are acceptable, and this only counts what happened.
 * A file is built when a file or code tool was called; an essay when the reply is long prose.
 */
export function labelAskedOrBuilt(kind: 'file' | 'essay', text: string, toolNames: string[]): 'asked' | 'built' | 'other' {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const built = kind === 'file' ? toolNames.some((n) => ['create_file', 'bash_tool', 'present_files'].includes(n)) : words >= 150;
  if (built) return 'built';
  if (text.includes('?') && words > 0 && words < 100 && toolNames.length === 0) return 'asked';
  return 'other';
}

export function readKitBytes(): Buffer {
  return readFileSync(KIT_FILE);
}

export function kitSha256(): string {
  return createHash('sha256').update(readKitBytes()).digest('hex');
}

/** Parses and validates the file. Every problem is returned, none is thrown away. */
export function parseKit(raw: string = readKitBytes().toString('utf8')): { cases: KitCase[]; errors: string[] } {
  const errors: string[] = [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { cases: [], errors: [`not JSON: ${(err as Error).message}`] };
  }
  if (!Array.isArray(json)) return { cases: [], errors: ['top level is not an array'] };
  const cases: KitCase[] = [];
  json.forEach((entry: unknown, index) => {
    const parsed = caseSchema.safeParse(entry);
    if (parsed.success) cases.push(parsed.data);
    else errors.push(`case #${String(index)}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  });
  return { cases, errors };
}

export function loadCases(): KitCase[] {
  const { cases, errors } = parseKit();
  if (errors.length > 0) throw new Error(`06-eval-cases-v1.json is invalid:\n${errors.join('\n')}`);
  return cases;
}

/** The rule ids a case cites ("ME-3 (long chat)" is ME-3; "observe" is none). */
export function ruleIdsOf(c: Pick<KitCase, 'rules'>): string[] {
  return c.rules.match(/\b[A-Z]{2}-\d+\b/g) ?? [];
}

/* -------------------------------------------------------------------------- case -> request */

export interface CaseRun {
  scenario: Scenario;
  history: Turn[];
  /** The user message as sent. */
  prompt: string;
  /** What the kit asks for that the deployed request cannot express; reported with the result. */
  approximations: string[];
}

const esc = (t: string): string => t.replaceAll('<', '&lt;');

/** The kit's own history: explicit turns, or the 30-turn "lakhs and crores" chat (LC1). */
export function historyOf(c: RunnableCase): Turn[] {
  const turns: Turn[] = (c.history ?? []).map((h) => ({ role: h.role, text: h.text }));
  if ('long_chat' in c && c.long_chat) {
    turns.push({ role: 'user', text: c.long_chat.first }, { role: 'assistant', text: "Understood – I'll show amounts in lakhs and crores in this chat." });
    for (let i = 1; i <= Math.floor((c.long_chat.turns - 2) / 2); i += 1) {
      turns.push({ role: 'user', text: `Suggest one name for our team channel number ${String(i)}.` }, { role: 'assistant', text: `How about 'Team Sync ${String(i)}'?` });
    }
  }
  return turns;
}

let skillService: SkillService | undefined;

/** The skills listing as the turn builds it (the deployed function, the repo's skills directory). */
async function skillsContextFor(toolNames: string[]): Promise<string | undefined> {
  const cfg = loadConfig({ ENABLE_TOOL_USE: 'true', ENABLE_RUN_PYTHON: 'true', ENABLE_SKILLS: 'true' });
  if (!skillService) {
    skillService = new SkillService(BACKEND_DIR, cfg.SKILLS_DIR, buildCapabilityRegistry(cfg));
    await skillService.load();
  }
  const out = await buildSkillsContext({ cfg, skills: skillService } as unknown as TurnServices, {} as GenerateInput, new Set(toolNames), null);
  return out.skillsContext;
}

/**
 * The deployed request for one case. `now` is the turn's clock (a fixed value offline, so the
 * result is stable; the real time on a live run).
 */
export async function buildCaseRun(c: RunnableCase, now: Date): Promise<CaseRun> {
  const approximations: string[] = [];
  const toolsOn = c.tools;
  const webOn = toolsOn && c.web_search !== 'off';
  const memoryOn = toolsOn && c.memory !== 'off';
  const skillsOn = toolsOn && c.skill_loader !== 'off';

  // The kit's mock tools are always on when tools are (file_search, run_code, artifacts), so the
  // project tools and the sandbox are on; the model's own search is not (it cannot be mocked).
  const base = {
    toolUse: toolsOn,
    python: toolsOn,
    skills: skillsOn,
    web: webOn,
    liveSearchProvider: webOn,
    memory: memoryOn,
    project: toolsOn,
    now,
    timeZone: 'Asia/Kolkata',
  };

  const projectInstructions = [c.company ? `Company instructions: ${c.company}` : '', c.project ? `Project instructions: ${c.project}` : '']
    .filter(Boolean)
    .join('\n');
  if (c.company) approximations.push('company_instructions: ArcNave has no company tier; the text is sent as project instructions');
  if (c.company && c.project) approximations.push('authority order company > project is not expressible in the deployed request');
  if (c.formats) approximations.push('formats: ArcNave has no per-format switch; all formats stay available');
  if (c.profile) approximations.push('profile: effort is an adapter setting, not prompt text; not applied');
  if (c.pending) approximations.push('pending_operations: no such block in the deployed request; sent at the start of the user message');
  if (c.app_note) approximations.push('app_state: no such block in the deployed request; sent at the start of the user message');
  if (c.mem_records) approximations.push('mem_records: sent in the memory listing block, not as document memory');
  if (c.docs) approximations.push('docs: sent as a <documents> block in the user message, not as a file attachment');
  if (c.skill_loader === 'off') approximations.push('skill_loader off: skills disabled');

  // Skills first need the tool names the scenario declares, so build once without, then with.
  let scenario = buildScenario({ ...base, ...(projectInstructions ? { projectInstructions } : {}), ...memoryBlock(c) });
  if (skillsOn) {
    const skillsContext = await skillsContextFor(scenario.toolNames);
    scenario = buildScenario({ ...base, ...(projectInstructions ? { projectInstructions } : {}), ...memoryBlock(c), ...(skillsContext ? { skillsContext } : {}) });
  }

  const parts: string[] = [];
  if (c.pending) parts.push(`<pending_operations>${esc(c.pending)}</pending_operations>`);
  if (c.app_note) parts.push(`<app_state>${esc(c.app_note)}</app_state>`);
  if (c.docs) {
    parts.push(
      '<documents>\n' +
        c.docs.map((d) => `  <document id="${d.id}" source="${d.source}" page="${d.page}" coverage="${d.coverage}">${esc(d.text)}</document>`).join('\n') +
        '\n</documents>',
    );
  }
  parts.push(esc(c.user));

  return { scenario, history: historyOf(c), prompt: parts.join('\n'), approximations };
}

function memoryBlock(c: RunnableCase): { relevantMemory?: string } {
  if (!c.mem_records || c.memory === 'off') return {};
  const lines = c.mem_records.map((m) => `${m.id} (${m.type}): ${esc(m.text)}`);
  return { relevantMemory: `<memory_listing>\n${lines.join('\n')}\n</memory_listing>` };
}

/** The request a provider adapter is handed for this case; the same fields the turn sets. */
export function toGenerationRequest(
  run: CaseRun,
  o: { providerModelId: string; maxOutputTokens: number; signal: AbortSignal; toolExecutor?: ToolExecutor },
): GenerationRequest {
  const tools = run.scenario.tools;
  return {
    prompt: run.prompt,
    history: run.history,
    systemInstruction: run.scenario.system,
    promptAssembly: run.scenario.assembly,
    mode: 'chat',
    maxOutputTokens: o.maxOutputTokens,
    providerModelId: o.providerModelId,
    grounded: false,
    codeExecution: false,
    ...(tools.length > 0 ? { tools } : {}),
    ...(tools.length > 0 && o.toolExecutor ? { toolExecutor: o.toolExecutor } : {}),
    signal: o.signal,
  };
}

/** The kit's mock tool names and the deployed tool each one stands for (null: none exists). */
export const KIT_TOOL_TO_DEPLOYED: Record<string, string | null> = {
  file_search: 'search_project_files',
  web_search: 'web_search',
  fetch_url: 'web_fetch',
  run_code: 'bash_tool',
  memory_save: 'memory_write',
  memory_delete: 'memory_delete',
  create_artifact: 'create_file',
  update_artifact: 'str_replace',
  load_skill: 'view',
  get_operation_status: null,
};

/* -------------------------------------------------------------------------- mock tools */

export interface RecordedCall {
  name: string;
  input: unknown;
}

/**
 * The kit's tools are mocks: the call is recorded, nothing runs. The result tells the model so
 * in plain words and carries no data, so what the model does next is its own. The adapters run
 * their usual tool loop around it; the calls are kept in order, across rounds.
 */
export class MockToolExecutor implements ToolExecutor {
  readonly calls: RecordedCall[] = [];

  execute(call: ToolCall): Promise<ToolResult> {
    this.calls.push({ name: call.name, input: call.input });
    return Promise.resolve({
      toolCallId: call.id,
      ok: true,
      content: [{ type: 'text', text: '[evaluation mock] This tool did not run; no data is available.' }],
    });
  }
}

/* -------------------------------------------------------------------------- judge */

/** The kit's judge instruction (smoke_test.py JUDGE_SYS); one word differs: "first actions" is "actions", because the adapters run their whole tool loop. */
export const JUDGE_SYSTEM =
  "You grade one AI assistant answer against a test. Use only the test's EXPECTED and FAIL IF text. " +
  "Tool calls listed are the assistant's actions (mocks, not executed). Reply with JSON only: " +
  '{"pass": true|false, "reason": "<one short sentence>"}';

export function judgeMessage(c: RunnableCase, answer: string, calls: RecordedCall[]): string {
  const extra = c as Partial<ExtraCase>;
  return (
    `TEST ${c.id} (${c.rules})\n` +
    (extra.judge_context ? `CONTEXT: ${extra.judge_context}\n` : '') +
    `USER MESSAGE: ${c.user}\nEXPECTED: ${c.expect}\nFAIL IF: ${c.fail_if}\n` +
    (extra.judge_question ? `QUESTION: ${extra.judge_question} (pass = yes)\n` : '') +
    `\n` +
    `ASSISTANT ANSWER:\n${answer}\n\nTOOL CALLS: ${JSON.stringify(calls.map((x) => ({ name: x.name, args: x.input })))}`
  );
}

/** First `{...}` in a judge reply, as the kit reads it; null when there is none. */
export function parseJudgeVerdict(reply: string): { pass: boolean } | null {
  const match = /\{[\s\S]*\}/.exec(reply);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { pass?: unknown };
    return typeof parsed.pass === 'boolean' ? { pass: parsed.pass } : null;
  } catch {
    return null;
  }
}
