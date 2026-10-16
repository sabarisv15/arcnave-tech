/**
 * ArcNave Phase 5.3 — Claude Live Conversation Compaction E2E (Vertex AI).
 *
 * Validates conversation compaction and continuity on Claude Sonnet 5:
 * 1. Inserts multi-turn long-task conversation history with constraints and active goals into PostgreSQL.
 * 2. Evaluates compaction headroom trigger.
 * 3. Compacts earlier turns into a validated 11-field structured JSON summary using Claude Sonnet 5.
 * 4. Persists the compaction record in PostgreSQL conversation_compactions table.
 * 5. Verifies database invariant: zero raw messages deleted.
 * 6. Validates Claude maintains seamless task continuity on a follow-up turn using only the compacted summary.
 */

import { createAnthropicClient } from '../providers/anthropic.js';
import { config } from '../config.js';
import { compactionService } from '../services/compaction/compactionService.js';
import { compactionSummarySchema } from '../services/compaction/types.js';
import { getDb } from '../db/client.js';
import { chats, messages, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  const cfg = config();
  const model = cfg.MODEL_SONNET || 'claude-sonnet-5';

  console.log('===============================================================');
  console.log('ArcNave Phase 5.3 — Claude Live Conversation Compaction E2E');
  console.log('===============================================================');
  console.log(`Endpoint:           Claude API (first party)`);
  console.log(`Model:              ${model}\n`);

  const client = createAnthropicClient(config());

  const db = getDb();
  const existingUsers = await db.select().from(users).limit(1);
  if (existingUsers.length === 0) {
    throw new Error('No user found in database for testing.');
  }
  const testUser = existingUsers[0]!;

  // 1. Create a test chat with 6 messages
  const [testChat] = await db
    .insert(chats)
    .values({
      userId: testUser.id,
      title: 'Claude Compaction Continuity Test Chat',
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
  console.log(`Inserted ${insertedMessages.length} test messages into PostgreSQL messages table.`);

  // 2. Evaluate compaction trigger
  console.log('\n--- Step 1: Headroom & Trigger Evaluation ---');
  const triggerCheck = compactionService.checkTrigger(32768, 26000, 4096, 2048, true);
  console.log(`Context Limit:  ${triggerCheck.totalContextTokens}`);
  console.log(`Current Input:  ${triggerCheck.currentInputTokens}`);
  console.log(`Headroom:       ${triggerCheck.headroomTokens} tokens (${(triggerCheck.headroomRatio * 100).toFixed(1)}%)`);
  console.log(`Trigger Result: ${triggerCheck.shouldCompact ? '✅ COMPACTION TRIGGERED' : '❌ NOT TRIGGERED'}`);

  // 3. Compact turns 1..6 into 11-field structured JSON summary using Claude Sonnet 5
  console.log('\n--- Step 2: Structured 11-Field Compaction Distillation (Claude) ---');
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

  const compRes = await client.messages.create({
    model,
    max_tokens: 1500,
    messages: [{ role: 'user', content: compactionPrompt }],
  });

  const compText = compRes.content
    .filter((c) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');

  const rawJson = compText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const parsedSummary = JSON.parse(rawJson);
  const validatedSummary = compactionSummarySchema.parse(parsedSummary);
  console.log('Distilled and validated 11-field summary by Claude:');
  console.log(`- Topic: "${validatedSummary.conversationTopic}"`);
  console.log(`- Established Constraints: ${JSON.stringify(validatedSummary.establishedConstraints)}`);
  console.log(`- Active Goals: ${JSON.stringify(validatedSummary.activeGoalsAndState)}`);
  console.log('✅ Step 2 Passed: 11-field structured schema parsed and validated.\n');

  // 4. Persist to conversation_compactions
  console.log('--- Step 3: Persistence to PostgreSQL ---');
  const lastMsg = insertedMessages[insertedMessages.length - 1]!;
  const storedCompaction = await compactionService.createCompaction({
    chatId: testChat.id,
    throughMessageId: lastMsg.id,
    throughSeq: lastMsg.seq,
    summary: validatedSummary,
    tokenCountBefore: 1250,
    tokenCountAfter: 180,
    provider: 'anthropic',
    model,
  });

  console.log(`Compaction record stored in DB: id=${storedCompaction.id}, throughSeq=${storedCompaction.throughSeq}`);
  console.log('✅ Step 3 Passed: Compaction record persisted in PostgreSQL.\n');

  // 5. Invariant check: zero message deletion
  console.log('--- Step 4: Invariant Check (Zero Message Deletion) ---');
  const remainingMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, testChat.id));
  console.log(`Original messages in DB: ${insertedMessages.length}`);
  console.log(`Current messages in DB:  ${remainingMessages.length}`);

  if (remainingMessages.length !== insertedMessages.length) {
    throw new Error('INVARIANT VIOLATED: Raw messages were deleted from database!');
  }
  console.log('✅ Step 4 Passed: Raw message history preserved completely (0 rows deleted).\n');

  // 6. Test Model Continuity on compacted state using Claude
  console.log('--- Step 5: Test Continuity on Compacted State (Claude) ---');
  const formattedCompaction = compactionService.formatCompactionForPrompt(storedCompaction);
  console.log(`Formatted XML Prompt Block:\n${formattedCompaction}\n`);

  const continuityPrompt = 'What were our decisions regarding CDN assets, and what is our current task status?';
  console.log(`Follow-up User Prompt: "${continuityPrompt}"`);

  const contRes = await client.messages.create({
    model,
    max_tokens: 500,
    system: `You are ArcNave AI. Maintain continuity from the compacted conversation summary.\n\n${formattedCompaction}`,
    messages: [{ role: 'user', content: continuityPrompt }],
  });

  const contText = contRes.content
    .filter((c) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
  console.log(`\nClaude Continuity Response:\n${contText.trim()}`);

  const mentionsCdn = contText.toLowerCase().includes('cdn') || contText.toLowerCase().includes('local');
  const mentionsCompaction = contText.toLowerCase().includes('compaction') || contText.toLowerCase().includes('folding');

  console.log(`\nRecall CDN constraint: ${mentionsCdn ? '✅ YES' : '❌ NO'}`);
  console.log(`Recall compaction task: ${mentionsCompaction ? '✅ YES' : '❌ NO'}`);

  if (!mentionsCdn || !mentionsCompaction) {
    throw new Error('Step 5 Failed: Claude failed to maintain continuity from compaction summary!');
  }
  console.log('✅ Step 5 Passed: Claude maintained seamless task continuity from compaction summary.\n');

  // Cleanup test chat
  await db.delete(chats).where(eq(chats.id, testChat.id));
  console.log('Cleaned up test chat.');

  console.log('\n===============================================================');
  console.log('Claude Conversation Compaction E2E: ALL CHECKS PASSED ✅');
  console.log('===============================================================');
  setTimeout(() => process.exit(0), 50);
}

main().catch((err) => {
  console.error('Fatal error during Claude compaction evaluation:', err);
  process.exit(1);
});
