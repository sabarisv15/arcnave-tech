/**
 * Format-native PowerPoint (PPTX) deliverable renderer.
 * Produces modern 16:9 presentations enforcing a strict >= 14pt typography floor,
 * supporting card layouts, 2-column layouts, table slides, embedded images,
 * continuation slides, and speaker notes.
 */

import pptxgen from 'pptxgenjs';
import { resolveArtifactImage } from './images.js';
import type { SlideItem, SlidesSpec } from './types.js';

export async function renderSlides(spec: SlidesSpec): Promise<Buffer> {
  const PptxGen = (pptxgen as unknown as { default?: unknown }).default || pptxgen;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pres: any = new (PptxGen as any)();

  pres.layout = 'LAYOUT_16x9';
  pres.author = 'ArcNave';
  pres.company = 'ArcNave';

  for (let i = 0; i < spec.slides.length; i++) {
    const item = spec.slides[i]!;
    const s = pres.addSlide();

    // Set slide background
    s.background = { color: 'F8FAFC' };

    // Add speaker notes if provided
    if (item.notes) {
      s.addNotes(item.notes);
    }

    // Title slide check (first slide with no table/cards, short bullets or subtitle)
    const isTitleSlide = i === 0 && !item.table && (!item.cards || item.cards.length === 0) && !item.image && item.bullets.length <= 2;

    if (isTitleSlide) {
      s.addText(item.title, {
        x: 0.8,
        y: 2.2,
        w: 11.7,
        h: 1.5,
        fontSize: 34,
        bold: true,
        color: '0F172A',
        fontFace: 'Segoe UI',
        align: 'left',
      });
      if (item.bullets.length > 0) {
        s.addText(item.bullets.join('\n'), {
          x: 0.8,
          y: 3.8,
          w: 11.7,
          h: 1.8,
          fontSize: 18,
          color: '475569',
          fontFace: 'Segoe UI',
          lineSpacingMultiple: 1.2,
        });
      }
      continue;
    }

    // Standard Slide Header
    s.addText(item.title, {
      x: 0.8,
      y: 0.5,
      w: 11.7,
      h: 0.9,
      fontSize: 24,
      bold: true,
      color: '0F172A',
      fontFace: 'Segoe UI',
    });

    // Layout A: Image + Text Slide
    if (item.image) {
      const img = await resolveArtifactImage(item.image.src);
      const textX = img ? 5.8 : 0.8;
      const textW = img ? 6.7 : 11.7;

      if (img) {
        s.addImage({
          data: `data:${img.mime};base64,${img.buffer.toString('base64')}`,
          x: 0.8,
          y: 1.6,
          w: 4.6,
          h: 4.8,
          sizing: { type: 'contain', w: 4.6, h: 4.8 },
        });
      }

      if (item.bullets.length > 0) {
        s.addText(
          item.bullets.map((b) => ({ text: b, options: { bullet: true } })),
          {
            x: textX,
            y: 1.6,
            w: textW,
            h: 4.8,
            fontSize: 15,
            color: '334155',
            fontFace: 'Segoe UI',
            lineSpacingMultiple: 1.25,
            paraSpaceAfter: 12,
          },
        );
      }
      continue;
    }

    // Layout B: Table Slide
    if (item.table) {
      const tableData = [
        item.table.header.map((h) => ({
          text: h,
          options: {
            bold: true,
            fill: { color: 'E2E8F0' },
            color: '0F172A',
            fontSize: 14,
            fontFace: 'Segoe UI',
            align: 'left',
          },
        })),
        ...item.table.rows.map((row, rIdx) =>
          row.map((cell) => ({
            text: cell,
            options: {
              fontSize: 14,
              fontFace: 'Segoe UI',
              fill: rIdx % 2 === 1 ? { color: 'F1F5F9' } : { color: 'FFFFFF' },
              color: '1E293B',
              align: 'left',
            },
          })),
        ),
      ];

      s.addTable(tableData, {
        x: 0.8,
        y: 1.6,
        w: 11.7,
        rowH: 0.45,
        border: { type: 'solid', pt: 0.5, color: 'CBD5E1' },
      });

      if (item.bullets.length > 0) {
        s.addText(
          item.bullets.map((b) => ({ text: b, options: { bullet: true } })),
          {
            x: 0.8,
            y: 5.6,
            w: 11.7,
            h: 1.3,
            fontSize: 14,
            color: '475569',
            fontFace: 'Segoe UI',
            lineSpacingMultiple: 1.1,
          },
        );
      }
      continue;
    }

    // Layout C: 2-Column Slide
    if (item.columns) {
      const colWidth = 5.6;
      // Left Column
      s.addShape(pres.ShapeType.roundRect, {
        x: 0.8,
        y: 1.6,
        w: colWidth,
        h: 4.9,
        fill: { color: 'FFFFFF' },
        line: { color: 'E2E8F0', width: 1 },
        rectRadius: 0.1,
      });
      s.addText(
        item.columns.left.map((t, idx) => ({
          text: t,
          options: { bold: idx === 0, fontSize: idx === 0 ? 16 : 14, color: idx === 0 ? '0F172A' : '334155' },
        })),
        {
          x: 1.0,
          y: 1.8,
          w: colWidth - 0.4,
          h: 4.5,
          fontFace: 'Segoe UI',
          lineSpacingMultiple: 1.2,
        },
      );

      // Right Column
      s.addShape(pres.ShapeType.roundRect, {
        x: 6.9,
        y: 1.6,
        w: colWidth,
        h: 4.9,
        fill: { color: 'FFFFFF' },
        line: { color: 'E2E8F0', width: 1 },
        rectRadius: 0.1,
      });
      s.addText(
        item.columns.right.map((t, idx) => ({
          text: t,
          options: { bold: idx === 0, fontSize: idx === 0 ? 16 : 14, color: idx === 0 ? '0F172A' : '334155' },
        })),
        {
          x: 7.1,
          y: 1.8,
          w: colWidth - 0.4,
          h: 4.5,
          fontFace: 'Segoe UI',
          lineSpacingMultiple: 1.2,
        },
      );
      continue;
    }

    // Layout D: 3-Card Layout (or 2-4 cards)
    if (item.cards && item.cards.length >= 2) {
      const cardCount = Math.min(item.cards.length, 4);
      const gap = 0.3;
      const totalWidth = 11.7;
      const cardWidth = (totalWidth - gap * (cardCount - 1)) / cardCount;

      item.cards.slice(0, cardCount).forEach((card, cIdx) => {
        const cardX = 0.8 + cIdx * (cardWidth + gap);
        s.addShape(pres.ShapeType.roundRect, {
          x: cardX,
          y: 1.6,
          w: cardWidth,
          h: 4.9,
          fill: { color: 'FFFFFF' },
          line: { color: 'E2E8F0', width: 1 },
          rectRadius: 0.1,
        });

        s.addText(card.title, {
          x: cardX + 0.2,
          y: 1.8,
          w: cardWidth - 0.4,
          h: 0.8,
          fontSize: 16,
          bold: true,
          color: '0F172A',
          fontFace: 'Segoe UI',
        });

        if (card.body) {
          s.addText(card.body, {
            x: cardX + 0.2,
            y: 2.7,
            w: cardWidth - 0.4,
            h: 3.5,
            fontSize: 14,
            color: '475569',
            fontFace: 'Segoe UI',
            lineSpacingMultiple: 1.2,
          });
        }
      });
      continue;
    }

    // Layout E: Standard Bullet Text Slide
    if (item.bullets.length > 0) {
      s.addText(
        item.bullets.map((b) => ({ text: b, options: { bullet: true } })),
        {
          x: 0.8,
          y: 1.6,
          w: 11.7,
          h: 5.0,
          fontSize: 16,
          color: '334155',
          fontFace: 'Segoe UI',
          lineSpacingMultiple: 1.3,
          paraSpaceAfter: 14,
        },
      );
    }
  }

  const out = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
