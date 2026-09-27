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
                // The same object `functionCalls` flattens to: the SDK derives the getter from these parts.
                parts: [
                  {
                    functionCall: { id: 'c1', name: 'search_project_files', args: { query: 'cooling' } },
                    thoughtSignature: 'opaque-signature-abc',
                  },
                ],
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

  it('ends the turn after ask_user_options and replays its {status:"shown"} result cleanly on the next user turn', async () => {
    const ASK_TOOL = {
      name: 'ask_user_options',
      description: 'Present clickable options.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
    };
    const askInput = {
      question: 'Which stack should we use?',
      kind: 'single',
      options: [{ label: 'React + Fastify' }, { label: 'Next.js' }],
    };
    const shownResult: ToolResult = {
      toolCallId: 'c-ask-1',
      ok: true,
      content: [{ type: 'json', data: { status: 'shown' } }],
    };

    // Turn 1: model calls ask_user_options -> adapter stops after 1 round with finishReason: 'stop'
    const client1 = new FakeGeminiClient();
    client1.responses = [
      fakeStream([
        {
          functionCalls: [{ id: 'c-ask-1', name: 'ask_user_options', args: askInput }],
          usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 12 },
        },
      ]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('ask_user_options', shownResult);

    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider1 = new GeminiProvider(cfg, client1 as never);
    const turn1Events = await collect(
      provider1.stream(baseRequest({ prompt: 'Build me a web app', tools: [ASK_TOOL], toolExecutor: executor })),
    );

    expect(client1.calls).toHaveLength(1);
    expect(executor.calls).toHaveLength(1);
    expect(turn1Events.find((e) => e.type === 'tool_use')).toMatchObject({
      type: 'tool_use',
      toolCallId: 'c-ask-1',
      name: 'ask_user_options',
      input: askInput,
    });
    expect(turn1Events.find((e) => e.type === 'tool_result')).toMatchObject({
      type: 'tool_result',
      toolCallId: 'c-ask-1',
      name: 'ask_user_options',
      result: shownResult,
    });
    expect(turn1Events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'stop' });

    // Turn 2: user clicks "React + Fastify"; history replays the assistant tool call (even with empty text) and {status:'shown'} result
    const client2 = new FakeGeminiClient();
    client2.responses = [
      fakeStream([
        { text: 'Great choice! Setting up React + Fastify.' },
        { usageMetadata: { promptTokenCount: 45, candidatesTokenCount: 10 }, candidates: [{ finishReason: 'STOP' }] },
      ]),
    ];
    const provider2 = new GeminiProvider(cfg, client2 as never);
    const turn2Events = await collect(
      provider2.stream(
        baseRequest({
          prompt: 'React + Fastify',
          history: [
            { role: 'user', text: 'Build me a web app' },
            {
              role: 'assistant',
              text: '',
              toolCalls: [
                {
                  id: 'c-ask-1',
                  name: 'ask_user_options',
                  input: askInput,
                  result: shownResult,
                  thoughtSignature: 'sig-ask-1',
                },
              ],
            },
          ],
          tools: [ASK_TOOL],
          toolExecutor: executor,
        }),
      ),
    );

    expect(client2.calls).toHaveLength(1);
    const sentContents = (client2.calls[0] as { contents: { role: string; parts: unknown[] }[] }).contents;
    // Gemini requires strictly alternating user / model / user turns
    expect(sentContents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(sentContents[1]!.parts).toEqual([
      {
        functionCall: { id: 'c-ask-1', name: 'ask_user_options', args: askInput },
        thoughtSignature: 'sig-ask-1',
      },
    ]);
    expect(sentContents[2]!.parts).toEqual([
      {
        functionResponse: {
          id: 'c-ask-1',
          name: 'ask_user_options',
          response: { output: { status: 'shown' } },
        },
      },
      { text: 'React + Fastify' },
    ]);
    expect(turn2Events.some((e) => e.type === 'delta' && e.text.includes('React + Fastify'))).toBe(true);
    expect(turn2Events.at(-1)).toMatchObject({ type: 'completed', finishReason: 'STOP' });
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

  it('asks for thought summaries and yields them as thinking, apart from the answer (audit B8)', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([
        { candidates: [{ content: { parts: [{ text: 'Plan: add them.', thought: true }] } }] },
        { text: '5', candidates: [{ content: { parts: [{ text: '5' }] }, finishReason: 'STOP' }] },
      ] as never),
    ];
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    const events = await collect(provider.stream(baseRequest({})));
    expect(events.filter((e) => e.type === 'thinking')).toEqual([{ type: 'thinking', text: 'Plan: add them.' }]);
    expect(events.filter((e) => e.type === 'delta')).toEqual([{ type: 'delta', text: '5' }]);
    const req = client.calls[0] as { config: { thinkingConfig?: { includeThoughts?: boolean } } };
    expect(req.config.thinkingConfig?.includeThoughts).toBe(true);
  });

  it('sends the requested effort as thinkingLevel, and none when the request has no effort', async () => {
    const client = new FakeGeminiClient();
    const reply = () => fakeStream([{ text: 'ok', candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }] as never);
    client.responses = [reply(), reply()];
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    await collect(provider.stream(baseRequest({ reasoningEffort: 'xhigh' })));
    await collect(provider.stream(baseRequest({})));
    const level = (i: number) => (client.calls[i] as { config: { thinkingConfig?: { thinkingLevel?: string } } }).config.thinkingConfig?.thinkingLevel;
    expect(level(0)).toBe('HIGH');
    expect(level(1)).toBeUndefined();
  });

  it('in Chat, offers Google Search with the functions and reports no search the model did not run', async () => {
    const client = new FakeGeminiClient();
    client.responses = [fakeStream([{ text: '4', candidates: [{ content: { parts: [{ text: '4' }] }, finishReason: 'STOP' }] }] as never)];
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test', ENABLE_GOOGLE_SEARCH_GROUNDING: 'true' }), client as never);
    const executor = new ScriptedExecutor();
    const events = await collect(provider.stream(baseRequest({ grounded: true, tools: [SEARCH_TOOL], toolExecutor: executor })));
    const tools = (client.calls[0] as { config: { tools?: object[] } }).config.tools ?? [];
    expect(tools.some((t) => 'googleSearch' in t)).toBe(true);
    expect(tools.some((t) => 'functionDeclarations' in t)).toBe(true);
    expect(events.filter((e) => e.type === 'progress')).toEqual([]);
  });

  it('clears the oldest tool results once a request passes the context-editing threshold', async () => {
    const client = new FakeGeminiClient();
    const big = { usageMetadata: { promptTokenCount: 150_000, candidatesTokenCount: 5 } };
    client.responses = [
      ...Array.from({ length: 8 }, (_, i) =>
        fakeStream([{ functionCalls: [{ id: `c${i}`, name: 'search_project_files', args: { query: String(i) } }], ...big }]),
      ),
      fakeStream([{ text: 'done', ...big, candidates: [{ finishReason: 'STOP' }] }]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('search_project_files', { toolCallId: 'x', ok: true, content: [{ type: 'text', text: 'hit' }] });
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test', TOOL_MAX_ROUNDS: '16' }), client as never);
    await collect(provider.stream(baseRequest({ tools: [SEARCH_TOOL], toolExecutor: executor })));

    const last = client.calls.at(-1) as { contents: { parts?: { functionResponse?: { response: { output: unknown } } }[] }[] };
    const outputs = last.contents.flatMap((c) => c.parts ?? []).filter((p) => p.functionResponse).map((p) => p.functionResponse!.response.output);
    expect(outputs).toHaveLength(8);
    expect(outputs.slice(0, 5).every((o) => typeof o === 'string' && o.includes('cleared'))).toBe(true);
    expect(outputs.slice(5)).toEqual(['hit', 'hit', 'hit']);
  });
});

describe('GeminiProvider streamed function-call arguments (ADR-0037)', () => {
  const RENDER_UI = { name: 'render_ui', description: 'Renders UI.', inputSchema: { type: 'object', properties: {} } };
  const part = (functionCall: unknown) => ({ candidates: [{ content: { parts: [{ functionCall }] } }] });
  const configOf = (req: unknown) => (req as { config: { toolConfig?: { functionCallingConfig?: Record<string, unknown> } } }).config;

  it('asks for streamed arguments only when render_ui is declared', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test' });
    for (const [tools, expected] of [
      [[RENDER_UI, SEARCH_TOOL], { streamFunctionCallArguments: true }],
      [[SEARCH_TOOL], undefined],
    ] as const) {
      const client = new FakeGeminiClient();
      client.responses = [fakeStream([{ text: 'ok' }])];
      const provider = new GeminiProvider(cfg, client as never);
      await collect(provider.stream(baseRequest({ tools: [...tools], toolExecutor: new ScriptedExecutor() })));
      expect(configOf(client.calls[0]).toolConfig?.functionCallingConfig).toEqual(expected);
    }
  });

  it('reports a visual while it is written and runs the call once it is complete', async () => {
    const client = new FakeGeminiClient();
    client.responses = [
      fakeStream([
        part({ id: 'v1', name: 'render_ui', willContinue: true }),
        part({ partialArgs: [{ jsonPath: '$.blocks[0].type', stringValue: 'visual' }], willContinue: true }),
        part({ partialArgs: [{ jsonPath: '$.blocks[0].html', stringValue: '<svg>', willContinue: true }], willContinue: true }),
        part({ partialArgs: [{ jsonPath: '$.blocks[0].html', stringValue: '</svg>' }], willContinue: true }),
        part({}),
      ]),
      fakeStream([{ text: 'Here it is.' }]),
    ];
    const executor = new ScriptedExecutor();
    executor.results.set('render_ui', { toolCallId: 'v1', ok: true, content: [{ type: 'text', text: 'rendered' }] });
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    const seen: string[] = [];
    for await (const e of provider.stream(baseRequest({ tools: [RENDER_UI], toolExecutor: executor }))) {
      // The input is live: what an event shows must be read when it arrives.
      if (e.type === 'tool_input_partial') seen.push(JSON.stringify(e.input));
      if (e.type === 'tool_use') seen.push(`use ${JSON.stringify(e.input)}`);
    }
    expect(seen).toEqual([
      '{"blocks":[{"type":"visual"}]}',
      '{"blocks":[{"type":"visual","html":"<svg>"}]}',
      '{"blocks":[{"type":"visual","html":"<svg></svg>"}]}',
      'use {"blocks":[{"type":"visual","html":"<svg></svg>"}]}',
    ]);
    expect(executor.calls).toEqual([{ id: 'v1', name: 'render_ui', input: { blocks: [{ type: 'visual', html: '<svg></svg>' }] } }]);
  });

  it('falls back to whole calls for a model that rejects the option, and does not ask again', async () => {
    const client = new FakeGeminiClient();
    let first = true;
    client.models.generateContentStream.mockImplementation(async (req: unknown) => {
      client.calls.push(req);
      if (first) {
        first = false;
        throw new Error('400 INVALID_ARGUMENT: stream_function_call_arguments is not supported');
      }
      const next = client.responses.shift();
      if (!next) throw new Error('no scripted response left');
      return next;
    });
    client.responses = [
      fakeStream([{ functionCalls: [{ id: 'c1', name: 'search_project_files', args: { query: 'x' } }] }]),
      fakeStream([{ text: 'done' }]),
    ];
    const executor = new ScriptedExecutor();
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test' }), client as never);
    const events = await collect(provider.stream(baseRequest({ tools: [RENDER_UI, SEARCH_TOOL], toolExecutor: executor })));
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    expect(configOf(client.calls[0]).toolConfig?.functionCallingConfig).toEqual({ streamFunctionCallArguments: true });
    expect(configOf(client.calls[1]).toolConfig).toBeUndefined();
    expect(configOf(client.calls[2]).toolConfig).toBeUndefined();
  });

  it('can be switched off by configuration', async () => {
    const client = new FakeGeminiClient();
    client.responses = [fakeStream([{ text: 'ok' }])];
    const provider = new GeminiProvider(loadConfig({ NODE_ENV: 'test', GEMINI_STREAM_TOOL_ARGS: 'false' }), client as never);
    await collect(provider.stream(baseRequest({ tools: [RENDER_UI], toolExecutor: new ScriptedExecutor() })));
    expect(configOf(client.calls[0]).toolConfig).toBeUndefined();
  });
});
