/**
 * A chat's sandbox files outlive the instance that held them (ADR-0015), as Claude's containers
 * are restored after a checkpoint. Real sandbox server, real Postgres, local object storage: the
 * workspace is deleted on the server to stand in for an instance restart or an eviction.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sandboxWorkspaces } from '../../db/schema.js';
import { sweepRetention } from '../../services/retention.js';
import type { TestContext, TestUser } from '../../test/harness.js';
import { createTestApp, signUp } from '../../test/harness.js';
import { WarmSandboxClient, workspaceIdFor } from './warmSandboxClient.js';
import { type CheckpointManifest, WorkspaceStateStore } from './workspaceState.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sandbox/server.py');
const canRun = process.platform === 'linux' && process.getuid?.() === 0;
const quiet = { warn: () => undefined };
const DAY = 86_400_000;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function out(res: { outputs: { text: string }[] }): string {
  return (JSON.parse(res.outputs[0]!.text) as { msg_out: string }).msg_out.trim();
}

describe.runIf(canRun)('sandbox workspace checkpoints', () => {
  let ctx: TestContext;
  let user: TestUser;
  let server: ChildProcess;
  let base: string;
  let requests: string[] = [];
  let client: WarmSandboxClient;
  let store: WorkspaceStateStore;

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await signUp(ctx);
    const port = await freePort();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ckpt-root-'));
    await fs.chmod(root, 0o755);
    server = spawn('python3', [SERVER], {
      env: { ...process.env, PORT: String(port), WORK_ROOT: path.join(root, 'work') },
      stdio: 'ignore',
    });
    base = `http://127.0.0.1:${String(port)}`;
    for (let i = 0; i < 100; i++) {
      if (await fetch(`${base}/healthz`).then((r) => r.ok, () => false)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    store = new WorkspaceStateStore(ctx.db, ctx.app.services.storage);
    client = new WarmSandboxClient({
      baseUrl: base,
      authorization: async () => null,
      fetch: (input, init) => {
        const url = new URL(String(input));
        requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
        return fetch(input, init);
      },
      codeTimeoutMs: 20_000,
      transferBudgetMs: 30_000,
      maxCodeBytes: 512 * 1024,
      state: store,
    });
  });

  afterAll(async () => {
    server.kill('SIGKILL');
    await ctx.close();
  });

  async function newChat(): Promise<{ chatId: string; opts: object; ws: string }> {
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'c' } });
    const chatId = (res.json() as { id: string }).id;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ckpt-ws-'));
    await fs.mkdir(path.join(dir, 'input'));
    const sessionKey = `${user.id}:${chatId}`;
    return { chatId, ws: workspaceIdFor(sessionKey), opts: { workspaceDir: dir, sessionKey, owner: { userId: user.id, chatId } } };
  }

  const loseWorkspace = (ws: string) => fetch(`${base}/v1/workspaces/${ws}`, { method: 'DELETE' });
  const manifestOf = async (ws: string): Promise<CheckpointManifest> =>
    (await store.loadManifest((await store.row(ws))!.manifestKey))!;

  it('brings back every file the code wrote, byte for byte, after the workspace is lost', async () => {
    const { ws, opts } = await newChat();
    const signal = new AbortController().signal;
    // Larger than one 16 MiB chunk, in a subdirectory, so both paths of the copy are exercised.
    const first = await client.runPython(
      "import os, hashlib\nos.makedirs('data/deep', exist_ok=True)\nb=os.urandom(17*2**20+5)\n" +
        "open('data/deep/big.bin','wb').write(b)\nopen('notes.txt','w').write('kept')\nopen('empty.txt','w').close()\n" +
        'print(hashlib.sha256(b).hexdigest())',
      signal,
      opts,
    );
    const digest = out(first);

    expect(await client.checkpointIdle(0, 5, quiet)).toEqual({ saved: 1, failed: 0 });
    await loseWorkspace(ws);

    requests = [];
    const again = await client.runPython(
      "import hashlib\nprint(hashlib.sha256(open('data/deep/big.bin','rb').read()).hexdigest(), open('notes.txt').read(), len(open('empty.txt').read()))",
      signal,
      opts,
    );
    expect(out(again)).toBe(`${digest} kept 0`);
    expect(requests.filter((r) => r.endsWith('/state/file')).length).toBeGreaterThanOrEqual(4);
  });

  it('copies only what changed at the next checkpoint', async () => {
    const { ws, opts } = await newChat();
    const signal = new AbortController().signal;
    await client.runPython("open('a.txt','w').write('a')\nopen('b.txt','w').write('b')", signal, opts);
    await client.checkpointIdle(0, 5, quiet);
    const before = await manifestOf(ws);

    await client.runPython("open('b.txt','w').write('bb')", signal, opts);
    requests = [];
    await client.checkpointIdle(0, 5, quiet);
    const after = await manifestOf(ws);
    expect(after.files['a.txt']!.key).toBe(before.files['a.txt']!.key);
    expect(after.files['b.txt']!.key).not.toBe(before.files['b.txt']!.key);
    expect(requests.filter((r) => r.endsWith('/state/file'))).toHaveLength(1);
    // The replaced version is gone from storage.
    expect(await ctx.app.services.storage.exists(before.files['b.txt']!.key)).toBe(false);
  });

  it('does not overwrite newer files when the workspace is still there', async () => {
    const { opts } = await newChat();
    const signal = new AbortController().signal;
    await client.runPython("open('v.txt','w').write('1')", signal, opts);
    await client.checkpointIdle(0, 5, quiet);
    await client.runPython("open('v.txt','w').write('2')", signal, opts);
    expect(out(await client.runPython("print(open('v.txt').read())", signal, opts))).toBe('2');
  });

  it('is deleted with its chat, and 30 days after the chat last ran code', async () => {
    const signal = new AbortController().signal;
    const purged = await newChat();
    await client.runPython("open('x','w').write('x')", signal, purged.opts);
    await client.checkpointIdle(0, 5, quiet);
    const purgedKeys = Object.values((await manifestOf(purged.ws)).files).map((f) => f.key);
    await ctx.app.inject({ method: 'DELETE', url: `/v1/chats/${purged.chatId}`, headers: { cookie: user.cookie } });

    const idle = await newChat();
    await client.runPython("open('y','w').write('y')", signal, idle.opts);
    await client.checkpointIdle(0, 5, quiet);
    const idleManifest = (await store.row(idle.ws))!.manifestKey!;

    const policy = { chatPurgeAfterDays: 30, unsentUploadTtlHours: 24, sandboxStateDays: 30 };
    await sweepRetention(ctx.db, ctx.app.services.storage, policy, new Date(Date.now() + 29 * DAY), quiet);
    expect(await ctx.app.services.storage.exists(idleManifest)).toBe(true);

    await sweepRetention(ctx.db, ctx.app.services.storage, policy, new Date(Date.now() + 31 * DAY), quiet);
    for (const key of purgedKeys) expect(await ctx.app.services.storage.exists(key)).toBe(false);
    expect(await ctx.app.services.storage.exists(idleManifest)).toBe(false);
    expect(await ctx.db.select().from(sandboxWorkspaces).where(eq(sandboxWorkspaces.workspaceId, idle.ws))).toHaveLength(0);
  });

  it('keeps a workspace with no run since its checkpoint off the next sweep', async () => {
    const { opts } = await newChat();
    await client.runPython("open('z','w').write('z')", new AbortController().signal, opts);
    await client.checkpointIdle(0, 5, quiet);
    expect(await client.checkpointIdle(0, 5, quiet)).toEqual({ saved: 0, failed: 0 });
  });
});
