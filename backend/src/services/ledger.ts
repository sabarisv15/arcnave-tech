/**
 * The model-call ledger (Stage 4 E19, Stage 17 OD-13 / LG-1, Stage 5 TF; ADR-0079): one
 * `model_calls` row per provider request, written in the turn's settle transaction beside the
 * turn's `usage_records` row, which is their sum. Each call is priced on its own, at the rate in
 * effect when it was made; one `model_call` log line per row, ids and counts only.
 *
 * `model_calls` is partitioned by month (migration 0031). `ensureLedgerPartitions` creates this
 * month's and next month's partitions; a row outside them lands in the DEFAULT partition rather
 * than failing a settle.
 */
import { sql } from 'drizzle-orm';

import type { Database, DbLike, Transaction } from '../db/client.js';
import { modelCalls } from '../db/schema.js';
import { logger } from '../logger.js';
import { logEvent } from '../observability/logEvent.js';
import type { CallUsage, ProviderUsage } from '../providers/types.js';
import type { PricingService } from './pricing.js';

const log = logger.child({ module: 'ledger' });

/** The turn a set of calls belongs to. */
export interface TurnRef {
  usageRecordId: string | null;
  turnId: string | null;
  userId: string;
  chatId: string | null;
  messageId: string | null;
  provider: string;
  /** The default `startedAt` of a call that does not carry its own. */
  startedAt: Date;
}

/** A priced call, as it was written. */
export interface PricedCall extends CallUsage {
  costUsd: number | null;
  costInr: number | null;
  priceVersion: string | null;
}

function outcomeOf(call: CallUsage): 'ok' | 'partial' | 'no_usage' | 'error' {
  if (call.finishReason === 'error') return 'error';
  if (call.usageSource === 'provider_partial') return 'partial';
  if (call.usageSource === 'none') return 'no_usage';
  return 'ok';
}

/** A turn's totals from its priced calls: counts summed, cost summed, null if any call is unpriced. */
export function turnTotals(calls: readonly PricedCall[]): { costUsd: number | null; priceVersion: string | null } {
  if (calls.length === 0) return { costUsd: null, priceVersion: null };
  if (calls.some((c) => c.costUsd === null)) return { costUsd: null, priceVersion: null };
  const costUsd = Math.round(calls.reduce((n, c) => n + c.costUsd!, 0) * 1e6) / 1e6;
  const versions = [...new Set(calls.map((c) => c.priceVersion))];
  return { costUsd, priceVersion: versions.length === 1 ? versions[0]! : 'mixed' };
}

export class LedgerService {
  constructor(private readonly pricing: PricingService) {}

  /** Each call with its price, at its own start time. */
  priceCalls(calls: readonly CallUsage[], fallbackAt: Date): PricedCall[] {
    return calls.map((c) => {
      const { costUsd, priceVersion } = this.pricing.price(c.providerModelId, c.usage, c.startedAt ?? fallbackAt);
      return { ...c, costUsd, costInr: this.pricing.inr(costUsd), priceVersion };
    });
  }

  /**
   * Writes the calls of one turn (or one helper job) inside `tx`. Returns them priced, so the
   * caller's turn row is their sum. No calls, no rows.
   */
  async recordCalls(tx: Transaction | DbLike, turn: TurnRef, calls: readonly CallUsage[] | readonly PricedCall[]): Promise<PricedCall[]> {
    if (calls.length === 0) return [];
    // Calls priced by the caller (the turn row is their sum) are written as priced.
    const priced = calls.every((c) => 'costUsd' in c) ? (calls as readonly PricedCall[]) : this.priceCalls(calls, turn.startedAt);
    await tx.insert(modelCalls).values(
      priced.map((c) => ({
        startedAt: c.startedAt ?? turn.startedAt,
        usageRecordId: turn.usageRecordId,
        turnId: turn.turnId,
        userId: turn.userId,
        chatId: turn.chatId,
        messageId: turn.messageId,
        ordinal: c.ordinal,
        attempt: c.attempt,
        role: c.role,
        provider: c.provider ?? turn.provider,
        providerModelId: c.providerModelId,
        providerRefType: c.providerRef?.type ?? null,
        providerRef: c.providerRef?.value.slice(0, 128) ?? null,
        finishReason: c.finishReason.slice(0, 48),
        outcome: outcomeOf(c),
        inputTokens: c.usage.inputTokens,
        outputTokens: c.usage.outputTokens,
        cacheReadTokens: c.usage.cacheReadTokens,
        cacheWriteTokens: c.usage.cacheWriteTokens,
        tokensExact: c.usage.exact,
        usageSource: c.usageSource,
        trafficTier: 'standard',
        priceVersion: c.priceVersion,
        costUsd: c.costUsd,
        costInr: c.costInr,
        fxInrPerUsd: c.costUsd === null ? null : this.pricing.fxInrPerUsd,
        providerTtftMs: c.ttftMs ?? null,
        durationMs: c.durationMs ?? null,
      })),
    );
    for (const c of priced) {
      logEvent(log, 'model_call', {
        turnId: turn.turnId,
        usageRecordId: turn.usageRecordId,
        ordinal: c.ordinal,
        attempt: c.attempt,
        role: c.role,
        provider: c.provider ?? turn.provider,
        providerModelId: c.providerModelId,
        providerRefType: c.providerRef?.type,
        providerRef: c.providerRef?.value,
        finishReason: c.finishReason,
        outcome: outcomeOf(c),
        usageSource: c.usageSource,
        tokensExact: c.usage.exact,
        inputTokens: c.usage.inputTokens,
        outputTokens: c.usage.outputTokens,
        cacheReadTokens: c.usage.cacheReadTokens,
        cacheWriteTokens: c.usage.cacheWriteTokens,
        trafficTier: 'standard',
        priceVersion: c.priceVersion,
        costUsd: c.costUsd,
        costInr: c.costInr,
        providerTtftMs: c.ttftMs,
        durationMs: c.durationMs,
      });
    }
    return [...priced];
  }
}

/** A call made of a whole turn's usage, for a provider that reported no per-call usage. */
export function callFromTurnUsage(providerModelId: string, usage: ProviderUsage, finishReason: string, role: CallUsage['role'], ordinal: number): CallUsage {
  return {
    ordinal,
    attempt: 1,
    role,
    providerModelId,
    usage,
    usageSource: usage.exact ? 'provider' : 'none',
    finishReason,
  };
}

/** The partition of `model_calls` that holds month `monthStart` (UTC). */
function partitionName(monthStart: Date): string {
  return `model_calls_y${String(monthStart.getUTCFullYear())}m${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Creates this month's and next month's `model_calls` partitions when missing (boot and the
 * retention sweep). A month whose rows already sit in the DEFAULT partition cannot be attached
 * (Postgres refuses); that is logged, and those rows stay readable where they are.
 */
export async function ensureLedgerPartitions(db: DbLike, now: Date = new Date()): Promise<string[]> {
  const created: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    const name = partitionName(from);
    try {
      // Its own transaction (or savepoint): a refused create must not abort the caller's.
      await (db as Database).transaction((sp) => sp.execute(
        sql.raw(
          `create table if not exists "${name}" partition of "model_calls" for values from ('${from.toISOString()}') to ('${to.toISOString()}')`,
        ),
      ));
      created.push(name);
    } catch (err) {
      log.warn({ partition: name, code: (err as { code?: string }).code }, 'ledger partition not created');
    }
  }
  return created;
}
