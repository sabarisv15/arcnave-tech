/**
 * Token counts from the provider's own count API (OQ-08 allows it; Invariant 3: no estimator).
 * The tokenizer is the chat model's family: Claude `count_tokens`, Gemini `countTokens`.
 *
 * Each text is counted once per process and family: an LRU keyed by a hash of the text keeps a
 * turn's counts, so a later turn counts only what is new (the new question and answer). Ours.
 * One request per text, a 1 s timeout each (N-75), no retry; any failure makes the whole set
 * unknown (`null`), never a part counted as the whole.
 */
import { createHash } from 'node:crypto';

import type { Provider } from '../../providers/types.js';

const CACHE_MAX = 4_096;
const cache = new Map<string, number>();

function keyOf(family: string, text: string): string {
  return `${family}:${createHash('sha256').update(text).digest('hex')}`;
}

function remember(key: string, tokens: number): void {
  cache.delete(key);
  cache.set(key, tokens);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

/** Test hook: forget every cached count. */
export function clearTokenCountCache(): void {
  cache.clear();
}

/**
 * The provider's count for each text, in order; `null` when the provider has no count API or any
 * one count failed or timed out. An empty text counts 0 without a call.
 */
export async function countTexts(
  provider: Provider,
  texts: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<number[] | null> {
  if (!provider.countTokens) return null;
  const count = provider.countTokens.bind(provider);
  try {
    return await Promise.all(
      texts.map(async (text) => {
        if (text === '') return 0;
        const key = keyOf(provider.name, text);
        const hit = cache.get(key);
        if (hit !== undefined) {
          remember(key, hit);
          return hit;
        }
        const timeout = AbortSignal.timeout(timeoutMs);
        const { tokens } = await count(text, signal ? AbortSignal.any([signal, timeout]) : timeout);
        if (!Number.isInteger(tokens) || tokens < 0) throw new Error('count API returned no usable count');
        remember(key, tokens);
        return tokens;
      }),
    );
  } catch {
    return null;
  }
}
