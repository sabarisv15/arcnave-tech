/**
 * Transcription retries follow Stage 15 ER-2 (ADR-0070, review F15): a piece is retried only when
 * the provider adapter classified the failure retryable, or its own deadline ran out, and at most
 * once. The errors go through the real Gemini adapter (`readMedia` → `classifyGeminiError`), so
 * the test pins that the adapter's classification is what decides. No ffmpeg needed: `readPiece`
 * is the per-piece loop `transcribe` runs.
 */
import { ApiError as GeminiApiError } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../config.js';
import { GeminiProvider } from '../../providers/gemini.js';
import { ProviderError, type MediaPart } from '../../providers/types.js';
import { readPiece } from './audio.js';

const cfg = loadConfig({ NODE_ENV: 'test', MODEL_GEMINI_FLASH: 'gemini-3.8-flash' });
const part: MediaPart = { mimeType: 'audio/mpeg', base64: 'AAAA' };

/** An SDK error as `@google/genai` throws it for a failed response. */
const sdkError = (status: number, error: Record<string, unknown>): GeminiApiError =>
  new GeminiApiError({ message: JSON.stringify({ error: { code: status, ...error } }), status });

const ok = { text: 'hello', candidates: [{ finishReason: 'STOP' }], modelVersion: 'gemini-3.8-flash' };

/** Requests the real Gemini adapter makes for one piece when every call fails with `error`. */
async function attemptsFor(error: unknown, deadlineMs = 5_000): Promise<{ calls: number; ok: boolean }> {
  let calls = 0;
  const client = {
    models: {
      generateContent: async () => {
        calls += 1;
        throw error;
      },
    },
  };
  const read = await readPiece(new GeminiProvider(cfg, client as never), part, { deadlineMs });
  return { calls, ok: read.ok };
}

describe('transcription retries only what can pass on a retry (ADR-0070, F15)', () => {
  it('a 400 is asked once', async () => {
    expect(await attemptsFor(sdkError(400, { message: 'bad audio', status: 'INVALID_ARGUMENT' }))).toEqual({ calls: 1, ok: false });
  });

  it('a 413 is asked once', async () => {
    expect(await attemptsFor(sdkError(413, { message: 'too large', status: 'FAILED_PRECONDITION' }))).toEqual({ calls: 1, ok: false });
  });

  it('a 401, a 403 and a non-model 404 are asked once', async () => {
    for (const status of [401, 403, 404]) expect((await attemptsFor(sdkError(status, { message: 'no', status: 'PERMISSION_DENIED' }))).calls).toBe(1);
  });

  it('a 429 with zero quota (provider_quota_unavailable) is asked once', async () => {
    const quota0 = sdkError(429, {
      status: 'RESOURCE_EXHAUSTED',
      message: 'Quota exceeded for metric: generate_content_requests, limit: 0, model: gemini-3.8-flash',
    });
    expect(await attemptsFor(quota0)).toEqual({ calls: 1, ok: false });
  });

  it('a 503 is retried once: 2 requests, not 3', async () => {
    expect(await attemptsFor(sdkError(503, { message: 'busy', status: 'UNAVAILABLE' }))).toEqual({ calls: 2, ok: false });
  });

  it('a 429 with quota left, and a lost connection, are retried once', async () => {
    expect((await attemptsFor(sdkError(429, { message: 'rate', status: 'RESOURCE_EXHAUSTED' }))).calls).toBe(2);
    expect((await attemptsFor(new TypeError('fetch failed'))).calls).toBe(2);
  });

  it('an account limit (provider_limit) is asked once', async () => {
    let calls = 0;
    const provider = {
      readMedia: async () => {
        calls += 1;
        throw new ProviderError('account limit', { code: 'provider_limit', retryable: false, statusCode: 429 });
      },
    };
    expect((await readPiece(provider, part, { deadlineMs: 5_000 })).ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('the classification decides, not the code: a retryable model_unavailable is retried, an unclassified error is not', async () => {
    const run = async (error: unknown) => {
      let calls = 0;
      const provider = {
        readMedia: async () => {
          calls += 1;
          throw error;
        },
      };
      await readPiece(provider, part, { deadlineMs: 5_000 });
      return calls;
    };
    expect(await run(new ProviderError('x', { code: 'model_unavailable', retryable: true }))).toBe(2);
    expect(await run(new ProviderError('x'))).toBe(1);
    // Not a provider error at all (the adapter turns every SDK failure into one): a bug repeats.
    expect(await run(new Error('socket hang up'))).toBe(1);
  });

  it("the piece's own deadline is a timeout: retried once, through the real adapter", async () => {
    let calls = 0;
    const client = {
      models: {
        generateContent: (req: { config: { abortSignal: AbortSignal } }) => {
          calls += 1;
          return new Promise((_resolve, reject) => {
            req.config.abortSignal.addEventListener('abort', () => reject(req.config.abortSignal.reason as Error), { once: true });
          });
        },
      },
    };
    const started = Date.now();
    const read = await readPiece(new GeminiProvider(cfg, client as never), part, { deadlineMs: 50 });
    expect(read.ok).toBe(false);
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('a retry that succeeds gives the piece its text; a caller abort is not retried', async () => {
    let calls = 0;
    const client = {
      models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) throw sdkError(503, { message: 'busy', status: 'UNAVAILABLE' });
          return ok;
        },
      },
    };
    expect(await readPiece(new GeminiProvider(cfg, client as never), part, { deadlineMs: 5_000 })).toEqual({ text: 'hello', ok: true, model: 'gemini-3.8-flash' });
    expect(calls).toBe(2);

    const controller = new AbortController();
    let aborted = 0;
    const abortingClient = {
      models: {
        generateContent: async () => {
          aborted += 1;
          controller.abort();
          throw new DOMException('aborted', 'AbortError');
        },
      },
    };
    await expect(readPiece(new GeminiProvider(cfg, abortingClient as never), part, { deadlineMs: 5_000, signal: controller.signal })).rejects.toThrow();
    expect(aborted).toBe(1);
  });
});
