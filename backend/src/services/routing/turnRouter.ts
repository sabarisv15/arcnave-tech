/**
 * TurnRouter: ArcNave Skill-First -> Tool-Second Routing Engine.
 *
 * Implements:
 * 1. Intent Detection: Categorizes the user's intent based on prompt, attachments, and mode.
 * 2. Progressive Skill Disclosure:
 *    - Exposes candidate skill summaries at request start.
 *    - Selects only the specific skills strictly relevant to the detected intent.
 *    - Loads full SKILL.md ONLY for the selected skills.
 * 3. Tool-Second Gating:
 *    - Exposes ONLY the tools required by the detected intent and selected skills.
 *    - Strictly hides run_python by default (exposed only for real computation/code execution).
 *    - For ordinary chat and explanations (e.g. "explain Monte Carlo simulation"), exposes NO tools.
 * 4. Runtime Debug Trace generation.
 */

import type { Mode } from '../../providers/types.js';
import { evaluateRunPythonPolicy } from '../../tools/capabilityPolicy.js';

export type DetectedIntent =
  | 'IMAGE_GENERATION'
  | 'FILE_CONVERSION'
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
  exposedTools: string[];
  pythonExposed: boolean;
  reason: string;
}

export interface RuntimeDebugTrace {
  detectedIntent: string;
  candidateSkills: string[];
  selectedSkills: string[];
  loadedSkills: string[];
  exposedTools: string[];
  toolsCalled: string[];
  pythonExposed: boolean;
}

export function routeTurn(input: RouteTurnInput): TurnRoutingDecision {
  const prompt = input.prompt.toLowerCase().trim();
  const candidateSkillNames = input.candidateSkills.map((s) => s.name);

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
      exposedTools: ['generate_image'],
      pythonExposed: false,
      reason: 'User requested image creation or generation. Exposing generate_image only.',
    };
  }

  // 2. File Conversion Intent (Source file / PDF -> Excel, Word, PPTX, PDF)
  const hasConversionVerb = /\b(?:convert|turn|export|transform|extract|make)\b/i.test(prompt);
  const mentionsPdf =
    /\bpdf\b/i.test(prompt) ||
    (input.hasAttachments &&
      ((input.attachmentMimeTypes && input.attachmentMimeTypes.includes('application/pdf')) ||
        (input.attachmentNames && input.attachmentNames.some((n) => n.toLowerCase().endsWith('.pdf')))));

  const isExcelTarget = /\b(?:excel|xlsx|spreadsheet|sheet|workbook)\b/i.test(prompt);
  const isWordTarget = /\b(?:word|docx|doc|document)\b/i.test(prompt);
  const isPptxTarget = /\b(?:powerpoint|pptx|presentation|slides?|deck)\b/i.test(prompt);
  const isPdfTarget = /\b(?:pdf)\b/i.test(prompt) && !mentionsPdf; // only target if not source

  // "convert this PDF into Excel", "convert into excel file" (with attachment), "make a PowerPoint from this PDF", etc.
  if (
    (hasConversionVerb && mentionsPdf && (isExcelTarget || isWordTarget || isPptxTarget)) ||
    (input.hasAttachments && hasConversionVerb && (isExcelTarget || isWordTarget || isPptxTarget)) ||
    (/\b(?:make|create|generate)\s+(?:an?\s+)?(?:powerpoint|pptx|presentation|slides?|deck)\s+(?:from|into|out of)\s+(?:this\s+)?(?:pdf|file|attachment)\b/i.test(
      prompt,
    ))
  ) {
    const selected: string[] = [];
    if (mentionsPdf) {
      selected.push('pdf');
    }
    if (isExcelTarget) {
      selected.push('xlsx');
    } else if (isWordTarget) {
      selected.push('docx');
    } else if (isPptxTarget) {
      selected.push('pptx');
    } else if (isPdfTarget) {
      selected.push('pdf');
    }

    return {
      detectedIntent: 'FILE_CONVERSION',
      candidateSkills: candidateSkillNames,
      selectedSkills: selected,
      exposedTools: ['read_uploaded_file', 'generate_deliverable'],
      pythonExposed: false,
      reason: `File conversion intent detected. Selected skills: [${selected.join(', ')}]. Exposing read_uploaded_file and generate_deliverable.`,
    };
  }

  // 3. Purely Explanatory / Conceptual Query (e.g. "explain Monte Carlo simulation")
  const isExplanatory =
    /\b(?:explain|what is|what are|how does|define|history of|overview of|theory behind|describe)\b/i.test(
      prompt,
    ) &&
    !/\b(?:run|execute|calculate|compute|plot|graph|chart|regress|verify with code|debug|implement|write code|code this)\b/i.test(
      prompt,
    );

  if (isExplanatory) {
    return {
      detectedIntent: 'EXPLANATION',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      exposedTools: [],
      pythonExposed: false,
      reason: 'Explanatory and conceptual query. No tools required; Python hidden.',
    };
  }

  // 4. Computation / Code Execution (Statistics, Regression, Transformations, Simulations, Explicit Python)
  const pythonDecision = evaluateRunPythonPolicy({
    prompt: input.prompt,
    mode: input.mode,
    hasAttachments: input.hasAttachments,
    attachmentMimeTypes: input.attachmentMimeTypes,
  });

  if (input.runPythonEnabled && pythonDecision.allowed) {
    const tools = ['run_python'];
    if (input.hasAttachments) {
      tools.unshift('read_uploaded_file');
    }
    return {
      detectedIntent: 'COMPUTATION',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      exposedTools: tools,
      pythonExposed: true,
      reason: `Computation requested: ${pythonDecision.reason}. Exposing run_python.`,
    };
  }

  // 5. Office Deliverable Creation from scratch (e.g. "create an Excel sheet for my budget")
  if (
    /\b(?:create|draft|generate|make|build)\s+(?:an?\s+)?(?:excel|spreadsheet|xlsx|workbook|word document|docx|powerpoint|presentation|deck|pdf report)\b/i.test(
      prompt,
    )
  ) {
    const selected: string[] = [];
    if (isExcelTarget) selected.push('xlsx');
    else if (isWordTarget) selected.push('docx');
    else if (isPptxTarget) selected.push('pptx');
    else if (isPdfTarget) selected.push('pdf');

    return {
      detectedIntent: 'OFFICE_DELIVERABLE_CREATION',
      candidateSkills: candidateSkillNames,
      selectedSkills: selected,
      exposedTools: ['generate_deliverable'],
      pythonExposed: false,
      reason: `Deliverable creation intent detected for ${selected.join(', ')}. Exposing generate_deliverable.`,
    };
  }

  // 6. Research / Search Mode
  if (input.mode === 'research' || input.mode === 'search') {
    const tools: string[] = [];
    if (input.webEnabled) {
      tools.push('web_search', 'web_fetch');
    }
    return {
      detectedIntent: 'RESEARCH',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      exposedTools: tools,
      pythonExposed: false,
      reason: 'Research or search mode active. Exposing web search tools.',
    };
  }

  // 7. Project File Query
  if (input.hasProject && /\b(?:project|document|files?|search files|in this repo)\b/i.test(prompt)) {
    return {
      detectedIntent: 'PROJECT_QUERY',
      candidateSkills: candidateSkillNames,
      selectedSkills: [],
      exposedTools: ['search_project_files', 'read_project_file'],
      pythonExposed: false,
      reason: 'Project knowledge search requested. Exposing project search tools.',
    };
  }

  // 8. Ordinary Conversational Chat (Default)
  return {
    detectedIntent: 'ORDINARY_CHAT',
    candidateSkills: candidateSkillNames,
    selectedSkills: [],
    exposedTools: [],
    pythonExposed: false,
    reason: 'Ordinary chat or general inquiry. No tools required; Python hidden.',
  };
}
