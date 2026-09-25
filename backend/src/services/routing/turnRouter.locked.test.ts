/**
 * ADR-0006: the router is a policy boundary only. These cases encode the locked architecture.
 * They were `it.fails` in Phase 0 (proving the bug) and became plain `it` with the Phase 1 fix
 * in docs/superpowers/plans/2026-09-24-tools-pipeline-gap-fixes.md.
 */
import { describe, expect, it } from 'vitest';

import { DECLARED_EVERY_TURN } from '../../tools/registry.js';
import { routeTurn, type RouteTurnInput } from './turnRouter.js';

const candidateSkills = [
  { name: 'pdf', description: 'PDF reading, extraction and generation' },
  { name: 'xlsx', description: 'Spreadsheet architecture' },
];

function withPdf(prompt: string, overrides: Partial<RouteTurnInput> = {}): RouteTurnInput {
  return {
    prompt,
    mode: 'chat',
    hasAttachments: true,
    attachmentMimeTypes: ['application/pdf'],
    attachmentNames: ['bank-statement.pdf'],
    candidateSkills,
    hasProject: false,
    runPythonEnabled: true,
    ...overrides,
  };
}

/** Discovery tools, then the allowed tools declared on every turn (ADR-0022). */
const core = (d: { allowedTools: string[] }, discovery = ['search_tools', 'load_skill']): string[] => [
  ...discovery,
  ...DECLARED_EVERY_TURN.filter((n) => d.allowedTools.includes(n)),
];

describe('routeTurn — ADR-0006 locked architecture', () => {
  // G1: whatever the intent, the model keeps core discovery.
  const prompts = [
    'Count every transaction exactly and classify them',
    'Summarize this PDF',
    'hi',
  ];
  for (const prompt of prompts) {
    it(`"${prompt}" exposes search_tools and load_skill`, () => {
      const decision = routeTurn(withPdf(prompt));
      expect(decision.exposedTools).toEqual(expect.arrayContaining(['search_tools', 'load_skill']));
    });
  }

  // G2: permission, not wording, decides whether run_python is in the catalog.
  it('bank-statement PDF prompt has run_python in the allowed catalog when the sandbox is enabled', () => {
    const decision = routeTurn(withPdf('Count every transaction exactly and classify them'));
    expect(decision.allowedTools).toContain('run_python');
  });

  // Permission still blocks. This holds today and must keep holding after Phase 1.
  it('run_python stays out of the catalog when the sandbox is disabled, whatever the prompt says', () => {
    const decision = routeTurn(
      withPdf('run this python script with pandas', { runPythonEnabled: false }),
    );
    expect(decision.allowedTools).not.toContain('run_python');
  });

  // G3: render_ui is discoverable whenever generative UI is enabled.
  it('render_ui is in the allowed catalog when generative UI is enabled, and only then', () => {
    expect(routeTurn(withPdf('hi', { generativeUiEnabled: true })).allowedTools).toContain('render_ui');
    expect(routeTurn(withPdf('hi')).allowedTools).not.toContain('render_ui');
  });

  it('without skills the core is search_tools alone', () => {
    const bare = routeTurn(withPdf('hi', { candidateSkills: [] }));
    expect(bare.exposedTools).toEqual(core(bare, ['search_tools']));
  });

  it('intent stays as telemetry: classification still happens but gates nothing', () => {
    const decision = routeTurn(withPdf('explain Monte Carlo simulation'));
    expect(decision.detectedIntent).toBe('EXPLANATION');
    expect(decision.exposedTools).toEqual(core(decision));
    expect(decision.allowedTools).toContain('run_python');
  });

  it('load_skill is not allowed when there are no skills to load', () => {
    const decision = routeTurn(withPdf('hi', { candidateSkills: [] }));
    expect(decision.allowedTools).not.toContain('load_skill');
  });
});
