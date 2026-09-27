import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../../providers/types.js';
import {
  canonicalizeJson,
  canonicalizeTools,
  computePrefixHash,
  computeToolBundleHash,
  identifyBundle,
} from './fingerprints.js';
import { assemblePrompt, buildStablePrefix } from './promptAssembly.js';
import { getProviderCacheCapability } from './providerPolicy.js';
import { normalizeCacheMetrics } from './telemetry.js';

describe('Prompt Caching Subsystem', () => {
  const toolA: ToolDefinition = {
    name: 'create_artifact',
    description: 'Create an artifact',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  };

  const toolB: ToolDefinition = {
    name: 'read_artifact',
    description: 'Read an artifact',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  };

  const toolC: ToolDefinition = {
    name: 'update_artifact',
    description: 'Update an artifact',
    inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
  };

  describe('Deterministic Fingerprints & Tool Ordering', () => {
    it('produces byte-identical JSON regardless of key insertion order', () => {
      const obj1 = { b: 2, a: 1, nested: { y: 20, x: 10 } };
      const obj2 = { a: 1, nested: { x: 10, y: 20 }, b: 2 };

      expect(canonicalizeJson(obj1)).toBe(canonicalizeJson(obj2));
      expect(canonicalizeJson(obj1)).toBe('{"a":1,"b":2,"nested":{"x":10,"y":20}}');
    });

    it('produces identical toolBundleHash when tools are provided in different orders', () => {
      const tools1 = [toolC, toolA, toolB];
      const tools2 = [toolA, toolB, toolC];

      const hash1 = computeToolBundleHash(tools1);
      const hash2 = computeToolBundleHash(tools2);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('correctly maps recognized tool bundles to canonical bundle names', () => {
      const ask: ToolDefinition = { name: 'ask_user_input_v0', description: '', inputSchema: { type: 'object' } };
      expect(identifyBundle([ask])).toBe('chat_core');

      const customTools = [toolA];
      expect(identifyBundle(customTools)).toBe('custom');
    });
  });

  describe('Stable Prefix vs Volatile Dynamic Suffix', () => {
    it('generates byte-identical stable prefix despite differing user turns and volatile data', () => {
      const tools = [toolA, toolB, toolC];

      const assembly1 = assemblePrompt(tools, {
        projectInstructions: 'Project alpha guidelines',
        retrievedContext: 'chunk 1 text',
        modePrompt: 'Cite search sources',
      });

      const assembly2 = assemblePrompt(tools, {
        projectInstructions: 'Project beta guidelines',
        retrievedContext: 'chunk 99 text',
        modePrompt: 'Different mode hint',
      });

      // Stable prefixes must be 100% byte-identical
      expect(assembly1.stablePrefix.systemText).toBe(assembly2.stablePrefix.systemText);
      expect(assembly1.stablePrefix.toolBundleHash).toBe(assembly2.stablePrefix.toolBundleHash);
      expect(assembly1.stablePrefix.prefixHash).toBe(assembly2.stablePrefix.prefixHash);

      // But full system instruction reflects dynamic context
      expect(assembly1.fullSystemInstruction).not.toBe(assembly2.fullSystemInstruction);
      expect(assembly1.fullSystemInstruction).toContain('Project alpha guidelines');
      expect(assembly2.fullSystemInstruction).toContain('Project beta guidelines');
    });

    it('ensures attached files and attachment text never contaminate system prompt', () => {
      const tools = [toolA, toolB, toolC];
      const assembly = assemblePrompt(tools, {
        attachmentManifest: 'sensitive_financial_model.xlsx',
        retrievedContext: 'clean context',
      });
      expect(assembly.fullSystemInstruction).not.toContain('sensitive_financial_model.xlsx');
      expect(assembly.fullSystemInstruction).not.toContain('REVENUE = 50000000');
      expect(assembly.fullSystemInstruction).toContain('clean context');
    });

    it('places dynamic sections strictly after the stable system text', () => {
      const tools = [toolA, toolB, toolC];
      const assembly = assemblePrompt(tools, {
        runtimeCapabilities: '<arcNave_capabilities>\n- tool1\n</arcNave_capabilities>',
        standingPreferences: 'Always use concise language.',
        projectInstructions: 'ArcNave Backend project.',
      });

      const system = assembly.fullSystemInstruction;
      const staticEnd = system.indexOf('Stop when the useful response is complete.');
      const capIndex = system.indexOf('<arcNave_capabilities>');
      const prefIndex = system.indexOf('<standing_preferences>');
      const projIndex = system.indexOf('<project_instructions>');

      expect(staticEnd).toBeGreaterThan(0);
      expect(capIndex).toBeGreaterThan(staticEnd);
      expect(prefIndex).toBeGreaterThan(capIndex);
      expect(projIndex).toBeGreaterThan(prefIndex);
    });

    it('contains the style block after the static prefix and keeps the prefix byte-identical with and without style', () => {
      const tools = [toolA, toolB];
      const withoutStyle = assemblePrompt(tools, {
        standingPreferences: 'Be honest.',
      });
      const withStyle = assemblePrompt(tools, {
        standingPreferences: 'Be honest.',
        styleInstructions: 'Respond concisely with bullet points.',
      });

      // Stable prefix is 100% byte-identical
      expect(withStyle.stablePrefix.systemText).toBe(withoutStyle.stablePrefix.systemText);
      expect(withStyle.stablePrefix.prefixHash).toBe(withoutStyle.stablePrefix.prefixHash);

      // Full system instruction contains the style block in dynamic suffix
      expect(withoutStyle.fullSystemInstruction).not.toContain('<style_instructions>');
      expect(withStyle.fullSystemInstruction).toContain('<style_instructions>\nRespond concisely with bullet points.\n</style_instructions>');

      // Placed after the static prefix
      const staticEnd = withStyle.fullSystemInstruction.indexOf('Stop when the useful response is complete.');
      const styleIndex = withStyle.fullSystemInstruction.indexOf('<style_instructions>');
      expect(styleIndex).toBeGreaterThan(staticEnd);
    });
  });

  describe('Tool policies follow the tools allowed this turn (Invariant 1)', () => {
    it('includes the memory and UI policies only when their tool is allowed', () => {
      const none = buildStablePrefix([], []).systemText;
      expect(none).not.toContain('<memory_policy>');
      expect(none).not.toContain('<visuals>');
      const all = buildStablePrefix([{ name: 'show_widget', description: '', inputSchema: {} } as never], ['memory_read', 'show_widget', 'bash_tool']).systemText;
      // Allowed but not declared: its policy, which names the tool, stays out.
      expect(buildStablePrefix([], ['show_widget']).systemText).not.toContain('<visuals>');
      expect(all).toContain('<memory_policy>');
      expect(all).toContain('<visuals>');
    });
  });

  describe('Provider Caching Policy & Thresholds', () => {
    it('evaluates model-specific caching thresholds correctly', () => {
      const claude = getProviderCacheCapability('anthropic', 'claude-sonnet-5');
      expect(claude.supportsExplicitCaching).toBe(true);
      expect(claude.minPrefixTokens).toBe(1024);

      const geminiFlash = getProviderCacheCapability('google', 'gemini-3.8-flash');
      expect(geminiFlash.supportsImplicitCaching).toBe(true);
      expect(geminiFlash.minPrefixTokens).toBe(6144);

      const gemini25 = getProviderCacheCapability('google', 'gemini-2.5-flash');
      expect(gemini25.supportsImplicitCaching).toBe(true);
      expect(gemini25.minPrefixTokens).toBe(2048);

      const unsupported = getProviderCacheCapability('openai-oss', 'gpt-oss-120b');
      expect(unsupported.supportsImplicitCaching).toBe(false);
      expect(unsupported.supportsExplicitCaching).toBe(false);
    });
  });

  describe('Cache Telemetry & Normalization', () => {
    it('normalizes cache hit metrics and calculates estimated savings', () => {
      const usage = {
        inputTokens: 5000,
        outputTokens: 200,
        cacheReadTokens: 4000,
        cacheWriteTokens: 0,
        exact: true,
      };

      const pricing = {
        input: 3.0, // $3.00 per 1M tokens
        output: 15.0,
        cacheRead: 0.3, // $0.30 per 1M tokens (0.1x)
        cacheWrite: 3.75,
      };

      const metrics = normalizeCacheMetrics('anthropic', 'claude-sonnet-5', 'hash123', usage, pricing, 120);

      expect(metrics.cacheHit).toBe(true);
      expect(metrics.cacheReadTokens).toBe(4000);
      expect(metrics.uncachedInputTokens).toBe(1000);
      expect(metrics.ttftMs).toBe(120);

      // Baseline cost without cache: 4000 * 3.0 / 1e6 = $0.012
      // Cached cost: 4000 * 0.3 / 1e6 = $0.0012
      // Savings = $0.0108
      expect(metrics.estimatedInputCostSaved).toBeCloseTo(0.0108, 4);
    });
  });
});
