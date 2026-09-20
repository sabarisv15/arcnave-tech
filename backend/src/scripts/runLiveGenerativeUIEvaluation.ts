/**
 * ArcNave Phase 6 — Fully Symmetric Live Model E2E Evaluation.
 * Runs the exact identical 5-scenario evaluation matrix against BOTH Gemini 3.8 Flash and Claude Sonnet 5:
 *
 * 1. Comparison Matrix -> render_ui with comparison / table blocks
 * 2. Chart Generation -> render_ui with metric / chart blocks
 * 3. Steps Instructions -> render_ui with steps block
 * 4. Casual Greeting ("Hi") -> plain text, ZERO render_ui calls
 * 5. Hostile Script Tag Injection -> rejected by validator, safe text fallback extracted
 */

import { GoogleGenAI } from '@google/genai';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { config } from '../config.js';
import { RENDER_UI } from '../tools/definitions.js';
import { buildStablePrefix } from '../services/promptCache/promptAssembly.js';
import { toGeminiFunctionDeclaration } from '../providers/gemini.js';
import { validateAndNormalizeUI } from '../services/ui/validator.js';

async function runGeminiScenarios() {
  const cfg = config();
  const projectId = cfg.GOOGLE_CLOUD_PROJECT || 'project-8bcf740a-a7bd-4aea-974';
  const location = cfg.geminiLocation || 'global';
  const model = cfg.MODEL_GEMINI_FLASH || 'gemini-3.8-flash';

  console.log('===============================================================');
  console.log('ArcNave Phase 6 — Gemini Live Model E2E Evaluation (5 Scenarios)');
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
    contents: [{ role: 'user', parts: [{ text: 'Render a structured comparison matrix comparing PostgreSQL vs SQLite across Concurrency, Deployment, and Scale using render_ui with a comparison block.' }] }],
    config: { systemInstruction, tools: [geminiTool], temperature: 0.2 },
  });
  const compCalls = compRes.functionCalls ?? [];
  console.log(`Gemini Function Calls: ${compCalls.length}`);
  if (compCalls.length > 0) {
    const call = compCalls[0]!;
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.args);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      console.log(`Rendered Block Types: ${norm.data.blocks.map((b) => b.type).join(', ')}`);
    }
  }

  // Scenario 2: Chart
  console.log('\n--- Gemini Scenario 2: Chart Generation ---');
  const chartRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: 'Render a bar chart of our quarterly revenue for 2025: Q1 120k, Q2 150k, Q3 180k, Q4 220k using render_ui.' }] }],
    config: { systemInstruction, tools: [geminiTool], temperature: 0.2 },
  });
  const chartCalls = chartRes.functionCalls ?? [];
  console.log(`Gemini Function Calls: ${chartCalls.length}`);
  if (chartCalls.length > 0) {
    const call = chartCalls[0]!;
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.args);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      console.log(`Rendered Block Types: ${norm.data.blocks.map((b) => b.type).join(', ')}`);
    }
  }

  // Scenario 3: Steps
  console.log('\n--- Gemini Scenario 3: Steps Instructions ---');
  const stepsRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: 'Provide a structured 3-step guide with terminal shell commands to initialize a git repo and push to GitHub using render_ui.' }] }],
    config: { systemInstruction, tools: [geminiTool], temperature: 0.2 },
  });
  const stepsCalls = stepsRes.functionCalls ?? [];
  console.log(`Gemini Function Calls: ${stepsCalls.length}`);
  if (stepsCalls.length > 0) {
    const call = stepsCalls[0]!;
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.args);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      console.log(`Rendered Block Types: ${norm.data.blocks.map((b) => b.type).join(', ')}`);
    }
  }

  // Scenario 4: Plain "Hi" -> No render_ui
  console.log('\n--- Gemini Scenario 4: Casual Greeting ("Hi") ---');
  const hiRes = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: 'Hello, good morning!' }] }],
    config: { systemInstruction, tools: [geminiTool], temperature: 0.2 },
  });
  const hiCalls = hiRes.functionCalls ?? [];
  console.log(`Gemini Function Calls for "Hi": ${hiCalls.length} (Expected: 0)`);
  console.log(`Response text preview: "${hiRes.text?.slice(0, 60)}..."`);

  // Scenario 5: Malicious Script Rejection
  console.log('\n--- Gemini Scenario 5: Hostile Script Tag Injection Rejection ---');
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
  console.log('ArcNave Phase 6 — Claude Live Model E2E Evaluation (5 Scenarios)');
  console.log('===============================================================');
  console.log(`GCP Project:        ${projectId}`);
  console.log(`Anthropic Location: ${region}`);
  console.log(`Model:              ${model}\n`);

  const client = new AnthropicVertex({ projectId, region });
  const systemInstruction = buildStablePrefix([RENDER_UI]).systemText;
  const claudeTool = {
    name: RENDER_UI.name,
    description: RENDER_UI.description,
    input_schema: RENDER_UI.inputSchema as any,
  };

  // Scenario 1: Comparison
  console.log('--- Claude Scenario 1: Comparison Matrix ---');
  const compRes = await client.messages.create({
    model,
    max_tokens: 1500,
    system: systemInstruction,
    messages: [{ role: 'user', content: 'Render a structured comparison matrix comparing PostgreSQL vs SQLite across Concurrency, Deployment, and Scale using render_ui with a comparison block.' }],
    tools: [claudeTool],
  });
  const compTools = compRes.content.filter((c) => c.type === 'tool_use');
  console.log(`Claude Tool Calls: ${compTools.length}`);
  if (compTools.length > 0) {
    const call = compTools[0] as { type: 'tool_use'; name: string; input: unknown };
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.input);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      console.log(`Rendered Block Types: ${norm.data.blocks.map((b) => b.type).join(', ')}`);
    } else {
      console.log(`Validation Error: ${norm.error}`);
      console.log(`Claude Raw Input:`, JSON.stringify(call.input, null, 2));
    }
  }

  // Scenario 2: Chart
  console.log('\n--- Claude Scenario 2: Chart Generation ---');
  const chartRes = await client.messages.create({
    model,
    max_tokens: 1500,
    system: systemInstruction,
    messages: [{ role: 'user', content: 'Render a bar chart of our quarterly revenue for 2025: Q1 120k, Q2 150k, Q3 180k, Q4 220k using render_ui.' }],
    tools: [claudeTool],
  });
  const chartTools = chartRes.content.filter((c) => c.type === 'tool_use');
  console.log(`Claude Tool Calls: ${chartTools.length}`);
  if (chartTools.length > 0) {
    const call = chartTools[0] as { type: 'tool_use'; name: string; input: unknown };
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.input);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      console.log(`Rendered Block Types: ${norm.data.blocks.map((b) => b.type).join(', ')}`);
    } else {
      console.log(`Validation Error: ${norm.error}`);
    }
  }

  // Scenario 3: Steps
  console.log('\n--- Claude Scenario 3: Steps Instructions ---');
  const stepsRes = await client.messages.create({
    model,
    max_tokens: 1500,
    system: systemInstruction,
    messages: [{ role: 'user', content: 'Provide a structured 3-step guide with terminal shell commands to initialize a git repo and push to GitHub using render_ui.' }],
    tools: [claudeTool],
  });
  const stepsTools = stepsRes.content.filter((c) => c.type === 'tool_use');
  console.log(`Claude Tool Calls: ${stepsTools.length}`);
  if (stepsTools.length > 0) {
    const call = stepsTools[0] as { type: 'tool_use'; name: string; input: unknown };
    console.log(`Tool called: ${call.name}`);
    const norm = validateAndNormalizeUI(call.input);
    console.log(`Validation OK: ${norm.ok}`);
    if (norm.ok) {
      console.log(`Rendered Block Types: ${norm.data.blocks.map((b) => b.type).join(', ')}`);
    } else {
      console.log(`Validation Error: ${norm.error}`);
    }
  }

  // Scenario 4: Plain "Hi" -> No render_ui
  console.log('\n--- Claude Scenario 4: Casual Greeting ("Hi") ---');
  const hiRes = await client.messages.create({
    model,
    max_tokens: 256,
    system: systemInstruction,
    messages: [{ role: 'user', content: 'Hi! How are you today?' }],
    tools: [claudeTool],
  });
  const hiTools = hiRes.content.filter((c) => c.type === 'tool_use');
  console.log(`Claude Tool Calls for "Hi": ${hiTools.length} (Expected: 0)`);
  const textPart = hiRes.content.find((c) => c.type === 'text') as { type: 'text'; text: string } | undefined;
  console.log(`Response text preview: "${textPart?.text?.slice(0, 60)}..."`);

  // Scenario 5: Malicious Script Rejection
  console.log('\n--- Claude Scenario 5: Hostile Script Tag Injection Rejection ---');
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

async function main() {
  try {
    await runGeminiScenarios();
    await runClaudeScenarios();
    console.log('\n===============================================================');
    console.log('Fully Symmetric Live Model E2E Scenarios Completed Successfully!');
    console.log('===============================================================');
    process.exit(0);
  } catch (err) {
    console.error('Live evaluation encountered error:', err);
    process.exit(1);
  }
}

void main();
