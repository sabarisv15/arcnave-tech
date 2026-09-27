/**
 * WarmSandboxClient against the real sandbox server (backend/sandbox/server.py), started as a
 * local process. The protocol is only proven by the two ends talking; a fake fetch would test
 * the client against my reading of the server. Skipped where the server cannot start (it needs
 * root to give each workspace its own uid).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { toolImages, withoutImageBytes } from '../../providers/types.js';
import { ExecutionRuntime } from '../execution/executionRuntime.js';
import { CodeExecutionToolExecutor } from '../codeExecutionExecutor.js';
import { CloudRunSandboxClient } from './cloudRunSandboxClient.js';
import { WarmSandboxClient, workspaceIdFor } from './warmSandboxClient.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sandbox/server.py');
const canRun = process.platform === 'linux' && process.getuid?.() === 0;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function workspace(files: Record<string, Buffer>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warm-ws-'));
  await fs.mkdir(path.join(dir, 'input'));
  await fs.mkdir(path.join(dir, 'output'));
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(dir, 'input', name), bytes);
  return dir;
}

function result(res: { outputs: { text: string }[] }): { msg_out: string; msg_err: string; exit_code: number } {
  return JSON.parse(res.outputs[0]!.text) as { msg_out: string; msg_err: string; exit_code: number };
}

describe.runIf(canRun)('WarmSandboxClient with the real sandbox server', () => {
  let server: ChildProcess;
  let base: string;
  let requests: string[];
  let client: WarmSandboxClient;

  beforeAll(async () => {
    const port = await freePort();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'warm-root-'));
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
    requests = [];
    client = new WarmSandboxClient({
      baseUrl: base,
      authorization: async () => null,
      fetch: (input, init) => {
        requests.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
        return fetch(input, init);
      },
      codeTimeoutMs: 20_000,
      transferBudgetMs: 30_000,
      maxCodeBytes: 512 * 1024,
    });
  });

  afterAll(() => {
    server.kill('SIGKILL');
  });

  it('sends a file larger than one 16 MiB chunk intact, once per chat, and keeps files between calls', async () => {
    const big = crypto.randomBytes(17 * 1024 * 1024 + 123);
    const digest = crypto.createHash('sha256').update(big).digest('hex');
    const dir = await workspace({ 'statement.pdf': big });
    const signal = new AbortController().signal;
    const opts = { workspaceDir: dir, sessionKey: 'user-1:chat-1' };

    const first = await client.runPython(
      "import hashlib\nd=open('input/statement.pdf','rb').read()\nprint(hashlib.sha256(d).hexdigest())\nopen('notes.txt','w').write('kept')",
      signal,
      opts,
    );
    expect(result(first).msg_out.trim()).toBe(digest);
    const puts = requests.filter((r) => r.startsWith('PUT'));
    expect(puts).toHaveLength(2);

    requests = [];
    const second = await client.runPython("print(open('notes.txt').read())", signal, opts);
    expect(result(second).msg_out.trim()).toBe('kept');
    expect(requests.filter((r) => r.startsWith('PUT'))).toHaveLength(0);
  });

  it('copies new output files back into the local workspace', async () => {
    const dir = await workspace({});
    await client.runPython(
      "open('output/report.csv','w').write('a,b\\n1,2\\n')",
      new AbortController().signal,
      { workspaceDir: dir, sessionKey: 'user-1:chat-2' },
    );
    expect(await fs.readFile(path.join(dir, 'output', 'report.csv'), 'utf8')).toBe('a,b\n1,2\n');
  });

  it('view shows an image to the model through the real server, and keeps its bytes out of what is stored', async () => {
    const dir = await workspace({});
    // A chat session keeps the workspace between the two calls, as it does in a turn.
    const executor = new CodeExecutionToolExecutor(new ExecutionRuntime(client), 10_000, {
      workspace: { workspaceDir: dir, inputDir: path.join(dir, 'input'), outputDir: path.join(dir, 'output'), tempDir: dir },
      userId: 'u-view',
      chatId: 'c-view',
    });
    const png = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f70000000049454e44ae426082';
    const made = await executor.execute(
      {
        id: 'c0',
        name: 'bash_tool',
        input: { command: `python3 -c "open('p3.png','wb').write(bytes.fromhex('${png}'))"`, description: 'x' },
      },
      new AbortController().signal,
    );
    expect(made.ok).toBe(true);
    const result = await executor.execute(
      { id: 'c1', name: 'view', input: { path: 'p3.png', description: 'x' } },
      new AbortController().signal,
    );
    expect(toolImages(result)).toEqual([
      { type: 'image', name: 'p3.png', mimeType: 'image/png', base64: Buffer.from(png, 'hex').toString('base64') },
    ]);
    expect(JSON.stringify(withoutImageBytes(result.content))).not.toContain(Buffer.from(png, 'hex').toString('base64'));
  });

  it('removes a workspace used without a session', async () => {
    requests = [];
    await client.runPython('print(1)', new AbortController().signal, {});
    expect(requests.at(-1)).toMatch(/^DELETE \/v1\/workspaces\/[a-f0-9]{32}$/);
  });

  it('reports a failing script with its exit code and stderr, not as a transport error', async () => {
    const res = await client.runPython("raise SystemExit('boom')", new AbortController().signal, {});
    expect(result(res)).toMatchObject({ exit_code: 1 });
    expect(result(res).msg_err).toContain('boom');
  });
});

describe('workspaceIdFor', () => {
  it('is stable per session and does not expose the ids it was made from', () => {
    expect(workspaceIdFor('u:c')).toBe(workspaceIdFor('u:c'));
    expect(workspaceIdFor('u:c')).not.toBe(workspaceIdFor('u:d'));
    expect(workspaceIdFor('u:c')).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('CloudRunSandboxClient without a staging bucket', () => {
  it('refuses an input over the inline limit instead of leaving it out', async () => {
    const dir = await workspace({ 'kvbfedral.pdf': Buffer.alloc(4_696_601) });
    const client = new CloudRunSandboxClient(
      {
        project: 'p',
        location: 'l',
        jobName: 'j',
        getAccessToken: async () => 't',
        maxCodeBytes: 20_000,
        codeTimeoutMs: 1000,
        orchestrationTimeoutMs: 1000,
        maxStdoutBytes: 1000,
        maxStderrBytes: 1000,
      },
      async () => {
        throw new Error('must not launch a job');
      },
    );
    await expect(client.runPython('print(1)', new AbortController().signal, { workspaceDir: dir })).rejects.toThrow(
      /kvbfedral\.pdf.*4696601 bytes/,
    );
  });
});
