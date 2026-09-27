import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { SkillService } from './skills.js';

describe('SkillService', () => {
  let service: SkillService;

  beforeAll(async () => {
    // Point to backend root and skills folder
    const backendRoot = path.resolve(__dirname, '../../');
    service = new SkillService(backendRoot, 'skills');
    await service.load();
  });

  it('loads all production skills correctly', () => {
    const list = service.listSkills();
    expect(list.length).toBeGreaterThanOrEqual(7);

    const names = list.map((s) => s.name);
    expect(names).toContain('docx');
    expect(names).toContain('pptx');
    expect(names).toContain('xlsx');
    expect(names).toContain('pdf');
    expect(names).toContain('pdf-reading');
    expect(names).toContain('skill-creator');
  });

  it('splits PDF reading from PDF building', () => {
    const reading = service.getSkill('pdf-reading', ['bash_tool']);
    expect(reading).not.toBeNull();
    // Skills are read with view, so a skill is offered only on a turn with the computer.
    expect(reading?.missingTools).toEqual([]);
    // Pages already in view are read from the view in one pass, not looked at again through
    // tool calls a few at a time: those ran a turn out of tool steps (2026-09-27).
    expect(reading?.content).toContain('Read every row from them in one pass');
    expect(reading?.content).not.toContain('read the pages yourself a few at a time');

    const building = service.getSkill('pdf', ['bash_tool']);
    expect(building?.content).not.toContain('## Exact counts, totals and complete lists');
    expect(building?.description).toContain('use the pdf-reading skill');
  });

  it('never shows a half-loaded registry, during a reload or before the first load finishes', async () => {
    const full = service.listSkills().map((s) => s.name);
    const reloading = service.reload();
    // The reload has started reading the directory; the old registry still answers whole.
    expect(service.listSkills().map((s) => s.name)).toEqual(full);
    await reloading;
    expect(service.listSkills().map((s) => s.name)).toEqual(full);

    const fresh = new SkillService(path.resolve(__dirname, '../../'), 'skills');
    void fresh.load();
    await fresh.whenLoaded();
    expect(fresh.listSkills().map((s) => s.name)).toEqual(full);
  });

  it('evaluates tool dependencies honestly (guidance_only vs full)', () => {
    // The file skills build with code: without the computer they are guidance only.
    for (const name of ['docx', 'pdf', 'pptx', 'xlsx', 'pdf-reading', 'file-reading']) {
      const withoutTool = service.getSkill(name, []);
      expect(withoutTool?.mode).toBe('guidance_only');
      expect(withoutTool?.missingCapabilities).toEqual(['bash_tool']);

      const withTool = service.getSkill(name, ['bash_tool']);
      expect(withTool?.mode).toBe('full');
      expect(withTool?.missingCapabilities).toEqual([]);
    }
  });

  it('prevents path traversal attempts completely', () => {
    expect(service.getSkill('../../package.json')).toBeNull();
    expect(service.getSkill('/etc/passwd')).toBeNull();
    expect(service.getSkill('..\\..\\config')).toBeNull();
    expect(service.getSkill('unknown-skill-xyz')).toBeNull();
  });

  it('performs deterministic keyword search', () => {
    const results = service.searchSkills('presentation slides');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.name).toBe('pptx');

    const spreadsheetResults = service.searchSkills('financial formulas spreadsheet');
    expect(spreadsheetResults.length).toBeGreaterThanOrEqual(1);
    expect(spreadsheetResults[0]?.name).toBe('xlsx');
  });

  it('handles reload cleanly', async () => {
    await service.reload();
    expect(service.listSkills().length).toBeGreaterThanOrEqual(7);
  });

  it('safely accesses skill resources and strictly prevents path traversal in getSkillResource', async () => {
    // Non-existent skill returns null
    expect(await service.getSkillResource('non-existent-skill', 'ref.md')).toBeNull();

    // Path traversal attempts return null
    expect(await service.getSkillResource('docx', '../../package.json')).toBeNull();
    expect(await service.getSkillResource('docx', '/etc/passwd')).toBeNull();
    expect(await service.getSkillResource('docx', '..\\..\\package.json')).toBeNull();
    expect(await service.getSkillResource('docx', 'sub/../../secret.txt')).toBeNull();

    // Valid skill with non-existent file returns null
    expect(await service.getSkillResource('docx', 'non-existent-resource.md')).toBeNull();
  });

  it('safely accesses binary skill resources via getSkillResourceBuffer without UTF-8 corruption', async () => {
    // Non-existent skill returns null
    expect(await service.getSkillResourceBuffer('non-existent-skill', 'template.dotx')).toBeNull();

    // Path traversal attempts return null
    expect(await service.getSkillResourceBuffer('docx', '../../package.json')).toBeNull();
    expect(await service.getSkillResourceBuffer('docx', '/etc/passwd')).toBeNull();
    expect(await service.getSkillResourceBuffer('docx', '..\\..\\package.json')).toBeNull();

    // Reading an existing skill file returns raw Buffer
    const buf = await service.getSkillResourceBuffer('docx', 'SKILL.md');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf!.length).toBeGreaterThan(0);
  });

  it('loads every bundled skill: none is dropped by its own frontmatter', async () => {
    const dirs = [];
    for (const d of await fs.readdir(path.resolve(__dirname, '../../skills'))) {
      if (await fs.stat(path.resolve(__dirname, '../../skills', d, 'SKILL.md')).then(() => true, () => false)) dirs.push(d);
    }
    expect(service.rejected).toEqual([]);
    expect(service.listSkills(undefined, true).map((s) => s.name).sort()).toEqual(dirs.sort());
  });
});

describe('SkillService frontmatter rules (Claude Agent Skills)', () => {
  async function loadWith(skills: Record<string, string>): Promise<SkillService> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-'));
    for (const [dir, frontmatter] of Object.entries(skills)) {
      await fs.mkdir(path.join(root, 'skills', dir), { recursive: true });
      await fs.writeFile(path.join(root, 'skills', dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\nBody`);
    }
    const svc = new SkillService(root, 'skills');
    await svc.load();
    return svc;
  }

  it('rejects names and descriptions Claude would reject, and says why', async () => {
    const svc = await loadWith({
      ok: 'name: ok\ndescription: Does a thing. Use when asked.',
      Upper: 'name: Upper\ndescription: d',
      [`a${'b'.repeat(64)}`]: `name: a${'b'.repeat(64)}\ndescription: d`,
      'my-claude-helper': 'name: my-claude-helper\ndescription: d',
      long: `name: long\ndescription: ${'x'.repeat(1025)}`,
      xml: 'name: xml\ndescription: "Use <b>this</b>"',
      mismatch: 'name: other\ndescription: d',
    });
    expect(svc.listSkills().map((s) => s.name)).toEqual(['ok']);
    const reasons = Object.fromEntries(svc.rejected.map((r) => [r.dir, r.reason]));
    expect(reasons.Upper).toContain('lowercase');
    expect(reasons[`a${'b'.repeat(64)}`]).toContain('name');
    expect(reasons['my-claude-helper']).toContain('claude');
    expect(reasons.long).toContain('description');
    expect(reasons.xml).toContain('XML');
    expect(reasons.mismatch).toContain('directory');
  });

  it('lists an internal skill only when asked, and returns autoload skills', async () => {
    const svc = await loadWith({
      helper: 'name: helper\ndescription: Internal helper. Use when running code.\ncategory: internal\nautoload: true',
      public: 'name: public\ndescription: A listed skill. Use when asked.',
    });
    expect(svc.listSkills().map((s) => s.name)).toEqual(['public']);
    expect(svc.listSkills(undefined, true).map((s) => s.name).sort()).toEqual(['helper', 'public']);
    expect(svc.getAutoloadSkills([]).map((s) => s.name)).toEqual(['helper']);
  });

  it('accepts the limits exactly', async () => {
    const name = 'n'.repeat(64);
    const svc = await loadWith({ [name]: `name: ${name}\ndescription: ${'x'.repeat(1024)}` });
    expect(svc.rejected).toEqual([]);
  });
});
