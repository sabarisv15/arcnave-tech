import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../../errors.js';
import { getModelCapability, type ModelCapabilitySpec } from '../../providers/capabilitiesTable.js';
import type { AttachmentBlock, Turn } from '../../providers/types.js';
import { enforceModelLimits, pdfPageCount } from './modelLimits.js';

async function pdf(pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage();
  return Buffer.from(await doc.save()).toString('base64');
}

const spec = (over: Partial<ModelCapabilitySpec>): ModelCapabilitySpec => ({
  ...getModelCapability('Opus 5.5'),
  ...over,
});

async function limitError(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe('enforceModelLimits (G18)', () => {
  it('counts PDF pages', async () => {
    expect(await pdfPageCount(await pdf(3))).toBe(3);
    expect(await pdfPageCount(Buffer.from('not a pdf').toString('base64'))).toBeNull();
  });

  it('refuses this turn\'s PDF over the selected model\'s page limit, with a typed error', async () => {
    const current: AttachmentBlock[] = [{ id: 'f1', filename: 'big.pdf', mimeType: 'application/pdf', base64: await pdf(3) }];
    const err = await limitError(enforceModelLimits(spec({ maxPdfPagesPerRequest: 2 }), current, []));
    expect(err.code).toBe('provider_payload_limit');
    expect(err.meta).toMatchObject({ fileId: 'f1', limit: 'pdf_pages', max: 2, actual: 3, model: 'Opus 5.5' });
  });

  it('refuses this turn\'s image over the per-image limit', async () => {
    const current: AttachmentBlock[] = [{ id: 'i1', filename: 'x.png', mimeType: 'image/png', base64: 'A'.repeat(11) }];
    const err = await limitError(enforceModelLimits(spec({ maxEncodedImageBytes: 10 }), current, []));
    expect(err.meta).toMatchObject({ limit: 'image_bytes', max: 10, actual: 11 });
  });

  it('leaves out history that would overflow, newest kept, never failing the turn', async () => {
    const old: AttachmentBlock = { id: 'old', filename: 'a.pdf', mimeType: 'application/pdf', base64: await pdf(2) };
    const recent: AttachmentBlock = { id: 'new', filename: 'b.pdf', mimeType: 'application/pdf', base64: await pdf(2) };
    const history: Turn[] = [
      { role: 'user', text: 'first', attachments: [old] },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: 'second', attachments: [recent] },
    ];
    const out = await enforceModelLimits(spec({ maxPdfPagesPerRequest: 3 }), [], history);
    expect(out[0]!.attachments![0]).toMatchObject({ id: 'old', omittedReason: 'model_limit' });
    expect(out[0]!.attachments![0]!.base64).toBeUndefined();
    expect(out[2]!.attachments![0]).toBe(recent);
  });

  it('applies the request byte limit to this turn and history together', async () => {
    const current: AttachmentBlock[] = [{ id: 'c', filename: 'c.png', mimeType: 'image/png', base64: 'A'.repeat(60) }];
    const history: Turn[] = [{ role: 'user', text: 'h', attachments: [{ id: 'h', filename: 'h.png', mimeType: 'image/png', base64: 'B'.repeat(60) }] }];
    const out = await enforceModelLimits(spec({ maxRequestBytes: 100 }), current, history);
    expect(out[0]!.attachments![0]).toMatchObject({ id: 'h', omittedReason: 'model_limit' });
  });

  it('is model-specific: the same 601-page PDF fails on Claude and is not checked on Gemini', async () => {
    const current: AttachmentBlock[] = [{ id: 'p', filename: 'long.pdf', mimeType: 'application/pdf', base64: await pdf(601) }];
    const err = await limitError(enforceModelLimits(getModelCapability('Opus 5.5'), current, []));
    expect(err.meta).toMatchObject({ limit: 'pdf_pages', max: 600, actual: 601 });
    await expect(enforceModelLimits(getModelCapability('Gemini 3.8 Flash'), current, [])).resolves.toEqual([]);
  });
});

describe('enforceModelLimits with a PDF sent as page images (ADR-0013)', () => {
  const page = (num: number, bytes: number) => ({
    num,
    text: `page ${String(num)}`,
    image: { mimeType: 'image/jpeg' as const, base64: 'A'.repeat(bytes) },
  });
  const asPages = (id: string, pages: ReturnType<typeof page>[]): AttachmentBlock => ({
    id,
    filename: `${id}.pdf`,
    mimeType: 'application/pdf',
    pages,
  });

  it('checks each page image against the per-image limit', async () => {
    const err = await limitError(
      enforceModelLimits(spec({ maxEncodedImageBytes: 100 }), [asPages('a', [page(1, 50), page(2, 150)])], []),
    );
    expect(err.meta).toMatchObject({ limit: 'image_bytes', actual: 150 });
  });

  it('counts all page images toward the request limit, and pages toward the page limit', async () => {
    const bytes = await limitError(
      enforceModelLimits(spec({ maxRequestBytes: 250 }), [asPages('a', [page(1, 100), page(2, 100), page(3, 100)])], []),
    );
    expect(bytes.meta).toMatchObject({ limit: 'request_bytes', actual: 300 });
    const pages = await limitError(
      enforceModelLimits(spec({ maxPdfPagesPerRequest: 2 }), [asPages('a', [page(1, 1), page(2, 1), page(3, 1)])], []),
    );
    expect(pages.meta).toMatchObject({ limit: 'pdf_pages', actual: 3 });
  });

  it('drops the images of an earlier PDF that no longer fit, and keeps its page text', async () => {
    const old = asPages('old', [page(1, 200)]);
    const history: Turn[] = [{ role: 'user', text: 'earlier', attachments: [old] }];
    const out = await enforceModelLimits(spec({ maxRequestBytes: 100 }), [], history);
    const kept = out[0]!.attachments![0]!;
    expect(kept.pages).toBeUndefined();
    expect(kept).toMatchObject({ omittedReason: 'model_limit', extractedText: '--- Page 1 ---\npage 1' });
  });
});
