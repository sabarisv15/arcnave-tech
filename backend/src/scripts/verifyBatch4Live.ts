/**
 * Batch 4 Live Verification Script
 * Validates the exposed and wired file operations against live Gemini & ExecutionRuntime.
 *
 * Traces:
 * 1. PDF Merge: Upload 2 PDFs -> MODEL discovers mergePdfFiles -> executes -> output PDF returned.
 * 2. Spreadsheet Cell Edit: Upload .xlsx -> MODEL discovers editSpreadsheetCells -> executes -> modified .xlsx returned.
 * 3. DOCX Edit/Append: Upload .docx -> MODEL discovers editDocxContent/appendDocxSection -> executes -> modified .docx returned.
 * 4. PPTX Reorder/Edit: Upload .pptx -> MODEL discovers reorderPptxSlides/editPptxSlideText -> executes -> modified .pptx returned.
 * 5. Pure Inspection: Upload file -> MODEL discovers inspect tool -> executes -> JSON returned -> ZERO output files persisted.
 * 6. Duplicate Filenames: Upload two files named "statement.pdf" -> MODEL merges -> safe materialization & zero collision.
 * 7. Authorization Boundary: User A invokes tool on User B attachment -> clean failure returned -> model explains cleanly.
 */

import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

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
} from '../providers/types.js';
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

interface TraceReport {
  traceId: string;
  name: string;
  passed: boolean;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  toolResults: Array<{ name: string; ok: boolean; preview: string }>;
  modelResponse: string;
  details: string;
  durationMs: number;
}

const reports: TraceReport[] = [];

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
      passwordHash: 'test-hash-batch4',
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
  console.log('   BATCH 4 — FILE OPERATION WIRING LIVE GEMINI VERIFICATION     ');
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

  const userA = await ensureTestUser(db, 'batch4-usera@example.com', 'User A');
  const userB = await ensureTestUser(db, 'batch4-userb@example.com', 'User B');

  console.log(`Test users ready: UserA=${userA.id}, UserB=${userB.id}\n`);

  async function runTrace(
    traceId: string,
    name: string,
    prompt: string | ((atts: AttachmentBlock[]) => string),
    user: any,
    setupAttachments: () => Promise<AttachmentBlock[]>,
    validator: (report: TraceReport) => Promise<boolean>,
  ): Promise<void> {
    console.log(`----------------------------------------------------------------`);
    console.log(`>>> STARTING ${traceId}: ${name}`);
    const startMs = Date.now();
    const capturedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const capturedResults: Array<{ name: string; ok: boolean; preview: string }> = [];
    let fullReply = '';

    const initialTools: ToolDefinition[] = [LOAD_SKILL, SEARCH_TOOLS];
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
        title: `Batch 4 ${traceId}`,
      })
      .returning();

    const [testMessage] = await db
      .insert(messages)
      .values({
        chatId: testChat!.id,
        userId: user.id,
        seq: 1,
        role: 'user',
        text: typeof prompt === 'function' ? 'Batch 4 test prompt' : prompt,
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
        console.log(`   [Tool Discovered] dynamically adding ${discovered.name} to available tools`);
        availableTools.push(discovered);
        activeToolNames.add(discovered.name);
      }
    });

    const dispatchingExecutor = {
      async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
        capturedCalls.push({ name: call.name, input: call.input as Record<string, unknown> });
        console.log(`   [Model Invocation] ${call.name}(${JSON.stringify(call.input)})`);

        let result: ToolResult;
        if (call.name === 'load_skill') {
          result = await skillExecutor.execute(call, signal!);
        } else if (call.name === 'search_tools') {
          result = await searchExecutor.execute(call, signal!);
        } else {
          result = await fileOpExecutor.execute(call, signal!);
        }

        const preview = result.content[0] ? (result.content[0].type === 'text' ? result.content[0].text : JSON.stringify((result.content[0] as any).data)) : '';
        capturedResults.push({ name: call.name, ok: result.ok, preview: preview.slice(0, 150) });
        console.log(`   [Tool Result] ok=${result.ok} preview="${preview.slice(0, 100)}..."`);
        return result;
      },
    };

    const wireAttachments = await setupAttachments();
    const finalPrompt = typeof prompt === 'function' ? prompt(wireAttachments) : prompt;

    const req: GenerationRequest = {
      prompt: finalPrompt,
      history: [],
      attachments: wireAttachments,
      systemInstruction:
        'You are ArcNave assistant. You have access to `load_skill` (to read procedural guides) and `search_tools` (to discover executable tools). ' +
        'When the user requests file operations (inspect, merge, split, cell edit, document edit, slide reorder), use search_tools to discover the exact executable file tool and invoke it. ' +
        'Always provide the final download link or answer to the user.',
      mode: 'chat',
      maxOutputTokens: 2000,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      tools: availableTools,
      toolExecutor: dispatchingExecutor,
      signal: new AbortController().signal,
    };

    try {
      for await (const ev of provider.stream(req)) {
        if (ev.type === 'delta') {
          fullReply += ev.text;
        }
      }

      console.log(`   [Model Reply] "${fullReply.trim().slice(0, 150)}..."`);

      const report: TraceReport = {
        traceId,
        name,
        passed: false,
        toolCalls: capturedCalls,
        toolResults: capturedResults,
        modelResponse: fullReply.trim(),
        details: '',
        durationMs: Date.now() - startMs,
      };

      report.passed = await validator(report);
      reports.push(report);
      console.log(`>>> ${traceId} RESULT: ${report.passed ? 'PASSED' : 'FAILED'} (${report.durationMs}ms)\n`);
    } catch (err: any) {
      console.error(`   ${traceId} FAILED WITH ERROR:`, err.message);
      reports.push({
        traceId,
        name,
        passed: false,
        toolCalls: capturedCalls,
        toolResults: capturedResults,
        modelResponse: fullReply,
        details: `Exception: ${err.message}`,
        durationMs: Date.now() - startMs,
      });
      console.log(`>>> ${traceId} RESULT: FAILED\n`);
    }
  }

  /* -------------------------------------------------------------------------- TRACE 1 */
  await runTrace(
    'TRACE_1',
    'PDF Merge (search_tools -> mergePdfFiles)',
    (atts) =>
      `I have uploaded two PDF documents: "${atts[0]!.filename}" (fileId: "${atts[0]!.id}") and "${atts[1]!.filename}" (fileId: "${atts[1]!.id}"). Please merge them into a single consolidated file named "merged_reports.pdf".`,
    userA,
    async () => {
      const doc1 = await PDFDocument.create();
      doc1.addPage([500, 300]).drawText('Report Part 1', { x: 50, y: 200, size: 14 });
      const b1 = Buffer.from(await doc1.save());
      const att1 = await uploadTestAttachment(db, storage, userA.id, 'part1.pdf', 'application/pdf', b1);

      const doc2 = await PDFDocument.create();
      doc2.addPage([500, 300]).drawText('Report Part 2', { x: 50, y: 200, size: 14 });
      const b2 = Buffer.from(await doc2.save());
      const att2 = await uploadTestAttachment(db, storage, userA.id, 'part2.pdf', 'application/pdf', b2);

      return [
        { id: att1.id, filename: 'part1.pdf', mimeType: 'application/pdf', sizeBytes: b1.length },
        { id: att2.id, filename: 'part2.pdf', mimeType: 'application/pdf', sizeBytes: b2.length },
      ];
    },
    async (r) => {
      const hasMergeCall = r.toolCalls.some((c) => c.name === 'mergePdfFiles');
      const hasMergeResult = r.toolResults.some((res) => res.name === 'mergePdfFiles' && res.ok);
      const mentionsDownload = r.modelResponse.includes('/files/') || r.modelResponse.includes('.pdf') || r.modelResponse.includes('merged');
      r.details = `mergePdfFiles called: ${hasMergeCall}, ok result: ${hasMergeResult}, download link present: ${mentionsDownload}`;
      return hasMergeCall && hasMergeResult;
    },
  );

  /* -------------------------------------------------------------------------- TRACE 2 */
  await runTrace(
    'TRACE_2',
    'Spreadsheet Cell Edit (search_tools -> editSpreadsheetCells)',
    (atts) =>
      `Please update cell B5 to 42000 and cell C5 to "=B5*1.1" in Sheet1 of this spreadsheet "${atts[0]!.filename}" (fileId: "${atts[0]!.id}"). Save as "updated_financials.xlsx".`,
    userA,
    async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.getCell('A5').value = 'Revenue';
      ws.getCell('B5').value = 10000;
      const b = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      const att = await uploadTestAttachment(db, storage, userA.id, 'financials.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b);
      return [{ id: att.id, filename: 'financials.xlsx', mimeType: att.mimeType, sizeBytes: b.length }];
    },
    async (r) => {
      const hasEditCall = r.toolCalls.some((c) => c.name === 'editSpreadsheetCells');
      const hasEditResult = r.toolResults.some((res) => res.name === 'editSpreadsheetCells' && res.ok);
      r.details = `editSpreadsheetCells called: ${hasEditCall}, ok result: ${hasEditResult}`;
      return hasEditCall && hasEditResult;
    },
  );

  /* -------------------------------------------------------------------------- TRACE 3 */
  await runTrace(
    'TRACE_3',
    'DOCX Section Append (search_tools -> appendDocxSection)',
    (atts) =>
      `Add a new section titled "Compliance Notes" with the paragraph "All operations are verified and audited." to this Word document "${atts[0]!.filename}" (fileId: "${atts[0]!.id}").`,
    userA,
    async () => {
      const zip = new JSZip();
      zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      );
      zip.file(
        'word/document.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Existing Agreement Content.</w:t></w:r></w:p></w:body></w:document>',
      );
      const b = await zip.generateAsync({ type: 'nodebuffer' });
      const att = await uploadTestAttachment(db, storage, userA.id, 'contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', b);
      return [{ id: att.id, filename: 'contract.docx', mimeType: att.mimeType, sizeBytes: b.length }];
    },
    async (r) => {
      const hasDocxCall = r.toolCalls.some((c) => c.name === 'appendDocxSection' || c.name === 'editDocxContent');
      const hasDocxResult = r.toolResults.some((res) => (res.name === 'appendDocxSection' || res.name === 'editDocxContent') && res.ok);
      r.details = `DOCX tool called: ${hasDocxCall}, ok result: ${hasDocxResult}`;
      return hasDocxCall && hasDocxResult;
    },
  );

  /* -------------------------------------------------------------------------- TRACE 4 */
  await runTrace(
    'TRACE_4',
    'PPTX Slide Reorder (search_tools -> reorderPptxSlides)',
    (atts) =>
      `Reorder the slides in this PowerPoint presentation "${atts[0]!.filename}" (fileId: "${atts[0]!.id}") so that slide 2 appears before slide 1 (order [2, 1]). Save as "reordered.pptx".`,
    userA,
    async () => {
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
      const att = await uploadTestAttachment(db, storage, userA.id, 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', b);
      return [{ id: att.id, filename: 'deck.pptx', mimeType: att.mimeType, sizeBytes: b.length }];
    },
    async (r) => {
      const hasPptxCall = r.toolCalls.some((c) => c.name === 'reorderPptxSlides' || c.name === 'editPptxSlideText');
      const hasPptxResult = r.toolResults.some((res) => (res.name === 'reorderPptxSlides' || res.name === 'editPptxSlideText') && res.ok);
      r.details = `PPTX tool called: ${hasPptxCall}, ok result: ${hasPptxResult}`;
      return hasPptxCall && hasPptxResult;
    },
  );

  /* -------------------------------------------------------------------------- TRACE 5 */
  let attCountBefore = 0;
  await runTrace(
    'TRACE_5',
    'Pure Inspection (inspectPdf -> ZERO Output Files)',
    (atts) =>
      `How many pages does this PDF document "${atts[0]!.filename}" (fileId: "${atts[0]!.id}") have? Please inspect it and tell me the total page count.`,
    userA,
    async () => {
      const doc = await PDFDocument.create();
      doc.addPage([500, 300]);
      doc.addPage([500, 300]);
      doc.addPage([500, 300]);
      const b = Buffer.from(await doc.save());
      const att = await uploadTestAttachment(db, storage, userA.id, 'document_3pages.pdf', 'application/pdf', b);

      const allAtts = await db.select().from(attachments);
      attCountBefore = allAtts.length;

      return [{ id: att.id, filename: 'document_3pages.pdf', mimeType: 'application/pdf', sizeBytes: b.length }];
    },
    async (r) => {
      const hasInspectCall = r.toolCalls.some((c) => c.name === 'inspectPdf');
      const mentionsPages = r.modelResponse.includes('3') || r.modelResponse.toLowerCase().includes('three');

      const allAttsAfter = await db.select().from(attachments);
      const attCountAfter = allAttsAfter.length;
      const zeroOutputFiles = attCountAfter === attCountBefore;

      r.details = `inspectPdf called: ${hasInspectCall}, model mentions 3: ${mentionsPages}, zero output files created: ${zeroOutputFiles} (before: ${attCountBefore}, after: ${attCountAfter})`;
      return hasInspectCall && mentionsPages && zeroOutputFiles;
    },
  );

  /* -------------------------------------------------------------------------- TRACE 6 */
  await runTrace(
    'TRACE_6',
    'Multi-File Duplicate Filenames (mergePdfFiles collision protection)',
    (atts) =>
      `Merge these two uploaded files (both named "statement.pdf", fileIds: "${atts[0]!.id}" and "${atts[1]!.id}") into "consolidated_statements.pdf".`,
    userA,
    async () => {
      const doc1 = await PDFDocument.create();
      doc1.addPage([500, 300]).drawText('January Statement', { x: 50, y: 200, size: 14 });
      const b1 = Buffer.from(await doc1.save());
      const att1 = await uploadTestAttachment(db, storage, userA.id, 'statement.pdf', 'application/pdf', b1);

      const doc2 = await PDFDocument.create();
      doc2.addPage([500, 300]).drawText('February Statement', { x: 50, y: 200, size: 14 });
      const b2 = Buffer.from(await doc2.save());
      const att2 = await uploadTestAttachment(db, storage, userA.id, 'statement.pdf', 'application/pdf', b2);

      return [
        { id: att1.id, filename: 'statement.pdf', mimeType: 'application/pdf', sizeBytes: b1.length },
        { id: att2.id, filename: 'statement.pdf', mimeType: 'application/pdf', sizeBytes: b2.length },
      ];
    },
    async (r) => {
      const hasMergeCall = r.toolCalls.some((c) => c.name === 'mergePdfFiles');
      const hasMergeResult = r.toolResults.some((res) => res.name === 'mergePdfFiles' && res.ok);
      r.details = `mergePdfFiles called: ${hasMergeCall}, ok result: ${hasMergeResult}`;
      return hasMergeCall && hasMergeResult;
    },
  );

  /* -------------------------------------------------------------------------- TRACE 7 */
  await runTrace(
    'TRACE_7',
    'Authorization Boundary (User A attempts to inspect User B attachment)',
    (atts) => `Inspect this PDF file "${atts[0]!.filename}" (fileId: "${atts[0]!.id}") to check its page count.`,
    userA,
    async () => {
      // Create attachment owned strictly by User B
      const doc = await PDFDocument.create();
      doc.addPage([500, 300]);
      const b = Buffer.from(await doc.save());
      const attUserB = await uploadTestAttachment(db, storage, userB.id, 'secret_user_b.pdf', 'application/pdf', b);

      // Present the file ID to User A's session
      return [{ id: attUserB.id, filename: 'secret_user_b.pdf', mimeType: 'application/pdf', sizeBytes: b.length }];
    },
    async (r) => {
      // Tool call should be rejected with authorization error
      const failedResult = r.toolResults.find((res) => !res.ok);
      const authFailed = failedResult && failedResult.preview.includes('not authorized');
      const cleanExplanation = r.modelResponse.toLowerCase().includes('not authorized') ||
        r.modelResponse.toLowerCase().includes('unable') ||
        r.modelResponse.toLowerCase().includes('access') ||
        r.modelResponse.toLowerCase().includes('permission') ||
        r.modelResponse.toLowerCase().includes('not found') ||
        r.modelResponse.toLowerCase().includes('failed');

      r.details = `Tool rejected with auth error: ${Boolean(authFailed)}, model explained cleanly: ${cleanExplanation}`;
      return Boolean(authFailed) && cleanExplanation;
    },
  );

  // -------------------------------------------------------------------------- SUMMARY
  console.log('================================================================');
  console.log('                   BATCH 4 LIVE TRACE SUMMARY                   ');
  console.log('================================================================');

  let passedCount = 0;
  for (const r of reports) {
    if (r.passed) passedCount++;
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.traceId} — ${r.name} (${r.durationMs}ms)`);
    console.log(`       Details: ${r.details}`);
    console.log(`       Calls: [${r.toolCalls.map((c) => c.name).join(', ')}]`);
  }

  console.log('----------------------------------------------------------------');
  console.log(`Total Traces: ${reports.length} | Passed: ${passedCount} | Failed: ${reports.length - passedCount}`);

  if (passedCount === reports.length) {
    console.log('\n>>> ALL 7 BATCH 4 LIVE VERIFICATION TRACES PASSED SUCCESSFULLY.');
    process.exit(0);
  } else {
    console.error('\n>>> SOME BATCH 4 TRACES FAILED.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal verification failure:', err);
  process.exit(1);
});
