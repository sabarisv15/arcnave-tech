/**
 * ProcessSandboxClient: Local isolated process-based execution of Python code.
 *
 * Provides a robust, zero-cloud sandbox engine for environments where Cloud Run Jobs
 * are not deployed (e.g. local development, on-prem, or hybrid deployments).
 *
 * Implements:
 * - Direct execution using system Python (with pandas, openpyxl, matplotlib).
 * - Per-run workspace directory binding (scripts can read input/ and write to output/).
 * - Strict timeout enforcement with process termination.
 * - Streaming byte caps on stdout and stderr to prevent memory exhaustion.
 * - Safe temporary script cleanup.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { logger } from '../../logger.js';
import { ProviderError } from '../../providers/types.js';
import type { SandboxClient, SandboxExecutionResult } from './client.js';

const log = logger.child({ module: 'processSandboxClient' });

export interface ProcessSandboxClientOptions {
  pythonPath?: string;
  codeTimeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  maxCodeBytes?: number;
}

export class ProcessSandboxClient implements SandboxClient {
  private readonly pythonPath: string;
  private readonly codeTimeoutMs: number;
  private readonly maxStdoutBytes: number;
  private readonly maxStderrBytes: number;
  private readonly maxCodeBytes: number;

  constructor(opts: ProcessSandboxClientOptions = {}) {
    this.pythonPath = opts.pythonPath ?? 'python';
    this.codeTimeoutMs = opts.codeTimeoutMs ?? 15_000;
    this.maxStdoutBytes = opts.maxStdoutBytes ?? 64 * 1024;
    this.maxStderrBytes = opts.maxStderrBytes ?? 64 * 1024;
    this.maxCodeBytes = opts.maxCodeBytes ?? 100 * 1024;
  }

  async runPython(
    code: string,
    signal: AbortSignal,
    options?: { workspaceDir?: string },
  ): Promise<SandboxExecutionResult> {
    if (signal.aborted) {
      throw new ProviderError('The request was aborted before the sandbox started.', {
        code: 'provider_error',
      });
    }

    const codeBytes = Buffer.byteLength(code, 'utf-8');
    if (codeBytes > this.maxCodeBytes) {
      throw new ProviderError(
        `Submitted code is ${codeBytes} bytes, exceeding the ${this.maxCodeBytes}-byte sandbox limit.`,
        { code: 'provider_error' },
      );
    }

    // Determine working directory and temporary script location
    const cwd = options?.workspaceDir ?? process.cwd();
    const tempDir = options?.workspaceDir
      ? path.join(options.workspaceDir, 'temp')
      : os.tmpdir();

    await fs.mkdir(tempDir, { recursive: true });
    const scriptPath = path.join(tempDir, `script_${Date.now()}_${Math.random().toString(36).slice(2)}.py`);

    try {
      await fs.writeFile(scriptPath, code, 'utf-8');

      return await new Promise<SandboxExecutionResult>((resolve, reject) => {
        let timedOut = false;
        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          try {
            proc.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }, this.codeTimeoutMs);

        const onAbort = () => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Already dead
          }
        };

        signal.addEventListener('abort', onAbort, { once: true });

        const proc = spawn(this.pythonPath, [scriptPath], {
          cwd,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        });

        let stdoutBytes = 0;
        let stderrBytes = 0;
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutTruncated = false;
        let stderrTruncated = false;

        proc.stdout.on('data', (chunk: Buffer) => {
          if (stdoutBytes < this.maxStdoutBytes) {
            const remaining = this.maxStdoutBytes - stdoutBytes;
            if (chunk.length <= remaining) {
              stdoutChunks.push(chunk);
              stdoutBytes += chunk.length;
            } else {
              stdoutChunks.push(chunk.subarray(0, remaining));
              stdoutBytes = this.maxStdoutBytes;
              stdoutTruncated = true;
            }
          } else {
            stdoutTruncated = true;
          }
        });

        proc.stderr.on('data', (chunk: Buffer) => {
          if (stderrBytes < this.maxStderrBytes) {
            const remaining = this.maxStderrBytes - stderrBytes;
            if (chunk.length <= remaining) {
              stderrChunks.push(chunk);
              stderrBytes += chunk.length;
            } else {
              stderrChunks.push(chunk.subarray(0, remaining));
              stderrBytes = this.maxStderrBytes;
              stderrTruncated = true;
            }
          } else {
            stderrTruncated = true;
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timeoutTimer);
          signal.removeEventListener('abort', onAbort);
          reject(new ProviderError(`Failed to spawn Python process: ${err.message}`, { code: 'provider_error' }));
        });

        proc.on('close', (exitCode) => {
          clearTimeout(timeoutTimer);
          signal.removeEventListener('abort', onAbort);

          if (signal.aborted) {
            return reject(
              new ProviderError('The Python execution was aborted.', { code: 'provider_error' }),
            );
          }

          if (timedOut) {
            return resolve({
              outputs: [
                {
                  mimeType: 'application/json',
                  text: JSON.stringify({
                    msg_out: Buffer.concat(stdoutChunks).toString('utf-8'),
                    msg_err: `Execution timed out after ${this.codeTimeoutMs}ms.`,
                    timed_out: true,
                    exit_code: exitCode ?? -1,
                  }),
                },
              ],
            });
          }

          const stdoutText = Buffer.concat(stdoutChunks).toString('utf-8');
          let stderrText = Buffer.concat(stderrChunks).toString('utf-8');

          if (stdoutTruncated) {
            stderrText += '\n[stdout truncated to limit]';
          }
          if (stderrTruncated) {
            stderrText += '\n[stderr truncated to limit]';
          }

          resolve({
            outputs: [
              {
                mimeType: 'application/json',
                text: JSON.stringify({
                  msg_out: stdoutText,
                  msg_err: stderrText,
                  exit_code: exitCode ?? 0,
                }),
              },
            ],
          });
        });
      });
    } catch (err: any) {
      log.error({ err, cwd }, 'ProcessSandboxClient execution error');
      throw err;
    } finally {
      try {
        await fs.unlink(scriptPath);
      } catch {
        // File may already be deleted or unwritten
      }
    }
  }
}
