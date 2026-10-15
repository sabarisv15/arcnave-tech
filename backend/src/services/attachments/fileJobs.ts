/**
 * File jobs: the queue and the in-process worker behind the file pipeline (Stage 9 PIPE,
 * ADR-0062; Cloud Tasks is the deferred Phase 5 executor).
 *
 * A job is a `file_jobs` row. A worker claims one with `FOR UPDATE SKIP LOCKED` (a bare SELECT
 * is not a lock: two workers would both take it) and holds it by a lease it renews while it
 * runs. A worker that dies stops renewing; once the lease lapses any worker takes the job over
 * (`attempts` + 1, at most FILE_JOB_MAX_ATTEMPTS, N-44). Every write a job makes to its file is
 * fenced on still holding the lease, so a worker that wakes up after losing its job cannot
 * overwrite what the new holder wrote.
 *
 * Lanes: files up to FILE_FAST_LANE_MAX_BYTES are `fast`, and one worker slot is always kept
 * for them, so a small file never waits behind large ones (Stage 9 G30).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { attachments, fileJobs, projectFiles } from '../../db/schema.js';
import type { Provider } from '../../providers/types.js';
import { INDEX_VERSION, indexFile } from '../retrieval.js';
import { generateStorageKey, type ObjectStorage } from '../storage.js';
import { warning } from './fileErrors.js';
import { isolatedExtractPages } from './isolatedExtract.js';
import { failed, readAttachment, type FileStage, type Outcome } from './pipeline.js';
import { expandZip, memberStream } from './zipExpand.js';
import { storageKeyInUse } from './references.js';

type AttachmentRow = typeof attachments.$inferSelect;
type JobRow = typeof fileJobs.$inferSelect;

export interface FileLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface FileServiceDeps {
  db: Database;
  storage: ObjectStorage;
  cfg: Config;
  visionProvider?: Provider;
  log: FileLogger;
}

export interface WorkerOptions {
  leaseMs?: number;
  pollMs?: number;
  concurrency?: number;
  /** Test seam: called after each stage is recorded, inside the job. */
  afterStage?: (attachmentId: string, stage: FileStage) => Promise<void>;
}

/** A write that only lands while `owner` still holds job `jobId`. */
interface Fence {
  jobId: string;
  owner: string;
}

export class FileService {
  readonly owner = `${os.hostname().slice(0, 32)}:${String(process.pid)}:${randomBytes(4).toString('hex')}`;
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly concurrency: number;
  private active = 0;
  private activeNormal = 0;
  private readonly wanted = new Set<string>();
  private readonly inFlight = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private pumping = false;
  private repump = false;
  /** Set by `crash()`: the worker stops renewing leases and writing, as if its process died. */
  private dead = false;

  constructor(
    private readonly deps: FileServiceDeps,
    private readonly opts: WorkerOptions = {},
  ) {
    this.leaseMs = opts.leaseMs ?? deps.cfg.FILE_JOB_LEASE_MS;
    this.pollMs = opts.pollMs ?? deps.cfg.FILE_WORKER_POLL_MS;
    this.concurrency = Math.max(1, opts.concurrency ?? deps.cfg.FILE_WORKER_CONCURRENCY);
  }

  /* ------------------------------------------------------------------ lifecycle */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.dead = false;
    // With polling off (tests) a worker runs only the jobs it was handed, so two apps sharing a
    // database never take each other's work.
    if (this.pollMs > 0) {
      this.timer = setInterval(() => void this.pump(), this.pollMs);
      this.timer.unref();
      if (this.deps.cfg.FILE_REINDEX_BACKFILL) void this.enqueueStaleIndexes().catch((err: unknown) => this.logError(err, 'reindex backfill failed'));
    }
    void this.pump();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.inFlight]);
  }

  /** Test seam: the worker stops as if killed. In-flight jobs keep their leases until they lapse. */
  crash(): void {
    this.dead = true;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  /** Wake the worker; with an id, the worker also takes that job even with polling off. */
  poke(jobId?: string): void {
    if (jobId) this.wanted.add(jobId);
    void this.pump();
  }

  /** Waits until every job this worker is running or was handed has finished. For tests. */
  async idle(): Promise<void> {
    for (let i = 0; i < 2000; i++) {
      if (this.inFlight.size === 0 && this.wanted.size === 0 && !this.pumping) return;
      await Promise.allSettled([...this.inFlight]);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Claims and runs one due job (of these ids, when given), whoever queued it. For tests. */
  async runOnce(ids?: string[]): Promise<boolean> {
    const job = await this.claim(ids ? { any: false, normalAllowed: true, ids } : { any: true, normalAllowed: true });
    if (!job) return false;
    await this.runJob(job);
    return true;
  }

  /* ------------------------------------------------------------------ queue */

  async enqueueAttachment(row: AttachmentRow): Promise<string> {
    const { db, cfg } = this.deps;
    const [last] = await db
      .select({ v: sql<number>`coalesce(max(${fileJobs.version}), 0)::int` })
      .from(fileJobs)
      .where(and(eq(fileJobs.attachmentId, row.id), eq(fileJobs.kind, 'attachment')));
    const [job] = await db
      .insert(fileJobs)
      .values({
        userId: row.userId,
        attachmentId: row.id,
        kind: 'attachment',
        version: (last?.v ?? 0) + 1,
        lane: row.sizeBytes <= cfg.FILE_FAST_LANE_MAX_BYTES ? 'fast' : 'normal',
        maxAttempts: cfg.FILE_JOB_MAX_ATTEMPTS, // N-44
      })
      .onConflictDoNothing()
      .returning({ id: fileJobs.id });
    if (!job) throw new Error('file job already exists for this version');
    await db.update(attachments).set({ status: 'queued', error: '', errorCode: '', warnings: [] }).where(eq(attachments.id, row.id));
    this.poke(job.id);
    return job.id;
  }

  /** One `reindex` job per project file written by an older indexer; idempotent per version. */
  async enqueueStaleIndexes(): Promise<string[]> {
    const rows = await this.deps.db.execute(sql`
      insert into file_jobs (user_id, project_file_id, kind, version, lane, max_attempts)
      select pf.user_id, pf.id, 'reindex', ${INDEX_VERSION}, 'normal', ${this.deps.cfg.FILE_JOB_MAX_ATTEMPTS}
      from project_files pf
      where pf.index_version < ${INDEX_VERSION} and pf.status in ('ready', 'unsupported', 'failed')
      on conflict do nothing
      returning id`);
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    for (const id of ids) this.poke(id);
    return ids;
  }

  /* ------------------------------------------------------------------ claim */

  private async claim(scope: { any: boolean; normalAllowed: boolean; ids?: string[] }): Promise<JobRow | null> {
    const lease = `${String(this.leaseMs)} milliseconds`;
    const target = scope.any ? sql`true` : sql`fj.id in ${scope.ids && scope.ids.length ? sql`(${sql.join(scope.ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql`(null)`}`;
    const lane = scope.normalAllowed ? sql`true` : sql`fj.lane = 'fast'`;
    const rows = await this.deps.db.execute(sql`
      update file_jobs set
        state = 'running',
        attempts = attempts + 1,
        lease_owner = ${this.owner},
        lease_expires_at = now() + ${lease}::interval,
        updated_at = now()
      where id = (
        select fj.id from file_jobs fj
        where ${target} and ${lane}
          and fj.attempts < fj.max_attempts
          and (fj.state = 'queued' or (fj.state = 'running' and fj.lease_expires_at < now()))
        order by (fj.lane = 'fast') desc, fj.created_at
        for update skip locked
        limit 1)
      returning *`);
    const raw = (rows as unknown as Array<Record<string, unknown>>)[0];
    if (!raw) return null;
    // `execute` returns column names, not the schema's field names.
    const [job] = await this.deps.db.select().from(fileJobs).where(eq(fileJobs.id, String(raw['id'])));
    return job ?? null;
  }

  /** Jobs whose lease lapsed with no attempts left: the file fails as `timeout`. */
  private async failExhausted(): Promise<void> {
    const { db } = this.deps;
    const rows = await db
      .update(fileJobs)
      .set({ state: 'failed', errorCode: 'timeout', leaseOwner: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(fileJobs.state, 'running'),
          sql`${fileJobs.leaseExpiresAt} < now()`,
          sql`${fileJobs.attempts} >= ${fileJobs.maxAttempts}`,
        ),
      )
      .returning({ attachmentId: fileJobs.attachmentId });
    const ids = rows.map((r) => r.attachmentId).filter((v): v is string => Boolean(v));
    if (ids.length) {
      const out = failed('timeout');
      await db
        .update(attachments)
        .set({ status: 'failed', error: out.status === 'failed' ? out.error : '', errorCode: 'timeout' })
        .where(inArray(attachments.id, ids));
    }
  }

  private async pump(): Promise<void> {
    // A worker that was never started (or was stopped) runs nothing in the background;
    // `runOnce` still runs a job on request.
    if (this.dead || !this.running) return;
    if (this.pumping) {
      this.repump = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.repump = false;
        await this.failExhausted();
        while (!this.dead && this.active < this.concurrency) {
          // One slot stays free for the fast lane.
          const normalAllowed = this.concurrency === 1 ? this.active === 0 : this.activeNormal < this.concurrency - 1;
          const any = this.running && this.pollMs > 0;
          const ids = [...this.wanted];
          if (!any && ids.length === 0) break;
          const job = await this.claim({ any, normalAllowed, ids });
          if (!job) {
            await this.pruneWanted();
            break;
          }
          this.wanted.delete(job.id);
          this.launch(job);
        }
      } while (this.repump && !this.dead);
    } catch (err) {
      this.logError(err, 'file worker pump failed');
    } finally {
      this.pumping = false;
    }
  }

  /** Forget handed-over jobs that are no longer claimable by anyone (done, failed, held). */
  private async pruneWanted(): Promise<void> {
    if (this.wanted.size === 0) return;
    const rows = await this.deps.db
      .select({ id: fileJobs.id, state: fileJobs.state, lane: fileJobs.lane, attempts: fileJobs.attempts, max: fileJobs.maxAttempts })
      .from(fileJobs)
      .where(inArray(fileJobs.id, [...this.wanted]));
    const live = new Set(rows.filter((r) => (r.state === 'queued' || r.state === 'running') && r.attempts < r.max).map((r) => r.id));
    for (const id of [...this.wanted]) {
      const row = rows.find((r) => r.id === id);
      // A running job held by another worker stays wanted: if that worker dies, this one resumes it.
      if (!row || !live.has(id)) this.wanted.delete(id);
    }
    // Wanted jobs still queued behind a full lane are retried when a slot frees (launch → pump).
  }

  private launch(job: JobRow): void {
    this.active += 1;
    if (job.lane === 'normal') this.activeNormal += 1;
    const p = this.runJob(job).finally(() => {
      this.active -= 1;
      if (job.lane === 'normal') this.activeNormal -= 1;
      this.inFlight.delete(p);
      if (!this.dead) void this.pump();
    });
    this.inFlight.add(p);
  }

  /* ------------------------------------------------------------------ run */

  private async runJob(job: JobRow): Promise<void> {
    const fence: Fence = { jobId: job.id, owner: this.owner };
    const beat = setInterval(() => {
      if (this.dead) return;
      void this.deps.db
        .update(fileJobs)
        .set({ leaseExpiresAt: sql`now() + ${`${String(this.leaseMs)} milliseconds`}::interval`, updatedAt: new Date() })
        .where(and(eq(fileJobs.id, job.id), eq(fileJobs.leaseOwner, this.owner), eq(fileJobs.state, 'running')))
        .catch(() => undefined);
    }, Math.max(50, Math.floor(this.leaseMs / 3)));
    beat.unref();
    const started = Date.now();
    try {
      if (job.kind === 'reindex') await this.runReindex(job, fence);
      else await this.runAttachmentJob(job, fence);
      this.deps.log.info({ jobId: job.id, kind: job.kind, attempt: job.attempts, ms: Date.now() - started }, 'file job finished');
    } catch (err) {
      this.logError(err, 'file job failed', { jobId: job.id, kind: job.kind, attempt: job.attempts });
      if (!this.dead) await this.release(job, fence);
    } finally {
      clearInterval(beat);
    }
  }

  /** An unexpected error: back to the queue, or failed once attempts are spent. */
  private async release(job: JobRow, fence: Fence): Promise<void> {
    const { db } = this.deps;
    const exhausted = job.attempts >= job.maxAttempts;
    const [row] = await db
      .update(fileJobs)
      .set({
        state: exhausted ? 'failed' : 'queued',
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: exhausted ? 'timeout' : '',
        updatedAt: new Date(),
        ...(exhausted ? { finishedAt: new Date() } : {}),
      })
      .where(and(eq(fileJobs.id, fence.jobId), eq(fileJobs.leaseOwner, fence.owner)))
      .returning({ id: fileJobs.id });
    if (!row) return;
    if (exhausted && job.attachmentId) {
      const out = failed('timeout');
      await db
        .update(attachments)
        .set({ status: 'failed', error: out.status === 'failed' ? out.error : '', errorCode: 'timeout' })
        .where(eq(attachments.id, job.attachmentId));
    } else if (!exhausted) {
      this.poke(job.id);
    }
  }

  private async holds(fence: Fence): Promise<boolean> {
    if (this.dead) return false;
    const [row] = await this.deps.db
      .select({ id: fileJobs.id })
      .from(fileJobs)
      .where(and(eq(fileJobs.id, fence.jobId), eq(fileJobs.leaseOwner, fence.owner), eq(fileJobs.state, 'running')));
    return Boolean(row);
  }

  private async runAttachmentJob(job: JobRow, fence: Fence): Promise<void> {
    const { db, storage } = this.deps;
    const [row] = job.attachmentId ? await db.select().from(attachments).where(eq(attachments.id, job.attachmentId)) : [];
    if (!row) {
      // Deleted while queued (G29): nothing to read, nothing to clean.
      await this.finish(fence, 'done');
      return;
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-job-'));
    try {
      const local = path.join(dir, 'file');
      await storage.downloadTo(row.storageKey, local);
      const outcome = await this.read(row, local, async (stage) => {
        if (!(await this.holds(fence))) throw new LeaseLost();
        await db.update(attachments).set({ status: stage }).where(eq(attachments.id, row.id));
        await this.opts.afterStage?.(row.id, stage);
        if (!(await this.holds(fence))) throw new LeaseLost();
      });
      await db.transaction(async (tx) => {
        const [held] = await tx
          .update(fileJobs)
          .set({ state: 'done', leaseOwner: null, finishedAt: new Date(), updatedAt: new Date(), errorCode: outcome.status === 'failed' ? outcome.errorCode : '' })
          .where(and(eq(fileJobs.id, fence.jobId), eq(fileJobs.leaseOwner, fence.owner), eq(fileJobs.state, 'running')))
          .returning({ id: fileJobs.id });
        if (!held || this.dead) throw new LeaseLost();
        await tx.update(attachments).set(outcomePatch(outcome)).where(eq(attachments.id, row.id));
      });
    } catch (err) {
      if (err instanceof LeaseLost) return;
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async finish(fence: Fence, state: 'done' | 'failed'): Promise<void> {
    await this.deps.db
      .update(fileJobs)
      .set({ state, leaseOwner: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(fileJobs.id, fence.jobId), eq(fileJobs.leaseOwner, fence.owner)));
  }

  private async runReindex(job: JobRow, fence: Fence): Promise<void> {
    const { db, storage, visionProvider, cfg } = this.deps;
    const [file] = job.projectFileId ? await db.select().from(projectFiles).where(eq(projectFiles.id, job.projectFileId)) : [];
    if (!file) {
      await this.finish(fence, 'done');
      return;
    }
    const data = await storage.get(file.storageKey);
    const result = await indexFile(db, file, data, visionProvider, isolatedExtractPages(cfg));
    if (!(await this.holds(fence))) return;
    await db
      .update(projectFiles)
      .set({
        status: result.status,
        error: result.error,
        errorCode: result.errorCode,
        warnings: result.warnings,
        chunkCount: result.chunkCount,
        indexVersion: INDEX_VERSION,
        indexedAt: new Date(),
      })
      .where(eq(projectFiles.id, file.id));
    await this.finish(fence, 'done');
  }

  /* ------------------------------------------------------------------ the pipeline */

  /** Reads one attachment already on local disk. Shared by the job and the in-request path. */
  async read(row: AttachmentRow, localPath: string, setStage?: (stage: FileStage) => Promise<void>, inline = false): Promise<Outcome> {
    return readAttachment({
      path: localPath,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      cfg: this.deps.cfg,
      ...(this.deps.visionProvider ? { visionProvider: this.deps.visionProvider } : {}),
      ...(setStage ? { setStage } : {}),
      expandZip: (zipPath) => this.expand(row, zipPath, inline),
    });
  }

  /**
   * A ZIP's members become attachments of their own, each read by the same pipeline: queued as
   * jobs, or read here when the ZIP itself is being read inside a request.
   */
  private async expand(parent: AttachmentRow, zipPath: string, inline: boolean): Promise<Outcome> {
    const { db, storage } = this.deps;
    await this.removeMembers(parent.id);
    const created: AttachmentRow[] = [];
    const names = await expandZip(zipPath, this.deps.cfg, async (member) => {
      const storageKey = generateStorageKey(parent.userId);
      await storage.putStream(storageKey, memberStream(member), member.sizeBytes);
      const [row] = await db
        .insert(attachments)
        .values({
          userId: parent.userId,
          parentAttachmentId: parent.id,
          filename: member.name,
          mimeType: member.mimeType,
          sizeBytes: member.sizeBytes,
          storageKey,
          status: 'queued',
        })
        .returning();
      if (inline) {
        const outcome = await this.read(row!, member.localPath, undefined, true);
        await db.update(attachments).set(outcomePatch(outcome)).where(eq(attachments.id, row!.id));
      }
      created.push(row!);
    });
    if (!inline) for (const row of created) await this.enqueueAttachment(row);
    const detail = `Unpacked ${String(names.length)} file${names.length === 1 ? '' : 's'}: ${names.join(', ')}.`.slice(0, 2000);
    return { status: 'ready', error: detail, warnings: [warning('zip_members', detail)], extractedText: null, pageCount: null };
  }

  /** Deletes a ZIP's members, rows and the bytes nothing else reads. */
  async removeMembers(parentId: string): Promise<void> {
    const { db, storage } = this.deps;
    // Only members not yet sent: a sent member belongs to its message now.
    const members = await db
      .delete(attachments)
      .where(and(eq(attachments.parentAttachmentId, parentId), isNull(attachments.messageId)))
      .returning();
    for (const m of members) {
      if (await storageKeyInUse(db, m.storageKey)) continue;
      await storage.delete(m.storageKey).catch(() => undefined);
    }
  }

  /** Reads an attachment inside the request (FILE_PIPELINE=sync, multipart upload). */
  async readInline(row: AttachmentRow, localPath: string): Promise<AttachmentRow> {
    const outcome = await this.read(row, localPath, undefined, true);
    const [updated] = await this.deps.db.update(attachments).set(outcomePatch(outcome)).where(eq(attachments.id, row.id)).returning();
    return updated!;
  }

  private logError(err: unknown, msg: string, extra: object = {}): void {
    // Ids, codes and names only: an error message can carry file text (Stage 17 NO_CONTENT).
    this.deps.log.error({ ...extra, errName: err instanceof Error ? err.name : typeof err }, msg);
  }
}

class LeaseLost extends Error {
  override name = 'LeaseLost';
}

export function outcomePatch(outcome: Outcome): Partial<AttachmentRow> {
  return outcome.status === 'ready'
    ? {
        status: 'ready',
        error: outcome.error,
        errorCode: '',
        warnings: outcome.warnings,
        extractedText: outcome.extractedText,
        pageCount: outcome.pageCount,
      }
    : { status: 'failed', error: outcome.error, errorCode: outcome.errorCode, warnings: [], extractedText: null, pageCount: null };
}
