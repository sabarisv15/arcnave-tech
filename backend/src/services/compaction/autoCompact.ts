/**
 * Compaction of a long chat (ADR-0019).
 *
 * Compaction replaces the older turns of a conversation with a summary, keeping a long
 * conversation or agent task inside the context window. When: as the conversation approaches
 * the context window limit, compacting before the window fills (about 967K tokens on a 1M
 * window). A 150,000 default was wrongly used here until the 2026-09-26 audit (ADR-0027).
 * Gemini has no server-side compaction, so this is our own summarizer, with a
 * keep-recent-turns shape: the older turns become a summary, the last KEEP_TURNS stay word for word.
 *
 * The trigger is the previous turn's last provider request as the provider reported it: its whole
 * prompt plus its answer, the amount the next request resends (the docs' own loop counts the
 * same). Not the turn's total: a turn of 13 tool rounds sends the conversation 14 times and its
 * total counts every one. No estimate (Invariant 3): a turn whose usage is not exact never
 * triggers a compaction.
 *
 * Messages are never deleted. A compaction row records the summary and the seq it covers
 * through; history for later turns starts after that seq.
 */
import { and, desc, eq, gt, inArray, isNotNull, lt } from 'drizzle-orm';

import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { attachments, conversationCompactions, messages, toolCalls, usageRecords } from '../../db/schema.js';
import { EMPTY_USAGE, toolCallAsText, type Provider, type ProviderUsage, type ToolContent, type Turn } from '../../providers/types.js';
import { filenameInText } from '../../providers/attachmentContent.js';

/** The summarization prompt (ADR-0019). */
export const SUMMARY_PROMPT =
  'You have written a partial transcript for the initial task above. Please write a summary of the transcript. ' +
  'The purpose of this summary is to provide continuity so you can continue to make progress towards solving ' +
  'the task in a future context, where the raw history above may not be accessible and will be replaced with ' +
  'this summary. Write down anything that would be helpful, including the state, next steps, learnings etc. ' +
  'You must wrap your summary in a <summary></summary> block.';

/** Turns kept word for word after the summary, as the docs' keep-recent-turns example keeps two. */
export const KEEP_TURNS = 2;

/** Room left below the window when compaction runs: a 1M window compacts at about
 *  967K, leaving 33,000 tokens for the next
 *  message and its answer. */
export const COMPACTION_WINDOW_RESERVE = 33_000;
/** The lowest compaction trigger. */
const MIN_TRIGGER = 50_000;

/**
 * Tokens of the previous request at which a chat compacts: as the conversation approaches the
 * model's window, not before. `fallback` applies only when the window is unknown.
 */
export function compactionTrigger(fallback: number, windowTokens: number | null): number {
  return Math.max(MIN_TRIGGER, windowTokens ? windowTokens - COMPACTION_WINDOW_RESERVE : fallback);
}

export interface TextSummary {
  kind: 'text';
  text: string;
}

export function isTextSummary(summary: unknown): summary is TextSummary {
  return typeof summary === 'object' && summary !== null && (summary as { kind?: unknown }).kind === 'text';
}

export interface CompactionDeps {
  db: Database;
  cfg: Pick<Config, 'COMPACTION_TRIGGER_TOKENS' | 'DEFAULT_MAX_OUTPUT_TOKENS'>;
}

export interface CompactionModel {
  provider: Provider;
  providerModelId: string;
  providerName: string;
  contextWindow: number | null;
}

export interface CompactionResult {
  throughSeq: number;
  usage: ProviderUsage;
}

/** The seq the last compaction covers through, or null. (Message seqs start at 0.) */
export async function latestCompactionSeq(db: Database, chatId: string): Promise<number | null> {
  const [row] = await db
    .select({ seq: conversationCompactions.throughSeq })
    .from(conversationCompactions)
    .where(eq(conversationCompactions.chatId, chatId))
    .orderBy(desc(conversationCompactions.throughSeq))
    .limit(1);
  return row?.seq ?? null;
}

/**
 * Whether the request before `beforeSeq` was large enough to compact. Reads the latest usage row
 * of the last assistant message that has an exact context size; a compaction's own usage has no
 * message and is not it.
 */
export async function shouldCompact(
  deps: CompactionDeps,
  chatId: string,
  beforeSeq: number,
  contextWindow: number | null,
): Promise<boolean> {
  const context = await lastContextTokens(deps.db, chatId, beforeSeq);
  return context !== null && context >= compactionTrigger(deps.cfg.COMPACTION_TRIGGER_TOKENS, contextWindow);
}

/**
 * The exact size of the chat's last request before `beforeSeq`: prompt plus answer of the last
 * provider request of the last assistant turn. Null when that was not reported exactly.
 */
export async function lastContextTokens(db: Database, chatId: string, beforeSeq: number): Promise<number | null> {
  const [last] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant'), lt(messages.seq, beforeSeq)))
    .orderBy(desc(messages.seq))
    .limit(1);
  if (!last) return null;
  const [usage] = await db
    .select({ context: usageRecords.contextTokens })
    .from(usageRecords)
    .where(and(eq(usageRecords.messageId, last.id), isNotNull(usageRecords.contextTokens)))
    .orderBy(desc(usageRecords.startedAt))
    .limit(1);
  return usage?.context ?? null;
}

/**
 * Summarises the chat's turns before the last KEEP_TURNS (and before `beforeSeq`) into a new
 * compaction. Null when there is nothing older than the kept turns, or no summary came back; the
 * history is then left whole. Usage is returned even then, when the model was called.
 */
export async function compact(
  deps: CompactionDeps,
  chatId: string,
  beforeSeq: number,
  model: CompactionModel,
  signal: AbortSignal,
): Promise<{ result: CompactionResult | null; usage: ProviderUsage }> {
  const fromSeq = await latestCompactionSeq(deps.db, chatId);
  const rows = await deps.db
    .select({ id: messages.id, seq: messages.seq, role: messages.role, text: messages.text })
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        ...(fromSeq === null ? [] : [gt(messages.seq, fromSeq)]),
        lt(messages.seq, beforeSeq),
      ),
    )
    .orderBy(messages.seq);

  // The cut falls before the KEEP_TURNS-th user message from the end, so the kept turns start
  // with a user message and no turn is split.
  const userIdx = rows.map((r, i) => (r.role === 'user' ? i : -1)).filter((i) => i >= 0);
  const cut = userIdx.length > KEEP_TURNS ? userIdx[userIdx.length - KEEP_TURNS]! : -1;
  const older = cut > 0 ? rows.slice(0, cut) : [];
  if (older.length === 0) return { result: null, usage: EMPTY_USAGE };

  const files = await deps.db
    .select({ messageId: attachments.messageId, id: attachments.id, filename: attachments.filename })
    .from(attachments)
    .where(
      and(
        inArray(attachments.messageId, older.map((r) => r.id)),
        eq(attachments.status, 'ready'),
      ),
    );
  const filesOf = new Map<string, string[]>();
  for (const f of files) {
    if (!f.messageId) continue;
    filesOf.set(f.messageId, [...(filesOf.get(f.messageId) ?? []), `${f.filename ? filenameInText(f.filename) : f.id} (fileId ${f.id})`]);
  }

  // What the older turns ran and found goes into the summary too, whole: the whole
  // transcript is compacted, tool results included. It fit in the last request, so it fits in this one.
  const callRows = await deps.db
    .select({ messageId: toolCalls.messageId, id: toolCalls.toolCallId, name: toolCalls.name, input: toolCalls.input, content: toolCalls.content, ok: toolCalls.ok })
    .from(toolCalls)
    .where(inArray(toolCalls.messageId, older.map((r) => r.id)))
    .orderBy(toolCalls.ordinal);
  const callsOf = new Map<string, string[]>();
  for (const c of callRows) {
    const text = toolCallAsText({ id: c.id, name: c.name, input: c.input, result: { toolCallId: c.id, ok: c.ok, content: c.content as ToolContent[] } });
    callsOf.set(c.messageId, [...(callsOf.get(c.messageId) ?? []), text]);
  }

  const previous = fromSeq === null ? null : await previousSummary(deps.db, chatId);
  const history: Turn[] = older.map((r, i) => {
    const attached = filesOf.get(r.id);
    const lead = i === 0 && previous ? `<summary_of_earlier_conversation>\n${previous}\n</summary_of_earlier_conversation>\n\n` : '';
    return {
      role: r.role === 'user' ? 'user' : 'assistant',
      text:
        `${lead}${callsOf.get(r.id)?.join('\n\n').concat('\n\n') ?? ''}${r.text.trim() || '[Response stopped]'}` +
        `${attached ? `\n\n[Attached: ${attached.join(', ')}]` : ''}`,
    };
  });

  let text = '';
  let usage = EMPTY_USAGE;
  for await (const ev of model.provider.stream({
    prompt: SUMMARY_PROMPT,
    history,
    systemInstruction:
      'You are ArcNave, an AI assistant. The user and you have been in the conversation above; it is about to be ' +
      'replaced by your summary. Keep every fact, figure, file name and fileId, decision and open request a later ' +
      'turn could need.',
    mode: 'chat',
    // Thinking counts against this on Gemini: a small cap cut summaries short (mistakes.md, 2026-09-24).
    maxOutputTokens: deps.cfg.DEFAULT_MAX_OUTPUT_TOKENS,
    providerModelId: model.providerModelId,
    grounded: false,
    codeExecution: false,
    signal,
  })) {
    if (ev.type === 'delta') text += ev.text;
    if (ev.type === 'completed') usage = ev.usage;
  }

  const summary = (/<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1] ?? '').trim();
  if (!summary) return { result: null, usage };

  const through = older[older.length - 1]!;
  await deps.db
    .insert(conversationCompactions)
    .values({
      chatId,
      throughMessageId: through.id,
      throughSeq: through.seq,
      summary: { kind: 'text', text: summary } satisfies TextSummary,
      tokenCountAfter: usage.exact ? usage.outputTokens : null,
      provider: model.providerName,
      model: model.providerModelId,
    })
    // Two turns of one chat can reach here together; the first summary stands.
    .onConflictDoNothing();
  return { result: { throughSeq: through.seq, usage }, usage };
}

async function previousSummary(db: Database, chatId: string): Promise<string | null> {
  const [row] = await db
    .select({ summary: conversationCompactions.summary })
    .from(conversationCompactions)
    .where(eq(conversationCompactions.chatId, chatId))
    .orderBy(desc(conversationCompactions.throughSeq))
    .limit(1);
  return row && isTextSummary(row.summary) ? row.summary.text : null;
}
