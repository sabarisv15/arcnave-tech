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

import { CODE_TOOL_NAMES } from '../../tools/definitions.js';

/** Flags and infrastructure only. The prompt is deliberately not an input: wording decides nothing. */
export interface RouteTurnInput {
  hasProject: boolean;
  codeEnabled?: boolean;
  generativeUiEnabled?: boolean;
  webEnabled?: boolean;
  memoryEnabled?: boolean;
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
  const allowed = new Set<string>(['create_artifact', 'read_artifact', 'update_artifact', 'ask_user_options']);
  if (input.webEnabled) for (const t of ['web_search', 'web_fetch', 'image_search']) allowed.add(t);
  if (input.memoryEnabled) {
    for (const t of ['memory_list', 'memory_read', 'memory_write', 'memory_append', 'memory_str_replace', 'memory_delete']) {
      allowed.add(t);
    }
    for (const t of ['conversation_search', 'read_conversation', 'recent_chats']) allowed.add(t);
  }
  if (input.hasProject) {
    allowed.add('search_project_files');
    allowed.add('read_project_file');
  }
  // Permission and infrastructure only (ENABLE_RUN_PYTHON + a sandbox client), never wording.
  if (input.codeEnabled) for (const t of CODE_TOOL_NAMES) allowed.add(t);
  if (input.generativeUiEnabled) allowed.add('render_ui');
  return { allowedTools: [...allowed] };
}
