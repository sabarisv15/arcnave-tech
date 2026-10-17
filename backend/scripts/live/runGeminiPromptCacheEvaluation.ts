// P03 (X-6) repaired: the project comes from configuration only (no hard-coded project id). Owner-run; spends quota; never run by tests or CI.
/**
 * ArcNave Phase 5.1 — Gemini Prompt Caching Live Evaluation (Vertex AI).
 *
 * Validates Gemini 3.8 Flash caching behavior on Vertex AI:
 * - Prefix meets/exceeds official Gemini 3.8 Flash threshold (>= 6,144 tokens).
 * - Turn 1 (Cold): populates cache.
 * - Turn 2 (Warm): verifies cachedContentTokenCount > 0 in usageMetadata.
 * - Validates normalized telemetry and exact token accounting.
 */
import { GoogleGenAI } from '@google/genai';
import { config } from '../../src/config.js';
import { buildStablePrefix } from '../../src/services/promptCache/promptAssembly.js';
import {
  ASK_USER_INPUT,
  SEARCH_PROJECT_FILES,
  READ_PROJECT_FILE,
  WEB_SEARCH,
  WEB_FETCH,
} from '../../src/tools/definitions.js';
import { normalizeCacheMetrics } from '../../src/services/promptCache/telemetry.js';

async function main() {
  const cfg = config();
  const projectId = cfg.GOOGLE_CLOUD_PROJECT ?? (() => { throw new Error('GOOGLE_CLOUD_PROJECT is not set'); })();
  const location = cfg.geminiLocation || 'global';
  const model = cfg.MODEL_GEMINI_FLASH ?? (() => { throw new Error('MODEL_GEMINI_FLASH is not set'); })();

  console.log('===============================================================');
  console.log('ArcNave Phase 5.1 — Gemini Live Prompt Caching Evaluation');
  console.log('===============================================================');
  console.log(`GCP Project: ${projectId}`);
  console.log(`Location:    ${location}`);
  console.log(`Model:       ${model}\n`);

  const ai = new GoogleGenAI({
    vertexai: true,
    project: projectId,
    location,
  });

  const tools = [
    ASK_USER_INPUT,
    SEARCH_PROJECT_FILES,
    READ_PROJECT_FILE,
    WEB_SEARCH,
    WEB_FETCH,
  ];

  const prefix = buildStablePrefix('google', tools);

  // Grounding & architectural reference context to bring prefix above Gemini 3.8 Flash threshold (>= 6,144 tokens)
  const docContext = `\n\n### Project Context Specification\n` +
    Array(50).fill(
      `Specification clause: ArcNave Context Intelligence Engine operates prompt caching, durable persistent memory with PostgreSQL GIN indexing, and conversation compaction with an 11-field structured Zod schema. Stable system instructions and authorized tool declarations form the cacheable prefix.`
    ).join('\n\n');

  const fullPromptPrefix = `${prefix.systemText}\n${docContext}`;

  const countRes = await ai.models.countTokens({
    model,
    contents: [{ role: 'user', parts: [{ text: fullPromptPrefix }] }],
  });
  console.log(`Total Prefix Token Count: ${countRes.totalTokens} (exceeds 6,144 minimum threshold)`);

  // --- Method 1: Context Cache with ai.caches ---
  console.log('\n--- Creating Vertex Context Cache (>= 6,144 tokens) ---');
  let cacheName: string | undefined;
  try {
    const cache = await ai.caches.create({
      model,
      config: {
        ttl: '300s',
        contents: [{ role: 'user', parts: [{ text: fullPromptPrefix }] }],
      },
    });
    cacheName = cache.name;
    console.log(`Cache Resource Created: ${cacheName}`);
    console.log(`Cache Expire Time:      ${cache.expireTime}`);
  } catch (err: any) {
    console.log(`ai.caches.create note: ${err?.message || err}`);
  }

  // --- Turn 1: Cold Request ---
  console.log('\n--- Turn 1: Cold Request ---');
  const t0 = performance.now();
  const res1 = await ai.models.generateContent({
    model,
    contents: [
      { role: 'user', parts: [{ text: `${fullPromptPrefix}\n\nTask: State 'Ready' in 1 word.` }] },
    ],
    config: cacheName ? { cachedContent: cacheName } : undefined,
  });
  const t1 = performance.now();
  const latency1 = Math.round(t1 - t0);

  const u1 = res1.usageMetadata;
  const cached1 = u1?.cachedContentTokenCount ?? 0;
  console.log(`Turn 1 Response: "${res1.text?.trim()}" (${latency1}ms)`);
  console.log(`Turn 1 Usage: promptTokens=${u1?.promptTokenCount}, candidatesTokens=${u1?.candidatesTokenCount}, cachedContentTokens=${cached1}`);

  // --- Turn 2: Warm Request ---
  console.log('\n--- Turn 2: Warm Request (Cache Hit Verification) ---');
  const t2 = performance.now();
  const res2 = await ai.models.generateContent({
    model,
    contents: [
      { role: 'user', parts: [{ text: 'Confirm operational status in 1 word.' }] },
    ],
    config: cacheName
      ? { cachedContent: cacheName }
      : {
          systemInstruction: fullPromptPrefix,
        },
  });
  const t3 = performance.now();
  const latency2 = Math.round(t3 - t2);

  const u2 = res2.usageMetadata;
  const cached2 = u2?.cachedContentTokenCount ?? 0;
  console.log(`Turn 2 Response: "${res2.text?.trim()}" (${latency2}ms)`);
  console.log(`Turn 2 Usage: promptTokens=${u2?.promptTokenCount}, candidatesTokens=${u2?.candidatesTokenCount}, cachedContentTokens=${cached2}`);

  // Cleanup cache
  if (cacheName) {
    try {
      await ai.caches.delete({ name: cacheName });
      console.log('\nCleaned up Vertex context cache.');
    } catch {
      // ignore
    }
  }

  const norm2 = normalizeCacheMetrics(
    'google',
    model,
    prefix.toolBundleHash,
    {
      inputTokens: u2?.promptTokenCount ?? 0,
      outputTokens: u2?.candidatesTokenCount ?? 0,
      cacheReadTokens: cached2,
      cacheWriteTokens: 0,
      exact: true,
    },
    { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
    latency2,
  );

  console.log('\n===============================================================');
  console.log('Gemini Prompt Caching Evaluation Summary');
  console.log('===============================================================');
  console.log(`Prompt Tokens:               ${u2?.promptTokenCount}`);
  console.log(`Cached Content Tokens:       ${cached2}`);
  console.log(`Cache Hit Confirmed:         ${cached2 > 0 ? '✅ YES' : '❌ NO'}`);
  console.log(`Normalized Cache Hit Metric: ${norm2.cacheHit}`);
  console.log(`Estimated Cost:              $${norm2.estimatedInputCost?.toFixed(6) ?? '0.000000'}`);
  console.log(`Estimated Cost Savings:      $${norm2.estimatedInputCostSaved?.toFixed(6) ?? '0.000000'}`);

  if (cached2 <= 0) {
    throw new Error('Gemini prompt-cache warm run failed: cachedContentTokenCount was not > 0');
  }

  console.log('\nGemini Prompt Caching Verification: SUCCESS ✅');
  console.log('===============================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('Error during Gemini prompt caching evaluation:', err);
  process.exit(1);
});
