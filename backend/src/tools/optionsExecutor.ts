/**
 * ask_user_input_v0 (ADR-0048): one to three questions, each with two to four short options, as
 * the reference's tappable question card. The card is the turn's end (TERMINAL_TOOLS); the
 * person's choice arrives as their next message, never as this tool's result.
 */
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';

export type AskUserInputType = 'single_select' | 'multi_select' | 'rank_priorities';

export interface AskUserInputQuestion {
  question: string;
  options: string[];
  type: AskUserInputType;
}

export interface AskUserInputInput {
  questions: AskUserInputQuestion[];
}

const TYPES: readonly AskUserInputType[] = ['single_select', 'multi_select', 'rank_priorities'];

export function validateAskUserInput(
  input: unknown,
): { ok: true; data: AskUserInputInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Input must be an object' };
  const { questions } = input as Record<string, unknown>;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) {
    return { ok: false, error: 'questions must be an array of 1 to 3 questions' };
  }
  const out: AskUserInputQuestion[] = [];
  for (const [i, raw] of questions.entries()) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: `questions[${i}] must be an object` };
    const q = raw as Record<string, unknown>;
    if (typeof q.question !== 'string' || !q.question.trim()) {
      return { ok: false, error: `questions[${i}].question must be a non-empty string` };
    }
    const type = (q.type ?? 'single_select') as AskUserInputType;
    if (!TYPES.includes(type)) {
      return { ok: false, error: `questions[${i}].type must be one of ${TYPES.join(', ')}` };
    }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
      return { ok: false, error: `questions[${i}].options must hold 2 to 4 options` };
    }
    if (!q.options.every((o) => typeof o === 'string' && o.trim())) {
      return { ok: false, error: `questions[${i}].options must be non-empty strings` };
    }
    out.push({ question: q.question.trim(), type, options: (q.options as string[]).map((o) => o.trim()) });
  }
  return { ok: true, data: { questions: out } };
}

export class AskUserInputExecutor implements ToolExecutor {
  async execute(call: ToolCall, _signal: AbortSignal): Promise<ToolResult> {
    const validation = validateAskUserInput(call.input);
    if (!validation.ok) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: `Invalid ask_user_input_v0 arguments: ${validation.error}` }],
      };
    }
    return { toolCallId: call.id, ok: true, content: [{ type: 'json', data: { status: 'shown' } }] };
  }
}
