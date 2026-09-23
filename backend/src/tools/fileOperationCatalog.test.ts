import { describe, expect, it } from 'vitest';
import {
  getDeferredPolicyCatalog,
  getInitialCoreTools,
  TOOL_CATALOG_ENTRIES,
} from './catalog.js';
import { SearchToolsExecutor } from './searchToolsExecutor.js';

const mockConfig = {
  ENABLE_TOOL_USE: true,
  ENABLE_RUN_PYTHON: true,
  ENABLE_SKILLS: true,
  ENABLE_WEB: true,
  ENABLE_MEMORY: true,
  ENABLE_GENERATIVE_UI: true,
  ENABLE_IMAGE_GENERATION: true,
} as any;

const mockFlags = {
  runPythonEnabled: true,
  skillsEnabled: true,
  webEnabled: true,
  memoryEnabled: true,
  generativeUiEnabled: true,
  imageEnabled: true,
};

const mockContext = {
  userId: 'test-user',
  projectId: null,
  allowPython: false,
  allowDeliverable: true,
};

const fileOperationToolNames = [
  'inspectPdf',
  'mergePdfFiles',
  'splitPdfFile',
  'inspectSpreadsheet',
  'editSpreadsheetCells',
  'combineWorkbooks',
  'inspectDocxStructure',
  'editDocxContent',
  'appendDocxSection',
  'inspectPptxStructure',
  'reorderPptxSlides',
  'editPptxSlideText',
];

describe('File Operations Tool Catalog Registration', () => {
  it('registers all 12 file operation tools in TOOL_CATALOG_ENTRIES', () => {
    for (const toolName of fileOperationToolNames) {
      const entry = TOOL_CATALOG_ENTRIES.find((e) => e.name === toolName);
      expect(entry, `Entry for ${toolName} must exist in catalog`).toBeDefined();
      expect(entry?.category).toBe('files');
      expect(entry?.isInitialCore).toBe(false);
      expect(entry?.isFeatureEnabled(mockConfig, mockFlags)).toBe(true);
      expect(entry?.isAuthorized(mockContext)).toBe(true);
      expect(entry?.keywords.length).toBeGreaterThan(0);
    }
  });

  it('verifies getInitialCoreTools does NOT include any file operation tools', () => {
    const initialTools = getInitialCoreTools(mockConfig, mockFlags, mockContext);
    const initialNames = initialTools.map((t) => t.name);
    for (const toolName of fileOperationToolNames) {
      expect(initialNames).not.toContain(toolName);
    }
  });

  it('verifies getDeferredPolicyCatalog includes all 12 file operation tools', () => {
    const deferredTools = getDeferredPolicyCatalog(mockConfig, mockFlags, mockContext);
    const deferredNames = deferredTools.map((t) => t.name);
    for (const toolName of fileOperationToolNames) {
      expect(deferredNames).toContain(toolName);
    }
  });

  describe('Discovery via SearchToolsExecutor', () => {
    const catalog = getDeferredPolicyCatalog(mockConfig, mockFlags, mockContext);

    it('discovers PDF tools when querying "merge pdf"', async () => {
      const executor = new SearchToolsExecutor(catalog);
      const res = await executor.execute({
        id: 'call-1',
        name: 'search_tools',
        input: { query: 'merge pdf' },
      });
      expect(res.ok).toBe(true);
      const json = res.content.find((c) => c.type === 'json')?.data as any;
      const discoveredNames = json.tools.map((t: any) => t.name);
      expect(discoveredNames).toContain('mergePdfFiles');
    });

    it('discovers splitPdfFile when querying "split pdf into pages"', async () => {
      const executor = new SearchToolsExecutor(catalog);
      const res = await executor.execute({
        id: 'call-2',
        name: 'search_tools',
        input: { query: 'split pdf into pages' },
      });
      const json = res.content.find((c) => c.type === 'json')?.data as any;
      const discoveredNames = json.tools.map((t: any) => t.name);
      expect(discoveredNames).toContain('splitPdfFile');
    });

    it('discovers spreadsheet tools when querying "inspect spreadsheet"', async () => {
      const executor = new SearchToolsExecutor(catalog);
      const res = await executor.execute({
        id: 'call-3',
        name: 'search_tools',
        input: { query: 'inspect spreadsheet' },
      });
      const json = res.content.find((c) => c.type === 'json')?.data as any;
      const discoveredNames = json.tools.map((t: any) => t.name);
      expect(discoveredNames).toContain('inspectSpreadsheet');
    });

    it('discovers editSpreadsheetCells when querying "edit cells in excel"', async () => {
      const executor = new SearchToolsExecutor(catalog);
      const res = await executor.execute({
        id: 'call-4',
        name: 'search_tools',
        input: { query: 'edit cells in excel' },
      });
      const json = res.content.find((c) => c.type === 'json')?.data as any;
      const discoveredNames = json.tools.map((t: any) => t.name);
      expect(discoveredNames).toContain('editSpreadsheetCells');
    });

    it('discovers docx tools when querying "inspect docx word document"', async () => {
      const executor = new SearchToolsExecutor(catalog);
      const res = await executor.execute({
        id: 'call-5',
        name: 'search_tools',
        input: { query: 'inspect docx word document' },
      });
      const json = res.content.find((c) => c.type === 'json')?.data as any;
      const discoveredNames = json.tools.map((t: any) => t.name);
      expect(discoveredNames).toContain('inspectDocxStructure');
    });

    it('discovers pptx tools when querying "reorder presentation slides"', async () => {
      const executor = new SearchToolsExecutor(catalog);
      const res = await executor.execute({
        id: 'call-6',
        name: 'search_tools',
        input: { query: 'reorder presentation slides' },
      });
      const json = res.content.find((c) => c.type === 'json')?.data as any;
      const discoveredNames = json.tools.map((t: any) => t.name);
      expect(discoveredNames).toContain('reorderPptxSlides');
    });
  });
});
