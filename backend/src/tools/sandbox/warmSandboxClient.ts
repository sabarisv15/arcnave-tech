/**
 * run_python on the warm sandbox service (ADR-0010): a long-lived Cloud Run service that keeps
 * one workspace per chat, so a call costs roughly what its code costs and files written by one
 * call are there for the next.
 *
 * Inputs travel by content hash. Each run names the workspace's input files with their sha256;
 * the service answers 409 with the names it does not hold (or holds different bytes for), and
 * only those are uploaded, in chunks under Cloud Run's 32 MiB request cap. So a large PDF is
 * sent once per chat, and no file is ever silently left behind.
 *
 * A chat's workspace also outlives the instance that holds it (ADR-0015): `checkpointIdle` copies
 * idle workspaces' files to storage, and a run into an instance that no longer has them puts them
 * back first (the service answers 409 restore_state).
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { ProviderError } from '../../providers/types.js';
import type { SandboxClient, SandboxExecutionOptions, SandboxExecutionResult } from './client.js';
import type { CheckpointManifest, WorkspaceStateStore } from './workspaceState.js';

const CHUNK_BYTES = 16 * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,200}$/;
/**
 * Time to copy a checkpoint in or out: a floor plus 1 s per 10 MB. Not measured on Cloud Run;
 * a floor this generous means a slow copy is reported as a timeout, never cut short silently.
 */
const TRANSFER_FLOOR_MS = 60_000;
const TRANSFER_BYTES_PER_MS = 10_000;
const transferBudget = (bytes: number): number => TRANSFER_FLOOR_MS + Math.ceil(bytes / TRANSFER_BYTES_PER_MS);

export interface WarmSandboxDeps {
  baseUrl: string;
  /** Authorization header value for the service, or null when it needs none (local dev). */
  authorization: () => Promise<string | null>;
  fetch?: typeof fetch;
  codeTimeoutMs: number;
  /** Added to codeTimeoutMs for transfers and queueing before the call is abandoned. */
  transferBudgetMs: number;
  maxCodeBytes: number;
  /** Checkpoints of chat workspaces. Without it a workspace lives only as long as its instance. */
  state?: WorkspaceStateStore;
}

interface StateListing {
  generation: number;
  files: { path: string; size: number; mtime_ns: string }[];
  skipped: number;
}

interface RunResponse {
  msg_out: string;
  msg_err: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
  /** dir: "output" (files for the user) or "view" (images for the model to look at). */
  outputs: { dir: 'output' | 'view'; name: string; sizeBytes: number; sha256: string; mimeType: string }[];
  outputs_omitted?: number;
}

/** The workspace id for a session key; the key itself (user and chat ids) never leaves here. */
export function workspaceIdFor(sessionKey: string): string {
  return crypto.createHash('sha256').update(`arcnave-sandbox:${sessionKey}`).digest('hex').slice(0, 32);
}

export class WarmSandboxClient implements SandboxClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: WarmSandboxDeps) {
    this.fetchImpl = deps.fetch ?? fetch;
  }

  async runPython(
    code: string,
    signal: AbortSignal,
    options?: SandboxExecutionOptions,
  ): Promise<SandboxExecutionResult> {
    if (Buffer.byteLength(code, 'utf-8') > this.deps.maxCodeBytes) {
      throw new ProviderError(
        `Submitted code exceeds the ${String(this.deps.maxCodeBytes)}-byte sandbox limit.`,
        { code: 'provider_error' },
      );
    }
    let deadline = AbortSignal.timeout(this.deps.codeTimeoutMs + this.deps.transferBudgetMs);
    let combined = AbortSignal.any([signal, deadline]);
    // Without a session the workspace is single-use and removed afterwards, like the Job was.
    const ephemeral = !options?.sessionKey;
    const ws = options?.sessionKey ? workspaceIdFor(options.sessionKey) : crypto.randomBytes(16).toString('hex');
    const state = ephemeral ? undefined : this.deps.state;

    try {
      const inputs = await this.readInputs(options?.workspaceDir);
      const manifest = inputs.map(({ name, sha256 }) => ({ name, sha256 }));
      const row = state ? await state.row(ws) : null;
      if (state && options?.owner) await state.recordRun(ws, options.owner);
      let res = await this.run(ws, code, manifest, Boolean(row?.manifestKey), combined);
      if ('restore' in res) {
        // The copy has its own budget; the run's clock starts once the files are back.
        await this.restore(ws, row?.manifestKey ?? null, signal);
        deadline = AbortSignal.timeout(this.deps.codeTimeoutMs + this.deps.transferBudgetMs);
        combined = AbortSignal.any([signal, deadline]);
        res = await this.run(ws, code, manifest, false, combined);
      }
      if ('restore' in res) {
        throw new ProviderError('Sandbox asked for its checkpoint again after it was restored.', { code: 'provider_error' });
      }
      if ('missing' in res) {
        for (const name of res.missing) {
          const file = inputs.find((i) => i.name === name);
          if (!file) throw new ProviderError(`Sandbox asked for unknown input "${name}".`, { code: 'provider_error' });
          await this.upload(ws, file, combined);
        }
        res = await this.run(ws, code, manifest, false, combined);
        if ('missing' in res || 'restore' in res) {
          throw new ProviderError(
            `Sandbox still lacks input files after upload: ${'missing' in res ? res.missing.join(', ') : 'its checkpoint'}.`,
            { code: 'provider_error' },
          );
        }
      }

      if (options?.workspaceDir && res.outputs.length > 0) {
        for (const out of res.outputs) {
          if (!SAFE_NAME.test(out.name) || (out.dir !== 'output' && out.dir !== 'view')) continue;
          const outputDir = path.join(options.workspaceDir, out.dir);
          await fs.mkdir(outputDir, { recursive: true });
          const bytes = await this.download(ws, out.dir, out.name, out.sizeBytes, combined);
          if (crypto.createHash('sha256').update(bytes).digest('hex') !== out.sha256) {
            throw new ProviderError(`Output "${out.name}" changed while it was being copied back.`, {
              code: 'provider_error',
            });
          }
          await fs.writeFile(path.join(outputDir, out.name), bytes);
        }
      }

      let stderr = res.msg_err;
      if (res.outputs_omitted) stderr += `\n${String(res.outputs_omitted)} more output file(s) were not returned (limit 50 per run).`;
      return {
        outputs: [
          {
            mimeType: 'application/json',
            text: JSON.stringify({
              msg_out: res.msg_out,
              msg_err: stderr,
              exit_code: res.exit_code,
              timed_out: res.timed_out,
            }),
          },
        ],
      };
    } catch (err) {
      if (deadline.aborted && !signal.aborted) {
        throw new ProviderError(
          `The sandbox did not finish within ${String(this.deps.codeTimeoutMs + this.deps.transferBudgetMs)} ms.`,
          { code: 'provider_timeout' },
        );
      }
      throw err;
    } finally {
      if (ephemeral) {
        await this.request('DELETE', `/v1/workspaces/${ws}`, undefined, AbortSignal.timeout(10_000)).catch(() => undefined);
      }
    }
  }

  private async readInputs(workspaceDir?: string): Promise<{ name: string; sha256: string; path: string; size: number }[]> {
    if (!workspaceDir) return [];
    const dir = path.join(workspaceDir, 'input');
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: { name: string; sha256: string; path: string; size: number }[] = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!SAFE_NAME.test(e.name)) {
        // Never skip silently: a file the code expects and cannot find is the bug this replaces.
        throw new ProviderError(`Input file name "${e.name}" cannot be sent to the sandbox.`, { code: 'provider_error' });
      }
      const p = path.join(dir, e.name);
      const hash = crypto.createHash('sha256');
      const handle = await fs.open(p);
      let size = 0;
      try {
        for await (const chunk of handle.createReadStream()) {
          hash.update(chunk as Buffer);
          size += (chunk as Buffer).length;
        }
      } finally {
        await handle.close();
      }
      out.push({ name: e.name, sha256: hash.digest('hex'), path: p, size });
    }
    return out;
  }

  private async run(
    ws: string,
    code: string,
    inputs: { name: string; sha256: string }[],
    restoreState: boolean,
    signal: AbortSignal,
  ): Promise<RunResponse | { missing: string[] } | { restore: true }> {
    const res = await this.request(
      'POST',
      `/v1/workspaces/${ws}/run`,
      JSON.stringify({ code, timeoutMs: this.deps.codeTimeoutMs, inputs, restoreState }),
      signal,
      'application/json',
    );
    if (res.status === 409) {
      const body = (await res.json()) as { missing?: string[]; error?: string };
      if (Array.isArray(body.missing)) return { missing: body.missing };
      if (body.error === 'restore_state') return { restore: true };
    }
    await this.expectOk(res, 'run');
    return (await res.json()) as RunResponse;
  }

  /** Puts a checkpoint back into a fresh workspace, file by file, then lets it run. */
  private async restore(ws: string, manifestKey: string | null, signal: AbortSignal): Promise<void> {
    const state = this.deps.state!;
    const manifest = await state.loadManifest(manifestKey);
    const files = Object.entries(manifest?.files ?? {});
    const total = files.reduce((n, [, f]) => n + f.size, 0);
    const budget = AbortSignal.any([signal, AbortSignal.timeout(transferBudget(total))]);
    for (const [rel, entry] of files) {
      let offset = 0;
      const pending: Buffer[] = [];
      let pendingBytes = 0;
      const send = async (chunk: Buffer): Promise<boolean> => {
        const res = await this.request(
          'PUT',
          `/v1/workspaces/${ws}/state/file?path=${encodeURIComponent(rel)}&offset=${String(offset)}` +
            `&total=${String(entry.size)}&sha256=${entry.sha256}&mtime_ns=${entry.mtimeNs}`,
          chunk,
          budget,
          'application/octet-stream',
        );
        // Another call for this chat ran first; its files are newer than the checkpoint.
        if (res.status === 409 && ((await res.clone().json()) as { error?: string }).error === 'not_fresh') return false;
        await this.expectOk(res, `restore of "${rel}"`);
        offset += chunk.length;
        return true;
      };
      for await (const part of state.storage.openRead(entry.key)) {
        pending.push(part as Buffer);
        pendingBytes += (part as Buffer).length;
        while (pendingBytes >= CHUNK_BYTES) {
          const all = Buffer.concat(pending);
          if (!(await send(all.subarray(0, CHUNK_BYTES)))) return;
          pending.splice(0, pending.length, all.subarray(CHUNK_BYTES));
          pendingBytes = all.length - CHUNK_BYTES;
        }
      }
      if (pendingBytes > 0 || entry.size === 0) {
        if (!(await send(Buffer.concat(pending)))) return;
      }
    }
    const done = await this.request('POST', `/v1/workspaces/${ws}/state/restored`, '', budget);
    await this.expectOk(done, 'restore');
  }

  /**
   * Checkpoints every workspace idle for `idleSeconds` with runs not yet saved, up to `limit`.
   * One failure is logged and the rest continue; the next sweep retries it.
   */
  async checkpointIdle(
    idleSeconds: number,
    limit: number,
    log: { warn: (obj: object, msg: string) => void },
  ): Promise<{ saved: number; failed: number }> {
    if (!this.deps.state) return { saved: 0, failed: 0 };
    const listRes = await this.request('GET', `/v1/workspaces?idle_s=${String(idleSeconds)}`, undefined, AbortSignal.timeout(30_000));
    await this.expectOk(listRes, 'workspace listing');
    const { workspaces } = (await listRes.json()) as { workspaces: { id: string; generation: number }[] };
    let saved = 0;
    let failed = 0;
    for (const w of workspaces.slice(0, limit)) {
      try {
        if (await this.checkpoint(w.id, w.generation)) saved++;
      } catch (err) {
        failed++;
        log.warn({ err, workspace: w.id }, 'sandbox checkpoint failed; the next sweep retries');
      }
    }
    return { saved, failed };
  }

  /** Copies what changed since the last checkpoint. False when the workspace ran meanwhile. */
  private async checkpoint(ws: string, generation: number): Promise<boolean> {
    const state = this.deps.state!;
    const listing = await this.stateListing(ws, AbortSignal.timeout(30_000));
    if (!listing || listing.generation !== generation) return false;
    const row = await state.row(ws);
    if (!row) {
      // No chat owns it any more (purged): nothing to keep, and nothing to list it again for.
      await this.markSaved(ws, generation);
      return false;
    }
    const previous = (await state.loadManifest(row.manifestKey)) ?? { version: 1, files: {} };
    const next: CheckpointManifest = { version: 1, files: {} };
    const uploaded: string[] = [];
    const changed = listing.files.filter((f) => {
      const prev = previous.files[f.path];
      if (prev && prev.size === f.size && prev.mtimeNs === f.mtime_ns) {
        next.files[f.path] = prev;
        return false;
      }
      return true;
    });
    const budget = AbortSignal.timeout(transferBudget(changed.reduce((n, f) => n + f.size, 0)));
    try {
      for (const f of changed) {
        const key = state.newObjectKey(row);
        uploaded.push(key);
        const hash = crypto.createHash('sha256');
        const written = await state.storage.putStream(key, Readable.from(this.readStateFile(ws, f.path, f.size, hash, budget)), f.size);
        if (written !== f.size) throw new Error(`"${f.path}" changed size while it was being copied.`);
        next.files[f.path] = { key, sha256: hash.digest('hex'), size: f.size, mtimeNs: f.mtime_ns };
      }
      // A run while copying may have changed any file: this checkpoint is not one moment.
      const after = await this.stateListing(ws, budget);
      if (!after || after.generation !== generation || !(await state.commit(ws, row, next))) {
        await this.deleteObjects(uploaded);
        return false;
      }
    } catch (err) {
      await this.deleteObjects(uploaded);
      throw err;
    }
    const kept = new Set(Object.values(next.files).map((f) => f.key));
    await this.deleteObjects(Object.values(previous.files).map((f) => f.key).filter((k) => !kept.has(k)));
    await this.markSaved(ws, generation);
    return true;
  }

  private async stateListing(ws: string, signal: AbortSignal): Promise<StateListing | null> {
    const res = await this.request('GET', `/v1/workspaces/${ws}/state`, undefined, signal);
    if (res.status === 404) return null;
    await this.expectOk(res, 'state listing');
    return (await res.json()) as StateListing;
  }

  private async *readStateFile(
    ws: string,
    rel: string,
    size: number,
    hash: crypto.Hash,
    signal: AbortSignal,
  ): AsyncGenerator<Buffer> {
    let offset = 0;
    while (offset < size) {
      const res = await this.request(
        'GET',
        `/v1/workspaces/${ws}/state/file?path=${encodeURIComponent(rel)}&offset=${String(offset)}&length=${String(CHUNK_BYTES)}`,
        undefined,
        signal,
      );
      await this.expectOk(res, `checkpoint of "${rel}"`);
      const part = Buffer.from(await res.arrayBuffer());
      if (part.length === 0) return;
      hash.update(part);
      offset += part.length;
      yield part;
    }
  }

  private async markSaved(ws: string, generation: number): Promise<void> {
    const res = await this.request(
      'POST',
      `/v1/workspaces/${ws}/state/saved?generation=${String(generation)}`,
      '',
      AbortSignal.timeout(30_000),
    );
    await this.expectOk(res, 'checkpoint confirmation');
  }

  private async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) await this.deps.state!.storage.delete(key).catch(() => undefined);
  }

  private async upload(
    ws: string,
    file: { name: string; sha256: string; path: string; size: number },
    signal: AbortSignal,
  ): Promise<void> {
    const handle = await fs.open(file.path);
    try {
      let offset = 0;
      do {
        const length = Math.min(CHUNK_BYTES, file.size - offset);
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, offset);
        const res = await this.request(
          'PUT',
          `/v1/workspaces/${ws}/input/${file.name}?offset=${String(offset)}&total=${String(file.size)}&sha256=${file.sha256}`,
          buf,
          signal,
          'application/octet-stream',
        );
        await this.expectOk(res, `upload of "${file.name}"`);
        offset += length;
      } while (offset < file.size);
    } finally {
      await handle.close();
    }
  }

  private async download(ws: string, dir: string, name: string, size: number, signal: AbortSignal): Promise<Buffer> {
    const parts: Buffer[] = [];
    let offset = 0;
    do {
      const res = await this.request(
        'GET',
        `/v1/workspaces/${ws}/${dir}/${name}?offset=${String(offset)}&length=${String(CHUNK_BYTES)}`,
        undefined,
        signal,
      );
      await this.expectOk(res, `download of "${name}"`);
      const part = Buffer.from(await res.arrayBuffer());
      if (part.length === 0) break;
      parts.push(part);
      offset += part.length;
    } while (offset < size);
    return Buffer.concat(parts);
  }

  private async request(
    method: string,
    pathname: string,
    body: string | Buffer | undefined,
    signal: AbortSignal,
    contentType?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    const auth = await this.deps.authorization();
    if (auth) headers.Authorization = auth;
    if (contentType) headers['Content-Type'] = contentType;
    try {
      return await this.fetchImpl(new URL(pathname, this.deps.baseUrl), {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === 'string' ? body : new Uint8Array(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new ProviderError(`The sandbox service could not be reached: ${err instanceof Error ? err.message : String(err)}`, {
        code: 'provider_error',
      });
    }
  }

  private async expectOk(res: Response, what: string): Promise<void> {
    if (res.ok) return;
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      detail = [body.error, body.detail].filter(Boolean).join(': ');
    } catch {
      // Not the service's JSON (a proxy or Cloud Run's own error page); the status says enough.
    }
    throw new ProviderError(`Sandbox ${what} failed with HTTP ${String(res.status)}${detail ? ` (${detail})` : ''}.`, {
      code: 'provider_error',
      retryable: res.status === 503,
    });
  }
}
