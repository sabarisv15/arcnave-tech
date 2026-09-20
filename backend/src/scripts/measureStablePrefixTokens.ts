/**
 * Measure exact token counts of the final canonical stable prefix across
 * models and tool bundles using live Vertex token-counting APIs.
 */

import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { GoogleGenAI } from '@google/genai';
import { loadConfig } from '../config.js';
import {
  CREATE_ARTIFACT,
  READ_ARTIFACT,
  UPDATE_ARTIFACT,
  SEARCH_PROJECT_FILES,
  READ_PROJECT_FILE,
  READ_UPLOADED_FILE,
  WEB_SEARCH,
  WEB_FETCH,
  LIST_SKILLS,
  SEARCH_SKILLS,
  READ_SKILL,
  RUN_PYTHON,
  GET_GOAL,
  UPDATE_GOAL,
  GET_CONTEXT_REMAINING,
} from '../tools/definitions.js';
import type { ToolDefinition } from '../providers/types.js';
import { buildStablePrefix } from '../services/promptCache/promptAssembly.js';
import { toAnthropicTool } from '../providers/anthropicVertex.js';
import { toGeminiFunctionDeclaration } from '../providers/gemini.js';

const BUNDLES: { name: string; tools: ToolDefinition[] }[] = [
  {
    name: 'chat_core',
    tools: [CREATE_ARTIFACT, READ_ARTIFACT, UPDATE_ARTIFACT],
  },
  {
    name: 'project',
    tools: [
      CREATE_ARTIFACT,
      READ_ARTIFACT,
      UPDATE_ARTIFACT,
      SEARCH_PROJECT_FILES,
      READ_PROJECT_FILE,
      READ_UPLOADED_FILE,
    ],
  },
  {
    name: 'research',
    tools: [
      CREATE_ARTIFACT,
      READ_ARTIFACT,
      UPDATE_ARTIFACT,
      SEARCH_PROJECT_FILES,
      READ_PROJECT_FILE,
      READ_UPLOADED_FILE,
      WEB_SEARCH,
      WEB_FETCH,
      LIST_SKILLS,
      SEARCH_SKILLS,
      READ_SKILL,
    ],
  },
  {
    name: 'agent',
    tools: [
      CREATE_ARTIFACT,
      READ_ARTIFACT,
      UPDATE_ARTIFACT,
      SEARCH_PROJECT_FILES,
      READ_PROJECT_FILE,
      READ_UPLOADED_FILE,
      WEB_SEARCH,
      WEB_FETCH,
      LIST_SKILLS,
      SEARCH_SKILLS,
      READ_SKILL,
      RUN_PYTHON,
      GET_GOAL,
      UPDATE_GOAL,
      GET_CONTEXT_REMAINING,
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
    project: cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974',
    location: cfg.geminiLocation,
  });

  const anthropicClient = new AnthropicVertex({
    projectId: cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974',
    region: cfg.VERTEX_LOCATION,
  });

  for (const b of BUNDLES) {
    const prefix = buildStablePrefix(b.tools);

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
        model: 'claude-sonnet-5',
        system: prefix.systemText,
        tools: anthropicTools,
        messages: [{ role: 'user', content: 'ping' }],
      });
      const tokens = res.input_tokens ?? 0;
      console.log(`  claude-sonnet-5 tokens  : ${tokens}`);
      console.log(`    -> vs 1,024 cache breakpoint threshold: ${tokens >= 1024 ? '✅ QUALIFIES (cache_control placed)' : '❌ BELOW'}`);
    } catch (err: any) {
      console.log(`  claude-sonnet-5 countTokens failed: ${err?.message || err}`);
    }

    console.log('');
  }
}

main().catch((err) => {
  console.error('Measurement error:', err);
  process.exit(1);
});
