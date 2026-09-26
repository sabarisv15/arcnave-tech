/**
 * Adapter-loop tests at the Gemini SDK-client boundary.
 *
 * `FakeGeminiClient` stands in for `GoogleGenAI` itself — it is injected via `GeminiProvider`'s
 * second constructor argument (Task 6) and returns a scripted sequence of chunk streams, one per
 * round, so this test proves the loop actually detects a `functionCall`, invokes the
 * `ToolExecutor`, builds a `functionResponse`, and sends the next request — not just that
 * `ProviderEvent`s get relayed once already produced.
 */
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import type { ToolCall, ToolExecutor, ToolResult } from './types.js';
import { GeminiProvider } from './gemini.js';
import type { GenerationRequest } from './types.js';

interface FakeChunk {
  text?: string;
  functionCalls?: { id?: string; name: string; args?: Record<string, unknown> }[];
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { functionCall?: unknown; thoughtSignature?: string }[] };
  }[];
}

function fakeStream(chunks: FakeChunk[]): AsyncIterable<FakeChunk> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () => Promise.resolve(i < chunks.length ? { value: chunks[i++]!, done: false } : { value: undefined, done: true }),
      };
    },
  };
}

class FakeGeminiClient {
  calls: unknown[] = [];
  responses: AsyncIterable<FakeChunk>[] = [];
  models = {
    generateContentStream: vi.fn(async (req: unknown) => {
      this.calls.push(req);
      const next = this.responses.shift();
      if (!next) throw new Error('FakeGeminiClient: no scripted response left');
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
    providerModelId: 'gemini-3.8-flash',
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

describe('GeminiProvider tool-calling loop', () => {
  it('runs search then read, then emits final text', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'search_project_files', args: { query: 'cooling' } }] }]),
      fakeStream([{ functionCalls: [{ id: 'c2', name: 'read_project_file', args: { fileId: 'f1' } }] }]),
      fakeStream([
        { text: 'The cooling budget was approved in March.' },
        { usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 }, candidates: [{ finishReason: 'STOP' }] },
      ]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 'c1',
      ok: true,
      content: [{ type: 'json', data: { results: [{ fileId: 'f1' }] } }],
    });
    executor.results.set('read_project_file', {
      toolCallId: 'c2',
      ok: true,
      content: [{ type: 'json', data: { content: 'Approved in March.' } }],
    });

    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(
      provider.stream(
        baseRequest({ tools: [SEARCH_TOOL, READ_TOOL], toolExecutor: executor }),
      ),
    );

    expect(executor.calls.map((c) => c.name)).toEqual(['search_project_files', 'read_project_file']);
    expect(executor.calls[1]!.input).toEqual({ fileId: 'f1' });
    expect(client.calls).toHaveLength(3);
    expect(events.filter((e) => e.type === 'tool_use')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(2);
    expect(events.some((e) => e.type === 'delta' && e.text.includes('March'))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'STOP' });
  });

  it('bills every round of the loop, and keeps the last request apart for compaction', async () => {
    const call = (id: string): FakeChunk => ({ functionCalls: [{ id, name: 'search_project_files', args: { query: 'q' } }] });
    const usage = (prompt: number, out: number): FakeChunk => ({ usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: out } });
    const run = async (rounds: FakeChunk[][]) => {
      const client = new FakeGeminiClient();
      client.responses = rounds.map(fakeStream);
      const executor = new ScriptedExecutor();
      const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
      const events = await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })));
      return events.at(-1);
    };

    // Each round resends the conversation: 3 requests of 1000, 1100, 1200 prompt tokens. Within a
    // response Gemini's counts are cumulative, so only a round's last value is its own.
    expect(await run([[call('a'), usage(1000, 5), usage(1000, 10)], [call('b'), usage(1100, 10)], [{ text: 'done' }, usage(1200, 30)]])).toEqual({
      type: 'completed',
      finishReason: 'stop',
      usage: { inputTokens: 3300, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true, lastRequest: { inputTokens: 1200, outputTokens: 30 } },
    });

    // One round with no reported count: the turn's total is unknown, not the part that was.
    expect(await run([[call('a')], [{ text: 'done' }, usage(1200, 30)]])).toMatchObject({
      usage: { inputTokens: 0, outputTokens: 0, exact: false },
    });
  });

  it('feeds a tool failure back to the model rather than throwing', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'search_project_files', args: {} }] }]),
      fakeStream([{ text: 'I could not find that.' }, { candidates: [{ finishReason: 'STOP' }] }]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 'c1',
      ok: false,
      content: [{ type: 'text', text: 'Invalid input: query is required' }],
    });
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ type: 'tool_result', result: { ok: false } });
    // The second call's request must carry the failed functionResponse under "error".
    const secondReq = client.calls[1] as { contents: { role: string; parts: unknown[] }[] };
    const lastContent = secondReq.contents.at(-1)!;
    expect(lastContent.parts[0]).toMatchObject({
      functionResponse: { response: { error: 'Invalid input: query is required' } },
    });
  });

  it('echoes a functionCall part\'s thoughtSignature back on the continuation turn', async () => {
    // Regression test for a live production failure (2026-09-19): Gemini requires the
    // thought_signature it returned alongside a functionCall to be echoed back unchanged on the
    // next round's request, or it 400s with "Function call is missing a thought_signature".
    // `chunk.functionCalls` is a flattening getter that drops it — it only exists on the sibling
    // `Part`, in `candidates[0].content.parts`.
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([
        {
          functionCalls: [{ id: 'c1', name: 'search_project_files', args: { query: 'cooling' } }],
          candidates: [
            {
              content: {
                parts: [{ functionCall: { id: 'c1' }, thoughtSignature: 'opaque-signature-abc' }],
              },
            },
          ],
        },
      ]),
      fakeStream([{ text: 'Found it.' }, { candidates: [{ finishReason: 'STOP' }] }]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 'c1',
      ok: true,
      content: [{ type: 'json', data: { results: [] } }],
    });
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })));
    // The signature also leaves the adapter, so a later turn can replay the call (ADR-0022).
    expect(events.find((e) => e.type === 'tool_use')).toMatchObject({ thoughtSignature: 'opaque-signature-abc' });

    const secondReq = client.calls[1] as { contents: { role: string; parts: { functionCall?: unknown; thoughtSignature?: string }[] }[] };
    const modelTurn = secondReq.contents.find((c) => c.role === 'model')!;
    const functionCallPart = modelTurn.parts.find((p) => p.functionCall);
    expect(functionCallPart?.thoughtSignature).toBe('opaque-signature-abc');
  });

  it('feeds an unknown-tool failure back without throwing', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'delete_everything', args: {} }] }]),
      fakeStream([{ text: 'Done.' }, { candidates: [{ finishReason: 'STOP' }] }]),
    ];
    const executor = new ScriptedExecutor();
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(events.some((e) => e.type === 'tool_result' && !e.result.ok)).toBe(true);
  });

  it('runs every function call of a response and answers them in one turn (ADR-0026)', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([
        {
          functionCalls: [
            { id: 'c1', name: 'search_project_files', args: { query: 'a' } },
            { id: 'c2', name: 'search_project_files', args: { query: 'b' } },
          ],
        },
      ]),
      fakeStream([{ text: 'ok' }, { candidates: [{ finishReason: 'STOP' }] }]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', {
      toolCallId: 'c1',
      ok: true,
      content: [{ type: 'json', data: {} }],
    });
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
    await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })));

    expect(executor.calls.map((c) => c.id)).toEqual(['c1', 'c2']);
    // Both responses go back together, after the model turn that made both calls.
    const secondReq = client.calls[1] as { contents: { role: string; parts: unknown[] }[] };
    const responseParts = secondReq.contents.at(-1)!.parts as { functionResponse: { id: string } }[];
    expect(responseParts.map((p) => p.functionResponse.id)).toEqual(['c1', 'c2']);
  });

  it('stops at TOOL_MAX_ROUNDS with finishReason "tool_limit", never a hang or a throw', async () => {
    const client = new FakeGeminiClient();
    // Every round returns another function call, so the loop never naturally terminates.
    client.responses = Array.from({ length: 2 }, (_, i) =>
      fakeStream([{ functionCalls: [{ id: `c${String(i)}`, name: 'search_project_files', args: {} }] }]),
    );
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', { toolCallId: 'x', ok: true, content: [{ type: 'text', text: 'ok' }] });
    const cfg = loadConfig({ NODE_ENV: 'test', TOOL_MAX_ROUNDS: '2' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(
      provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })),
    );
    expect(client.calls).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'tool_limit' });
    // A call the model still makes on the final round is not run: no round is left to answer.
    expect(executor.calls).toHaveLength(1);
  });

  it('the final round refuses tool calls and asks for the answer, so the turn ends in text', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c0', name: 'search_project_files', args: {} }] }]),
      fakeStream([{ text: 'Here is the answer.' }]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', { toolCallId: 'x', ok: true, content: [{ type: 'text', text: 'ok' }] });
    const cfg = loadConfig({ NODE_ENV: 'test', TOOL_MAX_ROUNDS: '2' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })));

    const first = client.calls[0] as { config: { toolConfig?: unknown } };
    const final = client.calls[1] as {
      config: { toolConfig?: { functionCallingConfig: { mode: string } }; systemInstruction?: string };
      contents: { role: string; parts: { text?: string; functionResponse?: unknown }[] }[];
    };
    expect(first.config.toolConfig).toBeUndefined();
    expect(final.config.toolConfig?.functionCallingConfig.mode).toBe('NONE');
    expect(final.config.systemInstruction).toContain('no tool steps left');
    // The request still ends with the user's function-response turn, and only function
    // responses: Vertex rejected a text part mixed into it ("ending with a model turn").
    const last = final.contents.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.parts.every((p) => p.functionResponse !== undefined)).toBe(true);
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')).toBe('Here is the answer.');
  });

  it('a final round rejected with INVALID_ARGUMENT is retried once without toolConfig', async () => {
    const client = new FakeGeminiClient();
    const answer = fakeStream([{ text: 'Answer anyway.' }]);
    client.responses = [fakeStream([{ functionCalls: [{ id: 'c0', name: 'search_project_files', args: {} }] }])];
    let finalAttempts = 0;
    const original = client.models.generateContentStream;
    client.models.generateContentStream = vi.fn(async (req: unknown) => {
      if (client.calls.length === 0) return original(req);
      client.calls.push(req);
      finalAttempts += 1;
      if (finalAttempts === 1) throw new Error('ApiError: {"status":"INVALID_ARGUMENT"}');
      return answer;
    });
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', { toolCallId: 'x', ok: true, content: [{ type: 'text', text: 'ok' }] });
    const cfg = loadConfig({ NODE_ENV: 'test', TOOL_MAX_ROUNDS: '2' });
    const provider = new GeminiProvider(cfg, client as never);
    const events = await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })));
    const retried = client.calls[2] as { config: { toolConfig?: unknown } };
    expect(finalAttempts).toBe(2);
    expect(retried.config.toolConfig).toBeUndefined();
    expect(events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')).toBe('Answer anyway.');
  });

  it('stops issuing provider requests once the signal is aborted', async () => {
    const client = new FakeGeminiClient();
    const controller = new AbortController();
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'search_project_files', args: {} }] }]),
    ];
    const executor: ToolExecutor = {
      execute: async () => {
        controller.abort();
        return { toolCallId: 'c1', ok: true, content: [{ type: 'text', text: 'ok' }] };
      },
    };
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, client as never);
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

describe('GeminiProvider timeouts (ADR-0024)', () => {
  it("reports the SDK's own timeout as a retryable provider_timeout, not a cancel", async () => {
    const client = new FakeGeminiClient();
    client.models.generateContentStream.mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'));
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    await expect(collect(provider.stream(baseRequest()))).rejects.toMatchObject({ code: 'provider_timeout', retryable: true });
  });

  it('passes a caller abort through as an abort', async () => {
    const client = new FakeGeminiClient();
    client.models.generateContentStream.mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'));
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    const controller = new AbortController();
    controller.abort();
    await expect(collect(provider.stream(baseRequest({ signal: controller.signal })))).rejects.toMatchObject({ name: 'AbortError' });
  });
});
