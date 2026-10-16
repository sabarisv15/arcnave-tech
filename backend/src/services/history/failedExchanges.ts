/**
 * Which stored messages may go back to the model as history (D2 X-3, Stage 6 doc-sync R-3).
 *
 * An exchange whose answer failed (status `error`, which includes a refusal and a blocked
 * reply) or that has no answer at all (no text and no tool call) is left out, both the question
 * and the answer. Kept, a refused or failed question reads to the model as a few-shot example of
 * an unanswered turn, and an empty answer used to go back as the literal text
 * "[Response stopped]", which the model never wrote.
 *
 * Two exceptions keep what the conversation cannot get back otherwise:
 * - an answer that made tool calls stays, whatever its status: its tool calls ran (a file was
 *   written, a search was made), and without them a later turn would redo the work;
 * - the question of a left-out exchange stays when it carried files: a file cannot be attached
 *   again (`file_already_attached`), so a later "try again" sees it only through this history.
 */
import type { HistoryToolCall } from '../../providers/types.js';

export interface StoredMessage {
  id: string;
  role: string;
  text: string;
  seq: number;
  status: string;
}

/** True when an assistant message cannot go back to the model as an answer. */
export function isFailedAnswer(row: StoredMessage, calls: HistoryToolCall[] | undefined): boolean {
  if (row.role !== 'assistant') return false;
  if ((calls?.length ?? 0) > 0) return false;
  return row.status === 'error' || row.text.trim() === '';
}

/**
 * The messages, oldest first, without failed exchanges. A failed answer takes its question
 * (the user message just before it) with it, unless that question is in `questionsWithFiles`;
 * a user message with no text is left out as before.
 */
export function withoutFailedExchanges<T extends StoredMessage>(
  chronological: T[],
  toolCallsOf: Map<string, HistoryToolCall[]>,
  questionsWithFiles: ReadonlySet<string> = new Set(),
): T[] {
  const dropped = new Set<string>();
  chronological.forEach((row, i) => {
    if (!isFailedAnswer(row, toolCallsOf.get(row.id))) return;
    dropped.add(row.id);
    const question = chronological[i - 1];
    if (question?.role === 'user' && question.seq === row.seq - 1 && !questionsWithFiles.has(question.id)) {
      dropped.add(question.id);
    }
  });
  return chronological.filter(
    (row) => !dropped.has(row.id) && (row.role === 'assistant' || row.text.trim() !== ''),
  );
}
