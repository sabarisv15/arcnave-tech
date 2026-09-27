/**
 * TurnRouter: the policy boundary. ADR-0006.
 *
 * It answers one question: which tools is this turn *allowed* to use. That comes from flags,
 * permissions and the infrastructure present, never from the prompt's wording. The model
 * decides what it needs: every turn gets the same core (`search_tools`, plus `load_skill` when
 * skills exist) and discovers the rest from `allowedTools`.
 *
 * There is no intent detection: the prompt's wording is never read here. Claude's harness has no
 * keyword router either; the model reads the request (ADR-0032).
 */

import { DECLARED_EVERY_TURN } from '../../tools/registry.js';

/** Flags and infrastructure only. The prompt is deliberately not an input: wording decides nothing. */
export interface RouteTurnInput {
  hasAttachments: boolean;
  candidateSkills: Array<{ name: string; description: string }>;
  hasProject: boolean;
  imageEnabled?: boolean;
  runPythonEnabled?: boolean;
  generativeUiEnabled?: boolean;
  /** Trusted CLI, skill scripts and a vision provider are all available (Phase 3). */
  tableExtractionEnabled?: boolean;
  webEnabled?: boolean;
  memoryEnabled?: boolean;
}

export interface TurnRoutingDecision {
  candidateSkills: string[];
  selectedSkills: string[];
  allowedTools: string[];
  exposedTools: string[];
}

export interface RuntimeDebugTrace {
  candidateSkills: string[];
  selectedSkills: string[];
  loadedSkills: string[];
  allowedTools: string[];
  exposedTools: string[];
  toolsCalled: string[];
}

/**
 * Computes the complete policy-approved tool catalog authorized for this turn.
 */
function computeAllowedTools(input: RouteTurnInput): string[] {
  const allowed = new Set<string>(['search_tools']);

  if (input.candidateSkills.length > 0) {
    allowed.add('load_skill');
    allowed.add('list_skills');
    allowed.add('search_skills');
    allowed.add('read_skill');
  }

  if (input.imageEnabled) {
    allowed.add('generate_image');
  }

  if (input.webEnabled) {
    allowed.add('web_search');
    allowed.add('web_fetch');
  }

  if (input.memoryEnabled) {
    allowed.add('save_memory');
    allowed.add('search_chats');
    allowed.add('search_memory');
    allowed.add('read_memory');
    allowed.add('update_memory');
    allowed.add('forget_memory');
  }

  if (input.hasProject) {
    allowed.add('search_project_files');
    allowed.add('read_project_file');
  }

  // Deliverable creation tools
  allowed.add('generate_deliverable');
  allowed.add('create_artifact');
  allowed.add('read_artifact');
  allowed.add('update_artifact');
  allowed.add('ask_user_options');

  // File operations (inspection & manipulation for PDF, XLSX, DOCX, PPTX)
  allowed.add('inspectPdf');
  allowed.add('mergePdfFiles');
  allowed.add('splitPdfFile');
  allowed.add('inspectSpreadsheet');
  allowed.add('editSpreadsheetCells');
  allowed.add('combineWorkbooks');
  allowed.add('inspectDocxStructure');
  allowed.add('editDocxContent');
  allowed.add('appendDocxSection');
  allowed.add('inspectPptxStructure');
  allowed.add('reorderPptxSlides');
  allowed.add('editPptxSlideText');

  // File reading if attachments present
  if (input.hasAttachments) {
    allowed.add('read_uploaded_file');
  }

  // Permission and infrastructure only (ENABLE_RUN_PYTHON + a sandbox client), never wording.
  if (input.runPythonEnabled) {
    allowed.add('run_python');
  }

  if (input.generativeUiEnabled) {
    allowed.add('render_ui');
  }

  if (input.tableExtractionEnabled) {
    allowed.add('extract_scanned_table_rows');
    allowed.add('analyze_table_rows');
  }

  return Array.from(allowed);
}

/**
 * The tools every turn starts with, whatever its intent (ADR-0006): discovery, plus the allowed
 * tools declared on every turn (ADR-0022).
 */
function coreTools(input: RouteTurnInput, allowed: string[]): string[] {
  const discovery = input.candidateSkills.length > 0 ? ['search_tools', 'load_skill'] : ['search_tools'];
  return [...discovery, ...DECLARED_EVERY_TURN.filter((name) => allowed.includes(name))];
}

export function routeTurn(input: RouteTurnInput): TurnRoutingDecision {
  const allowedTools = computeAllowedTools(input);
  return {
    candidateSkills: input.candidateSkills.map((s) => s.name),
    selectedSkills: [],
    allowedTools,
    exposedTools: coreTools(input, allowedTools),
  };
}
