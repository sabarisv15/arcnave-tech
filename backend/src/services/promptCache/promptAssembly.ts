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
export function buildStablePrefix(authorizedTools: ToolDefinition[], allowedToolNames?: string[]): StablePrefix {
  // A policy about a tool goes in only when the tool is allowed this turn: a prompt that talks
  // about memory or render_ui with neither available promises what the request cannot keep
  // (Invariant 1). Still stable per tool set, which is what the prefix cache keys on.
  const allowed = new Set(allowedToolNames ?? authorizedTools.map((t) => t.name));
  const systemText = [
    STATIC_BASE_SYSTEM_PROMPT_V1,
    ...(allowed.has('save_memory') ? [STATIC_MEMORY_POLICY_V1] : []),
    STATIC_COMPACTION_POLICY_V1,
    // render_ui's policy says "You have access to the render_ui tool", so it goes in only when
    // the tool is declared: a model can only call what it was declared (Gemini function calling).
    ...(authorizedTools.some((t) => t.name === 'render_ui') ? [GENERATIVE_UI_POLICY_V1] : []),
    ...(allowed.has('run_python') ? [ANALYTICS_POLICY_V1] : []),
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
  /** Tools allowed this turn including discoverable ones; defaults to the declared tools. */
  allowedToolNames?: string[],
): PromptAssembly {
  const stablePrefix = buildStablePrefix(authorizedTools, allowedToolNames);

  const dynamicParts: string[] = [];

  if (dynamicSuffix.currentDate?.trim()) {
    dynamicParts.push(dynamicSuffix.currentDate.trim());
  }

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
      `<memory>\nWhat you remember about this user from earlier conversations, by topic. Use it where it helps; do not recite it.\n${dynamicSuffix.relevantMemory.trim()}\n</memory>`,
    );
  }

  if (dynamicSuffix.compactionSummary?.trim()) {
    dynamicParts.push(
      `<conversation_compaction>\n${dynamicSuffix.compactionSummary.trim()}\n</conversation_compaction>`,
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
