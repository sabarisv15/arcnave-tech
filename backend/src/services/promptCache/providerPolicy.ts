/**
 * Provider-specific caching capabilities and threshold evaluation.
 */

export interface ProviderCacheCapability {
  supportsImplicitCaching: boolean;
  supportsExplicitCaching: boolean;
  minPrefixTokens: number;
}

/**
 * Returns documented context caching limits by provider and model.
 */
export function getProviderCacheCapability(provider: string, modelId: string): ProviderCacheCapability {
  const m = modelId.toLowerCase();

  if (provider === 'anthropic') {
    // Minimum cacheable prefix (Anthropic prompt-caching page, read 2026-10-14): 512 tokens on
    // the 5.5 models (claude-opus-5-5, claude-sonnet-5-5), 1024 on the earlier generation.
    const is55 = m.includes('5-5') || m.includes('5.5');
    return {
      supportsImplicitCaching: false,
      supportsExplicitCaching: true,
      minPrefixTokens: is55 ? 512 : m.includes('opus') || m.includes('sonnet') ? 1024 : 2048,
    };
  }

  if (provider === 'google') {
    // Gemini 3.8 Flash implicit caching threshold is 6,144 tokens per Google documentation
    if (m.includes('3.8') || m.includes('3-8')) {
      return {
        supportsImplicitCaching: true,
        supportsExplicitCaching: true,
        minPrefixTokens: 6144,
      };
    }
    // Gemini 2.5 family: 2,048 tokens minimum
    if (m.includes('2.5') || m.includes('2-5')) {
      return {
        supportsImplicitCaching: true,
        supportsExplicitCaching: true,
        minPrefixTokens: 2048,
      };
    }
    // General Gemini 3 models: 4,096 tokens minimum
    return {
      supportsImplicitCaching: true,
      supportsExplicitCaching: true,
      minPrefixTokens: 4096,
    };
  }

  return {
    supportsImplicitCaching: false,
    supportsExplicitCaching: false,
    minPrefixTokens: Infinity,
  };
}
