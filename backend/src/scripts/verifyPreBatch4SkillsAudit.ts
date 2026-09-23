/**
 * Pre-Batch 4 Skills Audit Live Verification Script
 * Validates load_skill live with Gemini provider across:
 * - A: load pdf Skill
 * - B: load xlsx Skill
 * - C: load docx Skill
 * - D: load pptx Skill
 * - E: load two Skills in one workflow (pdf then xlsx)
 * - F: load resource path (valid and non-existent)
 * - G: safe binary resource buffer reader
 * Also spot checks the 4 live deliverable generation capabilities via renderMarkdownExport.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest, ToolCall, ToolResult } from '../providers/types.js';
import { SkillService } from '../services/skills.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';
import { LOAD_SKILL } from '../tools/definitions.js';
import { renderMarkdownExport } from '../services/documents/index.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';

interface AuditRow {
  testId: string;
  name: string;
  round: number;
  modelToolCall: string;
  toolResultSummary: string;
  skillLoaded: string;
  modelContinuedCorrectly: boolean;
  passed: boolean;
  notes: string;
}

const auditRows: AuditRow[] = [];

async function main() {
  console.log('================================================================');
  console.log('   PRE-BATCH 4 SKILLS AUDIT — LIVE VERIFICATION                ');
  console.log('================================================================\n');

  const cfg = loadConfig();
  const capabilities = buildCapabilityRegistry(cfg);
  const skillsService = new SkillService(process.cwd(), 'skills', capabilities);
  await skillsService.load();

  const provider = new GeminiProvider(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH ?? 'gemini-3.8-flash';

  const skillExecutor = new SkillToolExecutor(skillsService, new Set(['load_skill', 'create_artifact', 'generate_deliverable']));

  // Helper to run a 1-turn stream with load_skill
  async function runLoadSkillTest(testId: string, name: string, prompt: string, expectedSkillName: string): Promise<void> {
    console.log(`>>> Running ${testId}: ${name}`);
    const req: GenerationRequest = {
      prompt,
      history: [],
      systemInstruction: 'You are ArcNave assistant. You have access to load_skill. Always use load_skill to retrieve skill instructions before proceeding.',
      mode: 'chat',
      maxOutputTokens: 1000,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      tools: [LOAD_SKILL],
      toolExecutor: skillExecutor,
      signal: new AbortController().signal,
    };

    let round = 0;
    let toolCallStr = '';
    let toolResultStr = '';
    let loadedSkill = '';
    let modelContinued = false;
    let finalDelta = '';

    for await (const ev of provider.stream(req)) {
      if (ev.type === 'tool_use') {
        round++;
        toolCallStr = `${ev.name}(${JSON.stringify(ev.input)})`;
        console.log(`   [Round ${round}] Tool call:`, toolCallStr);
      }
      if (ev.type === 'tool_result') {
        const data = (ev.result.content[0] as any)?.data;
        loadedSkill = data?.name || '';
        toolResultStr = `ok=${ev.result.ok}, name=${loadedSkill}, version=${data?.version || ''}, contentLength=${data?.content?.length || 0}`;
        console.log(`   [Round ${round}] Tool result:`, toolResultStr);
      }
      if (ev.type === 'delta') {
        finalDelta += ev.text;
      }
    }

    modelContinued = finalDelta.trim().length > 0;
    const passed = loadedSkill.toLowerCase() === expectedSkillName.toLowerCase() && modelContinued;
    console.log(`   Model final text preview: "${finalDelta.trim().slice(0, 80)}..."`);
    console.log(`   Status: ${passed ? 'PASS' : 'FAIL'}\n`);

    auditRows.push({
      testId,
      name,
      round,
      modelToolCall: toolCallStr,
      toolResultSummary: toolResultStr,
      skillLoaded: loadedSkill,
      modelContinuedCorrectly: modelContinued,
      passed,
      notes: passed ? `Loaded ${loadedSkill} successfully; generated continuation text` : 'Failed to load skill or continue',
    });
  }

  // A. load pdf Skill
  await runLoadSkillTest('AUDIT_15A', 'Load PDF Skill', 'Load the pdf skill and summarize its core guidelines.', 'pdf');

  // B. load xlsx Skill
  await runLoadSkillTest('AUDIT_15B', 'Load XLSX Skill', 'Load the xlsx skill and describe its formula rules.', 'xlsx');

  // C. load docx Skill
  await runLoadSkillTest('AUDIT_15C', 'Load DOCX Skill', 'Load the docx skill and describe its heading rules.', 'docx');

  // D. load pptx Skill
  await runLoadSkillTest('AUDIT_15D', 'Load PPTX Skill', 'Load the pptx skill and describe its typography floor.', 'pptx');

  // E. load two Skills in one workflow
  console.log('>>> Running AUDIT_15E: Load Two Skills in One Workflow');
  {
    const req: GenerationRequest = {
      prompt: 'We need to convert a PDF financial statement into an XLSX spreadsheet. First call load_skill for "pdf", then call load_skill for "xlsx", and explain how both skills apply.',
      history: [],
      systemInstruction: 'You are ArcNave assistant. You have access to load_skill. Call load_skill for both requested skills sequentially.',
      mode: 'chat',
      maxOutputTokens: 2000,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      tools: [LOAD_SKILL],
      toolExecutor: skillExecutor,
      signal: new AbortController().signal,
    };

    let calls: string[] = [];
    let skillsLoaded: string[] = [];
    let finalText = '';

    for await (const ev of provider.stream(req)) {
      if (ev.type === 'tool_use') {
        calls.push(`${ev.name}(${JSON.stringify(ev.input)})`);
        console.log(`   Tool call: ${ev.name}`, ev.input);
      }
      if (ev.type === 'tool_result') {
        const data = (ev.result.content[0] as any)?.data;
        if (data?.name) skillsLoaded.push(data.name);
      }
      if (ev.type === 'delta') {
        finalText += ev.text;
      }
    }

    const hasBoth = skillsLoaded.includes('pdf') && skillsLoaded.includes('xlsx');
    const modelContinued = finalText.trim().length > 0;
    const passed = hasBoth && modelContinued;
    console.log(`   Loaded skills: ${skillsLoaded.join(', ')}`);
    console.log(`   Status: ${passed ? 'PASS' : 'FAIL'}\n`);

    auditRows.push({
      testId: 'AUDIT_15E',
      name: 'Load Two Skills in One Workflow',
      round: calls.length,
      modelToolCall: calls.join(' -> '),
      toolResultSummary: `Loaded: ${skillsLoaded.join(', ')}`,
      skillLoaded: skillsLoaded.join(', '),
      modelContinuedCorrectly: modelContinued,
      passed,
      notes: passed ? 'Both pdf and xlsx loaded across rounds' : 'Did not load both skills',
    });
  }

  // F. load resource parameter (testing valid vs non-existent)
  console.log('>>> Running AUDIT_15F: Load Skill with Resource Parameter');
  {
    // 1. Non-existent resource
    const nonExistentCall: ToolCall = {
      id: 'call-res-1',
      name: 'load_skill',
      input: { name: 'xlsx', resource: 'templates/financial_model.xlsx' },
    };
    const res1 = await skillExecutor.execute(nonExistentCall, new AbortController().signal);
    const data1 = (res1.content[0] as any)?.data;
    const safeMissing = data1?.resourceContent === '[Resource file not found]';

    // 2. Traversal attempt
    const traversalCall: ToolCall = {
      id: 'call-res-2',
      name: 'load_skill',
      input: { name: 'xlsx', resource: '../../package.json' },
    };
    const res2 = await skillExecutor.execute(traversalCall, new AbortController().signal);
    const data2 = (res2.content[0] as any)?.data;
    const safeBlocked = data2?.resourceContent === '[Resource file not found]';

    const passed = safeMissing && safeBlocked;
    console.log(`   Safe missing resource: ${safeMissing}, Traversal blocked: ${safeBlocked}`);
    console.log(`   Status: ${passed ? 'PASS' : 'FAIL'}\n`);

    auditRows.push({
      testId: 'AUDIT_15F',
      name: 'Load Skill Resource Parameter & Traversal Protection',
      round: 1,
      modelToolCall: 'load_skill({ name: "xlsx", resource: "..." })',
      toolResultSummary: `safeMissing=${safeMissing}, safeBlocked=${safeBlocked}`,
      skillLoaded: 'xlsx',
      modelContinuedCorrectly: true,
      passed,
      notes: 'Missing resource returns safe message; traversal attempt safely blocked',
    });
  }

  // G. Binary resource safety test
  console.log('>>> Running AUDIT_15G: Binary Resource Buffer Reader');
  {
    // Test getSkillResourceBuffer
    const nonExistentBuf = await skillsService.getSkillResourceBuffer('xlsx', 'templates/template.xlsx');
    const isNull = nonExistentBuf === null;
    const traversalBuf = await skillsService.getSkillResourceBuffer('xlsx', '../../package.json');
    const traversalNull = traversalBuf === null;
    const passed = isNull && traversalNull;
    console.log(`   Missing binary returns null: ${isNull}, Traversal returns null: ${traversalNull}`);
    console.log(`   Status: ${passed ? 'PASS' : 'FAIL'}\n`);

    auditRows.push({
      testId: 'AUDIT_15G',
      name: 'Binary Resource Buffer Traversal Protection',
      round: 1,
      modelToolCall: 'SkillService.getSkillResourceBuffer()',
      toolResultSummary: `missing=null(${isNull}), traversal=null(${traversalNull})`,
      skillLoaded: 'xlsx',
      modelContinuedCorrectly: true,
      passed,
      notes: 'Binary buffer reader returns null safely on missing or traversal paths',
    });
  }

  // --------------------------------------------------------------------------
  // AUDIT 16: Live Capability Spot Checks (PDF, XLSX, DOCX, PPTX Deliverables)
  // --------------------------------------------------------------------------
  console.log('================================================================');
  console.log('   AUDIT 16: LIVE CAPABILITY SPOT CHECKS                        ');
  console.log('================================================================\n');

  async function spotCheckDeliverable(testId: string, format: 'pdf' | 'xlsx' | 'docx' | 'pptx', title: string, content: string): Promise<void> {
    console.log(`>>> Spot Checking ${format.toUpperCase()} Deliverable Generation`);
    try {
      const buf = await renderMarkdownExport(content, format);
      const passed = Buffer.isBuffer(buf) && buf.length > 500;
      console.log(`   Result buffer: ${buf.length} bytes, verification passed: ${passed}`);
      console.log(`   Status: ${passed ? 'PASS' : 'FAIL'}\n`);

      auditRows.push({
        testId,
        name: `${format.toUpperCase()} Deliverable Generation`,
        round: 1,
        modelToolCall: `renderMarkdownExport(..., "${format}")`,
        toolResultSummary: `bytes=${buf.length}, verified=${passed}`,
        skillLoaded: format,
        modelContinuedCorrectly: true,
        passed,
        notes: passed ? `Successfully generated and verified ${format.toUpperCase()} binary (${buf.length} bytes)` : 'Failed generation',
      });
    } catch (err: any) {
      console.error(`   ${format.toUpperCase()} generation failed:`, err.message);
      auditRows.push({
        testId,
        name: `${format.toUpperCase()} Deliverable Generation`,
        round: 1,
        modelToolCall: `renderMarkdownExport(..., "${format}")`,
        toolResultSummary: err.message,
        skillLoaded: format,
        modelContinuedCorrectly: false,
        passed: false,
        notes: err.message,
      });
    }
  }

  await spotCheckDeliverable('AUDIT_16_PDF', 'pdf', 'Audit_Report', '# Audit Report\n\nExecutive summary of system health.\n\n| Check | Status |\n| --- | --- |\n| Memory | OK |\n| DB | OK |');
  await spotCheckDeliverable('AUDIT_16_XLSX', 'xlsx', 'Financial_Model', '# Sheet1\n\n| Item | Val |\n| --- | --- |\n| Q1 | 100 |\n| Q2 | 200 |\n| Total | =SUM(B2:B3) |');
  await spotCheckDeliverable('AUDIT_16_DOCX', 'docx', 'Briefing_Doc', '# Briefing Document\n\n> Key Takeaway: Architecture is locked.\n\n## Section 1\nDetails here.');
  await spotCheckDeliverable('AUDIT_16_PPTX', 'pptx', 'Deck_Presentation', '# Slide 1: Welcome\n\n- Point A\n- Point B\n\n---\n\n# Slide 2: Analysis\n\n- Point C\n- Point D');

  // Summary Table
  console.log('================================================================');
  console.log('   AUDIT 15 & 16 RESULTS SUMMARY                                ');
  console.log('================================================================\n');

  for (const r of auditRows) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.testId}: ${r.name}`);
    console.log(`       Call: ${r.modelToolCall}`);
    console.log(`       Result: ${r.toolResultSummary} | Notes: ${r.notes}\n`);
  }
}

main().catch((err) => {
  console.error('FATAL AUDIT ERROR:', err);
  process.exit(1);
});
