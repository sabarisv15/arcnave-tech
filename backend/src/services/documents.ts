/**
 * Deterministic Markdown -> binary Office file conversion.
 *
 * The other half of ADR-0004, item 8: rather than depend on a model's code-execution sandbox
 * for output bytes (Gemini's has no filesystem and no `openpyxl`; Claude has no code execution
 * on Vertex at all), this parses the Markdown an artifact version already holds — tables,
 * headings, bullet lists, written in the ordinary course of a response — into a small typed
 * spec, then renders that spec with a library built for the target format. Provider-agnostic
 * by construction: it runs on whatever Markdown ended up in the version, regardless of which
 * model wrote it.
 *
 * Each `parseXFromMarkdown` throws `MarkdownConversionUnsupported` when the source has nothing
 * of the shape the target format needs (no table for a spreadsheet, no heading for slides) —
 * this never emits an empty file standing in for a real answer.
 */

/** The Markdown had nothing of the shape this export format needs. */
export class MarkdownConversionUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkdownConversionUnsupported';
  }
}

export type ExportFormat = 'xlsx' | 'docx' | 'pptx';

export const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/* -------------------------------------------------------------------------- markdown parsing */

interface MarkdownTable {
  /** Text preceding the table (nearest heading above it), used as a sheet name. */
  heading: string | null;
  header: string[];
  rows: string[][];
}

/** GFM pipe tables: a header row, a `---`/`:--:` separator row, then data rows. */
function parseMarkdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);
  const splitRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  // A separator cell is dashes, optionally flanked by alignment colons (`---`, `:--`, `--:`,
  // `:-:`) — checked per cell after splitting, not with one regex over the whole row, because
  // a row-level pattern has to describe "N columns" without knowing N in advance.
  const isSeparatorRow = (line: string): boolean =>
    isTableRow(line) && splitRow(line).every((cell) => /^:?-+:?$/.test(cell));

  const tables: MarkdownTable[] = [];
  let lastHeading: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line);
    if (headingMatch) {
      lastHeading = headingMatch[1]!.trim();
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1]!)) {
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]!)) {
        rows.push(splitRow(lines[j]!));
        j++;
      }
      tables.push({ heading: lastHeading, header, rows });
      i = j - 1;
    }
  }
  return tables;
}

export interface SpreadsheetSpec {
  sheets: Array<{ name: string; header: string[]; rows: string[][] }>;
}

export function markdownToSpreadsheetSpec(markdown: string): SpreadsheetSpec {
  const tables = parseMarkdownTables(markdown);
  if (tables.length === 0) {
    throw new MarkdownConversionUnsupported(
      'This version has no Markdown table to export as a spreadsheet.',
    );
  }
  const used = new Set<string>();
  const sheets = tables.map((table, index) => {
    let name = (table.heading ?? `Sheet ${index + 1}`).slice(0, 31) || `Sheet ${index + 1}`;
    while (used.has(name)) name = `${name.slice(0, 28)} (${index + 1})`;
    used.add(name);
    return { name, header: table.header, rows: table.rows };
  });
  return { sheets };
}

type DocumentBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string };

export interface DocumentSpec {
  title: string;
  blocks: DocumentBlock[];
}

export function markdownToDocumentSpec(markdown: string): DocumentSpec {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: DocumentBlock[] = [];
  let title = '';
  let paragraphBuffer: string[] = [];

  const flushParagraph = (): void => {
    const text = paragraphBuffer.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    paragraphBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      const text = headingMatch[2]!.trim();
      if (!title && level === 1) title = text;
      blocks.push({ type: 'heading', level, text });
    } else if (bulletMatch) {
      flushParagraph();
      blocks.push({ type: 'bullet', text: bulletMatch[1]!.trim() });
    } else if (line === '' || /^\|.*\|$/.test(line) || /^\s*:?-+:?\s*\|/.test(line)) {
      // Blank lines and table rows (already covered by the spreadsheet export) end a paragraph
      // without becoming one.
      flushParagraph();
    } else {
      paragraphBuffer.push(line);
    }
  }
  flushParagraph();

  if (blocks.length === 0) {
    throw new MarkdownConversionUnsupported(
      'This version has no text to export as a document.',
    );
  }
  return { title: title || 'Untitled document', blocks };
}

export interface SlidesSpec {
  slides: Array<{ title: string; bullets: string[] }>;
}

export function markdownToSlidesSpec(markdown: string): SlidesSpec {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const slides: Array<{ title: string; bullets: string[] }> = [];
  let current: { title: string; bullets: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const headingMatch = /^#{1,2}\s+(.+)$/.exec(line);
    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    if (headingMatch) {
      current = { title: headingMatch[1]!.trim(), bullets: [] };
      slides.push(current);
    } else if (bulletMatch && current) {
      current.bullets.push(bulletMatch[1]!.trim());
    } else if (line !== '' && current && !/^\|/.test(line) && !/^\s*:?-+:?\s*\|/.test(line)) {
      current.bullets.push(line);
    }
  }

  const usable = slides.filter((s) => s.bullets.length > 0 || s.title);
  if (usable.length === 0) {
    throw new MarkdownConversionUnsupported(
      'This version has no heading to export as a slide deck — each slide needs a heading.',
    );
  }
  return { slides: usable };
}

/* -------------------------------------------------------------------------- rendering */

export async function renderSpreadsheet(spec: SpreadsheetSpec): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  for (const sheet of spec.sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.header);
    for (const row of sheet.rows) ws.addRow(row);
  }
  // See mistakes.md, 2026-09-18: exceljs's own `Buffer` type shadows the global one and does
  // not structurally match Node's real Buffer — a narrow, targeted `any` around that broken
  // ambient declaration, not a loosened contract of ours.
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.from(raw);
}

export async function renderDocument(spec: DocumentSpec): Promise<Buffer> {
  const { Document, HeadingLevel, Packer, Paragraph } = await import('docx');
  const headingFor = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  } as const;

  const children = spec.blocks.map((block) => {
    if (block.type === 'heading') {
      return new Paragraph({ text: block.text, heading: headingFor[block.level] });
    }
    if (block.type === 'bullet') {
      return new Paragraph({ text: block.text, bullet: { level: 0 } });
    }
    return new Paragraph({ text: block.text });
  });

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

interface PptxGenJSInstance {
  addSlide(): {
    addText(
      text: string | Array<{ text: string; options?: Record<string, unknown> }>,
      opts: Record<string, unknown>,
    ): void;
  };
  write(opts: { outputType: 'nodebuffer' }): Promise<Buffer>;
}

export async function renderSlides(spec: SlidesSpec): Promise<Buffer> {
  // See mistakes.md, 2026-09-18: pptxgenjs's ESM-authored `.d.ts` does not narrow past the
  // module namespace under this project's NodeNext + verbatimModuleSyntax config, on either a
  // value or a type-only import — the runtime value comes from `require` instead, typed
  // against the minimal surface actually used here.
  const { createRequire } = await import('node:module');
  const PptxGenJS = createRequire(import.meta.url)('pptxgenjs') as new () => PptxGenJSInstance;
  const pres = new PptxGenJS();

  for (const slide of spec.slides) {
    const s = pres.addSlide();
    s.addText(slide.title, { x: 0.4, y: 0.3, w: '90%', fontSize: 24, bold: true });
    if (slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.4, y: 1.1, w: '90%', h: '80%', fontSize: 16 },
      );
    }
  }
  return pres.write({ outputType: 'nodebuffer' });
}

export async function renderMarkdownExport(markdown: string, format: ExportFormat): Promise<Buffer> {
  if (format === 'xlsx') return renderSpreadsheet(markdownToSpreadsheetSpec(markdown));
  if (format === 'docx') return renderDocument(markdownToDocumentSpec(markdown));
  return renderSlides(markdownToSlidesSpec(markdown));
}
