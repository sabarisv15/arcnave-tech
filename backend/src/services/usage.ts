/**
 * Token accounting, budgets, and aggregation.
 *
 * Two rules this module exists to enforce:
 *
 * 1. **Exact means exact.** Token counts are written only from provider metadata. When a
 *    provider returns nothing, the record stores zeros with `tokensExact: false`, and the API
 *    surfaces that flag. There is deliberately no estimator in this file.
 *
 * 2. **Budgets are reserved before the call, not checked after it.** A plain "sum, then
 *    decide" races: two concurrent requests both read headroom only one of them has.
 *    Reservation takes a row lock on the counter, so concurrent requests serialise on it.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';

import type { Config } from '../config.js';
import type { Database, Transaction } from '../db/client.js';
import { usageCounters, usageRecords } from '../db/schema.js';
import { ApiError } from '../errors.js';
import type { ProviderUsage } from '../providers/types.js';
import { totalTokens } from '../providers/types.js';

export type PeriodKind = 'day' | 'month';

export interface BudgetPrefs {
  dailyTokenBudget: number | null;
  monthlyTokenBudget: number | null;
  warnThresholdPct: number;
  timezone: string;
}

/* -------------------------------------------------------------------------- time */

function isValidZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function resolveZone(name: string): string {
  return isValidZone(name) ? name : 'UTC';
}

/** The calendar parts of `instant` as seen in `timeZone`. */
function zonedParts(instant: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** The UTC offset, in minutes, that `timeZone` was at `instant`. */
function offsetMinutes(instant: Date, timeZone: string): number {
  // Formatting the instant in the zone and re-reading it as UTC yields the offset. This is
  // the standard trick that avoids shipping a full tz database.
  const asUtc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asZone = new Date(instant.toLocaleString('en-US', { timeZone }));
  return Math.round((asZone.getTime() - asUtc.getTime()) / 60000);
}

/** Midnight local to `timeZone` on the given calendar date, expressed as a UTC instant. */
function zonedMidnightUtc(y: number, m: number, d: number, timeZone: string): Date {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  // Two passes: the first offset may be wrong across a DST boundary, the second settles it.
  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60000);
  return guess;
}

/**
 * Start of the user's local day and month, as UTC instants.
 *
 * Budgets reset on the user's calendar, not the server's; a UTC-midnight reset is wrong for
 * everyone outside UTC and especially surprising at month boundaries.
 */
export function periodBounds(now: Date, timezone: string): { dayStart: Date; monthStart: Date } {
  const tz = resolveZone(timezone);
  const { y, m, d } = zonedParts(now, tz);
  return {
    dayStart: zonedMidnightUtc(y, m, d, tz),
    monthStart: zonedMidnightUtc(y, m, 1, tz),
  };
}

export function nextReset(now: Date, timezone: string): { nextDay: Date; nextMonth: Date } {
  const tz = resolveZone(timezone);
  const { y, m, d } = zonedParts(now, tz);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const nextDay =
    d < daysInMonth
      ? zonedMidnightUtc(y, m, d + 1, tz)
      : m < 12
        ? zonedMidnightUtc(y, m + 1, 1, tz)
        : zonedMidnightUtc(y + 1, 1, 1, tz);
  const nextMonth =
    m < 12 ? zonedMidnightUtc(y, m + 1, 1, tz) : zonedMidnightUtc(y + 1, 1, 1, tz);
  return { nextDay, nextMonth };
}

/* -------------------------------------------------------------------------- cost */

/**
 * USD cost, or null when no verified pricing row exists for this model.
 *
 * Null rather than 0 matters: the UI must distinguish "this cost nothing" from "we have no
 * price for this model". Usage with `exact: false` is never priced.
 */
export function computeCost(
  cfg: Config,
  providerModelId: string,
  usage: ProviderUsage,
): number | null {
  const row = cfg.PRICING_TABLE[providerModelId];
  if (!row || !usage.exact) return null;
  const perMillion = 1_000_000;
  const cost =
    (usage.inputTokens * row.input +
      usage.outputTokens * row.output +
      usage.cacheReadTokens * row.cacheRead +
      usage.cacheWriteTokens * row.cacheWrite) /
    perMillion;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * INR figure for a USD cost at the planning rate (N-37), or null when the USD cost is null.
 *
 * It multiplies the USD figure that is stored, so the two columns can never disagree about
 * which call was priced. No price means no rupee figure either: null is not zero.
 */
export function usdToInr(cfg: Config, costUsd: number | null): number | null {
  if (costUsd === null) return null;
  return Math.round(costUsd * cfg.PRICING_INR_PER_USD * 1e6) / 1e6;
}

/**
 * SQL for a summed rupee cost. Null when nothing is priced, and also null when any priced
 * (USD) row has no rupee figure, which is every row written before `cost_inr` existed: a sum
 * that skipped them would understate the spend beside a USD sum that includes them.
 */
const sumCostInr = sql<number | null>`case
  when count(*) filter (where ${usageRecords.costUsd} is not null and ${usageRecords.costInr} is null) > 0 then null
  else sum(${usageRecords.costInr})
end`;

const roundCost = (v: unknown): number | null =>
  v == null ? null : Math.round(Number(v) * 1e6) / 1e6;

/* -------------------------------------------------------------------------- budgets */

export class BudgetExceededError extends ApiError {
  constructor(period: 'daily' | 'monthly', used: number, limit: number) {
    super('budget_exceeded', {
      detail:
        `This request would exceed your ${period} token budget ` +
        `(${used.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')} used). ` +
        'Raise or clear the limit in Settings under Usage & limits.',
      meta: { period, used, limit },
    });
  }
}

export interface BudgetState {
  dailyUsed: number;
  dailyLimit: number | null;
  dailyPct: number | null;
  monthlyUsed: number;
  monthlyLimit: number | null;
  monthlyPct: number | null;
  warnThresholdPct: number;
  warnings: string[];
}

function pct(used: number, limit: number | null): number | null {
  if (!limit) return null;
  return Math.round((used / limit) * 1000) / 10;
}

/* -------------------------------------------------------------------------- service */

export class UsageService {
  constructor(
    private readonly db: Database,
    private readonly cfg: Config,
  ) {}

  /**
   * Fetch-or-create the counter row and hold a write lock on it.
   *
   * The insert is ON CONFLICT DO NOTHING so two requests creating the same period
   * concurrently neither deadlock nor raise; whichever loses simply re-selects.
   * Must be called inside a transaction for the lock to mean anything.
   */
  private async counterForUpdate(
    tx: Transaction,
    userId: string,
    kind: PeriodKind,
    periodStart: Date,
  ): Promise<{ id: string; tokensUsed: number; tokensReserved: number }> {
    const select = async (): Promise<
      { id: string; tokensUsed: number; tokensReserved: number } | undefined
    > => {
      const rows = await tx
        .select({
          id: usageCounters.id,
          tokensUsed: usageCounters.tokensUsed,
          tokensReserved: usageCounters.tokensReserved,
        })
        .from(usageCounters)
        .where(
          and(
            eq(usageCounters.userId, userId),
            eq(usageCounters.periodKind, kind),
            eq(usageCounters.periodStart, periodStart),
          ),
        )
        .for('update')
        .limit(1);
      return rows[0];
    };

    const existing = await select();
    if (existing) return existing;

    await tx
      .insert(usageCounters)
      .values({ userId, periodKind: kind, periodStart })
      .onConflictDoNothing();

    const created = await select();
    if (!created) throw new ApiError('internal_error', { detail: 'Could not open a usage counter.' });
    return created;
  }

  private budgetPairs(prefs: BudgetPrefs, now: Date): Array<[PeriodKind, Date, number | null]> {
    const { dayStart, monthStart } = periodBounds(now, prefs.timezone);
    return [
      ['day', dayStart, prefs.dailyTokenBudget],
      ['month', monthStart, prefs.monthlyTokenBudget],
    ];
  }

  /**
   * Block before calling the provider if the budget is already spent.
   *
   * `reservation` is not an accounting figure. It is the configured output ceiling — the most
   * this request could cost — held against the counter until `record` replaces it with the
   * provider's real numbers. It is never written to a usage record or shown as a measurement.
   */
  async reserve(userId: string, prefs: BudgetPrefs, reservation: number): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const [kind, periodStart, limit] of this.budgetPairs(prefs, now)) {
        if (!limit) continue;
        const counter = await this.counterForUpdate(tx, userId, kind, periodStart);
        const committed = counter.tokensUsed + counter.tokensReserved;
        if (committed >= limit) {
          throw new BudgetExceededError(kind === 'day' ? 'daily' : 'monthly', committed, limit);
        }
        await tx
          .update(usageCounters)
          .set({ tokensReserved: sql`${usageCounters.tokensReserved} + ${reservation}` })
          .where(eq(usageCounters.id, counter.id));
      }
    });
  }

  /** Give back a reservation. Always paired with `reserve` in a finally block. */
  async release(userId: string, prefs: BudgetPrefs, reservation: number): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      for (const [kind, periodStart, limit] of this.budgetPairs(prefs, now)) {
        if (!limit) continue;
        const counter = await this.counterForUpdate(tx, userId, kind, periodStart);
        await tx
          .update(usageCounters)
          .set({
            tokensReserved: sql`greatest(0, ${usageCounters.tokensReserved} - ${reservation})`,
          })
          .where(eq(usageCounters.id, counter.id));
      }
    });
  }

  private async commitTokens(
    userId: string,
    prefs: BudgetPrefs,
    tokens: number,
    at: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { dayStart, monthStart } = periodBounds(at, prefs.timezone);
      for (const [kind, periodStart] of [
        ['day', dayStart],
        ['month', monthStart],
      ] as Array<[PeriodKind, Date]>) {
        const counter = await this.counterForUpdate(tx, userId, kind, periodStart);
        await tx
          .update(usageCounters)
          .set({ tokensUsed: sql`${usageCounters.tokensUsed} + ${tokens}` })
          .where(eq(usageCounters.id, counter.id));
      }
    });
  }

  /**
   * Persist one generation attempt.
   *
   * Called for completions, cancellations, and errors alike: a cancelled request that already
   * burned input tokens must still show them, or the usage row understates real spend.
   */
  async record(input: {
    userId: string;
    prefs: BudgetPrefs;
    requestId: string;
    chatId: string | null;
    messageId: string | null;
    projectId: string | null;
    modelAlias: string;
    provider: string;
    providerModelId: string;
    usage: ProviderUsage;
    startedAt: Date;
    status: 'complete' | 'cancelled' | 'error' | 'blocked';
    finishReason?: string | null;
    errorCode?: string | null;
  }): Promise<void> {
    const completedAt = new Date();
    const total = totalTokens(input.usage);

    const costUsd = computeCost(this.cfg, input.providerModelId, input.usage);

    await this.db.insert(usageRecords).values({
      userId: input.userId,
      requestId: input.requestId,
      chatId: input.chatId,
      messageId: input.messageId,
      projectId: input.projectId,
      modelAlias: input.modelAlias,
      provider: input.provider,
      providerModelId: input.providerModelId,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      totalTokens: total,
      cacheReadTokens: input.usage.cacheReadTokens,
      cacheWriteTokens: input.usage.cacheWriteTokens,
      tokensExact: input.usage.exact,
      contextTokens: input.usage.exact && input.usage.lastRequest
        ? input.usage.lastRequest.inputTokens + input.usage.lastRequest.outputTokens
        : null,
      startedAt: input.startedAt,
      completedAt,
      latencyMs: completedAt.getTime() - input.startedAt.getTime(),
      finishReason: input.finishReason ?? null,
      status: input.status,
      errorCode: input.errorCode ?? null,
      costUsd,
      costInr: usdToInr(this.cfg, costUsd),
    });

    if (total > 0) {
      await this.commitTokens(input.userId, input.prefs, total, completedAt);
    }
  }

  /* ------------------------------------------------------------------ queries */

  private async sumSince(userId: string, since: Date | null): Promise<number> {
    const where = since
      ? and(eq(usageRecords.userId, userId), gte(usageRecords.startedAt, since))
      : eq(usageRecords.userId, userId);
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${usageRecords.totalTokens}), 0)::int` })
      .from(usageRecords)
      .where(where);
    return rows[0]?.total ?? 0;
  }

  async budgetState(userId: string, prefs: BudgetPrefs): Promise<BudgetState> {
    const { dayStart, monthStart } = periodBounds(new Date(), prefs.timezone);
    const dailyUsed = await this.sumSince(userId, dayStart);
    const monthlyUsed = await this.sumSince(userId, monthStart);
    const dailyPct = pct(dailyUsed, prefs.dailyTokenBudget);
    const monthlyPct = pct(monthlyUsed, prefs.monthlyTokenBudget);
    const warnings: string[] = [];
    if (dailyPct !== null && dailyPct >= prefs.warnThresholdPct) warnings.push('daily_threshold');
    if (monthlyPct !== null && monthlyPct >= prefs.warnThresholdPct) {
      warnings.push('monthly_threshold');
    }
    return {
      dailyUsed,
      dailyLimit: prefs.dailyTokenBudget,
      dailyPct,
      monthlyUsed,
      monthlyLimit: prefs.monthlyTokenBudget,
      monthlyPct,
      warnThresholdPct: prefs.warnThresholdPct,
      warnings,
    };
  }

  private async totals(userId: string, since: Date | null): Promise<UsageTotals> {
    const where = since
      ? and(eq(usageRecords.userId, userId), gte(usageRecords.startedAt, since))
      : eq(usageRecords.userId, userId);
    const rows = await this.db
      .select({
        inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)::int`,
        totalTokens: sql<number>`coalesce(sum(${usageRecords.totalTokens}), 0)::int`,
        cacheReadTokens: sql<number>`coalesce(sum(${usageRecords.cacheReadTokens}), 0)::int`,
        cacheWriteTokens: sql<number>`coalesce(sum(${usageRecords.cacheWriteTokens}), 0)::int`,
        // Deliberately not coalesced to 0: null means "nothing priced", not "free".
        costUsd: sql<number | null>`sum(${usageRecords.costUsd})`,
        costInr: sumCostInr,
        requests: sql<number>`count(*)::int`,
      })
      .from(usageRecords)
      .where(where);
    const row = rows[0];
    return {
      inputTokens: row?.inputTokens ?? 0,
      outputTokens: row?.outputTokens ?? 0,
      totalTokens: row?.totalTokens ?? 0,
      cacheReadTokens: row?.cacheReadTokens ?? 0,
      cacheWriteTokens: row?.cacheWriteTokens ?? 0,
      costUsd: roundCost(row?.costUsd),
      costInr: roundCost(row?.costInr),
      requests: row?.requests ?? 0,
    };
  }

  private async grouped(
    userId: string,
    column: typeof usageRecords.modelAlias | typeof usageRecords.projectId,
  ): Promise<UsageGroup[]> {
    const rows = await this.db
      .select({
        key: column,
        inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)::int`,
        totalTokens: sql<number>`coalesce(sum(${usageRecords.totalTokens}), 0)::int`,
        costUsd: sql<number | null>`sum(${usageRecords.costUsd})`,
        costInr: sumCostInr,
        requests: sql<number>`count(*)::int`,
      })
      .from(usageRecords)
      .where(eq(usageRecords.userId, userId))
      .groupBy(column)
      .orderBy(desc(sql`coalesce(sum(${usageRecords.totalTokens}), 0)`));

    return rows.map((r) => ({
      key: r.key === null ? null : String(r.key),
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      costUsd: roundCost(r.costUsd),
      costInr: roundCost(r.costInr),
      requests: r.requests,
    }));
  }

  async summary(
    userId: string,
    prefs: BudgetPrefs & { maxOutputTokens: number },
  ): Promise<UsageSummary> {
    const now = new Date();
    const { dayStart, monthStart } = periodBounds(now, prefs.timezone);
    const { nextDay, nextMonth } = nextReset(now, prefs.timezone);
    const state = await this.budgetState(userId, prefs);

    return {
      today: await this.totals(userId, dayStart),
      month: await this.totals(userId, monthStart),
      allTime: await this.totals(userId, null),
      byModel: await this.grouped(userId, usageRecords.modelAlias),
      byProject: await this.grouped(userId, usageRecords.projectId),
      limits: {
        maxOutputTokens: prefs.maxOutputTokens,
        dailyTokenBudget: prefs.dailyTokenBudget,
        monthlyTokenBudget: prefs.monthlyTokenBudget,
        warnThresholdPct: prefs.warnThresholdPct,
        timezone: resolveZone(prefs.timezone),
        dailyUsed: state.dailyUsed,
        monthlyUsed: state.monthlyUsed,
        dailyPct: state.dailyPct,
        monthlyPct: state.monthlyPct,
        warnings: state.warnings,
        dailyResetsAt: nextDay.toISOString(),
        monthlyResetsAt: nextMonth.toISOString(),
      },
      pricingConfigured: Object.keys(this.cfg.PRICING_TABLE).length > 0,
    };
  }

  async exportRows(userId: string, since: Date | null): Promise<UsageRow[]> {
    const where = since
      ? and(eq(usageRecords.userId, userId), gte(usageRecords.startedAt, since))
      : eq(usageRecords.userId, userId);
    return this.db
      .select()
      .from(usageRecords)
      .where(where)
      .orderBy(desc(usageRecords.startedAt));
  }
}

/* -------------------------------------------------------------------------- shapes */

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
  /** `costUsd` at the planning rate (N-37); null when nothing in the window has a rupee figure. */
  costInr: number | null;
  requests: number;
}

export interface UsageGroup extends Omit<UsageTotals, 'cacheReadTokens' | 'cacheWriteTokens'> {
  key: string | null;
}

export interface UsageSummary {
  today: UsageTotals;
  month: UsageTotals;
  allTime: UsageTotals;
  byModel: UsageGroup[];
  byProject: UsageGroup[];
  limits: {
    maxOutputTokens: number;
    dailyTokenBudget: number | null;
    monthlyTokenBudget: number | null;
    warnThresholdPct: number;
    timezone: string;
    dailyUsed: number;
    monthlyUsed: number;
    dailyPct: number | null;
    monthlyPct: number | null;
    warnings: string[];
    dailyResetsAt: string;
    monthlyResetsAt: string;
  };
  pricingConfigured: boolean;
}

export type UsageRow = typeof usageRecords.$inferSelect;
