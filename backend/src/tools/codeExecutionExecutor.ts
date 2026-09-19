/**
 * Executes `run_python` only — a sibling to `ProjectToolExecutor`, not a branch inside it,
 * because this tool touches no database and has a genuinely different failure mode (an external
 * sandbox call, not a Postgres query). Every branch returns a `ToolResult`, never throws, for
 * the same reason as `ProjectToolExecutor`: a bad input or a sandbox failure is something the
 * *model* needs to see and react to (Invariant 1).
 */
import { z } from 'zod';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { SandboxClient } from './sandbox/client.js';

const runInput = z.object({
  code: z.string().min(1),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

/** The sandbox's `msg_out`/`msg_err` JSON chunk shape, per the Code Execution REST reference. */
interface SandboxOutputChunk {
  msg_out?: string;
  msg_err?: string;
}

export class CodeExecutionToolExecutor implements ToolExecutor {
  constructor(
    private readonly client: SandboxClient,
    private readonly maxOutputChars: number,
  ) {}

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

    let execution;
    try {
      execution = await this.client.runPython(parsed.data.code, signal);
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

    return {
      toolCallId: call.id,
      ok: true,
      content: [{ type: 'json', data: { stdout, stderr, truncated } }],
    };
  }
}
