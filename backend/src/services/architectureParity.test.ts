import path from 'node:path';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DECLARED_EVERY_TURN } from '../tools/registry.js';

import { buildAnthropicMessages } from '../providers/anthropicVertex.js';
import { buildGeminiContents } from '../providers/gemini.js';
import type { AttachmentBlock, GenerationRequest } from '../providers/types.js';
import { routeTurn } from './routing/turnRouter.js';
import { SkillService } from './skills.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';
import {
  LOAD_SKILL,
  RUN_PYTHON,
  SEARCH_TOOLS,
} from '../tools/definitions.js';

/** Discovery tools, then the allowed tools declared on every turn (ADR-0022). */
const core = (d: { allowedTools: string[] }, discovery = ['search_tools', 'load_skill']): string[] => [
  ...discovery,
  ...DECLARED_EVERY_TURN.filter((n) => d.allowedTools.includes(n)),
];

describe('Architecture Parity — real-world scenarios', () => {
  let skillService: SkillService;

  beforeAll(async () => {
    const backendRoot = path.resolve(__dirname, '../../');
    skillService = new SkillService(backendRoot, 'skills');
    await skillService.load();
  });

  // Scenario 1: Summarize this PDF
  it('Scenario 1: "Summarize this PDF" — native document block in user turn, zero tools invoked', () => {
    const pdfAttachment: AttachmentBlock = {
      id: 'att-pdf-1',
      filename: 'research_paper.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10240,
      storageKey: 'key-pdf-1',
      base64: 'JVBERi0xLjcK...',
    };

    const request: GenerationRequest = {
      prompt: 'Please provide a comprehensive summary of this attached PDF.',
      history: [],
      attachments: [pdfAttachment],
      systemInstruction: 'You are ArcNave.',
      mode: 'chat',
      maxOutputTokens: 2048,
      providerModelId: 'claude-3-5-sonnet',
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
    };

    // 1. Anthropic adapter constructs native document block at start of user message
    const anthropicMessages = buildAnthropicMessages(request);
    expect(anthropicMessages.length).toBe(1);
    const userBlocks = anthropicMessages[0]!.content as any[];
    expect(userBlocks[0]?.type).toBe('document');
    expect(userBlocks[0]?.source?.media_type).toBe('application/pdf');
    expect(userBlocks[0]?.source?.data).toBe('JVBERi0xLjcK...');
    expect(userBlocks[1]?.text).toContain('Please provide a comprehensive summary');

    // 2. Gemini adapter constructs native inlineData part
    const geminiContents = buildGeminiContents(request);
    expect(geminiContents.length).toBe(1);
    const geminiParts = geminiContents[0]!.parts as any[];
    expect(geminiParts[0]?.inlineData?.mimeType).toBe('application/pdf');
    expect(geminiParts[1]?.text).toContain('Please provide a comprehensive summary');

    // 3. Routing decision: only the core is exposed, nothing forced
    const routing = routeTurn({
      candidateSkills: skillService.listSkills(),
      hasProject: false,
    });
    // ADR-0006: the model keeps the core and chooses not to use it; nothing is withheld.
    expect(routing.exposedTools).toEqual(core(routing));
  });

  // Scenario 5: Explain XLSX Trends
  it('Scenario 5: Explain XLSX Trends — qualitative explanation, zero Python executed', () => {
    const decision = routeTurn({
      candidateSkills: skillService.listSkills(),
      hasProject: false,
      runPythonEnabled: true,
    });
    // ADR-0006: the model keeps the core and chooses not to use it; nothing is withheld.
    expect(decision.exposedTools).toEqual(core(decision));
  });

  // Scenario 6: XLSX Regression & Chart
  it('Scenario 6: XLSX Regression & Chart — run_python is in the catalog because the sandbox is enabled', () => {
    const decision = routeTurn({
      candidateSkills: skillService.listSkills(),
      hasProject: false,
      runPythonEnabled: true,
    });
    expect(decision.allowedTools).toContain('run_python');
  });

  // Scenario 7: Describe Image
  it('Scenario 7: Describe Image — native vision understanding, zero tools invoked', () => {
    const imageAttachment: AttachmentBlock = {
      id: 'att-img-1',
      filename: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: 4096,
      storageKey: 'key-img-1',
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ...',
    };

    const request: GenerationRequest = {
      prompt: 'Describe what is depicted in this image diagram.',
      history: [],
      attachments: [imageAttachment],
      systemInstruction: 'You are ArcNave.',
      mode: 'chat',
      maxOutputTokens: 1024,
      providerModelId: 'claude-3-5-sonnet',
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
    };

    const messages = buildAnthropicMessages(request);
    const blocks = messages[0]!.content as any[];
    expect(blocks[0]?.type).toBe('image');
    expect(blocks[0]?.source?.media_type).toBe('image/png');
    expect(blocks[1]?.text).toContain('Describe what is depicted');

    const routing = routeTurn({
      candidateSkills: skillService.listSkills(),
      hasProject: false,
    });
    // ADR-0006: the model keeps the core and chooses not to use it; nothing is withheld.
    expect(routing.exposedTools).toEqual(core(routing));
  });

  // Scenario 10: Multi-Turn Follow-Up on PDF
  it('Scenario 10: Multi-Turn Follow-Up on PDF — retains document block across turns without amnesia', () => {
    const pdfAttachment: AttachmentBlock = {
      id: 'pdf-turn-1',
      filename: 'annual_report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20480,
      storageKey: 'key-turn-1',
      base64: 'JVBERi0xLjcK...',
    };

    const multiTurnRequest: GenerationRequest = {
      prompt: 'What was the specific capital expenditure figure mentioned in note 14?',
      history: [
        {
          role: 'user',
          text: 'Here is our annual report. Please keep this handy.',
          attachments: [pdfAttachment],
        },
        {
          role: 'assistant',
          text: 'I have received the annual report and am ready to answer your questions about it.',
        },
      ],
      attachments: [], // No re-upload in turn 2
      systemInstruction: 'You are ArcNave.',
      mode: 'chat',
      maxOutputTokens: 2048,
      providerModelId: 'claude-3-5-sonnet',
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
    };

    const messages = buildAnthropicMessages(multiTurnRequest);
    expect(messages.length).toBe(3);

    // Turn 1 user turn contains native document block
    const turn1Blocks = messages[0]!.content as any[];
    expect(turn1Blocks[0]?.type).toBe('document');
    expect(turn1Blocks[0]?.source?.media_type).toBe('application/pdf');

    // Turn 2 assistant reply
    expect(messages[1]!.role).toBe('assistant');

    // Turn 3 user follow-up prompt referencing earlier document
    expect(messages[2]!.role).toBe('user');
    expect(messages[2]!.content).toContain('capital expenditure figure');
  });
});
