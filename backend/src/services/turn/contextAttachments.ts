/**
 * Context build, part 2: the attachments as the provider is sent them, hydrated, budgeted and
 * limited to the model, and the conversation's file list. Moved from `services/generation.ts`
 * unchanged but for `this` becoming `svc` (ADR-0067).
 */
import { and, eq } from 'drizzle-orm';
import { attachments, messages } from '../../db/schema.js';
import { getModelCapability } from '../../providers/capabilitiesTable.js';
import { asReadWithCode } from '../../providers/attachmentContent.js';
import type { AttachmentBlock, Turn } from '../../providers/types.js';
import type { ManifestFile } from '../attachments/manifest.js';
import type { ModelInputStore } from '../attachments/modelInputStore.js';
import { cachedPdfForModel, pdfForModel, type PdfForModel } from '../attachments/pdfPages.js';
import { enforceModelLimits } from '../attachments/modelLimits.js';
import type { TurnServices } from './services.js';
import { logger } from '../../logger.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

/** Attachments the providers receive as raw bytes rather than as extracted text. */
function sentAsBytes(att: { mimeType: string }): boolean {
  return (
    att.mimeType === 'application/pdf' ||
    att.mimeType.startsWith('image/') ||
    att.mimeType.startsWith('audio/') ||
    att.mimeType.startsWith('video/')
  );
}

/**
 * The same attachments with each rendered page image stored for the model to read by URI. New
 * objects, never the cached pages themselves: those are shared with requests to other providers.
 */
async function referencePages(atts: AttachmentBlock[], store: ModelInputStore): Promise<AttachmentBlock[]> {
  return Promise.all(
    atts.map(async (a) => {
      if (!a.pages) return a;
      const pages = await Promise.all(
        a.pages.map(async (p) =>
          p.image?.base64
            ? {
                ...p,
                image: {
                  mimeType: p.image.mimeType,
                  fileUri: await store.uriFor(Buffer.from(p.image.base64, 'base64'), p.image.mimeType),
                },
              }
            : p,
        ),
      );
      return { ...a, pages };
    }),
  );
}

/**
 * A PDF as every provider is shown it (ADR-0013): up to 100 pages, each page's image and text;
 * beyond that, its text only. No provider is handed the PDF's own bytes.
 */
async function asPdfForModel(att: AttachmentBlock, data: Buffer | PdfForModel): Promise<AttachmentBlock> {
  const pdf = Buffer.isBuffer(data) ? await pdfForModel(data, att.storageKey) : data;
  const { base64: _drop, ...rest } = att;
  if (pdf.kind === 'pages') return { ...rest, pages: pdf.pages };
  // The text read at upload (with its OCR'd pages, ADR-0063) when there is one; else poppler's.
  if (pdf.kind === 'text') return { ...rest, extractedText: att.extractedText || pdf.text, textOnlyPageCount: pdf.pageCount };
  return { ...rest, omittedReason: 'unreadable', omittedDetail: pdf.reason };
}

/**
 * With a sandbox on the turn, Office and e-book files are read from the file with code rather
 * than sent as flattened text (ADR-0045): the text loses cell addresses, formulas, hidden sheets
 * and layout. Without one, the text is all the model can read, so it stays.
 */
export function readOfficeFilesWithCode(
  sandbox: boolean,
  current: AttachmentBlock[],
  history: Turn[],
): { current: AttachmentBlock[]; history: Turn[] } {
  if (!sandbox) return { current, history };
  return {
    current: current.map(asReadWithCode),
    history: history.map((t) => (t.attachments ? { ...t, attachments: t.attachments.map(asReadWithCode) } : t)),
  };
}

/**
 * Every file of the conversation, oldest first, then any of this turn's not yet stored on a
 * message. Every file of a chat stays in reach for the whole chat: a file whose turn
 * is no longer in the history (compacted, or past the backstop) is still listed and still in
 * run_python's input/ (ADR-0019). Upload order keeps each file's input/ name stable.
 */
export async function chatFilesOf(svc: TurnServices, chatId: string, byId: Map<string, AttachmentBlock>): Promise<ManifestFile[]> {
  const stored = await svc.db
    .select({
      id: attachments.id,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
    })
    .from(attachments)
    .innerJoin(messages, eq(attachments.messageId, messages.id))
    .where(and(eq(messages.chatId, chatId), eq(attachments.status, 'ready')))
    .orderBy(attachments.createdAt, attachments.id);
  const files: ManifestFile[] = stored.map((a) => ({ ...a, filename: a.filename ?? a.id }));
  const seen = new Set(files.map((f) => f.id));
  for (const a of byId.values()) {
    if (!a.id || seen.has(a.id)) continue;
    files.push({ id: a.id, filename: a.filename ?? a.id, mimeType: a.mimeType, sizeBytes: a.sizeBytes });
  }
  return files;
}

/**
 * Hydrates raw storage bytes into base64 on-demand for binary attachments (PDF, images, media)
 * specifically for the ephemeral wire request sent to the provider.
 * Keeps conversation history in RAM free of large Base64 strings.
 */
export async function hydrateAttachmentBytes(
  svc: TurnServices,
  attachments: AttachmentBlock[] | undefined,
): Promise<AttachmentBlock[]> {
  if (!attachments || attachments.length === 0) return [];
  return Promise.all(
    attachments.map(async (att) => {
      if (sentAsBytes(att) && !att.base64 && !att.pages && att.storageKey) {
        // Pages rendered on an earlier turn are reused before the file is fetched again: the
        // stored bytes behind a key never change (audit B6).
        const rendered = att.mimeType === 'application/pdf' ? cachedPdfForModel(att.storageKey) : undefined;
        if (rendered) return asPdfForModel(att, rendered);
        let data: Buffer;
        try {
          data = await svc.storage.get(att.storageKey);
        } catch (err) {
          log.warn({ errName: err instanceof Error ? err.name : 'unknown', storageKey: att.storageKey }, 'failed to load attachment bytes for wire payload');
          return { ...att, omittedReason: 'storage_unavailable' as const };
        }
        if (att.mimeType !== 'application/pdf') return { ...att, base64: data.toString('base64') };
        try {
          return await asPdfForModel(att, data);
        } catch {
          // The bytes arrived; reading them failed. That is the file, not storage (D1 #34).
          return { ...att, omittedReason: 'unreadable' as const, omittedDetail: 'the PDF could not be rendered' };
        }
      }
      return att;
    }),
  );
}

/**
 * Hydrates attachment bytes across history turns for provider wire transmission.
 * Enforces HISTORY_MAX_ATTACHMENT_BYTES (12 MB) budget.
 * If budget is exceeded, historical identity and extracted text survive, but binary base64 is omitted.
 * Explicitly referenced attachments (by fileId or unique filename) are promoted for hydration.
 */
/**
 * G18: the selected model's limits, applied to what is about to be sent. Runs after the budget
 * reservation, so a refusal here must release it before propagating.
 */
export async function limitToModel(
  svc: TurnServices,
  alias: string,
  current: AttachmentBlock[],
  history: Turn[],
  releaseReservation: () => Promise<void>,
): Promise<{ current: AttachmentBlock[]; history: Turn[] }> {
  try {
    const spec = getModelCapability(alias);
    const limited = await enforceModelLimits(spec, current, history);
    // Gemini reads page images from Cloud Storage, keeping a large PDF out of the request
    // (ADR-0016). The Anthropic adapter on Vertex takes base64 only, so it is left as is.
    if (spec.provider !== 'google' || !svc.modelInputs) return { current, history: limited };
    const store = svc.modelInputs;
    return {
      current: await referencePages(current, store),
      history: await Promise.all(
        limited.map(async (t) => (t.attachments ? { ...t, attachments: await referencePages(t.attachments, store) } : t)),
      ),
    };
  } catch (err) {
    await releaseReservation();
    throw err;
  }
}

export async function hydrateHistoryAttachments(
  svc: TurnServices,
  turns: Turn[],
  currentPrompt: string | undefined,
  alias: string,
): Promise<Turn[]> {
  const maxBudget = svc.cfg.HISTORY_MAX_ATTACHMENT_BYTES ?? 12_000_000;
  let cumulativeBytes = 0;

  // Every earlier image of the chat stays available. The budget only guards bytes that ride inline in a request whose limit is
  // not verified: Gemini's inline data. The Anthropic adapter's request limit is verified and enforced,
  // newest first, by enforceModelLimits; a Gemini PDF with a model-input bucket goes by gs://
  // URI (ADR-0016) and adds nothing inline. Those are loaded whatever their size (ADR-0019).
  const spec = getModelCapability(alias);
  const unbudgeted = (a: AttachmentBlock): boolean =>
    spec.maxRequestBytes !== null ||
    (spec.provider === 'google' && svc.modelInputs !== undefined && a.mimeType === 'application/pdf');

  // Only files sent as bytes spend the budget; Office and text files travel as extracted text.
  const allHistoricalAtts = turns.flatMap((t) => t.attachments ?? []).filter((a) => sentAsBytes(a) && !unbudgeted(a));

  // Check for explicit promotions from currentPrompt
  const promotedAttachmentIds = new Set<string>();
  if (currentPrompt?.trim()) {
    for (const att of allHistoricalAtts) {
      if (!att.id) continue;
      // Exact fileId match
      if (currentPrompt.includes(att.id)) {
        promotedAttachmentIds.add(att.id);
      } else if (att.filename && currentPrompt.includes(att.filename)) {
        // Check if filename is unique across historical attachments
        const matching = allHistoricalAtts.filter((a) => a.filename === att.filename);
        if (matching.length === 1) {
          promotedAttachmentIds.add(att.id);
        }
        // If matching.length > 1, duplicate filename: do not auto-promote! Model must specify fileId.
      }
    }
  }

  const hydrationDecisions = new Map<string, boolean>();

  // Pass 1: Promoted attachments always hydrated first
  for (const att of allHistoricalAtts) {
    if (att.id && promotedAttachmentIds.has(att.id)) {
      const size = att.sizeBytes ?? 0;
      if (cumulativeBytes + size <= maxBudget) {
        cumulativeBytes += size;
        hydrationDecisions.set(att.id, true);
      }
    }
  }

  // Pass 2: Remaining attachments from most recent turn to oldest
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn?.attachments) continue;
    for (const att of turn.attachments) {
      if (!sentAsBytes(att) || unbudgeted(att) || !att.id || hydrationDecisions.has(att.id)) continue;
      const size = att.sizeBytes ?? 0;
      if (cumulativeBytes + size <= maxBudget) {
        cumulativeBytes += size;
        hydrationDecisions.set(att.id, true);
      } else {
        hydrationDecisions.set(att.id, false);
      }
    }
  }

  return Promise.all(
    turns.map(async (turn) => {
      if (!turn.attachments || turn.attachments.length === 0) return turn;
      const hydrated = await Promise.all(
        turn.attachments.map(async (att) => {
          if (!sentAsBytes(att)) return att;
          if (unbudgeted(att)) return (await hydrateAttachmentBytes(svc, [att]))[0] ?? att;
          const shouldHydrateBinary = att.id ? hydrationDecisions.get(att.id) ?? false : true;
          if (shouldHydrateBinary) {
            const [h] = await hydrateAttachmentBytes(svc, [att]);
            return h ?? att;
          }
          // Over budget: keep full identity and any genuine extracted text, never the bytes.
          // The adapter tells the model why and how to rehydrate it by fileId (G15).
          return {
            id: att.id,
            filename: att.filename,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes,
            storageKey: att.storageKey,
            extractedText: att.extractedText,
            omittedReason: 'history_budget' as const,
          };
        }),
      );
      return { ...turn, attachments: hydrated };
    }),
  );
}
