/**
 * Earlier turns' tool calls, replayed to the model as Claude's history keeps them (ADR-0022).
 *
 * Claude's tool loop sends "the original messages, the assistant's response, and ... the
 * tool_result blocks" on every request (How tool use works), and a later turn "can reuse
 * discovered tools ... without re-searching" (Tool search). ArcNave used to keep only each
 * turn's final text, so every follow-up reloaded its skill and redid its work.
 *
 * Context editing follows Claude's clear_tool_uses defaults: once a request reaches the trigger
 * (100,000 input tokens), the oldest tool results are replaced with a placeholder, keeping the
 * last 3 tool uses; the calls themselves stay. The trigger is the previous request's exact size
 * (no estimate, Invariant 3), and a cleared result stays cleared (tool_calls.result_cleared).
 */
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { messages, toolCalls } from '../../db/schema.js';
import type { HistoryToolCall, ToolContent } from '../../providers/types.js';
import { lastContextTokens } from '../compaction/autoCompact.js';

/** What the model sees in place of a cleared result. */
export const CLEARED_TOOL_RESULT =
  '[This tool result was cleared to save context. Call the tool again if you need it.]';

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
      cleared: toolCalls.resultCleared,
    })
    .from(toolCalls)
    .where(inArray(toolCalls.messageId, messageIds))
    .orderBy(asc(toolCalls.ordinal));
  for (const r of rows) {
    const content: ToolContent[] = r.cleared ? [{ type: 'text', text: CLEARED_TOOL_RESULT }] : (r.content as ToolContent[]);
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

/**
 * Marks the chat's older tool results cleared when its last request (before `beforeSeq`) reached
 * the trigger, keeping the most recent `keep` calls. Returns how many were newly cleared.
 */
export async function clearOldToolResults(
  db: Database,
  chatId: string,
  beforeSeq: number,
  cfg: { CONTEXT_EDIT_TRIGGER_TOKENS: number; CONTEXT_EDIT_KEEP_TOOL_USES: number },
): Promise<number> {
  const context = await lastContextTokens(db, chatId, beforeSeq);
  if (context === null || context < cfg.CONTEXT_EDIT_TRIGGER_TOKENS) return 0;

  const calls = await db
    .select({ id: toolCalls.id, cleared: toolCalls.resultCleared })
    .from(toolCalls)
    .innerJoin(messages, eq(toolCalls.messageId, messages.id))
    .where(and(eq(messages.chatId, chatId), lt(messages.seq, beforeSeq)))
    .orderBy(asc(messages.seq), asc(toolCalls.ordinal));
  const older = calls.slice(0, Math.max(0, calls.length - cfg.CONTEXT_EDIT_KEEP_TOOL_USES)).filter((c) => !c.cleared);
  if (older.length === 0) return 0;
  await db
    .update(toolCalls)
    .set({ resultCleared: sql`true` })
    .where(inArray(toolCalls.id, older.map((c) => c.id)));
  return older.length;
}

/** Characters a replayed call adds, for the history backstop budget. */
export function toolCallChars(calls: HistoryToolCall[] | undefined): number {
  let n = 0;
  for (const c of calls ?? []) n += JSON.stringify(c.input ?? {}).length + JSON.stringify(c.result.content).length;
  return n;
}
