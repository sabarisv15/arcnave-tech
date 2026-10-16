/**
 * Context build, part 1: the turn's inputs from the database (preferences, project, history)
 * and the compaction that runs before a long chat's turn. Moved from `GenerationService`
 * unchanged but for `this` becoming `svc` (ADR-0067).
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { attachments, messages, preferences as preferencesTable, projects } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import type { ModelEntry } from '../../providers/registry.js';
import { getModelCapability } from '../../providers/capabilitiesTable.js';
import { type AttachmentBlock, type AttachmentRef, type Provider, type ReasoningEffort, type Turn, EMPTY_USAGE, isAbort } from '../../providers/types.js';
import { loadToolCalls, toolCallChars } from '../history/toolHistory.js';
import { withoutFailedExchanges } from '../history/failedExchanges.js';
import { compact, shouldCompact, lastContextTokens } from '../compaction/autoCompact.js';
import { toAttachmentRef } from '../attachments/attachmentRef.js';
import type { TurnServices } from './services.js';
import type { StreamEvent } from './events.js';
import type { GenerateInput, PreferencesRow } from './input.js';
import { logger } from '../../logger.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

export async function loadPreferences(svc: TurnServices, userId: string): Promise<PreferencesRow> {
  const [row] = await svc.db
    .select({
      instructions: preferencesTable.instructions,
      styleId: preferencesTable.styleId,
      maxOutputTokens: preferencesTable.maxOutputTokens,
      dailyTokenBudget: preferencesTable.dailyTokenBudget,
      monthlyTokenBudget: preferencesTable.monthlyTokenBudget,
      warnThresholdPct: preferencesTable.warnThresholdPct,
      routingPreference: preferencesTable.routingPreference,
      timezone: preferencesTable.timezone,
      effort: preferencesTable.effort,
      memoryEnabled: preferencesTable.memoryEnabled,
      chatSearchEnabled: preferencesTable.chatSearchEnabled,
    })
    .from(preferencesTable)
    .where(eq(preferencesTable.userId, userId))
    .limit(1);
  if (!row) throw new ApiError('internal_error', { detail: 'Preferences are missing.' });
  return {
    ...row,
    effort: (row.effort as ReasoningEffort | null) ?? null,
  };
}

export async function loadProject(
  svc: TurnServices,
  userId: string,
  projectId: string,
): Promise<{ id: string; title: string; instructions: string } | null> {
  const [row] = await svc.db
    .select({ id: projects.id, title: projects.title, instructions: projects.instructions })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.userId, userId),
        sql`${projects.deletedAt} is null`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Prior turns, oldest first, excluding the assistant row we are about to fill. */
/**
 * Prior turns only. The current user message (the row just before this assistant row) is the
 * turn being answered: its prompt and attachments reach the provider as the current turn, so
 * it must not also appear in history. It used to, which sent every prompt and every current
 * attachment twice (G27).
 *
 * `modelAlias` sizes the character backstop by that model's window; it must be a resolved
 * alias, never `Auto` (D2 X-2). `null` keeps every turn: the read before the model is known.
 * Failed, refused and empty exchanges are left out, question and answer (D2 X-3).
 */
export async function loadHistory(
  svc: TurnServices,
  chatId: string,
  excludeMessageId: string,
  throughSeq: number | undefined,
  modelAlias: string | null,
): Promise<{ turns: Turn[]; currentUserAttachments: AttachmentRef[] }> {
  const [self] = await svc.db
    .select({ seq: messages.seq })
    .from(messages)
    .where(eq(messages.id, excludeMessageId))
    .limit(1);
  const currentUserSeq = self ? self.seq - 1 : undefined;

  const conditions = [
    eq(messages.chatId, chatId),
    sql`${messages.id} <> ${excludeMessageId}`,
  ];
  if (currentUserSeq !== undefined) {
    conditions.push(sql`${messages.seq} < ${currentUserSeq}`);
  }
  if (throughSeq !== undefined) {
    conditions.push(sql`${messages.seq} > ${throughSeq}`);
  }

  const rows = await svc.db
    .select({ id: messages.id, role: messages.role, text: messages.text, seq: messages.seq, status: messages.status })
    .from(messages)
    .where(and(...conditions))
    // No turn count: the whole conversation goes, up to the model's window. What
    // keeps it inside the window is compaction (ADR-0019); the character budget below is the
    // backstop. A 20-message cap here used to drop a file sent 11 questions ago.
    .orderBy(desc(messages.seq));

  const chronological = rows.reverse();
  // Earlier turns' tool calls go with them, results in full (ADR-0022, ADR-0023).
  const toolCallsOf = await loadToolCalls(
    svc.db,
    chronological.filter((r) => r.role === 'assistant').map((r) => r.id),
  );
  // A question that carried files stays even when its answer failed: the file cannot be attached
  // again (file_already_attached), so a later "try again" only sees it through this history.
  const userIds = chronological.filter((r) => r.role === 'user').map((r) => r.id);
  const withFiles = new Set(
    userIds.length === 0
      ? []
      : (
          await svc.db
            .selectDistinct({ messageId: attachments.messageId })
            .from(attachments)
            .where(and(inArray(attachments.messageId, userIds), eq(attachments.status, 'ready')))
        ).flatMap((a) => (a.messageId ? [a.messageId] : [])),
  );
  const ordered = withoutFailedExchanges(chronological, toolCallsOf, withFiles);

  // Dynamic provider/model-aware context budget calculation:
  // available budget = model context window - output reserve (4k tokens) - system/tools reserve (8k tokens)
  let budget = Number.POSITIVE_INFINITY;
  if (modelAlias !== null) {
    const capability = getModelCapability(modelAlias);
    const contextLimitTokens =
      capability.maxInputTokens ?? capability.contextWindowTokens ?? 128_000;
    const availableHistoryTokens = Math.max(16_000, contextLimitTokens - 12_288);
    budget = availableHistoryTokens * 4; // ~4 characters per token average
  }

  let used = 0;
  const kept: typeof ordered = [];
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const row = ordered[i];
    if (!row) continue;
    const cost = row.text.length + toolCallChars(toolCallsOf.get(row.id));
    if (kept.length > 0 && used + cost > budget) break;
    kept.unshift(row);
    used += cost;
  }

  // Load attachments for all kept messages.
  // Base64 bytes are NOT loaded into history to avoid consuming RAM; only metadata and storageKey
  // are retained. Bytes are fetched on demand when constructing the wire payload.
  const attachmentRows = kept.length
    ? await svc.db
        .select({
          id: attachments.id,
          messageId: attachments.messageId,
          filename: attachments.filename,
          mimeType: attachments.mimeType,
          storageKey: attachments.storageKey,
          sizeBytes: attachments.sizeBytes,
          status: attachments.status,
          extractedText: attachments.extractedText,
        })
        .from(attachments)
        .where(
          and(
            inArray(
              attachments.messageId,
              kept.map((r) => r.id),
            ),
            eq(attachments.status, 'ready'),
          ),
        )
        .orderBy(desc(attachments.createdAt))
    : [];

  const byMessage = new Map<string, AttachmentBlock[]>();
  for (const row of attachmentRows) {
    if (!row.messageId) continue;
    const list = byMessage.get(row.messageId) ?? [];
    list.push(toAttachmentRef(row));
    byMessage.set(row.messageId, list);
  }

  const turns = kept.map((r): Turn => {
    const atts = byMessage.get(r.id);
    const calls = r.role === 'assistant' ? toolCallsOf.get(r.id) : undefined;
    // Extracted text travels once, on the attachment itself; the adapters render it (G16).
    return {
      role: r.role === 'user' ? 'user' : 'assistant',
      text: r.text,
      ...(atts ? { attachments: atts } : {}),
      ...(calls?.length ? { toolCalls: calls } : {}),
    };
  });

  // The current user message's own attachments. A retry may not resend attachmentIds, and
  // until G27 those files only reached the provider through the duplicated history copy.
  const currentUserAttachments =
    currentUserSeq === undefined
      ? []
      : (
          await svc.db
            .select({
              id: attachments.id,
              filename: attachments.filename,
              mimeType: attachments.mimeType,
              storageKey: attachments.storageKey,
              sizeBytes: attachments.sizeBytes,
              extractedText: attachments.extractedText,
            })
            .from(attachments)
            .innerJoin(messages, eq(attachments.messageId, messages.id))
            .where(
              and(
                eq(messages.chatId, chatId),
                eq(messages.seq, currentUserSeq),
                eq(messages.role, 'user'),
                eq(attachments.status, 'ready'),
              ),
            )
            .orderBy(attachments.createdAt)
        ).map(toAttachmentRef);

  return { turns, currentUserAttachments };
}

/**
 * Compacts the chat before this turn when the previous request reached the trigger (ADR-0019),
 * with the model this turn runs on. The user sees it happen ("Compacting our conversation").
 * A failed compaction leaves
 * the history whole and the turn goes on; an abort ends the turn.
 */
export async function* compactIfNeeded(
  svc: TurnServices,
  input: GenerateInput,
  prefs: PreferencesRow,
  entry: ModelEntry,
  provider: Provider,
): AsyncGenerator<StreamEvent, boolean> {
  const [self] = await svc.db
    .select({ seq: messages.seq })
    .from(messages)
    .where(eq(messages.id, input.messageId))
    .limit(1);
  if (!self) return false;
  // The assistant row is the one after its user message; everything before that user message.
  const beforeSeq = self.seq - 1;
  const window = entry.contextWindow ?? getModelCapability(entry.alias).maxInputTokens ?? null;
  const deps = { db: svc.db, cfg: svc.cfg };
  if (!(await shouldCompact(deps, input.chatId, beforeSeq, window))) return false;

  const progress = (stage: 'reading' | 'complete', label: string, detail: string): StreamEvent => ({
    type: 'research',
    event: { stage, label, detail, at: new Date().toISOString() },
  });
  yield progress('reading', 'Compacting our conversation', 'Summarizing earlier messages so the chat can continue.');
  const startedAt = new Date();
  let usage = EMPTY_USAGE;
  let status: 'complete' | 'error' | 'cancelled' = 'complete';
  try {
    const out = await compact(deps, input.chatId, beforeSeq, {
      provider,
      providerModelId: entry.providerModelId!,
      providerName: entry.provider,
      contextWindow: window,
    }, input.signal);
    usage = out.usage;
    if (!out.result) {
      yield progress('complete', 'Conversation not compacted', 'No summary came back; the full conversation is sent.');
      return false;
    }
    yield progress('complete', 'Conversation compacted', 'Earlier messages are summarized; recent ones are kept word for word.');
    return true;
  } catch (err) {
    if (isAbort(err) || input.signal.aborted) {
      status = 'cancelled';
      throw err;
    }
    status = 'error';
    log.warn({ err, chatId: input.chatId }, 'compaction failed; sending the full conversation');
    yield progress('complete', 'Conversation not compacted', 'Summarizing failed; the full conversation is sent.');
    return false;
  } finally {
    // Its tokens are spent whether or not a summary came back. No messageId: the compaction is
    // not the turn's answer, and the next trigger check reads the answer's usage.
    await svc.usage.record({
      userId: input.userId,
      prefs,
      requestId: `${input.requestId}:compaction`,
      chatId: input.chatId,
      messageId: null,
      projectId: input.projectId,
      modelAlias: entry.alias,
      provider: entry.provider,
      providerModelId: entry.providerModelId!,
      usage,
      startedAt,
      status,
    });
  }
}

/** Exact prompt-plus-answer size of the chat's previous request, or null when not known. */
export async function previousContextTokens(svc: TurnServices, input: GenerateInput): Promise<number | null> {
  const [self] = await svc.db
    .select({ seq: messages.seq })
    .from(messages)
    .where(eq(messages.id, input.messageId))
    .limit(1);
  return self ? lastContextTokens(svc.db, input.chatId, self.seq) : null;
}
