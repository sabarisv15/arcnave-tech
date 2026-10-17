/**
 * The deletion ledger (Stage 5 P11, Stage 4 G4; N-34 one year; ADR-0079): a record that a
 * deletion was asked for and that it was done, kept outside the restorable database so a
 * restore cannot bring back data without also showing that it had been deleted.
 *
 * Each record is a small JSON object in object storage under `DELETION_LEDGER_PREFIX`: ids,
 * timestamps and counts only, never a title, a message or a file name (Stage 17 NO_CONTENT).
 * The prefix is never an owner shard, so `storage.deleteOwned` cannot reach it; the year's
 * keeping is a bucket lifecycle rule on the prefix (infrastructure, the live checklist).
 *
 * Order, for every deletion that writes it: `requested`, then the bytes, then `completed`, then
 * the rows. A failed ledger write stops the deletion there (the rows stay, the next sweep or a
 * retry does it again), so no deletion completes without its record.
 */
import { logger } from '../logger.js';
import { logEvent } from '../observability/logEvent.js';
import type { ObjectStorage } from './storage.js';

const log = logger.child({ module: 'deletion-ledger' });

export type DeletionKind = 'chat_purge' | 'account_delete';
export type DeletionPhase = 'requested' | 'completed';

export interface DeletionRecord {
  kind: DeletionKind;
  phase: DeletionPhase;
  /** The chat purged, or the account deleted. */
  subjectId: string;
  userId: string;
  at: Date;
  /** What went: stored objects, chats, messages. Counts only. */
  counts: Record<string, number>;
}

/** The key one record is stored under: `<prefix>/<yyyy>/<mm>/<dd>/<kind>-<id>-<phase>.json`. */
export function ledgerKey(prefix: string, rec: Pick<DeletionRecord, 'kind' | 'phase' | 'subjectId' | 'at'>): string {
  const day = rec.at.toISOString().slice(0, 10).replaceAll('-', '/');
  return `${prefix}/${day}/${rec.kind}-${rec.subjectId}-${rec.phase}.json`;
}

/** The only shape a ledger key may have (checked by the storage backends). */
export { LEDGER_KEY } from './storage.js';

export class DeletionLedger {
  constructor(
    private readonly storage: Pick<ObjectStorage, 'put'>,
    readonly prefix: string,
  ) {}

  /** Writes one record. Throws when storage refuses: the caller stops the deletion there. */
  async write(rec: DeletionRecord): Promise<string> {
    const key = ledgerKey(this.prefix, rec);
    const body = {
      kind: rec.kind,
      phase: rec.phase,
      subjectId: rec.subjectId,
      userId: rec.userId,
      at: rec.at.toISOString(),
      counts: Object.fromEntries(Object.entries(rec.counts).filter(([, v]) => Number.isFinite(v))),
    };
    await this.storage.put(key, Buffer.from(JSON.stringify(body)), 'application/json');
    logEvent(log, 'deletion_ledger', { kind: rec.kind, phase: rec.phase, subjectId: rec.subjectId });
    return key;
  }
}
