import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { DeliverableValidator } from './deliverableValidator.js';

describe('DeliverableValidator — 3-Level QA', () => {
  const validator = new DeliverableValidator();

  it('Level 1 Structural QA validates genuine OOXML packages and rejects corrupt stubs', async () => {
    // 1. Valid XLSX OOXML package
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types></Types>');
    zip.file('xl/workbook.xml', '<workbook></workbook>');
    // Pad to realistic size > 200 bytes
    zip.file('dummy.txt', 'a'.repeat(250));
    const validXlsx = await zip.generateAsync({ type: 'nodebuffer' });

    const reportValid = await validator.validate(
      validXlsx,
      'xlsx',
      '# Sheet\n| Col1 | Col2 |\n|---|---|\n| A | B |',
    );
    expect(reportValid.level1Structural.passed).toBe(true);

    // 2. Corrupt buffer (missing [Content_Types].xml)
    const corruptZip = new JSZip();
    corruptZip.file('xl/workbook.xml', '<workbook></workbook>');
    corruptZip.file('dummy.txt', 'a'.repeat(250));
    const corruptBuffer = await corruptZip.generateAsync({ type: 'nodebuffer' });

    const reportCorrupt = await validator.validate(
      corruptBuffer,
      'xlsx',
      '# Sheet\n| Col1 | Col2 |\n|---|---|\n| A | B |',
    );
    expect(reportCorrupt.level1Structural.passed).toBe(false);
    expect(reportCorrupt.level1Structural.details).toContain('Content_Types');

    // 3. Valid PDF magic bytes
    const pdfBuffer = Buffer.from('%PDF-1.7\n' + 'a'.repeat(250));
    const reportPdf = await validator.validate(pdfBuffer, 'pdf', '# PDF Title\n\nContent');
    expect(reportPdf.level1Structural.passed).toBe(true);
  });

  it('Level 2 Semantic QA detects data truncation and rejects raw binary leaks', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types></Types>');
    zip.file('xl/workbook.xml', '<workbook></workbook>');
    zip.file('dummy.txt', 'a'.repeat(250));
    const validBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // 1. Binary leak rejection (Mode B signature: raw %PDF- in markdown)
    const binaryLeakContent = '%PDF-1.4\n4 0 obj\n<< /Type /Catalog >>\n| A | B |';
    const reportLeak = await validator.validate(validBuffer, 'xlsx', binaryLeakContent);
    expect(reportLeak.level2Semantic.passed).toBe(false);
    expect(reportLeak.level2Semantic.details).toContain('Binary leak detected');

    // 2. Expected rows truncation check
    const shortTable = '| Header1 | Header2 |\n|---|---|\n| Row1 | Val1 |';
    const reportTruncated = await validator.validate(validBuffer, 'xlsx', shortTable, {
      expectedMinRows: 10,
    });
    expect(reportTruncated.level2Semantic.passed).toBe(false);
    expect(reportTruncated.level2Semantic.details).toContain('Data truncation detected');

    // 3. Header preservation check
    const reportMissingHeader = await validator.validate(validBuffer, 'xlsx', shortTable, {
      expectedHeaders: ['Account Number', 'Balance'],
    });
    expect(reportMissingHeader.level2Semantic.passed).toBe(false);
    expect(reportMissingHeader.level2Semantic.details).toContain('Missing expected column headers');
  });

  it('Level 3 Visual QA detects formula errors (#REF!, #VALUE!) and excessive slide text', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types></Types>');
    zip.file('xl/workbook.xml', '<workbook></workbook>');
    zip.file('dummy.txt', 'a'.repeat(250));
    const validBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // 1. Formula error in cells
    const formulaErrContent = '| Month | Revenue | Growth |\n|---|---|---|\n| Jan | 100 | #REF! |';
    const reportFormulaErr = await validator.validate(validBuffer, 'xlsx', formulaErrContent);
    expect(reportFormulaErr.level3Visual.passed).toBe(false);
    expect(reportFormulaErr.level3Visual.details).toContain('Formula syntax error');

    // 2. Overfilled slide clipping 16:9 canvas
    const pptxZip = new JSZip();
    pptxZip.file('[Content_Types].xml', '<Types></Types>');
    pptxZip.file('ppt/presentation.xml', '<presentation></presentation>');
    pptxZip.file('dummy.txt', 'a'.repeat(250));
    const validPptx = await pptxZip.generateAsync({ type: 'nodebuffer' });

    const overfilledSlide = '# Slide 1\n' + 'Line of text\n'.repeat(30);
    const reportOverfilled = await validator.validate(validPptx, 'pptx', overfilledSlide);
    expect(reportOverfilled.level3Visual.passed).toBe(false);
    expect(reportOverfilled.level3Visual.details).toContain('16:9 vertical canvas height');
  });
});
