/**
 * Compaction of a long chat, as Claude does it (ADR-0019).
 *
 * "Compaction replaces the older turns of a conversation with a summary ... It keeps a long
 * conversation or agent task inside the context window" (platform.claude.com, Compaction
 * overview). Claude's threshold compaction runs "inside the request that reaches the threshold",
 * triggered by input tokens (default 150,000, minimum 50,000). Gemini has no server-side
 * compaction, so this is Claude's third option, "your own summarizer", with its keep-recent-turns
 * shape: the older turns become a summary, the last KEEP_TURNS turns stay word for word.
 *
 * The trigger is the previous request's size as the provider reported it: its input plus output
 * tokens, the amount the next request resends (the docs' own loop counts the same). No estimate
 * (Invariant 3): a turn whose usage is not exact never triggers a compaction.
 *
 * Messages are never deleted. A compaction row records the summary and the seq it covers
 * through; history for later turns starts after that seq.
 */
import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';

import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { attachments, conversationCompactions, messages, usageRecords } from '../../db/schema.js';
import { EMPTY_USAGE, type Provider, type ProviderUsage, type Turn } from '../../providers/types.js';

/** Claude's default summarization prompt (Compaction at a token threshold). */
export const SUMMARY_PROMPT =
  'You have written a partial transcript for the initial task above. Please write a summary of the transcript. ' +
  'The purpose of this summary is to provide continuity so you can continue to make progress towards solving ' +
  'the task in a future context, where the raw history above may not be accessible and will be replaced with ' +
  'this summary. Write down anything that would be helpful, including the state, next steps, learnings etc. ' +
  'You must wrap your summary in a <summary></summary> block.';

/** Turns kept word for word after the summary, as the docs' keep-recent-turns example keeps two. */
export const KEEP_TURNS = 2;

/** Claude's threshold limits: default trigger and the lowest it accepts. */
const CLAUDE_DEFAULT_TRIGGER = 150_000;
const CLAUDE_MIN_TRIGGER = 50_000;

/**
 * Input tokens at which a chat on a model with this window compacts. Claude's default is 150,000
 * on a 200,000-token window; a smaller window compacts at the same three quarters of it.
 */
export function compactionTrigger(configured: number, windowTokens: number | null): number {
  const cap = windowTokens ? Math.floor(windowTokens * 0.75) : configured;
  return Math.max(CLAUDE_MIN_TRIGGER, Math.min(configured, cap));
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
 * Whether the request before `beforeSeq` was large enough to compact. Reads the latest exact
 * usage row of the last assistant message; a compaction's own usage has no message and is not it.
 */
export async function shouldCompact(
  deps: CompactionDeps,
  chatId: string,
  beforeSeq: number,
  contextWindow: number | null,
): Promise<boolean> {
  const [last] = await deps.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant'), lt(messages.seq, beforeSeq)))
    .orderBy(desc(messages.seq))
    .limit(1);
  if (!last) return false;
  const [usage] = await deps.db
    .select({ input: usageRecords.inputTokens, output: usageRecords.outputTokens })
    .from(usageRecords)
    .where(and(eq(usageRecords.messageId, last.id), eq(usageRecords.tokensExact, true)))
    .orderBy(desc(usageRecords.startedAt))
    .limit(1);
  if (!usage) return false;
  return usage.input + usage.output >= compactionTrigger(deps.cfg.COMPACTION_TRIGGER_TOKENS, contextWindow);
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
    filesOf.set(f.messageId, [...(filesOf.get(f.messageId) ?? []), `${f.filename ?? f.id} (fileId ${f.id})`]);
  }

  const previous = fromSeq === null ? null : await previousSummary(deps.db, chatId);
  const history: Turn[] = older.map((r, i) => {
    const attached = filesOf.get(r.id);
    const lead = i === 0 && previous ? `<summary_of_earlier_conversation>\n${previous}\n</summary_of_earlier_conversation>\n\n` : '';
    return {
      role: r.role === 'user' ? 'user' : 'assistant',
      text: `${lead}${r.text.trim() || '[Response stopped]'}${attached ? `\n\n[Attached: ${attached.join(', ')}]` : ''}`,
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
