import { describe, expect, it } from 'vitest';
import { buildDynamicRuntimeContext } from './systemPrompt.js';
import { InMemoryCapabilityRegistry } from '../capabilities/registry.js';
import type { Config } from '../config.js';

describe('systemPrompt runtime capabilities', () => {
  it('includes Markdown, KaTeX math, and Mermaid diagrams rendering capabilities', () => {
    const cfg = { ENABLE_TOOL_USE: true } as Config;
    const caps = new InMemoryCapabilityRegistry();
    const prompt = buildDynamicRuntimeContext(cfg, caps, false);
    expect(prompt).toContain(
      'The chat renders Markdown, `$$…$$` math with KaTeX, and ```mermaid``` diagrams.',
    );
  });
});
