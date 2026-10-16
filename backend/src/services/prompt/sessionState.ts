/**
 * The blocks around the v3 base prompt (Stage 6 policy spec, "Shared runtime layout"; ADR-0075):
 * the session state (system side) and the per-turn state. Pure: every input is given, nothing is
 * read here.
 *
 * Every piece of text that came from a user, a file or memory is escaped (`<` → `&lt;`) before it
 * is placed inside a tag, so it cannot open or close one (AU-4: authority comes from where text
 * comes from, not from its tags). The base prompt and the blocks' own tags are not escaped.
 */
import { createHash } from 'node:crypto';

import { STAGE_TOOLS, type CapabilityFlag } from './toolNameMap.js';

/** `<` → `&lt;`: what the spec asks of all user, file, web and memory text. */
export function escapeText(text: string): string {
  return text.replace(/</g, '&lt;');
}

export { RESERVED_TAGS, neutraliseReservedTags } from './reservedTags.js';

/** An attribute value: also `"` and `&`, so the value cannot end its own quotes. */
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** First 12 hex of the SHA-256: the `version` of a versioned block (AU-3, "versioned blocks"). */
export function blockVersion(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/** The order the spec lists the flags in. */
export const CAPABILITY_FLAGS: readonly CapabilityFlag[] = [
  'web_search',
  'fetch_url',
  'file_search',
  'run_code',
  'memory',
  'sensitive_memory',
  'skill_loader',
  'formats',
];

/**
 * The output formats the sandbox can build (skills docx, xlsx, pptx, pdf; csv and md as plain
 * files; charts, web pages, React components, SVG and Mermaid as files ArcNave renders). Ours: the spec leaves the list to the
 * deployment. All of them need the sandbox, so none is on without it.
 */
export const SANDBOX_FORMATS = ['docx', 'xlsx', 'pptx', 'pdf', 'csv', 'md', 'chart', 'web-page', 'jsx', 'svg', 'mermaid'] as const;

export type CapabilitiesState = Record<Exclude<CapabilityFlag, 'formats'>, 'on' | 'off'> & { formats: string };

/**
 * `<capabilities_state>` from the tools this turn declares (CP-1: missing or unclear means off).
 * A flag is on when the stage tool behind it has a declared equivalent (`STAGE_TOOLS`):
 * - web_search: the web_search function, or the model's built-in search on a grounded turn.
 * - fetch_url: web_fetch. file_search: search_project_files. run_code: bash_tool.
 * - memory: memory_read, memory_write and memory_delete all declared.
 * - sensitive_memory: always off; ArcNave has no opt-in for sensitive memory (ME-6).
 * - skill_loader: off; load_skill has no exact equivalent (a skill is read with view).
 * - formats: SANDBOX_FORMATS when the sandbox's file tools are declared, else empty.
 */
export function capabilitiesState(declared: ReadonlySet<string>, builtInWebSearch: boolean): CapabilitiesState {
  const has = (stageTool: string): boolean => {
    const target = STAGE_TOOLS[stageTool]?.target;
    return target != null && declared.has(target);
  };
  const on = (b: boolean): 'on' | 'off' => (b ? 'on' : 'off');
  const sandbox = has('run_code') && has('create_artifact') && declared.has('present_files');
  return {
    web_search: on(builtInWebSearch || has('web_search')),
    fetch_url: on(has('fetch_url')),
    file_search: on(has('file_search')),
    run_code: on(has('run_code')),
    memory: on(has('memory_read') && has('memory_write') && has('memory_delete')),
    sensitive_memory: 'off',
    skill_loader: on(has('load_skill')),
    formats: sandbox ? SANDBOX_FORMATS.join(',') : '',
  };
}

export type Profile = 'fast' | 'normal' | 'deep';

/** RT-4 read backwards: Fast = low, Normal = medium, Deep = high. No effort control → normal. */
export function profileForEffort(effort: string | undefined): Profile {
  if (effort === 'low') return 'fast';
  if (effort === 'high' || effort === 'xhigh' || effort === 'max') return 'deep';
  return 'normal';
}

/** Project file text (whole files or excerpts) in its tag, escaped: file text is untrusted. */
export function projectKnowledgeBlock(text: string): string {
  return `<project_knowledge>\n${escapeText(text)}\n</project_knowledge>`;
}

export interface MemorySnapshot {
  /** One line per memory file: path, description, aliases. */
  listing: string;
  /** /profile.md, when written. */
  profile?: string;
  /** /preferences.md, when written. */
  preferences?: string;
}

export interface SessionStateInput {
  model: { name: string; knowledgeCutoff: string | null };
  capabilities: CapabilitiesState;
  profile: Profile;
  /** Only when memory is on (ME-1). */
  memory?: MemorySnapshot;
  project?: { name: string; instructions?: string; knowledge?: string };
  /** The user's standing instructions (Settings). Ours: the spec has no user block yet. */
  userInstructions?: string;
  /** The chosen response style's instructions. Ours (ADR-0033). */
  styleInstructions?: string;
  /** Skills read in turns a compaction summarised, given again in full (ADR-0027). Trusted. */
  skillsReadEarlier?: string;
}

/** The session state, system side: changes only when the model, capabilities, profile, memory or instructions change. */
export function renderSessionState(s: SessionStateInput): string {
  const parts: string[] = [];
  const cutoff = s.model.knowledgeCutoff ? ` knowledge_cutoff="${escapeAttribute(s.model.knowledgeCutoff)}"` : '';
  parts.push(`<model_info name="${escapeAttribute(s.model.name)}"${cutoff}/>`);
  parts.push(
    '<capabilities_state ' +
      CAPABILITY_FLAGS.map((f) => `${f}="${escapeAttribute(s.capabilities[f])}"`).join(' ') +
      '/>',
  );
  parts.push(`<profile>${s.profile}</profile>`);
  if (s.memory) {
    const body = [
      `<memory_listing>\n${escapeText(s.memory.listing) || '(empty)'}\n</memory_listing>`,
      `<profile_document>\n${s.memory.profile ? escapeText(s.memory.profile) : '(not yet written)'}\n</profile_document>`,
      ...(s.memory.preferences ? [`<preferences_document>\n${escapeText(s.memory.preferences)}\n</preferences_document>`] : []),
    ].join('\n');
    parts.push(`<memory_snapshot version="${blockVersion(body)}">\n${body}\n</memory_snapshot>`);
  }
  if (s.project?.instructions?.trim()) {
    const text = escapeText(s.project.instructions.trim());
    parts.push(
      `<project_instructions project="${escapeAttribute(s.project.name)}" version="${blockVersion(text)}">\n${text}\n</project_instructions>`,
    );
  }
  if (s.userInstructions?.trim()) {
    parts.push(`<user_instructions>\n${escapeText(s.userInstructions.trim())}\n</user_instructions>`);
  }
  if (s.styleInstructions?.trim()) {
    parts.push(`<style_instructions>\n${escapeText(s.styleInstructions.trim())}\n</style_instructions>`);
  }
  if (s.project?.knowledge?.trim()) parts.push(s.project.knowledge.trim());
  if (s.skillsReadEarlier?.trim()) parts.push(`<skills_read_earlier>\n${s.skillsReadEarlier.trim()}\n</skills_read_earlier>`);
  return parts.join('\n');
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const IST_OFFSET_MS = 330 * 60 * 1000;

/** `2026-10-11T01:45:30+05:30 Sunday IST` (doc-sync 2026-10-11): IST ISO-8601 with offset, English weekday, zone name. */
export function currentTimeIst(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const iso = ist.toISOString().slice(0, 19);
  return `${iso}+05:30 ${WEEKDAYS[ist.getUTCDay()]!} IST`;
}

export interface PerTurnInput {
  now: Date;
  /** The compaction summary's text and how far it reaches. */
  summary?: { throughSeq: number; text: string };
  /** The search / research mode instruction for this message. Ours (legacy, carried). */
  modeDirective?: string;
  /** A note about the client (a phone). Ours (legacy, carried). */
  clientNote?: string;
}

/** The per-turn state: the time, and an earlier-conversation summary when one exists. No pending operations exist yet. */
export function renderPerTurn(t: PerTurnInput): string {
  const parts = [`<current_time>${currentTimeIst(t.now)}</current_time>`];
  if (t.summary?.text.trim()) {
    parts.push(
      `<earlier_conversation_summary through_seq="${String(t.summary.throughSeq)}">\n${escapeText(t.summary.text.trim())}\n</earlier_conversation_summary>`,
    );
  }
  if (t.modeDirective?.trim()) parts.push(t.modeDirective.trim());
  if (t.clientNote?.trim()) parts.push(t.clientNote.trim());
  return parts.join('\n');
}
