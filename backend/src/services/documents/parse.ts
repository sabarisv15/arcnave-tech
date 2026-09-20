/**
 * Semantic Markdown parsing for Office and PDF deliverables.
 * Shared source understanding converting Markdown into format-agnostic specs.
 */

import { MarkdownConversionUnsupported } from './types.js';
import type {
  DocumentBlock,
  DocumentSpec,
  SheetSpec,
  SlideItem,
  SlideTable,
  SlidesSpec,
  SpreadsheetSpec,
} from './types.js';

const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

const isSeparatorRow = (line: string): boolean =>
  isTableRow(line) && splitRow(line).every((cell) => /^:?-+:?$/.test(cell));

/**
 * Parses markdown into a structured spreadsheet specification.
 * GFM tables under headings become worksheets. Top-level prose becomes a Summary sheet or notes.
 */
export function markdownToSpreadsheetSpec(markdown: string): SpreadsheetSpec {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  interface RawTable {
    heading: string;
    header: string[];
    rows: string[][];
    notes: string[];
    hasChart?: boolean;
  }

  const tables: RawTable[] = [];
  const leadingProse: string[] = [];
  let currentHeading = '';
  let pendingNotes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();

    const headingMatch = /^#{1,3}\s+(.+)$/.exec(line);
    if (headingMatch) {
      currentHeading = headingMatch[1]!.trim();
      continue;
    }

    // GFM Table Detection: Header row followed by separator row
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1]!)) {
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]!)) {
        rows.push(splitRow(lines[j]!));
        j++;
      }

      const hasChart = currentHeading.toLowerCase().includes('chart') ||
        pendingNotes.some((n) => n.toLowerCase().includes('chart') || n.includes('<!-- chart -->'));

      tables.push({
        heading: currentHeading,
        header,
        rows,
        notes: [...pendingNotes],
        hasChart,
      });

      pendingNotes = [];
      i = j - 1;
      continue;
    }

    if (line !== '') {
      if (tables.length === 0 && !currentHeading) {
        leadingProse.push(line);
      } else {
        pendingNotes.push(line);
      }
    }
  }

  if (tables.length === 0) {
    throw new MarkdownConversionUnsupported(
      'This version does not contain a Markdown table. Spreadsheets can only be exported from tabular data.',
    );
  }

  const sanitizeSheetName = (raw: string, fallback: string): string => {
    const cleaned = raw.replace(/[\\/*?:[\]]/g, '').trim();
    return cleaned.slice(0, 31) || fallback;
  };

  const used = new Set<string>();
  const sheets: SheetSpec[] = [];

  // If there is substantial leading prose/summary before the first table, preserve it in a Summary tab
  if (leadingProse.length > 0) {
    const summaryName = 'Executive Summary';
    used.add(summaryName);
    sheets.push({
      name: summaryName,
      header: ['Metric / Area', 'Summary Details'],
      rows: leadingProse.map((prose, idx) => [`Item ${idx + 1}`, prose]),
      notes: leadingProse,
    });
  }

  for (let index = 0; index < tables.length; index++) {
    const table = tables[index]!;
    const base = sanitizeSheetName(table.heading, `Sheet ${index + 1}`);
    let name = base;
    let counter = 2;
    while (used.has(name)) {
      const suffix = ` (${counter})`;
      const truncated = base.slice(0, Math.max(1, 31 - suffix.length));
      name = `${truncated}${suffix}`;
      counter++;
    }
    used.add(name);
    const sheet: SheetSpec = {
      name,
      header: table.header,
      rows: table.rows,
    };
    if (table.notes && table.notes.length > 0) {
      sheet.notes = table.notes;
    }
    if (table.hasChart) {
      sheet.hasChart = true;
    }
    sheets.push(sheet);
  }

  return { sheets };
}

/**
 * Parses markdown into a structured document specification for Word and PDF.
 */
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

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();

    // Table detection: header row followed by separator row
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1]!)) {
      flushParagraph();
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]!)) {
        rows.push(splitRow(lines[j]!));
        j++;
      }
      blocks.push({ type: 'table', header, rows });
      i = j - 1;
      continue;
    }

    if (line === '---' || line === '<pagebreak>') {
      flushParagraph();
      blocks.push({ type: 'pagebreak' });
      continue;
    }

    // Orientation section tags
    if (line === '<!-- landscape -->' || line === '<section:landscape>') {
      flushParagraph();
      blocks.push({ type: 'section', orientation: 'landscape' });
      continue;
    }
    if (line === '<!-- portrait -->' || line === '<section:portrait>') {
      flushParagraph();
      blocks.push({ type: 'section', orientation: 'portrait' });
      continue;
    }

    // Image detection: ![alt](src)
    const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line);
    if (imageMatch) {
      flushParagraph();
      blocks.push({
        type: 'image',
        alt: imageMatch[1] || 'Embedded image',
        src: imageMatch[2]!.trim(),
      });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    const bulletMatch = /^(\s*)[-*]\s+(.+)$/.exec(raw);
    const orderedMatch = /^(\s*)(\d+\.)\s+(.+)$/.exec(raw);
    const calloutMatch = /^>\s*(.+)$/.exec(line);

    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1]!.length as 1 | 2 | 3;
      const text = headingMatch[2]!.trim();
      if (!title && level === 1) title = text;
      blocks.push({ type: 'heading', level, text });
    } else if (bulletMatch) {
      flushParagraph();
      const indent = bulletMatch[1]!.length;
      const level = Math.min(3, Math.floor(indent / 2));
      blocks.push({ type: 'bullet', text: bulletMatch[2]!.trim(), level });
    } else if (orderedMatch) {
      flushParagraph();
      blocks.push({ type: 'paragraph', text: `${orderedMatch[2]} ${orderedMatch[3]!.trim()}` });
    } else if (calloutMatch) {
      flushParagraph();
      blocks.push({ type: 'callout', text: calloutMatch[1]!.trim() });
    } else if (line === '') {
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

/**
 * Parses markdown into a structured slide presentation specification for PowerPoint.
 */
export function markdownToSlidesSpec(markdown: string): SlidesSpec {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const rawSlides: SlideItem[] = [];
  let current: SlideItem | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();

    const headingMatch = /^#{1,2}\s+(.+)$/.exec(line);
    const subHeadingMatch = /^###\s+(.+)$/.exec(line);
    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line);
    const notesMatch = /^(?:Notes:|<!--\s*notes:\s*)(.+?)(?:-->)?$/i.exec(line);

    if (headingMatch) {
      current = { title: headingMatch[1]!.trim(), bullets: [] };
      rawSlides.push(current);
      continue;
    }

    if (!current) continue;

    if (notesMatch) {
      current.notes = current.notes ? `${current.notes}\n${notesMatch[1]!.trim()}` : notesMatch[1]!.trim();
      continue;
    }

    if (imageMatch) {
      current.image = { alt: imageMatch[1] || 'Slide image', src: imageMatch[2]!.trim() };
      continue;
    }

    // Table detection inside slide
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1]!)) {
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]!)) {
        rows.push(splitRow(lines[j]!));
        j++;
      }
      current.table = { header, rows };
      i = j - 1;
      continue;
    }

    // Subheading as card
    if (subHeadingMatch) {
      current.cards = current.cards || [];
      current.cards.push({ title: subHeadingMatch[1]!.trim(), body: '' });
      continue;
    }

    if (bulletMatch) {
      const bulletText = bulletMatch[1]!.trim();
      current.bullets.push(bulletText);

      // Card pattern: **Title**: Description
      const cardPattern = /^\*\*([^*]+)\*\*:\s*(.+)$/.exec(bulletText);
      if (cardPattern) {
        current.cards = current.cards || [];
        current.cards.push({ title: cardPattern[1]!.trim(), body: cardPattern[2]!.trim() });
      } else if (current.cards && current.cards.length > 0) {
        const lastCard = current.cards[current.cards.length - 1]!;
        lastCard.body = lastCard.body ? `${lastCard.body}\n${bulletText}` : bulletText;
      }
    } else if (line !== '' && !isTableRow(line)) {
      current.bullets.push(line);
    }
  }

  const usable = rawSlides.filter(
    (s) => s.bullets.length > 0 || s.title || s.table || (s.cards && s.cards.length > 0) || s.image,
  );

  if (usable.length === 0) {
    throw new MarkdownConversionUnsupported(
      'This version has no heading to export as a slide deck — each slide needs a heading.',
    );
  }

  // Detect 2-column layouts if slide has bullets with explicit column tags or cards === 2
  for (const slide of usable) {
    if (slide.cards && slide.cards.length === 2 && !slide.table) {
      slide.columns = {
        left: [slide.cards[0]!.title, slide.cards[0]!.body],
        right: [slide.cards[1]!.title, slide.cards[1]!.body],
      };
    }
  }

  // Overflow Handling: split long bullet lists (>5 bullets) into continuation slides
  const finalSlides: SlideItem[] = [];
  const MAX_BULLETS_PER_SLIDE = 5;

  for (const slide of usable) {
    // If slide has table, structured cards, or image layout, keep as is
    if (slide.table || (slide.cards && slide.cards.length >= 2) || slide.image) {
      finalSlides.push(slide);
      continue;
    }

    if (slide.bullets.length <= MAX_BULLETS_PER_SLIDE) {
      finalSlides.push(slide);
    } else {
      for (let b = 0; b < slide.bullets.length; b += MAX_BULLETS_PER_SLIDE) {
        const chunk = slide.bullets.slice(b, b + MAX_BULLETS_PER_SLIDE);
        finalSlides.push({
          title: b === 0 ? slide.title : `${slide.title} (cont.)`,
          bullets: chunk,
          notes: b === 0 ? slide.notes : undefined,
        });
      }
    }
  }

  return { slides: finalSlides };
}
