/**
 * ArcNave Phase 6 UI Tool Executor.
 *
 * Validates, normalizes, and authorizes model-generated UI blocks,
 * emitting validated blocks to the streaming transport and returning
 * a normalized UIResponseV1 payload for durable persistence.
 */
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { AuthorizationContext, UIAuthorizer } from '../services/ui/authorizer.js';
import type { UIBlock, UIResponseV1 } from '../services/ui/types.js';
import { validateAndNormalizeUI } from '../services/ui/validator.js';

export class UIToolExecutor implements ToolExecutor {
  constructor(
    private readonly authorizer: UIAuthorizer,
    private readonly authCtx: AuthorizationContext,
    private readonly maxResponseBytes: number,
    private readonly onBlockValidated?: (block: UIBlock) => void,
    private readonly onResponseValidated?: (response: UIResponseV1) => void,
  ) {}

  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    const result = validateAndNormalizeUI(call.input, this.maxResponseBytes);

    if (!result.ok) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [
          {
            type: 'text',
            text: `UI rendering validation failed${result.code ? ` (${result.code})` : ''}: ${result.error}. Safe fallback displayed:\n${result.fallbackText}`,
          },
        ],
      };
    }

    // Authorize references before client emission
    const authorizedResponse = await this.authorizer.filterAuthorizedUI(result.data, this.authCtx);

    // Stream each validated block
    for (const block of authorizedResponse.blocks) {
      this.onBlockValidated?.(block);
    }
    this.onResponseValidated?.(authorizedResponse);

    return {
      toolCallId: call.id,
      ok: true,
      content: [
        {
          type: 'json',
          data: withoutVisualHtml(authorizedResponse),
        },
      ],
    };
  }
}

/**
 * The result the model gets back, and history replays: a visual's HTML is already in the
 * model's own call, so the result carries only its size (ADR-0035). The client restores the
 * HTML from the call input by `sequence` on reload.
 */
export function withoutVisualHtml(response: UIResponseV1): UIResponseV1 {
  return {
    ...response,
    blocks: response.blocks.map((b) =>
      b.type === 'visual' && typeof b.html === 'string'
        ? { blockId: b.blockId, sequence: b.sequence, type: b.type, title: b.title, htmlBytes: Buffer.byteLength(b.html, 'utf8') }
        : b,
    ),
  };
}
