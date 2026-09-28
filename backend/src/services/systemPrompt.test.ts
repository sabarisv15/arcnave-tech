import { describe, expect, it } from 'vitest';
import { buildDynamicRuntimeContext } from './systemPrompt.js';
import { InMemoryCapabilityRegistry } from '../capabilities/registry.js';
import type { Config } from '../config.js';

describe('systemPrompt runtime capabilities', () => {
  it('includes Markdown, KaTeX math, and Mermaid diagrams rendering capabilities', () => {
    const cfg = { ENABLE_TOOL_USE: true } as Config;
    const caps = new InMemoryCapabilityRegistry();
    const prompt = buildDynamicRuntimeContext(cfg, caps);
    expect(prompt).toContain(
      'The chat renders Markdown, `$$…$$` math with KaTeX, and ```mermaid``` diagrams.',
    );
  });
});

describe('the skill rule and the tool rule (ADR-0051)', () => {
  const cfg = { ENABLE_TOOL_USE: true } as Config;
  const caps = (skills: boolean) =>
    new InMemoryCapabilityRegistry([
      { id: 'python.execute', status: 'full' },
      ...(skills ? [{ id: 'skills.discover', status: 'full' as const }] : []),
    ]);

  it('repeats the skill rule, with the examples, after the file guidance', () => {
    const prompt = buildDynamicRuntimeContext(cfg, caps(true));
    const reminder = prompt.indexOf('<skills_reminder>');
    expect(reminder).toBeGreaterThan(prompt.indexOf('</files>'));
    expect(prompt.slice(reminder)).toContain('answer from what you see; no tool, no view');
    expect(prompt.slice(reminder)).toContain('does not depend on whether the task seems to need a skill');
  });

  it('leaves the reminder out when there are no skills', () => {
    expect(buildDynamicRuntimeContext(cfg, caps(false))).not.toContain('<skills_reminder>');
  });
});
