import { PDFDocument } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { renderMarkdownExport } from '../../documents/index.js';
import { inspectPdf, mergePdfFiles, splitPdfFile } from './pdf.js';
import { combineWorkbooks, editSpreadsheetCells, inspectSpreadsheet } from './xlsx.js';
import { appendDocxSection, editDocxContent, inspectDocxStructure } from './docx.js';
import { editPptxSlideText, inspectPptxStructure, reorderPptxSlides } from './pptx.js';

describe('Skill-Owned Format Operations (PDF, XLSX, DOCX, PPTX)', () => {
  describe('PDF Operations', () => {
    it('inspects, merges, and splits PDFs preserving vector/text structure', async () => {
      // Create two 1-page PDFs using pdf-lib
      const doc1 = await PDFDocument.create();
      doc1.setTitle('Doc 1');
      doc1.addPage([400, 600]);
      const pdf1Buf = Buffer.from(await doc1.save());

      const doc2 = await PDFDocument.create();
      doc2.setTitle('Doc 2');
      doc2.addPage([400, 600]);
      doc2.addPage([400, 600]);
      const pdf2Buf = Buffer.from(await doc2.save());

      // Inspect
      const inspect1 = await inspectPdf(pdf1Buf);
      expect(inspect1.pageCount).toBe(1);
      expect(inspect1.title).toBe('Doc 1');

      // Merge
      const mergedBuf = await mergePdfFiles([pdf1Buf, pdf2Buf]);
      const inspectMerged = await inspectPdf(mergedBuf);
      expect(inspectMerged.pageCount).toBe(3);

      // Split
      const splits = await splitPdfFile(mergedBuf, [
        [1, 1],
        [2, 3],
      ]);
      expect(splits).toHaveLength(2);
      expect((await inspectPdf(splits[0]!)).pageCount).toBe(1);
      expect((await inspectPdf(splits[1]!)).pageCount).toBe(2);
    });
  });

  describe('XLSX Operations', () => {
    it('inspects, edits cells, and combines workbooks preserving native structure', async () => {
      const wb1 = new ExcelJS.Workbook();
      const ws1 = wb1.addWorksheet('Sales');
      ws1.addRow(['Quarter', 'Revenue']);
      ws1.addRow(['Q1', 10000]);
      const buf1 = Buffer.from((await wb1.xlsx.writeBuffer()) as ArrayBuffer);

      const wb2 = new ExcelJS.Workbook();
      const ws2 = wb2.addWorksheet('Expenses');
      ws2.addRow(['Quarter', 'Cost']);
      ws2.addRow(['Q1', 4000]);
      const buf2 = Buffer.from((await wb2.xlsx.writeBuffer()) as ArrayBuffer);

      // Inspect
      const inspectRes = await inspectSpreadsheet(buf1);
      expect(inspectRes.sheetNames).toEqual(['Sales']);
      expect(inspectRes.totalRows).toBe(2);

      // Edit cells
      const editedBuf = await editSpreadsheetCells(buf1, [
        { sheet: 'Sales', cell: 'B2', value: 15000, type: 'number', format: '$#,##0' },
        { sheet: 'Sales', cell: 'B3', value: '=B2*2', type: 'formula' },
      ]);

      const verifyWb = new ExcelJS.Workbook();
      await verifyWb.xlsx.load(editedBuf as any);
      const verifyWs = verifyWb.getWorksheet('Sales')!;
      expect(verifyWs.getCell('B2').value).toBe(15000);
      expect(verifyWs.getCell('B2').numFmt).toBe('$#,##0');
      expect(verifyWs.getCell('B3').value).toHaveProperty('formula', 'B2*2');

      // Combine
      const combinedBuf = await combineWorkbooks([buf1, buf2]);
      const combinedWb = new ExcelJS.Workbook();
      await combinedWb.xlsx.load(combinedBuf as any);
      expect(combinedWb.worksheets.map((s) => s.name)).toEqual(['Sales', 'Expenses']);
    });
  });

  describe('DOCX Operations', () => {
    it('inspects structure, edits text runs, and appends sections preserving package', async () => {
      const markdown = '# Project Plan\n\nInitial draft for review.\n\n| Task | Owner |\n| --- | --- |\n| Research | Alice |';
      const initialDocx = await renderMarkdownExport(markdown, 'docx');

      // Inspect
      const inspectRes = await inspectDocxStructure(initialDocx);
      expect(inspectRes.paragraphsCount).toBeGreaterThan(1);
      expect(inspectRes.tablesCount).toBe(1);

      // Edit text
      const editedDocx = await editDocxContent(initialDocx, [
        { search: 'Initial draft', replace: 'Approved release' },
      ]);
      const inspectEdited = await inspectDocxStructure(editedDocx);
      expect(inspectEdited.paragraphsCount).toBe(inspectRes.paragraphsCount);

      // Append section
      const appendedDocx = await appendDocxSection(editedDocx, 'Next Steps', [
        'Finalize security audit',
        'Deploy to staging',
      ]);
      const inspectAppended = await inspectDocxStructure(appendedDocx);
      expect(inspectAppended.paragraphsCount).toBeGreaterThan(inspectRes.paragraphsCount);
    });
  });

  describe('PPTX Operations', () => {
    it('inspects deck, reorders slides, and edits slide text preserving deck integrity', async () => {
      const markdown = '# Slide One\n\n- Bullet 1A\n- Bullet 1B\n\n---\n\n# Slide Two\n\n- Bullet 2A\n- Bullet 2B';
      const initialPptx = await renderMarkdownExport(markdown, 'pptx');

      // Inspect
      const inspectRes = await inspectPptxStructure(initialPptx);
      expect(inspectRes.slideCount).toBe(2);
      expect(inspectRes.titles.some((t) => t.includes('Slide One'))).toBe(true);

      // Reorder slides (Slide 2 becomes first, Slide 1 becomes second)
      const reorderedPptx = await reorderPptxSlides(initialPptx, [2, 1]);
      const inspectReordered = await inspectPptxStructure(reorderedPptx);
      expect(inspectReordered.slideCount).toBe(2);

      // Edit slide text
      const editedPptx = await editPptxSlideText(reorderedPptx, 1, [
        { search: 'Slide Two', replace: 'Updated Slide Two' },
      ]);
      const inspectFinal = await inspectPptxStructure(editedPptx);
      expect(inspectFinal.slideCount).toBe(2);
    });
  });
});
