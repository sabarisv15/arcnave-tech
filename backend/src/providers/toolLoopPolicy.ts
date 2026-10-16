/**
 * Shared round-loop policy for the tool-calling loop, used identically by both provider
 * adapters. Extracted after the final review of item 9 phase 1 found the same three decisions
 * (round bound, tool_limit condition) duplicated verbatim in both
 * gemini.ts and anthropic.ts — the plan's Global Constraint said this should be shared,
 * not duplicated per-adapter.
 */
import type { ToolResult } from './types.js';

/** One round = one provider request + the tool calls it made (ADR-0026). `useTools` collapses this to
 *  1 (today's single-shot behavior) when no tools are available this turn. */
export function resolveMaxRounds(toolMaxRounds: number, useTools: boolean): number {
  return useTools ? Math.max(1, toolMaxRounds) : 1;
}

/** True exactly when the loop is on its last allowed round AND still has a tool call pending —
 *  never true on a round that finished cleanly with no more calls to make. */
export function isLastRound(round: number, maxRounds: number): boolean {
  return round === maxRounds - 1;
}

/** Tools that end the provider round loop immediately after execution (ADR-0034). */
export const TERMINAL_TOOLS = new Set<string>(['ask_user_input_v0']);

export function isTerminalTool(toolName: string): boolean {
  return TERMINAL_TOOLS.has(toolName);
}

/** Returns true if any of the calls in the round is a terminal tool. */
export function hasTerminalToolCall(toolCalls: ReadonlyArray<{ name: string }>): boolean {
  return toolCalls.some((c) => isTerminalTool(c.name));
}

/**
 * The identity of a call for the duplicate-failure guard: the same tool with the same input.
 * Both adapters refuse to run a call that already failed with exactly this input in the same
 * turn (D2 X-10): it would fail again and spend a round doing so.
 */
export function callFingerprint(name: string, input: unknown): string {
  return `${name}:${JSON.stringify(input ?? {})}`;
}

/** What the model receives instead of a second run of a call that already failed (D2 X-10). */
export function duplicateFailedCallResult(toolCallId: string, name: string): ToolResult {
  return {
    toolCallId,
    ok: false,
    content: [
      {
        type: 'text',
        text: `This tool (${name}) previously failed with these exact inputs. Do not retry it. Deliver your synthesized answer directly in text to the user.`,
      },
    ],
  };
}

