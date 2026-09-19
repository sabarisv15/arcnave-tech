/**
 * Shared round-loop policy for the tool-calling loop, used identically by both provider
 * adapters. Extracted after the final review of item 9 phase 1 found the same three decisions
 * (round bound, deferred-call wording, tool_limit condition) duplicated verbatim in both
 * gemini.ts and anthropicVertex.ts — the plan's Global Constraint said this should be shared,
 * not duplicated per-adapter.
 */
import type { ToolResult } from './types.js';

/** One round = one provider request + at most one tool execution. `useTools` collapses this to
 *  1 (today's single-shot behavior) when no tools are available this turn. */
export function resolveMaxRounds(toolMaxRounds: number, useTools: boolean): number {
  return useTools ? Math.max(1, toolMaxRounds) : 1;
}

/** The explicit failure fed back for every tool call beyond the first in a single round — kept
 *  identical across both adapters so neither provider's phase-1 behavior silently diverges. */
export function deferredCallResult(toolCallId: string): ToolResult {
  return {
    toolCallId,
    ok: false,
    content: [
      {
        type: 'text',
        text: 'Only one tool call is processed per round in this phase; call again on the ' +
          'next round if this is still needed.',
      },
    ],
  };
}

/** True exactly when the loop is on its last allowed round AND still has a tool call pending —
 *  never true on a round that finished cleanly with no more calls to make. */
export function isLastRound(round: number, maxRounds: number): boolean {
  return round === maxRounds - 1;
}
