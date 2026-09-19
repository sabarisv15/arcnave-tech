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
  it('sends disable_parallel_tool_use and runs search then read then final text', async () => {
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
    const firstReq = client.calls[0] as { tool_choice: { disable_parallel_tool_use: boolean } };
    expect(firstReq.tool_choice.disable_parallel_tool_use).toBe(true);
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
