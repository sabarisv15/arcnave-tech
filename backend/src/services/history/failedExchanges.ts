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
 *
 * P11 (ours, ADR-0081): an answer that was kept although it did not finish (stopped by the user,
 * cut by a failure after text, ended after a tool run) goes back with a short note after its text,
 * so the model does not read it as a finished answer and carry it on (DEFERRED P07/P11, live:
 * Gemini continued a stopped essay after "hai").
 */
import type { HistoryToolCall } from '../../providers/types.js';

export interface StoredMessage {
  id: string;
  role: string;
  text: string;
  seq: number;
  status: string;
  /** The stored finish reason, when the loader read it (P11: the cut marker). */
  finishReason?: string | null;
}

/** The note after an unfinished answer's text. Model-facing; no product or provider name. */
export const CUT_MARKERS = {
  stopped: '[This answer was stopped by the user before it was finished.]',
  cut: '[This answer was cut short before it was finished.]',
} as const;

/** An assistant row's text as history: an unfinished answer gets its cut marker. */
export function historyText(row: StoredMessage): string {
  if (row.role !== 'assistant' || row.text.trim() === '') return row.text;
  if (row.status === 'stopped') return `${row.text}\n\n${CUT_MARKERS.stopped}`;
  if (row.finishReason === 'interrupted' || row.finishReason === 'partial') return `${row.text}\n\n${CUT_MARKERS.cut}`;
  return row.text;
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
