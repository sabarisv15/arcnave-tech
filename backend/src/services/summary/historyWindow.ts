/**
 * HIST-WINDOW (Stage 6, N-16, N-75, N-03; ADR-0080): which earlier turns a request carries.
 *
 * The history arrives already without failed, blocked and empty exchanges (`withoutFailedExchanges`,
 * Stage 6 R-3 and R2-2) and without the turns a summary covers (`loadHistory` starts after
 * `covers_upto_seq`). This step then keeps:
 * - the newest `maxTurns` (N-16: 6) exchanges; older ones only while no summary covers them when
 *   `keepUncovered` is on (ours, pending the owner: without it a chat that never reaches the
 *   summary trigger would lose a file sent seven questions ago);
 * - while the provider-counted total (fixed part + summary + kept exchanges + the new message)
 *   is above the input budget (N-03 Normal 48k), the oldest exchange is dropped, down to the
 *   newest `floor` (N-75: 2), which are always sent; `overBudget` is set when even they do not fit.
 * With no count (the provider has none, or it failed) nothing is dropped for size: there is no
 * estimator (Invariant 3), so the stamp says `none` and `overBudget` is unknown (null).
 *
 * An exchange is a user turn and the assistant turns after it. Counted is the text the model
 * reads again: each message's text and its tool calls as text. Attachments are not counted here;
 * the file budget (CXD-4, `applyFileBudget`) sizes them.
 */
import { toolCallAsText, type Turn } from '../../providers/types.js';

/** The history, grouped: each exchange starts at a user turn (a leading assistant turn stands alone). */
export function groupExchanges(turns: readonly Turn[]): Turn[][] {
  const groups: Turn[][] = [];
  for (const turn of turns) {
    const last = groups.at(-1);
    if (turn.role === 'user' || !last) groups.push([turn]);
    else last.push(turn);
  }
  return groups;
}

/** The text an exchange is counted by: what the model reads of it again. */
export function exchangeCountText(exchange: readonly Turn[]): string {
  return exchange
    .map((t) => [`${t.role}:`, ...(t.toolCalls ?? []).map(toolCallAsText), t.text].filter(Boolean).join('\n'))
    .join('\n\n');
}

export interface WindowInput {
  exchanges: readonly Turn[][];
  /** The provider count of each exchange, in order; null when not counted. */
  exchangeTokens: readonly number[] | null;
  /** System instruction + tool declarations, counted; null when not counted. */
  fixedTokens: number | null;
  promptTokens: number | null;
  summaryTokens: number;
  /** N-03: the input budget of the profile. */
  budget: number;
  /** N-16: newest exchanges kept word for word. */
  maxTurns: number;
  /** N-75: newest exchanges always sent. */
  floor: number;
  /** Ours (owner item): keep exchanges older than `maxTurns` while no summary covers them. */
  keepUncovered: boolean;
}

export interface WindowResult {
  kept: Turn[][];
  /** Exchanges left out by the turn count or the budget (covered ones are not counted here). */
  dropped: number;
  /** The counted request size, or null when anything was not counted. */
  totalTokens: number | null;
  /** True when even the floor exceeds the budget; null when not counted. */
  overBudget: boolean | null;
}

export function selectWindow(w: WindowInput): WindowResult {
  const all = w.exchanges.length;
  let start = w.keepUncovered ? 0 : Math.max(0, all - w.maxTurns);
  const counted = w.exchangeTokens !== null && w.fixedTokens !== null && w.promptTokens !== null;
  if (!counted) {
    return { kept: w.exchanges.slice(start), dropped: start, totalTokens: null, overBudget: null };
  }
  const tokens = w.exchangeTokens!;
  const base = w.fixedTokens! + w.promptTokens! + w.summaryTokens;
  let total = base + tokens.slice(start).reduce((n, t) => n + t, 0);
  const floorStart = Math.max(0, all - w.floor);
  while (total > w.budget && start < floorStart) {
    total -= tokens[start]!;
    start += 1;
  }
  return { kept: w.exchanges.slice(start), dropped: start, totalTokens: total, overBudget: total > w.budget };
}
