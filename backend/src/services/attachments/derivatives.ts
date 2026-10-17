/**
 * Storing what the pipeline made of a file, and reading it back for a turn (Stage 9 NORM /
 * TOKENS / CHUNK, D1 #9, #10, G3; P12, ADR-0063).
 *
 * - The Markdown goes to object storage under its own key (TC1), never only in a row.
 * - Token counts come from the providers' count APIs, per model family, at ingest. A file with
 *   no count (too large to send to a count API, the API failed, no text) is stored with
 *   `tokens: null, exact: false` and is never sent whole (Invariant 3: no estimator).
 * - Chunks are ~N-14 tokens with ~15 % overlap. "Tokens" is turned into characters with this
 *   file's own count (its characters per token, as the count API measured them); a file with
 *   no count is chunked by the old character size and says so in its sidecar.
 */
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { and, eq, inArray } from 'drizzle-orm';

import type { Config } from '../../config.js';
import { NUMBERS } from '../../config/numbers.js';
import type { Database } from '../../db/client.js';
import { derivativeChunks, fileDerivativePages, fileDerivatives, type FileWarning, type TokenCount } from '../../db/schema.js';
import type { Provider } from '../../providers/types.js';
import { CHUNK_TARGET_CHARS, chunkText } from '../retrieval.js';
import { generateStorageKey, type ObjectStorage } from '../storage.js';
import { EXTRACTOR_VERSION, type Unit } from './derive.js';
import { warning } from './fileErrors.js';
import type { DerivativeDraft } from './pipeline.js';

export type ModelFamily = 'gemini' | 'claude';
export const FAMILIES: readonly ModelFamily[] = ['gemini', 'claude'];

export type TokenCounters = Partial<Record<ModelFamily, Provider>>;

type DerivativeRow = typeof fileDerivatives.$inferSelect;

/* ------------------------------------------------------------------ tokens */

const COUNT_TIMEOUT_MS = 30_000;

/** One count per family from its provider's count API, or null with the reason. */
export async function countTokens(text: string | null, chars: number, counters: TokenCounters, cfg: Config): Promise<Record<ModelFamily, TokenCount>> {
  const out = {} as Record<ModelFamily, TokenCount>;
  await Promise.all(
    FAMILIES.map(async (family) => {
      const provider = counters[family];
      if (!provider?.countTokens) {
        out[family] = { tokens: null, exact: false, model: '', reason: 'unavailable' };
        return;
      }
      if (chars === 0 || text === null || text.trim() === '') {
        out[family] = { tokens: null, exact: false, model: '', reason: chars === 0 ? 'no_text' : 'too_large' };
        return;
      }
      if (chars > cfg.TOKEN_COUNT_MAX_CHARS) {
        out[family] = { tokens: null, exact: false, model: '', reason: 'too_large' };
        return;
      }
      try {
        const r = await provider.countTokens(text, AbortSignal.timeout(COUNT_TIMEOUT_MS));
        out[family] = { tokens: r.tokens, exact: true, model: r.model };
      } catch {
        // benign: no count is recorded as reason "unavailable" (exact: false), never estimated
        out[family] = { tokens: null, exact: false, model: '', reason: 'unavailable' };
      }
    }),
  );
  return out;
}

/** Whether this family may receive the file whole (N-05); a missing count never may. */
export function fitsWhole(counts: Record<string, TokenCount> | undefined, family: ModelFamily): boolean {
  const c = counts?.[family];
  return Boolean(c && c.exact && c.tokens !== null && c.tokens <= NUMBERS.WHOLE_FILE_MAX_TOKENS.value); // N-05
}

/* ------------------------------------------------------------------ chunks */

export interface ChunkRow {
  text: string;
  page: number | null;
  locator: string;
}

export interface ChunkPlan {
  chunks: ChunkRow[];
  targetChars: number;
  /** `tokens` when sized from this file's own count, `chars` when it had none. */
  sizedBy: 'tokens' | 'chars';
  capped: boolean;
}

/** Characters per chunk: N-14 tokens at this file's measured characters per token. */
export function chunkSize(counts: Record<string, TokenCount> | undefined, chars: number): { target: number; overlap: number; sizedBy: 'tokens' | 'chars' } {
  const c = counts?.['gemini']?.exact ? counts['gemini'] : counts?.['claude']?.exact ? counts['claude'] : undefined;
  const pct = NUMBERS.CHUNK_OVERLAP_PERCENT.value / 100; // N-14
  if (c && c.tokens && c.tokens > 0 && chars > 0) {
    const target = Math.max(200, Math.round((NUMBERS.CHUNK_TARGET_TOKENS.value * chars) / c.tokens)); // N-14
    return { target, overlap: Math.round(target * pct), sizedBy: 'tokens' };
  }
  return { target: CHUNK_TARGET_CHARS, overlap: Math.round(CHUNK_TARGET_CHARS * pct), sizedBy: 'chars' };
}

/**
 * Line-aware chunks for tables and plain text: whole lines, ~`target` characters, the last
 * ~`overlap` characters' lines repeated, and `header` (a CSV's or a sheet table's header lines)
 * repeated at the top of every chunk after the first (Stage 9 CHUNK "table header repeat").
 */
export function chunkLines(text: string, target: number, overlap: number, header = ''): Array<{ text: string; first: number; last: number }> {
  const lines = text.split(/\r?\n/);
  const out: Array<{ text: string; first: number; last: number }> = [];
  let start = 0;
  while (start < lines.length) {
    let size = 0;
    let end = start;
    while (end < lines.length && (size === 0 || size + lines[end]!.length + 1 <= target)) {
      size += lines[end]!.length + 1;
      end++;
    }
    const body = lines.slice(start, end).join('\n');
    if (body.trim() !== '') out.push({ text: header && out.length > 0 ? `${header}\n${body}` : body, first: start + 1, last: end });
    if (end >= lines.length) break;
    let back = end;
    let kept = 0;
    while (back > start + 1 && kept + lines[back - 1]!.length + 1 <= overlap) {
      kept += lines[back - 1]!.length + 1;
      back--;
    }
    start = back;
  }
  return out;
}

const MAX_CHUNKS = 2000; // Stage 9 EMBED E4 (retrieval.ts MAX_CHUNKS_PER_FILE)

/** The file's retrieval units: per page / slide / sheet / section / segment, or by lines. */
export function planChunks(d: Pick<DerivativeDraft, 'kind' | 'units' | 'markdown' | 'head' | 'markdownChars' | 'sidecar'>, counts?: Record<string, TokenCount>): ChunkPlan {
  const { target, overlap, sizedBy } = chunkSize(counts, d.markdownChars);
  const rows: ChunkRow[] = [];
  const units = d.units.filter((u) => u.text.trim() !== '');
  if (units.length > 0) {
    units.forEach((u, i) => {
      const page = u.kind === 'page' ? Number(u.label.replace(/\D+/g, '')) || i + 1 : null;
      if (u.kind === 'sheet') {
        // Title, summary, blank, table header and separator lead every piece of the sheet.
        const lines = u.text.split('\n');
        const header = lines.slice(0, 5).join('\n');
        chunkLines(lines.slice(5).join('\n'), target, overlap, header).forEach((c, k) => {
          rows.push({ text: k === 0 ? `${header}\n${c.text}` : c.text, page, locator: `${u.label} lines ${String(c.first)}–${String(c.last)}` });
        });
        return;
      }
      for (const piece of chunkText(u.text.normalize('NFC'), target, overlap)) rows.push({ text: piece, page, locator: u.label });
    });
  } else {
    const text = (d.markdown ?? d.head ?? '').normalize('NFC');
    const header = d.kind === 'csv' ? String(d.sidecar['header'] ?? '') : '';
    for (const c of chunkLines(header ? text.split(/\r?\n/).slice(1).join('\n') : text, target, overlap, header)) {
      const first = header && c.first === 1 ? 1 : c.first + (header ? 1 : 0);
      const last = c.last + (header ? 1 : 0);
      rows.push({ text: header && c.first === 1 ? `${header}\n${c.text}` : c.text, page: null, locator: `lines ${String(first)}–${String(last)}` });
    }
  }
  // A text held only in part (its head) is capped too, even under MAX_CHUNKS.
  const partial = d.markdown === null;
  return { chunks: rows.slice(0, MAX_CHUNKS), targetChars: target, sizedBy, capped: rows.length > MAX_CHUNKS || partial };
}

/* ------------------------------------------------------------------ store */

export interface StoredObjects {
  markdownKey: string | null;
  normalizedKey: string | null;
}

/** Puts the Markdown and the normalised copy in storage; the keys go on the derivative row. */
export async function putDerivativeObjects(storage: ObjectStorage, userId: string, d: DerivativeDraft): Promise<StoredObjects> {
  let markdownKey: string | null = null;
  if (d.markdownChars > 0) {
    markdownKey = generateStorageKey(userId);
    if (d.markdown !== null) await storage.put(markdownKey, Buffer.from(d.markdown, 'utf8'), 'text/markdown; charset=utf-8');
    else if (d.markdownPath) {
      const { size } = await import('node:fs/promises').then((m) => m.stat(d.markdownPath!));
      await storage.putStream(markdownKey, createReadStream(d.markdownPath), size);
    }
  }
  let normalizedKey: string | null = null;
  if (d.normalized) {
    normalizedKey = generateStorageKey(userId);
    await storage.put(normalizedKey, await readFile(d.normalized.path), d.normalized.mimeType);
  }
  return { markdownKey, normalizedKey };
}

export interface DerivativeWrite {
  userId: string;
  attachmentId?: string;
  projectFileId?: string;
  version: number;
  checksumSha256: string;
  draft: DerivativeDraft;
  objects: StoredObjects;
  counts: Record<ModelFamily, TokenCount>;
  plan: ChunkPlan | null;
  extraWarnings?: FileWarning[];
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Replaces the file's derivative in `tx` (the job's fenced transaction), and returns the keys of
 * the one it replaced, for the caller to delete once the transaction committed.
 */
export async function writeDerivative(tx: Tx | Database, w: DerivativeWrite): Promise<{ id: string; replacedKeys: string[] }> {
  const target = w.attachmentId ? eq(fileDerivatives.attachmentId, w.attachmentId) : eq(fileDerivatives.projectFileId, w.projectFileId!);
  const old = await tx.delete(fileDerivatives).where(target).returning({ m: fileDerivatives.markdownKey, n: fileDerivatives.normalizedKey });
  const sidecar = { ...w.draft.sidecar, chunking: w.plan ? { targetChars: w.plan.targetChars, sizedBy: w.plan.sizedBy } : null, imagesCounted: false };
  const [row] = await tx
    .insert(fileDerivatives)
    .values({
      userId: w.userId,
      attachmentId: w.attachmentId ?? null,
      projectFileId: w.projectFileId ?? null,
      version: w.version,
      kind: w.draft.kind,
      extractorVersion: w.draft.extractorVersion,
      markdownKey: w.objects.markdownKey,
      markdownChars: w.draft.markdownChars,
      sidecar,
      warnings: [...w.draft.warnings, ...(w.extraWarnings ?? [])],
      tokenCounts: w.counts,
      normalizedKey: w.objects.normalizedKey,
      normalizedMimeType: w.draft.normalized?.mimeType ?? null,
      checksumSha256: w.checksumSha256,
    })
    .returning({ id: fileDerivatives.id });
  const id = row!.id;
  if (w.draft.units.length) {
    for (let i = 0; i < w.draft.units.length; i += 500) {
      await tx.insert(fileDerivativePages).values(
        w.draft.units.slice(i, i + 500).map((u: Unit, j) => ({
          derivativeId: id,
          ordinal: i + j + 1,
          kind: u.kind,
          label: u.label.slice(0, 120),
          text: u.text,
          source: u.source,
          ocrEngine: u.ocrEngine ?? null,
          ocrVersion: u.ocrVersion ?? null,
          tStartMs: u.tStartMs ?? null,
          tEndMs: u.tEndMs ?? null,
        })),
      );
    }
  }
  if (w.plan?.chunks.length && w.attachmentId) {
    for (let i = 0; i < w.plan.chunks.length; i += 500) {
      await tx.insert(derivativeChunks).values(
        w.plan.chunks.slice(i, i + 500).map((c, j) => ({ derivativeId: id, ordinal: i + j, text: c.text, page: c.page, locator: c.locator.slice(0, 120) })),
      );
    }
  }
  return { id, replacedKeys: old.flatMap((o) => [o.m, o.n].filter((k): k is string => Boolean(k))) };
}

export function retrievalWarning(plan: ChunkPlan | null): FileWarning[] {
  if (!plan?.capped) return [];
  return [warning('retrieval_partial', `This file is large: only its first ${plan.chunks.length.toLocaleString('en-US')} parts can be searched for a question. Code can open the whole file.`)];
}

/** Deletes objects nothing points at any more, quietly: an orphan costs storage, not data. */
export async function deleteObjects(storage: ObjectStorage, keys: string[]): Promise<void> {
  // benign: an orphan costs storage, not data
  for (const k of keys) await storage.delete(k).catch(() => undefined);
}

/** The derived objects of these files (Markdown, normalised copy), for deleting with the file (D1 #37). */
export async function derivedKeys(db: Database, by: { attachmentIds?: string[]; projectFileIds?: string[] }): Promise<string[]> {
  const rows = [
    ...(by.attachmentIds?.length
      ? await db.select({ m: fileDerivatives.markdownKey, n: fileDerivatives.normalizedKey }).from(fileDerivatives).where(inArray(fileDerivatives.attachmentId, by.attachmentIds))
      : []),
    ...(by.projectFileIds?.length
      ? await db.select({ m: fileDerivatives.markdownKey, n: fileDerivatives.normalizedKey }).from(fileDerivatives).where(inArray(fileDerivatives.projectFileId, by.projectFileIds))
      : []),
  ];
  return rows.flatMap((r) => [r.m, r.n].filter((k): k is string => Boolean(k)));
}

/* ------------------------------------------------------------------ reuse (G3) */

/**
 * A ready derivative of the same bytes (same user, same SHA-256, same extractor version, same
 * scanner), to copy instead of reading the file again. Not for a PDF whose stored copy was
 * stripped: its new upload still carries the active content and must be stripped itself.
 */
export async function findReusable(db: Database, userId: string, checksum: string, scanner: string, exclude: { attachmentId?: string; projectFileId?: string }): Promise<DerivativeRow | null> {
  if (!checksum) return null;
  const rows = await db
    .select()
    .from(fileDerivatives)
    .where(
      and(
        eq(fileDerivatives.userId, userId),
        eq(fileDerivatives.checksumSha256, checksum),
        eq(fileDerivatives.extractorVersion, EXTRACTOR_VERSION),
      ),
    )
    .limit(5);
  return (
    rows.find((r) => {
      if (exclude.attachmentId && r.attachmentId === exclude.attachmentId) return false;
      if (exclude.projectFileId && r.projectFileId === exclude.projectFileId) return false;
      const s = r.sidecar as { scanner?: string; activeContentRemoved?: string[] };
      return (s.scanner ?? 'none') === scanner && !(s.activeContentRemoved?.length);
    }) ?? null
  );
}

/** A draft rebuilt from a stored derivative, with copies of its objects' bytes on local disk. */
export async function draftFromStored(db: Database, storage: ObjectStorage, row: DerivativeRow, workDir: string): Promise<DerivativeDraft> {
  const units = await db.select().from(fileDerivativePages).where(eq(fileDerivativePages.derivativeId, row.id)).orderBy(fileDerivativePages.ordinal);
  const markdown = row.markdownKey ? (await storage.get(row.markdownKey)).toString('utf8') : '';
  const d: DerivativeDraft = {
    kind: row.kind,
    extractorVersion: row.extractorVersion,
    markdown,
    markdownChars: row.markdownChars,
    units: units.map((u) => ({
      kind: u.kind,
      label: u.label,
      text: u.text,
      source: u.source,
      ...(u.ocrEngine ? { ocrEngine: u.ocrEngine } : {}),
      ...(u.ocrVersion ? { ocrVersion: u.ocrVersion } : {}),
      ...(u.tStartMs !== null ? { tStartMs: u.tStartMs } : {}),
      ...(u.tEndMs !== null ? { tEndMs: u.tEndMs } : {}),
    })),
    sidecar: { ...(row.sidecar as Record<string, unknown>), reusedFrom: row.id },
    warnings: row.warnings,
  };
  if (row.normalizedKey && row.normalizedMimeType) {
    const p = `${workDir}/reused-normalized`;
    await storage.downloadTo(row.normalizedKey, p);
    d.normalized = { path: p, mimeType: row.normalizedMimeType };
  }
  return d;
}

/* ------------------------------------------------------------------ checksum */

/** SHA-256 of a local file: the job's own copy, streamed (D1 #35, ADR-0066 Decision 4). */
export async function fileChecksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/* ------------------------------------------------------------------ read back */

export async function derivativesFor(db: Database, attachmentIds: string[]): Promise<Map<string, DerivativeRow>> {
  if (attachmentIds.length === 0) return new Map();
  const rows = await db.select().from(fileDerivatives).where(inArray(fileDerivatives.attachmentId, attachmentIds));
  return new Map(rows.map((r) => [r.attachmentId!, r]));
}
