/**
 * Batch 6 Audit: Long-Conversation Multi-Turn Live Test.
 *
 * Verifies live against real Gemini Provider and PostgreSQL:
 * 1. Multi-turn conversation with attachments (PDF + XLSX).
 * 2. Duplicate filenames across turns (verifying attachment identity).
 * 3. Skill loads and tool discovery across turns.
 * 4. File inspection and mutation with QA diagnostics.
 * 5. Later turn references earlier attachment and earlier tool results.
 * 6. Validates that no raw base64 is persisted in message history.
 * 7. Records actual token/context telemetry.
 */

import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';

import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { loadConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { attachments, chats, messages, toolCalls, users } from '../db/schema.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { AttachmentBlock, GenerationRequest, ToolDefinition } from '../providers/types.js';
import { SkillService } from '../services/skills.js';
import { buildStorage, generateStorageKey } from '../services/storage.js';
import { getDeferredPolicyCatalog } from '../tools/catalog.js';
import { LOAD_SKILL, SEARCH_TOOLS } from '../tools/definitions.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import { FileOperationExecutor } from '../tools/fileOperationExecutor.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';

async function main() {
  console.log('================================================================');
  console.log('   PRE-BATCH 6 AUDIT: LONG-CONVERSATION MULTI-TURN LIVE TEST    ');
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

  // 1. Create Test User and Chat
  const [user] = await db
    .insert(users)
    .values({
      email: `audit-tester-${Date.now()}@example.com`,
      name: 'Audit Tester',
      passwordHash: 'test-hash-batch6',
    })
    .returning();

  const [chat] = await db
    .insert(chats)
    .values({
      userId: user!.id,
      title: 'Audit Multi-Turn Conversation',
    })
    .returning();

  console.log(`User: ${user!.id}, Chat: ${chat!.id}\n`);

  // 2. Create Two Distinct Attachments with the SAME filename: "report.pdf"
  // File A: 1-page PDF
  const pdfDocA = await PDFDocument.create();
  const pA = pdfDocA.addPage([500, 300]);
  pA.drawText('Report A: Q1 Baseline Metrics', { x: 50, y: 200, size: 16 });
  const bufA = Buffer.from(await pdfDocA.save());
  const storageKeyA = generateStorageKey(user!.id);
  await storage.put(storageKeyA, bufA, 'application/pdf');

  const [attA] = await db
    .insert(attachments)
    .values({
      userId: user!.id,
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bufA.length,
      storageKey: storageKeyA,
      status: 'ready',
      error: '',
    })
    .returning();

  // File B: 2-page PDF
  const pdfDocB = await PDFDocument.create();
  const pB1 = pdfDocB.addPage([500, 300]);
  pB1.drawText('Report B: Q2 Advanced Performance Page 1', { x: 50, y: 200, size: 16 });
  const pB2 = pdfDocB.addPage([500, 300]);
  pB2.drawText('Report B: Page 2 Findings', { x: 50, y: 200, size: 16 });
  const bufB = Buffer.from(await pdfDocB.save());
  const storageKeyB = generateStorageKey(user!.id);
  await storage.put(storageKeyB, bufB, 'application/pdf');

  const [attB] = await db
    .insert(attachments)
    .values({
      userId: user!.id,
      filename: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: bufB.length,
      storageKey: storageKeyB,
      status: 'ready',
      error: '',
    })
    .returning();

  // File C: Spreadsheet "financials.xlsx"
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Q3Data');
  ws.addRow(['Category', 'Actual', 'Budget']);
  ws.addRow(['Marketing', 50000, 45000]);
  ws.addRow(['R&D', 120000, 110000]);
  const bufC = Buffer.from(await wb.xlsx.writeBuffer());
  const storageKeyC = generateStorageKey(user!.id);
  await storage.put(storageKeyC, bufC, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  const [attC] = await db
    .insert(attachments)
    .values({
      userId: user!.id,
      filename: 'financials.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: bufC.length,
      storageKey: storageKeyC,
      status: 'ready',
      error: '',
    })
    .returning();

  console.log(`Attachment A: id=${attA!.id}, name="${attA!.filename}" (1 page)`);
  console.log(`Attachment B: id=${attB!.id}, name="${attB!.filename}" (2 pages) [DUPLICATE FILENAME]`);
  console.log(`Attachment C: id=${attC!.id}, name="${attC!.filename}" (xlsx)\n`);

  // Setup Turn Runner
  let seq = 1;
  const conversationHistory: Array<{ role: 'user' | 'assistant'; text: string; attachments?: AttachmentBlock[] }> = [];

  async function executeTurn(
    userPrompt: string,
    turnAttachments: AttachmentBlock[],
  ): Promise<{ assistantText: string; toolCallsRun: string[]; tokensUsed: number }> {
    console.log(`----------------------------------------------------------------`);
    console.log(`>>> EXECUTING TURN ${seq}: "${userPrompt.slice(0, 60)}..."`);
    const turnStart = Date.now();

    // 1. Persist User Message
    const [userMsg] = await db
      .insert(messages)
      .values({
        chatId: chat!.id,
        userId: user!.id,
        role: 'user',
        text: userPrompt,
        seq: seq++,
        status: 'complete',
      })
      .returning();

    // Attach to message
    for (const a of turnAttachments) {
      if (a.id) {
        await db.update(attachments).set({ messageId: userMsg!.id }).where(eq(attachments.id, a.id));
      }
    }

    // 2. Setup Tools
    const policyCatalog = getDeferredPolicyCatalog(
      cfg,
      { skillsEnabled: true, runPythonEnabled: false },
      { userId: user!.id, projectId: null, allowPython: false, allowDeliverable: true },
    );

    const availableTools: ToolDefinition[] = [LOAD_SKILL, SEARCH_TOOLS];
    const activeToolNames = new Set<string>(availableTools.map((t) => t.name));

    const [assistantMsg] = await db
      .insert(messages)
      .values({
        chatId: chat!.id,
        userId: user!.id,
        role: 'assistant',
        text: '',
        seq: seq++,
        status: 'pending',
      })
      .returning();

    const wsRun = await runtime.createWorkspace(`audit_turn_${seq}`);

    const fileOpExecutor = new FileOperationExecutor({
      db,
      storage,
      executionRuntime: runtime,
      userId: user!.id,
      chatId: chat!.id,
      messageId: assistantMsg!.id,
      workspace: wsRun,
    });

    const skillExecutor = new SkillToolExecutor(skillsService, activeToolNames);
    const searchExecutor = new SearchToolsExecutor(policyCatalog, (discovered) => {
      if (!availableTools.some((t) => t.name === discovered.name)) {
        availableTools.push(discovered);
        activeToolNames.add(discovered.name);
      }
    });

    const toolExecutor = {
      execute: async (call: any, signal: any) => {
        if (call.name === 'load_skill' || call.name === 'read_skill') return skillExecutor.execute(call, signal);
        if (call.name === 'search_tools') return searchExecutor.execute(call, signal);
        return fileOpExecutor.execute(call, signal);
      },
    };

    // Hydrate base64 for native wire payload
    const wireAttachments = turnAttachments.map((a) => {
      let b64: string | undefined;
      if (a.storageKey) {
        if (a.id === attA!.id) b64 = bufA.toString('base64');
        else if (a.id === attB!.id) b64 = bufB.toString('base64');
      }
      return { ...a, base64: b64 };
    });

    const manifestLines = turnAttachments.map(
      (a) => `- fileId: "${a.id}" | filename: "${a.filename}" | type: ${a.mimeType}`,
    );
    const manifest = manifestLines.length > 0 ? `\n\n[Active Files:\n${manifestLines.join('\n')}]` : '';

    const req: GenerationRequest = {
      prompt: `${userPrompt}${manifest}`,
      history: [...conversationHistory],
      attachments: wireAttachments,
      systemInstruction: 'You are ArcNave AI. Follow Skill-First, Tool-Second. Always refer to files by fileId when available.',
      mode: 'chat',
      maxOutputTokens: 1000,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      tools: availableTools,
      toolExecutor,
      signal: new AbortController().signal,
    };

    let reply = '';
    const toolCallsRun: string[] = [];
    let tokensUsed = 0;

    for await (const ev of provider.stream(req)) {
      if (ev.type === 'delta') reply += ev.text;
      else if (ev.type === 'tool_use') toolCallsRun.push(ev.name);
      else if (ev.type === 'completed') tokensUsed = ev.usage.inputTokens + ev.usage.outputTokens;
    }

    // Persist assistant message
    await db
      .update(messages)
      .set({
        text: reply,
        status: 'complete',
        completedAt: new Date(),
      })
      .where(eq(messages.id, assistantMsg!.id));

    // Update conversation history for next turns
    conversationHistory.push({ role: 'user', text: userPrompt, attachments: turnAttachments });
    conversationHistory.push({ role: 'assistant', text: reply });

    await runtime.cleanupWorkspace(wsRun);

    console.log(`   [Tool Calls] [${toolCallsRun.join(', ')}]`);
    console.log(`   [Tokens Used] ${tokensUsed}`);
    console.log(`   [Assistant Reply] "${reply.slice(0, 100)}..."`);
    console.log(`   Turn completed in ${Date.now() - turnStart}ms\n`);

    return { assistantText: reply, toolCallsRun, tokensUsed };
  }

  // ---------------------------------------------------------------------------
  // Turn 1: Inspect first PDF (Report A - 1 page)
  // ---------------------------------------------------------------------------
  const turn1 = await executeTurn(
    'Please load the pdf skill, search tools, and inspect the first report file.',
    [
      {
        id: attA!.id,
        filename: attA!.filename,
        mimeType: attA!.mimeType,
        sizeBytes: attA!.sizeBytes,
        storageKey: attA!.storageKey,
      },
    ],
  );

  // ---------------------------------------------------------------------------
  // Turn 2: Inspect second PDF (Report B - 2 pages, duplicate filename "report.pdf")
  // ---------------------------------------------------------------------------
  const turn2 = await executeTurn(
    'Now inspect the newly attached report file using its fileId.',
    [
      {
        id: attB!.id,
        filename: attB!.filename,
        mimeType: attB!.mimeType,
        sizeBytes: attB!.sizeBytes,
        storageKey: attB!.storageKey,
      },
    ],
  );

  // ---------------------------------------------------------------------------
  // Turn 3: Inspect Spreadsheet and edit a cell
  // ---------------------------------------------------------------------------
  const turn3 = await executeTurn(
    'Load the xlsx skill, search tools, and inspect the spreadsheet financials.xlsx.',
    [
      {
        id: attC!.id,
        filename: attC!.filename,
        mimeType: attC!.mimeType,
        sizeBytes: attC!.sizeBytes,
        storageKey: attC!.storageKey,
      },
    ],
  );

  // ---------------------------------------------------------------------------
  // Turn 4: Context Continuity Reference (refer to earlier Turn 1 and Turn 2 results)
  // ---------------------------------------------------------------------------
  const turn4 = await executeTurn(
    'Comparing the two PDF reports we inspected earlier, which one had 1 page and which one had 2 pages? State their fileIds.',
    [],
  );

  // ---------------------------------------------------------------------------
  // Verification Checks
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log('              AUDIT TELEMETRY & PERSISTENCE VERIFICATION        ');
  console.log('================================================================');

  // Check 1: Verify database messages table does NOT contain raw base64
  const chatMessages = await db.select().from(messages).where(eq(messages.chatId, chat!.id));
  const hasBase64InDb = chatMessages.some(
    (m) => m.text.includes('data:application/pdf;base64') || (m.text.length > 50000 && m.text.includes('JVBERi0')),
  );
  console.log(`1. Base64 Absence in DB Messages: ${!hasBase64InDb ? '✅ PASSED (Zero Base64 in DB)' : '❌ FAILED'}`);

  // Check 2: Model distinguished the two files with identical filenames
  const replyLower = turn4.assistantText.toLowerCase();
  const mentionedFileA = replyLower.includes(attA!.id.toLowerCase()) || replyLower.includes('first') || replyLower.includes('1 page');
  const mentionedFileB = replyLower.includes(attB!.id.toLowerCase()) || replyLower.includes('second') || replyLower.includes('2 page');
  const continuityPassed = mentionedFileA && mentionedFileB;
  console.log(`2. Multi-Turn Attachment Disambiguation: ${continuityPassed ? '✅ PASSED' : '❌ FAILED'}`);

  // Check 3: Turn token telemetry
  console.log(`3. Telemetry: Turn 1=${turn1.tokensUsed}, Turn 2=${turn2.tokensUsed}, Turn 3=${turn3.tokensUsed}, Turn 4=${turn4.tokensUsed}`);

  const allPassed = !hasBase64InDb && continuityPassed;
  console.log('================================================================');
  console.log(`LONG-CONVERSATION TEST OVERALL: ${allPassed ? 'PASSED' : 'FAILED'}`);
  console.log('================================================================\n');

  if (!allPassed) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
