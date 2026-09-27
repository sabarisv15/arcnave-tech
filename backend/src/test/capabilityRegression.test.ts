/**
 * Capability Regression & Verification Suite (Phase 8).
 *
 * Tests the 15-tool surface, strict capability status, table fidelity in document specs,
 * attachment manifests, and system prompt truthfulness.
 */
import { describe, expect, it } from 'vitest';

import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { InMemoryCapabilityRegistry } from '../capabilities/registry.js';
import { loadConfig } from '../config.js';
import { markdownToDocumentSpec, markdownToSpreadsheetSpec } from '../services/documents.js';
import { buildBaseSystemPrompt } from '../services/systemPrompt.js';
import { ProjectToolRegistry } from '../tools/registry.js';

describe('Capability Regression Suite', () => {
  describe('1. Tool surface & truthful registry', () => {
    it('exposes every tool its gates allow', () => {
      const reg = new ProjectToolRegistry(true, true, true, true, false);
      const tools = reg.getAvailableTools({
        projectId: 'p1',
        allowPython: true,
      });
      expect(tools.length).toBe(12);
      const names = tools.map((t: { name: string }) => t.name);

      // Core CRUD
      expect(names).toContain('create_artifact');
      expect(names).toContain('read_artifact');
      expect(names).toContain('update_artifact');

      // Interactive options (ADR-0034)
      expect(names).toContain('ask_user_options');

      // Information access
      expect(names).toContain('web_search');
      expect(names).toContain('web_fetch');
      expect(names).toContain('search_project_files');
      expect(names).toContain('read_project_file');

      // Computation (general-chat decoupled)
      expect(names).toContain('run_python');

      // Skills
      expect(names).toContain('list_skills');
      expect(names).toContain('search_skills');
      expect(names).toContain('read_skill');
    });

    it('decouples run_python from project requirement while requiring per-turn authorization', () => {
      const reg = new ProjectToolRegistry(true, true, false, false, false);
      expect(reg.getAvailableTools({ projectId: null }).map((t) => t.name)).not.toContain(
        'run_python',
      );
      const toolsWithoutProject = reg.getAvailableTools({ projectId: null, allowPython: true });
      expect(toolsWithoutProject.map((t: { name: string }) => t.name)).toContain('run_python');
    });
  });

  describe('2. Capability Status Strictness', () => {
    it('ensures partial capabilities do NOT satisfy isFull', () => {
      const capRegistry = new InMemoryCapabilityRegistry([
        { id: 'artifact.create', status: 'full' },
        { id: 'artifact.export.pptx', status: 'partial', limitation: 'Basic slides only' },
      ]);

      expect(capRegistry.isFull('artifact.create')).toBe(true);
      expect(capRegistry.isAvailable('artifact.create')).toBe(true);

      expect(capRegistry.isFull('artifact.export.pptx')).toBe(false);
      expect(capRegistry.isAvailable('artifact.export.pptx')).toBe(true);
    });
  });

  describe('3. Document & Form Tabular Fidelity', () => {
    it('preserves multi-row, multi-column tables in document specs (no table loss)', () => {
      const markdown = `
# Application Form
Please fill the details below.

| Field | Details | Status |
| :--- | :--- | :---: |
| Candidate Name | Alex Morgan | Verified |
| Position Applied | Postman / GDS | Pending |
| Marks Percentage | 94.2% | Verified |

### Declarations
1. I hereby declare that all statements are true.
2. I have not been debarred by any authority.
`;
      const spec = markdownToDocumentSpec(markdown);
      expect(spec.title).toBe('Application Form');

      const tableBlock = spec.blocks.find((b) => b.type === 'table');
      expect(tableBlock).toBeDefined();
      if (tableBlock && tableBlock.type === 'table') {
        expect(tableBlock.header).toEqual(['Field', 'Details', 'Status']);
        expect(tableBlock.rows.length).toBe(3);
        expect(tableBlock.rows[0]).toEqual(['Candidate Name', 'Alex Morgan', 'Verified']);
        expect(tableBlock.rows[2]).toEqual(['Marks Percentage', '94.2%', 'Verified']);
      }
    });

    it('preserves tables for spreadsheet extraction', () => {
      const markdown = `
# Summary Data
| Metric | Q1 | Q2 |
| --- | --- | --- |
| Revenue | 100k | 120k |
`;
      const sheetSpec = markdownToSpreadsheetSpec(markdown);
      expect(sheetSpec.sheets.length).toBe(1);
      expect(sheetSpec.sheets[0]!.header).toEqual(['Metric', 'Q1', 'Q2']);
      expect(sheetSpec.sheets[0]!.rows).toEqual([['Revenue', '100k', '120k']]);
    });
  });

  describe('4. Truthful Base System Prompt', () => {
    it('only advertises tools and capabilities configured as available', () => {
      const cfg = loadConfig({
        ENABLE_TOOL_USE: 'true',
        ENABLE_RUN_PYTHON: 'true',
        ENABLE_WEB: 'false',
        ENABLE_SKILLS: 'true',
      });

      const caps = buildCapabilityRegistry(cfg);
      const prompt = buildBaseSystemPrompt(cfg, caps);

      expect(prompt).toContain('ArcNave');
      expect(prompt).toContain('create_artifact');
      expect(prompt).toContain('run_python');
      expect(prompt).toContain('list_skills');
      // Web tool is disabled
      expect(prompt).not.toContain('web_search');
    });
  });

  describe('5. Real-World GDS Application Benchmark', () => {
    it('preserves all sections, subject rows, 11 declarations, and 28 preferences in document spec', () => {
      // Benchmark structure representing the real GDS PDF application form
      const gdsMarkdown = `
# Gramin Dak Sevaks (GDS) Online Engagement - Application Form

## 1. Candidate Personal Details
- Name: S. Ramalingam
- Registration Number: GDS2026TN09871
- Community: OBC

## 2. 10th Standard Marks & Subject Details
| Sl No | Subject Code | Subject Name | Maximum Marks | Marks Obtained | Grade Points |
| :---: | :---: | :--- | :---: | :---: | :---: |
| 1 | 001 | Tamil | 100 | 95 | 9.5 |
| 2 | 002 | English | 100 | 91 | 9.1 |
| 3 | 003 | Mathematics | 100 | 98 | 9.8 |
| 4 | 004 | Science | 100 | 94 | 9.4 |
| 5 | 005 | Social Science | 100 | 96 | 9.6 |
| 6 | 006 | Optional Language | 100 | 90 | 9.0 |

## 3. Applicant Declarations
1. I hereby declare that I am able to ride a bicycle.
2. I declare that I have basic computer knowledge.
3. I declare that I have adequate independent source of livelihood.
4. I understand that furnishing false certificates will entail disqualification.
5. I declare that I have studied the local language up to 10th standard.
6. I declare that no criminal proceedings are pending against me.
7. I agree to abide by all Department of Posts terms and conditions.
8. I understand that selection is purely merit-based on 10th class marks.
9. I declare that I have verified all entered subject marks.
10. I declare that the uploaded photograph and signature are genuine.
11. I confirm that all submitted contact details are active and valid.

## 4. Post Preferences
${Array.from({ length: 28 }, (_, i) => `${i + 1}. Division: Chennai South, Post: BPM / ABPM Preference #${i + 1}`).join('\n')}
`;

      const spec = markdownToDocumentSpec(gdsMarkdown);
      expect(spec.title).toBe('Gramin Dak Sevaks (GDS) Online Engagement - Application Form');

      // Assert table has all 6 subjects preserved
      const tableBlock = spec.blocks.find((b) => b.type === 'table');
      expect(tableBlock).toBeDefined();
      if (tableBlock && tableBlock.type === 'table') {
        expect(tableBlock.rows.length).toBe(6);
        expect(tableBlock.rows.map((r: string[]) => r[2])).toEqual([
          'Tamil',
          'English',
          'Mathematics',
          'Science',
          'Social Science',
          'Optional Language',
        ]);
      }

      // Assert declarations & preferences are preserved in blocks
      const bullets = spec.blocks
        .filter((b) => b.type === 'bullet' || b.type === 'paragraph')
        .map((b) => ('text' in b ? b.text : ''))
        .join('\n');

      for (let i = 1; i <= 11; i++) {
        expect(bullets).toContain(`${i}. `);
      }
      for (let p = 1; p <= 28; p++) {
        expect(bullets).toContain(`Preference #${p}`);
      }
    });
  });
});
