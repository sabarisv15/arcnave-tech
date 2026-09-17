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

import { buildAnthropicMessages } from './anthropicVertex.js';
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
      baseRequest({ attachments: [{ mimeType: 'application/pdf', base64: 'BBBB' }] }),
    );
    const blocks = messages[0]!.content as Array<{ type: string; source?: { media_type?: string } }>;
    expect(blocks[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' },
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
