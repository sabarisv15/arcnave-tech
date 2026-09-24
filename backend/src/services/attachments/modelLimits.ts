/**
 * G18: check attachments against the *selected* model's own limits before the request is sent,
 * so an oversized file fails with a typed error instead of a provider rejection mid-turn.
 *
 * Limits come from `ModelCapabilitySpec`; a `null` limit is unverified for that model and is not
 * checked here (the provider's own error, mapped to provider_payload_limit, stays the backstop).
 * This turn's attachments over a limit fail the request: the user just chose to send them.
 * History attachments over a limit are left out with `omittedReason: 'model_limit'` instead,
 * newest kept first, so switching models never makes an old conversation unusable.
 */
import { PDFDocument } from 'pdf-lib';

import { ApiError } from '../../errors.js';
import type { ModelCapabilitySpec } from '../../providers/capabilitiesTable.js';
import type { AttachmentBlock, Turn } from '../../providers/types.js';

const isImage = (a: AttachmentBlock) => a.mimeType.startsWith('image/');
const isPdf = (a: AttachmentBlock) => a.mimeType === 'application/pdf';
const wireBytes = (a: AttachmentBlock) => (a.base64 ? Buffer.byteLength(a.base64, 'utf8') : 0);

/** Page count, or `null` when the PDF cannot be parsed here (the provider then decides). */
export async function pdfPageCount(base64: string): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(Buffer.from(base64, 'base64'), {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

function tooLarge(
  spec: ModelCapabilitySpec,
  a: AttachmentBlock,
  limit: 'image_bytes' | 'pdf_pages' | 'request_bytes',
  max: number,
  actual: number,
): ApiError {
  const what = {
    image_bytes: `is ${actual} bytes encoded; ${spec.alias} accepts at most ${max} per image`,
    pdf_pages: `brings this request to ${actual} PDF pages; ${spec.alias} accepts at most ${max} per request`,
    request_bytes: `brings this request to ${actual} bytes of attachments; ${spec.alias} accepts at most ${max} per request`,
  }[limit];
  return new ApiError('provider_payload_limit', {
    detail: `"${a.filename ?? 'Attachment'}" ${what}. Send a smaller file, fewer pages, or choose another model.`,
    meta: { fileId: a.id, filename: a.filename, limit, max, actual, model: spec.alias },
  });
}

export async function enforceModelLimits(
  spec: ModelCapabilitySpec,
  current: AttachmentBlock[],
  history: Turn[],
): Promise<Turn[]> {
  const sent = (a: AttachmentBlock) => Boolean(a.base64);
  let pages = 0;
  let bytes = 0;

  // This turn: every limit is a hard stop.
  for (const a of current.filter(sent)) {
    if (spec.supportsVision && isImage(a) && wireBytes(a) > spec.maxEncodedImageBytes) {
      throw tooLarge(spec, a, 'image_bytes', spec.maxEncodedImageBytes, wireBytes(a));
    }
    if (spec.maxPdfPagesPerRequest !== null && isPdf(a)) {
      pages += (await pdfPageCount(a.base64!)) ?? 0;
      if (pages > spec.maxPdfPagesPerRequest) throw tooLarge(spec, a, 'pdf_pages', spec.maxPdfPagesPerRequest, pages);
    }
    bytes += wireBytes(a);
    if (spec.maxRequestBytes !== null && bytes > spec.maxRequestBytes) {
      throw tooLarge(spec, a, 'request_bytes', spec.maxRequestBytes, bytes);
    }
  }

  // History: newest first, keep what still fits, describe the rest.
  const omitted = new Set<AttachmentBlock>();
  for (let t = history.length - 1; t >= 0; t -= 1) {
    for (const a of (history[t]!.attachments ?? []).filter(sent)) {
      if (spec.supportsVision && isImage(a) && wireBytes(a) > spec.maxEncodedImageBytes) {
        omitted.add(a);
        continue;
      }
      const addPages = spec.maxPdfPagesPerRequest !== null && isPdf(a) ? ((await pdfPageCount(a.base64!)) ?? 0) : 0;
      const overPages = spec.maxPdfPagesPerRequest !== null && pages + addPages > spec.maxPdfPagesPerRequest;
      const overBytes = spec.maxRequestBytes !== null && bytes + wireBytes(a) > spec.maxRequestBytes;
      if (overPages || overBytes) {
        omitted.add(a);
        continue;
      }
      pages += addPages;
      bytes += wireBytes(a);
    }
  }
  if (omitted.size === 0) return history;

  return history.map((turn) =>
    turn.attachments?.some((a) => omitted.has(a))
      ? {
          ...turn,
          attachments: turn.attachments.map((a) => {
            if (!omitted.has(a)) return a;
            const { base64: _dropped, ...rest } = a;
            return { ...rest, omittedReason: 'model_limit' as const };
          }),
        }
      : turn,
  );
}
