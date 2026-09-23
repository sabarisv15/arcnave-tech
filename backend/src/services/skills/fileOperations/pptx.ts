import JSZip from 'jszip';

export interface PptxInspectResult {
  slideCount: number;
  titles: string[];
}

/**
 * PPTX Skill operations: inspect slide structure, reorder slides, and targeted slide text edits.
 * Preserves the original presentation layouts, master slides, animations, themes, and shapes.
 */
export async function inspectPptxStructure(inputBuffer: Buffer): Promise<PptxInspectResult> {
  const zip = await JSZip.loadAsync(inputBuffer);
  const presXmlFile = zip.file('ppt/presentation.xml');
  if (!presXmlFile) {
    throw new Error('Invalid PPTX package: missing ppt/presentation.xml');
  }

  const xmlText = await presXmlFile.async('text');

  // Count slides in <p:sldIdLst>
  const sldIdMatches = xmlText.match(/<p:sldId\b[^>]*>/g) || [];
  const slideCount = sldIdMatches.length;

  const titles: string[] = [];
  // Inspect individual slide files for title text
  for (let i = 1; i <= Math.max(slideCount, 20); i++) {
    const slideFile = zip.file(`ppt/slides/slide${i}.xml`);
    if (slideFile) {
      const slideXml = await slideFile.async('text');
      // Look for first title run in slide
      const textMatches = slideXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
      if (textMatches && textMatches.length > 0) {
        const firstText = textMatches[0]!.replace(/<\/?a:t[^>]*>/g, '').trim();
        titles.push(firstText || `Slide ${i}`);
      } else {
        titles.push(`Slide ${i}`);
      }
    }
  }

  return {
    slideCount: titles.length,
    titles,
  };
}

/**
 * Reorders slides in a PPTX deck by rearranging <p:sldId> nodes in ppt/presentation.xml.
 * Preserves all underlying slide files, layouts, and formatting intact.
 */
export interface PptxReorderResult {
  buffer: Buffer;
  originalSlideCount: number;
  finalSlideCount: number;
  newOrder: number[];
}

export async function reorderPptxSlidesWithReport(
  inputBuffer: Buffer,
  newOrder1Indexed: number[],
): Promise<PptxReorderResult> {
  const zip = await JSZip.loadAsync(inputBuffer);
  const presXmlFile = zip.file('ppt/presentation.xml');
  if (!presXmlFile) {
    throw new Error('Invalid PPTX package: missing ppt/presentation.xml');
  }

  let presXml = await presXmlFile.async('text');

  const sldIdListMatch = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(presXml);
  if (!sldIdListMatch) {
    throw new Error('No <p:sldIdLst> slide list found in presentation.xml.');
  }

  const sldIdEntries = sldIdListMatch[1]!.match(/<p:sldId\b[^>]*\/>/g) || [];
  if (sldIdEntries.length === 0) {
    return {
      buffer: inputBuffer,
      originalSlideCount: 0,
      finalSlideCount: 0,
      newOrder: newOrder1Indexed,
    };
  }

  const reorderedEntries: string[] = [];
  for (const idx of newOrder1Indexed) {
    if (idx < 1 || idx > sldIdEntries.length) {
      throw new Error(`Invalid slide index ${idx} for deck with ${sldIdEntries.length} slides.`);
    }
    reorderedEntries.push(sldIdEntries[idx - 1]!);
  }

  // Append any slides that were not included in newOrder to ensure zero lost slides
  sldIdEntries.forEach((entry, idx) => {
    if (!newOrder1Indexed.includes(idx + 1)) {
      reorderedEntries.push(entry);
    }
  });

  const newSldIdList = `<p:sldIdLst>${reorderedEntries.join('')}</p:sldIdLst>`;
  presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, newSldIdList);

  zip.file('ppt/presentation.xml', presXml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return {
    buffer,
    originalSlideCount: sldIdEntries.length,
    finalSlideCount: reorderedEntries.length,
    newOrder: newOrder1Indexed,
  };
}

export async function reorderPptxSlides(
  inputBuffer: Buffer,
  newOrder1Indexed: number[],
): Promise<Buffer> {
  const res = await reorderPptxSlidesWithReport(inputBuffer, newOrder1Indexed);
  return res.buffer;
}

export interface PptxEditResult {
  buffer: Buffer;
  replacementsApplied: number;
}

/**
 * Performs targeted text replacement on a specific slide while preserving the rest of the presentation.
 */
export async function editPptxSlideTextWithReport(
  inputBuffer: Buffer,
  slideIndex1Indexed: number,
  replacements: Array<{ search: string; replace: string }>,
): Promise<PptxEditResult> {
  const zip = await JSZip.loadAsync(inputBuffer);
  const slidePath = `ppt/slides/slide${slideIndex1Indexed}.xml`;
  const slideFile = zip.file(slidePath);
  if (!slideFile) {
    throw new Error(`Slide file ${slidePath} not found in PPTX package.`);
  }

  let slideXml = await slideFile.async('text');
  let replacementsApplied = 0;

  for (const { search, replace } of replacements) {
    const escapedReplace = replace
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const parts = slideXml.split(search);
    const count = parts.length - 1;
    replacementsApplied += count;
    slideXml = parts.join(escapedReplace);
  }

  zip.file(slidePath, slideXml);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { buffer, replacementsApplied };
}

export async function editPptxSlideText(
  inputBuffer: Buffer,
  slideIndex1Indexed: number,
  replacements: Array<{ search: string; replace: string }>,
): Promise<Buffer> {
  const res = await editPptxSlideTextWithReport(inputBuffer, slideIndex1Indexed, replacements);
  return res.buffer;
}

