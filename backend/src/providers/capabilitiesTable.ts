/**
 * Model Capability Table.
 *
 * Centralized, authoritative reference for provider/model modalities, maximum encoded bytes,
 * resolution thresholds, and tool capabilities. Eliminates hardcoded magic numbers across adapters.
 */

import type { ReasoningEffort } from './types.js';

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
  /** Maximum input tokens supported by the provider endpoint. */
  maxInputTokens?: number;
  /** Maximum output tokens supported by the provider endpoint. */
  maxOutputTokens?: number;
  /** Effort levels the model accepts, low to high; empty when it has no effort control. */
  reasoningEfforts: readonly ReasoningEffort[];
  /** Maximum combined context window size in tokens, only when specifically defined that way. */
  contextWindowTokens?: number;
  /**
   * Maximum PDF pages across one request, or `null` when no verified figure exists for this
   * model on the platform we call. `null` means "not checked here", never "unlimited" (G18).
   */
  maxPdfPagesPerRequest: number | null;
  /** Maximum request body in bytes on the platform we call, or `null` when not verified. */
  maxRequestBytes: number | null;
}

/**
 * Claude on Google Cloud (Vertex), from Anthropic's docs, checked 2026-09-24:
 * - PDF support: 600 pages per request (100 when the context window is under 1M tokens).
 *   https://platform.claude.com/docs/en/build-with-claude/pdf-support
 * - API overview, request size limits: "Google Cloud limits requests to 30 MB".
 *   https://platform.claude.com/docs/en/api/overview#request-size-limits
 * Both are whole-request limits. Sonnet 5 and Opus 5 have 1M-token context, so 600 applies.
 */
const CLAUDE_VERTEX_MAX_PDF_PAGES = 600;
const CLAUDE_VERTEX_MAX_REQUEST_BYTES = 30_000_000;

const CLAUDE_SONNET_5_SPEC: ModelCapabilitySpec = {
  alias: 'Sonnet 5',
  provider: 'anthropic',
  supportsVision: true,
  maxEncodedImageBytes: 5_242_880, // Strict 5 MB base64 ceiling documented by Anthropic
  maxNativeResolutionPx: 2576, // Claude 4.7+ high-res tier
  supportsNativeVideoFrames: false,
  supportsNativeAudio: false,
  supportsNativePdf: true,
  maxInputTokens: 1_000_000, // 1M tokens native input
  maxOutputTokens: 128_000,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], // effort ladder (Claude models doc)
  maxPdfPagesPerRequest: CLAUDE_VERTEX_MAX_PDF_PAGES,
  maxRequestBytes: CLAUDE_VERTEX_MAX_REQUEST_BYTES,
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
  maxInputTokens: 1_000_000, // 1M tokens native input
  maxOutputTokens: 128_000,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], // effort ladder (Claude models doc)
  maxPdfPagesPerRequest: CLAUDE_VERTEX_MAX_PDF_PAGES,
  maxRequestBytes: CLAUDE_VERTEX_MAX_REQUEST_BYTES,
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
  maxInputTokens: 1_048_576,
  maxOutputTokens: 65_536,
  // thinkingLevel LOW, MEDIUM (default), HIGH; MINIMAL is refused on 3.8 Flash (Google's 3.8 Flash guide).
  reasoningEfforts: ['low', 'medium', 'high'],
  contextWindowTokens: 1_048_576, // 1M combined tokens
  // No verified per-request PDF-page or body limit for this model on Vertex yet; the provider's
  // own rejection (mapped to provider_payload_limit) is the backstop.
  maxPdfPagesPerRequest: null,
  maxRequestBytes: null,
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
  maxInputTokens: 128_000,
  maxOutputTokens: 8_192,
  reasoningEfforts: [],
  contextWindowTokens: 128_000,
  maxPdfPagesPerRequest: null,
  maxRequestBytes: null,
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
    maxInputTokens: 128_000,
    maxOutputTokens: 4_096,
    reasoningEfforts: [],
    contextWindowTokens: 128_000,
    maxPdfPagesPerRequest: null,
    maxRequestBytes: null,
  };
}

/**
 * The effort a model runs at: the requested level, or the highest level below it the model
 * accepts. Undefined for a model with no effort control, so nothing is sent.
 */
export function effortFor(spec: ModelCapabilitySpec, requested: ReasoningEffort): ReasoningEffort | undefined {
  const ladder = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
  for (let i = ladder.indexOf(requested); i >= 0; i -= 1) {
    if (spec.reasoningEfforts.includes(ladder[i]!)) return ladder[i];
  }
  return spec.reasoningEfforts[0];
}
