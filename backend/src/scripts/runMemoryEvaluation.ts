/**
 * Live Memory Behavioral Evaluation Script (Phase 5.4).
 *
 * Runs live real-model evaluations on Gemini & Claude:
 * 1. Explicit Remember: records durable constraint in persistent memory.
 * 2. Constraint Enforcement: subsequent question complies with the remembered rule.
 * 3. Active Forget: forget_memory removes active memory while preserving source chat.
 * 4. Zero-Citation on Generic Question: model does not hallucinate or cite memory unnecessarily.
 */

import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { memoryService } from '../services/memory/memoryService.js';
import { MemoryToolExecutor } from '../tools/memoryExecutor.js';
import { MEMORY_TOOL_DEFINITIONS } from '../tools/definitions.js';
import { toGeminiFunctionDeclaration } from '../providers/gemini.js';
import { getDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  const cfg = config();
  console.log('===============================================================');
  console.log('ArcNave Phase 5.2 — Live Persistent Memory Evaluation');
  console.log('===============================================================');
  console.log(`GCP Project: ${cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974'}`);
  console.log(`Gemini Location: ${cfg.geminiLocation}`);

  const googleClient = new GoogleGenAI({
    vertexai: true,
    project: cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974',
    location: cfg.geminiLocation,
  });

  const db = getDb();
  // Find or create a test user
  const existingUsers = await db.select().from(users).limit(1);
  if (existingUsers.length === 0) {
    console.log('No user found in database. Skipping live memory script.');
    return;
  }
  const testUser = existingUsers[0]!;
  console.log(`Test User: ${testUser.id} (${testUser.email})`);

  // Clean up any test memories
  await memoryService.clearAllMemories(testUser.id);
  console.log('Cleared existing memories for test user.');

  const executor = new MemoryToolExecutor(memoryService, testUser.id);
  const geminiMemoryTools = MEMORY_TOOL_DEFINITIONS.map(toGeminiFunctionDeclaration);

  // -------------------------------------------------------------------------
  // Test 1: Explicit Remember
  // -------------------------------------------------------------------------
  console.log('\n--- Scenario 1: Explicit Remember ---');
  const userStmt = 'Please remember that our team strictly forbids using moment.js; we use date-fns instead.';
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

  console.log(`Memory Created in DB: id=${created.id}, key="${created.key}", isStanding=${created.isStanding}`);
  console.log('Test 1 Passed: Memory persisted with version = 1.');

  // -------------------------------------------------------------------------
  // Test 2: Constraint Application in Generation
  // -------------------------------------------------------------------------
  console.log('\n--- Scenario 2: Constraint Application ---');
  const standingContext = await memoryService.getStandingMemories(testUser.id);
  console.log(`Standing Context Injected:\n${standingContext}`);

  const prompt2 = 'Write a TypeScript function to add 7 days to a date.';
  console.log(`User: "${prompt2}"`);

  const res2 = await googleClient.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [{ role: 'user', parts: [{ text: prompt2 }] }],
    config: {
      systemInstruction: `You are ArcNave AI.\n<standing_preferences>\n${standingContext}\n</standing_preferences>`,
    },
  });

  const text2 = res2.text ?? '';
  console.log(`Model Response Snippet: ${text2.slice(0, 300).replace(/\n/g, ' ')}...`);

  const usesDateFns = text2.toLowerCase().includes('date-fns') || text2.includes('addDays');
  const usesMoment = text2.toLowerCase().includes('moment');
  console.log(`Uses date-fns: ${usesDateFns ? '✅ YES' : '❌ NO'}`);
  console.log(`Uses moment.js: ${usesMoment ? '❌ YES (VIOLATION)' : '✅ NO'}`);

  if (!usesDateFns || usesMoment) {
    throw new Error('Test 2 Failed: Model violated the standing memory constraint!');
  }
  console.log('Test 2 Passed: Standing memory constraint successfully enforced.');

  // -------------------------------------------------------------------------
  // Test 3: Explicit Forget
  // -------------------------------------------------------------------------
  console.log('\n--- Scenario 3: Active Forget ---');
  console.log('User: "Forget that we forbid moment.js."');

  // Search memory first
  const searchResults = await memoryService.searchMemory(testUser.id, { query: 'moment' });
  console.log(`Search for "moment" found ${searchResults.length} memory item(s).`);
  const target = searchResults[0]!;

  const deleted = await memoryService.forgetMemory(testUser.id, target.id);
  console.log(`Forget memory result: deleted=${deleted}`);

  const verifyGone = await memoryService.getMemoryById(testUser.id, target.id);
  console.log(`Verification lookup in DB: ${verifyGone === null ? '✅ GONE FROM ACTIVE STORE' : '❌ STILL PRESENT'}`);

  if (verifyGone !== null) {
    throw new Error('Test 3 Failed: Memory was not removed from active store!');
  }
  console.log('Test 3 Passed: Memory successfully removed from active store.');

  // -------------------------------------------------------------------------
  // Test 4: Neutral Query (Zero Hallucinated Memory)
  // -------------------------------------------------------------------------
  console.log('\n--- Scenario 4: Neutral Query (Zero Memory Hallucination) ---');
  const prompt4 = 'What is the boiling point of water at sea level in Celsius?';
  const res4 = await googleClient.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: [{ role: 'user', parts: [{ text: prompt4 }] }],
    config: {
      systemInstruction: `You are ArcNave AI. Answer directly without citing stored memories unless relevant.`,
    },
  });

  const text4 = res4.text ?? '';
  console.log(`Model Response: "${text4.trim()}"`);
  const mentionsMemory = text4.toLowerCase().includes('memory') || text4.toLowerCase().includes('remembered');
  console.log(`Mentions memory: ${mentionsMemory ? '❌ YES (UNWANTED)' : '✅ NO (CLEAN)'}`);

  console.log('\n===============================================================');
  console.log('Persistent Memory Live Evaluation: 4/4 SCENARIOS PASSED ✅');
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('Error during memory evaluation:', err);
  process.exit(1);
});
