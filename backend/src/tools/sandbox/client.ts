/**
 * The seam between CodeExecutionToolExecutor and an actual sandbox backend. Exists so tests can
 * inject a fake and never touch a real GCP resource — same reasoning as the injectable
 * SDK-client seam on the provider adapters (gemini.ts/anthropic.ts).
 */
import type { ToolErrorCode } from '../../providers/types.js';

export interface SandboxExecutionResult {
  /** Raw chunks as returned by the sandbox, already base64-decoded to text. Left as separate
   *  chunks (not pre-joined) because a run can emit both a stdout/stderr JSON chunk and zero or
   *  more file chunks — joining would lose that structure before CodeExecutionToolExecutor
   *  decides how to bound and present it. */
  outputs: { mimeType: string; text: string }[];
  undeclaredOutputs?: string[];
}

export interface SandboxExecutionOptions {
  workspaceDir?: string;
  expectedOutputs?: string[];
  /** Keeps a sandbox workspace across calls (one per chat) on engines that can. Without it
   *  every call starts from an empty machine. */
  sessionKey?: string;
  /** Whose chat the session is, so the engine can keep its workspace beyond one instance. */
  owner?: { userId: string; chatId: string };
}

/**
 * The sandbox cannot move this run's files: a staging bucket is configured without a signing
 * account (SANDBOX_SIGNING_SA), so an input might not reach the run and an output could not come
 * back (ADR-0070, build-3 decision #14). A configuration error, never retried; the
 * client gets `sandbox_misconfigured` on the tool result.
 */
export class SandboxMisconfiguredError extends Error {
  readonly code: ToolErrorCode = 'sandbox_misconfigured';
  constructor(message: string) {
    super(message);
    this.name = 'SandboxMisconfiguredError';
  }
}

export interface SandboxClient {
  /** Runs `code` in a fresh, single-use sandbox: create reasoning engine → create sandbox →
   *  execute → delete both, in that order, always deleting even on execute failure. Callers
   *  never see the intermediate resource names. */
  runPython(
    code: string,
    signal: AbortSignal,
    options?: SandboxExecutionOptions,
  ): Promise<SandboxExecutionResult>;
}
