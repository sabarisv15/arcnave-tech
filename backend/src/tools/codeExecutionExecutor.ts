/**
 * Executes `run_python` only — a sibling to `ProjectToolExecutor`, not a branch inside it,
 * because this tool touches no database and has a genuinely different failure mode (an external
 * sandbox call, not a Postgres query). Every branch returns a `ToolResult`, never throws, for
 * the same reason as `ProjectToolExecutor`: a bad input or a sandbox failure is something the
 * *model* needs to see and react to (Invariant 1).
 *
 * Connected to ExecutionRuntime for isolated per-run workspaces, input materialization,
 * and output file persistence.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { logger } from '../logger.js';
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { ObjectStorage } from '../services/storage.js';
import { verifyPdf } from '../services/documents/verify/pdfVerify.js';
import { verifyXlsx } from '../services/documents/verify/xlsxVerify.js';
import { verifyDocx } from '../services/documents/verify/docxVerify.js';
import { verifyPptx } from '../services/documents/verify/pptxVerify.js';
import type { DeliverableWarning } from '../services/documents/primitives.js';
import { visualQaEngine } from '../services/qa/visualQaEngine.js';
import { AttachmentNotFoundError, ExecutionRuntime, type WorkspaceFiles } from './execution/executionRuntime.js';
import type { SandboxClient } from './sandbox/client.js';

const log = logger.child({ module: 'codeExecutionExecutor' });

const runInput = z.object({
  code: z.string().min(1),
  input_files: z.array(z.string().uuid()).max(20).optional(),
  expected_outputs: z.array(z.string()).max(20).optional(),
  expectedOutputs: z.array(z.string()).max(20).optional(),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

/** The sandbox's `msg_out`/`msg_err` JSON chunk shape, per the Code Execution REST reference. */
interface SandboxOutputChunk {
  msg_out?: string;
  msg_err?: string;
  undeclaredOutputs?: string[];
}

export interface CodeExecutionOptions {
  workspace?: WorkspaceFiles;
  userId?: string;
  messageId?: string;
  db?: Database;
  storage?: ObjectStorage;
}

export class CodeExecutionToolExecutor implements ToolExecutor {
  private readonly client?: SandboxClient;
  private readonly runtime?: ExecutionRuntime;
  private readonly workspace?: WorkspaceFiles;
  private readonly userId?: string;
  private readonly messageId?: string;
  private readonly db?: Database;
  private readonly storage?: ObjectStorage;
  /** fileId → path under input/, so a second call in the same turn reuses the same path. */
  private readonly materialized = new Map<string, string>();

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
    this.db = options?.db;
    this.storage = options?.storage;
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }
    if (call.name !== 'run_python') {
      return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }

    const parsed = runInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const declaredOutputs = parsed.data.expected_outputs ?? parsed.data.expectedOutputs;

    let inputFiles: Array<{ fileId: string; path: string }> = [];
    if (parsed.data.input_files && parsed.data.input_files.length > 0) {
      const staged = await this.materializeInputs(parsed.data.input_files);
      if (!staged.ok) return textResult(call.id, false, staged.error);
      inputFiles = staged.files;
    }

    let execution;
    try {
      if (this.runtime) {
        execution = await this.runtime.executePython(parsed.data.code, this.workspace, signal, declaredOutputs);
      } else if (this.client) {
        execution = await this.client.runPython(parsed.data.code, signal, {
          workspaceDir: this.workspace?.workspaceDir,
          expectedOutputs: declaredOutputs,
        });
      } else {
        return textResult(call.id, false, 'No execution runtime or sandbox configured.');
      }
    } catch (err) {
      return textResult(call.id, false, err instanceof Error ? err.message : String(err));
    }

    const jsonChunk = execution.outputs.find((o) => o.mimeType === 'application/json');
    let parsedChunk: SandboxOutputChunk = {};
    if (jsonChunk) {
      try {
        parsedChunk = JSON.parse(jsonChunk.text) as SandboxOutputChunk;
      } catch {
        // The sandbox's own output was not the documented JSON shape — fall through with
        // empty stdout/stderr rather than throwing; the model still gets an ok result.
      }
    }

    const rawStdout = parsedChunk.msg_out ?? '';
    const rawStderr = parsedChunk.msg_err ?? '';
    const stdout = rawStdout.slice(0, this.maxOutputChars);
    const stderr = rawStderr.slice(0, Math.max(0, this.maxOutputChars - stdout.length));
    const truncated = stdout.length < rawStdout.length || stderr.length < rawStderr.length;

    // Collect and persist any output files generated by Python script in workspace.outputDir
    let persistedFiles: Array<{ filename: string; mimeType: string; sizeBytes: number; downloadUrl: string }> = [];
    const structuralWarnings: DeliverableWarning[] = [];

    if (this.workspace) {
      try {
        // Run structural verification and visual QA on any office/pdf deliverable files in outputDir
        const entries = await fs.readdir(this.workspace.outputDir).catch(() => [] as string[]);
        for (const fname of entries) {
          const filePath = path.join(this.workspace.outputDir, fname);
          const stat = await fs.stat(filePath).catch(() => null);
          if (!stat || !stat.isFile()) continue;

          const ext = path.extname(fname).toLowerCase();
          const buf = await fs.readFile(filePath);

          let v: { ok: boolean; errors: string[] } | null = null;
          let docType = '';

          if (ext === '.pdf') {
            docType = 'PDF';
            v = await verifyPdf(buf);
          } else if (ext === '.xlsx') {
            docType = 'Excel';
            v = await verifyXlsx(buf);
          } else if (ext === '.docx') {
            docType = 'Word doc';
            v = await verifyDocx(buf);
          } else if (ext === '.pptx') {
            docType = 'PowerPoint';
            v = await verifyPptx(buf);
          }

          if (v) {
            if (!v.ok) {
              // Block persistence of corrupted file
              await fs.unlink(filePath).catch(() => undefined);
              structuralWarnings.push({
                severity: 'warning',
                type: 'structural_corruption',
                message: `Generated ${docType} "${fname}" failed structural verification: ${v.errors.join('; ')}`,
                repairable: true,
              });
              continue;
            }

            // File is structurally sound: evaluate visual QA for layout-sensitive deliverables
            try {
              const format = ext.slice(1) as 'pdf' | 'xlsx' | 'docx' | 'pptx';
              const visualReport = await visualQaEngine.evaluateVisualQa({
                buffer: buf,
                format,
                runtime: this.runtime,
                workspace: this.workspace,
                signal,
              });

              if (visualReport.defects.length > 0) {
                for (const defect of visualReport.defects) {
                  structuralWarnings.push({
                    severity: defect.severity === 'critical' ? 'error' : 'warning',
                    type: defect.type,
                    message: `Visual defect in "${fname}": ${defect.description}`,
                    repairable: defect.repairable,
                  });
                }
              }

              if (!visualReport.previewAvailable && visualReport.diagnostics.length > 0) {
                for (const diag of visualReport.diagnostics) {
                  structuralWarnings.push({
                    severity: 'info',
                    type: 'visual_qa_diagnostic',
                    message: `Visual QA diagnostic for "${fname}": ${diag}`,
                    repairable: false,
                  });
                }
              }
            } catch (visualErr) {
              log.warn({ visualErr, fname }, 'Visual QA evaluation encountered an error for Python output');
            }
          }
        }

        if (this.runtime && this.userId && this.messageId && this.db && this.storage) {
          const persisted = await this.runtime.persistOutputFiles(this.workspace, {
            userId: this.userId,
            messageId: this.messageId,
            db: this.db,
            storage: this.storage,
          });
          persistedFiles = persisted.map((f) => ({
            filename: f.filename,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            downloadUrl: f.downloadUrl,
          }));
        }
      } catch (collectErr) {
        log.warn({ collectErr }, 'Failed to persist Python workspace output files');
      }
    }

    const resultData: Record<string, unknown> = {
      stdout,
      stderr,
      truncated,
    };
    if (inputFiles.length > 0) resultData.inputFiles = inputFiles;

    if (structuralWarnings.length > 0) {
      resultData.warnings = structuralWarnings;
      resultData.repairable = true;
    }

    const undeclared = execution.undeclaredOutputs ?? parsedChunk.undeclaredOutputs;
    if (Array.isArray(undeclared) && undeclared.length > 0) {
      resultData.undeclaredOutputs = undeclared;
      resultData.notice = `Output file(s) [${undeclared.join(', ')}] were created in "output/" but not declared in "expected_outputs". Declare them in "expected_outputs" to authorize upload.`;
    }

    if (persistedFiles.length > 0) {
      resultData.persistedFiles = persistedFiles;
      resultData.outputFilesSummary = persistedFiles
        .map((f) => `Saved file "${f.filename}" (${Math.round(f.sizeBytes / 1024)} KB) -> ${f.downloadUrl}`)
        .join('\n');
    }

    return {
      toolCallId: call.id,
      ok: true,
      content: [{ type: 'json', data: resultData }],
    };
  }

  /**
   * Copies the named attachments into this turn's workspace `input/`, scoped to the calling user.
   * Works the same for this turn's files and for files from earlier turns (G26, G15): identity
   * is the fileId, and the bytes come from object storage on demand.
   */
  private async materializeInputs(
    fileIds: string[],
  ): Promise<{ ok: true; files: Array<{ fileId: string; path: string }> } | { ok: false; error: string }> {
    if (!this.runtime || !this.workspace || !this.db || !this.storage || !this.userId) {
      return { ok: false, error: 'input_files is not available here: this sandbox has no workspace for uploaded files.' };
    }
    const files: Array<{ fileId: string; path: string }> = [];
    for (const fileId of fileIds) {
      let relPath = this.materialized.get(fileId);
      if (!relPath) {
        try {
          const mat = await this.runtime.materializeAttachment(this.workspace, fileId, this.userId, this.db, this.storage);
          relPath = `input/${mat.filename}`;
          this.materialized.set(fileId, relPath);
        } catch (err) {
          log.warn({ err, fileId }, 'Failed to materialize run_python input file');
          const missing = err instanceof AttachmentNotFoundError;
          return {
            ok: false,
            error: missing
              ? `Attachment "${fileId}" was not found, or you do not have access to it.`
              : `Attachment "${fileId}" exists but could not be read from storage. Try again, or tell the user the file is unavailable.`,
          };
        }
      }
      files.push({ fileId, path: relPath });
    }
    return { ok: true, files };
  }
}
