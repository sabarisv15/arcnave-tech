/**
 * Prices a model call (Stage 18 CD-1, N-36; ADR-0079): the rate in effect when the call was made,
 * from the price book (`PRICE_SOURCE=book`, the default) or the legacy `PRICING_TABLE` env JSON
 * (`PRICE_SOURCE=env`).
 *
 * Null is not zero (Invariant 2). A call has no price when its counts are not exact, when its
 * model has no input or output rate at that time, or when it used tokens of a kind with no rate
 * (a Haiku cache write, say, if that row were missing). A kind it did not use needs no rate.
 */
import { sql } from 'drizzle-orm';

import type { Config } from '../config.js';
import { PRICE_BOOK, PROMPT_TIER_LIMIT, type PriceRow, type TokenType, rowAt } from '../config/priceBook.js';
import type { DbLike } from '../db/client.js';
import { priceTable } from '../db/schema.js';
import type { ProviderUsage } from '../providers/types.js';

export interface CallPrice {
  costUsd: number | null;
  /** The rate set the cost came from; null when there is no cost. */
  priceVersion: string | null;
}

const NO_PRICE: CallPrice = { costUsd: null, priceVersion: null };

/** The env JSON as book rows: in effect forever, version `env`. */
export function envRows(table: Config['PRICING_TABLE']): PriceRow[] {
  const from = '1970-01-01T00:00:00.000Z';
  return Object.entries(table).flatMap(([providerModelId, r]) =>
    (
      [
        ['input', r.input],
        ['output', r.output],
        ['cache_read', r.cacheRead],
        ['cache_write_5m', r.cacheWrite],
      ] as Array<[TokenType, number]>
    ).map(([tokenType, usdPerMTok]) => ({
      providerModelId,
      tokenType,
      trafficTier: 'standard' as const,
      usdPerMTok,
      effectiveFrom: from,
      effectiveTo: null,
      priceVersion: 'env',
      source: 'PRICING_TABLE',
    })),
  );
}

export class PricingService {
  readonly rows: readonly PriceRow[];

  constructor(
    private readonly cfg: Pick<Config, 'PRICE_SOURCE' | 'PRICING_TABLE' | 'PRICING_INR_PER_USD'>,
    book: readonly PriceRow[] = PRICE_BOOK,
  ) {
    this.rows = cfg.PRICE_SOURCE === 'env' ? envRows(cfg.PRICING_TABLE) : book;
  }

  /** Whether any model has a price at all (the usage summary's `pricingConfigured`). */
  configured(): boolean {
    return this.rows.length > 0;
  }

  /** The cost of one call's usage, at the rate in effect at `at`. */
  price(providerModelId: string, usage: ProviderUsage, at: Date = new Date()): CallPrice {
    if (!usage.exact) return NO_PRICE;
    const input = rowAt(this.rows, providerModelId, 'input', at);
    const output = rowAt(this.rows, providerModelId, 'output', at);
    if (!input || !output) return NO_PRICE;
    const limit = PROMPT_TIER_LIMIT[providerModelId];
    const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    // A prompt past the card the book holds is billed at another card: unpriced, not mispriced.
    if (limit !== undefined && prompt > limit) return NO_PRICE;
    const counts: Array<[TokenType, number]> = [
      ['input', usage.inputTokens],
      ['output', usage.outputTokens],
      ['cache_read', usage.cacheReadTokens],
      ['cache_write_5m', usage.cacheWriteTokens],
    ];
    let micro = 0;
    for (const [type, tokens] of counts) {
      if (tokens === 0) continue;
      const row = rowAt(this.rows, providerModelId, type, at);
      if (!row) return NO_PRICE;
      micro += tokens * row.usdPerMTok;
    }
    return { costUsd: Math.round((micro / 1_000_000) * 1e6) / 1e6, priceVersion: input.priceVersion };
  }

  /** The rupee figure at the planning rate (N-37); null when the dollar cost is null. */
  inr(costUsd: number | null): number | null {
    if (costUsd === null) return null;
    return Math.round(costUsd * this.cfg.PRICING_INR_PER_USD * 1e6) / 1e6;
  }

  get fxInrPerUsd(): number {
    return this.cfg.PRICING_INR_PER_USD;
  }

  /**
   * Mirrors the book into `price_table` (boot). Idempotent: a row is keyed by model, token type,
   * tier and start, and an existing one takes the code's values. The env source writes nothing:
   * its rows have no dates to keep.
   */
  async syncTable(db: DbLike): Promise<number> {
    if (this.cfg.PRICE_SOURCE !== 'book' || this.rows.length === 0) return 0;
    const values = this.rows.map((r) => ({
      providerModelId: r.providerModelId,
      tokenType: r.tokenType,
      trafficTier: r.trafficTier,
      usdPerMtok: r.usdPerMTok.toFixed(6),
      effectiveFrom: new Date(r.effectiveFrom),
      effectiveTo: r.effectiveTo === null ? null : new Date(r.effectiveTo),
      priceVersion: r.priceVersion,
      source: r.source,
    }));
    await db
      .insert(priceTable)
      .values(values)
      .onConflictDoUpdate({
        target: [priceTable.providerModelId, priceTable.tokenType, priceTable.trafficTier, priceTable.effectiveFrom],
        set: {
          usdPerMtok: sql`excluded.usd_per_mtok`,
          effectiveTo: sql`excluded.effective_to`,
          priceVersion: sql`excluded.price_version`,
          source: sql`excluded.source`,
        },
      });
    return values.length;
  }
}
