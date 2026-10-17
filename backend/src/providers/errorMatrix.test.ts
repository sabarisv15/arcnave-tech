/**
 * The Stage 15 error matrix, row by row (P11 exit test, ADR-0081): one case per M-01 … M-30.
 *
 * Each case scripts the real adapter's SDK client (no network) or a scripted provider, runs the
 * real gateway on an injected clock and a seeded random source, and asserts the attempt count per
 * model, the backoff delays (J1 = full jitter in [0, 1 s), J2 = [0, 2 s), RA = the provider's
 * Retry-After), the hop the chain takes (or that it takes none), and the final code with its
 * catalogue title when no model is left. Rows that end in the turn (a refusal, a cut answer, an
 * empty answer at the output limit) are asserted at the boundary the turn reads; the turn's own
 * handling is `routes/fallback.integration.test.ts`.
 */
import { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import { ApiError as GeminiApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { ApiError, ERROR_CATALOG } from '../errors.js';
import { mapProviderError, refusalError } from '../services/turn/providerLoop.js';
import { AnthropicProvider } from './anthropic.js';
import { CircuitBreaker } from './breaker.js';
import { isOutputLimit } from './finish.js';
import { type GatewayClock, type GatewayEvent, type HopTarget, ProviderGateway } from './gateway.js';
import { GeminiProvider } from './gemini.js';
import { buildEntries, type ModelEntry } from './registry.js';
import { RetryBudget } from './retryBudget.js';
import type { GenerationRequest, Provider, ProviderEvent, ToolCall, ToolExecutor, ToolResult } from './types.js';

const cfg = loadConfig({
  NODE_ENV: 'test',
  GOOGLE_CLOUD_PROJECT: 'test-project',
  MODEL_GEMINI_FLASH: 'gemini-flash-test',
  MODEL_SONNET: 'claude-sonnet-test',
  MODEL_OPUS: 'claude-opus-test',
  ANTHROPIC_API_KEY: 'not-a-real-key',
});
const ENTRIES = buildEntries(cfg);
const entry = (alias: string): ModelEntry => ENTRIES.find((e) => e.alias === alias)!;
const GEMINI = 'Gemini 3.8 Flash';
const SONNET = 'Sonnet 5.5';
const OPUS = 'Opus 5.5';

/* ------------------------------------------------------------------ clock and random */

class FakeClock implements GatewayClock {
  t = 1_000_000;
  sleeps: number[] = [];
  now(): number {
    return this.t;
  }
  async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    this.sleeps.push(ms);
    this.t += ms;
  }
}

/** mulberry32: a seeded random source, so every run draws the same jitter. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ scripted SDK clients */

type ClaudeStep =
  | { ok: string }
  | { fail: unknown }
  | { textThenFail: string; fail: unknown }
  | { refusal: string }
  | { toolUseWithThinking: true };

function claudeError(status: number, type: string, message: string, headers: Record<string, string> = {}): APIError {
  return APIError.generate(status, { type: 'error', error: { type, message } }, message, new Headers(headers));
}
function claudeStreamError(type: string): APIError {
  return new APIError(undefined, { type: 'error', error: { type, message: type } }, undefined, new Headers(), type as never);
}

class ScriptedClaude {
  calls: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  constructor(public steps: ClaudeStep[]) {}
  messages = {
    stream: (req: never) => {
      this.calls.push(structuredClone(req));
      const step = this.steps.shift() ?? { ok: 'fallback answer' };
      const usage = { input_tokens: 10, output_tokens: 3 };
      const events: unknown[] = [];
      let final: { content: unknown[]; stop_reason: string; stop_details?: unknown; usage: typeof usage } | null = null;
      let error: unknown = null;
      if ('ok' in step) {
        events.push({ type: 'message_start', message: { usage } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: step.ok } });
        final = { content: [{ type: 'text', text: step.ok }], stop_reason: 'end_turn', usage };
      } else if ('textThenFail' in step) {
        events.push({ type: 'message_start', message: { usage } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: step.textThenFail } });
        error = step.fail;
      } else if ('refusal' in step) {
        events.push({ type: 'message_start', message: { usage } });
        final = { content: [], stop_reason: 'refusal', stop_details: { category: step.refusal, explanation: null }, usage };
      } else if ('toolUseWithThinking' in step) {
        events.push({ type: 'message_start', message: { usage } });
        final = {
          content: [
            { type: 'thinking', thinking: 'plan', signature: 'sig-from-another-conversation' },
            { type: 'tool_use', id: 't1', name: 'search_project_files', input: { q: 'x' } },
          ],
          stop_reason: 'tool_use',
          usage,
        };
      } else {
        error = step.fail;
      }
      return {
        currentMessage: null,
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            next: () => {
              if (i < events.length) return Promise.resolve({ value: events[i++], done: false });
              if (error) return Promise.reject(error);
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
        finalMessage: () => (final ? Promise.resolve(final) : Promise.reject(error)),
      };
    },
  };
}

type GeminiStep = { ok: string } | { fail: unknown } | { chunks: unknown[] };

function geminiError(status: number, message: string, statusText: string, details: unknown[] = []): GeminiApiError {
  return new GeminiApiError({ message: JSON.stringify({ error: { code: status, message, status: statusText, details } }), status });
}

class ScriptedGemini {
  calls = 0;
  constructor(public steps: GeminiStep[]) {}
  models = {
    generateContentStream: async () => {
      this.calls += 1;
      const step = this.steps.shift() ?? { ok: 'fallback answer' };
      if ('fail' in step) throw step.fail;
      const chunks =
        'ok' in step
          ? [{ text: step.ok, candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } }]
          : step.chunks;
      return (async function* () {
        for (const c of chunks) yield c;
      })();
    },
  };
}

/** A provider whose stream counts its calls (an attempt is one call). */
function counted(provider: Provider, counter: { n: number }): Provider {
  return {
    name: provider.name,
    supportsGrounding: () => provider.supportsGrounding(),
    probe: (id, signal) => provider.probe(id, signal),
    stream: (request) => {
      counter.n += 1;
      return provider.stream(request);
    },
  };
}

class OneResult implements ToolExecutor {
  async execute(call: ToolCall): Promise<ToolResult> {
    return { toolCallId: call.id, ok: true, content: [{ type: 'text', text: 'hit' }] };
  }
}

/* ------------------------------------------------------------------ one run */

interface Scripts {
  [GEMINI]?: GeminiStep[];
  [SONNET]?: ClaudeStep[];
  [OPUS]?: ClaudeStep[];
}

interface Outcome {
  attempts: Record<string, number>;
  sleeps: number[];
  events: GatewayEvent[];
  error: unknown;
  /** The final code and title the client gets (mapProviderError, as the turn maps it). */
  code: string | null;
  title: string | null;
  switches: Array<{ from: string; to: string; reason: string }>;
  gateway: ProviderGateway;
  claudeCalls: Record<string, ScriptedClaude>;
}

function baseRequest(alias: string, overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt: 'question',
    history: [
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'first answer' },
      { role: 'user', text: 'second' },
      { role: 'assistant', text: 'second answer' },
    ],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 1024,
    providerModelId: entry(alias).providerModelId!,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function run(
  first: string,
  scripts: Scripts,
  options: {
    fallback?: boolean;
    gatewayCfg?: Record<string, string>;
    breaker?: CircuitBreaker;
    retryBudget?: RetryBudget;
    deadlineAt?: number;
    abort?: AbortController;
    request?: Partial<GenerationRequest>;
  } = {},
): Promise<Outcome> {
  const clock = new FakeClock();
  const gcfg = loadConfig({ NODE_ENV: 'test', FALLBACK_ENABLED: options.fallback === false ? 'false' : 'true', ...(options.gatewayCfg ?? {}) });
  const gateway = new ProviderGateway(gcfg, {
    clock,
    random: seeded(42),
    ...(options.breaker ? { breaker: options.breaker } : {}),
    ...(options.retryBudget ? { retryBudget: options.retryBudget } : {}),
  });
  const counters: Record<string, { n: number }> = { [GEMINI]: { n: 0 }, [SONNET]: { n: 0 }, [OPUS]: { n: 0 } };
  const claudeCalls: Record<string, ScriptedClaude> = {};
  const adapters: Record<string, Provider> = {};
  for (const alias of [GEMINI, SONNET, OPUS]) {
    if (alias === GEMINI) adapters[alias] = counted(new GeminiProvider(cfg, new ScriptedGemini(scripts[GEMINI] ?? []) as never), counters[alias]!);
    else {
      const client = new ScriptedClaude((scripts as Record<string, ClaudeStep[] | undefined>)[alias] ?? []);
      claudeCalls[alias] = client;
      adapters[alias] = counted(new AnthropicProvider(cfg, client as never), counters[alias]!);
    }
  }
  const signal = options.abort?.signal ?? new AbortController().signal;
  const target = (alias: string): HopTarget => ({
    entry: entry(alias),
    provider: adapters[alias]!,
    request: baseRequest(alias, { signal, ...(options.request ?? {}) }),
  });
  const events: GatewayEvent[] = [];
  let error: unknown = null;
  try {
    for await (const e of gateway.stream(target(first), {
      signal,
      ...(options.deadlineAt !== undefined ? { deadlineAt: options.deadlineAt } : {}),
      needs: { vision: false, grounding: false },
      entries: ENTRIES,
      build: async (e) => target(e.alias),
    })) {
      events.push(e);
    }
  } catch (err) {
    error = err;
  }
  const mapped = error === null ? null : mapProviderError(error);
  return {
    attempts: Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, v.n])),
    sleeps: clock.sleeps,
    events,
    error,
    code: mapped?.code ?? null,
    title: mapped?.title ?? null,
    switches: events.flatMap((e) => (e.type === 'model_switch' ? [{ from: e.from, to: e.to, reason: e.reason }] : [])),
    gateway,
    claudeCalls,
  };
}

/** J1 / J2: full jitter on 1 s, 2 s (N-42 base 1 s). */
const J1 = [0, 1_000] as const;
const J2 = [0, 2_000] as const;
function expectDelays(sleeps: number[], bounds: ReadonlyArray<readonly [number, number] | number>): void {
  expect(sleeps).toHaveLength(bounds.length);
  bounds.forEach((b, i) => {
    if (typeof b === 'number') expect(sleeps[i]).toBe(b);
    else {
      expect(sleeps[i]).toBeGreaterThanOrEqual(b[0]);
      expect(sleeps[i]).toBeLessThan(b[1]);
    }
  });
}

function expectFinal(o: Outcome, code: string): void {
  expect(o.code).toBe(code);
  expect(o.title).toBe(ERROR_CATALOG[code as keyof typeof ERROR_CATALOG].title);
}

const completed = (o: Outcome) => o.events.find((e): e is Extract<ProviderEvent, { type: 'completed' }> => e.type === 'completed');

/* ------------------------------------------------------------------ the matrix */

interface Row {
  id: string;
  first: string;
  /** What fails on the first model (the fallback model answers when the chain allows it); fresh per run. */
  scripts: () => Scripts;
  /** Attempts on the first model. */
  attempts: number;
  delays: ReadonlyArray<readonly [number, number] | number>;
  /** The final code when no model is left (run with fallback off). */
  code: string;
  /** The model the chain hands the turn to, and why; null = no hop. */
  hop: { to: string; reason: string } | null;
}

const fail = (e: unknown, n = 3): ClaudeStep[] => Array.from({ length: n }, () => ({ fail: e }));
const gfail = (e: unknown, n = 3): GeminiStep[] => Array.from({ length: n }, () => ({ fail: e }));

const ROWS: Row[] = [
  { id: 'M-01 Claude 429 without Retry-After', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeError(429, 'rate_limit_error', 'Rate limited')) }), attempts: 3, delays: [J1, J2], code: 'provider_error', hop: { to: GEMINI, reason: 'unavailable' } },
  { id: 'M-02 Claude 429 Retry-After 3 s', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeError(429, 'rate_limit_error', 'Rate limited', { 'retry-after': '3' })) }), attempts: 3, delays: [3_000, 3_000], code: 'provider_error', hop: { to: GEMINI, reason: 'unavailable' } },
  { id: 'M-03 Claude 429 Retry-After 11 s', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeError(429, 'rate_limit_error', 'Rate limited', { 'retry-after': '11' })) }), attempts: 1, delays: [], code: 'provider_error', hop: { to: GEMINI, reason: 'unavailable' } },
  // M-04: the spend cap skips every Claude row, so Opus goes past Sonnet straight to Gemini.
  { id: 'M-04 Claude spend cap 429', first: OPUS, scripts: () => ({ [OPUS]: fail(claudeError(429, 'rate_limit_error', 'enforced_spend_limit_reached')) }), attempts: 1, delays: [], code: 'provider_limit', hop: { to: GEMINI, reason: 'claude_limit' } },
  { id: 'M-05 Claude 400 usage limits', first: OPUS, scripts: () => ({ [OPUS]: fail(claudeError(400, 'invalid_request_error', 'You have reached your specified workspace API usage limits.')) }), attempts: 1, delays: [], code: 'provider_limit', hop: { to: GEMINI, reason: 'claude_limit' } },
  { id: 'M-06 Claude 402 billing', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeError(402, 'billing_error', 'Billing')) }), attempts: 1, delays: [], code: 'provider_limit', hop: { to: GEMINI, reason: 'claude_limit' } },
  ...[500, 502, 503, 504, 529, 408, 409].map((status): Row => ({
    id: `M-07 Claude ${String(status)}`,
    first: SONNET,
    scripts: () => ({ [SONNET]: fail(claudeError(status, 'api_error', 'Server error')) }),
    attempts: 3,
    delays: [J1, J2],
    code: 'provider_error',
    hop: { to: GEMINI, reason: 'unavailable' },
  })),
  { id: 'M-08 Claude connection error', first: SONNET, scripts: () => ({ [SONNET]: fail(new APIConnectionError({ message: 'Connection error.' })) }), attempts: 3, delays: [J1, J2], code: 'provider_error', hop: { to: GEMINI, reason: 'unavailable' } },
  { id: 'M-08 Claude SDK timeout', first: SONNET, scripts: () => ({ [SONNET]: fail(new APIConnectionTimeoutError()) }), attempts: 3, delays: [J1, J2], code: 'provider_timeout', hop: { to: GEMINI, reason: 'timeout' } },
  // M-09: credentials skip every Claude row (Opus → Gemini).
  { id: 'M-09 Claude 401', first: OPUS, scripts: () => ({ [OPUS]: fail(claudeError(401, 'authentication_error', 'invalid x-api-key')) }), attempts: 1, delays: [], code: 'model_unavailable', hop: { to: GEMINI, reason: 'credentials' } },
  { id: 'M-10 Claude 403', first: OPUS, scripts: () => ({ [OPUS]: fail(claudeError(403, 'permission_error', 'Not allowed')) }), attempts: 1, delays: [], code: 'model_unavailable', hop: { to: SONNET, reason: 'config' } },
  { id: 'M-10 Claude 404', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeError(404, 'not_found_error', 'model not found')) }), attempts: 1, delays: [], code: 'model_unavailable', hop: { to: GEMINI, reason: 'config' } },
  { id: 'M-11 Claude 400', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeError(400, 'invalid_request_error', 'bad field')) }), attempts: 1, delays: [], code: 'provider_error', hop: null },
  { id: 'M-11 Claude 413', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeError(413, 'request_too_large', 'Request too large')) }), attempts: 1, delays: [], code: 'provider_payload_limit', hop: null },
  // M-12: one history cut, then the code; never another model.
  { id: 'M-12 context overflow', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeError(400, 'invalid_request_error', 'prompt is too long: 1200000 tokens > 1000000 maximum')) }), attempts: 2, delays: [], code: 'context_overflow', hop: null },
  { id: 'M-15 mid-stream overloaded_error before text', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeStreamError('overloaded_error')) }), attempts: 3, delays: [J1, J2], code: 'provider_error', hop: { to: GEMINI, reason: 'unavailable' } },
  { id: 'M-16 mid-stream unknown error type', first: SONNET, scripts: () => ({ [SONNET]: fail(claudeStreamError('brand_new_error')) }), attempts: 3, delays: [J1, J2], code: 'provider_error', hop: { to: GEMINI, reason: 'unavailable' } },
  { id: 'M-18 Gemini 429', first: GEMINI, scripts: () => ({ [GEMINI]: gfail(geminiError(429, 'Resource exhausted, please try again later.', 'RESOURCE_EXHAUSTED')) }), attempts: 3, delays: [J1, J2], code: 'provider_error', hop: { to: SONNET, reason: 'unavailable' } },
  {
    id: 'M-18 Gemini 429 RetryInfo 3 s',
    first: GEMINI,
    scripts: () => ({ [GEMINI]: gfail(geminiError(429, 'Resource exhausted.', 'RESOURCE_EXHAUSTED', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }])) }),
    attempts: 3,
    delays: [3_000, 3_000],
    code: 'provider_error',
    hop: { to: SONNET, reason: 'unavailable' },
  },
  { id: 'M-19 Gemini quota-0 429', first: GEMINI, scripts: () => ({ [GEMINI]: gfail(geminiError(429, 'Quota exceeded for metric: m, limit: 0, model: gemini', 'RESOURCE_EXHAUSTED')) }), attempts: 1, delays: [], code: 'provider_quota_unavailable', hop: { to: SONNET, reason: 'quota' } },
  ...[500, 502, 503, 504, 408, 409].map((status): Row => ({
    id: `M-20 Gemini ${String(status)}`,
    first: GEMINI,
    scripts: () => ({ [GEMINI]: gfail(geminiError(status, 'Internal', 'UNAVAILABLE')) }),
    attempts: 3,
    delays: [J1, J2],
    code: 'provider_error',
    hop: { to: SONNET, reason: 'unavailable' },
  })),
  { id: 'M-20 Gemini "fetch failed"', first: GEMINI, scripts: () => ({ [GEMINI]: gfail(new TypeError('fetch failed')) }), attempts: 3, delays: [J1, J2], code: 'provider_error', hop: { to: SONNET, reason: 'unavailable' } },
  { id: 'M-21 Gemini 401', first: GEMINI, scripts: () => ({ [GEMINI]: gfail(geminiError(401, 'Unauthenticated', 'UNAUTHENTICATED')) }), attempts: 1, delays: [], code: 'model_unavailable', hop: { to: SONNET, reason: 'credentials' } },
  { id: 'M-21 Gemini 403', first: GEMINI, scripts: () => ({ [GEMINI]: gfail(geminiError(403, 'Permission denied', 'PERMISSION_DENIED')) }), attempts: 1, delays: [], code: 'model_unavailable', hop: { to: SONNET, reason: 'config' } },
  { id: 'M-21 Gemini 404', first: GEMINI, scripts: () => ({ [GEMINI]: gfail(geminiError(404, 'Publisher Model not found', 'NOT_FOUND')) }), attempts: 1, delays: [], code: 'model_unavailable', hop: { to: SONNET, reason: 'config' } },
  { id: 'M-22 Gemini 400', first: GEMINI, scripts: () => ({ [GEMINI]: gfail(geminiError(400, 'Invalid argument', 'INVALID_ARGUMENT')) }), attempts: 1, delays: [], code: 'provider_error', hop: null },
  { id: 'M-22 Gemini 413', first: GEMINI, scripts: () => ({ [GEMINI]: gfail(geminiError(413, 'Too large', 'INVALID_ARGUMENT')) }), attempts: 1, delays: [], code: 'provider_error', hop: null },
  ...['SAFETY', 'PROHIBITED_CONTENT', 'SPII', 'BLOCKLIST', 'RECITATION', 'MODEL_ARMOR'].map((reason): Row => ({
    id: `M-23 Gemini ${reason}`,
    first: GEMINI,
    scripts: () => ({ [GEMINI]: [{ chunks: [{ text: '', candidates: [{ finishReason: reason }] }] }] }),
    attempts: 1,
    delays: [],
    code: 'response_blocked',
    hop: null,
  })),
  { id: 'M-23 Gemini prompt blockReason', first: GEMINI, scripts: () => ({ [GEMINI]: [{ chunks: [{ promptFeedback: { blockReason: 'SAFETY' } }] }] }), attempts: 1, delays: [], code: 'response_blocked', hop: null },
  { id: 'M-24 Gemini stream ends without a finish reason, no text', first: GEMINI, scripts: () => ({ [GEMINI]: Array.from({ length: 3 }, () => ({ chunks: [{ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 } }] })) }), attempts: 3, delays: [J1, J2], code: 'provider_error', hop: { to: SONNET, reason: 'unavailable' } },
];

describe('Stage 15 error matrix (M-01 … M-30)', () => {
  it.each(ROWS)('$id', async (row) => {
    // With the chain: the hop (or none) after the first model's own attempts.
    const withChain = await run(row.first, row.scripts());
    expect(withChain.attempts[row.first]).toBe(row.attempts);
    expectDelays(withChain.sleeps.slice(0, row.delays.length), row.delays);
    if (row.hop) {
      expect(withChain.switches[0]).toEqual({ from: row.first, to: row.hop.to, reason: row.hop.reason });
      expect(withChain.error).toBeNull();
      expect(completed(withChain)).toBeDefined();
      // M-04 / M-05 / M-09: no other Claude row was tried.
      if (row.first !== GEMINI && (row.hop.reason === 'claude_limit' || row.hop.reason === 'credentials')) {
        expect(withChain.attempts[SONNET]! + withChain.attempts[OPUS]!).toBe(row.attempts);
      }
    } else {
      expect(withChain.switches).toEqual([]);
      expectFinal(withChain, row.code);
    }

    // With no model left: the final code and its catalogue title.
    const alone = await run(row.first, row.scripts(), { fallback: false });
    expect(alone.attempts[row.first]).toBe(row.attempts);
    expectDelays(alone.sleeps, row.delays);
    expect(alone.switches).toEqual([]);
    expectFinal(alone, row.code);
  });

  it('M-13 a thinking-signature 400 is repaired once, on the same round, without re-running a tool', async () => {
    // The run consumes its steps (shift), so each run gets its own list.
    const steps: ClaudeStep[] = [
      { toolUseWithThinking: true },
      { fail: claudeError(400, 'invalid_request_error', 'messages.1.content.0: Invalid `signature` in `thinking` block') },
      { ok: 'Answer after the repair.' },
    ];
    const executed: string[] = [];
    const executor: ToolExecutor = { execute: async (call) => (executed.push(call.id), new OneResult().execute(call)) };
    const tools = [{ name: 'search_project_files', description: 'Search.', inputSchema: { type: 'object', properties: {} } }];
    const o = await run(SONNET, { [SONNET]: steps }, { fallback: false, request: { tools, toolExecutor: executor } });
    expect(o.error).toBeNull();
    expect(o.attempts[SONNET]).toBe(1);
    expect(executed).toEqual(['t1']);
    const calls = o.claudeCalls[SONNET]!.calls;
    expect(calls).toHaveLength(3);
    const thinkingBlocks = (c: (typeof calls)[number]) =>
      c.messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<{ type: string }>) : [])).filter((b) => b.type === 'thinking').length;
    expect(thinkingBlocks(calls[1]!)).toBe(1);
    expect(thinkingBlocks(calls[2]!)).toBe(0);

    // A second refusal is not repaired again: provider_error, no other model.
    const again = await run(
      SONNET,
      { [SONNET]: [{ toolUseWithThinking: true }, { fail: claudeError(400, 'invalid_request_error', 'Invalid `signature` in `thinking` block') }, { fail: claudeError(400, 'invalid_request_error', 'Invalid signature in thinking block') }] },
      { request: { tools, toolExecutor: new OneResult() } },
    );
    expect(again.switches).toEqual([]);
    expectFinal(again, 'provider_error');
  });

  it('M-14 a Claude refusal: one attempt, no hop, model_refused (finish blocked + category in the turn)', async () => {
    const o = await run(SONNET, { [SONNET]: [{ refusal: 'cyber' }] });
    expect(o.attempts[SONNET]).toBe(1);
    expect(o.switches).toEqual([]);
    const refusal = o.events.find((e) => e.type === 'refusal');
    expect(refusal).toMatchObject({ category: 'cyber' });
    const api = refusalError(refusal as { category: string | null; explanation: string | null });
    expect(api.code).toBe('model_refused');
    expect(api.title).toBe(ERROR_CATALOG.model_refused.title);
  });

  it('M-17 any failure after text: one attempt, no retry, no hop; the error reaches the turn after the text', async () => {
    const o = await run(SONNET, { [SONNET]: [{ textThenFail: 'Half an ans', fail: claudeStreamError('overloaded_error') }] });
    expect(o.attempts[SONNET]).toBe(1);
    expect(o.sleeps).toEqual([]);
    expect(o.switches).toEqual([]);
    expect(o.events.some((e) => e.type === 'delta' && e.text === 'Half an ans')).toBe(true);
    expect(o.code).toBe('provider_error');
  });

  it('M-24 a Gemini stream that ends without a finish reason after text: one attempt, no hop', async () => {
    const o = await run(GEMINI, { [GEMINI]: [{ chunks: [{ text: 'Half' }] }] });
    expect(o.attempts[GEMINI]).toBe(1);
    expect(o.switches).toEqual([]);
    expect(o.code).toBe('provider_error');
  });

  it('M-25 MAX_TOKENS: the answer ends max_tokens; with no text the turn says empty_response', async () => {
    const o = await run(GEMINI, { [GEMINI]: [{ chunks: [{ text: '', candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 64_000 } }] }] });
    expect(o.attempts[GEMINI]).toBe(1);
    const done = completed(o)!;
    expect(done.finishReason).toBe('MAX_TOKENS');
    expect(isOutputLimit(done.finishReason)).toBe(true);
    expect(new ApiError('empty_response').title).toBe(ERROR_CATALOG.empty_response.title);
  });

  it('M-26 an unknown finish reason with text ends as other', async () => {
    const o = await run(GEMINI, { [GEMINI]: [{ chunks: [{ text: 'An answer.', candidates: [{ finishReason: 'SOMETHING_NEW' }] }] }] });
    expect(o.attempts[GEMINI]).toBe(1);
    expect(completed(o)!.finishReason).toBe('other');
  });

  it('M-27 a Stop: no retry, no hop; the turn says stopped', async () => {
    const abort = new AbortController();
    abort.abort();
    const o = await run(SONNET, { [SONNET]: fail(claudeError(503, 'api_error', 'busy')) }, { abort });
    expect(o.attempts[SONNET]).toBe(0);
    expect(o.switches).toEqual([]);
    expect((o.error as Error).name).toBe('AbortError');
  });

  it('M-28 past the deadline: no attempt and no hop; turn_deadline_exceeded', async () => {
    const o = await run(SONNET, { [SONNET]: fail(claudeError(503, 'api_error', 'busy')) }, { deadlineAt: 0 });
    expect(o.attempts[SONNET]).toBe(0);
    expect(o.attempts[GEMINI]).toBe(0);
    expect(o.switches).toEqual([]);
    expectFinal(o, 'turn_deadline_exceeded');

    // A retry wait that would cross the deadline is not started either.
    const late = await run(SONNET, { [SONNET]: fail(claudeError(503, 'api_error', 'busy')) }, { deadlineAt: 1_000_000 + 1 });
    expect(late.attempts[SONNET]).toBe(1);
    expect(late.attempts[GEMINI]).toBe(0);
    expectFinal(late, 'turn_deadline_exceeded');
  });

  it('M-29 an open breaker or a killed model: no attempt; the next model, labelled; model_unavailable when none is left', async () => {
    const open = new CircuitBreaker({ failures: 1, windowMs: 30_000, ratio: 0.5, minCalls: 20, halfOpenMs: 30_000 }, [], () => 1_000_000);
    const r = open.admit(SONNET);
    if (r.ok) r.admission.failure();
    const viaOpen = await run(SONNET, {}, { breaker: open });
    expect(viaOpen.attempts[SONNET]).toBe(0);
    expect(viaOpen.switches[0]).toEqual({ from: SONNET, to: GEMINI, reason: 'breaker_open' });

    const killed = new CircuitBreaker(undefined, [SONNET]);
    const viaKill = await run(SONNET, {}, { breaker: killed });
    expect(viaKill.attempts[SONNET]).toBe(0);
    expect(viaKill.switches[0]).toEqual({ from: SONNET, to: GEMINI, reason: 'disabled' });

    const alone = await run(SONNET, {}, { breaker: new CircuitBreaker(undefined, [SONNET]), fallback: false });
    expectFinal(alone, 'model_unavailable');
  });

  it('M-30 the retry budget is spent: no retry; the next model', async () => {
    const budget = new RetryBudget(0.1, 0, 30_000, () => 1_000_000);
    const o = await run(SONNET, { [SONNET]: fail(claudeError(503, 'api_error', 'busy')) }, { retryBudget: budget });
    expect(o.attempts[SONNET]).toBe(1);
    expect(o.sleeps).toEqual([]);
    expect(o.switches[0]).toEqual({ from: SONNET, to: GEMINI, reason: 'unavailable' });
    const alone = await run(SONNET, { [SONNET]: fail(claudeError(503, 'api_error', 'busy')) }, { retryBudget: new RetryBudget(0.1, 0, 30_000), fallback: false });
    expectFinal(alone, 'provider_error');
  });

  it('M-09 is counted by the breaker; M-04 (a spend cap) is not', async () => {
    const counting = () => new CircuitBreaker({ failures: 1, windowMs: 30_000, ratio: 0.5, minCalls: 20, halfOpenMs: 30_000 });
    const b401 = counting();
    await run(SONNET, { [SONNET]: fail(claudeError(401, 'authentication_error', 'bad key')) }, { breaker: b401, fallback: false });
    expect(b401.state(SONNET)).toBe('open');
    const bCap = counting();
    await run(SONNET, { [SONNET]: fail(claudeError(429, 'rate_limit_error', 'enforced_spend_limit_reached')) }, { breaker: bCap, fallback: false });
    expect(bCap.state(SONNET)).toBe('closed');
  });

  it('AL-1: a failed attempt that reported usage is billed on top of the answer', async () => {
    const o = await run(SONNET, { [SONNET]: [{ textThenFail: '', fail: claudeStreamError('overloaded_error') }, { ok: 'ok' }] }, { fallback: false });
    // The first attempt reported 10 in / 3 out at message_start before failing; the second answered.
    expect(completed(o)!.usage).toMatchObject({ inputTokens: 20, outputTokens: 6, exact: true });
  });
});
