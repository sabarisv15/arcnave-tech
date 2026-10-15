/**
 * Canonical Prompt Assembly Engine.
 *
 * Orders prompt inputs strictly by stability:
 * 1. Stable prefix (Tools + Frozen Base System Prompt v1 + Stable Policies)
 * 2. Cache boundary
 * 3. Dynamic runtime suffix (Capabilities, standing prefs, project instructions, memory, compaction, retrieval, goal)
 */

import type { ToolDefinition } from '../../providers/types.js';
import { buildStaticBasePrompt } from '../systemPrompt.js';
import { STATIC_MEMORY_POLICY_V1, STATIC_PAST_CHATS_POLICY_V1 } from '../memory/policy.js';
import { STATIC_COMPACTION_POLICY_V1 } from '../compaction/policy.js';
import { GENERATIVE_UI_POLICY_V1 } from '../ui/policy.js';
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
  // about memory or visuals with neither available promises what the request cannot keep
  // (Invariant 1). Still stable per tool set, which is what the prefix cache keys on.
  const allowed = new Set(allowedToolNames ?? authorizedTools.map((t) => t.name));
  const systemText = [
    // read_me ships with show_widget; the base names it (to forbid narrating it) only when declared.
    buildStaticBasePrompt(allowed.has('read_me')),
    ...(allowed.has('memory_read') ? [STATIC_MEMORY_POLICY_V1] : []),
    // Past-chat search is its own user setting (ADR-0052), so its rules ride with its tools.
    ...(allowed.has('conversation_search') ? [STATIC_PAST_CHATS_POLICY_V1] : []),
    STATIC_COMPACTION_POLICY_V1,
    // The visuals policy names show_widget and the cards, so it goes in only when they are
    // declared: a model can only call what it was declared (Gemini function calling).
    ...(authorizedTools.some((t) => t.name === 'show_widget') ? [GENERATIVE_UI_POLICY_V1] : []),
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
 * Wraps user-influenced text in its tag. A closing tag of the same name inside the text would end
 * the wrapper early and let what follows read as unwrapped system text, so `</tag` becomes
 * `&lt;/tag` (any case, optional space after the slash). Only that is touched: the blocks
 * legitimately carry system-written tags such as `<memory_listing>`, and prose keeps its `<` and `&`.
 */
function wrapTag(tag: string, text: string): string {
  const closing = new RegExp(`<(\\s*/\\s*${tag})(?![\\w:.-])`, 'gi');
  return `<${tag}>\n${text.trim().replace(closing, '&lt;$1')}\n</${tag}>`;
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
    dynamicParts.push(wrapTag('standing_preferences', dynamicSuffix.standingPreferences));
  }

  if (dynamicSuffix.projectInstructions?.trim()) {
    dynamicParts.push(wrapTag('project_instructions', dynamicSuffix.projectInstructions));
  }

  if (dynamicSuffix.styleInstructions?.trim()) {
    dynamicParts.push(wrapTag('style_instructions', dynamicSuffix.styleInstructions));
  }

  if (dynamicSuffix.relevantMemory?.trim()) {
    dynamicParts.push(wrapTag('memory', dynamicSuffix.relevantMemory));
  }

  if (dynamicSuffix.compactionSummary?.trim()) {
    dynamicParts.push(wrapTag('conversation_compaction', dynamicSuffix.compactionSummary));
  }

  if (dynamicSuffix.retrievedContext?.trim()) {
    dynamicParts.push(dynamicSuffix.retrievedContext.trim());
  }

  if (dynamicSuffix.goalContext?.trim()) {
    dynamicParts.push(wrapTag('active_goal', dynamicSuffix.goalContext));
  }

  if (dynamicSuffix.modePrompt?.trim()) {
    dynamicParts.push(dynamicSuffix.modePrompt.trim());
  }

  if (dynamicSuffix.skillsContext?.trim()) {
    dynamicParts.push(wrapTag('skills_guidance', dynamicSuffix.skillsContext));
  }

  const fullSystemInstruction = [stablePrefix.systemText, ...dynamicParts].join('\n\n');

  return {
    stablePrefix,
    dynamicSuffix,
    fullSystemInstruction,
  };
}
