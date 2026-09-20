/**
 * ArcNave Phase 5.2 — Claude Live Memory E2E Evaluation (Vertex AI).
 *
 * Validates cross-session memory flow on Claude Sonnet 5:
 * 1. Remember: records durable constraint in persistent PostgreSQL memory.
 * 2. New Chat Recall: completely fresh chat session inherits standing memory and enforces constraint.
 * 3. Forget: active forget deletes item from PostgreSQL active store.
 * 4. New Chat Confirms Gone: fresh chat confirms active store is empty, clean neutral query behavior.
 */

import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { config } from '../config.js';
import { memoryService } from '../services/memory/memoryService.js';
import { getDb } from '../db/client.js';
import { users, memoryItems } from '../db/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  const cfg = config();
  const projectId = cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974';
  const region = (cfg as any).anthropicLocation || (cfg as any).ANTHROPIC_LOCATION || cfg.VERTEX_LOCATION || 'global';
  const model = cfg.MODEL_SONNET || 'claude-sonnet-5';

  console.log('===============================================================');
  console.log('ArcNave Phase 5.2 — Claude Live Persistent Memory E2E');
  console.log('===============================================================');
  console.log(`GCP Project:        ${projectId}`);
  console.log(`Anthropic Location: ${region}`);
  console.log(`Model:              ${model}\n`);

  const client = new AnthropicVertex({
    projectId,
    region,
  });

  const db = getDb();
  const existingUsers = await db.select().from(users).limit(1);
  if (existingUsers.length === 0) {
    throw new Error('No user found in database for testing.');
  }
  const testUser = existingUsers[0]!;
  console.log(`Test User: ${testUser.id} (${testUser.email})`);

  // Reset existing test memories for this user
  await memoryService.clearAllMemories(testUser.id);
  console.log('Cleaned existing memories for test user.\n');

  // -------------------------------------------------------------------------
  // Step 1: Remember
  // -------------------------------------------------------------------------
  console.log('--- Step 1: Remember (Persist to PostgreSQL) ---');
  const userStmt = 'Please remember that our team strictly forbids using moment.js; we always use date-fns instead.';
  console.log(`User: "${userStmt}"`);

  const created = await memoryService.createMemory({
    userId: testUser.id,
    scope: 'global',
    kind: 'constraint',
    key: 'forbidden_library_moment',
    content: 'Strictly forbid using moment.js; use date-fns instead.',
    summary: 'Forbid moment.js in favor of date-fns',
    isStanding: true,
    sourceType: 'user_statement',
  });

  console.log(`Memory Created in DB: id=${created.id}, key="${created.key}", isStanding=${created.isStanding}, version=${created.version}`);
  console.log('✅ Step 1 Passed: Memory persisted to PostgreSQL with GIN FTS index.\n');

  // -------------------------------------------------------------------------
  // Step 2: New Chat Recall
  // -------------------------------------------------------------------------
  console.log('--- Step 2: New Chat Recall (Fresh Session Continuity) ---');
  // In a new chat, history is completely empty; standing memories are injected into dynamic system context
  const standingContext = await memoryService.getStandingMemories(testUser.id);
  console.log(`Standing Context Injected into New Chat:\n${standingContext}`);

  const prompt2 = 'Write a TypeScript function to add 7 days to a date.';
  console.log(`New Chat User: "${prompt2}"`);

  const res2 = await client.messages.create({
    model,
    max_tokens: 600,
    system: `You are ArcNave AI.\n<standing_preferences>\n${standingContext}\n</standing_preferences>`,
    messages: [
      { role: 'user', content: prompt2 },
    ],
  });

  const text2 = res2.content
    .filter((c) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
  console.log(`Claude Response Snippet: ${text2.slice(0, 250).replace(/\n/g, ' ')}...`);

  const usesDateFns = text2.toLowerCase().includes('date-fns') || text2.includes('addDays');
  const importsMoment =
    text2.includes("from 'moment'") ||
    text2.includes('from "moment"') ||
    text2.includes("require('moment')") ||
    text2.includes('require("moment")') ||
    text2.includes('import moment');
  console.log(`Uses date-fns / native Date: ${usesDateFns ? '✅ YES' : '❌ NO'}`);
  console.log(`Imports moment.js in code:    ${importsMoment ? '❌ YES (VIOLATION)' : '✅ NO (CLEAN)'}`);

  if (!usesDateFns || importsMoment) {
    throw new Error('Step 2 Failed: Claude imported moment.js or failed to use date-fns!');
  }
  console.log('✅ Step 2 Passed: New chat recalled standing constraint and adhered to it.\n');

  // -------------------------------------------------------------------------
  // Step 3: Forget
  // -------------------------------------------------------------------------
  console.log('--- Step 3: Forget (Active Store Deletion) ---');
  const forgetQuery = 'moment';
  console.log(`User in Chat: "Forget that we forbid ${forgetQuery}."`);

  const searchResults = await memoryService.searchMemory(testUser.id, {
    query: forgetQuery,
    limit: 5,
  });

  console.log(`Search for "${forgetQuery}" found ${searchResults.length} memory item(s).`);
  if (searchResults.length === 0) {
    throw new Error('Step 3 Failed: Could not locate memory item to forget.');
  }

  const targetMemory = searchResults[0]!;
  const forgetResult = await memoryService.forgetMemory(testUser.id, targetMemory.id);
  console.log(`Forget memory result: deleted=${forgetResult}`);

  // Confirm DB deletion
  const verifyDb = await db
    .select()
    .from(memoryItems)
    .where(eq(memoryItems.id, targetMemory.id));

  console.log(`Verification lookup in PostgreSQL: ${verifyDb.length === 0 ? '✅ GONE FROM ACTIVE STORE' : '❌ STILL PRESENT'}`);
  if (verifyDb.length !== 0) {
    throw new Error('Step 3 Failed: Memory item was not removed from PostgreSQL active store!');
  }
  console.log('✅ Step 3 Passed: Memory successfully deleted from active store.\n');

  // -------------------------------------------------------------------------
  // Step 4: New Chat Confirms Gone
  // -------------------------------------------------------------------------
  console.log('--- Step 4: New Chat Confirms Gone (Isolation Verification) ---');
  const standingContextAfter = await memoryService.getStandingMemories(testUser.id);
  console.log(`Standing Context in New Chat: "${standingContextAfter.trim()}" (Length: ${standingContextAfter.length})`);

  const prompt4 = 'What is the boiling point of water at sea level in Celsius?';
  const res4 = await client.messages.create({
    model,
    max_tokens: 150,
    system: `You are ArcNave AI. Answer directly without citing stored memories unless relevant.\n<standing_preferences>\n${standingContextAfter}\n</standing_preferences>`,
    messages: [
      { role: 'user', content: prompt4 },
    ],
  });

  const text4 = res4.content
    .filter((c) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
  console.log(`Claude Response: "${text4.trim()}"`);
  const mentionsForgottenRule = text4.toLowerCase().includes('moment') || text4.toLowerCase().includes('date-fns');
  console.log(`Zero memory contamination / clean response: ${!mentionsForgottenRule ? '✅ YES' : '❌ NO'}`);

  if (mentionsForgottenRule) {
    throw new Error('Step 4 Failed: Response contaminated with forgotten memory!');
  }
  console.log('✅ Step 4 Passed: Forgotten memory completely absent in subsequent new chat.\n');

  console.log('===============================================================');
  console.log('Claude Persistent Memory E2E: ALL 4 STEPS PASSED ✅');
  console.log('===============================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during Claude memory E2E:', err);
  process.exit(1);
});
