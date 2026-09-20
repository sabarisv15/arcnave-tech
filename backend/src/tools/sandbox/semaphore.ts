/**
 * Caps how many `run_python` sandbox executions may be in flight across the whole deployment at
 * once. Exists because the backend autoscales to multiple Cloud Run instances (see container.ts),
 * so an in-process counter would only cap per-instance — a real ceiling needs a shared source of
 * truth, which here is Postgres, already on the hot path for everything else.
 *
 * `pg_advisory_xact_lock` serialises claim attempts across every instance without taking a table
 * lock, and releases itself automatically when the transaction ends — even on a crash — so a
 * claim attempt can never deadlock behind a lock nobody will release. The claim row itself carries
 * an `expiresAt` lease rather than relying on an explicit release alone: if the process holding a
 * claim dies before calling `release`, the row simply stops counting once its lease expires,
 * instead of leaking capacity forever.
 */
import { eq, lt, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { sandboxClaims } from '../../db/schema.js';

/** Arbitrary fixed key for the advisory lock — any two calls must contend on the same constant. */
const ADVISORY_LOCK_KEY = 872_634_001;

export class SandboxSemaphore {
  constructor(
    private readonly db: Database,
    /** Maximum number of concurrent run_python executions allowed at once. */
    private readonly maxConcurrent: number,
    /** Lease length for a claim, i.e. how long before an unreleased claim is treated as
     *  abandoned and no longer counted. Must stay comfortably larger than the real orchestration
     *  timeout a claim is meant to cover, or a still-running execution could be reaped while
     *  legitimately in flight. */
    private readonly leaseMs: number,
  ) {}

  /** Attempts to reserve one of the `maxConcurrent` slots. Returns the claim id to pass to
   *  `release` on success, or `null` if the semaphore is at capacity. */
  async claim(): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);
      await tx.delete(sandboxClaims).where(lt(sandboxClaims.expiresAt, sql`now()`));
      const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(sandboxClaims);
      if ((countRow?.count ?? 0) >= this.maxConcurrent) return null;
      const [inserted] = await tx
        .insert(sandboxClaims)
        .values({ expiresAt: new Date(Date.now() + this.leaseMs) })
        .returning({ id: sandboxClaims.id });
      return inserted!.id;
    });
  }

  /** Frees a slot early, as soon as the execution it was guarding actually finishes — never
   *  waits for the lease to expire on the happy path. Safe to call even if the claim was already
   *  reaped (deleting a nonexistent row is a no-op, not an error). */
  async release(claimId: string): Promise<void> {
    await this.db.delete(sandboxClaims).where(eq(sandboxClaims.id, claimId));
  }
}
