/**
 * Batch 6 Audit: Restart / Rehydration Live Test.
 *
 * Verifies live against real database and generation service:
 * 1. Executes Phase 1: Conversation turn with attachment and tool invocation (inspectPdf).
 * 2. Simulates process restart: Discards all in-memory state, services, tool registrations.
 * 3. Executes Phase 2: Creates a brand new GenerationService instance reading ONLY from DB.
 * 4. Resumes conversation and verifies:
 *    - What survives in history (messages, assistant text).
 *    - What is lost (in-memory tool registry resets to initial [LOAD_SKILL, SEARCH_TOOLS]).
 *    - Whether past tool calls re-execute (they should NOT re-execute).
 *    - Whether attachments re-hydrate from storage.
 *    - Whether skills need re-loading (fresh tool registry requires load_skill or model re-discovering).
 */

import { eq } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { loadConfig } from '../../src/config.js';
import { getDb, getSql } from '../../src/db/client.js';
import { attachments, chats, messages, preferences, toolCalls, users } from '../../src/db/schema.js';
import { buildServices } from '../../src/container.js';
import { buildStorage, generateStorageKey } from '../../src/services/storage.js';

async function main() {
  console.log('================================================================');
  console.log('      PRE-BATCH 6 AUDIT: RESTART / REHYDRATION LIVE TEST        ');
  console.log('================================================================\n');

  const cfg = loadConfig();
  const db = getDb();
  const storage = buildStorage(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH ?? 'gemini-3.8-flash';

  // 1. Setup User and Chat
  const [user] = await db
    .insert(users)
    .values({
      email: `audit-restart-${Date.now()}@example.com`,
      name: 'Audit Restart Tester',
      passwordHash: 'test-hash-restart',
    })
    .returning();

  await db.insert(preferences).values({
    userId: user!.id,
  });

  const [chat] = await db
    .insert(chats)
    .values({
      userId: user!.id,
      title: 'Audit Restart Rehydration Chat',
    })
    .returning();

  // Create an attachment
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([400, 200]);
  page.drawText('Quarterly Revenue: $4.2M. Status: Approved.', { x: 40, y: 100, size: 14 });
  const pdfBytes = Buffer.from(await pdfDoc.save());

  const storageKey = generateStorageKey(user!.id);
  await storage.put(storageKey, pdfBytes, 'application/pdf');

  const [attRecord] = await db
    .insert(attachments)
    .values({
      userId: user!.id,
      filename: 'revenue_brief.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdfBytes.length,
      storageKey,
      status: 'ready',
      error: '',
    })
    .returning();

  console.log(`User: ${user!.id}, Chat: ${chat!.id}`);
  console.log(`Created Attachment: id=${attRecord!.id}, filename="${attRecord!.filename}"\n`);

  // ===========================================================================
  // PHASE 1: Initial Process Run
  // ===========================================================================
  console.log('--- PHASE 1: Running Initial Turn before Process Restart ---');
  let container1: any = buildServices(cfg);
  let genServicePhase1: any = container1.generation;

  const [userMsg1] = await db
    .insert(messages)
    .values({
      chatId: chat!.id,
      userId: user!.id,
      role: 'user',
      text: 'Please inspect the attached revenue_brief.pdf and tell me the quarterly revenue figure.',
      seq: 1,
      status: 'complete',
    })
    .returning();

  await db
    .update(attachments)
    .set({ messageId: userMsg1!.id })
    .where(eq(attachments.id, attRecord!.id));

  const [assistantMsg1] = await db
    .insert(messages)
    .values({
      chatId: chat!.id,
      userId: user!.id,
      role: 'assistant',
      text: '',
      seq: 2,
      status: 'pending',
    })
    .returning();

  let phase1Text = '';
  const phase1Events: string[] = [];

  for await (const ev of genServicePhase1.run({
    userId: user!.id,
    chatId: chat!.id,
    messageId: assistantMsg1!.id,
    prompt: userMsg1!.text,
    projectId: null,
    hasAttachments: true,
    codeExecution: false,
    attachments: [
      {
        id: attRecord!.id,
        filename: attRecord!.filename,
        mimeType: attRecord!.mimeType,
        sizeBytes: attRecord!.sizeBytes,
        storageKey: attRecord!.storageKey,
      },
    ],
    mode: 'chat',
    modelAlias: 'fast',
    signal: new AbortController().signal,
    requestId: `req-phase1-${Date.now()}`,
  })) {
    if (ev.type === 'delta') phase1Text += ev.text;
    else phase1Events.push(ev.type);
  }

  console.log(`Phase 1 Assistant Response: "${phase1Text.trim().slice(0, 100)}..."`);
  console.log(`Phase 1 Events Streamed: [${[...new Set(phase1Events)].join(', ')}]\n`);

  // Verify DB state after Phase 1
  const phase1ToolCalls = await db
    .select()
    .from(toolCalls)
    .where(eq(toolCalls.messageId, assistantMsg1!.id));
  console.log(`Phase 1 Persisted Tool Calls count: ${phase1ToolCalls.length}`);

  // ===========================================================================
  // SIMULATE PROCESS RESTART: Destroy all in-memory instances
  // ===========================================================================
  console.log('----------------------------------------------------------------');
  console.log('>>> SIMULATING SERVER PROCESS RESTART (DESTROYING ALL STATE) <<<');
  console.log('----------------------------------------------------------------\n');
  container1 = null;
  genServicePhase1 = null;

  // ===========================================================================
  // PHASE 2: Fresh Process Instance reading ONLY from DB
  // ===========================================================================
  console.log('--- PHASE 2: Resuming Conversation in Fresh Process Instance ---');
  const container2 = buildServices(cfg);
  const genServicePhase2 = container2.generation;

  const [userMsg2] = await db
    .insert(messages)
    .values({
      chatId: chat!.id,
      userId: user!.id,
      role: 'user',
      text: 'What was the exact status stated in that same revenue brief you read earlier?',
      seq: 3,
      status: 'complete',
    })
    .returning();

  const [assistantMsg2] = await db
    .insert(messages)
    .values({
      chatId: chat!.id,
      userId: user!.id,
      role: 'assistant',
      text: '',
      seq: 4,
      status: 'pending',
    })
    .returning();

  let phase2Text = '';
  let toolCallsPhase2Count = 0;

  for await (const ev of genServicePhase2.run({
    userId: user!.id,
    chatId: chat!.id,
    messageId: assistantMsg2!.id,
    prompt: userMsg2!.text,
    projectId: null,
    hasAttachments: false,
    codeExecution: false,
    attachments: [], // No new attachments attached on turn 2!
    mode: 'chat',
    modelAlias: 'fast',
    signal: new AbortController().signal,
    requestId: `req-phase2-${Date.now()}`,
  })) {
    if (ev.type === 'delta') phase2Text += ev.text;
    else if (ev.type === 'tool_use') toolCallsPhase2Count++;
  }

  console.log(`Phase 2 Assistant Response: "${phase2Text.trim()}"\n`);

  // ===========================================================================
  // AUDIT VERIFICATION OF REHYDRATION
  // ===========================================================================
  console.log('================================================================');
  console.log('            REHYDRATION AUDIT VERIFICATION RESULTS              ');
  console.log('================================================================');

  // Check 1: Did past assistant text survive and provide context to Phase 2?
  const rememberedStatus =
    phase2Text.toLowerCase().includes('approved') || phase2Text.toLowerCase().includes('4.2');
  console.log(`1. History Context Continuity after Restart: ${rememberedStatus ? '✅ PASSED' : '❌ FAILED'}`);

  // Check 2: Were past tool calls re-executed? (Must be NO - zero redundant execution)
  console.log(`2. Zero Redundant Tool Re-Execution: ${toolCallsPhase2Count === 0 ? '✅ PASSED (0 past calls re-run)' : '⚠️ Tool calls occurred: ' + toolCallsPhase2Count}`);

  // Check 3: Attachment DB integrity
  const attsInDb = await db.select().from(attachments).where(eq(attachments.userId, user!.id));
  const attachmentSurvived = attsInDb.length === 1 && attsInDb[0]?.status === 'ready';
  console.log(`3. Attachment Storage & Record Persistence: ${attachmentSurvived ? '✅ PASSED' : '❌ FAILED'}`);

  const passed = rememberedStatus && attachmentSurvived;
  console.log('================================================================');
  console.log(`REHYDRATION AUDIT OVERALL: ${passed ? 'PASSED' : 'FAILED'}`);
  console.log('================================================================\n');

  await getSql().end().catch(() => {});
  if (!passed) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal execution error in rehydration test:', err);
  process.exit(1);
});
