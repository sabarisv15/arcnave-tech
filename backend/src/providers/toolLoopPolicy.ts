/**
 * Shared round-loop policy for the tool-calling loop, used identically by both provider
 * adapters. Extracted after the final review of item 9 phase 1 found the same three decisions
 * (round bound, tool_limit condition) duplicated verbatim in both
 * gemini.ts and anthropicVertex.ts — the plan's Global Constraint said this should be shared,
 * not duplicated per-adapter.
 */

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

/** Finish reasons the user must see as they are: an output cut-off, or a refusal or block. */
const KEPT_ON_FINAL_ROUND = /^(max_tokens|length|refusal|safety|recitation|blocklist|prohibited_content|spii|image_safety)$/i;

/**
 * The finish reason of a turn whose last allowed round ran. Every earlier round made calls, so
 * the turn used its tool budget, whether or not that round wrote an answer: it is reported as
 * tool_limit, so the reply shows the limit and offers Continue (ADR-0051). An output cut-off or a
 * refusal on that round is reported as itself.
 */
export function finalRoundFinishReason(providerFinishReason: string): string {
  return KEPT_ON_FINAL_ROUND.test(providerFinishReason) ? providerFinishReason : 'tool_limit';
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

