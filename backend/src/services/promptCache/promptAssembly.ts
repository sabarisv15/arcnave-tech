/**
 * Canonical Prompt Assembly Engine.
 *
 * Orders prompt inputs strictly by stability:
 * 1. Stable prefix (Tools + Frozen Base System Prompt v1 + Stable Policies)
 * 2. Cache boundary
 * 3. Dynamic runtime suffix (Capabilities, standing prefs, project instructions, memory, compaction, retrieval, goal)
 */

import type { ToolDefinition } from '../../providers/types.js';
import { STATIC_BASE_SYSTEM_PROMPT_V1 } from '../systemPrompt.js';
import { STATIC_MEMORY_POLICY_V1 } from '../memory/policy.js';
import { STATIC_COMPACTION_POLICY_V1 } from '../compaction/policy.js';
import { GENERATIVE_UI_POLICY_V1, ANALYTICS_POLICY_V1 } from '../ui/policy.js';
import {
  canonicalizeTools,
  computePrefixHash,
  computeToolBundleHash,
  identifyBundle,
} from './fingerprints.js';
import type { DynamicSuffix, PromptAssembly, StablePrefix } from './types.js';

/**
 * Builds the 100% stable prefix shared across all requests for a given tool authorization set.
 */
export function buildStablePrefix(authorizedTools: ToolDefinition[]): StablePrefix {
  const systemText = [
    STATIC_BASE_SYSTEM_PROMPT_V1,
    STATIC_MEMORY_POLICY_V1,
    STATIC_COMPACTION_POLICY_V1,
    GENERATIVE_UI_POLICY_V1,
    ANALYTICS_POLICY_V1,
  ].join('\n\n');

  const tools = canonicalizeTools(authorizedTools);
  const toolBundleHash = computeToolBundleHash(tools);
  const prefixHash = computePrefixHash(systemText, toolBundleHash);
  const bundleName = identifyBundle(tools);

  return {
    systemText,
    tools,
    toolBundleHash,
    prefixHash,
    bundleName,
  };
}

/**
 * Assembles the full prompt structure separating the stable cacheable prefix from dynamic per-turn suffix.
 */
export function assemblePrompt(
  authorizedTools: ToolDefinition[],
  dynamicSuffix: DynamicSuffix,
): PromptAssembly {
  const stablePrefix = buildStablePrefix(authorizedTools);

  const dynamicParts: string[] = [];

  if (dynamicSuffix.runtimeCapabilities?.trim()) {
    dynamicParts.push(dynamicSuffix.runtimeCapabilities.trim());
  }

  if (dynamicSuffix.standingPreferences?.trim()) {
    dynamicParts.push(
      `<standing_preferences>\n${dynamicSuffix.standingPreferences.trim()}\n</standing_preferences>`,
    );
  }

  if (dynamicSuffix.projectInstructions?.trim()) {
    dynamicParts.push(
      `<project_instructions>\n${dynamicSuffix.projectInstructions.trim()}\n</project_instructions>`,
    );
  }

  if (dynamicSuffix.relevantMemory?.trim()) {
    dynamicParts.push(
      `<memory_context>\nThe following stored information may be relevant to the current task. Use only what materially improves the answer.\n${dynamicSuffix.relevantMemory.trim()}\n</memory_context>`,
    );
  }

  if (dynamicSuffix.compactionSummary?.trim()) {
    dynamicParts.push(
      `<conversation_compaction>\n${dynamicSuffix.compactionSummary.trim()}\n</conversation_compaction>`,
    );
  }

  if (dynamicSuffix.attachmentManifest?.trim()) {
    dynamicParts.push(
      `Attached files available to inspect:\n${dynamicSuffix.attachmentManifest.trim()}`,
    );
  }

  if (dynamicSuffix.attachmentText?.trim()) {
    dynamicParts.push(
      `Text extracted from files attached to this message:\n${dynamicSuffix.attachmentText.trim()}`,
    );
  }

  if (dynamicSuffix.retrievedContext?.trim()) {
    dynamicParts.push(dynamicSuffix.retrievedContext.trim());
  }

  if (dynamicSuffix.goalContext?.trim()) {
    dynamicParts.push(
      `<active_goal>\n${dynamicSuffix.goalContext.trim()}\n</active_goal>`,
    );
  }

  if (dynamicSuffix.modePrompt?.trim()) {
    dynamicParts.push(dynamicSuffix.modePrompt.trim());
  }

  if (dynamicSuffix.skillsContext?.trim()) {
    dynamicParts.push(
      `<skills_guidance>\n${dynamicSuffix.skillsContext.trim()}\n</skills_guidance>`,
    );
  }

  const fullSystemInstruction = [stablePrefix.systemText, ...dynamicParts].join('\n\n');

  return {
    stablePrefix,
    dynamicSuffix,
    fullSystemInstruction,
  };
}
