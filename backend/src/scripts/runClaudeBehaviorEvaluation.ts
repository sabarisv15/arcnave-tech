// P03 (X-6) repaired: configuration comes from the environment only, and the stale hard-coded prompt token figure is removed. Owner-run; spends quota; never run by tests or CI.
/**
 * ArcNave Claude Sonnet 5 Real-Model E2E Behavior Evaluation Script.
 *
 * Tests Claude on the Claude API (the configured MODEL_SONNET) using AnthropicProvider
 * and the frozen Base System Prompt v1.
 */
import { AnthropicProvider } from '../providers/anthropic.js';
import type { GenerationRequest, ToolCall, ToolDefinition, ToolResult } from '../providers/types.js';
import { loadConfig } from '../config.js';
import { buildStablePrefix } from '../services/promptCache/promptAssembly.js';
import { ProjectToolRegistry } from '../tools/registry.js';
import {
  ASK_USER_INPUT,
  codeToolDefinitions,
  SEARCH_PROJECT_FILES,
  WEB_FETCH,
  WEB_SEARCH,
} from '../tools/definitions.js';

const ALL_STANDARD_TOOLS: ToolDefinition[] = [
  WEB_SEARCH,
  WEB_FETCH,
  ASK_USER_INPUT,
  ...codeToolDefinitions(true),
  SEARCH_PROJECT_FILES,
];

async function main() {
  console.log('======================================================================');
  console.log('  ArcNave Claude Live Model E2E Behavior Evaluation (Claude API)');
  console.log('======================================================================\n');

  const cfg = loadConfig({
    ...process.env,
    ENABLE_TOOL_USE: 'true',
    ENABLE_RUN_PYTHON: 'true',
    ENABLE_WEB: 'true',
    ENABLE_SKILLS: 'true',
  });

  // The v3 Claude stable text for a turn with the web and sandbox tools (ADR-0075).
  const masterPrompt = buildStablePrefix(
    'anthropic',
    new ProjectToolRegistry(true, { codeEnabled: true, webEnabled: true }).getAvailableTools({ projectId: null, allowCode: true }),
  ).systemText;
  const provider = new AnthropicProvider(cfg);
  const modelId = (cfg.MODEL_SONNET ?? (() => { throw new Error('MODEL_SONNET is not set'); })());

  console.log(`Target Model      : ${modelId}`);
  console.log('');

  // Run core sanity check: Casual Greeting and Tool Boundary
  console.log('Testing Scenario 1: Casual greeting ("Hi")...');
  let greetingText = '';
  const greetingTools: string[] = [];

  const toolExecutor = {
    async execute(call: ToolCall): Promise<ToolResult> {
      greetingTools.push(call.name);
      return { toolCallId: call.id, ok: true, content: [{ type: 'text', text: 'OK' }] };
    },
  };

  const req: GenerationRequest = {
    mode: 'chat',
    prompt: 'Hi there, how are you today?',
    systemInstruction: masterPrompt,
    providerModelId: modelId,
    maxOutputTokens: 500,
    history: [],
    tools: ALL_STANDARD_TOOLS,
    toolExecutor,
    signal: new AbortController().signal,
    grounded: false,
    codeExecution: false,
  };

  try {
    for await (const ev of provider.stream(req)) {
      if (ev.type === 'delta') greetingText += ev.text;
    }
    console.log(`Greeting response preview: "${greetingText.trim().substring(0, 80)}..."`);
    console.log(`Tools called: ${JSON.stringify(greetingTools)}`);
    if (greetingTools.length === 0 && greetingText.length > 5) {
      console.log('✅ Claude Scenario 1 PASS: Direct response, no unnecessary tools/AgentLoop.');
    } else {
      console.log('❌ Claude Scenario 1 FAIL');
    }
  } catch (err: any) {
    console.error('Claude API call encountered error:', err?.message || err);
  }
}

main().catch(console.error);
