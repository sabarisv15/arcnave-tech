/**
 * Deterministic serialization and SHA-256 fingerprinting for prompt caching.
 */

import { createHash } from 'node:crypto';
import type { ToolDefinition } from '../../providers/types.js';
import type { ToolBundleName } from './types.js';

/**
 * Recursively sort keys of an object to ensure byte-identical JSON stringification.
 */
export function canonicalizeJson(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    return `[${val.map(canonicalizeJson).join(',')}]`;
  }

  const entries = Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const serializedProps = entries.map(
    ([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`,
  );

  return `{${serializedProps.join(',')}}`;
}

/**
 * Canonicalizes and sorts tools alphabetically by name.
 */
export function canonicalizeTools(tools: ToolDefinition[]): ToolDefinition[] {
  return [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: JSON.parse(canonicalizeJson(t.inputSchema)),
    }));
}

/**
 * Calculates SHA-256 hash of canonicalized tools.
 */
export function computeToolBundleHash(tools: ToolDefinition[]): string {
  const canonical = canonicalizeTools(tools);
  const json = canonicalizeJson(canonical);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Computes SHA-256 hash of the complete stable prefix.
 */
export function computePrefixHash(systemText: string, toolBundleHash: string): string {
  return createHash('sha256')
    .update(`${systemText}::${toolBundleHash}`, 'utf8')
    .digest('hex');
}

const KNOWN_BUNDLES: { name: ToolBundleName; toolNames: Set<string> }[] = [
  {
    name: 'chat_core',
    toolNames: new Set(['create_artifact', 'read_artifact', 'update_artifact']),
  },
  {
    name: 'project',
    toolNames: new Set([
      'create_artifact',
      'read_artifact',
      'update_artifact',
      'search_project_files',
      'read_project_file',
      'read_uploaded_file',
    ]),
  },
  {
    name: 'research',
    toolNames: new Set([
      'create_artifact',
      'read_artifact',
      'update_artifact',
      'search_project_files',
      'read_project_file',
      'read_uploaded_file',
      'web_search',
      'web_fetch',
      'list_skills',
      'search_skills',
      'read_skill',
    ]),
  },
  {
    name: 'agent',
    toolNames: new Set([
      'create_artifact',
      'read_artifact',
      'update_artifact',
      'search_project_files',
      'read_project_file',
      'read_uploaded_file',
      'web_search',
      'web_fetch',
      'list_skills',
      'search_skills',
      'read_skill',
      'run_python',
      'get_goal',
      'update_goal',
      'get_context_remaining',
      'save_memory',
      'search_chats',
      'search_memory',
      'read_memory',
      'update_memory',
      'forget_memory',
    ]),
  },
];

/**
 * Matches an authorized tool list against known bundle profiles for observability.
 */
export function identifyBundle(tools: ToolDefinition[]): ToolBundleName {
  const current = new Set(tools.map((t) => t.name));
  for (const bundle of KNOWN_BUNDLES) {
    if (
      current.size === bundle.toolNames.size &&
      [...current].every((name) => bundle.toolNames.has(name))
    ) {
      return bundle.name;
    }
  }
  return 'custom';
}
