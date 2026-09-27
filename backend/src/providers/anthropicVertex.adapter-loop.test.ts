/**
 * Adapter-loop tests at the Anthropic SDK-client boundary. `FakeAnthropicClient` stands in for
 * `AnthropicVertex` (injected via Task 6's constructor seam) and returns a scripted sequence of
 * fake message streams, proving the loop actually detects `tool_use`, invokes the
 * `ToolExecutor`, builds a `tool_result` content block, and appends both the assistant and user
 * turns before the next `messages.stream` call.
 */
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { AnthropicVertexProvider } from './anthropicVertex.js';
import type { ToolCall, ToolExecutor, ToolResult } from './types.js';
import type { GenerationRequest } from './types.js';

interface FakeStreamEvent {
  type: string;
  delta?: { type: string; text?: string; stop_reason?: string };
  message?: { usage: Record<string, number> };
  usage?: Record<string, number>;
  content_block?: unknown;
}

interface FakeFinalMessage {
  content: { type: string; id?: string; name?: string; input?: unknown }[];
  usage: Record<string, number>;
  stop_reason: string;
}

function fakeMessageStream(events: FakeStreamEvent[], final: FakeFinalMessage) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => Promise.resolve(i < events.length ? { value: events[i++]!, done: false } : { value: undefined, done: true }),
      };
    },
    finalMessage: () => Promise.resolve(final),
  };
}

class FakeAnthropicClient {
  calls: unknown[] = [];
  responses: ReturnType<typeof fakeMessageStream>[] = [];
  messages = {
    stream: vi.fn((req: unknown) => {
      this.calls.push(req);
      const next = this.responses.shift();
      if (!next) throw new Error('FakeAnthropicClient: no scripted response left');
      return next;
    }),
  };
}

class ScriptedExecutor implements ToolExecutor {
  calls: ToolCall[] = [];
  results = new Map<string, ToolResult>();
  async execute(call: ToolCall): Promise<ToolResult> {
    this.calls.push(call);
    return (
      this.results.get(call.name) ?? {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: `no scripted result for ${call.name}` }],
      }
    );
  }
}

function baseRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'What was the cooling budget?',
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

const SEARCH_TOOL = {
  name: 'search_project_files',
  description: 'Lexical keyword search.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};
const READ_TOOL = {
  name: 'read_project_file',
  description: 'Reads a file.',
  inputSchema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] },
};

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('AnthropicVertexProvider tool-calling loop', () => {
  it('allows parallel tool use and runs search then read then final text', async () => {
    const client = new FakeAnthropicClient();
    client.responses = [
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't1', name: 'search_project_files', input: { query: 'cooling' } }],
        usage: { input_tokens: 20, output_tokens: 5 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't2', name: 'read_project_file', input: { fileId: 'f1' } }],
        usage: { input_tokens: 30, output_tokens: 5 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream(
        [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Approved in March.' } }],
        {
          content: [{ type: 'text' }],
          usage: { input_tokens: 40, output_tokens: 8 },
          stop_reason: 'end_turn',
        },
      ),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 't1',
      ok: true,
      content: [{ type: 'json', data: { results: [{ fileId: 'f1' }] } }],
    });
    executor.results.set('read_project_file', {
      toolCallId: 't2',
      ok: true,
      content: [{ type: 'json', data: { content: 'Approved in March.' } }],
    });

    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL, READ_TOOL], toolExecutor: executor })),
    );

    expect(executor.calls.map((c) => c.name)).toEqual(['search_project_files', 'read_project_file']);
    expect(client.calls).toHaveLength(3);
    // Claude's default: "By default, Claude may call multiple tools in a single response".
    const firstReq = client.calls[0] as { tool_choice: { disable_parallel_tool_use?: boolean } };
    expect(firstReq.tool_choice.disable_parallel_tool_use).toBeUndefined();
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(2);
    expect(events.some((e) => e.type === 'delta' && e.text.includes('March'))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'end_turn' });

    // The user message following the assistant's tool_use must carry a tool_result block.
    const secondReq = client.calls[1] as { messages: { role: string; content: unknown }[] };
    const lastMsg = secondReq.messages.at(-1)!;
    expect(lastMsg.role).toBe('user');
    expect((lastMsg.content as { type: string }[])[0]!.type).toBe('tool_result');
  });

  it('runs every tool call of one response and returns all results in one message (ADR-0026)', async () => {
    const client = new FakeAnthropicClient();
    client.responses = [
      fakeMessageStream([], {
        content: [
          { type: 'tool_use', id: 't1', name: 'search_project_files', input: { query: 'cooling' } },
          { type: 'tool_use', id: 't2', name: 'read_project_file', input: { fileId: 'f1' } },
        ],
        usage: { input_tokens: 20, output_tokens: 5 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream(
        [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Both done.' } }],
        { content: [{ type: 'text' }], usage: { input_tokens: 40, output_tokens: 8 }, stop_reason: 'end_turn' },
      ),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', { toolCallId: 't1', ok: true, content: [{ type: 'text', text: 'found' }] });
    executor.results.set('read_project_file', { toolCallId: 't2', ok: true, content: [{ type: 'text', text: 'read' }] });

    const provider = new AnthropicVertexProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL, READ_TOOL], toolExecutor: executor })));

    expect(executor.calls.map((c) => c.name)).toEqual(['search_project_files', 'read_project_file']);
    expect(client.calls).toHaveLength(2);
    const second = client.calls[1] as { messages: { role: string; content: { type: string; tool_use_id?: string }[] }[] };
    const results = second.messages.at(-1)!;
    expect(results.role).toBe('user');
    expect(results.content.map((b) => b.tool_use_id)).toEqual(['t1', 't2']);
  });

  it('asks for summarized adaptive thinking, streams it apart from text, and keeps thinking blocks in the loop', async () => {
    const client = new FakeAnthropicClient();
    const thinkingBlock = { type: 'thinking', thinking: 'Look it up.', signature: 'sig' };
    client.responses = [
      fakeMessageStream(
        [{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Look it up.' } as never }],
        {
          content: [thinkingBlock, { type: 'tool_use', id: 't1', name: 'search_project_files', input: { query: 'x' } }],
          usage: { input_tokens: 20, output_tokens: 5 },
          stop_reason: 'tool_use',
        },
      ),
      fakeMessageStream(
        [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Found.' } }],
        { content: [{ type: 'text' }], usage: { input_tokens: 30, output_tokens: 5 }, stop_reason: 'end_turn' },
      ),
    ];
    const executor = new ScriptedExecutor();
    const provider = new AnthropicVertexProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    const events = await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })));

    const first = client.calls[0] as { thinking?: unknown };
    expect(first.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    // No effort on the request: Claude's own default applies.
    expect((first as { output_config?: unknown }).output_config).toBeUndefined();
    expect(events.filter((e) => e.type === 'thinking')).toEqual([{ type: 'thinking', text: 'Look it up.' }]);
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text)).toEqual(['Found.']);
    const second = client.calls[1] as { messages: { role: string; content: unknown }[] };
    const assistant = second.messages.find((m) => m.role === 'assistant')!;
    expect((assistant.content as { type: string }[])[0]).toEqual(thinkingBlock);
  });

  it('bills every round of the loop, and keeps the last request apart for compaction', async () => {
    const client = new FakeAnthropicClient();
    const toolRound = (id: string, usage: Record<string, number>) =>
      fakeMessageStream([], { content: [{ type: 'tool_use', id, name: 'search_project_files', input: { query: 'q' } }], usage, stop_reason: 'tool_use' });
    client.responses = [
      toolRound('t1', { input_tokens: 900, cache_creation_input_tokens: 100, output_tokens: 5 }),
      toolRound('t2', { input_tokens: 50, cache_read_input_tokens: 1000, output_tokens: 7 }),
      fakeMessageStream([], { content: [{ type: 'text' }], usage: { input_tokens: 80, cache_read_input_tokens: 1000, output_tokens: 20 }, stop_reason: 'end_turn' }),
    ];
    const provider = new AnthropicVertexProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    const events = await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: new ScriptedExecutor() })));

    expect(events.at(-1)).toEqual({
      type: 'completed',
      finishReason: 'end_turn',
      usage: {
        inputTokens: 1030,
        outputTokens: 32,
        cacheReadTokens: 2000,
        cacheWriteTokens: 100,
        exact: true,
        // "total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens"
        lastRequest: { inputTokens: 1080, outputTokens: 20 },
      },
    });
  });

  it('feeds a tool failure back as an is_error tool_result, never throws', async () => {
    const client = new FakeAnthropicClient();
    client.responses = [
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't1', name: 'search_project_files', input: {} }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream([], { content: [{ type: 'text' }], usage: { input_tokens: 12, output_tokens: 3 }, stop_reason: 'end_turn' }),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 't1',
      ok: false,
      content: [{ type: 'text', text: 'Invalid input: query is required' }],
    });
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(events.some((e) => e.type === 'tool_result' && !e.result.ok)).toBe(true);
    const secondReq = client.calls[1] as { messages: { role: string; content: { is_error?: boolean }[] }[] };
    expect(secondReq.messages.at(-1)!.content[0]!.is_error).toBe(true);
  });

  it('feeds an unknown-tool failure back without throwing', async () => {
    const client = new FakeAnthropicClient();
    client.responses = [
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't1', name: 'delete_everything', input: {} }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'tool_use',
      }),
      fakeMessageStream([], { content: [{ type: 'text' }], usage: { input_tokens: 12, output_tokens: 3 }, stop_reason: 'end_turn' }),
    ];
    const executor = new ScriptedExecutor();
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(events.some((e) => e.type === 'tool_result' && !e.result.ok)).toBe(true);
  });

  it('stops at TOOL_MAX_ROUNDS with finishReason "tool_limit"', async () => {
    const client = new FakeAnthropicClient();
    client.responses = Array.from({ length: 2 }, (_, i) =>
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: `t${String(i)}`, name: 'search_project_files', input: {} }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'tool_use',
      }),
    );
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', { toolCallId: 'x', ok: true, content: [{ type: 'text', text: 'ok' }] });
    const cfg = loadConfig({ NODE_ENV: 'test', TOOL_MAX_ROUNDS: '2' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(client.calls).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'tool_limit' });
  });

  it('stops issuing provider requests once the signal is aborted', async () => {
    const client = new FakeAnthropicClient();
    const controller = new AbortController();
    client.responses = [
      fakeMessageStream([], {
        content: [{ type: 'tool_use', id: 't1', name: 'search_project_files', input: {} }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'tool_use',
      }),
    ];
    const executor: ToolExecutor = {
      execute: async () => {
        controller.abort();
        return { toolCallId: 't1', ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
    };
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new AnthropicVertexProvider(cfg, client as never);
    await expect(
      collect(
        provider.stream(
          baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor, signal: controller.signal }),
        ),
      ),
    ).rejects.toThrow();
    expect(client.calls).toHaveLength(1);
  });
});

describe('refusal (G13)', () => {
  it('a refusal stop becomes a typed refusal event with its category, never a plain finish', async () => {
    const client = new FakeAnthropicClient();
    client.responses.push(
      fakeMessageStream([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'I can' } }], {
        content: [{ type: 'text' }],
        usage: { input_tokens: 5, output_tokens: 2 },
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: 'Could enable malware.' },
      } as FakeFinalMessage),
    );
    const provider = new AnthropicVertexProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    const events: unknown[] = [];
    for await (const e of provider.stream(baseRequest())) events.push(e);
    expect(events).toContainEqual({ type: 'refusal', category: 'cyber', explanation: 'Could enable malware.' });
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'refusal' });
  });
});

describe('AnthropicVertexProvider timeouts (ADR-0024)', () => {
  it("retries the SDK's connection failures, as Claude's SDK does, and types a timeout", async () => {
    const { APIConnectionError, APIConnectionTimeoutError } = await import('@anthropic-ai/sdk');
    for (const [err, code] of [
      [new APIConnectionTimeoutError(), 'provider_timeout'],
      [new APIConnectionError({ message: 'socket hang up' }), 'provider_error'],
    ] as const) {
      const client = new FakeAnthropicClient();
      client.messages.stream.mockImplementationOnce(() => {
        throw err;
      });
      const provider = new AnthropicVertexProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
      await expect(collect(provider.stream(baseRequest()))).rejects.toMatchObject({ code, retryable: true });
    }
  });

  it('sends the requested effort as output_config.effort', async () => {
    const client = new FakeAnthropicClient();
    client.responses = [
      fakeMessageStream(
        [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }],
        { content: [{ type: 'text' }], usage: { input_tokens: 3, output_tokens: 1 }, stop_reason: 'end_turn' },
      ),
    ];
    const provider = new AnthropicVertexProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    await collect(provider.stream(baseRequest({ reasoningEffort: 'xhigh' })));
    expect((client.calls[0] as { output_config?: unknown }).output_config).toEqual({ effort: 'xhigh' });
  });
});

describe('AnthropicVertexProvider partial tool input (ADR-0037)', () => {
  it('reports a render_ui call while it streams, from the SDK snapshot, and no other tool', async () => {
    // The SDK's MessageStream keeps `currentMessage` up to date before each event is read.
    const snapshots = [
      [{ type: 'tool_use', id: 's', name: 'search_project_files', input: { query: 'x' } }],
      [
        { type: 'tool_use', id: 's', name: 'search_project_files', input: { query: 'x' } },
        { type: 'tool_use', id: 'v', name: 'render_ui', input: { blocks: [{ type: 'visual', html: '<svg>' }] } },
      ],
    ];
    const events = [
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"x"}' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"blocks":[' } },
    ];
    let current: unknown[] = [];
    const stream = {
      get currentMessage() {
        return { content: current };
      },
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next: () => {
            if (i >= events.length) return Promise.resolve({ value: undefined, done: true });
            current = snapshots[i]!;
            return Promise.resolve({ value: events[i++]!, done: false });
          },
        };
      },
      finalMessage: () => Promise.resolve({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }),
    };
    const client = new FakeAnthropicClient();
    client.responses = [stream as never];
    const provider = new AnthropicVertexProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    const out = await collect(provider.stream(baseRequest()));
    expect(out.filter((e) => e.type === 'tool_input_partial')).toEqual([
      { type: 'tool_input_partial', index: 1, name: 'render_ui', input: { blocks: [{ type: 'visual', html: '<svg>' }] } },
    ]);
  });
});
