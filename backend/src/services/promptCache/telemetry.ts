/**
 * Telemetry and cost savings calculation for prompt caching.
 */

import type { ProviderUsage } from '../../providers/types.js';
import type { CacheMetrics } from './types.js';

export interface PricingRates {
  input: number; // USD per 1M tokens
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export function normalizeCacheMetrics(
  provider: string,
  model: string,
  toolBundleHash: string,
  usage: ProviderUsage,
  pricing?: PricingRates,
  ttftMs?: number,
): CacheMetrics {
  const uncachedInputTokens = Math.max(0, usage.inputTokens - usage.cacheReadTokens);
  const cacheHit = usage.cacheReadTokens > 0;

  let estimatedInputCost: number | null = null;
  let estimatedInputCostSaved: number | null = null;

  if (pricing) {
    const fullInputCostPerToken = pricing.input / 1_000_000;
    const cacheReadCostPerToken = (pricing.cacheRead ?? pricing.input * 0.1) / 1_000_000;
    const cacheWriteCostPerToken = (pricing.cacheWrite ?? pricing.input * 1.25) / 1_000_000;

    const actualInputCost =
      uncachedInputTokens * fullInputCostPerToken +
      usage.cacheReadTokens * cacheReadCostPerToken +
      usage.cacheWriteTokens * cacheWriteCostPerToken;

    estimatedInputCost = actualInputCost;

    if (cacheHit) {
      const baselineCost = usage.cacheReadTokens * fullInputCostPerToken;
      const cachedCost = usage.cacheReadTokens * cacheReadCostPerToken;
      estimatedInputCostSaved = Math.max(0, baselineCost - cachedCost);
    } else {
      estimatedInputCostSaved = 0;
    }
  }

  return {
    provider,
    model,
    toolBundleHash,
    inputTokens: usage.inputTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheReadTokens,
    uncachedInputTokens,
    cacheHit,
    estimatedInputCost,
    estimatedInputCostSaved,
    ttftMs,
  };
}
