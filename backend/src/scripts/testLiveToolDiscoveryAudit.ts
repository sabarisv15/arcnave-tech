/**
 * Live Tool Discovery Audit Script for Pre-Batch 4 File Operation Wiring.
 *
 * Tests model behavior when given user tasks requiring:
 * A: Merge two PDFs
 * B: Change B8 in workbook
 * C: Replace text in DOCX
 * D: Move slide 6 before slide 3 in PPTX
 *
 * Records whether the model invokes load_skill, attempts search_tools,
 * or seeks the specific operation, and documents the exact missing links.
 */

import { loadConfig } from '../config.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest } from '../providers/types.js';
import { SkillService } from '../services/skills.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';
import { LOAD_SKILL, SEARCH_TOOLS } from '../tools/definitions.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';
import { getDeferredPolicyCatalog } from '../tools/catalog.js';
import type { ToolCall, ToolResult } from '../providers/types.js';

interface AuditScenarioResult {
  scenarioId: string;
  name: string;
  prompt: string;
  skillLoaded: string;
  searchToolsQueries: string[];
  toolsRequested: string[];
  outcome: string;
  missingLink: string;
}

const auditResults: AuditScenarioResult[] = [];

async function main() {
  console.log('================================================================');
  console.log('   PRE-BATCH 4 FILE OPERATION WIRING AUDIT — LIVE TEST          ');
  console.log('================================================================\n');

  const cfg = loadConfig();
  const capabilities = buildCapabilityRegistry(cfg);
  const skillsService = new SkillService(process.cwd(), 'skills', capabilities);
  await skillsService.load();

  const provider = new GeminiProvider(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH ?? 'gemini-3.8-flash';

  const skillExecutor = new SkillToolExecutor(skillsService, new Set(['load_skill', 'search_tools', 'generate_deliverable']));

  const catalog = getDeferredPolicyCatalog(
    cfg,
    { runPythonEnabled: true, skillsEnabled: true },
    {
      userId: 'test_user',
      projectId: 'proj_test',
      allowPython: true,
      allowDeliverable: true,
    },
  );
  const searchExecutor = new SearchToolsExecutor(catalog);

  // Combined tool executor that handles load_skill and search_tools
  const combinedExecutor = {
    async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
      if (call.name === 'load_skill') {
        return skillExecutor.execute(call, signal);
      }
      if (call.name === 'search_tools') {
        return searchExecutor.execute(call, signal);
      }
      return {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text' as const, text: `Unknown tool "${call.name}". Tool is not registered in execution catalog.` }],
      };
    },
  };

  async function runDiscoveryTurn(
    scenarioId: string,
    name: string,
    prompt: string,
    expectedSkill: string,
    expectedOperation: string,
  ): Promise<void> {
    console.log(`>>> Running Scenario ${scenarioId}: ${name}`);
    const req: GenerationRequest = {
      prompt,
      history: [],
      systemInstruction:
        'You are ArcNave assistant. You have access to `load_skill` (to retrieve expert file instructions) and `search_tools` (to discover executable tools). ' +
        'Always consult relevant skills and use search_tools if an executable file tool is needed.',
      mode: 'chat',
      maxOutputTokens: 1000,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      tools: [LOAD_SKILL, SEARCH_TOOLS],
      toolExecutor: combinedExecutor,
      signal: new AbortController().signal,
    };

    let skillLoaded = '';
    const searchQueries: string[] = [];
    const toolsCalled: string[] = [];
    let responseText = '';

    for await (const ev of provider.stream(req)) {
      if (ev.type === 'tool_use') {
        toolsCalled.push(ev.name);
        console.log(`   [Tool Call] ${ev.name}(${JSON.stringify(ev.input)})`);
        if (ev.name === 'load_skill') {
          skillLoaded = String((ev.input as any)?.name ?? '');
        }
        if (ev.name === 'search_tools') {
          searchQueries.push(String((ev.input as any)?.query ?? ''));
        }
      }
      if (ev.type === 'delta') {
        responseText += ev.text;
      }
    }

    console.log(`   Model final text preview: "${responseText.trim().slice(0, 100)}..."`);

    auditResults.push({
      scenarioId,
      name,
      prompt,
      skillLoaded,
      searchToolsQueries: searchQueries,
      toolsRequested: toolsCalled,
      outcome: `Skill loaded: ${skillLoaded || 'none'}; Searched: [${searchQueries.join(', ')}]; Attempted tools: [${toolsCalled.join(', ')}]`,
      missingLink: `Operation "${expectedOperation}" is defined in services/skills/fileOperations/${expectedSkill}.ts but lacks a ToolDefinition, ToolCatalogEntry, and Executor dispatch handler.`,
    });
    console.log('----------------------------------------------------------------\n');
  }

  // A. PDF Merge
  await runDiscoveryTurn(
    'A',
    'Merge two PDFs',
    'A user uploads two PDF files: "appendix_A.pdf" (attachmentId: att_pdf1) and "appendix_B.pdf" (attachmentId: att_pdf2) and requests: "Merge these two PDF documents into appendices.pdf." Please carry out the file operation.',
    'pdf',
    'mergePdfFiles',
  );

  // B. XLSX Cell Edit
  await runDiscoveryTurn(
    'B',
    'Change B8 in this workbook',
    'A user uploads "financials.xlsx" (attachmentId: att_xlsx1) and requests: "Change cell B8 in sheet \'Summary\' to 450000." Please execute this change preserving formatting and formulas.',
    'xlsx',
    'editSpreadsheetCells',
  );

  // C. DOCX Text Replacement
  await runDiscoveryTurn(
    'C',
    'Replace text in DOCX',
    'A user uploads "contract.docx" (attachmentId: att_docx1) and requests: "Replace all occurrences of \'Acme Corp\' with \'Globex International\' in this document." Please perform the text edit preserving the Word package.',
    'docx',
    'editDocxContent',
  );

  // D. PPTX Slide Reorder
  await runDiscoveryTurn(
    'D',
    'Move slide 6 before slide 3 in PPTX',
    'A user uploads "pitch.pptx" (attachmentId: att_pptx1) and requests: "Move slide 6 before slide 3 in this presentation." Please execute this slide reordering.',
    'pptx',
    'reorderPptxSlides',
  );

  console.log('================================================================');
  console.log('                   AUDIT FINDINGS SUMMARY                       ');
  console.log('================================================================');
  for (const r of auditResults) {
    console.log(`[Scenario ${r.scenarioId}] ${r.name}:`);
    console.log(`   Outcome: ${r.outcome}`);
    console.log(`   Missing Link: ${r.missingLink}\n`);
  }
}

main().catch((err) => {
  console.error('Fatal error running audit:', err);
  process.exit(1);
});
