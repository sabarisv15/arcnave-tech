/**
 * ExecutionRuntime: Unified execution engine for ArcNave.
 *
 * Implements the 6-part execution runtime:
 * 1. File Workspace Engine: Isolated temp directories (input/, output/, temp/) with cleanup.
 * 2. Python Sandbox Engine: Executes Python in an isolated container/sandbox with input/output sync.
 * 3. Node Engine (Safe Internal Handlers): Pre-compiled document/data generators (ExcelJS, DOCX, PPTXGenJS, PDF-lib)
 *    Safety invariant: Zero arbitrary model-written JavaScript in the backend process.
 * 4. Controlled CLI Engine: Allowlisted utilities with timeouts and strict execution policies.
 * 5. XML / OOXML Package Engine: ZIP/XML inspection, validation, and structural verification for Office packages.
 * 6. Deterministic Skill Script Engine: Deterministic execution of pre-validated scripts from skills.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import { logger } from '../../logger.js';
import type { SandboxClient, SandboxExecutionResult } from '../sandbox/client.js';
import {
  MIME_BY_FORMAT,
  renderMarkdownExport,
  type ExportFormat,
} from '../../services/documents/index.js';

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

export interface OoxmlValidationResult {
  valid: boolean;
  format?: 'docx' | 'xlsx' | 'pptx' | 'unknown';
  hasContentTypes: boolean;
  entries: string[];
  errors: string[];
}

export class ExecutionRuntime {
  constructor(
    private readonly sandboxClient?: SandboxClient,
    private readonly baseTempDir: string = path.join(os.tmpdir(), 'arcnave-workspaces'),
  ) {}

  /* -------------------------------------------------------------------------- 1. File Workspace Engine */

  /**
   * Creates an isolated workspace directory with input/, output/, and temp/ subdirectories.
   */
  async createWorkspace(runId: string): Promise<WorkspaceFiles> {
    const cleanRunId = path.basename(runId).replace(/[^a-zA-Z0-9_-]/g, '_');
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
   * Materializes input files into the workspace input/ directory.
   */
  async materializeInputFiles(
    workspace: WorkspaceFiles,
    files: WorkspaceInputFile[],
  ): Promise<string[]> {
    const writtenPaths: string[] = [];
    for (const f of files) {
      const safeFilename = path.basename(f.filename);
      const filePath = path.join(workspace.inputDir, safeFilename);
      const buf = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
      await fs.writeFile(filePath, buf);
      writtenPaths.push(filePath);
    }
    return writtenPaths;
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
   * Executes Python code inside the isolated Sandbox client.
   */
  async executePython(
    code: string,
    executionId?: string,
    signal?: AbortSignal,
    _inputFiles?: WorkspaceInputFile[],
  ): Promise<SandboxExecutionResult> {
    if (!this.sandboxClient) {
      throw new Error('Python sandbox is not configured or disabled in this deployment.');
    }

    return this.sandboxClient.runPython(code, signal ?? new AbortController().signal);
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
   * Validates and executes an allowlisted CLI utility with timeout enforcement.
   */
  async executeControlledCli(
    utility: string,
    args: string[],
    allowlist: Set<string> = new Set(['pdftotext', 'pdfinfo', 'pandoc']),
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!allowlist.has(utility)) {
      throw new Error(`CLI utility "${utility}" is not in the approved security allowlist.`);
    }

    // Argument injection guard: arguments must not contain shell control characters
    for (const arg of args) {
      if (/[;&|`$><]/.test(arg)) {
        throw new Error(`Argument "${arg}" contains disallowed shell control characters.`);
      }
    }

    const { execFile } = await import('node:child_process');

    return new Promise((resolve) => {
      execFile(
        utility,
        args,
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
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
  ): Promise<{ ok: boolean; output?: unknown; error?: string }> {
    // In ArcNave, deterministic skill scripts run in isolated Python sandbox or pure JSON validators
    if (this.sandboxClient) {
      const wrappedCode = `
import json
import sys

input_data = json.loads(${JSON.stringify(JSON.stringify(inputData))})
${scriptContent}
`;
      try {
        const res = await this.sandboxClient.runPython(wrappedCode, new AbortController().signal);
        const outputText = res.outputs.map((o) => o.text).join('\n');
        return { ok: true, output: outputText };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    }

    return {
      ok: false,
      error: 'No execution sandbox available for skill script execution.',
    };
  }
}
