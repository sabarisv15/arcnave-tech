import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ToolContent } from '../providers/types.js';
import { SkillService } from '../services/skills.js';
import { SkillToolExecutor } from './skillExecutor.js';

function jsonContent(content: ToolContent[]): Record<string, unknown> {
  const block = content[0];
  if (!block || block.type !== 'json') throw new Error('expected a json content block');
  return block.data as Record<string, unknown>;
}

describe('SkillToolExecutor', () => {
  let skillService: SkillService;

  beforeAll(async () => {
    const backendRoot = path.resolve(__dirname, '../../');
    skillService = new SkillService(backendRoot, 'skills');
    await skillService.load();
  });

  it('list_skills returns compact summaries of available skills', async () => {
    const executor = new SkillToolExecutor(skillService);
    const result = await executor.execute(
      { id: 'c1', name: 'list_skills', input: {} },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = jsonContent(result.content);
    const items = data.items as any[];
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(items.some((i) => i.name === 'pptx')).toBe(true);
    expect(items.some((i) => i.name === 'docx')).toBe(true);
  });

  it('search_skills finds relevant skills by keyword', async () => {
    const executor = new SkillToolExecutor(skillService);
    const result = await executor.execute(
      { id: 'c2', name: 'search_skills', input: { query: 'presentation slide deck' } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = jsonContent(result.content);
    const results = data.results as any[];
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.name).toBe('pptx');
  });

  it('read_skill returns complete instructions and capability mode', async () => {
    let loadedSkillName = '';
    const executor = new SkillToolExecutor(skillService, new Set(['generate_deliverable']), (s) => {
      loadedSkillName = s.name;
    });

    const result = await executor.execute(
      { id: 'c3', name: 'read_skill', input: { name: 'pptx' } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = jsonContent(result.content);
    expect(data.name).toBe('pptx');
    expect(data.mode).toBe('full');
    expect(data.missingCapabilities).toEqual([]);
    expect(data.content).toContain('Presentation (PPTX) Deck Design');
    expect(loadedSkillName).toBe('pptx');
  });

  it('read_skill accurately reports guidance_only mode when tool is missing', async () => {
    const executor = new SkillToolExecutor(skillService, new Set([])); // no artifact tools
    const result = await executor.execute(
      { id: 'c4', name: 'read_skill', input: { name: 'pptx' } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    const data = jsonContent(result.content);
    expect(data.name).toBe('pptx');
    expect(data.mode).toBe('guidance_only');
    expect(data.missingCapabilities).toEqual(['generate_deliverable']);
  });

  it('read_skill handles unknown skill gracefully with typed failure (Invariant 1)', async () => {
    const executor = new SkillToolExecutor(skillService);
    const result = await executor.execute(
      { id: 'c5', name: 'read_skill', input: { name: 'non_existent_skill' } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    expect(result.content[0]?.type).toBe('text');
    if (result.content[0]?.type === 'text') {
      expect(result.content[0].text).toContain('Skill "non_existent_skill" not found.');
    }
  });

  it('rejects path traversal attempts cleanly', async () => {
    const executor = new SkillToolExecutor(skillService);
    const result = await executor.execute(
      { id: 'c6', name: 'read_skill', input: { name: '../../package.json' } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    if (result.content[0]?.type === 'text') {
      expect(result.content[0].text).toContain('not found');
    }
  });

  it('handles AbortSignal gracefully', async () => {
    const executor = new SkillToolExecutor(skillService);
    const abortCtrl = new AbortController();
    abortCtrl.abort();

    const result = await executor.execute(
      { id: 'c7', name: 'list_skills', input: {} },
      abortCtrl.signal,
    );

    expect(result.ok).toBe(false);
    if (result.content[0]?.type === 'text') {
      expect(result.content[0].text).toContain('aborted');
    }
  });

  it('load_skill executes progressive disclosure and loads optional resource safely', async () => {
    let notifiedSkill = '';
    const executor = new SkillToolExecutor(skillService, new Set(['create_artifact']), (s) => {
      notifiedSkill = s.name;
    });

    // 1. Basic load_skill
    const result = await executor.execute(
      { id: 'c8', name: 'load_skill', input: { name: 'docx' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    const data = jsonContent(result.content);
    expect(data.name).toBe('docx');
    expect(data.content).toBeDefined();
    expect(notifiedSkill).toBe('docx');

    // 2. load_skill with resource that does not exist
    const resWithMissing = await executor.execute(
      { id: 'c9', name: 'load_skill', input: { name: 'docx', resource: 'template.docx' } },
      new AbortController().signal,
    );
    expect(resWithMissing.ok).toBe(true);
    const dataMissing = jsonContent(resWithMissing.content);
    expect(dataMissing.resourcePath).toBe('template.docx');
    expect(dataMissing.resourceContent).toBe('[Resource file not found]');

    // 3. load_skill with path traversal resource attempt
    const resWithTraversal = await executor.execute(
      { id: 'c10', name: 'load_skill', input: { name: 'docx', resource: '../../package.json' } },
      new AbortController().signal,
    );
    expect(resWithTraversal.ok).toBe(true);
    const dataTraversal = jsonContent(resWithTraversal.content);
    expect(dataTraversal.resourceContent).toBe('[Resource file not found]');
  });
});
