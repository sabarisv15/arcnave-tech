/**
 * Wraps a real `SandboxClient` with `SandboxSemaphore`, so every `runPython` call claims a slot
 * first and releases it when the call settles — success, failure, or abort alike. Kept as a
 * decorator (not folded into `CloudRunSandboxClient`) so the capacity check applies uniformly
 * regardless of which sandbox backend is behind it, and so `CloudRunSandboxClient` itself stays
 * ignorant of the limit, the same separation ADR-0005 already draws between the client and
 * `CodeExecutionToolExecutor`.
 */
import type { SandboxClient, SandboxExecutionOptions, SandboxExecutionResult } from './client.js';
import type { SandboxSemaphore } from './semaphore.js';

export class SemaphoreSandboxClient implements SandboxClient {
  constructor(
    private readonly inner: SandboxClient,
    private readonly semaphore: SandboxSemaphore,
  ) {}

  async runPython(
    code: string,
    signal: AbortSignal,
    options?: SandboxExecutionOptions,
  ): Promise<SandboxExecutionResult> {
    const claimId = await this.semaphore.claim();
    if (claimId === null) {
      throw new Error(
        'The sandbox is at capacity — too many run_python calls are already in flight. Try again shortly.',
      );
    }
    try {
      return await this.inner.runPython(code, signal, options);
    } finally {
      await this.semaphore.release(claimId);
    }
  }
}
