/**
 * The sandbox computer's tools (ADR-0047): bash_tool, view, create_file, str_replace and
 * present_files. Each one is a short Python program run by the configured sandbox engine, so the
 * warm service, the single-use Job and the local process engine all serve them unchanged, with
 * the same uid isolation and no network. Skills are read from /skills/<name>/ through the skill
 * service instead, so they read the same on every engine.
 *
 * Every branch returns a `ToolResult`, never throws: a bad input or a sandbox failure is
 * something the model needs to see and react to (Invariant 1).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { logger } from '../logger.js';
import type { ToolCall, ToolContent, ToolErrorCode, ToolExecutor, ToolResult } from '../providers/types.js';
import type { ObjectStorage } from '../services/storage.js';
import type { SkillService } from '../services/skills.js';
import { verifyPdf } from '../services/documents/verify/pdfVerify.js';
import { verifyXlsx } from '../services/documents/verify/xlsxVerify.js';
import { verifyDocx } from '../services/documents/verify/docxVerify.js';
import { verifyPptx } from '../services/documents/verify/pptxVerify.js';
import { AttachmentNotFoundError, ExecutionRuntime, type WorkspaceFiles } from './execution/executionRuntime.js';
import { SandboxMisconfiguredError, type SandboxClient } from './sandbox/client.js';
import { sandboxInputNames, type ManifestFile } from '../services/attachments/manifest.js';
import { nameForModel } from '../providers/attachmentContent.js';

const log = logger.child({ module: 'codeExecutionExecutor' });

/** Where view and str_replace find the skills: read-only, served by the skill service. */
export const SKILLS_ROOT = '/skills';

const bashInput = z.object({ command: z.string().min(1), description: z.string().optional() });
const viewInput = z.object({
  path: z.string().min(1),
  description: z.string().optional(),
  view_range: z.tuple([z.number().int(), z.number().int()]).nullish(),
});
const createInput = z.object({ path: z.string().min(1), file_text: z.string(), description: z.string().optional() });
const replaceInput = z.object({
  path: z.string().min(1),
  old_str: z.string().min(1),
  new_str: z.string().default(''),
  description: z.string().optional(),
});
const presentInput = z.object({ filepaths: z.array(z.string().min(1)).min(1).max(20) });

/** Images view shows are bounded: each costs tokens. */
const MAX_VIEW_IMAGES = 4;
const MAX_VIEW_IMAGE_BYTES = 5 * 1024 * 1024;
const VIEW_IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
/** A text file viewed whole is cut in the middle past this many characters. */
const VIEW_MAX_CHARS = 16_000;
/** A line range is cut too, well inside the sandbox's 256 KB stdout cap (sandbox/server.py). */
const VIEW_RANGE_MAX_CHARS = 60_000;

/** A failure's output budget: head and tail within about 10,000 characters. */
const ERROR_OUTPUT_CHARS = 10_000;

/** `text` within `max` characters, keeping its start and its end, with the cut marked. */
export function headAndTail(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = `\n[... ${String(text.length - max)} characters omitted ...]\n`;
  if (max <= marker.length * 2) return text.slice(0, max);
  const room = max - marker.length;
  const head = Math.ceil(room / 2);
  return text.slice(0, head) + marker + text.slice(text.length - (room - head));
}

/** A text file as view shows it: numbered lines, a range, or the whole cut in the middle. */
export function numberedView(text: string, range?: [number, number] | null): string {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  let start = 1;
  let end = lines.length;
  if (range) {
    start = Math.max(1, range[0]);
    end = range[1] === -1 ? lines.length : Math.min(lines.length, range[1]);
  }
  const out = lines
    .slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(6)}\t${l}`)
    .join('\n');
  return range ? out : headAndTail(out, VIEW_MAX_CHARS);
}

/** name -> mtime of each plain file in `dir` (empty when it does not exist). */
async function snapshotDir(dir: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isFile()) out.set(e.name, (await fs.stat(path.join(dir, e.name))).mtimeMs);
  }
  return out;
}

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

/** A Python program that reads its arguments from base64 JSON, so no input can break out of it. */
function program(args: unknown, body: string): string {
  const encoded = Buffer.from(JSON.stringify(args), 'utf8').toString('base64');
  return `import base64, json, os, sys, shutil\nA = json.loads(base64.b64decode('${encoded}').decode('utf-8'))\n${body}`;
}

const READ_ONLY_CHECK = `
def read_only(p):
    n = os.path.normpath(p)
    return n == 'input' or n.startswith('input' + os.sep)
`;

const BASH = `
import subprocess
r = subprocess.run(A['command'], shell=True, executable='/bin/bash', capture_output=True)
sys.stdout.write(r.stdout.decode('utf-8', 'replace'))
sys.stderr.write(r.stderr.decode('utf-8', 'replace'))
if r.returncode:
    sys.stderr.write('\\n[exit code %d]' % r.returncode)
sys.exit(r.returncode)
`;

// A text file comes back numbered and cut to size here, since the engine caps stdout; an image is
// copied into view/, which the engines hand back as a picture.
const VIEW = `
p = A['path']
if not os.path.exists(p):
    sys.exit('The path %s does not exist.' % p)
if os.path.isdir(p):
    base = os.path.normpath(p)
    out = [base + '/']
    for root, dirs, files in os.walk(base):
        depth = os.path.relpath(root, base).count(os.sep) + (0 if root == base else 1)
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d != 'node_modules')
        if depth >= 2:
            dirs[:] = []
        for name in sorted(dirs):
            out.append('  ' * (depth + 1) + name + '/')
        for name in sorted(f for f in files if not f.startswith('.')):
            size = os.path.getsize(os.path.join(root, name))
            out.append('  ' * (depth + 1) + '%s  (%d bytes)' % (name, size))
    print(json.dumps({'kind': 'dir', 'text': '\\n'.join(out)}))
elif os.path.splitext(p)[1].lower() in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
    os.makedirs('view', exist_ok=True)
    dest = os.path.join('view', os.path.basename(p))
    if os.path.abspath(dest) != os.path.abspath(p):
        shutil.copyfile(p, dest)
    os.utime(dest)
    print(json.dumps({'kind': 'image', 'name': os.path.basename(p)}))
else:
    lines = open(p, 'rb').read().decode('utf-8', 'backslashreplace').split('\\n')
    if len(lines) > 1 and lines[-1] == '':
        lines.pop()
    r = A.get('view_range')
    start, end = 1, len(lines)
    if r:
        start = max(1, r[0])
        end = len(lines) if r[1] == -1 else min(len(lines), r[1])
    out = '\\n'.join('%6d\\t%s' % (start + i, l) for i, l in enumerate(lines[start - 1:end]))
    cap = A['max_chars'] if not r else A['range_max_chars']
    if len(out) > cap:
        marker = '\\n[... %d characters omitted ...]\\n' % (len(out) - cap)
        room = cap - len(marker)
        head = (room + 1) // 2
        out = out[:head] + marker + out[len(out) - (room - head):]
    print(json.dumps({'kind': 'text', 'text': out}, ensure_ascii=False))
`;

const CREATE = `${READ_ONLY_CHECK}
p = A['path']
if read_only(p):
    sys.exit('input/ is read-only: create the file somewhere else.')
if os.path.exists(p):
    sys.exit('The file %s already exists. Edit it with str_replace, or overwrite it with bash_tool.' % p)
d = os.path.dirname(p)
if d:
    os.makedirs(d, exist_ok=True)
with open(p, 'w', encoding='utf-8') as f:
    f.write(A['file_text'])
print('File created: %s' % p)
`;

const REPLACE = `${READ_ONLY_CHECK}
p = A['path']
if read_only(p):
    sys.exit('input/ is read-only: copy the file somewhere else to edit it.')
if not os.path.isfile(p):
    sys.exit('The file %s does not exist.' % p)
s = open(p, encoding='utf-8').read()
n = s.count(A['old_str'])
if n == 0:
    sys.exit('old_str was not found in %s. View the file and copy the text exactly, without line numbers.' % p)
if n > 1:
    sys.exit('old_str occurs %d times in %s. Include more surrounding text so it occurs once.' % (n, p))
with open(p, 'w', encoding='utf-8') as f:
    f.write(s.replace(A['old_str'], A['new_str'], 1))
print('File edited: %s' % p)
`;

// Each file is placed in output/ and touched, so the engine returns it on this run even when it
// was written in an earlier turn.
const PRESENT = `
names = []
for p in A['filepaths']:
    if not os.path.isfile(p):
        sys.exit('The file %s does not exist.' % p)
    os.makedirs('output', exist_ok=True)
    dest = os.path.join('output', os.path.basename(p))
    if os.path.abspath(dest) != os.path.abspath(p):
        shutil.copyfile(p, dest)
    os.utime(dest)
    names.append(os.path.basename(p))
print(json.dumps(names))
`;

export interface CodeExecutionOptions {
  workspace?: WorkspaceFiles;
  userId?: string;
  messageId?: string;
  /** Scopes the sandbox workspace kept between calls: files from earlier calls in this chat
   *  are still there. */
  chatId?: string;
  db?: Database;
  storage?: ObjectStorage;
  /** Every file in the conversation. All of them are placed in input/ before the first call,
   *  under the names the attachment manifest printed. */
  chatFiles?: Pick<ManifestFile, 'id' | 'filename'>[];
  /** Serves view of /skills/<name>/... */
  skills?: SkillService;
}

interface RunOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** A failed run as a tool result, keeping its stable code when it has one (Invariant 5, ADR-0070). */
function runFailure(callId: string, run: { error: string; errorCode?: ToolErrorCode }): ToolResult {
  return { ...textResult(callId, false, run.error), ...(run.errorCode ? { errorCode: run.errorCode } : {}) };
}

export class CodeExecutionToolExecutor implements ToolExecutor {
  private readonly client?: SandboxClient;
  private readonly runtime?: ExecutionRuntime;
  private readonly workspace?: WorkspaceFiles;
  private readonly userId?: string;
  private readonly messageId?: string;
  private readonly chatId?: string;
  private readonly db?: Database;
  private readonly storage?: ObjectStorage;
  private readonly skills?: SkillService;
  /** fileId → path under input/, so a second call in the same turn reuses the same path. */
  private readonly materialized = new Map<string, string>();
  private chatFiles: Pick<ManifestFile, 'id' | 'filename'>[] = [];
  private chatFilesReady = false;

  constructor(
    clientOrRuntime: SandboxClient | ExecutionRuntime,
    private readonly maxOutputChars: number,
    options?: CodeExecutionOptions,
  ) {
    if (clientOrRuntime instanceof ExecutionRuntime) {
      this.runtime = clientOrRuntime;
    } else {
      this.client = clientOrRuntime;
    }
    this.workspace = options?.workspace;
    this.userId = options?.userId;
    this.messageId = options?.messageId;
    this.chatId = options?.chatId;
    this.db = options?.db;
    this.storage = options?.storage;
    this.skills = options?.skills;
    this.chatFiles = options?.chatFiles ?? [];
  }

  /** The conversation's files, once they are known (after the executor is built). */
  setChatFiles(files: Pick<ManifestFile, 'id' | 'filename'>[]): void {
    this.chatFiles = files;
    this.chatFilesReady = false;
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }
    switch (call.name) {
      case 'bash_tool':
        return this.bash(call, signal);
      case 'view':
        return this.view(call, signal);
      case 'create_file':
        return this.simple(call, signal, createInput, CREATE);
      case 'str_replace':
        return this.simple(call, signal, replaceInput, REPLACE);
      case 'present_files':
        return this.present(call, signal);
      default:
        return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }
  }

  private async bash(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const parsed = bashInput.safeParse(call.input);
    if (!parsed.success) return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    const viewDir = this.workspace ? path.join(this.workspace.workspaceDir, 'view') : undefined;
    const viewBefore = viewDir ? await snapshotDir(viewDir) : new Map<string, number>();
    const run = await this.run(program(parsed.data, BASH), signal);
    if ('error' in run) return runFailure(call.id, run);

    // About 30,000 characters of a command's output are read back, and a failure's as a
    // head-and-tail excerpt of about 10,000: an error is usually at the end.
    const stderr = headAndTail(run.stderr, Math.min(ERROR_OUTPUT_CHARS, this.maxOutputChars));
    const stdout = headAndTail(run.stdout, Math.max(0, this.maxOutputChars - stderr.length));
    const data: Record<string, unknown> = {
      stdout,
      stderr,
      returncode: run.exitCode,
      truncated: stdout.length < run.stdout.length || stderr.length < run.stderr.length,
    };
    // An image the command saved in view/ is shown, as view would show it.
    const images = await this.freshViewImages(viewBefore, data);
    return { toolCallId: call.id, ok: true, content: [{ type: 'json', data }, ...images] };
  }

  private async view(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const parsed = viewInput.safeParse(call.input);
    if (!parsed.success) return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    const p = parsed.data.path;
    if (p === SKILLS_ROOT || p.startsWith(`${SKILLS_ROOT}/`)) return this.viewSkill(call.id, p, parsed.data.view_range);

    const viewDir = this.workspace ? path.join(this.workspace.workspaceDir, 'view') : undefined;
    const viewBefore = viewDir ? await snapshotDir(viewDir) : new Map<string, number>();
    const args = { path: p, view_range: parsed.data.view_range ?? null, max_chars: VIEW_MAX_CHARS, range_max_chars: VIEW_RANGE_MAX_CHARS };
    const run = await this.run(program(args, VIEW), signal);
    if ('error' in run) return runFailure(call.id, run);
    if (run.exitCode) return textResult(call.id, false, run.stderr.trim() || 'view failed.');
    let shown: { kind: string; text?: string; name?: string };
    try {
      shown = JSON.parse(run.stdout) as typeof shown;
    } catch {
      return textResult(call.id, false, `view could not read ${p}.`);
    }
    if (shown.kind === 'text') return textResult(call.id, true, shown.text ?? '');
    if (shown.kind === 'dir') return textResult(call.id, true, shown.text ?? '');
    const data: Record<string, unknown> = {};
    const images = await this.freshViewImages(viewBefore, data);
    if (images.length === 0) {
      return textResult(call.id, false, String(data.viewNotice ?? `The image ${p} could not be shown.`));
    }
    return { toolCallId: call.id, ok: true, content: [{ type: 'text', text: `Image: ${p}` }, ...images] };
  }

  /** The skills directory, read-only, as a directory listing or numbered text. */
  private async viewSkill(callId: string, p: string, range?: [number, number] | null): Promise<ToolResult> {
    if (!this.skills) return textResult(callId, false, `The path ${p} does not exist.`);
    const rel = path.posix.normalize(p).slice(SKILLS_ROOT.length).replace(/^\/+/, '');
    if (rel === '' || rel === '.') {
      const names = this.skills.listSkills().map((s) => `  ${s.name}/\n    SKILL.md`);
      return textResult(callId, true, [`${SKILLS_ROOT}/`, ...names].join('\n'));
    }
    const [skillName, ...restParts] = rel.split('/');
    const rest = restParts.join('/');
    if (!skillName || !this.skills.getSkill(skillName)) return textResult(callId, false, `The path ${p} does not exist.`);
    if (rest === '') return textResult(callId, true, `${SKILLS_ROOT}/${skillName}/\n  SKILL.md`);
    const text = await this.skills.getSkillResource(skillName, rest);
    if (text === null) return textResult(callId, false, `The path ${p} does not exist.`);
    return textResult(callId, true, numberedView(text, range));
  }

  private async simple(
    call: ToolCall,
    signal: AbortSignal,
    schema: typeof createInput | typeof replaceInput,
    body: string,
  ): Promise<ToolResult> {
    const parsed = schema.safeParse(call.input);
    if (!parsed.success) return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    if (parsed.data.path === SKILLS_ROOT || parsed.data.path.startsWith(`${SKILLS_ROOT}/`)) {
      return textResult(call.id, false, `${SKILLS_ROOT} is read-only: copy the file somewhere else to change it.`);
    }
    const run = await this.run(program(parsed.data, body), signal);
    if ('error' in run) return runFailure(call.id, run);
    if (run.exitCode) return textResult(call.id, false, run.stderr.trim() || `${call.name} failed.`);
    return textResult(call.id, true, run.stdout.trim());
  }

  private async present(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const parsed = presentInput.safeParse(call.input);
    if (!parsed.success) return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    const expected = parsed.data.filepaths.map((p) => path.posix.basename(p));
    const run = await this.run(program(parsed.data, PRESENT), signal, expected);
    if ('error' in run) return runFailure(call.id, run);
    if (run.exitCode) return textResult(call.id, false, run.stderr.trim() || 'present_files failed.');
    if (!this.workspace || !this.runtime || !this.userId || !this.messageId || !this.db || !this.storage) {
      return textResult(call.id, false, 'Files cannot be given to the user here: there is no file storage.');
    }

    // A structurally broken Office file or PDF is not handed over: the model is told to rebuild it.
    const problems: string[] = [];
    const names: string[] = [];
    for (const name of new Set(expected)) {
      const filePath = path.join(this.workspace.outputDir, name);
      const buf = await fs.readFile(filePath).catch(() => null);
      if (!buf) {
        problems.push(`${name}: the sandbox did not return it.`);
        continue;
      }
      const check = await structuralCheck(name, buf);
      if (check && !check.ok) {
        problems.push(`${name} is broken and was not given to the user: ${check.errors.join('; ')}`);
        continue;
      }
      names.push(name);
    }

    let persisted: Array<{ filename: string; mimeType: string; sizeBytes: number; downloadUrl: string }> = [];
    try {
      persisted = (
        await this.runtime.persistOutputFiles(
          this.workspace,
          { userId: this.userId, messageId: this.messageId, db: this.db, storage: this.storage },
          names,
        )
      ).map((f) => ({ filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, downloadUrl: f.downloadUrl }));
    } catch (err) {
      log.warn({ err }, 'Failed to store presented files');
      return textResult(call.id, false, 'The files could not be stored. Try again.');
    }
    // Order the cards as the model listed the files: the first is the one to open first.
    persisted.sort((a, b) => names.indexOf(a.filename) - names.indexOf(b.filename));
    const data: Record<string, unknown> = { persistedFiles: persisted };
    if (problems.length > 0) data.errors = problems;
    return { toolCallId: call.id, ok: persisted.length > 0, content: [{ type: 'json', data }] };
  }

  /** Runs one program on the sandbox engine; the conversation's files are placed first. */
  private async run(code: string, signal: AbortSignal, expectedOutputs?: string[]): Promise<RunOutcome | { error: string; errorCode?: ToolErrorCode }> {
    if (!this.chatFilesReady && this.chatFiles.length > 0) {
      const staged = await this.materializeChatFiles();
      if (!staged.ok) return { error: staged.error };
      this.chatFilesReady = true;
    }
    let execution;
    try {
      if (this.runtime) {
        const session = this.userId && this.chatId ? { userId: this.userId, chatId: this.chatId } : undefined;
        execution = await this.runtime.executePython(code, this.workspace, signal, expectedOutputs, session);
      } else if (this.client) {
        execution = await this.client.runPython(code, signal, { workspaceDir: this.workspace?.workspaceDir, expectedOutputs });
      } else {
        return { error: 'No sandbox is configured.' };
      }
    } catch (err) {
      // A typed sandbox failure keeps its code for the client (Invariant 5, ADR-0070).
      return { error: err instanceof Error ? err.message : String(err), ...(err instanceof SandboxMisconfiguredError ? { errorCode: err.code } : {}) };
    }
    const chunk = execution.outputs.find((o) => o.mimeType === 'application/json');
    let parsed: { msg_out?: string; msg_err?: string; exit_code?: number | null } = {};
    if (chunk) {
      try {
        parsed = JSON.parse(chunk.text) as typeof parsed;
      } catch {
        // Not the documented shape: treat as empty output rather than throwing.
      }
    }
    return { stdout: parsed.msg_out ?? '', stderr: parsed.msg_err ?? '', exitCode: parsed.exit_code ?? null };
  }

  private async freshViewImages(before: Map<string, number>, data: Record<string, unknown>): Promise<ToolContent[]> {
    if (!this.workspace) return [];
    const viewDir = path.join(this.workspace.workspaceDir, 'view');
    const after = await snapshotDir(viewDir);
    const fresh = [...after.keys()].filter((n) => after.get(n) !== before.get(n)).sort();
    const images: ToolContent[] = [];
    const skipped: string[] = [];
    for (const name of fresh) {
      const mimeType = VIEW_IMAGE_TYPES[path.extname(name).toLowerCase()];
      const size = (await fs.stat(path.join(viewDir, name))).size;
      if (!mimeType || size > MAX_VIEW_IMAGE_BYTES || images.length >= MAX_VIEW_IMAGES) {
        skipped.push(name);
        continue;
      }
      images.push({ type: 'image', name, mimeType, base64: (await fs.readFile(path.join(viewDir, name))).toString('base64') });
    }
    if (images.length > 0) data.viewedImages = images.map((i) => (i as { name: string }).name);
    if (skipped.length > 0) {
      data.viewNotice =
        `Not shown: ${skipped.join(', ')}. At most ${String(MAX_VIEW_IMAGES)} PNG, JPEG, GIF or WebP images of up to ` +
        `${String(MAX_VIEW_IMAGE_BYTES / 1024 / 1024)} MB are shown per call.`;
    }
    return images;
  }

  /** Places every conversation file in input/ under its manifest name. Once per turn. */
  private async materializeChatFiles(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.runtime || !this.workspace || !this.db || !this.storage || !this.userId) return { ok: true };
    const names = sandboxInputNames(this.chatFiles);
    for (const f of this.chatFiles) {
      if (this.materialized.has(f.id)) continue;
      const name = names.get(f.id)!;
      try {
        await this.runtime.materializeAttachment(this.workspace, f.id, this.userId, this.db, this.storage, name);
        this.materialized.set(f.id, `input/${name}`);
      } catch (err) {
        log.warn({ err, fileId: f.id }, 'Failed to place a conversation file in the sandbox');
        return {
          ok: false,
          error:
            err instanceof AttachmentNotFoundError
              ? `Conversation file "${nameForModel(f.filename)}" (${f.id}) was not found.`
              : `Conversation file "${nameForModel(f.filename)}" (${f.id}) could not be read from storage. Try again, or tell the user the file is unavailable.`,
        };
      }
    }
    return { ok: true };
  }
}

/** The format's structural check, or null for a format without one. */
async function structuralCheck(name: string, buf: Buffer): Promise<{ ok: boolean; errors: string[] } | null> {
  switch (path.extname(name).toLowerCase()) {
    case '.pdf':
      return verifyPdf(buf);
    case '.xlsx':
      return verifyXlsx(buf);
    case '.docx':
      return verifyDocx(buf);
    case '.pptx':
      return verifyPptx(buf);
    default:
      return null;
  }
}
