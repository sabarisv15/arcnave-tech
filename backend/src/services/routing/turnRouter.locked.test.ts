/**
 * ADR-0006: the router is a policy boundary only. These cases encode the locked architecture.
 * The ones marked `it.fails` describe behaviour the router does not have yet. Phase 1 of
 * docs/superpowers/plans/2026-09-24-tools-pipeline-gap-fixes.md turns them into plain `it`.
 * If one starts passing before that, vitest reports it, which is how the fix is proven.
 */
import { describe, expect, it } from 'vitest';
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

describe('routeTurn — ADR-0006 locked architecture', () => {
  // G1: whatever the intent, the model keeps core discovery.
  const prompts = [
    'Count every transaction exactly and classify them',
    'Summarize this PDF',
    'hi',
  ];
  for (const prompt of prompts) {
    it.fails(`"${prompt}" exposes search_tools and load_skill`, () => {
      const decision = routeTurn(withPdf(prompt));
      expect(decision.exposedTools).toEqual(expect.arrayContaining(['search_tools', 'load_skill']));
    });
  }

  // G2: permission, not wording, decides whether run_python is in the catalog.
  it.fails('bank-statement PDF prompt has run_python in the allowed catalog when the sandbox is enabled', () => {
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

  it('load_skill is not allowed when there are no skills to load', () => {
    const decision = routeTurn(withPdf('hi', { candidateSkills: [] }));
    expect(decision.allowedTools).not.toContain('load_skill');
  });
});
