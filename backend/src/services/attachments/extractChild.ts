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

import { ExtractionUnsupported, extractText, readPdfLayer } from '../retrieval.js';

export interface ChildRequest {
  op: 'text' | 'pdfLayer';
  input: string;
  out: string;
  filename: string;
  mimeType: string;
  wantScreenshots?: boolean;
}

export type ChildResult =
  | { ok: true; text: string }
  | { ok: true; layer: Awaited<ReturnType<typeof readPdfLayer>> }
  | { ok: false; code: string; message: string };

async function main(): Promise<void> {
  const req = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as ChildRequest;
  let result: ChildResult;
  try {
    const data = await readFile(req.input);
    result =
      req.op === 'pdfLayer'
        ? { ok: true, layer: await readPdfLayer(data, Boolean(req.wantScreenshots)) }
        : { ok: true, text: await extractText(data, req.mimeType, req.filename) };
  } catch (err) {
    result =
      err instanceof ExtractionUnsupported
        ? { ok: false, code: err.code, message: err.message }
        : // Our own copy: the parser's message names its internals (D1 #23).
          { ok: false, code: 'corrupt', message: 'This file could not be opened. It may be damaged. Save it again and upload it.' };
  }
  await writeFile(req.out, JSON.stringify(result));
}

main().then(
  () => process.exit(0),
  () => process.exit(2),
);
