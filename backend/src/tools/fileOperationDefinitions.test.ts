import { describe, expect, it } from 'vitest';
import {
  APPEND_DOCX_SECTION,
  COMBINE_WORKBOOKS,
  EDIT_DOCX_CONTENT,
  EDIT_PPTX_SLIDE_TEXT,
  EDIT_SPREADSHEET_CELLS,
  FILE_OPERATION_TOOL_DEFINITIONS,
  INSPECT_DOCX_STRUCTURE,
  INSPECT_PDF,
  INSPECT_PPTX_STRUCTURE,
  INSPECT_SPREADSHEET,
  MERGE_PDF_FILES,
  REORDER_PPTX_SLIDES,
  SPLIT_PDF_FILE,
} from './definitions.js';

describe('File Operation Tool Definitions', () => {
  it('exports exactly 12 file operation tool definitions', () => {
    expect(FILE_OPERATION_TOOL_DEFINITIONS).toHaveLength(12);
    const names = FILE_OPERATION_TOOL_DEFINITIONS.map((d) => d.name);
    expect(names).toEqual([
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
    ]);
  });

  it('validates each definition has non-empty description and valid JSON schema', () => {
    for (const def of FILE_OPERATION_TOOL_DEFINITIONS) {
      const schema = def.inputSchema as any;
      expect(def.name).toBeTruthy();
      expect(def.description.length).toBeGreaterThan(20);
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
      expect(Array.isArray(schema.required)).toBe(true);
      expect(schema.required.length).toBeGreaterThan(0);
      expect(schema.additionalProperties).toBe(false);
    }
  });

  describe('PDF definitions', () => {
    it('INSPECT_PDF schema requires fileId', () => {
      const schema = INSPECT_PDF.inputSchema as any;
      expect(schema.required).toEqual(['fileId']);
      expect(schema.properties.fileId.type).toBe('string');
    });

    it('MERGE_PDF_FILES schema requires fileIds array with minimum 2 items', () => {
      const schema = MERGE_PDF_FILES.inputSchema as any;
      expect(schema.required).toEqual(['fileIds']);
      expect(schema.properties.fileIds.type).toBe('array');
      expect(schema.properties.fileIds.minItems).toBe(2);
    });

    it('SPLIT_PDF_FILE schema requires fileId and pageRanges array', () => {
      const schema = SPLIT_PDF_FILE.inputSchema as any;
      expect(schema.required).toEqual(['fileId', 'pageRanges']);
      expect(schema.properties.pageRanges.type).toBe('array');
      expect(schema.properties.pageRanges.minItems).toBe(1);
    });
  });

  describe('XLSX definitions', () => {
    it('INSPECT_SPREADSHEET schema requires fileId', () => {
      const schema = INSPECT_SPREADSHEET.inputSchema as any;
      expect(schema.required).toEqual(['fileId']);
    });

    it('EDIT_SPREADSHEET_CELLS schema requires fileId and edits array', () => {
      const schema = EDIT_SPREADSHEET_CELLS.inputSchema as any;
      expect(schema.required).toEqual(['fileId', 'edits']);
      const editProps = schema.properties.edits.items.properties;
      expect(editProps.sheet).toBeDefined();
      expect(editProps.cell).toBeDefined();
      expect(editProps.value).toBeDefined();
    });

    it('COMBINE_WORKBOOKS schema requires fileIds with minItems 2', () => {
      const schema = COMBINE_WORKBOOKS.inputSchema as any;
      expect(schema.required).toEqual(['fileIds']);
      expect(schema.properties.fileIds.minItems).toBe(2);
    });
  });

  describe('DOCX definitions', () => {
    it('INSPECT_DOCX_STRUCTURE schema requires fileId', () => {
      expect(INSPECT_DOCX_STRUCTURE.inputSchema.required).toEqual(['fileId']);
    });

    it('EDIT_DOCX_CONTENT schema requires fileId and replacements', () => {
      expect(EDIT_DOCX_CONTENT.inputSchema.required).toEqual(['fileId', 'replacements']);
    });

    it('APPEND_DOCX_SECTION schema requires fileId, heading, and paragraphs', () => {
      expect(APPEND_DOCX_SECTION.inputSchema.required).toEqual(['fileId', 'heading', 'paragraphs']);
    });
  });

  describe('PPTX definitions', () => {
    it('INSPECT_PPTX_STRUCTURE schema requires fileId', () => {
      expect(INSPECT_PPTX_STRUCTURE.inputSchema.required).toEqual(['fileId']);
    });

    it('REORDER_PPTX_SLIDES schema requires fileId and newOrder', () => {
      expect(REORDER_PPTX_SLIDES.inputSchema.required).toEqual(['fileId', 'newOrder']);
    });

    it('EDIT_PPTX_SLIDE_TEXT schema requires fileId, slideIndex, and replacements', () => {
      expect(EDIT_PPTX_SLIDE_TEXT.inputSchema.required).toEqual(['fileId', 'slideIndex', 'replacements']);
    });
  });
});
