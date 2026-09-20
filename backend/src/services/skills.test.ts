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
    expect(names).toContain('data-analysis');
    expect(names).toContain('research-deep-dive');
    expect(names).toContain('skill-creator');

    // Internal skill should NOT be in regular list
    expect(names).not.toContain('python-sandbox-patterns');
  });

  it('includes internal skills when requested', () => {
    const all = service.listSkills(undefined, true);
    const names = all.map((s) => s.name);
    expect(names).toContain('python-sandbox-patterns');
  });

  it('evaluates capability dependencies honestly (guidance_only vs full)', () => {
    // 1. Without artifact.pptx -> mode should be guidance_only and missing artifact.pptx
    const withoutTool = service.getSkill('pptx', []);
    expect(withoutTool).not.toBeNull();
    expect(withoutTool?.mode).toBe('guidance_only');
    expect(withoutTool?.missingCapabilities).toEqual(['artifact.pptx']);

    // 2. With artifact.pptx -> mode should be full
    const withTool = service.getSkill('pptx', ['artifact.pptx']);
    expect(withTool).not.toBeNull();
    expect(withTool?.mode).toBe('full');
    expect(withTool?.missingCapabilities).toEqual([]);
  });

  it('evaluates run_python dependency for data-analysis', () => {
    const withoutPython = service.getSkill('data-analysis', []);
    expect(withoutPython?.mode).toBe('guidance_only');
    expect(withoutPython?.missingCapabilities).toContain('run_python');

    const withPython = service.getSkill('data-analysis', ['run_python']);
    expect(withPython?.mode).toBe('full');
    expect(withPython?.missingCapabilities).toHaveLength(0);
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

  it('returns autoload skills', () => {
    const autoloads = service.getAutoloadSkills(['run_python']);
    const names = autoloads.map((s) => s.name);
    expect(names).toContain('python-sandbox-patterns');
  });

  it('handles reload cleanly', async () => {
    await service.reload();
    expect(service.listSkills().length).toBeGreaterThanOrEqual(7);
  });
});
