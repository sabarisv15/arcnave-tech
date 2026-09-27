/**
 * Checkpoints of a chat's sandbox workspace (ADR-0015).
 *
 * A workspace is checkpointed after about 5 minutes of inactivity and restored on the next
 * request for 30 days. The warm sandbox keeps a workspace in one instance, which drops it after WORKSPACE_TTL_S idle, when
 * its slots are full, or on a restart. So the backend copies an idle workspace's files to storage
 * and puts them back when the chat runs code again.
 *
 * The sandbox has no network (ADR-0007), so it cannot write to storage itself; the backend pulls
 * files out and pushes them in (WarmSandboxClient). This module is where they are kept: one
 * stored object per file version, and a manifest mapping each path to its object. An unchanged
 * file (same size and mtime) keeps its object between checkpoints, so a checkpoint copies only
 * what changed. The `sandbox_workspaces` row points at the current manifest.
 */
import { eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { sandboxWorkspaces } from '../../db/schema.js';
import { generateStorageKey, type ObjectStorage } from '../../services/storage.js';

export interface CheckpointEntry {
  key: string;
  sha256: string;
  size: number;
  /** Nanoseconds, as a string: they do not fit a JS number exactly. */
  mtimeNs: string;
}

export interface CheckpointManifest {
  version: 1;
  files: Record<string, CheckpointEntry>;
}

export interface WorkspaceRow {
  userId: string;
  manifestKey: string | null;
}

export class WorkspaceStateStore {
  constructor(
    private readonly db: Database,
    readonly storage: ObjectStorage,
  ) {}

  /** Records which chat a workspace belongs to, so its checkpoint can be found and purged. */
  async recordRun(ws: string, owner: { userId: string; chatId: string }): Promise<void> {
    await this.db
      .insert(sandboxWorkspaces)
      .values({ workspaceId: ws, userId: owner.userId, chatId: owner.chatId })
      .onConflictDoUpdate({ target: sandboxWorkspaces.workspaceId, set: { lastRunAt: sql`now()` } });
  }

  async row(ws: string): Promise<WorkspaceRow | null> {
    const [row] = await this.db
      .select({ userId: sandboxWorkspaces.userId, manifestKey: sandboxWorkspaces.manifestKey })
      .from(sandboxWorkspaces)
      .where(eq(sandboxWorkspaces.workspaceId, ws))
      .limit(1);
    return row ?? null;
  }

  async loadManifest(key: string | null): Promise<CheckpointManifest | null> {
    if (!key) return null;
    return JSON.parse((await this.storage.get(key)).toString('utf8')) as CheckpointManifest;
  }

  newObjectKey(row: WorkspaceRow): string {
    return generateStorageKey(row.userId);
  }

  /**
   * Makes `manifest` the workspace's checkpoint. False when the workspace no longer has a row
   * (its chat was purged meanwhile); the caller then removes what it uploaded.
   */
  async commit(ws: string, row: WorkspaceRow, manifest: CheckpointManifest): Promise<boolean> {
    const bytes = Object.values(manifest.files).reduce((n, f) => n + f.size, 0);
    // Manifest first: a row that points at a manifest always has one to restore from.
    const key = this.newObjectKey(row);
    await this.storage.put(key, Buffer.from(JSON.stringify(manifest)), 'application/json');
    const [updated] = await this.db
      .update(sandboxWorkspaces)
      .set({ savedAt: sql`now()`, savedBytes: bytes, manifestKey: key })
      .where(eq(sandboxWorkspaces.workspaceId, ws))
      .returning({ ws: sandboxWorkspaces.workspaceId });
    if (!updated) {
      await this.storage.delete(key);
      return false;
    }
    if (row.manifestKey) await this.storage.delete(row.manifestKey);
    return true;
  }
}

/**
 * Deletes a checkpoint: every object its manifest names, then the manifest. False when an object
 * could not be deleted, so the caller keeps the row and the next sweep retries.
 */
export async function deleteCheckpoint(
  storage: ObjectStorage,
  manifestKey: string | null,
  log: { warn: (obj: object, msg: string) => void },
): Promise<boolean> {
  if (!manifestKey) return true;
  try {
    if (await storage.exists(manifestKey)) {
      const manifest = JSON.parse((await storage.get(manifestKey)).toString('utf8')) as CheckpointManifest;
      for (const entry of Object.values(manifest.files)) await storage.delete(entry.key);
      await storage.delete(manifestKey);
    }
    return true;
  } catch (err) {
    log.warn({ err, manifestKey }, 'sandbox checkpoint could not be deleted; will retry');
    return false;
  }
}
