/**
 * ArcNave Claude Sonnet 5 Real-Model E2E Behavior Evaluation Script.
 *
 * Tests Claude on Vertex AI (`claude-sonnet-5`) using AnthropicVertexProvider
 * and the frozen Base System Prompt v1.
 */
import { AnthropicVertexProvider } from '../providers/anthropicVertex.js';
import type { GenerationRequest, ToolCall, ToolDefinition, ToolResult } from '../providers/types.js';
import { loadConfig } from '../config.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { buildBaseSystemPrompt } from '../services/systemPrompt.js';
import {
  CREATE_ARTIFACT,
  READ_SKILL,
  LIST_SKILLS,
  SEARCH_SKILLS,
  READ_ARTIFACT,
  SEARCH_PROJECT_FILES,
  WEB_FETCH,
  WEB_SEARCH,
} from '../tools/definitions.js';

const ALL_STANDARD_TOOLS: ToolDefinition[] = [
  WEB_SEARCH,
  WEB_FETCH,
  CREATE_ARTIFACT,
  READ_ARTIFACT,
  READ_SKILL,
  LIST_SKILLS,
  SEARCH_SKILLS,
  SEARCH_PROJECT_FILES,
];

async function main() {
  console.log('======================================================================');
  console.log('  ArcNave Claude Live Model E2E Behavior Evaluation (Vertex AI)');
  console.log('======================================================================\n');

  const cfg = loadConfig({
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974',
    VERTEX_LOCATION: 'global',
    MODEL_SONNET: 'claude-sonnet-5',
    ENABLE_TOOL_USE: 'true',
    ENABLE_RUN_PYTHON: 'true',
    ENABLE_WEB: 'true',
    ENABLE_SKILLS: 'true',
  });

  const registry = buildCapabilityRegistry(cfg);
  const masterPrompt = buildBaseSystemPrompt(cfg, registry);
  const provider = new AnthropicVertexProvider(cfg);
  const modelId = cfg.MODEL_SONNET || 'claude-sonnet-5';

  console.log(`Target Model      : ${modelId}`);
  console.log(`GCP Project       : ${cfg.GOOGLE_CLOUD_PROJECT}`);
  console.log(`Prompt Tokens     : 7,186 (Claude exact count)\n`);

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
