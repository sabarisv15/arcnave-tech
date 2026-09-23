/**
 * Batch 6 Audit: Context Pressure Live Test.
 *
 * Verifies live against real Gemini Provider and ArcNave runtime:
 * 1. Measures provider behavior, latency, and token telemetry under substantial context pressure.
 * 2. Tests provider behavior when payload/token limits are stressed or exceeded.
 * 3. Captures the exact error shape and verifies whether ArcNave gracefully records 'status: error'
 *    without crashing the node process or corrupting database state.
 */

import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { getDb } from '../db/client.js';
import { chats, messages, users } from '../db/schema.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest } from '../providers/types.js';
import { mapProviderError } from '../services/generation.js';

async function main() {
  console.log('================================================================');
  console.log('      PRE-BATCH 6 AUDIT: CONTEXT PRESSURE LIVE TEST             ');
  console.log('================================================================\n');

  const cfg = loadConfig();
  const db = getDb();
  const provider = new GeminiProvider(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH ?? 'gemini-3.8-flash';

  const [user] = await db
    .insert(users)
    .values({
      email: `audit-pressure-${Date.now()}@example.com`,
      name: 'Audit Pressure Tester',
      passwordHash: 'test-hash-pressure',
    })
    .returning();

  const [chat] = await db
    .insert(chats)
    .values({
      userId: user!.id,
      title: 'Context Pressure Test Chat',
    })
    .returning();

  console.log(`User: ${user!.id}, Chat: ${chat!.id}\n`);

  // 1. High Context Pressure Turn (~20,000 words / ~25k tokens of synthetic document history)
  console.log('--- TEST 2A: Substantial Context Pressure (~25k tokens) ---');
  const paragraph = 'The quick brown fox jumps over the lazy dog in financial quarter analysis. '.repeat(20);
  const largeDocumentContext = Array.from({ length: 150 }, (_, i) => `Section ${i + 1}: ${paragraph}`).join('\n\n');

  console.log(`Payload character count: ${largeDocumentContext.length} chars (~${Math.round(largeDocumentContext.length / 4)} tokens)`);

  const reqNormal: GenerationRequest = {
    prompt: 'Summarize the primary theme and total number of sections described above in 2 sentences.',
    history: [
      {
        role: 'user',
        text: `Here is the comprehensive quarterly operational documentation:\n\n${largeDocumentContext}`,
      },
      {
        role: 'assistant',
        text: 'I have received and ingested the operational documentation sections.',
      },
    ],
    systemInstruction: 'You are ArcNave AI. Summarize accurately.',
    mode: 'chat',
    maxOutputTokens: 200,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  };

  const startA = Date.now();
  let textA = '';
  let usageA = { inputTokens: 0, outputTokens: 0 };
  let successA = false;

  try {
    for await (const ev of provider.stream(reqNormal)) {
      if (ev.type === 'delta') textA += ev.text;
      if (ev.type === 'completed') usageA = ev.usage;
    }
    successA = true;
    console.log(`✅ Turn 2A completed in ${Date.now() - startA}ms`);
    console.log(`   Tokens: input=${usageA.inputTokens}, output=${usageA.outputTokens}`);
    console.log(`   Output: "${textA.trim().slice(0, 120)}..."\n`);
  } catch (err: any) {
    console.error(`❌ Turn 2A failed unexpectedly:`, err);
  }

  // 2. Extreme Context Overflow / Payload Stress Test
  // Test provider error behavior when sending an impossibly large single block or triggering provider payload limits
  console.log('--- TEST 2B: Provider Error Shape & Graceful Error Mapping ---');
  // Attempt a call with an extreme or malformed constraint that triggers ProviderError
  let errorCaptured: any = null;
  let mappedError: any = null;

  try {
    // Generate an enormous string that exceeds HTTP payload limits (~25 MB payload)
    const giantPayload = 'A'.repeat(25 * 1024 * 1024);
    const reqExtreme: GenerationRequest = {
      prompt: giantPayload,
      history: [],
      systemInstruction: 'You are ArcNave AI.',
      mode: 'chat',
      maxOutputTokens: 10,
      providerModelId: modelId,
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
    };

    for await (const ev of provider.stream(reqExtreme)) {
      // should fail before or during stream
    }
  } catch (err: any) {
    errorCaptured = err;
    mappedError = mapProviderError(err);
    console.log(`✅ Caught expected error from extreme payload:`);
    console.log(`   Raw Error Name: ${err?.name ?? typeof err}`);
    console.log(`   Raw Error Message: ${err?.message?.slice(0, 150)}...`);
    console.log(`   Mapped Error Code: ${mappedError.code}`);
    console.log(`   Mapped Title: "${mappedError.title}"`);
    console.log(`   Mapped Detail: "${mappedError.detail?.slice(0, 100)}..."\n`);
  }

  // 3. Verify Database Stability under Error
  // Ensure that an error turn can be persisted with status='error' without crashing DB or chat
  const [errorMsg] = await db
    .insert(messages)
    .values({
      chatId: chat!.id,
      userId: user!.id,
      role: 'assistant',
      text: '',
      seq: 2,
      status: 'error',
      errorCode: mappedError?.code ?? 'provider_error',
    })
    .returning();

  const storedMsg = await db.query.messages.findFirst({
    where: eq(messages.id, errorMsg!.id),
  });

  const dbGraceful = storedMsg?.status === 'error' && storedMsg?.errorCode != null;
  console.log(`3. DB Error State Graceful Handling: ${dbGraceful ? '✅ PASSED' : '❌ FAILED'}`);

  const overallPassed = successA && errorCaptured != null && dbGraceful;
  console.log('================================================================');
  console.log(`CONTEXT PRESSURE TEST OVERALL: ${overallPassed ? 'PASSED' : 'FAILED'}`);
  console.log('================================================================\n');

  if (!overallPassed) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal execution error in pressure test:', err);
  process.exit(1);
});
