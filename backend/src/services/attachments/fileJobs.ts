/**
 * File jobs: the queue and the in-process worker behind the file pipeline (Stage 9 PIPE,
 * ADR-0062, ADR-0063; Cloud Tasks is the deferred Phase 5 executor).
 *
 * A job is a `file_jobs` row. A worker claims one with `FOR UPDATE SKIP LOCKED` (a bare SELECT
 * is not a lock: two workers would both take it) and holds it by a lease it renews while it
 * runs: on a timer, and at every stage. A worker that dies stops renewing; once the lease lapses
 * any worker takes the job over (`attempts` + 1, at most FILE_JOB_MAX_ATTEMPTS, N-44). Every
 * write a job makes to its file is fenced on still holding the lease, so a worker that wakes up
 * after losing its job cannot overwrite what the new holder wrote: a duplicate run of the same
 * version is wasted work, never a second result.
 *
 * Request-based CPU (Cloud Run's default) can starve the timer once a request has returned.
 * Two things keep jobs moving anyway (ADR-0063): every status poll and every `complete` wakes
 * the worker for that file, and the lease (FILE_JOB_LEASE_MS) outlasts the longest step a job
 * takes between stages, so a starved heartbeat does not hand a healthy job to a second worker.
 *
 * One ingest path (D1 #20): chat attachments (`attachment`) and project files (`project`, and
 * `reindex` for the backfill) run the same pipeline, store the same derivative, and differ only
 * in the row they finish and in where their chunks go.
 *
 * Lanes: files up to FILE_FAST_LANE_MAX_BYTES are `fast`, and one worker slot is always kept
 * for them, so a small file never waits behind large ones (Stage 9 G30). Files above
 * FILE_LARGE_JOB_BYTES are large: at most one runs per instance at a time, because a job's
 * working copies (download, members, pieces) count against the instance's memory when the
 * working directory is in memory (ADR-0066, review M1). A chat ZIP is large only when what it
 * unpacks to is (ADR-0070, superseding build-3 decision #10): it is claimed by its own size,
 * and once its central directory is read, a ZIP whose members exceed FILE_LARGE_JOB_BYTES takes
 * the large slot, or goes back to the queue in the `large` lane, its attempt not counted, until
 * the slot is free.
 *
 * A job's first stage is the integrity check (ADR-0066, review N4): the object's generation must
 * be the one `complete` recorded, and the SHA-256 is computed here by streaming the job's own
 * copy, never in the upload request. Both come before the scan and before any reuse lookup.
 */
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import type { Config } from '../../config.js';
import { type Database, withLongStatements } from '../../db/client.js';
import { attachments, fileChunks, fileJobs, projectFiles, type FileWarning } from '../../db/schema.js';
import type { Provider } from '../../providers/types.js';
import { INDEX_VERSION } from '../retrieval.js';
import { generateStorageKey, type ObjectStorage } from '../storage.js';
import {
  countTokens,
  deleteObjects,
  derivedKeys,
  draftFromStored,
  fileChecksum,
  findReusable,
  planChunks,
  putDerivativeObjects,
  retrievalWarning,
  writeDerivative,
  type ChunkPlan,
  type StoredObjects,
  type TokenCounters,
} from './derivatives.js';
import { FileFailure, warning } from './fileErrors.js';
import type { ModelInputStore } from './modelInputStore.js';
import { ocrEngineFor, type OcrEngine } from './ocr.js';
import { failed, readAttachment, type FileStage, type Outcome } from './pipeline.js';
import { storageKeyInUse } from './references.js';
import { noScanner, scannerFor, type Scanner } from './scanner.js';
import { makeWorkDir, setFileTmpDir } from './workDir.js';
import { expandZip, memberStream, plannedUnpackedBytes } from './zipExpand.js';

type AttachmentRow = typeof attachments.$inferSelect;
type ProjectFileRow = typeof projectFiles.$inferSelect;
type JobRow = typeof fileJobs.$inferSelect;
/**
 * A claimed job, and whether it holds this instance's large slot: its file is above
 * FILE_LARGE_JOB_BYTES, or it is in the `large` lane, or it took the slot while running (a ZIP
 * that unpacks past the limit). Whoever ends the job releases the slot when `large` is set.
 */
type ClaimedJob = JobRow & {
  large: boolean;
  /** Counted in `activeNormal` by `launch`: a normal-lane job, or a fast one that turned large. */
  countedNormal?: boolean;
};
/** A transaction, for writes that must land together with the caller's (enqueue at `complete`). */
export type FileTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface FileLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface FileServiceDeps {
  db: Database;
  storage: ObjectStorage;
  cfg: Config;
  /** OCR and transcription (readMedia). */
  visionProvider?: Provider;
  /** Count APIs per model family (Stage 9 TOKENS). */
  tokenCounters?: TokenCounters;
  /** Where large media pieces go for the model to read by `gs://` (D1 #32). */
  modelInputs?: ModelInputStore;
  /** Defaults to FILE_SCANNER's scanner. */
  scanner?: Scanner;
  /** Defaults to the vision provider's engine (Gemini). */
  ocr?: OcrEngine | null;
  log: FileLogger;
}

export interface WorkerOptions {
  leaseMs?: number;
  pollMs?: number;
  concurrency?: number;
  /** Heartbeat interval; 0 turns the timer off (a test of a starved heartbeat). */
  heartbeatMs?: number;
  /** Test seam: called after each stage is recorded, inside the job. */
  afterStage?: (fileId: string, stage: FileStage) => Promise<void>;
  /** FILE_LARGE_JOB_BYTES unless given. */
  largeJobBytes?: number;
}

/** A write that only lands while `owner` still holds job `jobId`. */
interface Fence {
  jobId: string;
  owner: string;
}

/** The file a run reads, and the row it finishes. */
type Target =
  | { scope: 'attachment'; row: AttachmentRow }
  | { scope: 'project'; row: ProjectFileRow };

export class FileService {
  readonly owner = `${os.hostname().slice(0, 32)}:${String(process.pid)}:${randomBytes(4).toString('hex')}`;
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly concurrency: number;
  private readonly heartbeatMs: number;
  private readonly scanner: Scanner;
  private readonly ocr: OcrEngine | null;
  private active = 0;
  private activeNormal = 0;
  /** Large jobs running here, plus a claim in flight that may take one: never above 1. */
  private activeLarge = 0;
  private readonly largeJobBytes: number;
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
    this.heartbeatMs = opts.heartbeatMs ?? Math.max(50, Math.floor(this.leaseMs / 3));
    this.scanner = deps.scanner ?? scannerFor(deps.cfg);
    this.ocr = deps.ocr !== undefined ? deps.ocr : ocrEngineFor(deps.visionProvider);
    this.largeJobBytes = opts.largeJobBytes ?? deps.cfg.FILE_LARGE_JOB_BYTES;
    // Every working copy the pipeline makes goes under FILE_TMP_DIR (ADR-0066).
    setFileTmpDir(deps.cfg.FILE_TMP_DIR);
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

  /**
   * Wakes the worker for one file's live jobs (queued, or running on a lapsed lease), whoever
   * queued them. Called by every status poll and by `complete`, so work advances while a
   * request is open even when nothing else gives the instance CPU (ADR-0063).
   */
  async wake(file: { attachmentId?: string; projectFileId?: string }): Promise<void> {
    const target = file.attachmentId ? eq(fileJobs.attachmentId, file.attachmentId) : file.projectFileId ? eq(fileJobs.projectFileId, file.projectFileId) : null;
    if (!target) return;
    const rows = await this.deps.db
      .select({ id: fileJobs.id })
      .from(fileJobs)
      .where(
        and(
          target,
          sql`${fileJobs.attempts} < ${fileJobs.maxAttempts}`,
          sql`(${fileJobs.state} = 'queued' or (${fileJobs.state} = 'running' and ${fileJobs.leaseExpiresAt} < now()))`,
        ),
      );
    for (const r of rows) this.wanted.add(r.id);
    if (rows.length === 0) {
      const orphan = await this.reconcile(file);
      if (orphan) this.wanted.add(orphan);
    }
    await this.pump();
  }

  /**
   * A file left `queued` with no live job for longer than FILE_ORPHAN_GRACE_MS gets one (review
   * N3, ADR-0066): a crash between a status move and its job insert, or between a ZIP's member
   * rows and their jobs, otherwise leaves a chip that spins forever. The row is locked while it
   * is checked, so two polls at once queue one job.
   */
  private async reconcile(file: { attachmentId?: string; projectFileId?: string }): Promise<string | null> {
    const { db, cfg } = this.deps;
    const grace = sql`${`${String(cfg.FILE_ORPHAN_GRACE_MS)} milliseconds`}::interval`;
    return db.transaction(async (tx) => {
      if (file.attachmentId) {
        const [row] = await tx
          .select()
          .from(attachments)
          .where(and(eq(attachments.id, file.attachmentId), eq(attachments.status, 'queued'), sql`${attachments.createdAt} < now() - ${grace}`))
          .for('update');
        if (!row || (await this.hasRecentJob(tx, eq(fileJobs.attachmentId, row.id), grace))) return null;
        this.deps.log.warn({ attachmentId: row.id }, 'orphaned queued file re-queued');
        return this.enqueueAttachment(row, tx);
      }
      if (file.projectFileId) {
        const [row] = await tx
          .select()
          .from(projectFiles)
          .where(and(eq(projectFiles.id, file.projectFileId), eq(projectFiles.status, 'queued'), sql`${projectFiles.createdAt} < now() - ${grace}`))
          .for('update');
        if (!row || (await this.hasRecentJob(tx, eq(fileJobs.projectFileId, row.id), grace))) return null;
        this.deps.log.warn({ projectFileId: row.id }, 'orphaned queued file re-queued');
        return this.enqueueProjectFile(row, tx);
      }
      return null;
    });
  }

  /**
   * A job that still owns the file: queued with attempts left, any `running` one (held, or
   * lapsed: failExhausted fails a lapsed one with no attempts left, so a new job must not
   * bypass the attempt limit; review R3#5), or one that changed within the grace period.
   */
  private async hasRecentJob(tx: FileTx, target: SQL | undefined, grace: SQL): Promise<boolean> {
    const [row] = await tx
      .select({ id: fileJobs.id })
      .from(fileJobs)
      .where(
        and(
          target,
          sql`((${fileJobs.state} = 'queued' and ${fileJobs.attempts} < ${fileJobs.maxAttempts})
            or ${fileJobs.state} = 'running'
            or ${fileJobs.updatedAt} >= now() - ${grace})`,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** Waits until every job this worker is running or was handed has finished. For tests. */
  async idle(): Promise<void> {
    for (let i = 0; i < 6000; i++) {
      if (this.inFlight.size === 0 && this.wanted.size === 0 && !this.pumping) return;
      await Promise.allSettled([...this.inFlight]);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Claims and runs one due job (of these ids, when given), whoever queued it. For tests. */
  async runOnce(ids?: string[]): Promise<boolean> {
    const job = await this.claim(ids ? { any: false, normalAllowed: true, ids } : { any: true, normalAllowed: true });
    if (!job) return false;
    try {
      await this.runJob(job);
    } finally {
      if (job.large) this.activeLarge -= 1;
    }
    return true;
  }

  /* ------------------------------------------------------------------ queue */

  /**
   * Queues the next read of an attachment. With `tx` the job insert and the status move are part
   * of the caller's transaction (review N3): nothing is queued unless both land, and the caller
   * wakes the worker (`poke`) after its commit.
   */
  async enqueueAttachment(row: AttachmentRow, tx?: FileTx): Promise<string> {
    const { cfg } = this.deps;
    const db = tx ?? this.deps.db;
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
    if (!tx) this.poke(job.id);
    return job.id;
  }

  /** A project file read (upload, replace or re-index) as a job, the next version of its reads. */
  async enqueueProjectFile(row: ProjectFileRow, tx?: FileTx): Promise<string> {
    const { cfg } = this.deps;
    const db = tx ?? this.deps.db;
    const [last] = await db
      .select({ v: sql<number>`coalesce(max(${fileJobs.version}), 0)::int` })
      .from(fileJobs)
      .where(and(eq(fileJobs.projectFileId, row.id), inArray(fileJobs.kind, ['project', 'reindex'])));
    const [job] = await db
      .insert(fileJobs)
      .values({
        userId: row.userId,
        projectFileId: row.id,
        kind: 'project',
        version: (last?.v ?? 0) + 1,
        lane: row.sizeBytes <= cfg.FILE_FAST_LANE_MAX_BYTES ? 'fast' : 'normal',
        maxAttempts: cfg.FILE_JOB_MAX_ATTEMPTS, // N-44
      })
      .onConflictDoNothing()
      .returning({ id: fileJobs.id });
    if (!job) throw new Error('file job already exists for this version');
    await db.update(projectFiles).set({ status: 'queued', error: '', errorCode: '' }).where(eq(projectFiles.id, row.id));
    if (!tx) this.poke(job.id);
    return job.id;
  }

  /**
   * One `reindex` job per project file written by an older indexer; idempotent per version
   * (the job's version is INDEX_VERSION, so a second backfill inserts nothing).
   */
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

  /**
   * Claims one due job. A large one only while no other large job runs here (ADR-0066): the
   * large slot is taken before the query, so two claims in flight cannot both take a large job,
   * and given back at once when the job claimed is not large. Whoever runs a large job releases
   * the slot when it ends.
   */
  private async claim(scope: { any: boolean; normalAllowed: boolean; ids?: string[] }): Promise<ClaimedJob | null> {
    const largeAllowed = this.activeLarge === 0;
    if (largeAllowed) this.activeLarge += 1;
    let job: ClaimedJob | null = null;
    try {
      job = await this.claimRow(scope, largeAllowed);
      return job;
    } finally {
      if (largeAllowed && !job?.large) this.activeLarge -= 1;
    }
  }

  private async claimRow(scope: { any: boolean; normalAllowed: boolean; ids?: string[] }, largeAllowed: boolean): Promise<ClaimedJob | null> {
    const lease = `${String(this.leaseMs)} milliseconds`;
    const target = scope.any ? sql`true` : sql`fj.id in ${scope.ids && scope.ids.length ? sql`(${sql.join(scope.ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql`(null)`}`;
    const lane = scope.normalAllowed ? sql`true` : sql`fj.lane = 'fast'`;
    // Large: the stored file is above FILE_LARGE_JOB_BYTES, or the job is in the `large` lane: a
    // chat ZIP that found it unpacks past the limit and waits for the slot (ADR-0070). A ZIP's
    // unpacked size is not known here; `expand` decides once it has read the directory.
    const isLarge = (job: SQL) =>
      sql`(coalesce((select a.size_bytes from attachments a where a.id = ${job}.attachment_id), (select p.size_bytes from project_files p where p.id = ${job}.project_file_id), 0) > ${this.largeJobBytes}
        or ${job}.lane = 'large')`;
    const sizeFits = largeAllowed ? sql`true` : sql`not ${isLarge(sql.raw('fj'))}`;
    const rows = await this.deps.db.execute(sql`
      update file_jobs set
        state = 'running',
        attempts = attempts + 1,
        lease_owner = ${this.owner},
        lease_expires_at = now() + ${lease}::interval,
        updated_at = now()
      where id = (
        select fj.id from file_jobs fj
        where ${target} and ${lane} and ${sizeFits}
          and fj.attempts < fj.max_attempts
          and (fj.state = 'queued' or (fj.state = 'running' and fj.lease_expires_at < now()))
        order by (fj.lane = 'fast') desc, fj.created_at
        for update skip locked
        limit 1)
      returning id, ${isLarge(sql.raw('file_jobs'))} as is_large`);
    const raw = (rows as unknown as Array<Record<string, unknown>>)[0];
    if (!raw) return null;
    // `execute` returns column names, not the schema's field names.
    const [job] = await this.deps.db.select().from(fileJobs).where(eq(fileJobs.id, String(raw['id'])));
    return job ? { ...job, large: raw['is_large'] === true } : null;
  }

  /** Jobs whose lease lapsed with no attempts left: the file fails as `timeout`. */
  private async failExhausted(): Promise<void> {
    const { db } = this.deps;
    const rows = await db
      .update(fileJobs)
      .set({ state: 'failed', errorCode: 'timeout', leaseOwner: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(fileJobs.state, 'running'), sql`${fileJobs.leaseExpiresAt} < now()`, sql`${fileJobs.attempts} >= ${fileJobs.maxAttempts}`))
      .returning({ attachmentId: fileJobs.attachmentId, projectFileId: fileJobs.projectFileId });
    const out = failed('timeout');
    const error = out.status === 'failed' ? out.error : '';
    const ids = rows.map((r) => r.attachmentId).filter((v): v is string => Boolean(v));
    if (ids.length) await db.update(attachments).set({ status: 'failed', error, errorCode: 'timeout' }).where(inArray(attachments.id, ids));
    const pids = rows.map((r) => r.projectFileId).filter((v): v is string => Boolean(v));
    if (pids.length) await db.update(projectFiles).set({ status: 'failed', error, errorCode: 'timeout' }).where(inArray(projectFiles.id, pids));
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
      .select({ id: fileJobs.id, state: fileJobs.state, attempts: fileJobs.attempts, max: fileJobs.maxAttempts })
      .from(fileJobs)
      .where(inArray(fileJobs.id, [...this.wanted]));
    const live = new Set(rows.filter((r) => (r.state === 'queued' || r.state === 'running') && r.attempts < r.max).map((r) => r.id));
    for (const id of [...this.wanted]) {
      // A running job held by another worker stays wanted: if that worker dies, this one resumes it.
      if (!live.has(id)) this.wanted.delete(id);
    }
  }

  private launch(job: ClaimedJob): void {
    this.active += 1;
    job.countedNormal = job.lane !== 'fast';
    if (job.countedNormal) this.activeNormal += 1;
    const p = this.runJob(job).finally(() => {
      this.active -= 1;
      if (job.countedNormal) this.activeNormal -= 1;
      if (job.large) this.activeLarge -= 1;
      this.inFlight.delete(p);
      if (!this.dead) void this.pump();
    });
    this.inFlight.add(p);
  }

  /* ------------------------------------------------------------------ run */

  /** Pushes the lease out; false when this worker no longer holds the job. */
  private async renew(fence: Fence): Promise<boolean> {
    if (this.dead) return false;
    const [row] = await this.deps.db
      .update(fileJobs)
      .set({ leaseExpiresAt: sql`now() + ${`${String(this.leaseMs)} milliseconds`}::interval`, updatedAt: new Date() })
      .where(and(eq(fileJobs.id, fence.jobId), eq(fileJobs.leaseOwner, fence.owner), eq(fileJobs.state, 'running')))
      .returning({ id: fileJobs.id });
    return Boolean(row);
  }

  private async runJob(job: ClaimedJob): Promise<void> {
    const fence: Fence = { jobId: job.id, owner: this.owner };
    const beat =
      this.heartbeatMs > 0
        ? setInterval(() => {
            if (!this.dead) void this.renew(fence).catch((err: unknown) => this.logError(err, 'file job heartbeat failed', { jobId: job.id }));
          }, this.heartbeatMs)
        : undefined;
    beat?.unref();
    const started = Date.now();
    try {
      if (job.kind === 'attachment') await this.runAttachmentJob(job, fence);
      else await this.runProjectJob(job, fence);
      this.deps.log.info({ jobId: job.id, kind: job.kind, attempt: job.attempts, ms: Date.now() - started }, 'file job finished');
    } catch (err) {
      if (err instanceof WaitForLargeSlot) {
        if (!this.dead) await this.deferForLargeSlot(job, fence);
        return;
      }
      this.logError(err, 'file job failed', { jobId: job.id, kind: job.kind, attempt: job.attempts });
      if (!this.dead) await this.release(job, fence);
    } finally {
      if (beat) clearInterval(beat);
    }
  }

  /**
   * A ZIP that unpacks past FILE_LARGE_JOB_BYTES while this instance's large slot is taken (or,
   * claimed in the fast lane, while every normal slot is): back
   * to the queue in the `large` lane, the claim's attempt given back (waiting is not a failure),
   * the file `queued` again. The claim query skips a `large` job while the slot is taken, so it
   * is not picked up again until the large job ends and wakes the worker: no busy loop. It
   * defers at most once, since the next claim gives it the slot.
   */
  private async deferForLargeSlot(job: ClaimedJob, fence: Fence): Promise<void> {
    const { db } = this.deps;
    const moved = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(fileJobs)
        .set({ state: 'queued', lane: 'large', attempts: sql`greatest(${fileJobs.attempts} - 1, 0)`, leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date() })
        .where(and(eq(fileJobs.id, fence.jobId), eq(fileJobs.leaseOwner, fence.owner), eq(fileJobs.state, 'running')))
        .returning({ id: fileJobs.id });
      if (row && job.attachmentId) await tx.update(attachments).set({ status: 'queued' }).where(eq(attachments.id, job.attachmentId));
      return Boolean(row);
    });
    if (!moved) return;
    this.deps.log.info({ jobId: job.id }, 'file job waits for the large slot');
    this.poke(job.id);
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
    if (exhausted) {
      const out = failed('timeout');
      const patch = { status: 'failed', error: out.status === 'failed' ? out.error : '', errorCode: 'timeout' };
      if (job.attachmentId) await db.update(attachments).set(patch).where(eq(attachments.id, job.attachmentId));
      if (job.projectFileId) await db.update(projectFiles).set(patch).where(eq(projectFiles.id, job.projectFileId));
    } else {
      this.poke(job.id);
    }
  }

  private async finish(fence: Fence, state: 'done' | 'failed'): Promise<void> {
    await this.deps.db
      .update(fileJobs)
      .set({ state, leaseOwner: null, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(fileJobs.id, fence.jobId), eq(fileJobs.leaseOwner, fence.owner)));
  }

  private async runAttachmentJob(job: ClaimedJob, fence: Fence): Promise<void> {
    const [row] = job.attachmentId ? await this.deps.db.select().from(attachments).where(eq(attachments.id, job.attachmentId)) : [];
    if (!row) {
      // Deleted while queued (G29): nothing to read, nothing to clean.
      await this.finish(fence, 'done');
      return;
    }
    await this.process({ scope: 'attachment', row }, job, fence, null);
  }

  private async runProjectJob(job: ClaimedJob, fence: Fence): Promise<void> {
    const [row] = job.projectFileId ? await this.deps.db.select().from(projectFiles).where(eq(projectFiles.id, job.projectFileId)) : [];
    if (!row) {
      await this.finish(fence, 'done');
      return;
    }
    await this.process({ scope: 'project', row }, job, fence, null);
  }

  /**
   * Reads one file end to end and finishes its row. With a fence, every write is the lease
   * holder's; without one (an attachment read inside its request), there is no job to lose.
   * `localPath` is the file already on disk; otherwise it is downloaded here.
   */
  private async process(target: Target, job: ClaimedJob | null, fence: Fence | null, localPath: string | null): Promise<void> {
    const { db, storage } = this.deps;
    const row = target.row;
    const dir = await makeWorkDir('arcnave-job-');
    let objects: StoredObjects | null = null;
    try {
      const local = localPath ?? path.join(dir, 'file');
      if (!localPath) await storage.downloadTo(row.storageKey, local);
      const holds = async () => (fence ? this.renew(fence) : true);
      const setStage = async (stage: FileStage) => {
        if (!(await holds())) throw new LeaseLost();
        if (target.scope === 'attachment') await db.update(attachments).set({ status: stage }).where(eq(attachments.id, row.id));
        else await db.update(projectFiles).set({ status: stage }).where(eq(projectFiles.id, row.id));
        await this.opts.afterStage?.(row.id, stage);
        if (!(await holds())) throw new LeaseLost();
      };

      const verified = await this.verifyBytes(target, local, fence);
      let outcome = verified.failure ?? (await this.read(target, local, dir, setStage, fence, verified.checksum, job));
      // Count and chunk the derivative (Stage 9 TOKENS / CHUNK).
      let counts = null;
      let plan: ChunkPlan | null = null;
      if (outcome.status === 'ready' && outcome.derivative) {
        const d = outcome.derivative;
        d.sidecar['scanner'] = this.scanner.name;
        counts = await countTokens(d.markdown, d.markdownChars, this.deps.tokenCounters ?? {}, this.deps.cfg);
        plan = d.markdownChars > 0 ? planChunks(d, counts) : null;
        if (!(await holds())) throw new LeaseLost();
        objects = await putDerivativeObjects(storage, row.userId, d);
      }
      if (target.scope === 'project' && outcome.status === 'ready' && outcome.derivative === undefined) {
        // A ZIP inside a project is not unpacked there.
        outcome = failed('unsupported_type');
      }

      const committed = await db.transaction(async (tx) => {
        // A file's derivative, pages and chunks can be many rows: N-45's executor statement time.
        await withLongStatements(tx, this.deps.cfg);
        if (fence) {
          const [held] = await tx
            .update(fileJobs)
            .set({ state: 'done', leaseOwner: null, finishedAt: new Date(), updatedAt: new Date(), errorCode: outcome.status === 'failed' ? outcome.errorCode : '' })
            .where(and(eq(fileJobs.id, fence.jobId), eq(fileJobs.leaseOwner, fence.owner), eq(fileJobs.state, 'running')))
            .returning({ id: fileJobs.id });
          if (!held || this.dead) throw new LeaseLost();
        }
        let replaced: string[] = [];
        const extra = retrievalWarning(target.scope === 'attachment' ? plan : null);
        if (outcome.status === 'ready' && outcome.derivative && objects && counts) {
          const w = await writeDerivative(tx, {
            userId: row.userId,
            ...(target.scope === 'attachment' ? { attachmentId: row.id } : { projectFileId: row.id }),
            version: job?.version ?? 0,
            checksumSha256: verified.checksum,
            draft: outcome.derivative,
            objects,
            counts,
            plan,
            extraWarnings: extra,
          });
          replaced = w.replacedKeys;
        }
        if (target.scope === 'attachment') {
          await tx.update(attachments).set(outcomePatch(outcome, extra)).where(eq(attachments.id, row.id));
        } else {
          await tx.update(projectFiles).set(await this.projectPatch(tx, target.row, outcome, plan)).where(eq(projectFiles.id, row.id));
        }
        return replaced;
      });
      objects = null;
      await deleteObjects(storage, committed);
    } catch (err) {
      if (objects) await deleteObjects(storage, [objects.markdownKey, objects.normalizedKey].filter((k): k is string => Boolean(k)));
      if (err instanceof LeaseLost) return;
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * The job's first stage (D1 #35, review N4): the object must still be the generation `complete`
   * recorded (a project file: the one stored), checked after the download so the local copy is
   * that generation; then the SHA-256 of that copy, streamed, onto the row. A changed object is
   * `corrupt`. Runs before the scan and before any reuse lookup, which is keyed on the checksum.
   */
  private async verifyBytes(target: Target, local: string, fence: Fence | null): Promise<{ checksum: string; failure: Outcome | null }> {
    const { db, storage } = this.deps;
    const row = target.row;
    if (row.objectGeneration) {
      const now = await storage.generation(row.storageKey);
      if (now !== row.objectGeneration) return { checksum: '', failure: failed('corrupt', 'This file changed after it was uploaded. Upload it again.') };
    }
    const checksum = await fileChecksum(local);
    if (checksum !== row.checksumSha256) {
      if (fence && !(await this.renew(fence))) throw new LeaseLost();
      if (target.scope === 'attachment') await db.update(attachments).set({ checksumSha256: checksum }).where(eq(attachments.id, row.id));
      else await db.update(projectFiles).set({ checksumSha256: checksum }).where(eq(projectFiles.id, row.id));
    }
    return { checksum, failure: null };
  }

  /** Scan, then reuse a derivative of the same bytes (G3), or run the pipeline. */
  private async read(
    target: Target,
    local: string,
    dir: string,
    setStage: (stage: FileStage) => Promise<void>,
    fence: Fence | null,
    checksum: string,
    /** The claimed job, when this read runs as one: a ZIP may need its large slot. */
    job: ClaimedJob | null,
  ): Promise<Outcome> {
    const { db, storage, cfg } = this.deps;
    const row = target.row;
    await setStage('scanning');
    try {
      await this.scanner.scan(local);
    } catch (err) {
      if (err instanceof FileFailure) return failed(err.code, err.detail);
      throw err;
    }
    const reuse = await findReusable(
      db,
      row.userId,
      checksum,
      this.scanner.name,
      target.scope === 'attachment' ? { attachmentId: row.id } : { projectFileId: row.id },
    );
    if (reuse) {
      await setStage('extracting');
      const d = await draftFromStored(db, storage, reuse, dir);
      const pageCount = typeof d.sidecar['pageCount'] === 'number' ? (d.sidecar['pageCount'] as number) : null;
      const text = d.markdown && d.markdown.length <= cfg.EXTRACTED_TEXT_MAX_CHARS && d.markdown.trim() !== '' ? d.markdown : null;
      return { status: 'ready', error: d.warnings.map((w) => w.detail).join(' '), warnings: d.warnings, extractedText: text, pageCount, derivative: d };
    }
    const controller = new AbortController();
    return readAttachment({
      path: local,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      cfg,
      workDir: dir,
      scanner: noScanner, // scanned above, before any reuse
      ocr: this.ocr,
      signal: controller.signal,
      ...(this.deps.visionProvider ? { visionProvider: this.deps.visionProvider } : {}),
      ...(this.deps.modelInputs ? { modelInputs: this.deps.modelInputs } : {}),
      setStage: async (stage) => {
        if (stage === 'scanning') return;
        try {
          await setStage(stage);
        } catch (err) {
          controller.abort();
          throw err;
        }
      },
      replaceStored: async (strippedPath) => {
        if (fence && !(await this.renew(fence))) throw new LeaseLost();
        const bytes = await readFile(strippedPath);
        await storage.put(row.storageKey, bytes, row.mimeType);
        const generation = (await storage.generation(row.storageKey)) ?? '';
        if (target.scope === 'attachment') await db.update(attachments).set({ sizeBytes: bytes.length, objectGeneration: generation }).where(eq(attachments.id, row.id));
        else await db.update(projectFiles).set({ sizeBytes: bytes.length, objectGeneration: generation }).where(eq(projectFiles.id, row.id));
      },
      ...(target.scope === 'attachment' ? { expandZip: (zipPath: string) => this.expand(target.row, zipPath, fence === null, job) } : {}),
    });
  }

  /** The project file's row after a read: its status, warnings and fresh chunks (`file_chunks`). */
  private async projectPatch(tx: Parameters<Parameters<Database['transaction']>[0]>[0], row: ProjectFileRow, outcome: Outcome, plan: ChunkPlan | null): Promise<Partial<ProjectFileRow>> {
    await tx.delete(fileChunks).where(eq(fileChunks.projectFileId, row.id));
    const base = { indexVersion: INDEX_VERSION, indexedAt: new Date() };
    if (outcome.status === 'failed') {
      return { ...base, status: 'failed', error: outcome.error, errorCode: outcome.errorCode, warnings: [], chunkCount: 0 };
    }
    const chunks = plan?.chunks ?? [];
    if (chunks.length === 0) {
      const isImage = row.mimeType.startsWith('image/');
      const note = outcome.warnings.find((w) => w.code === 'not_extracted')?.detail;
      return {
        ...base,
        status: 'unsupported',
        error: isImage ? 'Images are stored and can be attached to messages, but their contents are not indexed.' : (note ?? 'This file contained no extractable text.'),
        errorCode: isImage ? 'unsupported_type' : 'corrupt',
        warnings: [],
        chunkCount: 0,
      };
    }
    for (let i = 0; i < chunks.length; i += 500) {
      await tx.insert(fileChunks).values(
        chunks.slice(i, i + 500).map((c, j) => ({
          projectFileId: row.id,
          projectId: row.projectId,
          ordinal: i + j,
          text: c.text,
          charCount: c.text.length,
          page: c.page,
        })),
      );
    }
    // Never a silent cut (E4): the user and the whole-file prompt both learn it stopped here.
    const warnings: FileWarning[] = [...outcome.warnings];
    if (plan?.capped) {
      warnings.push(warning('chunk_cap', `Only the first ${chunks.length.toLocaleString('en-US')} parts of this file can be searched; the rest is not indexed.`));
    }
    return { ...base, status: 'ready', error: '', errorCode: '', warnings, chunkCount: chunks.length };
  }

  /**
   * A ZIP's members become attachments of their own, each read by the same pipeline: queued as
   * jobs, or read here when the ZIP itself is being read inside a request.
   */
  private async expand(parent: AttachmentRow, zipPath: string, inline: boolean, job: ClaimedJob | null): Promise<Outcome> {
    const { db, storage } = this.deps;
    if (job) await this.takeLargeSlotIfNeeded(job, zipPath);
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
          objectGeneration: (await storage.generation(storageKey)) ?? '',
        })
        .returning();
      if (inline) {
        // The member's file lives in expandZip's own directory until this callback returns.
        await this.process({ scope: 'attachment', row: row! }, null, null, member.localPath);
      }
      created.push(row!);
    });
    if (!inline) for (const row of created) await this.enqueueAttachment(row);
    const detail = `Unpacked ${String(names.length)} file${names.length === 1 ? '' : 's'}: ${names.join(', ')}.`.slice(0, 2000);
    return { status: 'ready', error: detail, warnings: [warning('zip_members', detail)], extractedText: null, pageCount: null };
  }

  /**
   * A ZIP's expansion is a large job when its members unpack past FILE_LARGE_JOB_BYTES (Stage 9
   * G30, ADR-0070), decided from the central directory before anything is written: the inflate
   * never writes more than a member declares, so the declared total bounds the disk it takes.
   * Over the limit, the job takes the large slot if it is free (released when the job ends,
   * `ClaimedJob.large`), or waits for it (`WaitForLargeSlot`, deferForLargeSlot).
   */
  private async takeLargeSlotIfNeeded(job: ClaimedJob, zipPath: string): Promise<void> {
    if (job.large) return;
    if ((await plannedUnpackedBytes(zipPath, this.deps.cfg)) <= this.largeJobBytes) return;
    if (this.activeLarge > 0) throw new WaitForLargeSlot();
    if (job.countedNormal === false) {
      // Claimed in the fast lane by its stored size, it is now a large expansion: it leaves the
      // slot kept for small files and counts as normal work, so the pump keeps that slot free
      // (G30). With every normal slot taken it waits instead (review build-3-fix r1).
      if (this.concurrency > 1 && this.activeNormal >= this.concurrency - 1) throw new WaitForLargeSlot();
      this.activeNormal += 1;
      job.countedNormal = true;
    }
    this.activeLarge += 1;
    job.large = true;
  }

  /** Deletes a ZIP's members, rows and the bytes nothing else reads. */
  async removeMembers(parentId: string): Promise<void> {
    const { db, storage } = this.deps;
    // Only members not yet sent: a sent member belongs to its message now.
    const unsent = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(and(eq(attachments.parentAttachmentId, parentId), isNull(attachments.messageId)));
    const derived = await derivedKeys(db, { attachmentIds: unsent.map((u) => u.id) });
    const members = await db
      .delete(attachments)
      .where(and(eq(attachments.parentAttachmentId, parentId), isNull(attachments.messageId)))
      .returning();
    for (const m of members) {
      if (await storageKeyInUse(db, m.storageKey)) continue;
      // benign: an orphan costs storage, not data; the member rows are already gone
      await storage.delete(m.storageKey).catch(() => undefined);
    }
    await deleteObjects(storage, derived);
  }

  /** Reads an attachment inside the request (FILE_PIPELINE=sync, multipart upload). */
  async readInline(row: AttachmentRow, localPath: string): Promise<AttachmentRow> {
    await this.process({ scope: 'attachment', row }, null, null, localPath);
    const [updated] = await this.deps.db.select().from(attachments).where(eq(attachments.id, row.id));
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

/** A ZIP job that needs the large slot while another large job holds it (ADR-0070). */
class WaitForLargeSlot extends Error {
  override name = 'WaitForLargeSlot';
}

export function outcomePatch(outcome: Outcome, extra: FileWarning[] = []): Partial<AttachmentRow> {
  if (outcome.status === 'ready') {
    const warnings = [...outcome.warnings, ...extra];
    return {
      status: 'ready',
      error: warnings.map((w) => w.detail).join(' ') || outcome.error,
      errorCode: '',
      warnings,
      extractedText: outcome.extractedText,
      pageCount: outcome.pageCount,
    };
  }
  return { status: 'failed', error: outcome.error, errorCode: outcome.errorCode, warnings: [], extractedText: null, pageCount: null };
}
