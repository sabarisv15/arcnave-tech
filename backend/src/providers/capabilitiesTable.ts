/**
 * Model Capability Table.
 *
 * Centralized, authoritative reference for provider/model modalities, maximum encoded bytes,
 * resolution thresholds, and tool capabilities. Eliminates hardcoded magic numbers across adapters.
 */

export interface ModelCapabilitySpec {
  alias: string;
  provider: 'google' | 'anthropic' | 'openai-oss';
  supportsVision: boolean;
  /** Maximum allowed base64-encoded bytes for an image block. */
  maxEncodedImageBytes: number;
  /** Documented native resolution ceiling before provider resizing kicks in. */
  maxNativeResolutionPx: number;
  /** Native video frames supported directly in content blocks (not just text transcription). */
  supportsNativeVideoFrames: boolean;
  /** Native audio waveforms supported directly in content blocks. */
  supportsNativeAudio: boolean;
  /** Native PDF document blocks supported. */
  supportsNativePdf: boolean;
  /** Native image generation capability (e.g. via dedicated image model / tool). */
  supportsImageGeneration: boolean;
  /** Maximum context window size in tokens. */
  contextWindowTokens: number;
}

export const MODEL_CAPABILITIES: Record<string, ModelCapabilitySpec> = {
  'Gemini 3.8 Flash': {
    alias: 'Gemini 3.8 Flash',
    provider: 'google',
    supportsVision: true,
    maxEncodedImageBytes: 20_000_000, // 20 MB inline data
    maxNativeResolutionPx: 3072,
    supportsNativeVideoFrames: true,
    supportsNativeAudio: true,
    supportsNativePdf: true,
    supportsImageGeneration: true, // via Vertex Imagen / Gemini Image
    contextWindowTokens: 1_048_576, // 1M tokens
  },
  'Sonnet 5': {
    alias: 'Sonnet 5',
    provider: 'anthropic',
    supportsVision: true,
    maxEncodedImageBytes: 5_242_880, // Strict 5 MB base64 ceiling documented by Anthropic
    maxNativeResolutionPx: 2576, // Claude 4.7+ high-res tier; 1568 on standard
    supportsNativeVideoFrames: false, // Vertex Claude only receives audio/text transcription
    supportsNativeAudio: false,
    supportsNativePdf: true,
    supportsImageGeneration: true, // routed via generate_image tool
    contextWindowTokens: 200_000, // 200k tokens
  },
  'Opus 5': {
    alias: 'Opus 5',
    provider: 'anthropic',
    supportsVision: true,
    maxEncodedImageBytes: 5_242_880,
    maxNativeResolutionPx: 2576, // Claude 4.7+ high-res tier
    supportsNativeVideoFrames: false,
    supportsNativeAudio: false,
    supportsNativePdf: true,
    supportsImageGeneration: true,
    contextWindowTokens: 200_000, // 200k tokens
  },
  'GPT-OSS 120B': {
    alias: 'GPT-OSS 120B',
    provider: 'openai-oss',
    supportsVision: false,
    maxEncodedImageBytes: 0,
    maxNativeResolutionPx: 0,
    supportsNativeVideoFrames: false,
    supportsNativeAudio: false,
    supportsNativePdf: false,
    supportsImageGeneration: true,
    contextWindowTokens: 128_000, // 128k tokens
  },
};

export function getModelCapability(alias: string): ModelCapabilitySpec {
  const found = MODEL_CAPABILITIES[alias];
  if (found) return found;

  // Safe conservative defaults for unknown/custom aliases
  return {
    alias,
    provider: 'google',
    supportsVision: false,
    maxEncodedImageBytes: 5_242_880,
    maxNativeResolutionPx: 1568,
    supportsNativeVideoFrames: false,
    supportsNativeAudio: false,
    supportsNativePdf: false,
    supportsImageGeneration: false,
    contextWindowTokens: 128_000,
  };
}
