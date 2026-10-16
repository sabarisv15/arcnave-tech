/**
 * Model Capability Table.
 *
 * Centralized, authoritative reference for provider/model modalities, maximum encoded bytes,
 * resolution thresholds, and tool capabilities. Eliminates hardcoded magic numbers across adapters.
 */

import type { ReasoningEffort } from './types.js';

export interface ModelCapabilitySpec {
  alias: string;
  provider: 'google' | 'anthropic';
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
  /**
   * The model's reliable knowledge cutoff as YYYY-MM, from the provider's own model page, or
   * `null` when no official page could be read: `<model_info>` then leaves the attribute out
   * rather than guess (ADR-0075).
   */
  knowledgeCutoff: string | null;
}

/**
 * Claude on the first-party Claude API (ADR-0054), from Anthropic's docs, read 2026-10-14:
 * - PDF support: 600 pages per request (100 when the context window is under 1M tokens).
 *   https://docs.claude.com/en/docs/build-with-claude/pdf-support
 * - API overview, request size limits: Messages API 32 MB per request.
 *   https://docs.claude.com/en/api/overview#request-size-limits
 * - Models overview: Sonnet 5.5 and Opus 5.5, 1M-token context, 128K output, effort low…max.
 *   https://docs.claude.com/en/docs/about-claude/models
 * Both size figures are whole-request limits; the 1M window means 600 pages applies.
 */
const CLAUDE_API_MAX_PDF_PAGES = 600;
/** Models overview, "Reliable knowledge cutoff: Jun 2026" for Sonnet 5.5 and Opus 5.5.
 *  https://platform.claude.com/docs/en/about-claude/models/overview, read 2026-10-16. */
const CLAUDE_55_KNOWLEDGE_CUTOFF = '2026-06';
const CLAUDE_API_MAX_REQUEST_BYTES = 32_000_000;

const CLAUDE_SONNET_55_SPEC: ModelCapabilitySpec = {
  alias: 'Sonnet 5.5',
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
  maxPdfPagesPerRequest: CLAUDE_API_MAX_PDF_PAGES,
  maxRequestBytes: CLAUDE_API_MAX_REQUEST_BYTES,
  knowledgeCutoff: CLAUDE_55_KNOWLEDGE_CUTOFF,
};

const CLAUDE_OPUS_55_SPEC: ModelCapabilitySpec = {
  alias: 'Opus 5.5',
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
  maxPdfPagesPerRequest: CLAUDE_API_MAX_PDF_PAGES,
  maxRequestBytes: CLAUDE_API_MAX_REQUEST_BYTES,
  knowledgeCutoff: CLAUDE_55_KNOWLEDGE_CUTOFF,
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
  // Google's model page could not be read from the build environment on 2026-10-16 (Stage 7.9
  // says Mar 2026, from secondary sources); unverified, so not stated (DEFERRED).
  knowledgeCutoff: null,
};

export const MODEL_CAPABILITIES: Record<string, ModelCapabilitySpec> = {
  'Gemini 3.8 Flash': GEMINI_38_FLASH_SPEC,
  'gemini-3.8-flash': GEMINI_38_FLASH_SPEC,
  'claude-sonnet-5-5': CLAUDE_SONNET_55_SPEC,
  'Sonnet 5.5': CLAUDE_SONNET_55_SPEC,
  'claude-opus-5-5': CLAUDE_OPUS_55_SPEC,
  'Opus 5.5': CLAUDE_OPUS_55_SPEC,
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
    knowledgeCutoff: null,
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
