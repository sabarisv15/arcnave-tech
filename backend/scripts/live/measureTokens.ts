// P03 (X-6) repaired: configuration comes from the environment only, and the word-count token estimate is removed (Invariant 3: provider counts only). Owner-run; spends quota; never run by tests or CI.
/**
 * Exact Provider Token Count Measurement Script.
 *
 * Measures exact prompt token counts using official provider APIs and tokenizers:
 * - Gemini on Vertex AI (`@google/genai` models.countTokens)
 * - Claude API (`@anthropic-ai/sdk` messages.countTokens, ADR-0054)
 * - Word & character distributions
 */
import { GoogleGenAI } from '@google/genai';
import { createAnthropicClient } from '../../src/providers/anthropic.js';
import { loadConfig } from '../../src/config.js';
import { buildStablePrefix } from '../../src/services/promptCache/promptAssembly.js';
import { ProjectToolRegistry } from '../../src/tools/registry.js';

async function main() {
  console.log('=== ArcNave Master System Prompt v1: Exact Token Measurement ===\n');

  const cfg = loadConfig({
    ...process.env,
    ENABLE_TOOL_USE: 'true',
    ENABLE_RUN_PYTHON: 'true',
    ENABLE_WEB: 'true',
    ENABLE_SKILLS: 'true',
  });

  // The v3 Gemini stable text for a turn with every tool on (ADR-0075).
  const tools = new ProjectToolRegistry(true, { codeEnabled: true, webEnabled: true, memoryEnabled: true, generativeUiEnabled: true })
    .getAvailableTools({ projectId: 'measure', allowCode: true });
  const prompt = buildStablePrefix('google', tools).systemText;

  const charCount = prompt.length;
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;
  const lineCount = prompt.split('\n').length;

  console.log(`System Prompt Physical Metrics:`);
  console.log(`- Characters : ${charCount.toLocaleString()}`);
  console.log(`- Words      : ${wordCount.toLocaleString()}`);
  console.log(`- Lines      : ${lineCount.toLocaleString()}`);
  console.log('');

  // Provider exact measurement 1: Gemini Vertex AI
  const geminiModel = cfg.MODEL_GEMINI_FLASH ?? (() => { throw new Error('MODEL_GEMINI_FLASH is not set'); })();
  const gcpProject = cfg.GOOGLE_CLOUD_PROJECT ?? (() => { throw new Error('GOOGLE_CLOUD_PROJECT is not set'); })();

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

    const sonnetModel = (cfg.MODEL_SONNET ?? (() => { throw new Error('MODEL_SONNET is not set'); })());
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
