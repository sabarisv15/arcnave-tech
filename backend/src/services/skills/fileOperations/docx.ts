import JSZip from 'jszip';

export interface DocxInspectResult {
  paragraphsCount: number;
  tablesCount: number;
  headings: string[];
}

/**
 * DOCX Skill operations: inspect document structure, targeted text replacement, and appending content.
 * Preserves the original OOXML package structure, styles, headers, and media relationships.
 */
export async function inspectDocxStructure(inputBuffer: Buffer): Promise<DocxInspectResult> {
  const zip = await JSZip.loadAsync(inputBuffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Invalid DOCX package: missing word/document.xml');
  }

  const xmlText = await docXmlFile.async('text');

  // Count paragraphs <w:p>
  const paragraphsCount = (xmlText.match(/<w:p(?:\s|>)/g) || []).length;
  // Count tables <w:tbl>
  const tablesCount = (xmlText.match(/<w:tbl(?:\s|>)/g) || []).length;

  // Extract headings
  const headings: string[] = [];
  const headingRegex = /<w:pStyle\s+w:val="Heading(\d+)"[^>]*>[\s\S]*?<w:t[^>]*>([^<]+)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(xmlText)) !== null) {
    headings.push(match[2]!);
  }

  // If no formal Heading style tags found, inspect first few paragraph texts
  if (headings.length === 0) {
    const textRegex = /<w:t[^>]*>([^<]+)<\/w:t>/g;
    let tMatch: RegExpExecArray | null;
    let count = 0;
    while ((tMatch = textRegex.exec(xmlText)) !== null && count < 3) {
      if (tMatch[1]!.trim().length > 3) {
        headings.push(tMatch[1]!.trim());
        count++;
      }
    }
  }

  return {
    paragraphsCount,
    tablesCount,
    headings,
  };
}

export interface DocxEditResult {
  buffer: Buffer;
  replacementsApplied: number;
}

export async function editDocxContentWithReport(
  inputBuffer: Buffer,
  replacements: Array<{ search: string; replace: string }>,
): Promise<DocxEditResult> {
  const zip = await JSZip.loadAsync(inputBuffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Invalid DOCX package: missing word/document.xml');
  }

  let xmlText = await docXmlFile.async('text');
  let replacementsApplied = 0;

  for (const { search, replace } of replacements) {
    // Escape XML special characters in replacement text
    const escapedReplace = replace
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const parts = xmlText.split(search);
    const count = parts.length - 1;
    replacementsApplied += count;
    xmlText = parts.join(escapedReplace);
  }

  zip.file('word/document.xml', xmlText);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return { buffer, replacementsApplied };
}

export async function editDocxContent(
  inputBuffer: Buffer,
  replacements: Array<{ search: string; replace: string }>,
): Promise<Buffer> {
  const res = await editDocxContentWithReport(inputBuffer, replacements);
  return res.buffer;
}

export interface DocxAppendResult {
  buffer: Buffer;
  headingAppended: string;
  paragraphsAppended: number;
}

export async function appendDocxSectionWithReport(
  inputBuffer: Buffer,
  heading: string,
  paragraphs: string[],
): Promise<DocxAppendResult> {
  const zip = await JSZip.loadAsync(inputBuffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Invalid DOCX package: missing word/document.xml');
  }

  let xmlText = await docXmlFile.async('text');

  const escapeXml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const headingXml = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(heading)}</w:t></w:r></w:p>`;
  const parasXml = paragraphs
    .map((p) => `<w:p><w:r><w:t>${escapeXml(p)}</w:t></w:r></w:p>`)
    .join('');

  const injection = headingXml + parasXml;

  // Insert before </w:body>
  if (xmlText.includes('</w:body>')) {
    xmlText = xmlText.replace('</w:body>', `${injection}</w:body>`);
  } else {
    xmlText += injection;
  }

  zip.file('word/document.xml', xmlText);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return {
    buffer,
    headingAppended: heading,
    paragraphsAppended: paragraphs.length,
  };
}

export async function appendDocxSection(
  inputBuffer: Buffer,
  heading: string,
  paragraphs: string[],
): Promise<Buffer> {
  const res = await appendDocxSectionWithReport(inputBuffer, heading, paragraphs);
  return res.buffer;
}

