/**
 * The isolated extractor's child process (Stage 9 ISOLATION / G6, D1 #7). Started by
 * `isolatedExtract.ts` with a V8 heap limit, a wall-clock limit and an environment holding no
 * secret; it parses one untrusted file and exits. A parser that runs out of memory or loops
 * takes this process down, never the API.
 *
 * Protocol: argv[2] is a JSON request file; the result is written as JSON to the request's
 * `out` path (a file, not stdout, so a large text never has to pass through a pipe buffer).
 */
import { readFile, writeFile } from 'node:fs/promises';

import { ExtractionUnsupported, extractText } from '../retrieval.js';
import { deriveDocx, derivePptx, deriveXlsx, inspectPdf, normaliseImage, type DerivedBody, type NormalisedImage, type PdfInspection } from './derive.js';

export interface ChildRequest {
  op: 'text' | 'derive' | 'pdfInspect' | 'image';
  input: string;
  out: string;
  filename: string;
  mimeType: string;
  /** pdfInspect: where the stripped copy goes; image: where the normalised copy goes. */
  output?: string;
  image?: { maxEdge: number; maxBytes: number; maxPixels: number };
}

export type ChildResult =
  | { ok: true; text: string }
  | { ok: true; derived: DerivedBody }
  | { ok: true; pdf: PdfInspection }
  | { ok: true; image: NormalisedImage }
  | { ok: false; code: string; message: string };

const DERIVERS: Record<string, (data: Buffer, filename: string, mimeType: string) => DerivedBody | Promise<DerivedBody>> = {
  xlsx: (d) => deriveXlsx(d),
  pptx: (d) => derivePptx(d),
  docx: (d, f, m) => deriveDocx(d, f, m),
};

/** Which builder a parsed document gets; others are Markdown from the shared parser. */
export function deriverFor(filename: string, mimeType: string): 'xlsx' | 'pptx' | 'docx' | 'document' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || mimeType.includes('spreadsheetml') || mimeType === 'application/vnd.ms-excel') return 'xlsx';
  if (lower.endsWith('.pptx') || mimeType.includes('presentationml')) return 'pptx';
  if (lower.endsWith('.docx') || mimeType.includes('wordprocessingml')) return 'docx';
  return 'document';
}

async function derive(data: Buffer, filename: string, mimeType: string): Promise<DerivedBody> {
  const which = deriverFor(filename, mimeType);
  const builder = DERIVERS[which];
  if (builder) {
    const body = await builder(data, filename, mimeType);
    if (body.markdown.trim() === '') throw new ExtractionUnsupported('This file contains no extractable text.');
    return body;
  }
  // ODT, RTF, EPUB: the shared parser's Markdown, one section.
  const markdown = await extractText(data, mimeType, filename);
  return { kind: 'document', markdown, units: [{ kind: 'section', label: 'Document', text: markdown, source: 'parsed' }], sidecar: {}, warnings: [] };
}

async function main(): Promise<void> {
  const req = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as ChildRequest;
  let result: ChildResult;
  try {
    if (req.op === 'pdfInspect') {
      result = { ok: true, pdf: await inspectPdf(req.input, req.output!) };
    } else if (req.op === 'image') {
      result = { ok: true, image: await normaliseImage(req.input, req.mimeType, req.output!, req.image!) };
    } else {
      const data = await readFile(req.input);
      result =
        req.op === 'derive'
          ? { ok: true, derived: await derive(data, req.filename, req.mimeType) }
          : { ok: true, text: await extractText(data, req.mimeType, req.filename) };
    }
  } catch (err) {
    result =
      err instanceof ExtractionUnsupported
        ? { ok: false, code: err.code, message: err.message }
        : // Our own copy: the parser's message names its internals (D1 #23).
          { ok: false, code: 'corrupt', message: 'This file could not be opened. It may be damaged. Save it again and upload it.' };
  }
  await writeFile(req.out, JSON.stringify(result));
}

// Only when run as the child, not when a test imports `deriverFor`.
if (process.argv[1] && /extractChild\.(ts|js)$/.test(process.argv[1])) {
  main().then(
    () => process.exit(0),
    () => process.exit(2),
  );
}
