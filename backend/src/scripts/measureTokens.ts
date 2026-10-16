/**
 * Exact Provider Token Count Measurement Script.
 *
 * Measures exact prompt token counts using official provider APIs and tokenizers:
 * - Gemini on Vertex AI (`@google/genai` models.countTokens)
 * - Claude API (`@anthropic-ai/sdk` messages.countTokens, ADR-0054)
 * - Word & character distributions
 */
import { GoogleGenAI } from '@google/genai';
import { createAnthropicClient } from '../providers/anthropic.js';
import { loadConfig } from '../config.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { buildBaseSystemPrompt } from '../services/systemPrompt.js';

async function main() {
  console.log('=== ArcNave Master System Prompt v1: Exact Token Measurement ===\n');

  const cfg = loadConfig({
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974',
    VERTEX_LOCATION: 'global',
    MODEL_GEMINI_FLASH: 'gemini-3.8-flash',
    MODEL_SONNET: 'claude-sonnet-5',
    ENABLE_TOOL_USE: 'true',
    ENABLE_RUN_PYTHON: 'true',
    ENABLE_WEB: 'true',
    ENABLE_SKILLS: 'true',
  });

  const registry = buildCapabilityRegistry(cfg);
  const prompt = buildBaseSystemPrompt(cfg, registry);

  const charCount = prompt.length;
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  const lineCount = prompt.split('\n').length;

  console.log(`System Prompt Physical Metrics:`);
  console.log(`- Characters : ${charCount.toLocaleString()}`);
  console.log(`- Words      : ${wordCount.toLocaleString()}`);
  console.log(`- Lines      : ${lineCount.toLocaleString()}`);
  console.log(`- Naive rule (words * 1.33): ~${Math.round(wordCount * 1.33).toLocaleString()} tokens\n`);

  // Provider exact measurement 1: Gemini Vertex AI
  const geminiModel = cfg.MODEL_GEMINI_FLASH || 'gemini-3.8-flash';
  const gcpProject = cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974';

  try {
    const ai = new GoogleGenAI({
      vertexai: true,
      project: gcpProject,
      location: cfg.geminiLocation,
    });

    console.log(`Querying Gemini Vertex API (${geminiModel}) countTokens...`);
    const geminiCount = await ai.models.countTokens({
      model: geminiModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });

    console.log(`[Gemini Exact Tokens]   : ${geminiCount.totalTokens}`);
  } catch (err: any) {
    console.error(`Gemini countTokens failed:`, err?.message || err);
  }

  // Provider exact measurement 2: Claude API (first party)
  try {
    const anthropic = createAnthropicClient(cfg);

    const sonnetModel = cfg.MODEL_SONNET || 'claude-sonnet-5';
    console.log(`Querying Claude API (${sonnetModel}) countTokens...`);
    if (typeof (anthropic.messages as any).countTokens === 'function') {
      const anthropicCount = await (anthropic.messages as any).countTokens({
        model: sonnetModel,
        system: prompt,
        messages: [{ role: 'user', content: 'hello' }],
      });
      console.log(`[Anthropic Exact Tokens]: ${anthropicCount.input_tokens}`);
    } else {
      console.log(`Anthropic SDK does not expose countTokens directly on this version.`);
    }
  } catch (err: any) {
    console.error(`Anthropic countTokens failed:`, err?.message || err);
  }

  console.log(`\n==================================================`);
}

main().catch((e) => {
  console.error('Fatal error in measureTokens:', e);
  process.exit(1);
});
