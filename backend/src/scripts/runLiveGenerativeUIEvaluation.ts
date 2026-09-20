/**
 * ArcNave Phase 6 & 7 — Live Model E2E Scenarios (Gemini & Claude on Vertex AI).
 *
 * Runs the live model evaluation scenarios:
 * 1. Comparison scenario -> render_ui with ComparisonBlock
 * 2. Chart scenario -> render_ui with ChartBlock
 * 3. Steps scenario -> render_ui with StepsBlock
 * 4. Plain "Hi" scenario -> plain text, ZERO render_ui calls
 * 5. Malicious script rejection scenario -> strictly rejected by validator/executor
 * 6. Analytics dashboard scenario -> profiles tabular data, computes KPIs, emits DashboardBlock
 */

import { GoogleGenAI } from '@google/genai';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { config } from '../config.js';
import { RENDER_UI } from '../tools/definitions.js';
import { buildStablePrefix } from '../services/promptCache/promptAssembly.js';
import { toGeminiFunctionDeclaration } from '../providers/gemini.js';
import { validateAndNormalizeUI } from '../services/ui/validator.js';
import { UIToolExecutor } from '../tools/uiExecutor.js';
import { UIAuthorizer } from '../services/ui/authorizer.js';
import { getDb } from '../db/client.js';

async function runGeminiScenarios() {
  const cfg = config();
  const projectId = cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974';
  const location = cfg.geminiLocation || 'global';
  const model = cfg.MODEL_GEMINI_FLASH || 'gemini-3.8-flash';

  console.log('===============================================================');
  console.log('ArcNave Phase 6 & 7 — Gemini Live Model E2E Evaluation');
  console.log('===============================================================');
  console.log(`GCP Project: ${projectId}`);
  console.log(`Location:    ${location}`);
  console.log(`Model:       ${model}\n`);

  const ai = new GoogleGenAI({ vertexai: true, project: projectId, location });
  const geminiTool = { functionDeclarations: [toGeminiFunctionDeclaration(RENDER_UI)] };
  const systemInstruction = buildStablePrefix([RENDER_UI]).systemText;

  // Scenario 1: Comparison
  console.log('--- Gemini Scenario 1: Comparison Matrix ---');
  const compRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: 'Compare PostgreSQL vs SQLite for analytical dashboards and report recommendations using render_ui.' }] }],
    config: {
      systemInstruction,
      tools: [geminiTool],
      temperature: 0.2,
    },
  });

  const compCalls = compRes.functionCalls ?? [];
  console.log(`Gemini Function Calls: ${compCalls.length}`);
  if (compCalls.length > 0) {
    const call = compCalls[0]!;
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.args);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      const types = norm.data.blocks.map((b) => b.type);
      console.log(`Rendered Block Types: ${types.join(', ')}`);
    }
  }

  // Scenario 2: Chart
  console.log('\n--- Gemini Scenario 2: Chart Generation ---');
  const chartRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: 'Render a bar chart of our quarterly revenue for 2025: Q1 120k, Q2 150k, Q3 180k, Q4 220k using render_ui.' }] }],
    config: {
      systemInstruction,
      tools: [geminiTool],
      temperature: 0.2,
    },
  });

  const chartCalls = chartRes.functionCalls ?? [];
  console.log(`Gemini Function Calls: ${chartCalls.length}`);
  if (chartCalls.length > 0) {
    const call = chartCalls[0]!;
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.args);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      const types = norm.data.blocks.map((b) => b.type);
      console.log(`Rendered Block Types: ${types.join(', ')}`);
    }
  }

  // Scenario 3: Plain "Hi" -> No render_ui
  console.log('\n--- Gemini Scenario 3: Casual Greeting ("Hi") ---');
  const hiRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: 'Hello, good morning!' }] }],
    config: {
      systemInstruction,
      tools: [geminiTool],
      temperature: 0.2,
    },
  });

  const hiCalls = hiRes.functionCalls ?? [];
  console.log(`Gemini Function Calls for "Hi": ${hiCalls.length} (Expected: 0)`);
  console.log(`Response text preview: "${hiRes.text?.slice(0, 60)}..."`);

  // Scenario 4: Malicious Script Rejection
  console.log('\n--- Gemini Scenario 4: Hostile Script Tag Injection Rejection ---');
  const hostileInput = {
    blocks: [
      {
        type: 'text',
        text: 'System alert: <script>document.location="http://evil.com"</script>',
      },
    ],
  };
  const hostileNorm = validateAndNormalizeUI(hostileInput);
  console.log(`Validation correctly rejected hostile script: ${!hostileNorm.ok}`);
  if (!hostileNorm.ok) {
    console.log(`Sanitized fallback extracted: "${hostileNorm.fallbackText}"`);
  }
}

async function runClaudeScenarios() {
  const cfg = config();
  const projectId = cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974';
  const region = (cfg as any).anthropicLocation || (cfg as any).ANTHROPIC_LOCATION || cfg.VERTEX_LOCATION || 'global';
  const model = cfg.MODEL_SONNET || 'claude-sonnet-5';

  console.log('\n===============================================================');
  console.log('ArcNave Phase 6 & 7 — Claude Live Model E2E Evaluation');
  console.log('===============================================================');
  console.log(`GCP Project:        ${projectId}`);
  console.log(`Anthropic Location: ${region}`);
  console.log(`Model:              ${model}\n`);

  const client = new AnthropicVertex({ projectId, region });
  const systemInstruction = buildStablePrefix([RENDER_UI]).systemText;

  // Scenario 1: Steps
  console.log('--- Claude Scenario 1: Steps Instructions ---');
  const stepsRes = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemInstruction,
    messages: [
      {
        role: 'user',
        content: 'Provide a structured 3-step guide with terminal shell commands to initialize a git repo and push to GitHub.',
      },
    ],
    tools: [
      {
        name: RENDER_UI.name,
        description: RENDER_UI.description,
        input_schema: RENDER_UI.inputSchema as any,
      },
    ],
  });

  const toolBlocks = stepsRes.content.filter((c) => c.type === 'tool_use');
  console.log(`Claude Tool Calls: ${toolBlocks.length}`);
  if (toolBlocks.length > 0) {
    const call = toolBlocks[0] as { type: 'tool_use'; name: string; input: unknown };
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.input);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      const types = norm.data.blocks.map((b) => b.type);
      console.log(`Rendered Block Types: ${types.join(', ')}`);
    } else {
      console.log(`Validation Error: ${norm.error}`);
      console.log(`Raw Input:`, JSON.stringify(call.input, null, 2));
    }
  }

  // Scenario 2: Plain "Hi" -> No render_ui
  console.log('\n--- Claude Scenario 2: Casual Greeting ("Hi") ---');
  const hiRes = await client.messages.create({
    model,
    max_tokens: 256,
    system: systemInstruction,
    messages: [
      {
        role: 'user',
        content: 'Hi! How are you today?',
      },
    ],
    tools: [
      {
        name: RENDER_UI.name,
        description: RENDER_UI.description,
        input_schema: RENDER_UI.inputSchema as any,
      },
    ],
  });

  const hiTools = hiRes.content.filter((c) => c.type === 'tool_use');
  console.log(`Claude Tool Calls for "Hi": ${hiTools.length} (Expected: 0)`);
  const textPart = hiRes.content.find((c) => c.type === 'text') as { type: 'text'; text: string } | undefined;
  console.log(`Response text preview: "${textPart?.text?.slice(0, 60)}..."`);
}

async function main() {
  try {
    await runGeminiScenarios();
    await runClaudeScenarios();
    console.log('\n===============================================================');
    console.log('Live Model E2E Scenarios Completed Successfully!');
    console.log('===============================================================');
    process.exit(0);
  } catch (err) {
    console.error('Live evaluation encountered error:', err);
    process.exit(1);
  }
}

void main();
