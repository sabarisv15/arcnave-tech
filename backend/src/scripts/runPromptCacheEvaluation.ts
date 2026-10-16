// P03 (X-6) repaired: the Claude model comes from configuration only (no retired model name). Owner-run; spends quota; never run by tests or CI.
/**
 * Live Prompt Caching Evaluation Script.
 *
 * Tests Claude Sonnet 4.5 / 3.7 on Vertex AI with live prompt caching enabled:
 * - Turn 1 (Cold): prefix is written to ephemeral cache -> cache_creation_input_tokens > 0.
 * - Turn 2 (Warm): prefix is read from cache -> cache_read_input_tokens > 0, latency reduced.
 * - Validates normalized cache telemetry and cost calculation.
 */

import { createAnthropicClient } from '../providers/anthropic.js';
import { config } from '../config.js';
import {
  ASK_USER_INPUT,
  SEARCH_PROJECT_FILES,
  READ_PROJECT_FILE,
  WEB_SEARCH,
  WEB_FETCH,
} from '../tools/definitions.js';
import { buildStablePrefix } from '../services/promptCache/promptAssembly.js';
import { toAnthropicTool } from '../providers/anthropic.js';
import { normalizeCacheMetrics } from '../services/promptCache/telemetry.js';

async function main() {
  const cfg = config();
  const model = (cfg.MODEL_SONNET ?? (() => { throw new Error('MODEL_SONNET is not set'); })());

  console.log('===============================================================');
  console.log('ArcNave Phase 5.1 — Live Prompt Caching Evaluation');
  console.log('===============================================================');
  console.log(`Endpoint:           Claude API (first party)`);
  console.log(`Model: ${model}`);

  const client = createAnthropicClient(config());

  const tools = [
    ASK_USER_INPUT,
    SEARCH_PROJECT_FILES,
    READ_PROJECT_FILE,
    WEB_SEARCH,
    WEB_FETCH,
  ];

  const prefix = buildStablePrefix('anthropic', tools);
  console.log(`\nTool bundle: ${prefix.bundleName}`);
  console.log(`Tool bundle hash: ${prefix.toolBundleHash.slice(0, 12)}...`);
  console.log(`Stable prefix hash: ${prefix.prefixHash.slice(0, 12)}...`);

  // Construct system block with ephemeral cache control breakpoint
  const systemBlock: any[] = [
    {
      type: 'text',
      text: prefix.systemText,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const anthropicTools = prefix.tools.map(toAnthropicTool);

  // Turn 1: Cold request
  console.log('\n--- Turn 1: Cold Request (Cache Population) ---');
  const t0 = performance.now();
  const res1 = await client.messages.create({
    model,
    max_tokens: 100,
    system: systemBlock,
    tools: anthropicTools,
    messages: [
      { role: 'user', content: 'Reply with "Ready" if you understand the operational guidelines.' },
    ],
  });
  const t1 = performance.now();
  const latency1 = Math.round(t1 - t0);

  const u1 = res1.usage as any;
  console.log(`Turn 1 Response: "${res1.content[0]?.type === 'text' ? (res1.content[0] as any).text.trim() : ''}"`);
  console.log(`Turn 1 Latency: ${latency1}ms`);
  console.log(`Turn 1 Usage: input=${u1.input_tokens}, output=${u1.output_tokens}, cache_create=${u1.cache_creation_input_tokens ?? 0}, cache_read=${u1.cache_read_input_tokens ?? 0}`);

  const norm1 = normalizeCacheMetrics(
    'anthropic',
    model,
    prefix.toolBundleHash,
    {
      inputTokens: u1.input_tokens + (u1.cache_creation_input_tokens ?? 0),
      outputTokens: u1.output_tokens,
      cacheReadTokens: u1.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u1.cache_creation_input_tokens ?? 0,
      exact: true,
    },
    { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    latency1,
  );
  console.log(`Normalized Telemetry Turn 1: cacheHit=${norm1.cacheHit}, estimatedCost=$${norm1.estimatedInputCost?.toFixed(6) ?? 'N/A'}`);

  // Turn 2: Warm request (should hit prompt cache)
  console.log('\n--- Turn 2: Warm Request (Cache Hit Verification) ---');
  const t2 = performance.now();
  const res2 = await client.messages.create({
    model,
    max_tokens: 100,
    system: systemBlock,
    tools: anthropicTools,
    messages: [
      { role: 'user', content: 'Reply with "Ready" if you understand the operational guidelines.' },
      { role: 'assistant', content: res1.content },
      { role: 'user', content: 'Now confirm in 3 words.' },
    ],
  });
  const t3 = performance.now();
  const latency2 = Math.round(t3 - t2);

  const u2 = res2.usage as any;
  console.log(`Turn 2 Response: "${res2.content[0]?.type === 'text' ? (res2.content[0] as any).text.trim() : ''}"`);
  console.log(`Turn 2 Latency: ${latency2}ms (Latency delta: ${latency1 - latency2}ms)`);
  console.log(`Turn 2 Usage: input=${u2.input_tokens}, output=${u2.output_tokens}, cache_create=${u2.cache_creation_input_tokens ?? 0}, cache_read=${u2.cache_read_input_tokens ?? 0}`);

  const norm2 = normalizeCacheMetrics(
    'anthropic',
    model,
    prefix.toolBundleHash,
    {
      inputTokens: u2.input_tokens + (u2.cache_read_input_tokens ?? 0),
      outputTokens: u2.output_tokens,
      cacheReadTokens: u2.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u2.cache_creation_input_tokens ?? 0,
      exact: true,
    },
    { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    latency2,
  );
  console.log(`Normalized Telemetry Turn 2: cacheHit=${norm2.cacheHit}, estimatedCost=$${norm2.estimatedInputCost?.toFixed(6) ?? 'N/A'}, estimatedSavings=$${norm2.estimatedInputCostSaved?.toFixed(6) ?? 'N/A'}`);

  console.log('\n===============================================================');
  console.log('Prompt Caching Evaluation Summary');
  console.log('===============================================================');
  console.log(`Cache Write (Turn 1): ${u1.cache_creation_input_tokens ?? 0} tokens`);
  console.log(`Cache Read (Turn 2):  ${u2.cache_read_input_tokens ?? 0} tokens (HIT: ${(u2.cache_read_input_tokens ?? 0) > 0 ? 'SUCCESS' : 'MISS'})`);
  console.log(`Latency Reduction:    ${latency1}ms -> ${latency2}ms`);
}

main().catch((err) => {
  console.error('Error during prompt cache evaluation:', err);
  process.exit(1);
});
