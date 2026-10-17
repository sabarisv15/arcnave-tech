/**
 * The rolling history summary job (Stage 6 CXD-5, N-16, N-77, HP-SUM; ADR-0080).
 *
 * After a completed turn, off the turn's path (never awaited by it): when the provider-counted
 * summary + uncovered turns pass 60 % of (N-03 − the fixed part), the uncovered turns older than
 * the newest `history_turns` (6, at least 2) are summarised by the helper model, oldest first up
 * to 30,000 input tokens, and stored as a new `summaries` row. Later turns send the summary and
 * only the turns after it. No count means no job (no estimator, Invariant 3); any failure leaves
 * the history whole: nothing is written.
 */
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';

import { NUMBERS } from '../../config/numbers.js';
import type { Database } from '../../db/client.js';
import { attachments, messages, summaries } from '../../db/schema.js';
import { nameForModel } from '../../providers/attachmentContent.js';
import type { ModelRegistry } from '../../providers/registry.js';
import { toolCallAsText, type HistoryToolCall, type Provider } from '../../providers/types.js';
import { withoutFailedExchanges } from '../history/failedExchanges.js';
import { loadToolCalls } from '../history/toolHistory.js';
import { callHelper, cutCodePoints, type HelperCallUsage } from '../helpers/helperCall.js';
import { summaryPrompt } from '../helpers/helperPrompts.js';
import { escapeText } from '../prompt/sessionState.js';
import { activeSummary, nextSummaryVersion } from './summaryStore.js';
import { countTexts } from './tokenCounts.js';

export type SummaryJobResult =
  | { code: 'summary_written'; summaryVersion: number; coversUptoSeq: number; coveredTurns: number; call: HelperCallUsage }
  | { code: 'summary_skipped'; reason: string; call?: HelperCallUsage | null };

interface Row {
  id: string;
  seq: number;
  role: string;
  text: string;
  status: string;
}

interface Exchange {
  rows: Row[];
  /** The exchange as the helper reads it (escaped), and as it is counted. */
  text: string;
}

function exchangeText(rows: Row[], callsOf: Map<string, HistoryToolCall[]>, filesOf: Map<string, string[]>): string {
  return rows
    .map((r) => {
      const calls = (callsOf.get(r.id) ?? []).map(toolCallAsText).join('\n\n');
      const files = filesOf.get(r.id);
      const body = [calls, r.text.trim(), files ? `[Attached: ${files.join(', ')}]` : ''].filter(Boolean).join('\n\n');
      return `<turn role="${r.role === 'user' ? 'user' : 'assistant'}">\n${escapeText(body)}\n</turn>`;
    })
    .join('\n');
}

export async function runSummaryJob(
  deps: { db: Database; registry: ModelRegistry },
  turn: { chatId: string; messageId: string; countProvider: Provider | undefined },
  signal?: AbortSignal,
): Promise<SummaryJobResult> {
  const [finished] = await deps.db
    .select({
      seq: messages.seq,
      status: messages.status,
      historyTurns: messages.historyTurns,
      ctxFixedTokens: messages.ctxFixedTokens,
      ctxCountSource: messages.ctxCountSource,
    })
    .from(messages)
    .where(and(eq(messages.id, turn.messageId), eq(messages.chatId, turn.chatId)))
    .limit(1);
  if (!finished || finished.status !== 'complete') return { code: 'summary_skipped', reason: 'turn_not_complete' };
  // The fixed part was counted by the turn; without it there is no trigger to compare with.
  if (finished.ctxCountSource !== 'provider' || finished.ctxFixedTokens === null || !turn.countProvider) {
    return { code: 'summary_skipped', reason: 'count_unavailable' };
  }

  const current = await activeSummary(deps.db, turn.chatId, finished.seq);
  const rows = await deps.db
    .select({ id: messages.id, seq: messages.seq, role: messages.role, text: messages.text, status: messages.status })
    .from(messages)
    .where(
      and(
        eq(messages.chatId, turn.chatId),
        ...(current ? [gt(messages.seq, current.coversUptoSeq)] : []),
        lte(messages.seq, finished.seq),
      ),
    )
    .orderBy(asc(messages.seq));
  const callsOf = await loadToolCalls(deps.db, rows.filter((r) => r.role === 'assistant').map((r) => r.id));
  const fileRows = rows.length
    ? await deps.db
        .select({ messageId: attachments.messageId, id: attachments.id, filename: attachments.filename })
        .from(attachments)
        .where(and(inArray(attachments.messageId, rows.map((r) => r.id)), eq(attachments.status, 'ready')))
    : [];
  const filesOf = new Map<string, string[]>();
  for (const f of fileRows) {
    if (!f.messageId) continue;
    // Quoted and neutralised: a file name is the uploader's text (ADR-0069).
    filesOf.set(f.messageId, [...(filesOf.get(f.messageId) ?? []), `"${nameForModel(f.filename)}" (fileId ${f.id})`]);
  }
  const kept = withoutFailedExchanges(rows, callsOf, new Set(filesOf.keys()));
  const exchanges: Exchange[] = [];
  for (const r of kept) {
    const last = exchanges.at(-1);
    if (r.role === 'user' || !last) exchanges.push({ rows: [r], text: '' });
    else last.rows.push(r);
  }
  for (const e of exchanges) e.text = exchangeText(e.rows, callsOf, filesOf);

  const counts = await countTexts(
    turn.countProvider,
    [current?.text ?? '', ...exchanges.map((e) => e.text)],
    NUMBERS.HISTORY_COUNT_TIMEOUT_MS.value, // N-75
    signal,
  );
  if (!counts) return { code: 'summary_skipped', reason: 'count_failed' };
  const summaryTokens = counts[0]!;
  const tokens = counts.slice(1);
  const uncovered = summaryTokens + tokens.reduce((n, t) => n + t, 0);
  // N-77: summary + uncovered turns > 0.6 × (N-03 − fixed part).
  const trigger = NUMBERS.SUMMARY_TRIGGER_RATIO.value * (NUMBERS.INPUT_BUDGET_NORMAL.value - finished.ctxFixedTokens);
  if (uncovered <= trigger) return { code: 'summary_skipped', reason: 'below_trigger' };

  // N-77: the last `history_turns` turns of the finished turn (N-16 6, at least N-75 2) are never covered.
  const keep = Math.max(
    NUMBERS.HISTORY_FLOOR_TURNS.value,
    Math.min(NUMBERS.HISTORY_TURNS.value, finished.historyTurns ?? NUMBERS.HISTORY_TURNS.value),
  );
  const candidates = exchanges.slice(0, Math.max(0, exchanges.length - keep));
  if (candidates.length === 0) return { code: 'summary_skipped', reason: 'nothing_to_cover' };
  // Oldest first, up to N-77's 30,000 input tokens (the summary it replaces counts too).
  let input = summaryTokens;
  let cover = 0;
  while (cover < candidates.length && input + tokens[cover]! <= NUMBERS.SUMMARY_INPUT_MAX_TOKENS.value) {
    input += tokens[cover]!;
    cover += 1;
  }
  if (cover === 0) return { code: 'summary_skipped', reason: 'input_too_large' };
  const covered = candidates.slice(0, cover);
  const through = covered.at(-1)!.rows.at(-1)!;

  const previous = current
    ? `<earlier_conversation_summary version="${String(current.summaryVersion)}">\n${escapeText(current.text)}\n</earlier_conversation_summary>\n`
    : '';
  const outcome = await callHelper(deps.registry, {
    role: 'summary',
    system: summaryPrompt(),
    text: `${previous}<conversation>\n${covered.map((e) => e.text).join('\n')}\n</conversation>`,
    maxOutputTokens: NUMBERS.SUMMARY_MAX_OUTPUT_TOKENS.value, // N-77
    timeoutMs: NUMBERS.SUMMARY_CALL_TIMEOUT_S.value * 1000, // N-77
    ...(signal ? { signal } : {}),
  });
  if (outcome.status === 'skipped') return { code: 'summary_skipped', reason: outcome.code };
  if (outcome.status !== 'ok') return { code: 'summary_skipped', reason: outcome.code, call: outcome.call };
  // A cut or refused summary is not a summary: the history stays whole.
  if (outcome.result.finishReason !== 'end_turn') {
    return { code: 'summary_skipped', reason: outcome.result.finishReason === 'refusal' ? 'refused' : 'truncated', call: outcome.call };
  }
  const text = cutCodePoints(outcome.result.text.trim(), NUMBERS.SUMMARY_TEXT_MAX_CHARS.value).trim(); // N-77
  if (!text) return { code: 'summary_skipped', reason: 'empty', call: outcome.call };

  const summaryVersion = await nextSummaryVersion(deps.db, turn.chatId);
  const usage = outcome.result.usage;
  const inserted = await deps.db
    .insert(summaries)
    .values({
      chatId: turn.chatId,
      coversUptoMessageId: through.id,
      coversUptoSeq: through.seq,
      summaryVersion,
      text,
      model: outcome.call.providerModelId,
      inputTokens: usage.exact ? usage.inputTokens : null,
      outputTokens: usage.exact ? usage.outputTokens : null,
    })
    // Two jobs of one chat can finish together; the first row stands.
    .onConflictDoNothing()
    .returning({ id: summaries.id });
  if (inserted.length === 0) return { code: 'summary_skipped', reason: 'conflict', call: outcome.call };
  return { code: 'summary_written', summaryVersion, coversUptoSeq: through.seq, coveredTurns: covered.length, call: outcome.call };
}
