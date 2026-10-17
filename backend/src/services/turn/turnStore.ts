/**
 * The durable turn (P08, ADR-0078): the `turns` row a run is bound to, the one transaction that
 * settles it, the sweeper that takes over a turn whose runner died, and the parameters a turn is
 * loaded from.
 *
 * - **One settle, one order.** Success, a provider error, a failure outside the stream and the
 *   sweeper all end a turn through `settleTurnTx`, in this order: lock the turn and check its
 *   fencing token, the message row, its sources, the usage row, the counters, the reservation,
 *   the turn's state, the chat's `updatedAt`. All of it lands, or none of it does.
 * - **Fencing.** A runner writes only while the turn's `fencing_token` is the one it was given.
 *   A takeover increments it, so a runner that lost its lease (a frozen process that wakes up)
 *   is refused (`FencedOut`) instead of overwriting what the sweeper wrote.
 */
import { and, asc, desc, eq, getTableColumns, inArray, lt, lte, sql } from 'drizzle-orm';

import type { Config } from '../../config.js';
import type { Database, DbLike, Transaction } from '../../db/client.js';
import { withLongStatements } from '../../db/client.js';
import {
  attachments as attachmentsTable,
  budgetReservations,
  chats,
  idempotencyKeys,
  messages,
  messageSources,
  turns,
  type MessageSegment,
  type TurnParams,
  type TurnRow,
} from '../../db/schema.js';
import { notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { type AttachmentRef, type Mode, type ProviderSource, type ProviderUsage, type ReasoningEffort, EMPTY_USAGE } from '../../providers/types.js';
import { toAttachmentRef } from '../attachments/attachmentRef.js';
import { type BudgetPrefs, type ReservationRef, type UsageService, reservationRef } from '../usage.js';

const log = logger.child({ module: 'turns' });

/** The turn a run writes for, and the reservation it holds. Carried on `GenerateInput.turn`. */
export interface TurnBinding {
  turnId: string;
  fencingToken: number;
  reservation: ReservationRef | null;
}

/** The runner's lease is gone: another instance took the turn over, or it already ended. */
export class FencedOut extends Error {
  constructor(readonly turnId: string) {
    super('turn fenced out');
    this.name = 'FencedOut';
  }
}

export const ACTIVE_STATES = ['queued', 'running'] as const;

export type TurnEndState = 'done' | 'cancelled' | 'failed' | 'interrupted';

/** What the assistant row says once the turn ends. */
export type MessageWrite =
  | {
      /** The answer as the run left it, with the model that wrote it. */
      kind: 'final';
      text: string;
      thinking?: string;
      segments?: MessageSegment[];
      sources: ProviderSource[];
      searchEntryPoint: string | undefined;
      status: 'complete' | 'stopped' | 'error';
      errorCode: string | null;
      finishReason: string | null;
      model: { alias: string; provider: string; providerModelId: string | null };
      mode: Mode;
      questions?: string[];
      effort?: ReasoningEffort;
    }
  | {
      /** The turn failed before an answer could be written (or its runner died): the row keeps
       *  whatever text was flushed, and says why it ended. */
      kind: 'failed';
      errorCode: string;
      mode: string;
    };

/** The usage row of the turn: written whenever a model call was made (or may have been). */
export interface UsageWrite {
  prefs: BudgetPrefs;
  modelAlias: string;
  provider: string;
  providerModelId: string;
  usage: ProviderUsage;
  startedAt: Date;
  status: 'complete' | 'cancelled' | 'error' | 'blocked';
  finishReason?: string | null;
  errorCode?: string | null;
}

export interface SettleIds {
  userId: string;
  chatId: string;
  messageId: string;
  requestId: string;
  projectId: string | null;
}

export interface SettleDeps {
  db: Database;
  cfg: Pick<Config, 'DB_TX_MAX_RETRIES'>;
  usage: UsageService;
}

/**
 * Ends a turn in one transaction, in the fixed order of the file header. Without a binding (a
 * script driving the generation service directly) there is no turn row to lock or end, and the
 * same writes land unfenced.
 */
export async function settleTurnTx(
  deps: Pick<SettleDeps, 'usage'>,
  tx: Transaction,
  ids: SettleIds,
  binding: TurnBinding | undefined,
  write: {
    message: MessageWrite;
    usage: UsageWrite | null;
    end: TurnEndState;
    finishCode: string;
    /** Default: settled when usage is recorded, else released. A takeover expires it. */
    reservation?: 'settled' | 'released' | 'expired';
  },
): Promise<void> {
  // 1. The turn, locked, and still this runner's.
  if (binding) {
    const [row] = await tx
      .select({ fencingToken: turns.fencingToken, state: turns.state })
      .from(turns)
      .where(eq(turns.id, binding.turnId))
      .for('update');
    if (!row || row.fencingToken !== binding.fencingToken || !(ACTIVE_STATES as readonly string[]).includes(row.state)) {
      throw new FencedOut(binding.turnId);
    }
  }

  // 2. The message row.
  const m = write.message;
  if (m.kind === 'final') {
    const researchStage =
      m.mode === 'chat'
        ? null
        : m.status === 'error'
          ? 'error'
          : m.status === 'stopped'
            ? 'partial'
            : m.sources.length > 0
              ? 'complete'
              : 'partial';
    await tx
      .update(messages)
      .set({
        text: m.text,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        ...(m.segments && m.segments.length > 0 ? { segments: m.segments } : {}),
        status: m.status,
        errorCode: m.errorCode,
        researchStage,
        questions: m.questions ?? [],
        modelAlias: m.model.alias,
        effort: m.effort ?? null,
        provider: m.model.provider,
        providerModelId: m.model.providerModelId,
        finishReason: m.finishReason,
        searchEntryPoint: m.searchEntryPoint ?? null,
        completedAt: new Date(),
      })
      .where(eq(messages.id, ids.messageId));

    // 3. Its sources. Replaced rather than appended: a retry of the same message must not double
    //    its citations.
    if (m.sources.length > 0) {
      await tx.delete(messageSources).where(eq(messageSources.messageId, ids.messageId));
      await tx.insert(messageSources).values(
        m.sources.map((s, i) => ({
          messageId: ids.messageId,
          ordinal: i + 1,
          title: s.title.slice(0, 500),
          url: s.url,
          urlResolved: s.urlResolved,
          domain: s.domain.slice(0, 255),
          sourceType: s.sourceType,
          snippet: s.snippet,
          passage: s.passage,
          retrievedAt: s.retrievedAt,
        })),
      );
    }
  } else {
    await tx
      .update(messages)
      .set({
        status: 'error',
        errorCode: m.errorCode,
        researchStage: m.mode === 'chat' ? null : 'error',
        completedAt: new Date(),
      })
      .where(and(eq(messages.id, ids.messageId), eq(messages.status, 'generating')));
  }

  // 4 + 5. The usage row and the counters (one call: `record` commits what it records).
  if (write.usage) {
    await deps.usage.record(
      {
        userId: ids.userId,
        prefs: write.usage.prefs,
        requestId: ids.requestId,
        chatId: ids.chatId,
        messageId: ids.messageId,
        projectId: ids.projectId,
        modelAlias: write.usage.modelAlias,
        provider: write.usage.provider,
        providerModelId: write.usage.providerModelId,
        usage: write.usage.usage,
        startedAt: write.usage.startedAt,
        status: write.usage.status,
        ...(write.usage.finishReason !== undefined ? { finishReason: write.usage.finishReason } : {}),
        ...(write.usage.errorCode !== undefined ? { errorCode: write.usage.errorCode } : {}),
      },
      tx,
    );
  }

  // 6. The reservation: settled against the usage just recorded, or given back.
  if (binding?.reservation) {
    await deps.usage.release(binding.reservation, {
      status: write.reservation ?? (write.usage ? 'settled' : 'released'),
      tx,
    });
  }

  // 7. The turn's state.
  if (binding) {
    await tx
      .update(turns)
      .set({ state: write.end, finishCode: write.finishCode.slice(0, 48), endedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
      .where(eq(turns.id, binding.turnId));
  }

  // 8. The chat moves up the list.
  await tx.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, ids.chatId));
}

/** SQLSTATEs a whole transaction is retried on (N-45): serialization failure, deadlock. */
const RETRYABLE = new Set(['40001', '40P01']);

export function sqlState(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = typeof current === 'object' ? (current as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

/** `settleTurnTx` in its own transaction, retried whole at most N-45's twice on 40001 / 40P01. */
export async function settleTurn(
  deps: SettleDeps,
  ids: SettleIds,
  binding: TurnBinding | undefined,
  write: Parameters<typeof settleTurnTx>[4],
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.db.transaction((tx) => settleTurnTx(deps, tx, ids, binding, write));
      return;
    } catch (err) {
      const state = sqlState(err);
      if (state && RETRYABLE.has(state) && attempt < deps.cfg.DB_TX_MAX_RETRIES) continue;
      throw err;
    }
  }
}

/** The turn state a settled message maps to. */
export function endStateFor(status: 'complete' | 'stopped' | 'error', errorCode: string | null): TurnEndState {
  if (status === 'complete') return 'done';
  if (status === 'stopped') return 'cancelled';
  return errorCode === 'server_shutdown' || errorCode === 'interrupted' ? 'interrupted' : 'failed';
}

/* -------------------------------------------------------------------------- takeover */

/** Budget prefs for a usage row that commits nothing (zero tokens): the period is never read. */
const NO_BUDGET: BudgetPrefs = { dailyTokenBudget: null, monthlyTokenBudget: null, warnThresholdPct: 100, timezone: 'UTC' };

/**
 * Takes over a turn whose lease lapsed: the fencing token moves on (the old runner is refused
 * from here), the turn ends `interrupted`, the message keeps the text that was flushed and says
 * why it ended, a usage row records that a call was made with no counts (`exact: false`, zeros,
 * no price: Invariants 2 and 3), and the reservation expires.
 */
export async function interruptTurnTx(deps: Pick<SettleDeps, 'usage'>, tx: Transaction, turn: TurnRow): Promise<void> {
  const [bumped] = await tx
    .update(turns)
    .set({ fencingToken: sql`${turns.fencingToken} + 1` })
    .where(and(eq(turns.id, turn.id), inArray(turns.state, [...ACTIVE_STATES])))
    .returning({ fencingToken: turns.fencingToken });
  if (!bumped) return;
  const [held] = await tx
    .select()
    .from(budgetReservations)
    .where(and(eq(budgetReservations.turnId, turn.id), eq(budgetReservations.status, 'held')))
    .limit(1);
  const resolved = turn.params.resolved;
  await settleTurnTx(
    deps,
    tx,
    { userId: turn.userId, chatId: turn.chatId, messageId: turn.assistantMessageId, requestId: turn.requestId, projectId: turn.params.projectId },
    { turnId: turn.id, fencingToken: bumped.fencingToken, reservation: held ? reservationRef(held) : null },
    {
      message: { kind: 'failed', errorCode: 'interrupted', mode: turn.params.mode },
      usage: resolved
        ? {
            prefs: NO_BUDGET,
            modelAlias: resolved.alias,
            provider: resolved.provider,
            providerModelId: resolved.providerModelId,
            usage: EMPTY_USAGE,
            startedAt: turn.createdAt,
            status: 'error',
            errorCode: 'interrupted',
          }
        : null,
      end: 'interrupted',
      finishCode: 'interrupted',
      reservation: 'expired',
    },
  );
}

/** The chat's queued or running turn, locked, taken over first when its lease has lapsed. */
export async function activeTurnForUpdate(deps: Pick<SettleDeps, 'usage'>, tx: Transaction, chatId: string): Promise<TurnRow | null> {
  const [found] = await tx
    .select({ ...getTableColumns(turns), expired: sql<boolean>`coalesce(${turns.leaseExpiresAt} < now(), false)` })
    .from(turns)
    .where(and(eq(turns.chatId, chatId), inArray(turns.state, [...ACTIVE_STATES])))
    .for('update');
  if (!found) return null;
  const { expired, ...row } = found;
  if (!expired) return row;
  await interruptTurnTx(deps, tx, row);
  return null;
}

export interface SweepResult {
  interrupted: number;
  reservationsExpired: number;
  idempotencyKeysDeleted: number;
  legacyRowsMarked: number;
}

/** Rows per kind per sweep (ours: N-73's 1,000 batch for `app.chat_sweep`). */
const SWEEP_BATCH = 1_000;

/**
 * The turn sweeper (boot, then every N-76 60 s): turns whose lease lapsed, reservations nobody
 * settled, idempotency keys past N-34's 24 h, and assistant rows left `generating` from before
 * turns existed (migration 0030) once they are older than the turn deadline. `SKIP LOCKED`, so
 * instances that sweep at once take different rows.
 */
export async function sweepTurns(
  deps: SettleDeps & { cfg: Pick<Config, 'DB_TX_MAX_RETRIES' | 'DB_LONG_STATEMENT_TIMEOUT_MS' | 'IDEMPOTENCY_KEY_TTL_HOURS' | 'TURN_DEADLINE_MS'> },
  now: Date = new Date(),
): Promise<SweepResult> {
  return deps.db.transaction(async (tx) => {
    await withLongStatements(tx, deps.cfg);
    const due = await tx
      .select()
      .from(turns)
      .where(and(inArray(turns.state, [...ACTIVE_STATES]), lt(turns.leaseExpiresAt, now)))
      .orderBy(asc(turns.leaseExpiresAt))
      .limit(SWEEP_BATCH)
      .for('update', { skipLocked: true });
    for (const turn of due) await interruptTurnTx(deps, tx, turn);

    const reservationsExpired = await deps.usage.expireReservations(tx, now, SWEEP_BATCH);

    const keyCutoff = new Date(now.getTime() - deps.cfg.IDEMPOTENCY_KEY_TTL_HOURS * 3_600_000);
    const keys = await tx.delete(idempotencyKeys).where(lte(idempotencyKeys.createdAt, keyCutoff)).returning({ id: idempotencyKeys.id });

    const legacyCutoff = new Date(now.getTime() - deps.cfg.TURN_DEADLINE_MS);
    const legacy = await tx
      .update(messages)
      .set({ status: 'error', errorCode: 'interrupted', completedAt: now })
      .where(
        and(
          eq(messages.status, 'generating'),
          lt(messages.createdAt, legacyCutoff),
          sql`not exists (select 1 from turns t where t.assistant_message_id = ${messages.id} and t.state in ('queued', 'running'))`,
        ),
      )
      .returning({ id: messages.id });

    const result = {
      interrupted: due.length,
      reservationsExpired,
      idempotencyKeysDeleted: keys.length,
      legacyRowsMarked: legacy.length,
    };
    if (due.length > 0 || legacy.length > 0) log.info(result, 'turn sweep');
    return result;
  });
}

/* -------------------------------------------------------------------------- cancel */

/** Asks every queued or running turn of these chats to stop; returns the chats that had one. */
export async function requestCancel(db: DbLike, chatIds: string[]): Promise<string[]> {
  if (chatIds.length === 0) return [];
  const rows = await db
    .update(turns)
    .set({ cancelRequested: true })
    .where(and(inArray(turns.chatId, chatIds), inArray(turns.state, [...ACTIVE_STATES])))
    .returning({ chatId: turns.chatId });
  return rows.map((r) => r.chatId);
}

/* -------------------------------------------------------------------------- loading */

/** This turn's attachments, the caller's own only, in the order the request named them. */
export async function loadTurnAttachments(db: DbLike, userId: string, attachmentIds: string[]): Promise<AttachmentRef[]> {
  if (attachmentIds.length === 0) return [];
  const rows = await db
    .select({
      id: attachmentsTable.id,
      filename: attachmentsTable.filename,
      mimeType: attachmentsTable.mimeType,
      sizeBytes: attachmentsTable.sizeBytes,
      storageKey: attachmentsTable.storageKey,
      extractedText: attachmentsTable.extractedText,
    })
    .from(attachmentsTable)
    .where(and(inArray(attachmentsTable.id, attachmentIds), eq(attachmentsTable.userId, userId)))
    // The request's order, not the table's: a message with several files sends them the same way
    // every time (prompt cache, reproducibility; DEFERRED Part C).
    .orderBy(sql`array_position(array[${sql.join(attachmentIds.map((id) => sql`${id}`), sql`, `)}]::uuid[], ${attachmentsTable.id})`);
  return rows.map(toAttachmentRef);
}

/**
 * What `GenerationService.run` needs, read back from the turn's row (D-G3-02: the seam for an
 * executor that is not the process that took the request). The prompt is the user message's own
 * text; everything else is the turn's parameters, which hold ids and enums only.
 */
export async function loadTurnInput(
  db: DbLike,
  turnId: string,
): Promise<{
  turn: TurnBinding;
  userId: string;
  chatId: string;
  messageId: string;
  prompt: string;
  mode: Mode;
  modelAlias: string;
  projectId: string | null;
  hasAttachments: boolean;
  attachments: AttachmentRef[];
  codeExecution: boolean;
  effort?: ReasoningEffort;
  styleId?: string;
  clientPlatform?: 'mobile' | 'desktop';
}> {
  const [row] = await db.select().from(turns).where(eq(turns.id, turnId)).limit(1);
  if (!row) throw notFound('turn');
  const p: TurnParams = row.params;
  let prompt = '';
  if (row.userMessageId) {
    const [user] = await db.select({ text: messages.text }).from(messages).where(eq(messages.id, row.userMessageId)).limit(1);
    prompt = user?.text ?? '';
  }
  const [held] = await db
    .select()
    .from(budgetReservations)
    .where(and(eq(budgetReservations.turnId, row.id), eq(budgetReservations.status, 'held')))
    .orderBy(desc(budgetReservations.createdAt))
    .limit(1);
  return {
    turn: { turnId: row.id, fencingToken: row.fencingToken, reservation: held ? reservationRef(held) : null },
    userId: row.userId,
    chatId: row.chatId,
    messageId: row.assistantMessageId,
    prompt,
    mode: p.mode,
    modelAlias: p.modelAlias,
    projectId: p.projectId,
    hasAttachments: p.attachmentIds.length > 0,
    attachments: await loadTurnAttachments(db, row.userId, p.attachmentIds),
    codeExecution: p.codeExecution,
    ...(p.effort ? { effort: p.effort } : {}),
    ...(p.styleId ? { styleId: p.styleId } : {}),
    ...(p.clientPlatform ? { clientPlatform: p.clientPlatform } : {}),
  };
}

/** The turn behind an assistant message, newest first (a regenerated message has several). */
export async function latestTurnOfChat(db: DbLike, chatId: string): Promise<TurnRow | null> {
  const [row] = await db.select().from(turns).where(eq(turns.chatId, chatId)).orderBy(desc(turns.createdAt)).limit(1);
  return row ?? null;
}

/** Records the model a turn resolved to, so a takeover can write its usage row. Fenced. */
export async function recordResolvedModel(
  db: DbLike,
  binding: TurnBinding,
  resolved: NonNullable<TurnParams['resolved']>,
): Promise<void> {
  await db
    .update(turns)
    .set({ params: sql`${turns.params} || ${JSON.stringify({ resolved })}::jsonb` })
    .where(and(eq(turns.id, binding.turnId), eq(turns.fencingToken, binding.fencingToken)));
}
