/**
 * Review R1 (p05 round 1): a consumer that stops iterating the gateway (streamAndCollect throws
 * on a `refusal` event; a tool-call write fails) closes the generator with return(). The breaker
 * admission of that attempt must still be given back, or a half-open breaker keeps its one trial
 * "in flight" and refuses the model with `breaker_open` until the process restarts.
 */
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { CircuitBreaker } from './breaker.js';
import { ProviderGateway } from './gateway.js';
import { buildEntries } from './registry.js';
import type { GenerationRequest, Provider, ProviderEvent } from './types.js';

const cfg = loadConfig({
  NODE_ENV: 'test',
  GOOGLE_CLOUD_PROJECT: 'test-project',
  MODEL_GEMINI_FLASH: 'gemini-flash-test',
  MODEL_SONNET: 'claude-sonnet-test',
  MODEL_OPUS: 'claude-opus-test',
  ANTHROPIC_API_KEY: 'not-a-real-key',
});
const SONNET = 'Sonnet 5.5';
const sonnet = buildEntries(cfg).find((e) => e.alias === SONNET)!;

function refusing(): Provider {
  return {
    name: 'fake',
    supportsGrounding: () => false,
    probe: async () => {},
    async *stream(): AsyncGenerator<ProviderEvent> {
      yield { type: 'refusal', category: 'cyber', explanation: null };
      yield { type: 'completed', usage: { inputTokens: 1, outputTokens: 1, exact: true } as never, finishReason: 'refusal' };
    },
  };
}

function request(): GenerationRequest {
  return {
    prompt: 'q',
    history: [],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 16,
    providerModelId: sonnet.providerModelId!,
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  };
}

describe('gateway admission when the consumer stops iterating (review R1)', () => {
  it('a half-open trial ended by a consumer throw on `refusal` is released', async () => {
    let t = 1_000_000;
    const breaker = new CircuitBreaker({ failures: 1, windowMs: 30_000, ratio: 0.5, minCalls: 20, halfOpenMs: 30_000 }, [], () => t);
    const first = breaker.admit(SONNET);
    if (first.ok) first.admission.failure();
    t += 30_000;
    expect(breaker.state(SONNET)).toBe('half_open');

    const gateway = new ProviderGateway(loadConfig({ NODE_ENV: 'test' }), { breaker, clock: { now: () => t, sleep: async () => {} } });
    const signal = new AbortController().signal;
    await expect(
      (async () => {
        for await (const e of gateway.stream({ entry: sonnet, provider: refusing(), request: request() }, { signal })) {
          if (e.type === 'refusal') throw new Error('refused by the consumer');
        }
      })(),
    ).rejects.toThrow('refused by the consumer');

    expect(breaker.wouldAdmit(SONNET)).toEqual({ ok: true });
  });
});
