/**
 * The first-party Claude API adapter (ADR-0054): how the client is built, how failures are
 * classified against the Stage 15 matrix, and the server-tool resume. A fake client stands in
 * for the SDK; nothing here reaches the network.
 */
import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { AnthropicProvider, classifyAnthropicError, createAnthropicClient } from './anthropic.js';
import type { GenerationRequest, ProviderEvent } from './types.js';
import { ModelNotFoundError, ProviderError } from './types.js';

function apiError(status: number, message: string, headers: Record<string, string> = {}, type?: string): APIError {
  return APIError.generate(status, { type: 'error', error: { type: type ?? 'api_error', message } }, message, new Headers(headers));
}

describe('createAnthropicClient', () => {
  it('turns the SDK retries off and takes the request timeout from config (ER-1, N-43)', () => {
    const client = createAnthropicClient(loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k', PROVIDER_TIMEOUT_MS: '1234' }));
    expect(client.maxRetries).toBe(0);
    expect(client.timeout).toBe(1234);
  });

  it('refuses to build without a key, as the typed model_unavailable', () => {
    expect(() => createAnthropicClient(loadConfig({ NODE_ENV: 'test' }))).toThrow(ProviderError);
  });
});

describe('classifyAnthropicError (Stage 15 ER-2)', () => {
  it.each([408, 409, 429, 500, 502, 503, 504, 529])('treats %i as transient', (status) => {
    expect(classifyAnthropicError(apiError(status, 'busy'), 'claude-opus-5-5').retryable).toBe(true);
  });

  it.each([400, 401, 403, 413])('never retries %i', (status) => {
    expect(classifyAnthropicError(apiError(status, 'no'), 'claude-opus-5-5').retryable).toBe(false);
  });

  it('reports a missing model as model_unavailable, not a retry', () => {
    const err = classifyAnthropicError(apiError(404, 'model: not found'), 'claude-opus-5-5');
    expect(err).toBeInstanceOf(ModelNotFoundError);
    expect(err.code).toBe('model_unavailable');
  });

  it('treats an account limit as provider_limit and never retries it', () => {
    const spend = classifyAnthropicError(apiError(429, 'enforced_spend_limit_reached', {}, 'rate_limit_error'), 'm');
    const usage = classifyAnthropicError(apiError(400, 'You have reached your specified workspace API usage limits'), 'm');
    const billing = classifyAnthropicError(apiError(402, 'billing', {}, 'billing_error'), 'm');
    for (const err of [spend, usage, billing]) {
      expect(err.code).toBe('provider_limit');
      expect(err.retryable).toBe(false);
    }
  });

  it('carries the provider Retry-After so the gateway can honour it (seconds and ms forms)', () => {
    expect(classifyAnthropicError(apiError(429, 'slow down', { 'retry-after': '3' }), 'm').retryAfterMs).toBe(3000);
    expect(classifyAnthropicError(apiError(529, 'overloaded', { 'retry-after-ms': '250' }), 'm').retryAfterMs).toBe(250);
    expect(classifyAnthropicError(apiError(500, 'oops'), 'm').retryAfterMs).toBeUndefined();
  });
});

function stream(final: { content: unknown[]; stop_reason: string; usage?: Record<string, number> }, events: unknown[] = []) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => Promise.resolve(i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true }) };
    },
    finalMessage: () => Promise.resolve({ usage: { input_tokens: 10, output_tokens: 2 }, ...final }),
  };
}

function request(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'Who won?',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: 'claude-sonnet-5-5',
    grounded: true,
    codeExecution: false,
    signal: new AbortController().signal,
    ...over,
  };
}

async function collect(gen: AsyncGenerator<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('AnthropicProvider on the first-party API', () => {
  const cfg = loadConfig({ NODE_ENV: 'test', ENABLE_ANTHROPIC_WEB_SEARCH: 'true' });

  it('declares the 2026-02-09 web search tool the first-party API serves', async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      messages: {
        stream: vi.fn((req: Record<string, unknown>) => {
          calls.push(req);
          return stream({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }, [
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
          ]);
        }),
      },
    };
    await collect(new AnthropicProvider(cfg, client as never).stream(request()));
    expect(calls[0]!['tools']).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]);
    // No sampling parameters are ever sent (build rules).
    expect(Object.keys(calls[0]!)).not.toEqual(expect.arrayContaining(['temperature']));
    expect(calls[0]!).not.toHaveProperty('top_p');
    expect(calls[0]!).not.toHaveProperty('top_k');
  });

  it('resumes a paused server tool by sending the paused turn back, with no new user message', async () => {
    const calls: { messages: { role: string; content: unknown }[] }[] = [];
    const paused = [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'q' } }];
    const responses = [
      stream({ content: paused, stop_reason: 'pause_turn' }),
      stream({ content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }, [
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
      ]),
    ];
    const client = {
      messages: {
        stream: vi.fn((req: { messages: { role: string; content: unknown }[] }) => {
          calls.push(structuredClone(req));
          return responses.shift()!;
        }),
      },
    };
    const events = await collect(new AnthropicProvider(cfg, client as never).stream(request()));
    expect(calls).toHaveLength(2);
    const second = calls[1]!.messages;
    expect(second.at(-1)).toEqual({ role: 'assistant', content: paused });
    expect(second.filter((m) => m.role === 'user')).toHaveLength(1);
    const done = events.at(-1) as Extract<ProviderEvent, { type: 'completed' }>;
    expect(done.finishReason).toBe('end_turn');
    // Both requests are billed: usage sums every request of the loop (ADR-0021).
    expect(done.usage.inputTokens).toBe(20);
  });

  it('turns a dropped connection into a retryable error for the gateway to retry', async () => {
    const client = {
      messages: {
        stream: vi.fn(() => {
          throw new APIConnectionError({ message: 'socket hang up' });
        }),
      },
    };
    await expect(collect(new AnthropicProvider(cfg, client as never).stream(request()))).rejects.toMatchObject({
      retryable: true,
    });
  });
});
