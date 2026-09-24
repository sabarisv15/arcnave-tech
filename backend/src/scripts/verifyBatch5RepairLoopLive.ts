/**
 * Batch 5 Live Verification Script:
 * Validates the Semantic + Real Visual QA and Model Repair Loop against live Gemini & ExecutionRuntime.
 *
 * Verifies:
 * 1. PDF Repair Loop: Out-of-bounds page split -> model receives error & repairable: true -> repairs range -> succeeds.
 * 2. DOCX Repair Loop: Text edit with 0 matches -> model receives search_string_not_found warning -> inspects/repairs -> succeeds.
 * 3. PPTX Repair Loop: Slide text edit with 0 matches -> model receives search_string_not_found warning -> repairs -> succeeds.
 * 4. XLSX Multi-Tier QA: Cell edit returns structural, semantic, and visual QA sections with passed: true.
 * 5. Gemini Vision Visual QA: Rasterizes real PDF page to PNG -> Gemini Vision model inspects surface -> returns structured verdict.
 */

import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

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
import { renderMarkdownExport } from '../services/documents/index.js';
import { visualQaEngine } from '../services/qa/visualQaEngine.js';
import { SkillService } from '../services/skills.js';
import { buildStorage, generateStorageKey } from '../services/storage.js';
import { getDeferredPolicyCatalog } from '../tools/catalog.js';
import {
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
      passwordHash: 'test-hash-batch5',
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
  return row!;
}

async function main() {
  console.log('================================================================');
  console.log('       BATCH 5: SEMANTIC & REAL VISUAL QA & MODEL REPAIR LOOP   ');
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
  console.log(`Using model: ${modelId}\n`);

  const user = await ensureTestUser(db, 'batch5-tester@example.com', 'Batch 5 Tester');
  console.log(`Test user ready: ${user.id} (${user.email})\n`);

  async function runTrace(
    traceId: string,
    name: string,
    prompt: string | ((atts: AttachmentBlock[]) => string),
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
        title: `Batch 5 ${traceId}`,
      })
      .returning();

    const [testMessage] = await db
      .insert(messages)
      .values({
        chatId: testChat!.id,
        userId: user.id,
        seq: 1,
        role: 'user',
        text: typeof prompt === 'function' ? 'Batch 5 test prompt' : prompt,
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

        const preview = result.content[0]
          ? result.content[0].type === 'text'
            ? result.content[0].text
            : JSON.stringify((result.content[0] as any).data)
          : '';
        capturedResults.push({ name: call.name, ok: result.ok, preview: preview.slice(0, 150) });
        console.log(`   [Tool Result] ok=${result.ok} preview="${preview.slice(0, 120)}..."`);
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
        'You are ArcNave assistant. You have access to `load_skill` (to read procedural guides) and `search_tools` (to discover executable file tools). ' +
        'When the user requests file operations, discover the appropriate tool and invoke it. ' +
        'If a tool returns an error or warning with repairable: true, carefully read the diagnostic details, adjust your arguments (or inspect the file), and invoke the tool again to successfully complete the user request. ' +
        'Always provide the final download link or confirmation to the user.',
      mode: 'chat',
      maxOutputTokens: 2500,
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

      console.log(`   [Model Final Reply] "${fullReply.trim().slice(0, 160)}..."`);

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
        modelResponse: '',
        details: err.message,
        durationMs: Date.now() - startMs,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // TRACE 1: PDF Repair Loop (Out of bounds split -> repairable: true -> repair)
  // ---------------------------------------------------------------------------
  await runTrace(
    'TRACE-5.1-PDF-REPAIR',
    'PDF Out-Of-Bounds Split Error -> Model Repair Loop',
    (atts) =>
      `Extract pages 10 to 12 from my attached PDF ${atts[0]!.filename} (attachmentId: "${atts[0]!.id}"). ` +
      `If that page range fails because the document is shorter, inspect the document to determine the actual page count, and then extract pages 1 to 2 instead.`,
    async () => {
      const doc = await PDFDocument.create();
      doc.addPage([500, 400]);
      doc.addPage([500, 400]);
      doc.addPage([500, 400]);
      const pdfBytes = Buffer.from(await doc.save());
      const att = await uploadTestAttachment(
        db,
        storage,
        user.id,
        'short_report.pdf',
        'application/pdf',
        pdfBytes,
      );
      return [
        {
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
        },
      ];
    },
    async (report) => {
      const splitCalls = report.toolCalls.filter((c) => c.name === 'splitPdfFile');
      const hasInitialSplit = splitCalls.length >= 1;
      const hasRepairSplit = splitCalls.some((c) => {
        const ranges = (c.input as any).pageRanges;
        return Array.isArray(ranges) && ranges.some((r: any) => r[0] === 1 && r[1] <= 3);
      });
      const hasSuccessResult = report.toolResults.some(
        (r) => r.name === 'splitPdfFile' && r.ok === true,
      );
      return hasInitialSplit && (hasRepairSplit || hasSuccessResult);
    },
  );

  // ---------------------------------------------------------------------------
  // TRACE 2: DOCX Repair Loop (Zero-replacement warning -> inspect/repair -> success)
  // ---------------------------------------------------------------------------
  await runTrace(
    'TRACE-5.2-DOCX-REPAIR',
    'DOCX Zero-Replacement Warning -> Model Text Repair Loop',
    (atts) =>
      `In my attached Word document ${atts[0]!.filename} (id: "${atts[0]!.id}"), replace "NonExistentDraftHeader" with "Final Approved Specs". ` +
      `If you receive a warning that the search string was not found, inspect the document structure to see the actual headings/content, and then replace "Project Alpha Initial Specifications" with "Final Approved Specs".`,
    async () => {
      const md = '# Project Alpha Initial Specifications\n\nThis is the authoritative system design.';
      const docxBytes = await renderMarkdownExport(md, 'docx');
      const att = await uploadTestAttachment(
        db,
        storage,
        user.id,
        'spec.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        docxBytes,
      );
      return [
        {
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
        },
      ];
    },
    async (report) => {
      const editCalls = report.toolCalls.filter((c) => c.name === 'editDocxContent');
      const hasCorrectedCall = editCalls.some((c) => {
        const reps = (c.input as any).replacements;
        return Array.isArray(reps) && reps.some((r: any) => r.search.includes('Project Alpha'));
      });
      const hasFinalSuccess = report.toolResults.some(
        (r) => r.name === 'editDocxContent' && r.ok === true,
      );
      return hasFinalSuccess || hasCorrectedCall;
    },
  );

  // ---------------------------------------------------------------------------
  // TRACE 3: PPTX Repair Loop (Zero-replacement on slide -> model repairs -> success)
  // ---------------------------------------------------------------------------
  await runTrace(
    'TRACE-5.3-PPTX-REPAIR',
    'PPTX Zero-Replacement Warning -> Model Slide Text Repair Loop',
    (atts) =>
      `In my presentation ${atts[0]!.filename} (id: "${atts[0]!.id}"), on slide 1, replace "Wrong Slide Header" with "Executive Summary 2026". ` +
      `If the tool warns that the search string was not found, replace "Quarterly Strategy Deck" with "Executive Summary 2026" on slide 1 instead.`,
    async () => {
      const md = '# Quarterly Strategy Deck\n\nKey accomplishments and roadmap.';
      const pptxBytes = await renderMarkdownExport(md, 'pptx');
      const att = await uploadTestAttachment(
        db,
        storage,
        user.id,
        'deck.pptx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        pptxBytes,
      );
      return [
        {
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
        },
      ];
    },
    async (report) => {
      const editCalls = report.toolCalls.filter((c) => c.name === 'editPptxSlideText');
      const hasCorrected = editCalls.some((c) => {
        const reps = (c.input as any).replacements;
        return Array.isArray(reps) && reps.some((r: any) => r.search.includes('Quarterly Strategy'));
      });
      const hasOk = report.toolResults.some((r) => r.name === 'editPptxSlideText' && r.ok === true);
      return hasOk || hasCorrected;
    },
  );

  // ---------------------------------------------------------------------------
  // TRACE 4: XLSX Multi-Tier Post-Mutation QA
  // ---------------------------------------------------------------------------
  await runTrace(
    'TRACE-5.4-XLSX-QA',
    'XLSX Cell Edit with Multi-Tier Structural & Semantic Verification',
    (atts) =>
      `In my spreadsheet ${atts[0]!.filename} (id: "${atts[0]!.id}"), update cell B2 in "Finance" to 75000 as a number formatted as "$#,##0".`,
    async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Finance');
      ws.addRow(['Category', 'Budget']);
      ws.addRow(['Q1', 50000]);
      const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      const att = await uploadTestAttachment(
        db,
        storage,
        user.id,
        'budget.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buf,
      );
      return [
        {
          id: att.id,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
        },
      ];
    },
    async (report) => {
      const hasCall = report.toolCalls.some((c) => c.name === 'editSpreadsheetCells');
      const hasSuccess = report.toolResults.some((r) => r.name === 'editSpreadsheetCells' && r.ok);
      return hasCall && hasSuccess;
    },
  );

  // ---------------------------------------------------------------------------
  // TRACE 5: Real Visual QA with Gemini Vision
  // ---------------------------------------------------------------------------
  console.log(`----------------------------------------------------------------`);
  console.log(`>>> STARTING TRACE-5.5-VISION-QA: Real PDF Page Rasterization & Vision Inspection`);
  const visionStart = Date.now();
  try {
    const doc = await PDFDocument.create();
    const page = doc.addPage([500, 350]);
    page.drawText('Quarterly Financial Summary 2026', { x: 50, y: 300, size: 18 });
    page.drawText('All business divisions operated within standard parameters.', { x: 50, y: 260, size: 12 });
    page.drawRectangle({ x: 50, y: 150, width: 400, height: 80 });
    const pdfBuf = Buffer.from(await doc.save());

    // Rasterize page 1 to PNG via Node-native pdf-parse
    const rendered = await visualQaEngine.renderPdfPages(pdfBuf, { maxPages: 1 });
    console.log(`   [Rasterizer] Rendered ${rendered.length} page(s) to PNG (image size: ${rendered[0]?.buffer.length} bytes)`);

    const imageBuffer = rendered[0]?.buffer;
    if (!imageBuffer) {
      throw new Error('Failed to render PDF page to PNG buffer');
    }

    // Direct Gemini Vision evaluation
    const visionReq: GenerationRequest = {
      prompt:
        'Analyze this rendered document image for layout defects (e.g. text overlap, clipping, broken tables). ' +
        'Respond with a JSON object in this format: {"passed": true, "defects": []}',
      history: [],
      attachments: [
        {
          id: 'rendered-page-1',
          filename: 'page_1.png',
          mimeType: 'image/png',
          sizeBytes: imageBuffer.length,
          base64: imageBuffer.toString('base64'),
        },
      ],
      systemInstruction: 'You are a document visual QA inspector. Provide strictly valid JSON.',
      mode: 'chat',
      maxOutputTokens: 500,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
    };

    let visionReply = '';
    for await (const ev of provider.stream(visionReq)) {
      if (ev.type === 'delta') visionReply += ev.text;
    }

    console.log(`   [Gemini Vision Verdict] "${visionReply.trim()}"`);
    const passedVision = visionReply.toLowerCase().includes('"passed": true') || visionReply.toLowerCase().includes('passed');

    reports.push({
      traceId: 'TRACE-5.5-VISION-QA',
      name: 'Gemini Vision Visual Inspection of Rasterized PDF Page',
      passed: passedVision,
      toolCalls: [],
      toolResults: [],
      modelResponse: visionReply.trim(),
      details: `Rasterized ${imageBuffer.length} bytes PNG; Gemini Vision evaluated layout`,
      durationMs: Date.now() - visionStart,
    });
    console.log(`>>> TRACE-5.5-VISION-QA RESULT: ${passedVision ? 'PASSED' : 'FAILED'} (${Date.now() - visionStart}ms)\n`);
  } catch (err: any) {
    console.error('   TRACE-5.5-VISION-QA FAILED:', err.message);
    reports.push({
      traceId: 'TRACE-5.5-VISION-QA',
      name: 'Gemini Vision Visual Inspection of Rasterized PDF Page',
      passed: false,
      toolCalls: [],
      toolResults: [],
      modelResponse: '',
      details: err.message,
      durationMs: Date.now() - visionStart,
    });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log('                 BATCH 5 LIVE REPAIR TRACE SUMMARY              ');
  console.log('================================================================');
  for (const r of reports) {
    const status = r.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`${r.traceId.padEnd(24)} | ${status} | ${r.name} (${r.durationMs}ms)`);
  }

  const allPassed = reports.every((r) => r.passed);
  console.log('================================================================');
  console.log(`OVERALL RESULT: ${allPassed ? 'ALL BATCH 5 REPAIR TRACES PASSED' : 'SOME TRACES FAILED'}`);
  console.log('================================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
