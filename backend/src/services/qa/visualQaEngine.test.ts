import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { overallQaStatus, visualQaEngine } from './visualQaEngine.js';

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

describe('visual QA layers stay separate (G14)', () => {
  async function pdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]).drawText('Hello');
    return Buffer.from(await doc.save());
  }
  const vision = (reply: string | Error) => ({
    name: 'v',
    supportsGrounding: () => false,
    supportsCodeExecution: () => false,
    stream: async function* () {},
    probe: async () => undefined,
    describeMedia: async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });

  it('a valid PNG with no vision provider is not_checked, never passed', async () => {
    const r = await visualQaEngine.evaluateVisualQa({ buffer: await pdf(), format: 'pdf' });
    expect(r.previewAvailable).toBe(true);
    expect(r.status).toBe('not_checked');
    expect(r.passed).toBe(false);
  });

  it('a vision call that fails or answers without structure is not_checked', async () => {
    for (const reply of [new Error('quota'), 'looks fine to me']) {
      const r = await visualQaEngine.evaluateVisualQa({ buffer: await pdf(), format: 'pdf', visionProvider: vision(reply) as any });
      expect(r.status).toBe('not_checked');
    }
  });

  it('an actual vision verdict is passed or failed', async () => {
    const ok = await visualQaEngine.evaluateVisualQa({
      buffer: await pdf(),
      format: 'pdf',
      visionProvider: vision('{"passed":true,"defects":[]}') as any,
    });
    expect(ok.status).toBe('passed');
    const bad = await visualQaEngine.evaluateVisualQa({
      buffer: await pdf(),
      format: 'pdf',
      visionProvider: vision(
        '{"passed":false,"defects":[{"type":"text_clipping","location":"p1","severity":"high","description":"cut","repairable":true}]}',
      ) as any,
    });
    expect(bad.status).toBe('failed');
  });

  it('overall: required + not_checked is unverified; structure is never changed by visual', () => {
    const base = { structuralPassed: true, semanticPassed: true };
    expect(overallQaStatus({ ...base, visual: 'not_checked', visualRequired: true })).toBe('unverified');
    expect(overallQaStatus({ ...base, visual: 'not_checked', visualRequired: false })).toBe('verified');
    expect(overallQaStatus({ ...base, visual: 'passed', visualRequired: true })).toBe('verified');
    expect(overallQaStatus({ ...base, visual: 'failed', visualRequired: false })).toBe('failed');
    expect(overallQaStatus({ ...base, structuralPassed: false, visual: 'passed', visualRequired: true })).toBe('failed');
    expect(overallQaStatus({ ...base, semanticPassed: false, visual: 'passed', visualRequired: true })).toBe('passed_with_warnings');
  });
});
