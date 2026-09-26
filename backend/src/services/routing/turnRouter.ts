/**
 * TurnRouter: the policy boundary. ADR-0006.
 *
 * It answers one question: which tools is this turn *allowed* to use. That comes from flags,
 * permissions and the infrastructure present, never from the prompt's wording. The model
 * decides what it needs: every turn gets the same core (`search_tools`, plus `load_skill` when
 * skills exist) and discovers the rest from `allowedTools`.
 *
 * Intent detection below is telemetry only. `detectedIntent` and `pythonExposed` feed the debug
 * trace; neither adds or removes a tool. `turnRouter.locked.test.ts` fails if that changes.
 */

import type { Mode } from '../../providers/types.js';
import { evaluateRunPythonPolicy } from '../../tools/capabilityPolicy.js';
import { DECLARED_EVERY_TURN } from '../../tools/registry.js';

export type DetectedIntent =
  | 'IMAGE_GENERATION'
  | 'FILE_CONVERSION'
  | 'FILE_OPERATION'
  | 'OFFICE_DELIVERABLE_CREATION'
  | 'EXPLANATION'
  | 'COMPUTATION'
  | 'RESEARCH'
  | 'PROJECT_QUERY'
  | 'ORDINARY_CHAT';

export interface RouteTurnInput {
  prompt: string;
  mode: Mode;
  hasAttachments: boolean;
  attachmentMimeTypes?: string[];
  attachmentNames?: string[];
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
  detectedIntent: DetectedIntent;
  candidateSkills: string[];
  selectedSkills: string[];
  allowedTools: string[];
  exposedTools: string[];
  /** Telemetry only: the prompt reads as computational. Does not gate `run_python`. */
  pythonExposed: boolean;
  reason: string;
}

export interface RuntimeDebugTrace {
  detectedIntent: string;
  candidateSkills: string[];
  selectedSkills: string[];
  loadedSkills: string[];
  allowedTools: string[];
  exposedTools: string[];
  toolsCalled: string[];
  pythonExposed: boolean;
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
  const prompt = input.prompt.toLowerCase().trim();
  const candidateSkillNames = input.candidateSkills.map((s) => s.name);

  // Evaluate Python capability policy
  const pythonDecision = evaluateRunPythonPolicy({
    prompt: input.prompt,
    mode: input.mode,
    hasAttachments: input.hasAttachments,
    attachmentMimeTypes: input.attachmentMimeTypes,
  });
  const pythonAllowed = Boolean(input.runPythonEnabled && pythonDecision.allowed);

  const allowedTools = computeAllowedTools(input);
  const exposedTools = coreTools(input, allowedTools);

  // 1. Image Generation Intent
  const isImageRequest =
    /\b(?:generate|create|draw|render|paint|make)\s+(?:an?\s+)?(?:[\w-]+\s+)*(?:image|picture|photo|illustration|drawing|visual|graphic|artwork)\b/i.test(
      prompt,
    ) ||
    /\b(?:generate|draw|create)\s+an?\s+(?:image|picture|photo)\b/i.test(prompt) ||
    /\b(?:clock\s+image|image\s+generation)\b/i.test(prompt);

  const hasOfficeTargetKeyword = /\b(?:excel|xlsx|spreadsheet|word|docx|document|powerpoint|pptx|slides?|deck|presentation|pdf)\b/i.test(
    prompt,
  );

  if (isImageRequest && !hasOfficeTargetKeyword) {
    return {
      detectedIntent: 'IMAGE_GENERATION',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      allowedTools,
      exposedTools,
      pythonExposed: false,
      reason: 'User requested image creation or generation. Allowed catalog includes generate_image.',
    };
  }

  // 2. Purely Explanatory / Conceptual / Summary Query (e.g. "explain Monte Carlo", "summarize this PDF", "what does this PDF say")
  const isExplanatory =
    /\b(?:explain|what is|what are|what does|how does|define|history of|overview of|theory behind|describe|summarize|summary)\b/i.test(
      prompt,
    ) &&
    !/\b(?:run|execute|calculate|compute|plot|graph|chart|regress|verify with code|debug|implement|write code|code this|change|modify|edit|update|replace|merge|split|reorder|combine)\b/i.test(
      prompt,
    );

  if (isExplanatory) {
    return {
      detectedIntent: 'EXPLANATION',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      allowedTools,
      exposedTools,
      pythonExposed: false,
      reason: 'Explanatory or conceptual query (telemetry). Model decides whether to use tools.',
    };
  }

  // 3. File Conversion Intent (Source file / PDF -> Excel, Word, PPTX, PDF)
  const hasConversionVerb = /\b(?:convert|turn|export|transform|extract|make)\b/i.test(prompt);
  const mentionsPdf =
    /\bpdf\b/i.test(prompt) ||
    (input.hasAttachments &&
      ((input.attachmentMimeTypes && input.attachmentMimeTypes.includes('application/pdf')) ||
        (input.attachmentNames && input.attachmentNames.some((n) => n.toLowerCase().endsWith('.pdf')))));

  const isExcelTarget = /\b(?:excel|xlsx|spreadsheet|sheet|workbook)\b/i.test(prompt);
  const isWordTarget = /\b(?:word|docx|doc|document)\b/i.test(prompt);
  const isPptxTarget = /\b(?:powerpoint|pptx|presentation|slides?|deck)\b/i.test(prompt);

  if (
    (hasConversionVerb && mentionsPdf && (isExcelTarget || isWordTarget || isPptxTarget)) ||
    (input.hasAttachments && hasConversionVerb && (isExcelTarget || isWordTarget || isPptxTarget)) ||
    (/\b(?:make|create|generate)\s+(?:an?\s+)?(?:powerpoint|pptx|presentation|slides?|deck)\s+(?:from|into|out of)\s+(?:this\s+)?(?:pdf|file|attachment)\b/i.test(
      prompt,
    ))
  ) {
    return {
      detectedIntent: 'FILE_CONVERSION',
      candidateSkills: candidateSkillNames,
      selectedSkills: [], // Model progressively loads skills via load_skill
      allowedTools,
      exposedTools,
      pythonExposed: false,
      reason: 'File conversion intent detected. Tools placed in policy catalog; model evaluates task first.',
    };
  }

  // 4. Computation / Code Execution (Statistics, Regression, Transformations, Simulations, Explicit Python)
  if (pythonAllowed) {
    return {
      detectedIntent: 'COMPUTATION',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      allowedTools,
      exposedTools,
      pythonExposed: true,
      reason: `Computation requested (telemetry): ${pythonDecision.reason}.`,
    };
  }

  // 4b. File Operations (Inspection & Manipulation for PDF, XLSX, DOCX, PPTX)
  const isFileOpVerb = /\b(?:merge|combine|split|extract pages|reorder|inspect|examine|update cells?|edit cells?|replace text|append section|change|modify|edit)\b/i.test(prompt);
  if (
    (hasOfficeTargetKeyword && isFileOpVerb) ||
    (input.hasAttachments && isFileOpVerb)
  ) {
    return {
      detectedIntent: 'FILE_OPERATION',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      allowedTools,
      exposedTools,
      pythonExposed: false,
      reason: 'File operation intent detected. Tools placed in policy catalog; model evaluates task first.',
    };
  }

  // 5. Office Deliverable Creation from scratch (e.g. "create an Excel sheet for my budget")
  if (
    /\b(?:create|draft|generate|make|build)\s+(?:an?\s+)?(?:excel|spreadsheet|xlsx|workbook|word document|docx|powerpoint|presentation|deck|pdf report)\b/i.test(
      prompt,
    )
  ) {
    return {
      detectedIntent: 'OFFICE_DELIVERABLE_CREATION',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      allowedTools,
      exposedTools,
      pythonExposed: false,
      reason: 'Deliverable creation intent detected. Tools placed in catalog; model evaluates task first.',
    };
  }

  // 6. Research / Search Mode
  if (input.mode === 'research' || input.mode === 'search') {
    return {
      detectedIntent: 'RESEARCH',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      allowedTools,
      exposedTools,
      pythonExposed: false,
      reason: 'Research or search mode active. Exposing web search tools in catalog discovery.',
    };
  }

  // 7. Project File Query
  if (input.hasProject && /\b(?:project|document|files?|search files|in this repo)\b/i.test(prompt)) {
    return {
      detectedIntent: 'PROJECT_QUERY',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      allowedTools,
      exposedTools,
      pythonExposed: false,
      reason: 'Project knowledge search requested. Exposing project search tools in catalog.',
    };
  }

  // 8. Ordinary Conversational Chat (Default)
  return {
    detectedIntent: 'ORDINARY_CHAT',
    candidateSkills: candidateSkillNames,
    selectedSkills: [],
    allowedTools,
    exposedTools,
    pythonExposed: false,
    reason: 'Ordinary chat or general inquiry (telemetry). Model decides whether to use tools.',
  };
}
