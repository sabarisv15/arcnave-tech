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

import { buildGeminiContents, toGeminiFunctionDeclaration, toGeminiFunctionResponsePart, usageFrom } from './gemini.js';
import { UI_TOOL_DEFINITIONS } from '../tools/definitions.js';
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

  it('declares show_widget, read_me and every display card in plain JSON Schema', () => {
    for (const def of UI_TOOL_DEFINITIONS) {
      const decl = toGeminiFunctionDeclaration(def);
      expect(decl.name).toBe(def.name);
      expect((decl.parametersJsonSchema as Record<string, unknown>)['type']).toBe('object');
      // ADR-0048: no $ref, anyOf or null types, which one provider or the other rejects.
      expect(JSON.stringify(def.inputSchema), def.name).not.toMatch(/"\$ref"|"\$defs"|"anyOf"|"oneOf"|"null"/);
    }
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

describe('replaying an earlier turn\'s parallel calls (ADR-0026)', () => {
  const tool = { name: 'search_project_files', description: 'd', inputSchema: { type: 'object' } };
  const call = (id: string, sig?: string) => ({
    id,
    name: 'search_project_files',
    input: { query: id },
    result: { toolCallId: id, ok: true, content: [{ type: 'text' as const, text: id }] },
    ...(sig ? { thoughtSignature: sig } : {}),
  });

  it('puts calls from one response back in one model turn, with their responses in one user turn', () => {
    // Gemini signs only the first call of a parallel response: a, b were one response; c another.
    const contents = buildGeminiContents(
      baseRequest({
        tools: [tool],
        history: [
          { role: 'user', text: 'find a and b' },
          { role: 'assistant', text: 'done', toolCalls: [call('a', 's1'), call('b'), call('c', 's2')] },
        ],
      }),
    );
    const replay = contents.slice(1, 5);
    expect(replay.map((c) => c.role)).toEqual(['model', 'user', 'model', 'user']);
    expect(replay[0]!.parts!.map((p) => p.functionCall?.name && p.thoughtSignature)).toEqual(['s1', undefined]);
    expect(replay[1]!.parts!.map((p) => p.functionResponse?.id)).toEqual(['a', 'b']);
    expect(replay[2]!.parts!.map((p) => p.thoughtSignature)).toEqual(['s2']);
  });

  it('falls back to text when the turn\'s first call is unsigned', () => {
    const contents = buildGeminiContents(
      baseRequest({
        tools: [tool],
        history: [
          { role: 'user', text: 'x' },
          { role: 'assistant', text: 'done', toolCalls: [call('a'), call('b', 's1')] },
        ],
      }),
    );
    expect(contents.some((c) => c.parts?.some((p) => p.functionCall))).toBe(false);
  });
});

describe('usageFrom', () => {
  it('bills thinking as output, and leaves it out of the context the next request resends', () => {
    const usage = usageFrom({ promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 800 });
    expect(usage.outputTokens).toBe(1000);
    expect(usage.lastRequest).toEqual({ inputTokens: 1000, outputTokens: 200 });
    expect(usage.exact).toBe(true);
  });

  it('counts cached prompt tokens once, as cache reads, since promptTokenCount includes them', () => {
    const usage = usageFrom({ promptTokenCount: 10_000, cachedContentTokenCount: 8_000, candidatesTokenCount: 100 });
    expect(usage.inputTokens).toBe(2_000);
    expect(usage.cacheReadTokens).toBe(8_000);
    // The next request still resends the whole prompt, cached part included.
    expect(usage.lastRequest).toEqual({ inputTokens: 10_000, outputTokens: 100 });
  });
});
