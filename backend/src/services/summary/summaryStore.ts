/**
 * The `summaries` rows (migration 0032, ADR-0080): which summary a turn may use, and the copy a
 * branch takes.
 */
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { messages, summaries } from '../../db/schema.js';

type DbLike = Pick<Database, 'select' | 'insert'>;

export interface ActiveSummary {
  id: string;
  coversUptoMessageId: string;
  coversUptoSeq: number;
  summaryVersion: number;
  text: string;
}

/**
 * The newest ready summary a turn may use: its covered message still exists, is in this chat
 * (the join checks the message's own chat, not only the row's), and is below `belowSeq` (the
 * current user message's seq). Anything else is not this branch's summary and is ignored.
 */
export async function activeSummary(db: DbLike, chatId: string, belowSeq: number): Promise<ActiveSummary | null> {
  const [row] = await db
    .select({
      id: summaries.id,
      coversUptoMessageId: summaries.coversUptoMessageId,
      coversUptoSeq: messages.seq,
      summaryVersion: summaries.summaryVersion,
      text: summaries.text,
    })
    .from(summaries)
    .innerJoin(messages, eq(messages.id, summaries.coversUptoMessageId))
    .where(
      and(
        eq(summaries.chatId, chatId),
        eq(messages.chatId, chatId),
        eq(summaries.status, 'ready'),
        lt(messages.seq, belowSeq),
        // The stored seq and the message's seq agree: a row written against another layout is not used.
        sql`${summaries.coversUptoSeq} = ${messages.seq}`,
      ),
    )
    .orderBy(desc(messages.seq), desc(summaries.summaryVersion))
    .limit(1);
  return row ?? null;
}

/** The next version number in a chat (copied rows keep theirs). */
export async function nextSummaryVersion(db: DbLike, chatId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${summaries.summaryVersion})` })
    .from(summaries)
    .where(eq(summaries.chatId, chatId));
  return Number(row?.max ?? 0) + 1;
}

/**
 * A branch copies the summaries whose covered message it keeps, pointed at the copied message
 * (`idFor`: source message id → copied id). A summary over a message the branch does not keep
 * (a fork inside the covered range) is not copied, so the branch never uses it.
 */
export async function copySummaries(
  tx: DbLike,
  fromChatId: string,
  toChatId: string,
  idFor: ReadonlyMap<string, string>,
): Promise<void> {
  const kept = [...idFor.keys()];
  if (kept.length === 0) return;
  const rows = await tx
    .select()
    .from(summaries)
    .where(and(eq(summaries.chatId, fromChatId), inArray(summaries.coversUptoMessageId, kept)));
  if (rows.length === 0) return;
  await tx.insert(summaries).values(
    rows.map((r) => ({
      chatId: toChatId,
      coversUptoMessageId: idFor.get(r.coversUptoMessageId)!,
      coversUptoSeq: r.coversUptoSeq,
      summaryVersion: r.summaryVersion,
      text: r.text,
      model: r.model,
      status: r.status,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      createdAt: r.createdAt,
    })),
  );
}
