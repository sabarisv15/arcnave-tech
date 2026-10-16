/**
 * Running a system tool (ffmpeg, ffprobe, poppler) over an uploaded file (ADR-0066, review
 * finding M2).
 *
 * These tools parse untrusted bytes in native code. Three rules hold for every call:
 * - **No secret reaches the tool.** The child's environment is built here, from nothing: PATH to
 *   find the binary and TMPDIR for its scratch files. A child started with the default
 *   environment inherits the API's process environment, credentials included, and a parser bug
 *   is then a credential leak.
 * - **ffmpeg reads only local files.** `-protocol_whitelist file` comes before `-i`, so a
 *   playlist or reference inside the upload cannot make ffmpeg fetch a URL (http, tcp, data...).
 * - **No tool reads stdin.** ffmpeg gets `-nostdin` (it would otherwise read keys from it);
 *   ffprobe has no such flag (`Option not found` on 6.1), so for every tool the child's stdin is
 *   closed as soon as it starts.
 *
 * `execFile` is called with an explicit callback rather than through `promisify`, so a test can
 * observe the options every call carries (`untrustedTools.test.ts`).
 */
import { execFile } from 'node:child_process';

import { fileTmpDir } from './workDir.js';

export interface ToolOptions {
  timeout: number;
  maxBuffer: number;
}

export interface ToolOutput {
  stdout: string;
  stderr: string;
}

/** The whole environment a tool runs with: nothing from the API's own. */
export function toolEnv(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', TMPDIR: fileTmpDir() };
}

/**
 * Runs `file` with `args`. Rejects like `execFile` does, with `stdout` and `stderr` on the
 * error (poppler's "Incorrect password" is read from there).
 */
export function runTool(file: string, args: string[], opts: ToolOptions): Promise<ToolOutput> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout: opts.timeout, maxBuffer: opts.maxBuffer, env: toolEnv(), encoding: 'utf8', windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }));
        else resolve({ stdout, stderr });
      },
    );
    child.stdin?.end();
  });
}

/**
 * ffmpeg / ffprobe arguments with the input options every call carries, in the order ffmpeg
 * needs them: global flags, then the input's own options (the whitelist among them), then
 * `-i input`, then the output's.
 */
export function mediaArgs(tool: 'ffmpeg' | 'ffprobe', input: string, opts: { global?: string[]; inputOptions?: string[]; output?: string[] } = {}): string[] {
  return [
    ...(tool === 'ffmpeg' ? ['-nostdin'] : []),
    ...(opts.global ?? []),
    '-protocol_whitelist',
    'file',
    ...(opts.inputOptions ?? []),
    '-i',
    input,
    ...(opts.output ?? []),
  ];
}
