/**
 * Cross-cutting route helpers: pagination, optimistic concurrency, and idempotency.
 */
import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';
import { ApiError } from '../errors.js';
import { NUMBERS } from '../config/numbers.js';

/**
 * Cursor pagination.
 *
 * Offsets drift when rows are inserted mid-scroll; a cursor anchored to a stable sort key
 * does not. `cursor` is an opaque base64 of the last item's sort value plus its id, so ties
 * on the sort column still advance.
 */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(NUMBERS.LIST_PAGE_MAX.value).default(NUMBERS.LIST_PAGE_DEFAULT.value), // N-73
  cursor: z.string().max(200).optional(),
});

export interface Cursor {
  at: number;
  id: string;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.getTime()}:${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, 'base64url').toString('utf8');
    const separator = raw.indexOf(':');
    if (separator === -1) return null;
    const at = Number(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (!Number.isFinite(at) || id === '') return null;
    return { at, id };
  } catch {
    // benign: A malformed cursor means "start from the beginning", not a 500. Clients paste these.
    return null;
  }
}

/**
 * Optimistic concurrency.
 *
 * Callers send the version they read. A mismatch means someone else saved in between, so we
 * refuse rather than silently overwriting their edit.
 */
export function assertVersion(expected: number | undefined, actual: number, what: string): void {
  if (expected === undefined) return;
  if (expected !== actual) {
    throw new ApiError('conflict', {
      detail:
        `This ${what} was changed somewhere else (you have version ${expected}, ` +
        `the server has ${actual}). Reload to get the latest, then reapply your edit.`,
      meta: { expectedVersion: expected, actualVersion: actual },
    });
  }
}

/** Stable fingerprint of a request body, for detecting idempotency-key reuse with a new body. */
export function fingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export interface IdempotentHit {
  statusCode: number;
  body: unknown;
}

/**
 * Look up a previous response for this idempotency key.
 *
 * Returns the stored response when the key was used with the same body, throws when it was
 * used with a different one (which is a client bug worth surfacing), and returns null when
 * the key is new.
 */
export async function replayIdempotent(
  db: Database,
  userId: string,
  key: string | undefined,
  endpoint: string,
  body: unknown,
): Promise<IdempotentHit | null> {
  if (!key) return null;
  const [existing] = await db
    .select({
      requestFingerprint: idempotencyKeys.requestFingerprint,
      responseJson: idempotencyKeys.responseJson,
      statusCode: idempotencyKeys.statusCode,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, userId),
        eq(idempotencyKeys.key, key),
        eq(idempotencyKeys.endpoint, endpoint),
      ),
    )
    .limit(1);

  if (!existing) return null;
  if (existing.requestFingerprint !== fingerprint(body)) {
    throw new ApiError('idempotency_conflict');
  }
  return { statusCode: existing.statusCode, body: existing.responseJson };
}

export async function storeIdempotent(
  db: Database,
  userId: string,
  key: string | undefined,
  endpoint: string,
  body: unknown,
  statusCode: number,
  response: unknown,
): Promise<void> {
  if (!key) return;
  await db
    .insert(idempotencyKeys)
    .values({
      userId,
      key,
      endpoint,
      requestFingerprint: fingerprint(body),
      responseJson: response,
      statusCode,
    })
    // A concurrent duplicate lost the race; its caller will read this row on retry.
    .onConflictDoNothing();
}

export const idempotencyHeader = z.object({
  'idempotency-key': z.string().min(1).max(200).optional(),
});

/** ISO 8601 over the wire, always. Storage is UTC; rendering in local time is the UI's job. */
export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export const uuidParam = z.object({ id: z.string().uuid() });
