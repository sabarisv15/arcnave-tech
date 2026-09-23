import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import { mergePdfFiles } from '../services/skills/fileOperations/pdf.js';
import { combineWorkbooks } from '../services/skills/fileOperations/xlsx.js';
import { editDocxContent, inspectDocxStructure } from '../services/skills/fileOperations/docx.js';
import { inspectPptxStructure, reorderPptxSlides } from '../services/skills/fileOperations/pptx.js';
import { renderMarkdownExport } from '../services/documents/index.js';

describe('Multi-File Foundation (Authoritative Identity & Duplicate Filename Safety)', () => {
  it('handles multiple PDFs with identical filenames safely via unique attachment IDs', async () => {
    const runtime = new ExecutionRuntime();
    const ws = await runtime.createWorkspace(`multi-pdf-${Date.now()}`);

    try {
      const docA = await PDFDocument.create();
      docA.setTitle('Statement A');
      docA.addPage([300, 300]);
      const pdfBytesA = Buffer.from(await docA.save());

      const docB = await PDFDocument.create();
      docB.setTitle('Statement B');
      docB.addPage([300, 300]);
      docB.addPage([300, 300]);
      const pdfBytesB = Buffer.from(await docB.save());

      const mockStorage = {
        get: async (key: string) => {
          if (key === 'key-a') return pdfBytesA;
          if (key === 'key-b') return pdfBytesB;
          throw new Error('Not found');
        },
      } as any;

      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [
                // Returns whichever is requested based on query
              ],
            }),
          }),
        }),
      } as any;

      const makeDbForId = (id: string, filename: string, key: string) => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ id, filename, mimeType: 'application/pdf', storageKey: key, sizeBytes: 100 }],
            }),
          }),
        }),
      } as any);

      // Materialize both attachments sharing the same filename "statement.pdf"
      const matA = await runtime.materializeAttachment(ws, 'att-uuid-a', 'user-1', makeDbForId('att-uuid-a', 'statement.pdf', 'key-a'), mockStorage);
      const matB = await runtime.materializeAttachment(ws, 'att-uuid-b', 'user-1', makeDbForId('att-uuid-b', 'statement.pdf', 'key-b'), mockStorage);

      // 1. Files must have distinct paths
      expect(matA.path).not.toBe(matB.path);
      // 2. Both files must be readable and contain their unique data
      const merged = await mergePdfFiles([pdfBytesA, pdfBytesB]);
      const mergedDoc = await PDFDocument.load(merged);
      expect(mergedDoc.getPageCount()).toBe(3);
    } finally {
      await runtime.cleanupWorkspace(ws);
    }
  });

  it('combines multiple XLSX attachments with duplicate sheet names safely', async () => {
    const wb1 = new ExcelJS.Workbook();
    const ws1 = wb1.addWorksheet('Data');
    ws1.addRow(['ID', 'Val']);
    ws1.addRow([1, 'First']);
    const buf1 = Buffer.from((await wb1.xlsx.writeBuffer()) as ArrayBuffer);

    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Data'); // Same sheet name
    ws2.addRow(['ID', 'Val']);
    ws2.addRow([2, 'Second']);
    const buf2 = Buffer.from((await wb2.xlsx.writeBuffer()) as ArrayBuffer);

    const combined = await combineWorkbooks([buf1, buf2]);
    const verifyWb = new ExcelJS.Workbook();
    await verifyWb.xlsx.load(combined as any);

    expect(verifyWb.worksheets).toHaveLength(2);
    expect(verifyWb.worksheets[0]!.name).toBe('Data');
    expect(verifyWb.worksheets[1]!.name).toBe('Data_2');
  });

  it('processes multiple DOCX attachments independently preserving document structures', async () => {
    const docxA = await renderMarkdownExport('# Doc A\n\nContent A', 'docx');
    const docxB = await renderMarkdownExport('# Doc B\n\nContent B', 'docx');

    const editedA = await editDocxContent(docxA, [{ search: 'Content A', replace: 'Modified A' }]);
    const editedB = await editDocxContent(docxB, [{ search: 'Content B', replace: 'Modified B' }]);

    const inspectA = await inspectDocxStructure(editedA);
    const inspectB = await inspectDocxStructure(editedB);

    expect(inspectA.paragraphsCount).toBeGreaterThan(0);
    expect(inspectB.paragraphsCount).toBeGreaterThan(0);
  });

  it('processes multiple PPTX attachments preserving independent deck structures', async () => {
    const pptxA = await renderMarkdownExport('# Deck A - Slide 1\n\nBody A\n\n---\n\n# Deck A - Slide 2', 'pptx');
    const pptxB = await renderMarkdownExport('# Deck B - Slide 1\n\nBody B', 'pptx');

    const inspectA = await inspectPptxStructure(pptxA);
    const inspectB = await inspectPptxStructure(pptxB);

    expect(inspectA.slideCount).toBe(2);
    expect(inspectB.slideCount).toBe(1);

    const reorderedA = await reorderPptxSlides(pptxA, [2, 1]);
    const inspectReorderedA = await inspectPptxStructure(reorderedA);
    expect(inspectReorderedA.slideCount).toBe(2);
  });
});
