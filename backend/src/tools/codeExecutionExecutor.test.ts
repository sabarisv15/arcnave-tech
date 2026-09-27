/**
 * The computer's tools (ADR-0047). The Python programs behind them run for real on the local
 * process engine, so what is checked is what the sandbox does, not a description of it. A fake
 * client covers only the shaping of output and failures.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SandboxClient, SandboxExecutionResult } from './sandbox/client.js';
import { ProcessSandboxClient } from './sandbox/processSandboxClient.js';
import { ExecutionRuntime, type WorkspaceFiles } from './execution/executionRuntime.js';
import { CodeExecutionToolExecutor, numberedView } from './codeExecutionExecutor.js';
import { SkillService } from '../services/skills.js';

const signal = () => new AbortController().signal;
const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;
const data = <T>(r: { content: unknown[] }) => (r.content[0] as { data: T }).data;

function fakeClient(impl: (code: string) => Promise<SandboxExecutionResult>): SandboxClient {
  return { runPython: impl };
}
const chunk = (o: Record<string, unknown>): SandboxExecutionResult => ({
  outputs: [{ mimeType: 'application/json', text: JSON.stringify(o) }],
});

describe('bash_tool output shaping', () => {
  it('rejects a missing command without throwing, and turns a sandbox rejection into a failed result', async () => {
    const ok = new CodeExecutionToolExecutor(fakeClient(async () => chunk({ msg_out: '' })), 8000);
    const missing = await ok.execute({ id: 'a', name: 'bash_tool', input: { description: 'x' } }, signal());
    expect(missing.ok).toBe(false);
    expect(text(missing)).toContain('Invalid input');

    const failing = new CodeExecutionToolExecutor(
      fakeClient(async () => {
        throw new Error('sandbox quota exceeded');
      }),
      8000,
    );
    const res = await failing.execute({ id: 'b', name: 'bash_tool', input: { command: 'ls', description: 'x' } }, signal());
    expect(res.ok).toBe(false);
    expect(text(res)).toContain('sandbox quota exceeded');
  });

  it('refuses to run when the signal is already aborted, without calling the client', async () => {
    let called = false;
    const executor = new CodeExecutionToolExecutor(
      fakeClient(async () => {
        called = true;
        return chunk({});
      }),
      8000,
    );
    const ac = new AbortController();
    ac.abort();
    const res = await executor.execute({ id: 'c', name: 'bash_tool', input: { command: 'ls', description: 'x' } }, ac.signal);
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('keeps the head and tail of long output, and the end of a traceback', async () => {
    const out = `START${'x'.repeat(50_000)}END`;
    const err = `Traceback head${'y'.repeat(20_000)}ValueError: bad row`;
    const executor = new CodeExecutionToolExecutor(fakeClient(async () => chunk({ msg_out: out, msg_err: err, exit_code: 1 })), 30_000);
    const res = await executor.execute({ id: 'd', name: 'bash_tool', input: { command: 'x', description: 'x' } }, signal());
    const d = data<{ stdout: string; stderr: string; truncated: boolean; returncode: number }>(res);
    expect(d.stderr.length).toBeLessThanOrEqual(10_000);
    expect(d.stderr).toContain('ValueError: bad row');
    expect(d.stdout.startsWith('START')).toBe(true);
    expect(d.stdout.endsWith('END')).toBe(true);
    expect(d.stdout.length + d.stderr.length).toBeLessThanOrEqual(30_000);
    expect(d.truncated).toBe(true);
    expect(d.returncode).toBe(1);
  });
});

describe('numberedView', () => {
  it('numbers lines as the view tool shows them, and honours a range', () => {
    expect(numberedView('a\nb\nc\n')).toBe('     1\ta\n     2\tb\n     3\tc');
    expect(numberedView('a\nb\nc', [2, -1])).toBe('     2\tb\n     3\tc');
  });
});

describe('the computer on the local process engine', () => {
  let runtime: ExecutionRuntime;
  let workspace: WorkspaceFiles;
  const stored: Record<string, Buffer> = {};
  const storage = { put: async (key: string, d: Buffer) => void (stored[key] = d) } as never;
  let inserted: Array<{ filename: string }> = [];
  const db = {
    insert: () => ({
      values: (vals: { filename: string }) => ({
        returning: async () => {
          inserted.push(vals);
          return [{ id: `id-${vals.filename}`, ...vals }];
        },
      }),
    }),
  } as never;
  let executor: CodeExecutionToolExecutor;
  const run = (name: string, input: Record<string, unknown>) => executor.execute({ id: name, name, input }, signal());

  beforeEach(async () => {
    runtime = new ExecutionRuntime(new ProcessSandboxClient());
    workspace = await runtime.createWorkspace(`computer_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    inserted = [];
    const skills = new SkillService(path.resolve(__dirname, '../..'), 'skills');
    await skills.load();
    executor = new CodeExecutionToolExecutor(runtime, 30_000, {
      workspace,
      userId: 'u',
      messageId: 'm',
      db,
      storage,
      skills,
    });
  });
  afterEach(async () => {
    await runtime.cleanupWorkspace(workspace);
  });

  it('bash_tool runs a command and reports its exit code', async () => {
    const res = await run('bash_tool', { command: 'echo hello && ls nope', description: 'x' });
    const d = data<{ stdout: string; stderr: string; returncode: number }>(res);
    expect(d.stdout).toContain('hello');
    expect(d.returncode).toBe(2);
    expect(d.stderr).toContain('exit code 2');
  });

  it('create_file makes a file with its folders, and refuses one that exists', async () => {
    const made = await run('create_file', { description: 'x', path: 'work/notes.md', file_text: 'one\ntwo\n' });
    expect(made.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace.workspaceDir, 'work/notes.md'), 'utf8')).toBe('one\ntwo\n');
    const again = await run('create_file', { description: 'x', path: 'work/notes.md', file_text: 'x' });
    expect(again.ok).toBe(false);
    expect(text(again)).toContain('already exists');
  });

  it('str_replace changes a unique string, and refuses a missing or repeated one', async () => {
    await run('create_file', { description: 'x', path: 'a.txt', file_text: 'alpha beta beta' });
    expect((await run('str_replace', { description: 'x', path: 'a.txt', old_str: 'alpha', new_str: 'ALPHA' })).ok).toBe(true);
    expect(await fs.readFile(path.join(workspace.workspaceDir, 'a.txt'), 'utf8')).toBe('ALPHA beta beta');
    const repeated = await run('str_replace', { description: 'x', path: 'a.txt', old_str: 'beta', new_str: 'b' });
    expect(repeated.ok).toBe(false);
    expect(text(repeated)).toContain('occurs 2 times');
    expect((await run('str_replace', { description: 'x', path: 'a.txt', old_str: 'gamma', new_str: 'g' })).ok).toBe(false);
  });

  it('keeps input/ and /skills read-only', async () => {
    await fs.writeFile(path.join(workspace.inputDir, 'up.txt'), 'uploaded');
    expect((await run('create_file', { description: 'x', path: 'input/new.txt', file_text: 'x' })).ok).toBe(false);
    expect((await run('str_replace', { description: 'x', path: 'input/up.txt', old_str: 'up', new_str: 'x' })).ok).toBe(false);
    expect((await run('create_file', { description: 'x', path: '/skills/pdf/x.md', file_text: 'x' })).ok).toBe(false);
  });

  it('view numbers a text file, lists a directory, and shows an image', async () => {
    await run('create_file', { description: 'x', path: 'n.txt', file_text: 'l1\nl2\nl3\n' });
    expect(text(await run('view', { description: 'x', path: 'n.txt', view_range: [2, 3] }))).toBe('     2\tl2\n     3\tl3');
    expect(text(await run('view', { description: 'x', path: '.' }))).toContain('n.txt');
    // A 1x1 PNG.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await fs.writeFile(path.join(workspace.workspaceDir, 'dot.png'), png);
    const shown = await run('view', { description: 'x', path: 'dot.png' });
    expect(shown.ok).toBe(true);
    expect(shown.content.some((c) => (c as { type: string }).type === 'image')).toBe(true);
    expect((await run('view', { description: 'x', path: 'missing.txt' })).ok).toBe(false);
  });

  it('view reads a skill from /skills, with its frontmatter', async () => {
    const res = await run('view', { description: 'x', path: '/skills/pdf-reading/SKILL.md' });
    expect(res.ok).toBe(true);
    expect(text(res)).toContain('     2\tname: pdf-reading');
    expect(text(await run('view', { description: 'x', path: '/skills' }))).toContain('file-reading/');
    expect((await run('view', { description: 'x', path: '/skills/../etc/passwd' })).ok).toBe(false);
  });

  it('gives the user only what present_files names, copying it into output/', async () => {
    await run('bash_tool', { command: 'mkdir -p output && echo draft > output/draft.txt && echo final > report.txt', description: 'x' });
    expect(inserted).toEqual([]);
    const res = await run('present_files', { filepaths: ['report.txt'] });
    expect(res.ok).toBe(true);
    const files = data<{ persistedFiles: { filename: string; downloadUrl: string }[] }>(res).persistedFiles;
    expect(files.map((f) => f.filename)).toEqual(['report.txt']);
    expect(files[0]!.downloadUrl).toBe('/files/id-report.txt/download');
    expect(inserted.map((i) => i.filename)).toEqual(['report.txt']);
    expect((await run('present_files', { filepaths: ['nope.txt'] })).ok).toBe(false);
  });

  it('does not hand over a structurally broken Office file', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'not a document');
    await fs.writeFile(path.join(workspace.workspaceDir, 'broken.docx'), await zip.generateAsync({ type: 'nodebuffer' }));
    const res = await run('present_files', { filepaths: ['broken.docx'] });
    expect(res.ok).toBe(false);
    expect(data<{ errors: string[] }>(res).errors[0]).toContain('broken.docx is broken');
    expect(inserted).toEqual([]);
  });
});
