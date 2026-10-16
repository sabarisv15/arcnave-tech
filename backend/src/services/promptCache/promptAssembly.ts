/**
 * Prompt assembly for the v3 system prompt (Stage 6 "Shared runtime layout", ADR-0075).
 *
 * Ordered by stability:
 * 1. Stable text, identical per provider, tool set and skill list: the v3 base, `<available_skills>`,
 *    the product-tools appendix. Claude: one cache breakpoint on it. Gemini: the whole system
 *    instruction (it carries no company, project, user, memory or date text, ADR-0004 doc-sync
 *    2026-10-05), so an explicit cache can hold it.
 * 2. Session state (model_info, capabilities_state, profile, memory snapshot, instructions).
 *    Claude: a second system block after the breakpoint. Gemini: the leading part of the turn.
 * 3. Per-turn state (current_time, earlier-conversation summary): the start of the user turn on
 *    both (Claude without the `clear_at` beta).
 */
import type { ToolDefinition } from '../../providers/types.js';
import { appendixSections, promptVersion, v3BaseText, type PromptProvider } from '../prompt/v3Prompt.js';
import {
  capabilitiesState,
  escapeAttribute,
  renderPerTurn,
  renderSessionState,
  type PerTurnInput,
  type SessionStateInput,
} from '../prompt/sessionState.js';
import {
  canonicalizeTools,
  computePrefixHash,
  computeToolBundleHash,
  identifyBundle,
} from './fingerprints.js';
import type { PromptAssembly, StablePrefix } from './types.js';

/** A skill the turn lists in `<available_skills>` (only skills whose required tools are declared). */
export interface ListedSkill {
  name: string;
  version: string;
  description: string;
  /** Where view reads it: load_skill has no equivalent yet (toolNameMap.ts). */
  path: string;
}

export interface StableOptions {
  /** The model's own web search is on this turn (Gemini grounding, Claude's server tool). */
  builtInWebSearch?: boolean;
  /** The sandbox keeps a chat's files between calls (the warm service). */
  persistentSandbox?: boolean;
  skills?: ListedSkill[];
}

/**
 * Which appendix sections a turn gets: a section that names a tool goes in only when that tool is
 * declared (mistakes.md 2026-09-26), so the appendix never tells the model to call a tool it
 * was not given. The base text names stage tools instead, and `<capabilities_state>` says which
 * are off (Stage 6 CP-1).
 */
export function appendixSectionIds(declared: ReadonlySet<string>, opts: StableOptions): string[] {
  const sandbox = declared.has('bash_tool');
  const skills = sandbox && declared.has('view') && (opts.skills?.length ?? 0) > 0;
  const ids: string[] = [];
  if (declared.size > 0) {
    // The sentence that names the computer goes in only with the computer (bash_tool).
    ids.push('uploaded_files_open', 'uploaded_files_seen');
    if (sandbox) ids.push('uploaded_files_computer');
    ids.push('uploaded_files_close');
  }
  if (declared.has('search_project_files')) ids.push('project_files');
  if (sandbox) {
    ids.push('computer_open');
    if (skills) ids.push('computer_skills');
    ids.push('computer_machine', opts.persistentSandbox ? 'computer_persistent' : 'computer_ephemeral');
    ids.push('computer_locations', 'computer_building', 'computer_giving');
    ids.push(skills ? 'computer_deciding_with_skills' : 'computer_deciding_without_skills');
    ids.push('computer_artifacts', 'computer_close');
  }
  if (declared.has('show_widget')) ids.push('visuals');
  if (declared.has('memory_str_replace')) ids.push('memory_files');
  if (declared.has('conversation_search')) ids.push('past_chats');
  // Names no tool; explains the earlier-conversation summary (legacy compaction policy, carried).
  ids.push('compaction');
  return ids;
}

/** `<available_skills>`: id, version, when to use, and the file view reads. */
export function renderSkillsList(skills: readonly ListedSkill[]): string {
  if (skills.length === 0) return '';
  return (
    '<available_skills>\n' +
    skills
      .map(
        (s) =>
          `<skill id="${escapeAttribute(s.name)}" v="${escapeAttribute(s.version)}" path="${escapeAttribute(s.path)}">${s.description}</skill>`,
      )
      .join('\n') +
    '\n</available_skills>'
  );
}

/**
 * The stable text and tool fingerprints. Identical for every turn with the same provider, tools,
 * skills and sandbox kind, which is what the prompt cache keys on.
 */
export function buildStablePrefix(
  provider: PromptProvider,
  authorizedTools: ToolDefinition[],
  opts: StableOptions = {},
): StablePrefix {
  const declared = new Set(authorizedTools.map((t) => t.name));
  const sections = appendixSections();
  const appendix = appendixSectionIds(declared, opts).map((id) => {
    const text = sections.get(id);
    if (text === undefined) throw new Error(`appendix section "${id}" is missing from the appendix file`);
    return text;
  });
  const systemText = [v3BaseText(provider), renderSkillsList(opts.skills ?? []), ...appendix]
    .filter((part) => part !== '')
    .join('\n\n');

  const tools = canonicalizeTools(authorizedTools);
  const toolBundleHash = computeToolBundleHash(tools);
  return {
    systemText,
    tools,
    toolBundleHash,
    prefixHash: computePrefixHash(systemText, toolBundleHash),
    bundleName: identifyBundle(tools),
  };
}

export interface PromptInputs extends StableOptions {
  provider: PromptProvider;
  tools: ToolDefinition[];
  session: Omit<SessionStateInput, 'capabilities'>;
  perTurn: PerTurnInput;
}

/** The whole prompt for one request, laid out for its provider. */
export function assemblePrompt(inputs: PromptInputs): PromptAssembly {
  const stablePrefix = buildStablePrefix(inputs.provider, inputs.tools, inputs);
  const capabilities = capabilitiesState(new Set(inputs.tools.map((t) => t.name)), Boolean(inputs.builtInWebSearch));
  const sessionState = renderSessionState({ ...inputs.session, capabilities });
  const perTurn = renderPerTurn(inputs.perTurn);
  const claude = inputs.provider === 'anthropic';
  return {
    stablePrefix,
    sessionState,
    perTurn,
    fullSystemInstruction: claude ? `${stablePrefix.systemText}\n\n${sessionState}` : stablePrefix.systemText,
    turnPreamble: claude ? perTurn : `${sessionState}\n${perTurn}`,
    promptVersion: promptVersion(inputs.provider),
    blockSizes: {
      stable: stablePrefix.systemText.length,
      sessionState: sessionState.length,
      perTurn: perTurn.length,
    },
  };
}
