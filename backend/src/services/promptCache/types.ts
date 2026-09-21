/**
 * Provider-neutral prompt caching types and interfaces.
 */

import type { ToolDefinition } from '../../providers/types.js';

export type ToolBundleName = 'chat_core' | 'project' | 'research' | 'agent' | 'custom';

export interface StablePrefix {
  /** 100% static system text: Base System Prompt v1 + static policies. */
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

export interface DynamicSuffix {
  runtimeCapabilities?: string;
  standingPreferences?: string;
  projectInstructions?: string;
  relevantMemory?: string;
  compactionSummary?: string;
  attachmentManifest?: string;
  attachmentText?: string;
  retrievedContext?: string;
  modePrompt?: string;
  goalContext?: string;
  skillsContext?: string;
}

export interface PromptAssembly {
  stablePrefix: StablePrefix;
  dynamicSuffix: DynamicSuffix;
  /** Full assembled system instruction for providers that don't support multi-part system blocks. */
  fullSystemInstruction: string;
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
