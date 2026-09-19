/**
 * Composes `ProjectToolExecutor` and `CodeExecutionToolExecutor` behind one `ToolExecutor`, so
 * `GenerationService`/the provider adapters keep talking to a single executor exactly as phase 1
 * designed — routing by tool name is this class's whole job, not a reason to teach either
 * sub-executor about the other's tools.
 */
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';

export class DispatchingToolExecutor implements ToolExecutor {
  constructor(private readonly byName: Map<string, ToolExecutor>) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const executor = this.byName.get(call.name);
    if (!executor) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: `Unknown tool "${call.name}".` }],
      };
    }
    return executor.execute(call, signal);
  }
}
