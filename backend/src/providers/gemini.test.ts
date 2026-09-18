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

import { buildGeminiContents } from './gemini.js';
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
