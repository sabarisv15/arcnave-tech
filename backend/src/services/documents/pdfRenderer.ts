/**
 * Format-native PDF deliverable renderer.
 * Produces multi-page PDFs using pdf-lib and fontkit, featuring embedded Unicode fonts
 * (native ₹, smart quotes, accented characters), embedded images, cross-page table pagination
 * with repeating headers, callouts, and running Page X of Y footers.
 */

import fs from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { resolveArtifactImage } from './images.js';
import type { DocumentBlock, DocumentSpec } from './types.js';

// Candidate system font paths
const CANDIDATE_FONT_PATHS = [
  // Windows
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
  // Linux
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
];

const CANDIDATE_BOLD_PATHS = [
  'C:/Windows/Fonts/arialbd.ttf',
  'C:/Windows/Fonts/segoeuib.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
];

function findAvailableFontFile(paths: string[]): Buffer | null {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    } catch {
      // benign: Continue to next path
    }
  }
  return null;
}

export async function renderPdf(spec: DocumentSpec): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Attempt to load embedded TrueType Unicode font
  let font = null;
  let boldFont = null;
  let hasUnicodeFont = false;

  const fontBytes = findAvailableFontFile(CANDIDATE_FONT_PATHS);
  const boldBytes = findAvailableFontFile(CANDIDATE_BOLD_PATHS);

  if (fontBytes) {
    try {
      font = await pdfDoc.embedFont(fontBytes, { subset: true });
      hasUnicodeFont = true;
    } catch {
      // benign: no Unicode font: the standard font is used and hasUnicodeFont stays false
      font = null;
    }
  }

  if (boldBytes) {
    try {
      boldFont = await pdfDoc.embedFont(boldBytes, { subset: true });
    } catch {
      // benign: no bold font: bold text uses the regular font
      boldFont = null;
    }
  }

  // Fallback to standard 14 WinAnsi fonts if no TTF font is available
  if (!font) {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }
  if (!boldFont) {
    boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  const pageWidth = 595.28; // Standard A4 points (8.27 in)
  const pageHeight = 841.89; // Standard A4 points (11.69 in)
  const margin = 54; // 0.75 in margin
  const usableWidth = pageWidth - margin * 2;

  let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin - 20;

  // Last-resort fallback sanitizer if non-Unicode WinAnsi font is active
  const sanitizeText = (text: string): string => {
    if (hasUnicodeFont) {
      return text;
    }
    return text
      .replace(/₹/g, 'Rs. ')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      // eslint-disable-next-line no-control-regex -- the class is "not ASCII", for the standard PDF font
      .replace(/[^\x00-\x7F]/g, '?');
  };

  const ensureSpace = (neededHeight: number): void => {
    if (y - neededHeight < margin + 40) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin - 20;
    }
  };

  const wrapText = (text: string, maxWidth: number, fontSize: number, activeFont: typeof font): string[] => {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      try {
        const width = activeFont.widthOfTextAtSize(sanitizeText(candidate), fontSize);
        if (width <= maxWidth) {
          currentLine = candidate;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      } catch {
        // benign: In case of width measurement anomaly, wrap by character count
        if (candidate.length > 60) {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = candidate;
        }
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
  };

  for (const block of spec.blocks) {
    if (block.type === 'pagebreak') {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin - 20;
      continue;
    }

    if (block.type === 'heading') {
      const size = block.level === 1 ? 20 : block.level === 2 ? 15 : 12;
      const leading = size + 6;
      ensureSpace(leading + 14);

      const lines = wrapText(block.text, usableWidth, size, boldFont);
      for (const line of lines) {
        ensureSpace(leading);
        currentPage.drawText(sanitizeText(line), {
          x: margin,
          y,
          size,
          font: boldFont,
          color: rgb(0.06, 0.09, 0.16),
        });
        y -= leading;
      }
      y -= 8;
      continue;
    }

    if (block.type === 'image') {
      const img = await resolveArtifactImage(block.src);
      if (img) {
        const maxImgWidth = usableWidth;
        const maxImgHeight = 300;
        let w = img.width;
        let h = img.height;
        if (w > maxImgWidth) {
          const scale = maxImgWidth / w;
          w = maxImgWidth;
          h = Math.round(h * scale);
        }
        if (h > maxImgHeight) {
          const scale = maxImgHeight / h;
          h = maxImgHeight;
          w = Math.round(w * scale);
        }

        ensureSpace(h + 20);
        try {
          const embedded = img.mime === 'image/jpeg'
            ? await pdfDoc.embedJpg(img.buffer)
            : await pdfDoc.embedPng(img.buffer);
          currentPage.drawImage(embedded, {
            x: margin + (usableWidth - w) / 2,
            y: y - h,
            width: w,
            height: h,
          });
          y -= h + 16;
        } catch {
          // benign: If image embedding encounters format incompatibility, render text placeholder
          currentPage.drawText(`[Image: ${block.alt}]`, {
            x: margin,
            y,
            size: 10,
            font,
            color: rgb(0.4, 0.45, 0.53),
          });
          y -= 18;
        }
      }
      continue;
    }

    if (block.type === 'paragraph' || block.type === 'bullet') {
      const size = 10;
      const leading = 14;
      const indent = block.type === 'bullet' ? 18 * ((block.level ?? 0) + 1) : 0;
      const available = usableWidth - indent;

      // Extract hyperlink formatting if present [text](url)
      const cleanLine = block.type === 'bullet' ? `•  ${block.text}` : block.text;
      const lines = wrapText(cleanLine, available, size, font);

      for (const line of lines) {
        ensureSpace(leading);
        currentPage.drawText(sanitizeText(line), {
          x: margin + indent,
          y,
          size,
          font,
          color: rgb(0.2, 0.25, 0.33),
        });
        y -= leading;
      }
      y -= 6;
      continue;
    }

    if (block.type === 'callout') {
      const size = 9.5;
      const leading = 13;
      const lines = wrapText(block.text, usableWidth - 28, size, font);
      const boxHeight = lines.length * leading + 14;
      ensureSpace(boxHeight + 8);

      // Callout background
      currentPage.drawRectangle({
        x: margin,
        y: y - boxHeight + 8,
        width: usableWidth,
        height: boxHeight,
        color: rgb(0.97, 0.98, 0.99),
        borderColor: rgb(0.89, 0.92, 0.96),
        borderWidth: 1,
      });

      // Left blue accent bar
      currentPage.drawRectangle({
        x: margin,
        y: y - boxHeight + 8,
        width: 3.5,
        height: boxHeight,
        color: rgb(0.14, 0.38, 0.92),
      });

      let textY = y - 4;
      for (const line of lines) {
        currentPage.drawText(sanitizeText(line), {
          x: margin + 14,
          y: textY,
          size,
          font,
          color: rgb(0.2, 0.25, 0.33),
        });
        textY -= leading;
      }
      y -= boxHeight + 10;
      continue;
    }

    if (block.type === 'table') {
      const cols = block.header.length || 1;
      const colWidth = usableWidth / cols;
      const rowHeight = 18;

      const drawTableHeader = (): void => {
        currentPage.drawRectangle({
          x: margin,
          y: y - rowHeight + 4,
          width: usableWidth,
          height: rowHeight,
          color: rgb(0.94, 0.96, 0.98),
          borderColor: rgb(0.8, 0.84, 0.88),
          borderWidth: 0.5,
        });

        block.header.forEach((h, colIdx) => {
          const truncated = wrapText(h, colWidth - 8, 9, boldFont)[0] || '';
          currentPage.drawText(sanitizeText(truncated), {
            x: margin + colIdx * colWidth + 5,
            y: y - 1,
            size: 9,
            font: boldFont,
            color: rgb(0.06, 0.09, 0.16),
          });
        });
        y -= rowHeight;
      };

      ensureSpace(rowHeight * 2 + 10);
      drawTableHeader();

      // Render table rows with cross-page pagination & repeated header
      for (let r = 0; r < block.rows.length; r++) {
        const row = block.rows[r]!;
        if (y - rowHeight < margin + 40) {
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin - 20;
          drawTableHeader();
        }

        const isZebra = r % 2 === 1;
        if (isZebra) {
          currentPage.drawRectangle({
            x: margin,
            y: y - rowHeight + 4,
            width: usableWidth,
            height: rowHeight,
            color: rgb(0.98, 0.99, 1.0),
          });
        }

        // Horizontal bottom row divider
        currentPage.drawLine({
          start: { x: margin, y: y - rowHeight + 4 },
          end: { x: margin + usableWidth, y: y - rowHeight + 4 },
          thickness: 0.5,
          color: rgb(0.88, 0.91, 0.94),
        });

        row.forEach((cell, colIdx) => {
          const truncated = wrapText(cell, colWidth - 8, 8.5, font)[0] || '';
          currentPage.drawText(sanitizeText(truncated), {
            x: margin + colIdx * colWidth + 5,
            y: y - 1,
            size: 8.5,
            font,
            color: rgb(0.2, 0.25, 0.33),
          });
        });
        y -= rowHeight;
      }
      y -= 10;
    }
  }

  // Second pass: Add running headers on page 2+ and footers with "Page X of Y" on all pages
  const totalPages = pdfDoc.getPageCount();
  for (let p = 0; p < totalPages; p++) {
    const page = pdfDoc.getPage(p);

    // Running Header (page 2+)
    if (p > 0) {
      page.drawText(sanitizeText(spec.title || 'ArcNave Document'), {
        x: margin,
        y: pageHeight - 34,
        size: 8,
        font,
        color: rgb(0.6, 0.65, 0.72),
      });
      page.drawLine({
        start: { x: margin, y: pageHeight - 40 },
        end: { x: pageWidth - margin, y: pageHeight - 40 },
        thickness: 0.5,
        color: rgb(0.88, 0.91, 0.94),
      });
    }

    // Running Footer
    const footerText = `Page ${p + 1} of ${totalPages}`;
    const footerWidth = font.widthOfTextAtSize(footerText, 8.5);
    page.drawText(footerText, {
      x: pageWidth - margin - footerWidth,
      y: margin - 20,
      size: 8.5,
      font,
      color: rgb(0.47, 0.54, 0.63),
    });

    page.drawLine({
      start: { x: margin, y: margin - 8 },
      end: { x: pageWidth - margin, y: margin - 8 },
      thickness: 0.5,
      color: rgb(0.88, 0.91, 0.94),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
