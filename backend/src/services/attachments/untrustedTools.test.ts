/**
 * System tools over an uploaded file (ADR-0066, review finding M2): ffmpeg, ffprobe and poppler
 * run with an environment built from nothing (PATH and TMPDIR), ffmpeg and ffprobe read local
 * files only (`-protocol_whitelist file` before `-i`), and ffmpeg never reads stdin. The parser
 * child gets no secret either. Every call is observed through a spy on `node:child_process`.
 *
 * The real-ffmpeg case runs the binary: on CI (CI=true, where the workflow installs ffmpeg) a
 * missing ffmpeg fails the test instead of skipping it.
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { file: string; args: string[]; env: NodeJS.ProcessEnv | undefined };
const calls = vi.hoisted(() => ({ list: [] as Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv | undefined }> }));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  return {
    ...real,
    execFile: ((file: string, args: string[], opts: { env?: NodeJS.ProcessEnv }, cb: never) => {
      calls.list.push({ file, args: [...args], env: opts?.env });
      return real.execFile(file, args, opts as never, cb);
    }) as unknown as typeof real.execFile,
    spawn: ((file: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      calls.list.push({ file, args: [...args], env: opts?.env });
      return real.spawn(file, args, opts as never);
    }) as unknown as typeof real.spawn,
  };
});

import { ProviderError } from '../../providers/types.js';
import { cutPiece, probeDuration, transcribe } from './audio.js';
import { docxWith } from '../../test/fixtures/archives.js';
import { pdfWithPages } from '../../test/fixtures/files.js';
import { loadConfig } from '../../config.js';
import { isolatedText } from './isolatedExtract.js';
import { readAttachment } from './pipeline.js';
import { mediaArgs } from './untrustedTools.js';

const SECRETS = { ANTHROPIC_API_KEY: 'sk-ant-fake-for-test-0000', COOKIE_SECRET: 'cookie-secret-fake-for-test-0000000000' };

function hasBinary(name: string): boolean {
  try {
    execFileSync(name, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAS_FFMPEG = hasBinary('ffmpeg') && hasBinary('ffprobe');
const ON_CI = process.env.CI === 'true';

let dir: string;
const saved: Record<string, string | undefined> = {};
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-tools-test-'));
  for (const [k, v] of Object.entries(SECRETS)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  calls.list.length = 0;
});

function expectNoSecrets(call: Call): void {
  expect(call.env, `${call.file} ran with the API's environment`).toBeDefined();
  const env = call.env!;
  for (const [k, v] of Object.entries(SECRETS)) {
    expect(env[k], `${call.file} got ${k}`).toBeUndefined();
    expect(Object.values(env).join('\n')).not.toContain(v);
  }
}

function expectToolEnv(call: Call): void {
  expectNoSecrets(call);
  expect(Object.keys(call.env!).sort()).toEqual(['PATH', 'TMPDIR']);
}

function expectWhitelistBeforeInput(call: Call): void {
  const wl = call.args.indexOf('-protocol_whitelist');
  const input = call.args.indexOf('-i');
  expect(wl, `${call.file} has no protocol whitelist`).toBeGreaterThanOrEqual(0);
  expect(call.args[wl + 1]).toBe('file');
  expect(input).toBeGreaterThan(wl);
}

/** An ID3 tag, then an HLS playlist whose one segment is `target`. */
function id3Playlist(target: string): Buffer {
  const id3 = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
  const playlist = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10.0,\n${target}\n#EXT-X-ENDLIST\n`;
  return Buffer.concat([id3, Buffer.from(playlist)]);
}

describe('argument order', () => {
  it('puts -nostdin first and the whitelist before -i, for ffmpeg and ffprobe', () => {
    const ff = mediaArgs('ffmpeg', '/x', { global: ['-v', 'error'], inputOptions: ['-ss', '1'], output: ['/o.mp3'] });
    expect(ff[0]).toBe('-nostdin');
    expect(ff.indexOf('-protocol_whitelist')).toBeLessThan(ff.indexOf('-ss'));
    expect(ff.indexOf('-ss')).toBeLessThan(ff.indexOf('-i'));
    expect(ff.slice(-1)).toEqual(['/o.mp3']);
    // ffprobe has no -nostdin (6.1: "Option not found"); its stdin is closed instead.
    const fp = mediaArgs('ffprobe', '/x');
    expect(fp).not.toContain('-nostdin');
    expect(fp.indexOf('-protocol_whitelist')).toBeLessThan(fp.indexOf('-i'));
  });
});

describe('poppler and the parser child get no secret', () => {
  it('pdfinfo, pdftotext and pdfimages run with PATH and TMPDIR only', async () => {
    const p = path.join(dir, 'doc.pdf');
    await writeFile(p, await pdfWithPages(2, ['Env check']));
    const cfg = loadConfig({ NODE_ENV: 'test' });
    const out = await readAttachment({ path: p, filename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 1, cfg, workDir: dir });
    expect(out.status).toBe('ready');
    const tools = calls.list.filter((c) => c.file.startsWith('pdf'));
    expect(tools.map((c) => c.file)).toEqual(expect.arrayContaining(['pdfinfo', 'pdftotext', 'pdfimages']));
    for (const c of tools) expectToolEnv(c);
    // pdf-lib's inspection ran in the child: no secret there either.
    const child = calls.list.find((c) => c.file === process.execPath);
    expect(child).toBeDefined();
    expectNoSecrets(child!);
  });

  it('the parser child for an Office file carries no secret', async () => {
    const p = path.join(dir, 'a.docx');
    await writeFile(p, docxWith('no secrets here'));
    expect(await isolatedText(p, 'a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', { heapMb: 256, timeoutMs: 60_000, concurrency: 1, maxRatio: 100 })).toContain('no secrets');
    const child = calls.list.find((c) => c.file === process.execPath);
    expectNoSecrets(child!);
    expect(Object.keys(child!.env!).sort()).toEqual(['NODE_ENV', 'PATH', 'TMPDIR']);
  });
});

describe.runIf(HAS_FFMPEG || ON_CI)('ffmpeg and ffprobe on hostile media (real binaries)', () => {
  beforeAll(() => {
    if (!HAS_FFMPEG) throw new Error('ffmpeg/ffprobe are missing on CI; the workflow installs them (ADR-0063). This test must not be skipped there.');
  });

  it('a real recording: both tools carry no secret, -nostdin and the whitelist before -i', async () => {
    const wav = path.join(dir, 'tone.wav');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', wav], { stdio: 'ignore', env: { PATH: process.env.PATH ?? '' } });
    calls.list.length = 0;
    expect(await probeDuration(wav)).toBeGreaterThan(1.5);
    const out = path.join(dir, 'piece.mp3');
    await cutPiece(wav, out, 0, 1);
    expect((await readFile(out)).length).toBeGreaterThan(0);
    const probe = calls.list.find((c) => c.file === 'ffprobe')!;
    const cut = calls.list.find((c) => c.file === 'ffmpeg')!;
    for (const c of [probe, cut]) {
      expectToolEnv(c);
      expectWhitelistBeforeInput(c);
    }
    expect(cut.args[0]).toBe('-nostdin');
  });

  it('an ID3 tag followed by an m3u8 playlist pointing at file:///etc/hostname yields nothing from that file', async () => {
    const hostname = (await readFile('/etc/hostname', 'utf8').catch(() => '')).trim();
    // Worst case: the name tells ffmpeg it is a playlist (our own copies are named `file`).
    for (const name of ['file', 'evil.m3u8']) {
      const p = path.join(dir, name);
      await writeFile(p, id3Playlist('file:///etc/hostname'));
      await expect(probeDuration(p)).rejects.toMatchObject({ code: 'corrupt' });
      const out = path.join(dir, `${name}.mp3`);
      const cut = await cutPiece(p, out, 0, 5).then(
        () => 'ran',
        () => 'failed',
      );
      if (cut === 'ran') {
        const bytes = await readFile(out).catch(() => Buffer.alloc(0));
        if (hostname) expect(bytes.includes(Buffer.from(hostname))).toBe(false);
        // No audio came out of a text file: at most a container header.
        expect(bytes.length).toBeLessThan(1024);
      }
    }
  });

  it('the whitelist stops a playlist from fetching a URL', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      res.end('x');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const p = path.join(dir, 'remote.m3u8');
      await writeFile(p, id3Playlist(`http://127.0.0.1:${String(port)}/seg.ts`));
      await expect(probeDuration(p)).rejects.toMatchObject({ code: 'corrupt' });
      await cutPiece(p, path.join(dir, 'remote.mp3'), 0, 5).catch(() => undefined);
      // No control without the flag: ffmpeg 6.1 already limits a local playlist's segments to
      // file,crypto,data. The explicit flag pins that on every version, and drops crypto/data.
      expect(hits).toBe(0);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe.runIf(HAS_FFMPEG || ON_CI)('transcription retries only what can succeed on a retry (review R1#10)', () => {
  beforeAll(() => {
    if (!HAS_FFMPEG) throw new Error('ffmpeg/ffprobe are missing on CI; the workflow installs them (ADR-0063). This test must not be skipped there.');
  });

  async function callsFor(error: unknown): Promise<number> {
    const wav = path.join(dir, 'retry.wav');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', wav], { stdio: 'ignore', env: { PATH: process.env.PATH ?? '' } });
    let calls = 0;
    const provider = {
      name: 'fake',
      readMedia: async () => {
        calls += 1;
        throw error;
      },
    } as unknown as Parameters<typeof transcribe>[1];
    const out = await transcribe(wav, provider, { maxSeconds: 3600, segmentSeconds: 90, overlapSeconds: 2, deadlineMs: 10_000, concurrency: 1 });
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]!.ok).toBe(false);
    return calls;
  }

  it('a failure the adapter did not classify retryable is asked once per piece (Stage 15 ER-2, ADR-0070 F15)', async () => {
    expect(await callsFor(new ProviderError('no quota', { code: 'provider_quota_unavailable', retryable: false, statusCode: 429 }))).toBe(1);
    expect(await callsFor(new ProviderError('not enabled', { code: 'model_unavailable' }))).toBe(1);
    // A 400 as classifyGeminiError returns it: never retried (round 2 retried it).
    expect(await callsFor(new ProviderError('media reading failed', { statusCode: 400 }))).toBe(1);
    // The account's spend limit: never retried (round 2 called it retryable).
    expect(await callsFor(new ProviderError('limit', { code: 'provider_limit', retryable: false, statusCode: 429 }))).toBe(1);
    // Not a provider error at all: a bug, which a second request repeats.
    expect(await callsFor(new Error('socket hang up'))).toBe(1);
  });

  it('a failure the adapter classified retryable gets exactly one retry', async () => {
    expect(await callsFor(new ProviderError('busy', { retryable: true, statusCode: 503 }))).toBe(2);
    expect(await callsFor(new ProviderError('timed out', { code: 'provider_timeout', retryable: true }))).toBe(2);
  });
});

describe('every child process and working directory goes through the shared helpers', () => {
  it('no file in services/attachments or routes/files.ts calls execFile, spawn, mkdtemp or os.tmpdir() itself', async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const files = (await readdir(here)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => path.join(here, f));
    files.push(path.resolve(here, '../../routes/files.ts'));
    const allowed: Record<string, RegExp[]> = {
      'untrustedTools.ts': [/execFile\(/],
      'workDir.ts': [/mkdtemp\(/, /tmpdir\(\)/],
      'isolatedExtract.ts': [/\bspawn\(/],
    };
    const offenders: string[] = [];
    for (const f of files) {
      const src = (await readFile(f, 'utf8')).replace(/^\s*(\*|\/\/).*$/gm, '');
      for (const re of [/execFile\(/, /\bspawn\(/, /mkdtemp\(/, /tmpdir\(\)/]) {
        if (!re.test(src)) continue;
        if ((allowed[path.basename(f)] ?? []).some((a) => a.source === re.source)) continue;
        offenders.push(`${path.basename(f)}: ${re.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
