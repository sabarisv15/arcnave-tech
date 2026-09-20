/**
 * Format-native Word (DOCX) deliverable renderer.
 * Produces professional OOXML Word documents with styled tables, callouts,
 * embedded images, multi-section orientations, and running Page X of Y footers.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { resolveArtifactImage } from './images.js';
import type { DocumentBlock, DocumentSpec } from './types.js';

export async function renderDocument(spec: DocumentSpec): Promise<Buffer> {
  const headingFor = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  } as const;

  const formatInline = (rawText: string): (InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>)[] => {
    const runs: (InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>)[] = [];
    const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(rawText)) !== null) {
      if (match.index > lastIndex) {
        runs.push(new TextRun({ text: rawText.slice(lastIndex, match.index), font: 'Segoe UI' }));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        runs.push(new TextRun({ text: token.slice(2, -2), bold: true, font: 'Segoe UI' }));
      } else if (token.startsWith('*') && token.endsWith('*')) {
        runs.push(new TextRun({ text: token.slice(1, -1), italics: true, font: 'Segoe UI' }));
      } else if (token.startsWith('`') && token.endsWith('`')) {
        runs.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas', shading: { fill: 'F3F4F6' } }));
      } else if (token.startsWith('[') && token.includes('](')) {
        const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        if (linkMatch) {
          runs.push(
            new ExternalHyperlink({
              children: [
                new TextRun({
                  text: linkMatch[1]!,
                  style: 'Hyperlink',
                  color: '2563EB',
                  underline: {},
                  font: 'Segoe UI',
                }),
              ],
              link: linkMatch[2]!,
            }),
          );
        }
      }
      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < rawText.length) {
      runs.push(new TextRun({ text: rawText.slice(lastIndex), font: 'Segoe UI' }));
    }

    return runs.length > 0 ? runs : [new TextRun({ text: rawText, font: 'Segoe UI' })];
  };

  interface SectionContent {
    orientation: 'portrait' | 'landscape';
    children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[];
  }

  const sections: SectionContent[] = [{ orientation: 'portrait', children: [] }];
  let currentSection = sections[0]!;

  for (const block of spec.blocks) {
    if (block.type === 'section') {
      currentSection = { orientation: block.orientation, children: [] };
      sections.push(currentSection);
      continue;
    }

    if (block.type === 'pagebreak') {
      currentSection.children.push(new Paragraph({ children: [new PageBreak()] }));
      continue;
    }

    if (block.type === 'image') {
      const img = await resolveArtifactImage(block.src);
      if (img) {
        const maxWidth = currentSection.orientation === 'landscape' ? 700 : 500;
        const maxHeight = 380;
        let targetWidth = img.width;
        let targetHeight = img.height;
        if (targetWidth > maxWidth) {
          const scale = maxWidth / targetWidth;
          targetWidth = maxWidth;
          targetHeight = Math.round(targetHeight * scale);
        }
        if (targetHeight > maxHeight) {
          const scale = maxHeight / targetHeight;
          targetHeight = maxHeight;
          targetWidth = Math.round(targetWidth * scale);
        }
        currentSection.children.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: img.mime === 'image/jpeg' ? 'jpg' : 'png',
                data: img.buffer,
                transformation: { width: targetWidth, height: targetHeight },
                altText: { title: block.alt, description: block.alt, name: block.alt },
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
          }),
        );
      } else {
        currentSection.children.push(
          new Paragraph({
            children: [new TextRun({ text: `[Image: ${block.alt}]`, italics: true, color: '64748B', font: 'Segoe UI' })],
            spacing: { before: 80, after: 80 },
          }),
        );
      }
      continue;
    }

    if (block.type === 'heading') {
      currentSection.children.push(
        new Paragraph({
          children: formatInline(block.text),
          heading: headingFor[block.level],
          spacing: {
            before: block.level === 1 ? 280 : block.level === 2 ? 220 : 160,
            after: block.level === 1 ? 140 : block.level === 2 ? 100 : 80,
          },
        }),
      );
      continue;
    }

    if (block.type === 'bullet') {
      currentSection.children.push(
        new Paragraph({
          children: formatInline(block.text),
          bullet: { level: block.level ?? 0 },
          spacing: { after: 60 },
        }),
      );
      continue;
    }

    if (block.type === 'callout') {
      currentSection.children.push(
        new Paragraph({
          children: formatInline(block.text),
          indent: { left: 720 },
          border: {
            left: { style: BorderStyle.SINGLE, size: 24, space: 12, color: '2563EB' },
          },
          shading: { fill: 'F8FAFC' },
          spacing: { before: 120, after: 120 },
        }),
      );
      continue;
    }

    if (block.type === 'table') {
      const cellBorders = {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
      };

      const tableRows: InstanceType<typeof TableRow>[] = [];

      // Header Row
      tableRows.push(
        new TableRow({
          tableHeader: true,
          children: block.header.map(
            (cellText) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: cellText, bold: true, color: '0F172A', font: 'Segoe UI' })],
                    spacing: { before: 80, after: 80 },
                  }),
                ],
                shading: { fill: 'F1F5F9' },
                borders: cellBorders,
                margins: { top: 120, bottom: 120, left: 160, right: 160 },
              }),
          ),
        }),
      );

      // Body Rows
      for (let r = 0; r < block.rows.length; r++) {
        const rowData = block.rows[r]!;
        const isZebra = r % 2 === 1;
        tableRows.push(
          new TableRow({
            children: rowData.map(
              (cellText) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: formatInline(cellText),
                      spacing: { before: 60, after: 60 },
                    }),
                  ],
                  shading: isZebra ? { fill: 'F8FAFC' } : undefined,
                  borders: cellBorders,
                  margins: { top: 100, bottom: 100, left: 160, right: 160 },
                }),
            ),
          }),
        );
      }

      currentSection.children.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
      );
      continue;
    }

    // Default: paragraph
    currentSection.children.push(
      new Paragraph({
        children: formatInline(block.text),
        spacing: { after: 120 },
      }),
    );
  }

  // Filter out any empty sections
  const usableSections = sections.filter((s) => s.children.length > 0);
  if (usableSections.length === 0) {
    usableSections.push({
      orientation: 'portrait',
      children: [new Paragraph({ children: [new TextRun({ text: spec.title || 'Untitled', font: 'Segoe UI' })] })],
    });
  }

  const doc = new Document({
    title: spec.title,
    sections: usableSections.map((sec) => ({
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          size: {
            orientation: sec.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.LEFT,
              children: [
                new TextRun({ text: spec.title || 'ArcNave Document', font: 'Segoe UI', size: 16, color: '94A3B8' }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: 'Page ', font: 'Segoe UI', size: 18, color: '64748B' }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Segoe UI', size: 18, color: '64748B' }),
                new TextRun({ text: ' of ', font: 'Segoe UI', size: 18, color: '64748B' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Segoe UI', size: 18, color: '64748B' }),
              ],
            }),
          ],
        }),
      },
      children: sec.children,
    })),
  });

  return Packer.toBuffer(doc);
}
