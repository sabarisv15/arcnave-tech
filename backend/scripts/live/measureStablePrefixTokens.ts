// P03 (X-6) repaired: project and Claude model come from configuration only (no hard-coded project id or retired model name). Owner-run; spends quota; never run by tests or CI.
/**
 * Measure exact token counts of the final canonical stable prefix across
 * models and tool bundles using live Vertex token-counting APIs.
 */

import { createAnthropicClient } from '../../src/providers/anthropic.js';
import { GoogleGenAI } from '@google/genai';
import { loadConfig } from '../../src/config.js';
import {
  ASK_USER_INPUT,
  SEARCH_PROJECT_FILES,
  READ_PROJECT_FILE,
  WEB_SEARCH,
  WEB_FETCH,
  codeToolDefinitions,
} from '../../src/tools/definitions.js';
import type { ToolDefinition } from '../../src/providers/types.js';
import { buildStablePrefix } from '../../src/services/promptCache/promptAssembly.js';
import { toAnthropicTool } from '../../src/providers/anthropic.js';
import { toGeminiFunctionDeclaration } from '../../src/providers/gemini.js';

const BUNDLES: { name: string; tools: ToolDefinition[] }[] = [
  {
    name: 'chat_core',
    tools: [ASK_USER_INPUT],
  },
  {
    name: 'project',
    tools: [
      ASK_USER_INPUT,
      SEARCH_PROJECT_FILES,
      READ_PROJECT_FILE,
    ],
  },
  {
    name: 'research',
    tools: [
      ASK_USER_INPUT,
      SEARCH_PROJECT_FILES,
      READ_PROJECT_FILE,
      WEB_SEARCH,
      WEB_FETCH,
      
    ],
  },
  {
    name: 'agent',
    tools: [
      ASK_USER_INPUT,
      SEARCH_PROJECT_FILES,
      READ_PROJECT_FILE,
      WEB_SEARCH,
      WEB_FETCH,
      ...codeToolDefinitions(true),
    ],
  },
];

async function main() {
  console.log('======================================================================');
  console.log('   ArcNave Phase 5: Stable Prefix Token Measurement Across Bundles');
  console.log('======================================================================\n');

  const cfg = loadConfig();

  const googleClient = new GoogleGenAI({
    vertexai: true,
    project: cfg.GOOGLE_CLOUD_PROJECT ?? (() => { throw new Error('GOOGLE_CLOUD_PROJECT is not set'); })(),
    location: cfg.geminiLocation,
  });

  const anthropicClient = createAnthropicClient(cfg);

  for (const b of BUNDLES) {
    const prefix = buildStablePrefix('google', b.tools);

    console.log(`----------------------------------------------------------------------`);
    console.log(`Tool Bundle: ${b.name.toUpperCase()} (${prefix.tools.length} tools)`);
    console.log(`Tool Bundle Hash: ${prefix.toolBundleHash.slice(0, 16)}...`);
    console.log(`Static System Chars: ${prefix.systemText.length}`);

    // 1. Measure on Gemini 3.8 Flash
    try {
      const geminiTools = prefix.tools.map(toGeminiFunctionDeclaration);
      const res = await googleClient.models.countTokens({
        model: 'gemini-3.8-flash',
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        config: {
          systemInstruction: prefix.systemText,
          tools: [{ functionDeclarations: geminiTools }],
        },
      });
      const tokens = res.totalTokens ?? 0;
      console.log(`  gemini-3.8-flash tokens : ${tokens}`);
      console.log(`    -> vs 6,144 implicit cache threshold: ${tokens >= 6144 ? '✅ QUALIFIES' : '⏳ BELOW THRESHOLD (no cache pad)'}`);
    } catch (err: any) {
      console.log(`  gemini-3.8-flash countTokens failed: ${err?.message || err}`);
    }

    // 2. Measure on Claude Sonnet 5
    try {
      const anthropicTools = prefix.tools.map(toAnthropicTool);
      const res = await anthropicClient.messages.countTokens({
        model: (cfg.MODEL_SONNET ?? (() => { throw new Error('MODEL_SONNET is not set'); })()),
        system: prefix.systemText,
        tools: anthropicTools,
        messages: [{ role: 'user', content: 'ping' }],
      });
      const tokens = res.input_tokens ?? 0;
      console.log(`  ${cfg.MODEL_SONNET} tokens  : ${tokens}`);
      console.log(`    -> vs 1,024 cache breakpoint threshold: ${tokens >= 1024 ? '✅ QUALIFIES (cache_control placed)' : '❌ BELOW'}`);
    } catch (err: any) {
      console.log(`  ${cfg.MODEL_SONNET} countTokens failed: ${err?.message || err}`);
    }

    console.log('');
  }
}

main().catch((err) => {
  console.error('Measurement error:', err);
  process.exit(1);
});
