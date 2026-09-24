/**
 * Content construction for the Gemini/Vertex adapter.
 *
 * No network, no SDK client. Unlike Anthropic, Gemini needs no explicit cache marker in the
 * request — Vertex's implicit caching is automatic for a repeated prefix. What has to be right
 * here is purely the shape: attachments become inlineData parts ahead of the turn's text part,
 * in the same stable order every call, since a reordered prefix is what would defeat the
 * implicit cache.
 */
import { describe, expect, it } from 'vitest';

import { buildGeminiContents, toGeminiFunctionDeclaration, toGeminiFunctionResponsePart } from './gemini.js';
import { RENDER_UI } from '../tools/definitions.js';
import type { GenerationRequest } from './types.js';

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'What is this?',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: 'gemini-3.8-flash',
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('buildGeminiContents', () => {
  it('sends a text-only part for a plain turn', () => {
    expect(buildGeminiContents(baseRequest())).toEqual([
      { role: 'user', parts: [{ text: 'What is this?' }] },
    ]);
  });

  it('puts inlineData ahead of the text part for a current-turn attachment', () => {
    const contents = buildGeminiContents(
      baseRequest({ attachments: [{ mimeType: 'image/png', base64: 'AAAA' }] }),
    );
    expect(contents).toEqual([
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: 'What is this?' }],
      },
    ]);
  });

  it('formats extracted text attachment as a structured document tag ahead of prompt text', () => {
    const contents = buildGeminiContents(
      baseRequest({
        attachments: [
          {
            filename: 'data.csv',
            mimeType: 'text/csv',
            extractedText: 'col1,col2\nval1,val2',
          },
        ],
      }),
    );
    expect(contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: '<document filename="data.csv">\ncol1,col2\nval1,val2\n</document>' },
          { text: 'What is this?' },
        ],
      },
    ]);
  });

  it('carries a history attachment forward as its own part, mapping assistant to model', () => {
    const contents = buildGeminiContents(
      baseRequest({
        history: [
          {
            role: 'user',
            text: 'Look at this scan',
            attachments: [{ mimeType: 'application/pdf', base64: 'BBBB' }],
          },
          { role: 'assistant', text: 'It is a receipt.' },
        ],
      }),
    );
    expect(contents).toEqual([
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'application/pdf', data: 'BBBB' } },
          { text: 'Look at this scan' },
        ],
      },
      { role: 'model', parts: [{ text: 'It is a receipt.' }] },
      { role: 'user', parts: [{ text: 'What is this?' }] },
    ]);
  });
});

describe('toGeminiFunctionDeclaration', () => {
  it('maps name/description and uses parametersJsonSchema, not parameters', () => {
    const decl = toGeminiFunctionDeclaration({
      name: 'search_project_files',
      description: 'Lexical keyword search.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    });
    expect(decl).toEqual({
      name: 'search_project_files',
      description: 'Lexical keyword search.',
      parametersJsonSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    });
  });

  it('deep-clones the input schema so the SDK cannot mutate the shared ToolDefinition', () => {
    const original = { type: 'object', properties: { query: { type: 'string' } } };
    const decl = toGeminiFunctionDeclaration({ name: 'x', description: 'x', inputSchema: original });
    (decl.parametersJsonSchema as Record<string, unknown>)['type'] = 'MUTATED';
    expect(original['type']).toBe('object');
  });

  it('converts RENDER_UI tool definition to valid Gemini function declaration', () => {
    const decl = toGeminiFunctionDeclaration(RENDER_UI);
    expect(decl.name).toBe('render_ui');
    expect(decl.description).toContain('interactive generative UI layout');
    expect(decl.parametersJsonSchema).toBeDefined();
    expect((decl.parametersJsonSchema as Record<string, unknown>)['type']).toBe('object');
  });
});

describe('toGeminiFunctionResponsePart', () => {
  it('nests images inside the functionResponse (Gemini 3 multimodal function response)', () => {
    const part = toGeminiFunctionResponsePart('run_python', 'call-1', {
      toolCallId: 'call-1',
      ok: true,
      content: [
        { type: 'json', data: { stdout: '' } },
        { type: 'image', name: 'p3.png', mimeType: 'image/png', base64: 'AAAA' },
      ],
    });
    expect(part).toEqual({
      functionResponse: {
        id: 'call-1',
        name: 'run_python',
        response: { output: { stdout: '' } },
        parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }],
      },
    });
  });

  it('wraps a successful structured result under "output"', () => {
    const part = toGeminiFunctionResponsePart('search_project_files', 'call-1', {
      toolCallId: 'call-1',
      ok: true,
      content: [{ type: 'json', data: { results: [] } }],
    });
    expect(part).toEqual({
      functionResponse: {
        id: 'call-1',
        name: 'search_project_files',
        response: { output: { results: [] } },
      },
    });
  });

  it('wraps a failed result under "error" as a string', () => {
    const part = toGeminiFunctionResponsePart('read_project_file', 'call-2', {
      toolCallId: 'call-2',
      ok: false,
      content: [{ type: 'text', text: 'No indexed file with that id.' }],
    });
    expect(part).toEqual({
      functionResponse: {
        id: 'call-2',
        name: 'read_project_file',
        response: { error: 'No indexed file with that id.' },
      },
    });
  });
});
