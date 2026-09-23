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
  /** Maximum input tokens supported by the provider endpoint. */
  maxInputTokens?: number;
  /** Maximum output tokens supported by the provider endpoint. */
  maxOutputTokens?: number;
  /** Maximum combined context window size in tokens, only when specifically defined that way. */
  contextWindowTokens?: number;
}

const CLAUDE_SONNET_5_SPEC: ModelCapabilitySpec = {
  alias: 'Sonnet 5',
  provider: 'anthropic',
  supportsVision: true,
  maxEncodedImageBytes: 5_242_880, // Strict 5 MB base64 ceiling documented by Anthropic
  maxNativeResolutionPx: 2576, // Claude 4.7+ high-res tier
  supportsNativeVideoFrames: false,
  supportsNativeAudio: false,
  supportsNativePdf: true,
  supportsImageGeneration: true, // routed via generate_image tool
  maxInputTokens: 1_000_000, // 1M tokens native input
  maxOutputTokens: 128_000,
};

const CLAUDE_OPUS_5_SPEC: ModelCapabilitySpec = {
  alias: 'Opus 5',
  provider: 'anthropic',
  supportsVision: true,
  maxEncodedImageBytes: 5_242_880,
  maxNativeResolutionPx: 2576,
  supportsNativeVideoFrames: false,
  supportsNativeAudio: false,
  supportsNativePdf: true,
  supportsImageGeneration: true,
  maxInputTokens: 1_000_000, // 1M tokens native input
  maxOutputTokens: 128_000,
};

const GEMINI_38_FLASH_SPEC: ModelCapabilitySpec = {
  alias: 'Gemini 3.8 Flash',
  provider: 'google',
  supportsVision: true,
  maxEncodedImageBytes: 20_000_000, // 20 MB inline data
  maxNativeResolutionPx: 3072,
  supportsNativeVideoFrames: true,
  supportsNativeAudio: true,
  supportsNativePdf: true,
  supportsImageGeneration: true,
  maxInputTokens: 1_048_576,
  maxOutputTokens: 65_536,
  contextWindowTokens: 1_048_576, // 1M combined tokens
};

const GPT_OSS_120B_SPEC: ModelCapabilitySpec = {
  alias: 'GPT-OSS 120B',
  provider: 'openai-oss',
  supportsVision: false,
  maxEncodedImageBytes: 0,
  maxNativeResolutionPx: 0,
  supportsNativeVideoFrames: false,
  supportsNativeAudio: false,
  supportsNativePdf: false,
  supportsImageGeneration: true,
  maxInputTokens: 128_000,
  maxOutputTokens: 8_192,
  contextWindowTokens: 128_000,
};

export const MODEL_CAPABILITIES: Record<string, ModelCapabilitySpec> = {
  'Gemini 3.8 Flash': GEMINI_38_FLASH_SPEC,
  'gemini-3.8-flash': GEMINI_38_FLASH_SPEC,
  'claude-sonnet-5': CLAUDE_SONNET_5_SPEC,
  'Sonnet 5': CLAUDE_SONNET_5_SPEC,
  'claude-opus-5': CLAUDE_OPUS_5_SPEC,
  'Opus 5': CLAUDE_OPUS_5_SPEC,
  'GPT-OSS 120B': GPT_OSS_120B_SPEC,
  'openai/gpt-oss-120b': GPT_OSS_120B_SPEC,
};

export function getModelCapability(aliasOrModelId: string): ModelCapabilitySpec {
  const found = MODEL_CAPABILITIES[aliasOrModelId];
  if (found) return found;

  // Case/symbol normalization check
  const normalized = aliasOrModelId.toLowerCase().replace(/_/g, '-');
  for (const [key, spec] of Object.entries(MODEL_CAPABILITIES)) {
    if (key.toLowerCase().replace(/_/g, '-') === normalized) {
      return spec;
    }
  }

  // Safe conservative defaults for unknown/custom aliases
  return {
    alias: aliasOrModelId,
    provider: 'google',
    supportsVision: false,
    maxEncodedImageBytes: 5_242_880,
    maxNativeResolutionPx: 1568,
    supportsNativeVideoFrames: false,
    supportsNativeAudio: false,
    supportsNativePdf: false,
    supportsImageGeneration: false,
    maxInputTokens: 128_000,
    maxOutputTokens: 4_096,
    contextWindowTokens: 128_000,
  };
}
