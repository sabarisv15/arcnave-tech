/**
 * Message construction for the Anthropic/Vertex adapter.
 *
 * No network, no SDK client — `buildAnthropicMessages` is a pure function of
 * `GenerationRequest`. What matters here: image/PDF attachments become the right block shape,
 * text-only turns stay a plain string (cheapest wire shape), and the cache_control breakpoint
 * lands on exactly one block — the last one of the second-to-last message — never on the
 * newest user turn, which is different on every call by definition.
 */
import { describe, expect, it } from 'vitest';

import { buildAnthropicMessages, toAnthropicTool, toAnthropicToolResultBlock } from './anthropicVertex.js';
import type { GenerationRequest } from './types.js';

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'What is this?',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: 'claude-sonnet-5',
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('buildAnthropicMessages', () => {
  it('sends a plain string for a text-only turn, matching today\'s wire shape', () => {
    const messages = buildAnthropicMessages(baseRequest());
    expect(messages).toEqual([{ role: 'user', content: 'What is this?' }]);
  });

  it('puts an image block before the text block for an attachment on the current turn', () => {
    const messages = buildAnthropicMessages(
      baseRequest({ attachments: [{ mimeType: 'image/png', base64: 'AAAA' }] }),
    );
    expect(messages).toHaveLength(1);
    const content = messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as Array<{ type: string }>;
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text']);
    expect(blocks[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(blocks[1]).toMatchObject({ type: 'text', text: 'What is this?' });
  });

  it('sends a PDF as a document block, not an image block', () => {
    const messages = buildAnthropicMessages(
      baseRequest({ attachments: [{ mimeType: 'application/pdf', base64: 'BBBB', filename: 'report.pdf' }] }),
    );
    const blocks = messages[0]!.content as Array<{ type: string; title?: string; source?: { media_type?: string } }>;
    expect(blocks[0]).toMatchObject({
      type: 'document',
      title: 'report.pdf',
      source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' },
    });
  });

  it('sends an extracted text attachment as a document block with PlainTextSource and title', () => {
    const messages = buildAnthropicMessages(
      baseRequest({
        attachments: [
          {
            filename: 'financial_model.csv',
            mimeType: 'text/csv',
            extractedText: 'Q1,Q2,Q3\n10,20,30',
          },
        ],
      }),
    );
    const blocks = messages[0]!.content as Array<{
      type: string;
      title?: string;
      source?: { type: string; media_type: string; data: string };
    }>;
    expect(blocks[0]).toMatchObject({
      type: 'document',
      title: 'financial_model.csv',
      source: {
        type: 'text',
        media_type: 'text/plain',
        data: 'Q1,Q2,Q3\n10,20,30',
      },
    });
  });

  it('carries a history attachment forward as its own block', () => {
    const messages = buildAnthropicMessages(
      baseRequest({
        history: [
          {
            role: 'user',
            text: 'Look at this photo',
            attachments: [{ mimeType: 'image/jpeg', base64: 'CCCC' }],
          },
          { role: 'assistant', text: 'I see a cat.' },
        ],
      }),
    );
    expect(messages).toHaveLength(3);
    const firstBlocks = messages[0]!.content as Array<{ type: string }>;
    expect(firstBlocks.map((b) => b.type)).toEqual(['image', 'text']);
    // messages[1] is the second-to-last message, so it also picks up the cache_control
    // breakpoint described in the next test — caching applies independent of whether any
    // particular turn has an attachment, so this is not a bare string here.
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'I see a cat.', cache_control: { type: 'ephemeral' } }],
    });
    expect(messages[2]).toEqual({ role: 'user', content: 'What is this?' });
  });

  it('caches through the second-to-last message, never the newest user turn', () => {
    const messages = buildAnthropicMessages(
      baseRequest({
        history: [
          { role: 'user', text: 'First question' },
          { role: 'assistant', text: 'First answer' },
        ],
      }),
    );
    expect(messages).toHaveLength(3);
    // The cached message (index 1, "First answer") gets wrapped into a block array so the
    // cache_control marker has somewhere to live, even though it started as a plain string.
    const cached = messages[1]!.content as Array<{ cache_control?: unknown }>;
    expect(cached[cached.length - 1]!.cache_control).toEqual({ type: 'ephemeral' });
    // Neither the first message nor the newest user turn is cached.
    expect(typeof messages[0]!.content).toBe('string');
    expect(messages[2]!.content).toBe('What is this?');
  });

  it('does not add a cache breakpoint to a single-turn conversation', () => {
    const messages = buildAnthropicMessages(baseRequest());
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe('What is this?');
  });
});

describe('toAnthropicTool', () => {
  it('maps name/description/input_schema', () => {
    const tool = toAnthropicTool({
      name: 'search_project_files',
      description: 'Lexical keyword search.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    });
    expect(tool).toEqual({
      name: 'search_project_files',
      description: 'Lexical keyword search.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    });
  });

  it('deep-clones the input schema', () => {
    const original = { type: 'object', properties: { query: { type: 'string' } } };
    const tool = toAnthropicTool({ name: 'x', description: 'x', inputSchema: original });
    (tool.input_schema as Record<string, unknown>)['type'] = 'MUTATED';
    expect(original['type']).toBe('object');
  });
});

describe('toAnthropicToolResultBlock', () => {
  it('sends images as image blocks after the text', () => {
    const block = toAnthropicToolResultBlock('call-1', {
      toolCallId: 'call-1',
      ok: true,
      content: [
        { type: 'json', data: { stdout: '' } },
        { type: 'image', name: 'p3.png', mimeType: 'image/png', base64: 'AAAA' },
      ],
    });
    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'call-1',
      is_error: false,
      content: [
        { type: 'text', text: JSON.stringify({ stdout: '' }) },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ],
    });
  });

  it('serialises a successful structured result as JSON text, is_error unset', () => {
    const block = toAnthropicToolResultBlock('call-1', {
      toolCallId: 'call-1',
      ok: true,
      content: [{ type: 'json', data: { results: [] } }],
    });
    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'call-1',
      content: JSON.stringify({ results: [] }),
      is_error: false,
    });
  });

  it('serialises a failed result as plain text with is_error true', () => {
    const block = toAnthropicToolResultBlock('call-2', {
      toolCallId: 'call-2',
      ok: false,
      content: [{ type: 'text', text: 'No indexed file with that id.' }],
    });
    expect(block).toEqual({
      type: 'tool_result',
      tool_use_id: 'call-2',
      content: 'No indexed file with that id.',
      is_error: true,
    });
  });
});
