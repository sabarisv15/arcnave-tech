import { describe, expect, it } from 'vitest';
import { SourceProfileSchema } from './sourceProfile.js';

describe('SourceProfile (Format-Neutral)', () => {
  it('validates a PDF source profile without spreadsheet fields', () => {
    const pdfProfile = {
      attachmentIds: ['att-pdf-1'],
      sourceType: 'pdf',
      mimeTypes: ['application/pdf'],
      unitsProcessed: {
        pages: 12,
        tables: 2,
      },
      structure: {
        pageLabels: ['1', '2', '3'],
        hasTextLayer: true,
      },
      warnings: [
        {
          severity: 'warning' as const,
          type: 'unreadable_region',
          message: 'Footer on page 5 was blurred',
        },
      ],
      metrics: {
        extractDurationMs: 340,
      },
    };

    const res = SourceProfileSchema.safeParse(pdfProfile);
    expect(res.success).toBe(true);
  });

  it('validates a DOCX source profile with sections and paragraphs in structure', () => {
    const docxProfile = {
      attachmentIds: ['att-docx-1'],
      sourceType: 'docx',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      unitsProcessed: {
        sections: 4,
        tables: 1,
      },
      structure: {
        headings: ['Executive Summary', 'Q2 Financials', 'Appendix'],
      },
    };

    const res = SourceProfileSchema.safeParse(docxProfile);
    expect(res.success).toBe(true);
  });

  it('validates a PPTX source profile with slide counts', () => {
    const pptxProfile = {
      attachmentIds: ['att-pptx-1'],
      sourceType: 'pptx',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      unitsProcessed: {
        slides: 15,
      },
      structure: {
        layouts: ['Title', 'Two Content', 'Comparison'],
      },
    };

    const res = SourceProfileSchema.safeParse(pptxProfile);
    expect(res.success).toBe(true);
  });

  it('validates an XLSX source profile with optional domain metadata', () => {
    const xlsxProfile = {
      attachmentIds: ['att-xlsx-1'],
      sourceType: 'xlsx',
      mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      unitsProcessed: {
        sheets: 2,
        rows: 250,
      },
      domainMetadata: {
        headers: ['Date', 'Description', 'Amount'],
        totals: { Amount: 45000 },
      },
    };

    const res = SourceProfileSchema.safeParse(xlsxProfile);
    expect(res.success).toBe(true);
  });
});
