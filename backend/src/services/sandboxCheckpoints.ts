/**
 * The sweep that checkpoints idle sandbox workspaces (ADR-0015). One instance at a time, by an
 * advisory lock, and one sweep at a time per instance: a sweep that copies a large workspace can
 * outlast the one-minute interval.
 */
import { sql } from 'drizzle-orm';

import type { Database } from '../db/client.js';
import type { WarmSandboxClient } from '../tools/sandbox/warmSandboxClient.js';

/** Fixed key so two instances never checkpoint at once; any other value would do. */
const CHECKPOINT_LOCK_KEY = 872_634_003;
/** Workspaces per sweep, so one sweep stays bounded; the next takes the rest. */
const WORKSPACES_PER_SWEEP = 5;

let running = false;

export async function sweepCheckpoints(
  db: Database,
  sandbox: WarmSandboxClient,
  idleSeconds: number,
  log: { warn: (obj: object, msg: string) => void },
): Promise<{ saved: number; failed: number; skipped: boolean }> {
  if (running) return { saved: 0, failed: 0, skipped: true };
  running = true;
  try {
    return await db.transaction(async (tx) => {
      const [lock] = (await tx.execute(
        sql`select pg_try_advisory_xact_lock(${CHECKPOINT_LOCK_KEY}) as ok`,
      )) as unknown as Array<{ ok: boolean }>;
      if (!lock?.ok) return { saved: 0, failed: 0, skipped: true };
      return { ...(await sandbox.checkpointIdle(idleSeconds, WORKSPACES_PER_SWEEP, log)), skipped: false };
    });
  } finally {
    running = false;
  }
}
