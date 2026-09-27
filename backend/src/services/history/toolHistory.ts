/**
 * Earlier turns' tool calls, replayed to the model (ADR-0022).
 *
 * A tool loop sends the original messages, the assistant's response and the tool results on
 * every request, and a later turn can reuse discovered tools without re-searching. ArcNave used to keep only each
 * turn's final text, so every follow-up reloaded its skill and redid its work.
 *
 * Every result goes back in full. The whole history is kept and summarized only when the
 * conversation approaches the context window limit (compaction, ADR-0019); clearing tool
 * results by rule is opt-in. ArcNave cleared at 100,000 tokens, and follow-ups recounted what they had
 * lost (ADR-0023).
 */
import { asc, inArray } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { toolCalls } from '../../db/schema.js';
import type { HistoryToolCall, ToolContent } from '../../providers/types.js';

/** Every stored tool call of these messages, in order, as the model received them. */
export async function loadToolCalls(db: Database, messageIds: string[]): Promise<Map<string, HistoryToolCall[]>> {
  const byMessage = new Map<string, HistoryToolCall[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await db
    .select({
      messageId: toolCalls.messageId,
      id: toolCalls.toolCallId,
      name: toolCalls.name,
      input: toolCalls.input,
      content: toolCalls.content,
      ok: toolCalls.ok,
      thoughtSignature: toolCalls.thoughtSignature,
    })
    .from(toolCalls)
    .where(inArray(toolCalls.messageId, messageIds))
    .orderBy(asc(toolCalls.ordinal));
  for (const r of rows) {
    // result_cleared is ignored: a result an earlier revision cleared comes back in full (ADR-0023).
    const content = r.content as ToolContent[];
    const call: HistoryToolCall = {
      id: r.id,
      name: r.name,
      input: r.input,
      result: { toolCallId: r.id, ok: r.ok, content },
      ...(r.thoughtSignature ? { thoughtSignature: r.thoughtSignature } : {}),
    };
    byMessage.set(r.messageId, [...(byMessage.get(r.messageId) ?? []), call]);
  }
  return byMessage;
}

/** Characters a replayed call adds, for the history backstop budget. */
export function toolCallChars(calls: HistoryToolCall[] | undefined): number {
  let n = 0;
  for (const c of calls ?? []) n += JSON.stringify(c.input ?? {}).length + JSON.stringify(c.result.content).length;
  return n;
}
