/**
 * ExecutionRuntime: Unified execution engine for ArcNave.
 *
 * Implements the 6-part execution runtime:
 * 1. File Workspace Engine: Isolated temp directories (input/, output/, temp/) with cleanup and attachment staging.
 * 2. Python Sandbox Engine: Executes Python in an isolated container/sandbox with workspace directory binding.
 * 3. Node Engine (Safe Internal Handlers): Pre-compiled document/data generators (ExcelJS, DOCX, PPTXGenJS, PDF-lib)
 *    Safety invariant: Zero arbitrary model-written JavaScript in the backend process.
 * 4. Controlled CLI Engine: Allowlisted utilities with timeouts and strict execution policies.
 * 5. XML / OOXML Package Engine: ZIP/XML inspection, validation, and structural verification for Office packages.
 * 6. Deterministic Skill Script Engine: Deterministic execution of pre-validated scripts from skills.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import JSZip from 'jszip';

import { logger } from '../../logger.js';
import type { Database } from '../../db/client.js';
import { attachments } from '../../db/schema.js';
import { generateStorageKey, type ObjectStorage } from '../../services/storage.js';
import type { SandboxClient, SandboxExecutionResult } from '../sandbox/client.js';
import { ProcessSandboxClient } from '../sandbox/processSandboxClient.js';
import {
  MIME_BY_FORMAT,
  renderMarkdownExport,
  type ExportFormat,
} from '../../services/documents/index.js';
import type { SkillService } from '../../services/skills.js';

const log = logger.child({ module: 'executionRuntime' });

export interface WorkspaceFiles {
  workspaceDir: string;
  inputDir: string;
  outputDir: string;
  tempDir: string;
}

export interface WorkspaceInputFile {
  filename: string;
  data: Buffer | string;
}

export interface WorkspaceOutputFile {
  filename: string;
  data: Buffer;
  sizeBytes: number;
  mimeType: string;
}

export interface PersistedOutputFile {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  downloadUrl: string;
}

export interface MaterializedAttachment {
  attachmentId: string;
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface OoxmlValidationResult {
  valid: boolean;
  format?: 'docx' | 'xlsx' | 'pptx' | 'unknown';
  hasContentTypes: boolean;
  entries: string[];
  errors: string[];
}

/** The attachment does not exist or belongs to someone else. Distinct from a storage failure. */
export class AttachmentNotFoundError extends Error {
  constructor(readonly attachmentId: string) {
    super(`Attachment "${attachmentId}" not found or not authorized for user.`);
    this.name = 'AttachmentNotFoundError';
  }
}

/**
 * What the one sandbox may run (G20). Arbitrary model-written Python, the allowlisted CLI
 * utilities, and packaged skill scripts are separate grants, so rendering a PDF with `pdftoppm`
 * never depends on the arbitrary-code flag.
 */
export interface RuntimePermissions {
  pythonAllowed: boolean;
  trustedCliAllowed: boolean;
  skillScriptAllowed: boolean;
}

/** Thrown when a runtime engine is asked for work its permission does not grant. */
export class RuntimePermissionError extends Error {
  constructor(readonly permission: keyof RuntimePermissions) {
    super(`Execution runtime permission "${permission}" is not granted in this deployment.`);
    this.name = 'RuntimePermissionError';
  }
}

/** CLIs the local trusted executor can run: poppler ships in the backend image (ADR-0008).
 *  LibreOffice and pandoc are not there, so they stay on the sandbox. */
const LOCAL_TRUSTED_CLIS = new Set(['pdftoppm', 'pdfinfo', 'pdftotext']);

export class ExecutionRuntime {
  private readonly sandboxClient?: SandboxClient;
  private readonly trustedClient?: SandboxClient;
  private readonly baseTempDir: string;
  readonly permissions: RuntimePermissions;

  constructor(
    sandboxClient?: SandboxClient,
    baseTempDir: string = path.join(os.tmpdir(), 'arcnave-workspaces'),
    // Omitted only by tests and scripts that build a runtime by hand; `buildServices` always
    // passes the deployment's real grants.
    permissions: RuntimePermissions = { pythonAllowed: true, trustedCliAllowed: true, skillScriptAllowed: true },
    // Runs trusted work (poppler CLIs, packaged skill scripts) instead of the sandbox when set.
    // Never used for model-written code.
    trustedClient?: SandboxClient,
  ) {
    this.sandboxClient = sandboxClient;
    this.trustedClient = trustedClient;
    this.baseTempDir = baseTempDir;
    this.permissions = permissions;
  }

  /** The sandbox exists and may run this kind of work. */
  can(permission: keyof RuntimePermissions): boolean {
    const engine = permission === 'pythonAllowed' ? this.sandboxClient : (this.trustedClient ?? this.sandboxClient);
    return engine !== undefined && this.permissions[permission];
  }

  private trustedEngine(utility?: string): SandboxClient | undefined {
    if (this.trustedClient && (utility === undefined || LOCAL_TRUSTED_CLIS.has(utility))) return this.trustedClient;
    return this.sandboxClient;
  }

  /* -------------------------------------------------------------------------- 1. File Workspace Engine */

  /**
   * Creates an isolated workspace directory with input/, output/, and temp/ subdirectories.
   */
  async createWorkspace(runId: string): Promise<WorkspaceFiles> {
    const cleanRunId = path.basename(runId).replace(/[^a-zA-Z0-9_-]/g, '_') || `run_${Date.now()}`;
    const workspaceDir = path.join(this.baseTempDir, cleanRunId);
    const inputDir = path.join(workspaceDir, 'input');
    const outputDir = path.join(workspaceDir, 'output');
    const tempDir = path.join(workspaceDir, 'temp');

    await fs.mkdir(inputDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });

    return { workspaceDir, inputDir, outputDir, tempDir };
  }

  /**
   * Enforces strict workspace lifecycle with guaranteed cleanup in a `finally` block.
   */
  async withWorkspace<T>(runId: string, fn: (workspace: WorkspaceFiles) => Promise<T>): Promise<T> {
    const workspace = await this.createWorkspace(runId);
    try {
      return await fn(workspace);
    } finally {
      await this.cleanupWorkspace(workspace);
    }
  }

  /**
   * Materializes input files into the workspace input/ directory with path traversal protection.
   */
  async materializeInputFiles(
    workspace: WorkspaceFiles,
    files: WorkspaceInputFile[],
  ): Promise<string[]> {
    const writtenPaths: string[] = [];
    const resolvedInputBase = path.resolve(workspace.inputDir);

    for (const f of files) {
      const sanitized = path.basename(f.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const safeFilename = sanitized || `file_${Date.now()}`;
      const filePath = path.resolve(workspace.inputDir, safeFilename);

      if (!filePath.startsWith(resolvedInputBase)) {
        throw new Error(`Path traversal attempt detected in filename "${f.filename}"`);
      }

      const buf = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
      await fs.writeFile(filePath, buf);
      writtenPaths.push(filePath);
    }
    return writtenPaths;
  }

  /**
   * Materializes an authorized user attachment directly into the workspace input directory.
   */
  async materializeAttachment(
    workspace: WorkspaceFiles,
    attachmentId: string,
    userId: string,
    db: Database,
    storage: ObjectStorage,
    /** The name under input/ the manifest promised (sandboxInputNames). When given it is used
     *  as is, so the path the model was told is the path that exists. */
    targetName?: string,
  ): Promise<MaterializedAttachment> {
    const [row] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.userId, userId)))
      .limit(1);

    if (!row) {
      throw new AttachmentNotFoundError(attachmentId);
    }

    const data = await storage.get(row.storageKey);
    if (targetName) {
      const target = path.join(workspace.inputDir, path.basename(targetName));
      await fs.writeFile(target, data);
      return { attachmentId: row.id, filename: path.basename(targetName), path: target, mimeType: row.mimeType, sizeBytes: row.sizeBytes };
    }
    const sanitized = path.basename(row.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    let safeFilename = sanitized || `attachment_${attachmentId}`;
    let filePath = path.join(workspace.inputDir, safeFilename);

    // Collision protection: if a file with this name already exists in workspace input,
    // disambiguate using the unique attachmentId prefix so duplicate filenames do not overwrite
    try {
      await fs.access(filePath);
      const ext = path.extname(safeFilename);
      const base = path.basename(safeFilename, ext);
      const uniqueSuffix = attachmentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'dup';
      safeFilename = `${base}_${uniqueSuffix}${ext}`;
      filePath = path.join(workspace.inputDir, safeFilename);
    } catch {
      // File does not exist yet; safeFilename is unique
    }

    await fs.writeFile(filePath, data);

    return {
      attachmentId: row.id,
      filename: safeFilename,
      path: filePath,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    };
  }

  /**
   * Batch materializes multiple user attachments into the workspace.
   */
  async materializeAttachments(
    workspace: WorkspaceFiles,
    attachmentIds: string[],
    userId: string,
    db: Database,
    storage: ObjectStorage,
  ): Promise<MaterializedAttachment[]> {
    const results: MaterializedAttachment[] = [];
    for (const id of attachmentIds) {
      const materialized = await this.materializeAttachment(workspace, id, userId, db, storage);
      results.push(materialized);
    }
    return results;
  }

  /**
   * Collects all generated deliverable files from the workspace output/ directory.
   */
  async collectOutputFiles(workspace: WorkspaceFiles): Promise<WorkspaceOutputFile[]> {
    const results: WorkspaceOutputFile[] = [];
    try {
      const entries = await fs.readdir(workspace.outputDir);
      for (const entry of entries) {
        const filePath = path.join(workspace.outputDir, entry);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          const data = await fs.readFile(filePath);
          const ext = path.extname(entry).replace('.', '').toLowerCase() as ExportFormat;
          const mimeType = MIME_BY_FORMAT[ext] || 'application/octet-stream';
          results.push({
            filename: entry,
            data,
            sizeBytes: stat.size,
            mimeType,
          });
        }
      }
    } catch (err) {
      log.warn({ err, outputDir: workspace.outputDir }, 'failed to collect output files');
    }
    return results;
  }

  /**
   * Collects generated output files from workspace, validates packages, and persists them into ArcNave storage.
   */
  async persistOutputFiles(
    workspace: WorkspaceFiles,
    params: { userId: string; messageId: string; db: Database; storage: ObjectStorage },
  ): Promise<PersistedOutputFile[]> {
    const outputs = await this.collectOutputFiles(workspace);
    const persisted: PersistedOutputFile[] = [];

    for (const out of outputs) {
      const ext = path.extname(out.filename).toLowerCase();
      if (['.docx', '.xlsx', '.pptx'].includes(ext)) {
        const validation = await this.validateOoxmlPackage(out.data);
        if (!validation.valid) {
          log.warn({ filename: out.filename, errors: validation.errors }, 'Output file failed OOXML structural validation');
        }
      }

      const storageKey = generateStorageKey(params.userId);
      await params.storage.put(storageKey, out.data, out.mimeType);

      const [row] = await params.db
        .insert(attachments)
        .values({
          userId: params.userId,
          messageId: params.messageId,
          filename: out.filename,
          mimeType: out.mimeType,
          sizeBytes: out.sizeBytes,
          storageKey,
          status: 'ready',
          error: '',
          extractedText: null,
        })
        .returning();

      if (row) {
        persisted.push({
          attachmentId: row.id,
          filename: row.filename,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          storageKey,
          downloadUrl: `/files/${row.id}/download`,
        });
      }
    }

    return persisted;
  }

  /**
   * Safely and reliably cleans up the workspace directory upon completion or failure.
   */
  async cleanupWorkspace(workspace: WorkspaceFiles): Promise<void> {
    try {
      await fs.rm(workspace.workspaceDir, { recursive: true, force: true });
    } catch (err) {
      log.warn({ err, workspaceDir: workspace.workspaceDir }, 'failed to clean up workspace');
    }
  }

  /* -------------------------------------------------------------------------- 2. Python Sandbox Engine */

  /**
   * Executes Python code inside the isolated Sandbox client with workspace directory binding.
   */
  async executePython(
    code: string,
    workspace?: WorkspaceFiles,
    signal?: AbortSignal,
    expectedOutputs?: string[],
    sessionKey?: string,
  ): Promise<SandboxExecutionResult> {
    if (!this.sandboxClient) {
      throw new Error('Python sandbox execution is disabled or unavailable.');
    }
    if (!this.permissions.pythonAllowed) throw new RuntimePermissionError('pythonAllowed');
    const execSignal = signal ?? new AbortController().signal;
    return this.sandboxClient.runPython(code, execSignal, {
      workspaceDir: workspace?.workspaceDir,
      expectedOutputs,
      sessionKey,
    });
  }

  /* -------------------------------------------------------------------------- 3. Node Engine (Safe Internal Handlers) */

  /**
   * Safe document rendering using pre-compiled internal handlers (exceljs, docx, pptxgenjs, pdf-lib).
   * SAFETY INVARIANT: Arbitrary JS code execution is strictly rejected.
   */
  async renderDocument(
    content: string,
    format: ExportFormat,
    workspace?: WorkspaceFiles,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const buffer = await renderMarkdownExport(content, format);
    const mimeType = MIME_BY_FORMAT[format];

    if (workspace) {
      const filename = `deliverable_${Date.now()}.${format}`;
      await fs.writeFile(path.join(workspace.outputDir, filename), buffer);
    }

    return { buffer, mimeType };
  }

  /* -------------------------------------------------------------------------- 4. Controlled CLI Engine */

  /**
   * Validates and executes an allowlisted CLI utility with timeout enforcement and isolated cwd.
   */
  async executeControlledCli(
    utility: string,
    args: string[],
    options?: {
      cwd?: string;
      allowlist?: Set<string>;
      timeoutMs?: number;
      signal?: AbortSignal;
      /** Files the command writes under `output/`, so a remote sandbox returns them. */
      expectedOutputs?: string[];
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.permissions.trustedCliAllowed) throw new RuntimePermissionError('trustedCliAllowed');
    const allowlist =
      options?.allowlist ?? new Set(['pdftotext', 'pdfinfo', 'pandoc', 'soffice', 'pdftoppm']);
    if (!allowlist.has(utility)) {
      throw new Error(`CLI utility "${utility}" is not in the approved security allowlist.`);
    }

    // Argument injection guard: arguments must not contain shell control characters
    for (const arg of args) {
      if (/[;&|`$><]/.test(arg)) {
        throw new Error(`Argument "${arg}" contains disallowed shell control characters.`);
      }
    }

    const timeoutMs = options?.timeoutMs ?? 30000;
    const timeoutSec = Math.max(1, Math.floor(timeoutMs / 1000));

    // Priority 1: the trusted executor or the container sandbox, whichever serves this utility
    const cliEngine = this.trustedEngine(utility);
    if (cliEngine) {
      const execSignal = options?.signal ?? new AbortController().signal;
      // We run the CLI utility inside the isolated sandbox container via a secure python bridge script
      const bridgeScript = `
import subprocess
import sys
import json

cmd = [${JSON.stringify(utility)}, *${JSON.stringify(args)}]
try:
    res = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=${timeoutSec},
    )
    print(json.dumps({
        "stdout": res.stdout.decode('utf-8', errors='replace'),
        "stderr": res.stderr.decode('utf-8', errors='replace'),
        "exitCode": res.returncode
    }))
except subprocess.TimeoutExpired:
    print(json.dumps({
        "stdout": "",
        "stderr": "Command timed out",
        "exitCode": 124
    }))
except Exception as e:
    print(json.dumps({
        "stdout": "",
        "stderr": str(e),
        "exitCode": 1
    }))
`;

      const result = await cliEngine.runPython(bridgeScript, execSignal, {
        workspaceDir: options?.cwd,
        expectedOutputs: options?.expectedOutputs,
      });

      // Parse JSON from output
      try {
        const rawOutput = result.outputs?.[0]?.text;
        if (rawOutput) {
          const parsedWrapper = JSON.parse(rawOutput) as { msg_out?: string; msg_err?: string };
          const innerJson = parsedWrapper.msg_out?.trim();
          if (innerJson) {
            const cliRes = JSON.parse(innerJson) as {
              stdout: string;
              stderr: string;
              exitCode: number;
            };
            return {
              stdout: cliRes.stdout || '',
              stderr: cliRes.stderr || parsedWrapper.msg_err || '',
              exitCode: typeof cliRes.exitCode === 'number' ? cliRes.exitCode : 0,
            };
          }
        }
      } catch (err) {
        log.warn({ err, result }, 'Failed to parse CLI container execution output');
      }

      return {
        stdout: '',
        stderr: 'Failed to retrieve CLI execution result from container sandbox.',
        exitCode: 1,
      };
    }

    // Priority 2: Execute in local Docker sandbox container if available (for soffice or when USE_DOCKER_SANDBOX is enabled)
    const useDocker = utility === 'soffice' || process.env.USE_DOCKER_SANDBOX === 'true';
    if (useDocker) {
      try {
        const { execFile: execFileCb } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFileCb);

      const targetDir = path.resolve(options?.cwd ?? this.baseTempDir);
      const imageName = process.env.SANDBOX_IMAGE || 'arcnave-sandbox:batch5';
      const dockerArgs = [
        'run',
        '--rm',
        '-v',
        `${targetDir}:/workspace`,
        '--network',
        'none',
        '--entrypoint',
        '/bin/sh',
        imageName,
        '-c',
        `cd /workspace && ${utility} ${args.join(' ')}`,
      ];

      const dockerRes = await execFileAsync('docker', dockerArgs, {
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        stdout: dockerRes.stdout || '',
        stderr: dockerRes.stderr || '',
        exitCode: 0,
      };
    } catch (dockerErr: any) {
      if (dockerErr && typeof dockerErr.code === 'number' && dockerErr.stdout !== undefined) {
        return {
          stdout: String(dockerErr.stdout || ''),
          stderr: String(dockerErr.stderr || dockerErr.message),
          exitCode: dockerErr.code,
        };
      }
      // If Docker is unavailable or image not found, fall through to host execution policy
    }
  }

    // Fail-closed policy for host execution:
    // Host execution is NEVER allowed in production, and in non-production only if ALLOW_HOST_CLI === 'true'
    const isProduction = process.env.NODE_ENV === 'production';
    const allowHostCli = process.env.ALLOW_HOST_CLI === 'true';

    if (isProduction || !allowHostCli) {
      throw new Error(
        `Native CLI execution on host is disabled in ${
          isProduction ? 'production' : 'non-container environments'
        } for security (ALLOW_HOST_CLI=false). Isolated container sandbox is required.`
      );
    }

    const { execFile } = await import('node:child_process');

    return new Promise((resolve) => {
      execFile(
        utility,
        args,
        {
          cwd: options?.cwd ?? this.baseTempDir,
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          if (err) {
            resolve({
              stdout: String(stdout || ''),
              stderr: String(stderr || err.message),
              exitCode: typeof (err as any).code === 'number' ? (err as any).code : 1,
            });
          } else {
            resolve({
              stdout: String(stdout || ''),
              stderr: String(stderr || ''),
              exitCode: 0,
            });
          }
        },
      );
    });
  }

  /* -------------------------------------------------------------------------- 5. XML / OOXML Package Engine */

  /**
   * Inspects and validates the ZIP structure and XML contents of OOXML packages (DOCX, XLSX, PPTX).
   */
  async validateOoxmlPackage(buffer: Buffer): Promise<OoxmlValidationResult> {
    const errors: string[] = [];
    const entries: string[] = [];
    let hasContentTypes = false;
    let detectedFormat: 'docx' | 'xlsx' | 'pptx' | 'unknown' = 'unknown';

    try {
      const zip = await JSZip.loadAsync(buffer);
      for (const relativePath of Object.keys(zip.files)) {
        entries.push(relativePath);
        if (relativePath === '[Content_Types].xml') {
          hasContentTypes = true;
        }
        if (relativePath.startsWith('word/')) {
          detectedFormat = 'docx';
        } else if (relativePath.startsWith('xl/')) {
          detectedFormat = 'xlsx';
        } else if (relativePath.startsWith('ppt/')) {
          detectedFormat = 'pptx';
        }
      }

      if (!hasContentTypes) {
        errors.push('Missing [Content_Types].xml in package root');
      }

      // Verify essential document XML parts based on format
      if (detectedFormat === 'docx' && !entries.includes('word/document.xml')) {
        errors.push('DOCX package missing word/document.xml');
      }
      if (detectedFormat === 'xlsx' && !entries.includes('xl/workbook.xml')) {
        errors.push('XLSX package missing xl/workbook.xml');
      }
      if (detectedFormat === 'pptx' && !entries.includes('ppt/presentation.xml')) {
        errors.push('PPTX package missing ppt/presentation.xml');
      }

      return {
        valid: errors.length === 0,
        format: detectedFormat,
        hasContentTypes,
        entries,
        errors,
      };
    } catch (err: any) {
      return {
        valid: false,
        format: 'unknown',
        hasContentTypes: false,
        entries: [],
        errors: [`Invalid ZIP / OOXML container: ${err.message}`],
      };
    }
  }

  /* -------------------------------------------------------------------------- 6. Deterministic Skill Script Engine */

  /**
   * Executes a deterministic skill script (e.g. financial model validator, layout verifier).
   */
  async executeDeterministicSkillScript(
    scriptContent: string,
    inputData: Record<string, unknown>,
    workspace?: WorkspaceFiles,
  ): Promise<{ ok: boolean; output?: unknown; error?: string }> {
    const engine = this.trustedEngine();
    if (!engine) {
      return { ok: false, error: 'Python sandbox execution is disabled or unavailable.' };
    }
    if (!this.permissions.skillScriptAllowed) {
      return { ok: false, error: new RuntimePermissionError('skillScriptAllowed').message };
    }
    const wrappedCode = `
import json
import sys

input_data = json.loads(${JSON.stringify(JSON.stringify(inputData))})
${scriptContent}
`;
    try {
      const res = await engine.runPython(
        wrappedCode,
        new AbortController().signal,
        { workspaceDir: workspace?.workspaceDir },
      );
      const outputText = res.outputs.map((o) => o.text).join('\n');
      return { ok: true, output: outputText };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Executes a trusted Skill script packaged within an installed Skill directory.
   * Resolves the script via SkillService, checks extension (must be .py for sandbox),
   * and runs inside the isolated Cloud Run Python sandbox.
   * Arbitrary backend JS/TS execution is strictly prohibited.
   */
  async executeTrustedSkillScript(
    skillRef: { skill: string; resource: string },
    inputData: Record<string, unknown>,
    workspace?: WorkspaceFiles,
    skillService?: SkillService,
  ): Promise<{ ok: boolean; output?: unknown; error?: string }> {
    if (!skillRef || !skillRef.skill || !skillRef.resource) {
      return { ok: false, error: 'Both skill name and resource path are required.' };
    }

    const ext = path.extname(skillRef.resource).toLowerCase();
    if (ext !== '.py') {
      return {
        ok: false,
        error: `Script extension "${ext}" is not supported for trusted sandbox execution. Only packaged ".py" scripts are approved. Arbitrary backend JS/TS execution is prohibited.`,
      };
    }

    if (!skillService) {
      return { ok: false, error: 'SkillService is required to resolve trusted skill scripts.' };
    }

    const scriptContent = await skillService.getSkillResource(skillRef.skill, skillRef.resource);
    if (!scriptContent) {
      return {
        ok: false,
        error: `Trusted skill script "${skillRef.skill}/${skillRef.resource}" could not be resolved or was outside skill directory boundary.`,
      };
    }

    return this.executeDeterministicSkillScript(scriptContent, inputData, workspace);
  }

  /**
   * Runs a packaged skill script with its input and output as JSON files in the workspace, not
   * inlined into the code: a remote sandbox caps the submitted code at ~20 KB, and a page of
   * extracted rows alone can exceed that. The script sees `input_data` and must write its result
   * with `json.dump(result, open(OUTPUT_PATH, 'w'))`.
   */
  async runSkillScriptJson(
    skillRef: { skill: string; resource: string },
    inputData: unknown,
    workspace: WorkspaceFiles,
    skillService: SkillService,
    signal?: AbortSignal,
  ): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
    const engine = this.trustedEngine();
    if (!engine) return { ok: false, error: 'The execution sandbox is not configured.' };
    if (!this.permissions.skillScriptAllowed) {
      return { ok: false, error: new RuntimePermissionError('skillScriptAllowed').message };
    }
    if (path.extname(skillRef.resource).toLowerCase() !== '.py') {
      return { ok: false, error: 'Only packaged ".py" skill scripts can run.' };
    }
    const script = await skillService.getSkillResource(skillRef.skill, skillRef.resource);
    if (!script) {
      return { ok: false, error: `Skill script "${skillRef.skill}/${skillRef.resource}" was not found.` };
    }

    const stem = `skill_${path.basename(skillRef.resource, '.py').replace(/[^a-zA-Z0-9_]/g, '_')}_${Date.now().toString(36)}`;
    const inName = `${stem}_in.json`;
    const outName = `${stem}_out.json`;
    await fs.writeFile(path.join(workspace.inputDir, inName), JSON.stringify(inputData));
    const code = `import json\nwith open('input/${inName}') as _f:\n    input_data = json.load(_f)\nOUTPUT_PATH = 'output/${outName}'\n${script}\n`;

    const outPath = path.join(workspace.outputDir, outName);
    try {
      const res = await engine.runPython(code, signal ?? new AbortController().signal, {
        workspaceDir: workspace.workspaceDir,
        expectedOutputs: [outName],
      });
      let raw: string;
      try {
        raw = await fs.readFile(outPath, 'utf8');
      } catch {
        // Say why, not just that: the exit code, a timeout, stderr, and any file the script
        // wrote that did not come back (a failed sandbox upload leaves it undeclared).
        const detail: string[] = [];
        try {
          const run = JSON.parse(res.outputs[0]?.text ?? '{}') as {
            msg_err?: string;
            exit_code?: number;
            timed_out?: boolean;
          };
          if (run.timed_out) detail.push('it timed out');
          if (typeof run.exit_code === 'number') detail.push(`exit code ${String(run.exit_code)}`);
          if (run.msg_err?.trim()) detail.push(`stderr: ${run.msg_err.trim().slice(-1500)}`);
        } catch {
          detail.push('the sandbox returned unstructured output');
        }
        if (res.undeclaredOutputs?.includes(outName)) detail.push('the result file was written but not returned by the sandbox');
        return {
          ok: false,
          error: `Skill script produced no result${detail.length ? ` (${detail.join('; ')})` : ' (no exit status or stderr was reported)'}.`,
        };
      }
      return { ok: true, output: JSON.parse(raw) as unknown };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      // Neither file is a deliverable; leaving them would let persistOutputFiles publish them.
      await fs.rm(outPath, { force: true });
      await fs.rm(path.join(workspace.inputDir, inName), { force: true });
    }
  }
}
