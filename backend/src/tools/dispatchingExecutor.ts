/**
 * Composes `ProjectToolExecutor` and `CodeExecutionToolExecutor` behind one `ToolExecutor`, so
 * `GenerationService`/the provider adapters keep talking to a single executor exactly as phase 1
 * designed — routing by tool name is this class's whole job, not a reason to teach either
 * sub-executor about the other's tools.
 *
 * P11 (Stage 15 ER-4c, N-43; ADR-0081): it also holds the tool timers. A tool with a timer that
 * has not answered in time is aborted and gets an `is_error` result saying so, which goes back to
 * the model like any failed tool (ER-8: the answer continues without it). fetch_url has its own
 * timer in safeFetch (N-43 10 s); run_code's are P18's.
 */
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';

/** Milliseconds a tool may take, or undefined for no timer of this layer. */
export type ToolTimeouts = (name: string) => number | undefined;

/** The N-43 tool timers, by tool name. */
export function toolTimeouts(cfg: { TOOL_TIMEOUT_WEB_SEARCH_MS: number; TOOL_TIMEOUT_FILE_SEARCH_MS: number; TOOL_TIMEOUT_MEMORY_MS: number }): ToolTimeouts {
  return (name) => {
    if (name === 'web_search') return cfg.TOOL_TIMEOUT_WEB_SEARCH_MS;
    if (name === 'search_project_files') return cfg.TOOL_TIMEOUT_FILE_SEARCH_MS;
    if (name.startsWith('memory_')) return cfg.TOOL_TIMEOUT_MEMORY_MS;
    return undefined;
  };
}

export class DispatchingToolExecutor implements ToolExecutor {
  constructor(
    private readonly byName: Map<string, ToolExecutor>,
    private readonly timeouts: ToolTimeouts = () => undefined,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const executor = this.byName.get(call.name);
    if (!executor) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: `Unknown tool "${call.name}".` }],
      };
    }
    const limitMs = this.timeouts(call.name);
    if (limitMs === undefined) return executor.execute(call, signal);

    // The tool gets its own signal: the turn's Stop still reaches it, and so does its timer.
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<ToolResult>((resolve) => {
      timer = setTimeout(() => {
        // Settled before the abort: the tool's own rejection on that abort must not win the race.
        resolve({
          toolCallId: call.id,
          ok: false,
          content: [
            {
              type: 'text',
              text: `The tool "${call.name}" did not answer within ${String(Math.round(limitMs / 1000))} s and was stopped. Answer without it, and say that this step could not be done.`,
            },
          ],
        });
        controller.abort(new DOMException('tool timed out', 'TimeoutError'));
      }, limitMs);
    });
    try {
      return await Promise.race([executor.execute(call, controller.signal), timedOut]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
