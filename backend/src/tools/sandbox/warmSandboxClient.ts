/**
 * run_python on the warm sandbox service (ADR-0010): a long-lived Cloud Run service that keeps
 * one workspace per chat, so a call costs roughly what its code costs and files written by one
 * call are there for the next.
 *
 * Inputs travel by content hash. Each run names the workspace's input files with their sha256;
 * the service answers 409 with the names it does not hold (or holds different bytes for), and
 * only those are uploaded, in chunks under Cloud Run's 32 MiB request cap. So a large PDF is
 * sent once per chat, and no file is ever silently left behind.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ProviderError } from '../../providers/types.js';
import type { SandboxClient, SandboxExecutionOptions, SandboxExecutionResult } from './client.js';

const CHUNK_BYTES = 16 * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,200}$/;

export interface WarmSandboxDeps {
  baseUrl: string;
  /** Authorization header value for the service, or null when it needs none (local dev). */
  authorization: () => Promise<string | null>;
  fetch?: typeof fetch;
  codeTimeoutMs: number;
  /** Added to codeTimeoutMs for transfers and queueing before the call is abandoned. */
  transferBudgetMs: number;
  maxCodeBytes: number;
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
    const deadline = AbortSignal.timeout(this.deps.codeTimeoutMs + this.deps.transferBudgetMs);
    const combined = AbortSignal.any([signal, deadline]);
    // Without a session the workspace is single-use and removed afterwards, like the Job was.
    const ephemeral = !options?.sessionKey;
    const ws = options?.sessionKey ? workspaceIdFor(options.sessionKey) : crypto.randomBytes(16).toString('hex');

    try {
      const inputs = await this.readInputs(options?.workspaceDir);
      const manifest = inputs.map(({ name, sha256 }) => ({ name, sha256 }));
      let res = await this.run(ws, code, manifest, combined);
      if ('missing' in res) {
        for (const name of res.missing) {
          const file = inputs.find((i) => i.name === name);
          if (!file) throw new ProviderError(`Sandbox asked for unknown input "${name}".`, { code: 'provider_error' });
          await this.upload(ws, file, combined);
        }
        res = await this.run(ws, code, manifest, combined);
        if ('missing' in res) {
          throw new ProviderError(`Sandbox still lacks input files after upload: ${res.missing.join(', ')}.`, {
            code: 'provider_error',
          });
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
    signal: AbortSignal,
  ): Promise<RunResponse | { missing: string[] }> {
    const res = await this.request(
      'POST',
      `/v1/workspaces/${ws}/run`,
      JSON.stringify({ code, timeoutMs: this.deps.codeTimeoutMs, inputs }),
      signal,
      'application/json',
    );
    if (res.status === 409) {
      const body = (await res.json()) as { missing?: string[] };
      if (Array.isArray(body.missing)) return { missing: body.missing };
    }
    await this.expectOk(res, 'run');
    return (await res.json()) as RunResponse;
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
