/**
 * Clearing old tool results: once context grows beyond a configured threshold, old tool results
 * are replaced with placeholder text, by default past 100,000 input tokens, keeping the 3 most
 * recent tool use/result pairs. Each tool round resends the whole conversation, so every
 * result left in it is paid for, and waited on, once per round.
 *
 * Clearing breaks the cached prefix from the first result it changes, so results are cleared
 * a batch at a time (a minimum clear size): the boundary moves
 * only every `batch` results, and the requests between reuse one cached prefix.
 */
export const CLEARED_TOOL_RESULT =
  '[This earlier tool result was cleared to save context. Call the tool again if you need it.]';

export interface ContextEditingPolicy {
  /** Clear only when the last request's prompt was at least this many tokens. */
  triggerTokens: number;
  /** The most recent results always kept whole. */
  keep: number;
  /** Results are cleared in multiples of this many. */
  batch: number;
  /** Tools whose results are never cleared (a loaded skill is instructions, not data). */
  excludeTools: readonly string[];
}

/** How many of the oldest clearable results to clear, out of `total`. */
export function resultsToClear(total: number, policy: Pick<ContextEditingPolicy, 'keep' | 'batch'>): number {
  const clearable = total - policy.keep;
  if (clearable <= 0) return 0;
  const batch = Math.max(1, policy.batch);
  return Math.floor(clearable / batch) * batch;
}
