/**
 * The Claude adapter's gateway guarantees (tech-build.3 Part A, ADR-0064):
 *
 * - thinking and redacted_thinking blocks go back inside the tool loop complete, unmodified and
 *   in order, signatures included (Claude docs, Thinking: "Pass every `thinking` block back to
 *   the API complete and unmodified"; "you can't rearrange, edit, or partially drop them. This
 *   includes `redacted_thinking` blocks") — D2 CC4 / Stage 7 MR10;
 * - the client the adapter builds makes one HTTP request per call (`maxRetries: 0`, ER-1a),
 *   checked on the wire with a stubbed fetch, not only on the option.
 *
 * Nothing here reaches the network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { AnthropicProvider, createAnthropicClient } from './anthropic.js';
import type { GenerationRequest, ToolExecutor, ToolResult } from './types.js';

function fakeMessageStream(final: { content: unknown[]; stop_reason: string }) {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve({ value: undefined, done: true }) };
    },
    finalMessage: () => Promise.resolve({ ...final, usage: { input_tokens: 10, output_tokens: 2 } }),
  };
}

class FakeClient {
  calls: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  responses: ReturnType<typeof fakeMessageStream>[] = [];
  messages = {
    stream: vi.fn((req: never) => {
      // The loop's `messages` array is rebuilt each round, so the request seen here is a snapshot.
      this.calls.push(structuredClone(req));
      const next = this.responses.shift();
      if (!next) throw new Error('no scripted response left');
      return next;
    }),
  };
}

const SEARCH_TOOL = { name: 'search_project_files', description: 'Search.', inputSchema: { type: 'object', properties: {} } };

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'find it',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: 'claude-sonnet-5-5',
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('thinking blocks in the tool loop (D2 CC4, Stage 7 MR10)', () => {
  it('replays thinking and redacted_thinking blocks with their signatures, unmodified and in order, every round', async () => {
    const round1 = [
      { type: 'thinking', thinking: 'First, search.', signature: 'EqQBCgIYAhIM1gbcDa9GJwZA2b-round1' },
      { type: 'redacted_thinking', data: 'EmwKAhgBEgy3va3pzix/LafPsn4aDFIT2Xlxh0L5L8rLVyIwxtE3rAFBa8cr3qpPkNRj2YfWXGmKDxH4mPnZ5sQ7vB5URj' },
      { type: 'tool_use', id: 't1', name: 'search_project_files', input: { q: 'a' } },
    ];
    const round2 = [
      { type: 'thinking', thinking: '', signature: 'Es8CCkYICxIM-round2-omitted-display' },
      { type: 'tool_use', id: 't2', name: 'search_project_files', input: { q: 'b' } },
    ];
    const client = new FakeClient();
    client.responses = [
      fakeMessageStream({ content: round1, stop_reason: 'tool_use' }),
      fakeMessageStream({ content: round2, stop_reason: 'tool_use' }),
      fakeMessageStream({ content: [{ type: 'text', text: 'Found.' }], stop_reason: 'end_turn' }),
    ];
    const executor: ToolExecutor = {
      execute: async (c): Promise<ToolResult> => ({ toolCallId: c.id, ok: true, content: [{ type: 'text', text: 'hit' }] }),
    };
    const provider = new AnthropicProvider(loadConfig({ NODE_ENV: 'test', TOOL_MAX_ROUNDS: '8' }), client as never);
    await collect(provider.stream(request({ tools: [SEARCH_TOOL], toolExecutor: executor })));

    const third = client.calls[2]!.messages;
    const assistants = third.filter((m) => m.role === 'assistant').map((m) => m.content);
    expect(assistants).toEqual([round1, round2]);
    // Each assistant turn is followed by the results of its own calls.
    expect(third.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
  });

  it('keeps the blocks of a paused turn too when it resumes it (pause_turn)', async () => {
    const paused = [
      { type: 'thinking', thinking: 'Searching the web.', signature: 'sig-paused' },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
    ];
    const client = new FakeClient();
    client.responses = [
      fakeMessageStream({ content: paused, stop_reason: 'pause_turn' }),
      fakeMessageStream({ content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' }),
    ];
    const provider = new AnthropicProvider(loadConfig({ NODE_ENV: 'test', ENABLE_ANTHROPIC_WEB_SEARCH: 'true' }), client as never);
    await collect(provider.stream(request({ grounded: true })));
    expect(client.calls[1]!.messages.at(-1)).toEqual({ role: 'assistant', content: paused });
  });
});

describe('the Claude client makes one request per call (ER-1a)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a 529 is one fetch, not the SDK default of three', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), {
        status: 529,
        headers: { 'content-type': 'application/json' },
      }),
    );
    // The SDK takes the global fetch when the client is built.
    vi.stubGlobal('fetch', fetchSpy);
    const client = createAnthropicClient(loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'test-key-not-real' }));
    await expect(
      client.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ status: 529 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
