import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { visualQaEngine } from './visualQaEngine.js';

describe('VisualQaEngine (Batch 5 Real Visual QA)', () => {
  it('rasterizes PDF pages directly via Node-native pdf-parse without CLI dependencies', async () => {
    // Generate a minimal valid PDF with 2 pages
    const doc = await PDFDocument.create();
    const page1 = doc.addPage([300, 400]);
    page1.drawText('Page 1 content for visual QA');
    const page2 = doc.addPage([300, 400]);
    page2.drawText('Page 2 content for visual QA');
    const pdfBuf = Buffer.from(await doc.save());

    const result = await visualQaEngine.evaluateVisualQa({
      buffer: pdfBuf,
      format: 'pdf',
    });

    expect(result.inspectedPages).toBe(2);
    expect(result.previewAvailable).toBe(true);
    expect(Array.isArray(result.defects)).toBe(true);
  });

  it('gracefully handles missing Office renderer on host with previewAvailable: false', async () => {
    // Provide a dummy DOCX-like buffer (or minimal buffer) to evaluateVisualQa
    const dummyBuffer = Buffer.from('mock office content');

    const result = await visualQaEngine.evaluateVisualQa({
      buffer: dummyBuffer,
      format: 'docx',
    });

    expect(result.previewAvailable).toBe(false);
    expect(result.diagnostics).toBeDefined();
    expect(
      result.diagnostics.some((d) => d.includes('QA RENDERER FAILURE') || d.includes('unavailable')),
    ).toBe(true);
  });
});
