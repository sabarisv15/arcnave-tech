/**
 * TurnRouter: ArcNave Hard Policy Filter & Model-Driven Tool Gating Engine.
 *
 * Implements:
 * 1. Hard Policy Filter: Evaluates capability flags, user authorization, and quotas to
 *    produce the policy-approved Allowed Tool Catalog (`allowedTools: string[]`).
 * 2. Model-Driven Progressive Gating:
 *    - Eliminates blanket-exposure rules: Attachments or keywords do NOT auto-expose
 *      or force-execute `read_uploaded_file`, `generate_deliverable`, or `run_python`.
 *    - The AI model evaluates the task first.
 *    - Domain skills are loaded progressively via internal `load_skill`.
 *    - Executable tools are discovered on-demand via `search_tools`.
 * 3. Telemetry & Intent Detection: Classifies user intent for observability and metrics.
 * 4. Runtime Debug Trace generation.
 */

import type { Mode } from '../../providers/types.js';
import { evaluateRunPythonPolicy } from '../../tools/capabilityPolicy.js';

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
  webEnabled?: boolean;
  memoryEnabled?: boolean;
}

export interface TurnRoutingDecision {
  detectedIntent: DetectedIntent;
  candidateSkills: string[];
  selectedSkills: string[];
  allowedTools: string[];
  exposedTools: string[];
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
function computeAllowedTools(input: RouteTurnInput, pythonAllowed: boolean): string[] {
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

  // Code execution strictly if enabled and policy allows
  if (input.runPythonEnabled && pythonAllowed) {
    allowed.add('run_python');
  }

  return Array.from(allowed);
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

  const allowedTools = computeAllowedTools(input, pythonAllowed);

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
      exposedTools: ['search_tools'],
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
      exposedTools: [],
      pythonExposed: false,
      reason: 'Explanatory and conceptual query. No tools required; Python hidden.',
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
      exposedTools: ['search_tools'], // Model discovers tools on-demand via search_tools
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
      exposedTools: ['search_tools'],
      pythonExposed: true,
      reason: `Computation requested: ${pythonDecision.reason}. Exposing run_python in allowed catalog.`,
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
      exposedTools: ['search_tools'],
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
      exposedTools: ['search_tools'],
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
      exposedTools: ['search_tools'],
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
      exposedTools: ['search_tools'],
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
    exposedTools: [],
    pythonExposed: false,
    reason: 'Ordinary chat or general inquiry. No tools required; Python hidden.',
  };
}
