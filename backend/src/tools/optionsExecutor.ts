/**
 * Tool executor for ask_user_options (WP-06 / ADR-0034).
 *
 * Validates question, selection kind ('single' | 'multi' | 'rank'), and 2-6 options.
 * Returns { status: 'shown' } on success.
 */
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';

export interface AskUserOptionItem {
  label: string;
  description?: string;
}

export interface AskUserOptionsInput {
  question: string;
  kind: 'single' | 'multi' | 'rank';
  options: AskUserOptionItem[];
}

export function validateAskUserOptionsInput(
  input: unknown,
): { ok: true; data: AskUserOptionsInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Input must be an object' };
  }
  const { question, kind, options } = input as Record<string, unknown>;

  if (typeof question !== 'string' || question.trim() === '') {
    return { ok: false, error: 'question must be a non-empty string' };
  }

  if (kind !== 'single' && kind !== 'multi' && kind !== 'rank') {
    return { ok: false, error: 'kind must be "single", "multi", or "rank"' };
  }

  if (!Array.isArray(options)) {
    return { ok: false, error: 'options must be an array' };
  }

  if (options.length < 2 || options.length > 6) {
    return { ok: false, error: `options count must be between 2 and 6 (got ${options.length})` };
  }

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    if (!opt || typeof opt !== 'object') {
      return { ok: false, error: `options[${i}] must be an object` };
    }
    const { label, description } = opt as Record<string, unknown>;
    if (typeof label !== 'string' || label.trim() === '') {
      return { ok: false, error: `options[${i}].label must be a non-empty string` };
    }
    if (description !== undefined && typeof description !== 'string') {
      return { ok: false, error: `options[${i}].description must be a string if provided` };
    }
  }

  return {
    ok: true,
    data: {
      question: question.trim(),
      kind,
      options: options.map((o) => ({
        label: (o as { label: string }).label.trim(),
        ...((o as { description?: string }).description !== undefined
          ? { description: (o as { description: string }).description.trim() }
          : {}),
      })),
    },
  };
}

export class AskUserOptionsExecutor implements ToolExecutor {
  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    const validation = validateAskUserOptionsInput(call.input);
    if (!validation.ok) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [
          {
            type: 'text',
            text: `Invalid ask_user_options arguments: ${validation.error}`,
          },
        ],
      };
    }

    return {
      toolCallId: call.id,
      ok: true,
      content: [
        {
          type: 'json',
          data: { status: 'shown' },
        },
      ],
    };
  }
}
