/**
 * HP-TITLE (Stage 6, Stage 3 6.4, N-76; ADR-0080): after a chat's first completed turn, a helper
 * call names the chat. The first-80-characters title the turn start writes stays as the
 * placeholder until then. Set once: the write is a compare-and-set on `title_source = 'prompt'`,
 * so a user rename (`user`) that lands first or later always wins, and a second run changes nothing.
 */
import { and, eq, isNull } from 'drizzle-orm';

import { NUMBERS } from '../../config/numbers.js';
import type { Database } from '../../db/client.js';
import { chats, messages } from '../../db/schema.js';
import type { ModelRegistry } from '../../providers/registry.js';
import { escapeText } from '../prompt/sessionState.js';
import { callHelper, cutCodePoints, type HelperCallUsage } from './helperCall.js';
import { titlePrompt } from './helperPrompts.js';

export type TitleJobResult =
  | { code: 'title_written'; title: string; call: HelperCallUsage }
  | { code: 'title_skipped'; reason: string; call?: HelperCallUsage | null };

/**
 * The model's title as stored (HP-TITLE backend rule: trim to 60, strip markup): the first line,
 * tags and Markdown marks and quotes removed, spaces collapsed, no trailing period, at most N-76
 * 60 code points. Empty when nothing is left. The input is bounded (40 output tokens).
 */
export function cleanTitle(raw: string): string {
  const firstLine = raw.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const stripped = firstLine
    .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
    .replace(/[*_`#>~|[\]]/g, '')
    .replace(/["'“”‘’«»]/g, '')
    .replace(/^\s*title\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。…]+$/u, '')
    .trim();
  return cutCodePoints(stripped, NUMBERS.TITLE_MAX_CHARS.value).trim(); // N-76
}

export async function runTitleJob(
  deps: { db: Database; registry: ModelRegistry },
  turn: { chatId: string; messageId: string },
  signal?: AbortSignal,
): Promise<TitleJobResult> {
  const [answer] = await deps.db
    .select({ seq: messages.seq, text: messages.text, status: messages.status })
    .from(messages)
    .where(and(eq(messages.id, turn.messageId), eq(messages.chatId, turn.chatId)))
    .limit(1);
  // The first completed turn only: its answer is seq 1 (a regenerate of it too).
  if (!answer || answer.seq !== 1 || answer.status !== 'complete') return { code: 'title_skipped', reason: 'not_first_turn' };
  const [chat] = await deps.db
    .select({ titleSource: chats.titleSource })
    .from(chats)
    .where(and(eq(chats.id, turn.chatId), isNull(chats.deletedAt)))
    .limit(1);
  if (!chat || chat.titleSource !== 'prompt') return { code: 'title_skipped', reason: 'title_set' };
  const [question] = await deps.db
    .select({ text: messages.text })
    .from(messages)
    .where(and(eq(messages.chatId, turn.chatId), eq(messages.seq, 0)))
    .limit(1);

  const max = NUMBERS.TITLE_INPUT_CHARS.value; // N-76: 1,500 characters of each
  const outcome = await callHelper(deps.registry, {
    role: 'title',
    system: titlePrompt(),
    text:
      `<first_message>\n${escapeText(cutCodePoints(question?.text ?? '', max))}\n</first_message>\n` +
      `<first_answer>\n${escapeText(cutCodePoints(answer.text, max))}\n</first_answer>`,
    maxOutputTokens: NUMBERS.TITLE_MAX_OUTPUT_TOKENS.value, // N-76
    timeoutMs: NUMBERS.TITLE_CALL_TIMEOUT_MS.value, // N-76
    ...(signal ? { signal } : {}),
  });
  if (outcome.status === 'skipped') return { code: 'title_skipped', reason: outcome.code };
  if (outcome.status !== 'ok') return { code: 'title_skipped', reason: outcome.code, call: outcome.call };
  if (outcome.result.finishReason !== 'end_turn') {
    return { code: 'title_skipped', reason: outcome.result.finishReason === 'refusal' ? 'refused' : 'truncated', call: outcome.call };
  }
  const title = cleanTitle(outcome.result.text);
  if (!title) return { code: 'title_skipped', reason: 'empty', call: outcome.call };

  const updated = await deps.db
    .update(chats)
    .set({ title, titleSource: 'generated' })
    .where(and(eq(chats.id, turn.chatId), eq(chats.titleSource, 'prompt'), isNull(chats.deletedAt)))
    .returning({ id: chats.id });
  if (updated.length === 0) return { code: 'title_skipped', reason: 'renamed', call: outcome.call };
  return { code: 'title_written', title, call: outcome.call };
}
