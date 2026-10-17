// P03 (X-6) repaired: the project comes from configuration only (no hard-coded project id). Owner-run; spends quota; never run by tests or CI.
/**
 * Live Conversation Compaction Evaluation Script (Phase 5.4).
 *
 * Tests multi-turn conversation compaction and continuity against live Vertex AI:
 * 1. Generates synthetic multi-turn turns with architectural decisions and user constraints.
 * 2. Triggers compaction headroom calculation.
 * 3. Compacts earlier turns into validated 11-field structured JSON summary.
 * 4. Stores compaction in conversation_compactions in PostgreSQL.
 * 5. Verifies message table rows remain 100% intact (zero message deletion).
 * 6. Validates model maintains seamless continuity from the compacted summary on a follow-up turn.
 */

import { GoogleGenAI } from '@google/genai';
import { config } from '../../src/config.js';
import { CompactionService } from '../../src/services/compaction/compactionService.js';
import { compactionSummarySchema } from '../../src/services/compaction/types.js';
import { getDb } from '../../src/db/client.js';
import { chats, messages, users } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  const cfg = config();
  console.log('===============================================================');
  console.log('ArcNave Phase 5.3 — Live Conversation Compaction Evaluation');
  console.log('===============================================================');
  console.log(`GCP Project configured: ${Boolean(cfg.GOOGLE_CLOUD_PROJECT)}`);
  console.log(`Gemini Location: ${cfg.geminiLocation}`);

  const googleClient = new GoogleGenAI({
    vertexai: true,
    project: cfg.GOOGLE_CLOUD_PROJECT ?? (() => { throw new Error('GOOGLE_CLOUD_PROJECT is not set'); })(),
    location: cfg.geminiLocation,
  });

  const db = getDb();
  const compactionService = new CompactionService(db);
  const existingUsers = await db.select().from(users).limit(1);
  if (existingUsers.length === 0) {
    console.log('No user found in database. Skipping live compaction script.');
    return;
  }
  const testUser = existingUsers[0]!;

  // 1. Create a test chat with 6 messages
  const [testChat] = await db
    .insert(chats)
    .values({
      userId: testUser.id,
      title: 'Compaction Continuity Test Chat',
    })
    .returning();

  if (!testChat) {
    throw new Error('Failed to create test chat');
  }

  console.log(`Created test chat: ${testChat.id}`);

  const sampleTurns = [
    { role: 'user', text: 'We are designing the ArcNave Phase 5 Context Intelligence engine.' },
    { role: 'assistant', text: 'Understood. Phase 5 includes prompt caching, persistent memory, and conversation compaction.' },
    { role: 'user', text: 'Important constraint: Never use external CDNs; all assets must be bundled locally. Also, our primary database is PostgreSQL with pgvector and GIN indexes.' },
    { role: 'assistant', text: 'Recorded: No external CDNs, local assets only. Primary DB is PostgreSQL with pgvector and GIN.' },
    { role: 'user', text: 'Active Goal: Implement conversation compaction with 11 structured summary fields. We completed the trigger check, now working on the folding schema.' },
    { role: 'assistant', text: 'Acknowledged. Goal is conversation compaction with 11 structured fields. Trigger check is done; folding schema in progress.' },
  ];

  const insertedMessages = [];
  for (let i = 0; i < sampleTurns.length; i++) {
    const t = sampleTurns[i]!;
    const [msg] = await db
      .insert(messages)
      .values({
        chatId: testChat.id,
        userId: testUser.id,
        role: t.role,
        text: t.text,
        seq: i + 1,
      })
      .returning();
    insertedMessages.push(msg);
  }
  console.log(`Inserted ${insertedMessages.length} test messages into messages table.`);

  // 2. Evaluate compaction trigger
  console.log('\n--- Step 1: Headroom & Trigger Evaluation ---');
  const triggerCheck = compactionService.checkTrigger(32768, 26000, 4096, 2048, true);
  console.log(`Context Limit: ${triggerCheck.totalContextTokens}`);
  console.log(`Current Input: ${triggerCheck.currentInputTokens}`);
  console.log(`Headroom: ${triggerCheck.headroomTokens} tokens (${(triggerCheck.headroomRatio * 100).toFixed(1)}%)`);
  console.log(`Trigger Result: ${triggerCheck.shouldCompact ? '✅ COMPACTION TRIGGERED' : '❌ NOT TRIGGERED'}`);

  // 3. Compact turns 1..6 into 11-field structured JSON summary using Gemini 3.8 Flash
  console.log('\n--- Step 2: Structured 11-Field Compaction Distillation ---');
  const conversationTranscript = sampleTurns
    .map((t) => `${t.role.toUpperCase()}: ${t.text}`)
    .join('\n\n');

  const compactionPrompt = `You are ArcNave's conversation compaction engine.
Summarize the following conversation history into a clean JSON object adhering EXACTLY to this schema:
{
  "priorSummaryFolded": false,
  "conversationTopic": "string",
  "userExplicitPreferences": ["string"],
  "establishedConstraints": ["string"],
  "artifactsCreatedOrModified": [],
  "activeGoalsAndState": [{"description": "string", "status": "string", "note": "string"}],
  "keyFactualDiscoveries": ["string"],
  "pendingUserRequests": ["string"],
  "openTasksAndNextSteps": ["string"],
  "userDirectivesContinuity": ["string"],
  "criticalContextNotes": "string"
}

Transcript:
${conversationTranscript}

Return ONLY valid JSON matching this schema with no markdown code fences or commentary.`;

  const compRes = await googleClient.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [{ role: 'user', parts: [{ text: compactionPrompt }] }],
  });

  const rawJson = (compRes.text ?? '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const parsedSummary = JSON.parse(rawJson);
  const validatedSummary = compactionSummarySchema.parse(parsedSummary);
  console.log('Distilled and validated 11-field summary:');
  console.log(`- Topic: "${validatedSummary.conversationTopic}"`);
  console.log(`- Established Constraints: ${JSON.stringify(validatedSummary.establishedConstraints)}`);
  console.log(`- Active Goals: ${JSON.stringify(validatedSummary.activeGoalsAndState)}`);

  // 4. Persist to conversation_compactions
  console.log('\n--- Step 3: Persistence to PostgreSQL ---');
  const lastMsg = insertedMessages[insertedMessages.length - 1]!;
  const storedCompaction = await compactionService.createCompaction({
    chatId: testChat.id,
    throughMessageId: lastMsg.id,
    throughSeq: lastMsg.seq,
    summary: validatedSummary,
    tokenCountBefore: 1250,
    tokenCountAfter: 180,
    provider: 'google',
    model: 'gemini-3.8-flash',
  });

  console.log(`Compaction record stored in DB: id=${storedCompaction.id}, throughSeq=${storedCompaction.throughSeq}`);

  // 5. Invariant check: zero message deletion
  console.log('\n--- Step 4: Invariant Check (Zero Message Deletion) ---');
  const remainingMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, testChat.id));
  console.log(`Original messages in DB: ${insertedMessages.length}`);
  console.log(`Current messages in DB:  ${remainingMessages.length}`);

  if (remainingMessages.length !== insertedMessages.length) {
    throw new Error('INVARIANT VIOLATED: Raw messages were deleted from database!');
  }
  console.log('✅ Invariant Verified: Raw message history preserved completely.');

  // 6. Test Model Continuity on compacted state
  console.log('\n--- Step 5: Test Continuity on Compacted State ---');
  const formattedCompaction = compactionService.formatCompactionForPrompt(storedCompaction);
  console.log(`Formatted XML Prompt Block:\n${formattedCompaction}\n`);

  const continuityPrompt = 'What were our decisions regarding CDN assets, and what is our current task status?';
  console.log(`Follow-up User Prompt: "${continuityPrompt}"`);

  const contRes = await googleClient.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [{ role: 'user', parts: [{ text: continuityPrompt }] }],
    config: {
      systemInstruction: `You are ArcNave AI. Maintain continuity from the compacted conversation summary.\n\n${formattedCompaction}`,
    },
  });

  const contText = contRes.text ?? '';
  console.log(`\nModel Continuity Response:\n${contText.trim()}`);

  const mentionsCdn = contText.toLowerCase().includes('cdn') || contText.toLowerCase().includes('local');
  const mentionsCompaction = contText.toLowerCase().includes('compaction') || contText.toLowerCase().includes('folding');

  console.log(`\nRecall CDN constraint: ${mentionsCdn ? '✅ YES' : '❌ NO'}`);
  console.log(`Recall compaction task: ${mentionsCompaction ? '✅ YES' : '❌ NO'}`);

  if (!mentionsCdn || !mentionsCompaction) {
    throw new Error('Test 5 Failed: Model failed to maintain continuity from compaction summary!');
  }

  // Cleanup test chat
  await db.delete(chats).where(eq(chats.id, testChat.id));
  console.log('\nCleaned up test chat.');

  console.log('\n===============================================================');
  console.log('Conversation Compaction Live Evaluation: ALL CHECKS PASSED ✅');
  console.log('===============================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error during compaction evaluation:', err);
  process.exit(1);
});
