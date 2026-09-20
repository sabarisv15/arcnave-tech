/**
 * Markdown -> spec parsing for the three export formats.
 *
 * Pure functions, tested without touching the renderer libraries — those are exercised for
 * real (round-tripped through actual binary generation and extraction) in
 * `projects.integration.test.ts` and `artifacts.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  MarkdownConversionUnsupported,
  markdownToDocumentSpec,
  markdownToSlidesSpec,
  markdownToSpreadsheetSpec,
} from './documents.js';

describe('markdownToSpreadsheetSpec', () => {
  it('parses a GFM table into a sheet named after the preceding heading', () => {
    const spec = markdownToSpreadsheetSpec(
      '# Headcount\n\n| Team | Hires |\n| --- | --- |\n| Platform | 3 |\n| Growth | 1 |\n',
    );
    expect(spec.sheets).toEqual([
      { name: 'Headcount', header: ['Team', 'Hires'], rows: [['Platform', '3'], ['Growth', '1']] },
    ]);
  });

  it('gives each table its own sheet and de-duplicates repeated headings', () => {
    const spec = markdownToSpreadsheetSpec(
      '# Q1\n\n| A |\n| --- |\n| 1 |\n\n# Q1\n\n| A |\n| --- |\n| 2 |\n',
    );
    expect(spec.sheets.map((s) => s.name)).toEqual(['Q1', 'Q1 (2)']);
  });

  it('falls back to a numbered name when no heading precedes the table', () => {
    const spec = markdownToSpreadsheetSpec('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    expect(spec.sheets[0]!.name).toBe('Sheet 1');
  });

  it('rejects markdown with no table, rather than emitting an empty workbook', () => {
    expect(() => markdownToSpreadsheetSpec('just some prose')).toThrow(
      MarkdownConversionUnsupported,
    );
  });
});

describe('markdownToDocumentSpec', () => {
  it('turns headings, paragraphs, and bullets into ordered blocks', () => {
    const spec = markdownToDocumentSpec(
      '# Plan\n\nFirst paragraph.\n\n## Details\n\n- one\n- two\n',
    );
    expect(spec.title).toBe('Plan');
    expect(spec.blocks).toEqual([
      { type: 'heading', level: 1, text: 'Plan' },
      { type: 'paragraph', text: 'First paragraph.' },
      { type: 'heading', level: 2, text: 'Details' },
      { type: 'bullet', text: 'one', level: 0 },
      { type: 'bullet', text: 'two', level: 0 },
    ]);
  });

  it('joins wrapped lines of the same paragraph rather than splitting on every newline', () => {
    const spec = markdownToDocumentSpec('one line\nanother line\n');
    expect(spec.blocks).toEqual([{ type: 'paragraph', text: 'one line another line' }]);
  });

  it('preserves tables as structured table blocks in document specs', () => {
    const spec = markdownToDocumentSpec(
      '# Application\n\nApplicant details:\n\n| Field | Value |\n| --- | --- |\n| Name | Alice |\n| Role | Engineer |\n\nThank you.',
    );
    expect(spec.blocks).toEqual([
      { type: 'heading', level: 1, text: 'Application' },
      { type: 'paragraph', text: 'Applicant details:' },
      {
        type: 'table',
        header: ['Field', 'Value'],
        rows: [
          ['Name', 'Alice'],
          ['Role', 'Engineer'],
        ],
      },
      { type: 'paragraph', text: 'Thank you.' },
    ]);
  });

  it('rejects empty markdown', () => {
    expect(() => markdownToDocumentSpec('   \n\n  ')).toThrow(MarkdownConversionUnsupported);
  });
});

describe('markdownToSlidesSpec', () => {
  it('starts a new slide on each heading and collects bullets under it', () => {
    const spec = markdownToSlidesSpec('# Kickoff\n- welcome\n- agenda\n\n# Next steps\n- follow up\n');
    expect(spec.slides).toEqual([
      { title: 'Kickoff', bullets: ['welcome', 'agenda'] },
      { title: 'Next steps', bullets: ['follow up'] },
    ]);
  });

  it('rejects markdown with no heading, since every slide needs one', () => {
    expect(() => markdownToSlidesSpec('- a bullet with no heading above it')).toThrow(
      MarkdownConversionUnsupported,
    );
  });
});

describe('markdownToDocumentSpec callouts', () => {
  it('parses blockquotes as callout blocks', () => {
    const spec = markdownToDocumentSpec('# Report\n\n> Important: Please review before submitting.\n\nRegular text.');
    expect(spec.blocks).toContainEqual({
      type: 'callout',
      text: 'Important: Please review before submitting.',
    });
  });
});

describe('Office & PDF Export Renderers', () => {
  it('renders a styled Excel workbook supporting formulas, numbers, and percentages', async () => {
    const { renderSpreadsheet } = await import('./documents.js');
    const buf = await renderSpreadsheet({
      sheets: [
        {
          name: 'Financials',
          header: ['Metric', 'Q1', 'Growth', 'Formula'],
          rows: [
            ['Revenue', '$10,000.00', '15.5%', '100'],
            ['Expenses', '$4,500.00', '8.0%', '50'],
            ['Net Margin', '$5,500.00', '22.0%', '=D2-D3'],
          ],
        },
      ],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('renders a professional DOCX document buffer with tables and callouts', async () => {
    const { renderDocument } = await import('./documents.js');
    const buf = await renderDocument({
      title: 'Executive Brief',
      blocks: [
        { type: 'heading', level: 1, text: 'Executive Brief' },
        { type: 'callout', text: 'Confidential memorandum for internal review.' },
        { type: 'paragraph', text: 'This is the **bold** and *italic* body copy.' },
        {
          type: 'table',
          header: ['Project', 'Lead', 'Status'],
          rows: [['ArcNave', 'DeepMind Team', 'Active']],
        },
      ],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('renders a valid PowerPoint presentation buffer', async () => {
    const { renderSlides } = await import('./documents.js');
    const buf = await renderSlides({
      slides: [
        {
          title: 'ArcNave Capability Overview',
          bullets: ['Grounding in primary sources', 'Deterministic office deliverable export', 'Agent loop synthesis'],
        },
      ],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('renders a valid PDF document buffer with header, table, and callout', async () => {
    const { renderPdf } = await import('./documents.js');
    const buf = await renderPdf({
      title: 'Audited Statement',
      blocks: [
        { type: 'heading', level: 1, text: 'Audited Statement' },
        { type: 'callout', text: 'Certified true and accurate.' },
        { type: 'paragraph', text: 'Summary of annual operational findings.' },
        {
          type: 'table',
          header: ['Account', 'Balance'],
          rows: [['Checking', '$120,000.00'], ['Savings', '$450,000.00']],
        },
      ],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    // PDF magic number header: %PDF-
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders markdown directly through renderMarkdownExport for all 4 formats', async () => {
    const { renderMarkdownExport } = await import('./documents.js');
    const md = '# Title\n\n> Note this.\n\n| Item | Cost |\n| --- | --- |\n| Widget | $10 |\n';

    const xlsx = await renderMarkdownExport(md, 'xlsx');
    expect(xlsx.length).toBeGreaterThan(500);

    const docx = await renderMarkdownExport(md, 'docx');
    expect(docx.length).toBeGreaterThan(500);

    const pptx = await renderMarkdownExport(md, 'pptx');
    expect(pptx.length).toBeGreaterThan(500);

    const pdf = await renderMarkdownExport(md, 'pdf');
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('parses markdown table inside a slide into slide.table spec', () => {
    const md = `# Comparison Slide
| Option | Speed | Cost |
| --- | --- | --- |
| Alpha | Fast | High |
| Beta | Medium | Low |
- Key takeaway: Beta offers better value
`;
    const spec = markdownToSlidesSpec(md);
    expect(spec.slides.length).toBe(1);
    expect(spec.slides[0]!.table).toEqual({
      header: ['Option', 'Speed', 'Cost'],
      rows: [
        ['Alpha', 'Fast', 'High'],
        ['Beta', 'Medium', 'Low'],
      ],
    });
    expect(spec.slides[0]!.bullets).toContain('Key takeaway: Beta offers better value');
  });

  it('parses structured 3-card slide markdown into slide.cards', () => {
    const md = `# Pillar Strategy
- **Pillar 1**: Focus on foundation stability
- **Pillar 2**: Scale out user workflows
- **Pillar 3**: Harden enterprise compliance
`;
    const spec = markdownToSlidesSpec(md);
    expect(spec.slides[0]!.cards).toEqual([
      { title: 'Pillar 1', body: 'Focus on foundation stability' },
      { title: 'Pillar 2', body: 'Scale out user workflows' },
      { title: 'Pillar 3', body: 'Harden enterprise compliance' },
    ]);
  });

  it('splits bullet lists exceeding 5 items into continuation slides with (cont.)', () => {
    const md = `# Long List Slide
- Item 1
- Item 2
- Item 3
- Item 4
- Item 5
- Item 6
- Item 7
`;
    const spec = markdownToSlidesSpec(md);
    expect(spec.slides.length).toBe(2);
    expect(spec.slides[0]!.title).toBe('Long List Slide');
    expect(spec.slides[0]!.bullets).toEqual(['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5']);
    expect(spec.slides[1]!.title).toBe('Long List Slide (cont.)');
    expect(spec.slides[1]!.bullets).toEqual(['Item 6', 'Item 7']);
  });

  it('parses page breaks and nested bullets in document specs', () => {
    const md = `# Doc with Break
First section.
---
## Second section
- Level 0
  - Level 1
    - Level 2
`;
    const spec = markdownToDocumentSpec(md);
    expect(spec.blocks).toContainEqual({ type: 'pagebreak' });
    expect(spec.blocks).toContainEqual({ type: 'bullet', text: 'Level 0', level: 0 });
    expect(spec.blocks).toContainEqual({ type: 'bullet', text: 'Level 1', level: 1 });
    expect(spec.blocks).toContainEqual({ type: 'bullet', text: 'Level 2', level: 2 });
  });

  it('renders a PDF with multi-page table and rupee symbol sanitization', async () => {
    const { renderPdf } = await import('./documents.js');
    const rows: string[][] = [];
    for (let i = 1; i <= 35; i++) {
      rows.push([`Item ${i}`, `₹${i * 100}.00`, `Active`]);
    }
    const buf = await renderPdf({
      title: 'Invoice Statement (₹ INR)',
      blocks: [
        { type: 'heading', level: 1, text: 'Invoice Statement (₹ INR)' },
        { type: 'callout', text: 'Prices in ₹ (Indian Rupee) — sanitized cleanly for PDF fonts.' },
        {
          type: 'table',
          header: ['SKU', 'Price', 'Status'],
          rows,
        },
      ],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders a PPTX with card layouts and table slides', async () => {
    const { renderSlides } = await import('./documents.js');
    const buf = await renderSlides({
      slides: [
        {
          title: 'Strategic Pillars',
          bullets: [],
          cards: [
            { title: 'Pillar A', body: 'Robust infrastructure' },
            { title: 'Pillar B', body: 'Predictable pricing' },
            { title: 'Pillar C', body: 'Enterprise security' },
          ],
        },
        {
          title: 'Performance Matrix',
          bullets: [],
          table: {
            header: ['Metric', 'Target', 'Actual'],
            rows: [
              ['Latency', '< 200ms', '140ms'],
              ['Uptime', '99.9%', '99.95%'],
            ],
          },
        },
      ],
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });
});

describe('ArcNave Deliverable FULL Contract Benchmarks & Post-Generation Verification', () => {
  const TINY_PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('DOCX Benchmark: verifies headings, inline code, nested lists, hyperlinks, image, table, pagebreak, landscape, footer, and Page X of Y', async () => {
    const { renderMarkdownExport, verifyDocx } = await import('./documents.js');

    const docxMarkdown = `
# Executive Strategic Briefing

This is **high priority** confidential analysis with *italic emphasis* and \`code_execution\` tokens.
Visit the [ArcNave Platform](https://arcnave.ai) for live telemetry.

## 1. Core Principles
- Item 1: Foundation
  - Level 1 Sub-item
    - Level 2 Deep item
- Item 2: Execution

1. First ordered step
2. Second ordered step

![System Diagram](${TINY_PNG_DATA_URL})

> Note: All deliverables must adhere strictly to verified capability contracts.

| Metric | Target | Status |
| --- | --- | --- |
| Velocity | 100 req/s | Exceeded |
| Uptime | 99.99% | Maintained |

---

<!-- landscape -->
## 2. Landscape Cross-Functional Roadmap

| Pillar | Owner | Timeline | Deliverable |
| --- | --- | --- | --- |
| Compute | Core Team | Q1 2026 | Cloud Run Sandbox |
| Office | Export Team | Q2 2026 | Native OOXML Generators |
`;

    const buf = await renderMarkdownExport(docxMarkdown, 'docx');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);

    const result = await verifyDocx(buf);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.metrics?.tables).toBeGreaterThanOrEqual(2);
    expect(result.metrics?.images).toBeGreaterThanOrEqual(1);
    expect(result.metrics?.hyperlinks).toBeGreaterThanOrEqual(1);
    expect(result.metrics?.hasFooter).toBe(true);
    expect(result.metrics?.hasPageNumbering).toBe(true);
    expect(result.metrics?.hasLandscape).toBe(true);
  });

  it('XLSX Benchmark: verifies multiple sheets, currency, percentage, date, formulas, summary notes, and embedded image', async () => {
    const { renderMarkdownExport, verifyXlsx } = await import('./documents.js');

    const xlsxMarkdown = `
This workbook models ArcNave quarterly revenue growth, operational expenses, and margin trajectories.

# Financial Performance
| Metric | Q1 | Q2 | Growth | Formula Total | Date Recorded |
| --- | --- | --- | --- | --- | --- |
| Software Revenue | $25,000.00 | $35,000.00 | 40.0% | 100 | 2026-03-31 |
| Cloud Services | $15,000.00 | $22,500.00 | 50.0% | 200 | 2026-06-30 |
| Total Consolidated | $40,000.00 | $57,500.00 | 43.8% | =E2+E3 | 2026-09-20 |

![Growth Chart](${TINY_PNG_DATA_URL})
All figures audited by finance controller.

# Operations Matrix
| Department | Headcount | Efficiency | Target Met |
| --- | --- | --- | --- |
| Engineering | 42 | 96.5% | Yes |
| Product | 12 | 92.0% | Yes |
`;

    const buf = await renderMarkdownExport(xlsxMarkdown, 'xlsx');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);

    const result = await verifyXlsx(buf);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.metrics?.sheets).toBeGreaterThanOrEqual(2);
    expect(result.metrics?.currencies).toBeGreaterThanOrEqual(6);
    expect(result.metrics?.numbers).toBeGreaterThanOrEqual(2);
    expect(result.metrics?.dates).toBeGreaterThanOrEqual(2);
    expect(result.metrics?.formulas).toBeGreaterThanOrEqual(1);
    expect(result.metrics?.images).toBeGreaterThanOrEqual(1);
  });

  it('PPTX Benchmark: verifies title slide, normal slide, table slide, 2-column slide, 3-card slide, image slide, continuation slide, speaker notes, and >= 14pt typography floor', async () => {
    const { renderMarkdownExport, verifyPptx } = await import('./documents.js');

    const pptxMarkdown = `
# ArcNave Architecture 2026
Executive Technology Briefing

# Mission & Objectives
- Grounded primary-source synthesis
- Deterministic deliverable generation
- Zero-preamble cover-note discipline
Notes: Emphasize that chat is the cover note and the slide deck is the deliverable.

# Platform Performance Matrix
| Dimension | Baseline | ArcNave Full | Delta |
| --- | --- | --- | --- |
| Latency | 1200ms | 180ms | -85% |
| Export Fidelity | Partial | 100% Full | Verified |

# Architecture Split
- **Compute Layer**: Isolated Cloud Run Job sandbox
- **Artifact Layer**: PostgreSQL state machine with optimistic locking

# Strategic Pillars
- **Type Safety**: End-to-end Zod and TypeScript contracts
- **Verifiable Truth**: Strict capability status isolation
- **Format Native**: Dedicated generator per file type

# System Topology
![Topology Diagram](${TINY_PNG_DATA_URL})
- Regional Cloud SQL deployment
- Low latency Vertex AI routing

# Action Roadmap
- Finalize capability promotion matrix
- Complete regression test execution
- Sync production feature flags
- Audit documentation invariants
- Re-verify GDS application form
- Package deliverable assets
- Brief stakeholders on deployment
`;

    const buf = await renderMarkdownExport(pptxMarkdown, 'pptx');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);

    const result = await verifyPptx(buf);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    // 7 input slides + 1 overflow continuation slide from Action Roadmap (7 bullets > 5) = 8 slides
    expect(result.metrics?.slides).toBeGreaterThanOrEqual(8);
    expect(result.metrics?.tables).toBeGreaterThanOrEqual(1);
    expect(result.metrics?.shapes).toBeGreaterThanOrEqual(2);
    expect(result.metrics?.images).toBeGreaterThanOrEqual(1);
    expect(result.metrics?.fontFloorPreserved).toBe(true);
    expect(result.metrics?.hasNotes).toBe(true);
  });

  it('PDF Benchmark: verifies ₹ currency, Tamil text, word wrapping, callout, image, multi-page table, pagebreak, running headers, and Page X of Y footers', async () => {
    const { renderMarkdownExport, verifyPdf } = await import('./documents.js');

    const pdfRows: string[] = [];
    for (let i = 1; i <= 36; i++) {
      pdfRows.push(`| SKU-${1000 + i} | Enterprise Package #${i} | ₹${(i * 1500).toLocaleString('en-IN')}.00 | Active |`);
    }

    const pdfMarkdown = `
# Certified Operational Statement

தமிழ்நாடு அஞ்சல் துறை மற்றும் தலைமை அலுவலகம் - Certified Annual Review.
This document certifies that all financial transactions recorded below in ₹ (Indian Rupee) have been verified according to governmental regulatory audit standards.
Please review the official guidelines at [ArcNave Compliance](https://arcnave.ai).

![Official Seal](${TINY_PNG_DATA_URL})

> Executive Certification: All figures stated in this document are verified against primary ledger records and certified accurate.

| Item ID | Description | Amount (₹ INR) | Status |
| --- | --- | --- | --- |
${pdfRows.join('\n')}

---

## Final Concluding Disclosures
This appendix certifies the conclusion of the operational audit.
All rights reserved by Department of Posts and ArcNave Technologies.
`;

    const buf = await renderMarkdownExport(pdfMarkdown, 'pdf');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);

    const result = await verifyPdf(buf);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.metrics?.hasValidHeader).toBe(true);
    expect(result.metrics?.pages).toBeGreaterThanOrEqual(3);
    expect(result.metrics?.hasCrossReferenceTable).toBe(true);
  });
});

