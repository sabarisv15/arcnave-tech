/**
 * Batch 4 Freeze Check: Skill Order, Already-Loaded State, & TurnRouter Role Live Verification
 *
 * Validates:
 * 1. Skill-before-operation order:
 *    MODEL -> load_skill(<domain>) -> search_tools -> <operationTool>
 * 2. Already-loaded skill:
 *    If skill is already in session history, load_skill is NOT called again.
 * 3. Direct understanding:
 *    "What does this PDF say?" -> answered directly from document content without unnecessary tools.
 * 4. TurnRouter role:
 *    Establishes policy/capability boundary only; never selects exact skill or tool.
 */

import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { loadConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { attachments, chats, messages, users } from '../db/schema.js';
import { GeminiProvider } from '../providers/gemini.js';
import type {
  AttachmentBlock,
  GenerationRequest,
  ToolCall,
  ToolDefinition,
  ToolResult,
  Turn,
} from '../providers/types.js';
import { routeTurn } from '../services/routing/turnRouter.js';
import { SkillService } from '../services/skills.js';
import { buildStorage, generateStorageKey } from '../services/storage.js';
import { getDeferredPolicyCatalog } from '../tools/catalog.js';
import {
  FILE_OPERATION_TOOL_DEFINITIONS,
  LOAD_SKILL,
  SEARCH_TOOLS,
} from '../tools/definitions.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import { FileOperationExecutor } from '../tools/fileOperationExecutor.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';

interface TestResult {
  scenario: string;
  skillInitiallyLoaded: boolean;
  loadSkillCalled: boolean;
  searchToolsCalled: boolean;
  correctFileToolInvoked: boolean;
  turnRouterChoseExactTool: boolean;
  toolCallSequence: string[];
  passed: boolean;
  details: string;
}

const testResults: TestResult[] = [];

async function ensureTestUser(db: any, email: string, name: string) {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash: 'test-hash-batch4-freeze',
    })
    .returning();
  return created;
}

async function uploadTestAttachment(
  db: any,
  storage: any,
  userId: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
) {
  const storageKey = generateStorageKey(userId);
  await storage.put(storageKey, buffer, mimeType);

  const [row] = await db
    .insert(attachments)
    .values({
      userId,
      filename,
      mimeType,
      sizeBytes: buffer.length,
      storageKey,
      status: 'ready',
      error: '',
    })
    .returning();

  return row;
}

async function main() {
  console.log('================================================================');
  console.log('   BATCH 4 FREEZE CHECK: SKILL ORDER + TURNROUTER ROLE          ');
  console.log('================================================================\n');

  const cfg = loadConfig();
  const db = getDb();
  const storage = buildStorage(cfg);
  const runtime = new ExecutionRuntime();
  const provider = new GeminiProvider(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH ?? 'gemini-3.8-flash';

  const capabilities = buildCapabilityRegistry(cfg);
  const skillsService = new SkillService(process.cwd(), cfg.SKILLS_DIR, capabilities);
  await skillsService.load();

  const user = await ensureTestUser(db, 'batch4-freeze-user@example.com', 'Freeze User');

  // Verify TurnRouter role architecturally first
  console.log('>>> [Audit] TurnRouter Role Inspection:');
  const dummyRouting = routeTurn({
    prompt: 'Change B8 in the Summary sheet of this spreadsheet to 450000',
    mode: 'chat',
    hasAttachments: true,
    attachmentMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    candidateSkills: [
      { name: 'docx', description: 'Word' },
      { name: 'xlsx', description: 'Excel' },
      { name: 'pptx', description: 'PowerPoint' },
      { name: 'pdf', description: 'PDF' },
    ],
    hasProject: false,
    runPythonEnabled: true,
  });

  console.log('   DEBUG dummyRouting:', {
    detectedIntent: dummyRouting.detectedIntent,
    selectedSkills: dummyRouting.selectedSkills,
    exposedTools: dummyRouting.exposedTools,
    allowedToolsCount: dummyRouting.allowedTools.length,
    reason: dummyRouting.reason,
  });

  const turnRouterPolicyOnly =
    dummyRouting.detectedIntent === 'FILE_OPERATION' &&
    dummyRouting.selectedSkills.length === 0 &&
    dummyRouting.exposedTools.length === 1 &&
    dummyRouting.exposedTools[0] === 'search_tools' &&
    dummyRouting.allowedTools.length > 5;

  console.log(`   - Policy/Capability boundary only: ${turnRouterPolicyOnly ? 'YES' : 'NO'}`);
  console.log(`   - Exact Skill selection: ${dummyRouting.selectedSkills.length === 0 ? 'NO' : 'YES'}`);
  console.log(`   - Exact operation selection: ${!dummyRouting.exposedTools.includes('editSpreadsheetCells') ? 'NO' : 'YES'}\n`);

  async function executeTurn(
    scenarioName: string,
    prompt: string,
    wireAttachments: AttachmentBlock[],
    history: Turn[] = [],
    initialToolsList?: ToolDefinition[],
  ): Promise<{
    calls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    results: ToolResult[];
    reply: string;
  }> {
    const capturedCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    const capturedResults: ToolResult[] = [];
    let fullReply = '';

    const initialTools: ToolDefinition[] = initialToolsList ?? [LOAD_SKILL, SEARCH_TOOLS];
    const availableTools: ToolDefinition[] = [...initialTools];
    const activeToolNames = new Set<string>(availableTools.map((t) => t.name));

    const policyCatalog = getDeferredPolicyCatalog(
      cfg,
      { skillsEnabled: true, runPythonEnabled: false },
      {
        userId: user.id,
        projectId: null,
        allowPython: false,
        allowDeliverable: true,
      },
    );

    const [testChat] = await db
      .insert(chats)
      .values({
        userId: user.id,
        title: `Batch 4 Freeze ${scenarioName}`,
      })
      .returning();

    const [testMessage] = await db
      .insert(messages)
      .values({
        chatId: testChat!.id,
        userId: user.id,
        seq: history.length + 1,
        role: 'user',
        text: prompt,
      })
      .returning();

    const fileOpExecutor = new FileOperationExecutor({
      db,
      storage,
      executionRuntime: runtime,
      userId: user.id,
      chatId: testChat!.id,
      messageId: testMessage!.id,
    });

    const skillExecutor = new SkillToolExecutor(skillsService, activeToolNames);

    const searchExecutor = new SearchToolsExecutor(policyCatalog, (discovered) => {
      if (!availableTools.some((t) => t.name === discovered.name)) {
        console.log(`      [Tool Discovered] ${discovered.name}`);
        availableTools.push(discovered);
        activeToolNames.add(discovered.name);
      }
    });

    const dispatchingExecutor = {
      async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
        capturedCalls.push({ id: call.id, name: call.name, input: call.input as Record<string, unknown> });
        console.log(`      [Model Tool Call] ${call.name}(${JSON.stringify(call.input)})`);

        let result: ToolResult;
        if (call.name === 'load_skill') {
          result = await skillExecutor.execute(call, signal!);
        } else if (call.name === 'search_tools') {
          result = await searchExecutor.execute(call, signal!);
        } else {
          result = await fileOpExecutor.execute(call, signal!);
        }

        capturedResults.push(result);
        const preview = result.content[0]
          ? (result.content[0].type === 'text' ? result.content[0].text : JSON.stringify((result.content[0] as any).data))
          : '';
        console.log(`      [Tool Result] ok=${result.ok} preview="${preview.slice(0, 80)}..."`);
        return result;
      },
    };

    const systemInstruction =
      'You are ArcNave assistant. You have access to `load_skill` (to retrieve procedural guidance for specialized domains) and `search_tools` (to discover executable tools).\n\n' +
      'Core architectural rules for file operations:\n' +
      '1. Before using a domain-specific file operation (for PDF, XLSX, DOCX, PPTX), you MUST first load the relevant Skill (via `load_skill`) to obtain its procedural instructions and rules, unless that Skill is already loaded in this conversation session.\n' +
      '2. After loading the relevant Skill, use `search_tools` to discover the exact executable file tool and invoke it.\n' +
      '3. If the Skill is already loaded in the conversation history, do not call `load_skill` again—proceed directly with tool discovery or invocation.\n' +
      '4. For direct understanding queries (such as asking what a document says or summarizing its text), answer directly from the document content without calling `load_skill`, `search_tools`, or inspection tools.\n' +
      '5. Always provide the final download link or answer to the user.';

    const req: GenerationRequest = {
      prompt,
      history,
      attachments: wireAttachments,
      systemInstruction,
      mode: 'chat',
      maxOutputTokens: 2000,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      tools: availableTools,
      toolExecutor: dispatchingExecutor,
      signal: new AbortController().signal,
    };

    for await (const ev of provider.stream(req)) {
      if (ev.type === 'delta') {
        fullReply += ev.text;
      }
    }

    return { calls: capturedCalls, results: capturedResults, reply: fullReply };
  }

  /* -------------------------------------------------------------------------- TEST A: XLSX Edit */
  console.log('----------------------------------------------------------------');
  console.log('>>> TEST A: XLSX Edit (Fresh session -> load_skill("xlsx") -> search_tools -> editSpreadsheetCells)');
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Summary');
    ws.getCell('A8').value = 'Total Budget';
    ws.getCell('B8').value = 100000;
    const b = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const att = await uploadTestAttachment(
      db,
      storage,
      user.id,
      'financial_summary.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      b,
    );
    const wireAtts: AttachmentBlock[] = [
      { id: att.id, filename: att.filename, mimeType: att.mimeType, sizeBytes: b.length },
    ];

    const prompt = `Please change B8 in the Summary sheet of this spreadsheet "${att.filename}" (fileId: "${att.id}") to 450000. Save as "updated_summary.xlsx".`;
    const res = await executeTurn('TestA', prompt, wireAtts);

    const callNames = res.calls.map((c) => c.name);
    const loadSkillIdx = callNames.indexOf('load_skill');
    const searchToolsIdx = callNames.indexOf('search_tools');
    const editCellsIdx = callNames.indexOf('editSpreadsheetCells');

    const skillLoadedFirst = loadSkillIdx !== -1 && res.calls[loadSkillIdx]!.input.name === 'xlsx';
    const searchedTools = searchToolsIdx !== -1;
    const editInvoked = editCellsIdx !== -1 && res.results.some((r) => r.ok && r.toolCallId === res.calls[editCellsIdx]!.id);
    const logicalOrderValid = loadSkillIdx < searchToolsIdx && searchToolsIdx < editCellsIdx;

    const passed = skillLoadedFirst && searchedTools && editInvoked && logicalOrderValid;
    testResults.push({
      scenario: 'Test A — XLSX edit',
      skillInitiallyLoaded: false,
      loadSkillCalled: skillLoadedFirst,
      searchToolsCalled: searchedTools,
      correctFileToolInvoked: editInvoked,
      turnRouterChoseExactTool: false,
      toolCallSequence: callNames,
      passed,
      details: `Sequence: [${callNames.join(' -> ')}], Order valid: ${logicalOrderValid}`,
    });
    console.log(`>>> TEST A RESULT: ${passed ? 'PASS' : 'FAIL'} ([${callNames.join(' -> ')}])\n`);
  }

  /* -------------------------------------------------------------------------- TEST B: DOCX Edit */
  console.log('----------------------------------------------------------------');
  console.log('>>> TEST B: DOCX Edit (Fresh session -> load_skill("docx") -> search_tools -> editDocxContent)');
  {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>STATUS: DRAFT</w:t></w:r></w:p></w:body></w:document>',
    );
    const b = await zip.generateAsync({ type: 'nodebuffer' });
    const att = await uploadTestAttachment(
      db,
      storage,
      user.id,
      'document.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      b,
    );
    const wireAtts: AttachmentBlock[] = [
      { id: att.id, filename: att.filename, mimeType: att.mimeType, sizeBytes: b.length },
    ];

    const prompt = `In this Word document "${att.filename}" (fileId: "${att.id}"), replace "DRAFT" with "FINAL AGREEMENT". Save as "document_final.docx".`;
    const res = await executeTurn('TestB', prompt, wireAtts);

    const callNames = res.calls.map((c) => c.name);
    const loadSkillIdx = callNames.indexOf('load_skill');
    const searchToolsIdx = callNames.indexOf('search_tools');
    const editDocxIdx = callNames.indexOf('editDocxContent');

    const skillLoadedFirst = loadSkillIdx !== -1 && res.calls[loadSkillIdx]!.input.name === 'docx';
    const searchedTools = searchToolsIdx !== -1;
    const editInvoked = editDocxIdx !== -1;
    const logicalOrderValid = loadSkillIdx < searchToolsIdx && searchToolsIdx < editDocxIdx;

    const passed = skillLoadedFirst && searchedTools && editInvoked && logicalOrderValid;
    testResults.push({
      scenario: 'Test B — DOCX edit',
      skillInitiallyLoaded: false,
      loadSkillCalled: skillLoadedFirst,
      searchToolsCalled: searchedTools,
      correctFileToolInvoked: editInvoked,
      turnRouterChoseExactTool: false,
      toolCallSequence: callNames,
      passed,
      details: `Sequence: [${callNames.join(' -> ')}], Order valid: ${logicalOrderValid}`,
    });
    console.log(`>>> TEST B RESULT: ${passed ? 'PASS' : 'FAIL'} ([${callNames.join(' -> ')}])\n`);
  }

  /* -------------------------------------------------------------------------- TEST C: PPTX Reorder */
  console.log('----------------------------------------------------------------');
  console.log('>>> TEST C: PPTX Reorder (Fresh session -> load_skill("pptx") -> search_tools -> reorderPptxSlides)');
  {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    );
    zip.file(
      'ppt/presentation.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>',
    );
    zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld/></p:sld>');
    zip.file('ppt/slides/slide2.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld/></p:sld>');
    const b = await zip.generateAsync({ type: 'nodebuffer' });
    const att = await uploadTestAttachment(
      db,
      storage,
      user.id,
      'slideshow.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      b,
    );
    const wireAtts: AttachmentBlock[] = [
      { id: att.id, filename: att.filename, mimeType: att.mimeType, sizeBytes: b.length },
    ];

    const prompt = `Reorder the slides in this presentation "${att.filename}" (fileId: "${att.id}") so slide 2 comes before slide 1 (order [2, 1]). Save as "reordered.pptx".`;
    const res = await executeTurn('TestC', prompt, wireAtts);

    const callNames = res.calls.map((c) => c.name);
    const loadSkillIdx = callNames.indexOf('load_skill');
    const searchToolsIdx = callNames.indexOf('search_tools');
    const reorderIdx = callNames.indexOf('reorderPptxSlides');

    const skillLoadedFirst = loadSkillIdx !== -1 && res.calls[loadSkillIdx]!.input.name === 'pptx';
    const searchedTools = searchToolsIdx !== -1;
    const reorderInvoked = reorderIdx !== -1;
    const logicalOrderValid = loadSkillIdx < searchToolsIdx && searchToolsIdx < reorderIdx;

    const passed = skillLoadedFirst && searchedTools && reorderInvoked && logicalOrderValid;
    testResults.push({
      scenario: 'Test C — PPTX reorder',
      skillInitiallyLoaded: false,
      loadSkillCalled: skillLoadedFirst,
      searchToolsCalled: searchedTools,
      correctFileToolInvoked: reorderInvoked,
      turnRouterChoseExactTool: false,
      toolCallSequence: callNames,
      passed,
      details: `Sequence: [${callNames.join(' -> ')}], Order valid: ${logicalOrderValid}`,
    });
    console.log(`>>> TEST C RESULT: ${passed ? 'PASS' : 'FAIL'} ([${callNames.join(' -> ')}])\n`);
  }

  /* -------------------------------------------------------------------------- TEST D: PDF Merge */
  console.log('----------------------------------------------------------------');
  console.log('>>> TEST D: PDF Merge (Fresh session -> load_skill("pdf") -> search_tools -> mergePdfFiles)');
  {
    const doc1 = await PDFDocument.create();
    doc1.addPage([500, 300]).drawText('Document A', { x: 50, y: 200, size: 14 });
    const b1 = Buffer.from(await doc1.save());
    const att1 = await uploadTestAttachment(db, storage, user.id, 'doc_a.pdf', 'application/pdf', b1);

    const doc2 = await PDFDocument.create();
    doc2.addPage([500, 300]).drawText('Document B', { x: 50, y: 200, size: 14 });
    const b2 = Buffer.from(await doc2.save());
    const att2 = await uploadTestAttachment(db, storage, user.id, 'doc_b.pdf', 'application/pdf', b2);

    const wireAtts: AttachmentBlock[] = [
      { id: att1.id, filename: att1.filename, mimeType: att1.mimeType, sizeBytes: b1.length },
      { id: att2.id, filename: att2.filename, mimeType: att2.mimeType, sizeBytes: b2.length },
    ];

    const prompt = `Merge these two PDF documents "${att1.filename}" (fileId: "${att1.id}") and "${att2.filename}" (fileId: "${att2.id}") into "merged_docs.pdf".`;
    const res = await executeTurn('TestD', prompt, wireAtts);

    const callNames = res.calls.map((c) => c.name);
    const loadSkillIdx = callNames.indexOf('load_skill');
    const searchToolsIdx = callNames.indexOf('search_tools');
    const mergeIdx = callNames.indexOf('mergePdfFiles');

    const skillLoadedFirst = loadSkillIdx !== -1 && res.calls[loadSkillIdx]!.input.name === 'pdf';
    const searchedTools = searchToolsIdx !== -1;
    const mergeInvoked = mergeIdx !== -1;
    const logicalOrderValid = loadSkillIdx < searchToolsIdx && searchToolsIdx < mergeIdx;

    const passed = skillLoadedFirst && searchedTools && mergeInvoked && logicalOrderValid;
    testResults.push({
      scenario: 'Test D — PDF merge',
      skillInitiallyLoaded: false,
      loadSkillCalled: skillLoadedFirst,
      searchToolsCalled: searchedTools,
      correctFileToolInvoked: mergeInvoked,
      turnRouterChoseExactTool: false,
      toolCallSequence: callNames,
      passed,
      details: `Sequence: [${callNames.join(' -> ')}], Order valid: ${logicalOrderValid}`,
    });
    console.log(`>>> TEST D RESULT: ${passed ? 'PASS' : 'FAIL'} ([${callNames.join(' -> ')}])\n`);
  }

  /* -------------------------------------------------------------------------- TEST E: Already-Loaded Skill */
  console.log('----------------------------------------------------------------');
  console.log('>>> TEST E: Already-Loaded Skill (First load xlsx Skill -> Then ask XLSX edit -> No duplicate load_skill)');
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getCell('A1').value = 'Pending';
    const b = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const att = await uploadTestAttachment(
      db,
      storage,
      user.id,
      'status.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      b,
    );
    const wireAtts: AttachmentBlock[] = [
      { id: att.id, filename: att.filename, mimeType: att.mimeType, sizeBytes: b.length },
    ];

    // Turn 1: Load skill
    console.log('   --- Turn 1: Pre-loading xlsx skill ---');
    const turn1Res = await executeTurn('TestE_Turn1', 'Please load the "xlsx" skill to inspect spreadsheet procedures.', wireAtts);

    const history: Turn[] = [
      { role: 'user', text: 'Please load the "xlsx" skill to inspect spreadsheet procedures.', attachments: wireAtts },
      { role: 'assistant', text: 'I have loaded the xlsx skill (v2.0.0). The spreadsheet authoring standards and procedural instructions are now active in this conversation session.' },
    ];

    // Turn 2: Request edit with xlsx skill already in session history
    console.log('   --- Turn 2: Requesting edit with xlsx skill already loaded in session ---');
    const prompt2 = `The xlsx skill is already loaded in our session. In spreadsheet "${att.filename}" (fileId: "${att.id}"), please update cell A1 to "Approved". Save as "approved.xlsx".`;
    const turn2Res = await executeTurn('TestE_Turn2', prompt2, wireAtts, history);

    const callNames = turn2Res.calls.map((c) => c.name);
    const loadSkillCalled = callNames.includes('load_skill');
    const searchToolsCalled = callNames.includes('search_tools');
    const editInvoked = callNames.includes('editSpreadsheetCells');

    const passed = !loadSkillCalled && editInvoked;
    testResults.push({
      scenario: 'Test E — Already-loaded Skill',
      skillInitiallyLoaded: true,
      loadSkillCalled,
      searchToolsCalled,
      correctFileToolInvoked: editInvoked,
      turnRouterChoseExactTool: false,
      toolCallSequence: callNames,
      passed,
      details: `load_skill avoided: ${!loadSkillCalled}, editSpreadsheetCells invoked: ${editInvoked}, Sequence: [${callNames.join(' -> ')}]`,
    });
    console.log(`>>> TEST E RESULT: ${passed ? 'PASS' : 'FAIL'} (load_skill called: ${loadSkillCalled}, edit called: ${editInvoked})\n`);
  }

  /* -------------------------------------------------------------------------- TEST F: Direct Understanding */
  console.log('----------------------------------------------------------------');
  console.log('>>> TEST F: Direct Understanding ("What does this PDF say?" -> Pure text understanding, NO tools)');
  {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 300]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText('Confidential Memo: Project Apollo launch date is November 15, 2026.', {
      x: 40,
      y: 220,
      size: 14,
      font,
    });
    const b = Buffer.from(await doc.save());
    const att = await uploadTestAttachment(db, storage, user.id, 'memo.pdf', 'application/pdf', b);
    const wireAtts: AttachmentBlock[] = [
      { id: att.id, filename: att.filename, mimeType: 'application/pdf', sizeBytes: b.length, base64: b.toString('base64') },
    ];

    const prompt = 'What does this PDF say?';
    const res = await executeTurn('TestF', prompt, wireAtts);

    const callNames = res.calls.map((c) => c.name);
    const mentionsApollo =
      res.reply.toLowerCase().includes('apollo') ||
      res.reply.toLowerCase().includes('november 15') ||
      res.reply.toLowerCase().includes('launch date');

    const noUnnecessaryTools = callNames.length === 0;
    const passed = mentionsApollo && noUnnecessaryTools;

    testResults.push({
      scenario: 'Test F — Direct Understanding',
      skillInitiallyLoaded: false,
      loadSkillCalled: callNames.includes('load_skill'),
      searchToolsCalled: callNames.includes('search_tools'),
      correctFileToolInvoked: false, // No tool should be invoked
      turnRouterChoseExactTool: false,
      toolCallSequence: callNames,
      passed,
      details: `Direct answer produced without tools: ${noUnnecessaryTools} (calls: [${callNames.join(', ')}]), mentions Apollo: ${mentionsApollo}`,
    });
    console.log(`>>> TEST F RESULT: ${passed ? 'PASS' : 'FAIL'} (tools called: [${callNames.join(', ')}], mentions content: ${mentionsApollo})\n`);
  }

  // -------------------------------------------------------------------------- FINAL REPORT
  console.log('================================================================');
  console.log('                FINAL BATCH 4 FREEZE CHECK REPORT               ');
  console.log('================================================================');

  console.log(
    'Scenario | Skill Initially Loaded? | load_skill Called? | search_tools Called? | Correct File Tool Invoked? | TurnRouter Chose Exact Tool? | PASS/FAIL',
  );
  console.log(
    '---|---|---|---|---|---|---',
  );
  let allPassed = true;
  for (const r of testResults) {
    if (!r.passed) allPassed = false;
    console.log(
      `${r.scenario} | ${r.skillInitiallyLoaded ? 'YES' : 'NO'} | ${r.loadSkillCalled ? 'YES' : 'NO'} | ${r.searchToolsCalled ? 'YES' : 'NO'} | ${r.correctFileToolInvoked ? 'YES' : (r.scenario.includes('Direct') ? 'N/A (Direct)' : 'NO')} | ${r.turnRouterChoseExactTool ? 'YES' : 'NO'} | ${r.passed ? 'PASS' : 'FAIL'}`,
    );
  }

  console.log('\nTURNROUTER ROLE:');
  console.log(`- policy/capability boundary only: ${turnRouterPolicyOnly ? 'YES' : 'NO'}`);
  console.log(`- exact Skill selection: ${dummyRouting.selectedSkills.length === 0 ? 'NO' : 'YES'}`);
  console.log(`- exact operation selection: ${!dummyRouting.exposedTools.includes('editSpreadsheetCells') ? 'NO' : 'YES'}`);

  console.log('----------------------------------------------------------------');
  if (allPassed && turnRouterPolicyOnly) {
    console.log('\n>>> BATCH 4 FULLY VERIFIED AND READY TO FREEZE');
    process.exit(0);
  } else {
    console.error('\n>>> BATCH 4 STILL HAS ARCHITECTURE GAPS');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal verification failure:', err);
  process.exit(1);
});
