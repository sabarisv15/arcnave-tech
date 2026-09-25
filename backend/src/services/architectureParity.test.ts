import path from 'node:path';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { DECLARED_EVERY_TURN } from '../tools/registry.js';

import { buildAnthropicMessages } from '../providers/anthropicVertex.js';
import { buildGeminiContents } from '../providers/gemini.js';
import type { AttachmentBlock, GenerationRequest } from '../providers/types.js';
import { deliverableValidator } from './qa/deliverableValidator.js';
import { routeTurn } from './routing/turnRouter.js';
import { SkillService } from './skills.js';
import { DeliverableToolExecutor } from '../tools/deliverableExecutor.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';
import { SkillToolExecutor } from '../tools/skillExecutor.js';
import {
  GENERATE_DELIVERABLE,
  LOAD_SKILL,
  RUN_PYTHON,
  SEARCH_TOOLS,
} from '../tools/definitions.js';

/** Discovery tools, then the allowed tools declared on every turn (ADR-0022). */
const core = (d: { allowedTools: string[] }, discovery = ['search_tools', 'load_skill']): string[] => [
  ...discovery,
  ...DECLARED_EVERY_TURN.filter((n) => d.allowedTools.includes(n)),
];

describe('Architecture Parity — 10 Real-World Target Scenarios', () => {
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

    // 3. Routing decision: explanatory intent is telemetry; only the core is exposed, nothing forced
    const routing = routeTurn({
      prompt: request.prompt,
      mode: 'chat',
      hasAttachments: true,
      attachmentMimeTypes: ['application/pdf'],
      candidateSkills: skillService.listSkills(),
      hasProject: false,
    });
    expect(routing.detectedIntent).toBe('EXPLANATION');
    // ADR-0006: the model keeps the core and chooses not to use it; nothing is withheld.
    expect(routing.exposedTools).toEqual(core(routing));
    expect(routing.pythonExposed).toBe(false);
  });

  // Scenario 2: Bank Statement PDF to Excel
  it('Scenario 2: Bank Statement PDF to Excel — model evaluates task, loads xlsx skill, discovers deliverable tool, 3-level QA passes', async () => {
    // 1. Skill evaluation: model evaluates task and invokes load_skill({ name: 'xlsx' })
    const skillExecutor = new SkillToolExecutor(skillService);
    const skillResult = await skillExecutor.execute(
      { id: 'call-skill-1', name: 'load_skill', input: { name: 'xlsx' } },
      new AbortController().signal,
    );
    expect(skillResult.ok).toBe(true);
    const skillData = (skillResult.content[0] as any).data;
    expect(skillData.name).toBe('xlsx');
    expect(skillData.content).toContain('Spreadsheet');

    // 2. Tool discovery: model determines tool required, searches catalog
    const catalog = [SEARCH_TOOLS, LOAD_SKILL, GENERATE_DELIVERABLE, RUN_PYTHON];
    const searchExecutor = new SearchToolsExecutor(catalog);
    const searchResult = await searchExecutor.execute(
      { id: 'call-search-1', name: 'search_tools', input: { query: 'excel spreadsheet deliverable' } },
      new AbortController().signal,
    );
    expect(searchResult.ok).toBe(true);
    const searchData = (searchResult.content[0] as any).data;
    expect(searchData.tools.some((t: any) => t.name === 'generate_deliverable')).toBe(true);

    // 3. Deliverable execution with structured extracted data
    const mockStorage = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() } as any;
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'att-new-xlsx', filename: 'bank_statement.xlsx' }]),
        }),
      }),
    } as any;

    const deliverableExecutor = new DeliverableToolExecutor(
      mockStorage,
      mockDb,
      'user-1',
      'chat-1',
      'msg-1',
    );

    const deliverableResult = await deliverableExecutor.execute(
      {
        id: 'call-gen-1',
        name: 'generate_deliverable',
        input: {
          format: 'xlsx',
          title: 'Bank_Statement_Summary',
          content:
            '# Account Summary\n\n' +
            '| Date | Description | Deposits | Withdrawals | Balance |\n' +
            '|---|---|---|---|---|\n' +
            '| 2026-09-01 | Opening Balance | 10000.00 | 0.00 | 10000.00 |\n' +
            '| 2026-09-05 | Client Retainer | 5000.00 | 0.00 | 15000.00 |\n' +
            '| 2026-09-12 | Software Subscription | 0.00 | 150.00 | 14850.00 |',
        },
      },
      new AbortController().signal,
    );

    expect(deliverableResult.ok).toBe(true);
    const resultData = (deliverableResult.content[1] as any).data;
    expect(resultData.qaReport.passed).toBe(true);
    expect(resultData.qaReport.level1Structural.passed).toBe(true);
    expect(resultData.qaReport.level2Semantic.passed).toBe(true);
    expect(resultData.qaReport.level3Visual.passed).toBe(true);
  });

  // Scenario 3: PDF to Word
  it('Scenario 3: PDF to Word — model uses docx skill & generate_deliverable format docx', async () => {
    const mockStorage = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() } as any;
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'att-new-docx', filename: 'converted.docx' }]),
        }),
      }),
    } as any;

    const deliverableExecutor = new DeliverableToolExecutor(
      mockStorage,
      mockDb,
      'user-1',
      'chat-1',
      'msg-1',
    );

    const result = await deliverableExecutor.execute(
      {
        id: 'call-docx-1',
        name: 'generate_deliverable',
        input: {
          format: 'docx',
          title: 'Executive_Summary',
          content:
            '# Executive Summary\n\n' +
            '## Key Findings\n\n' +
            'This report provides detailed analysis of quarterly performance.\n\n' +
            '| Metric | Value |\n|---|---|\n| Growth | 24% |\n| Retention | 98% |',
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = (result.content[1] as any).data;
    expect(data.qaReport.passed).toBe(true);
    expect(data.qaReport.format).toBe('docx');
  });

  // Scenario 4: PDF to PowerPoint
  it('Scenario 4: PDF to PowerPoint — model uses pptx skill & 16:9 visual verification passes', async () => {
    const mockStorage = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn() } as any;
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'att-new-pptx', filename: 'presentation.pptx' }]),
        }),
      }),
    } as any;

    const deliverableExecutor = new DeliverableToolExecutor(
      mockStorage,
      mockDb,
      'user-1',
      'chat-1',
      'msg-1',
    );

    const result = await deliverableExecutor.execute(
      {
        id: 'call-pptx-1',
        name: 'generate_deliverable',
        input: {
          format: 'pptx',
          title: 'Strategy_Deck',
          content:
            '# Strategy 2027\n\nOverview of core strategic objectives.\n\n---\n\n' +
            '# Market Expansion\n\n- Regional rollout in Q1\n- Enterprise pilot in Q2\n\n---\n\n' +
            '# Financial Projections\n\n- ARR target: $50M\n- Operating margin: 28%',
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = (result.content[1] as any).data;
    expect(data.qaReport.passed).toBe(true);
    expect(data.qaReport.level3Visual.passed).toBe(true);
  });

  // Scenario 5: Explain XLSX Trends
  it('Scenario 5: Explain XLSX Trends — qualitative explanation, zero Python executed', () => {
    const decision = routeTurn({
      prompt: 'Explain the revenue and EBITDA trends shown in this spreadsheet',
      mode: 'chat',
      hasAttachments: true,
      attachmentMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      candidateSkills: skillService.listSkills(),
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('EXPLANATION');
    // ADR-0006: the model keeps the core and chooses not to use it; nothing is withheld.
    expect(decision.exposedTools).toEqual(core(decision));
    expect(decision.pythonExposed).toBe(false);
  });

  // Scenario 6: XLSX Regression & Chart
  it('Scenario 6: XLSX Regression & Chart — computation intent correctly enables run_python in catalog', () => {
    const decision = routeTurn({
      prompt: 'Run a linear regression on this spreadsheet data and plot a scatter chart with line of best fit',
      mode: 'chat',
      hasAttachments: true,
      attachmentMimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      candidateSkills: skillService.listSkills(),
      hasProject: false,
      runPythonEnabled: true,
    });

    expect(decision.detectedIntent).toBe('COMPUTATION');
    expect(decision.allowedTools).toContain('run_python');
    expect(decision.pythonExposed).toBe(true);
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
      prompt: request.prompt,
      mode: 'chat',
      hasAttachments: true,
      attachmentMimeTypes: ['image/png'],
      candidateSkills: skillService.listSkills(),
      hasProject: false,
    });
    expect(routing.detectedIntent).toBe('EXPLANATION');
    // ADR-0006: the model keeps the core and chooses not to use it; nothing is withheld.
    expect(routing.exposedTools).toEqual(core(routing));
  });

  // Scenario 8: Generate Image
  it('Scenario 8: Generate Image — routeTurn detects IMAGE_GENERATION and allows generate_image', () => {
    const decision = routeTurn({
      prompt: 'Generate an illustration of a vintage grandfather clock on a mantelpiece',
      mode: 'chat',
      hasAttachments: false,
      candidateSkills: skillService.listSkills(),
      hasProject: false,
      imageEnabled: true,
    });

    expect(decision.detectedIntent).toBe('IMAGE_GENERATION');
    expect(decision.allowedTools).toContain('generate_image');
    expect(decision.exposedTools).toContain('search_tools');
  });

  // Scenario 9: Update DOCX Styles
  it('Scenario 9: Update DOCX Styles — loads docx skill and verifies document styling', async () => {
    const skill = skillService.getSkill('docx');
    expect(skill).not.toBeNull();
    expect(skill?.content).toContain('Typography & Clean Layout');

    const validZip = new JSZip();
    validZip.file('[Content_Types].xml', '<Types></Types>');
    validZip.file('word/document.xml', '<w:document></w:document>');
    validZip.file('dummy.txt', 'a'.repeat(300));
    const buf = await validZip.generateAsync({ type: 'nodebuffer' });

    const qa = await deliverableValidator.validate(buf, 'docx', '# Title\n\n## Subheading\n\nContent');
    expect(qa.passed).toBe(true);
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
