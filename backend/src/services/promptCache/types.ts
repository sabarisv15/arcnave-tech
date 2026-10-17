/**
 * Provider-neutral prompt caching types and interfaces.
 */

import type { ToolDefinition } from '../../providers/types.js';

export type ToolBundleName = 'chat_core' | 'project' | 'research' | 'agent' | 'custom';

export interface StablePrefix {
  /**
   * The text identical for every turn with the same provider, tool set and skills: the v3 base,
   * the skills list and the product-tools appendix (ADR-0075). Claude caches it with a breakpoint;
   * for Gemini it is the whole system instruction (no user, memory or date text inside it).
   */
  systemText: string;
  /** Authorized tool definitions, sorted deterministically by name with canonical key order. */
  tools: ToolDefinition[];
  /** SHA-256 fingerprint of the canonical tools JSON. */
  toolBundleHash: string;
  /** SHA-256 fingerprint of systemText + toolBundleHash. */
  prefixHash: string;
  /** High-level recognized bundle name for observability/telemetry. */
  bundleName: ToolBundleName;
}

export interface PromptAssembly {
  stablePrefix: StablePrefix;
  /** Session state (model_info, capabilities_state, profile, memory, instructions): system side. */
  sessionState: string;
  /** Per-turn state (current_time, an earlier-conversation summary). */
  perTurn: string;
  /**
   * The system instruction the provider is sent. Claude: stable text + session state. Gemini:
   * the stable text only; the session state moves into the turn (doc-sync 2026-10-05).
   */
  fullSystemInstruction: string;
  /** The leading text of the current user turn: what of the session and per-turn state is not in the system instruction. */
  turnPreamble: string;
  /** First 12 hex of the SHA-256 of the provider's base file and the appendix file. */
  promptVersion: string;
  /** The size of each block, for the turn log (characters, never content). */
  blockSizes: Record<string, number>;
}

export interface CacheMetrics {
  provider: string;
  model: string;
  toolBundleHash: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  uncachedInputTokens: number;
  cacheHit: boolean;
  estimatedInputCost?: number | null;
  estimatedInputCostSaved?: number | null;
  ttftMs?: number;
}
