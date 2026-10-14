/**
 * TurnRouter: the policy boundary. ADR-0006, amended by ADR-0047.
 *
 * It answers one question: which tools is this turn *allowed* to use. That comes from flags,
 * permissions and the infrastructure present, never from the prompt's wording. Every allowed
 * tool is declared: there is no discovery step.
 *
 * There is no intent detection: the prompt's wording is never read here. The model reads the
 * request (ADR-0032).
 */

import { CODE_TOOL_NAMES, UI_TOOL_DEFINITIONS } from '../../tools/definitions.js';

/** Flags and infrastructure only. The prompt is deliberately not an input: wording decides nothing. */
export interface RouteTurnInput {
  hasProject: boolean;
  codeEnabled?: boolean;
  generativeUiEnabled?: boolean;
  webEnabled?: boolean;
  /** A search provider with a live index is configured (SerpAPI or Google CSE). */
  searchProviderLive?: boolean;
  /** The model's own web search is on this turn (Gemini grounding, Anthropic's server tool). */
  builtInSearch?: boolean;
  memoryEnabled?: boolean;
  /** Past-chat search, its own user setting (ADR-0052). Follows memoryEnabled when not given. */
  chatSearchEnabled?: boolean;
}

export interface TurnRoutingDecision {
  allowedTools: string[];
}

export interface RuntimeDebugTrace {
  loadedSkills: string[];
  allowedTools: string[];
  toolsCalled: string[];
}

export function routeTurn(input: RouteTurnInput): TurnRoutingDecision {
  const allowed = new Set<string>(['ask_user_input_v0']);
  // One web search, as the reference has: the model's own when it is on (a second tool named
  // web_search beside Anthropic's server tool is a 400, "Tool names must be unique"), ours when a
  // live provider exists, and none rather than a placeholder result (Invariant 1).
  if (input.webEnabled) {
    allowed.add('web_fetch');
    if (input.searchProviderLive) {
      if (!input.builtInSearch) allowed.add('web_search');
      allowed.add('image_search');
    }
  }
  if (input.memoryEnabled) {
    for (const t of ['memory_list', 'memory_read', 'memory_write', 'memory_append', 'memory_str_replace', 'memory_delete']) {
      allowed.add(t);
    }
  }
  if (input.chatSearchEnabled ?? input.memoryEnabled) {
    for (const t of ['conversation_search', 'read_conversation', 'recent_chats']) allowed.add(t);
  }
  if (input.hasProject) {
    allowed.add('search_project_files');
    allowed.add('read_project_file');
  }
  // Permission and infrastructure only (ENABLE_RUN_PYTHON + a sandbox client), never wording.
  if (input.codeEnabled) for (const t of CODE_TOOL_NAMES) allowed.add(t);
  if (input.generativeUiEnabled) for (const t of UI_TOOL_DEFINITIONS) allowed.add(t.name);
  return { allowedTools: [...allowed] };
}
