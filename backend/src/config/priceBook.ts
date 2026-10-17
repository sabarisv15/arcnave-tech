/**
 * The price book (N-36; Stage 18 CD-1, Stage 5 TF; ADR-0079): what one million tokens of each
 * kind cost on each model, from a date, as dated code rows. A price change is a new row with a
 * later `effectiveFrom` and the old row's `effectiveTo` set to that date, never an edit of a
 * row already used: a call is priced by the row in effect when it was made, and `price_version`
 * on its ledger row names that row.
 *
 * Rules the rows keep (`priceBook.test.ts`):
 * - No two rows of one model, token type and tier overlap in time.
 * - A rate nobody verified has no row. A call that used tokens of a type with no row has no
 *   price (`costUsd` null, Invariant 2), never a zero.
 * - `source` names where the figure was read; it is reference text and never shown to a user.
 *
 * The `price_table` in the database mirrors these rows at boot (`services/pricing.ts`).
 */

export const TOKEN_TYPES = ['input', 'output', 'cache_read', 'cache_write_5m'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/** The only tier ArcNave buys today (no batch, no priority, no fast mode). */
export type TrafficTier = 'standard';

export interface PriceRow {
  providerModelId: string;
  tokenType: TokenType;
  trafficTier: TrafficTier;
  /** US dollars per million tokens. */
  usdPerMTok: number;
  /** First instant the rate applies (UTC). */
  effectiveFrom: string;
  /** First instant it no longer applies; null while it is current. */
  effectiveTo: string | null;
  /** Stable name of the rate set this row belongs to; stored on every priced call. */
  priceVersion: string;
  source: string;
}

const DOC_SYNC = 'Stage 18 checkpoint doc-sync 2026-10-10 (first-party Claude API), as copied in .env.example';
const GEMINI_LIST = 'N-36 list rate, owner decision 2026-10-15 (worst-case planning; the 2026 promo is booked as a credit, not a price)';
const HAIKU = 'claude-api skill (cached 2026-10-06), models.md + model-migration.md "Migrating to Claude Haiku 5.5": $0.10 / $0.50 for prompts <= 100K tokens; cache read 0.1x input, 5-minute write 1.25x';

function rates(
  providerModelId: string,
  effectiveFrom: string,
  priceVersion: string,
  source: string,
  usd: Partial<Record<TokenType, number>>,
): PriceRow[] {
  return TOKEN_TYPES.filter((t) => usd[t] !== undefined).map((tokenType) => ({
    providerModelId,
    tokenType,
    trafficTier: 'standard' as const,
    usdPerMTok: usd[tokenType]!,
    effectiveFrom,
    effectiveTo: null,
    priceVersion,
    source,
  }));
}

/**
 * The rows. Keys are provider model ids, as the registry sends them. Gemini bills no per-token
 * cache write (its explicit-cache storage charge is per token-hour and is not modelled), and the
 * adapter never reports a cache-write count, so it has no `cache_write_5m` row: a write count
 * would come out unpriced rather than free.
 *
 * Claude Haiku 5.5 (P13's helper calls): only the <= 100K-token-prompt card. Helper inputs are
 * capped well below it (P13: 30K); a longer prompt is priced at the other card, which is not
 * modelled here, so such a call would be mispriced. The ledger refuses that case by pricing a
 * Haiku call with more than 100K prompt tokens as null (`services/pricing.ts`).
 */
export const PRICE_BOOK: readonly PriceRow[] = [
  ...rates('claude-sonnet-5-5', '2026-10-10T00:00:00.000Z', 'claude-sonnet-5-5@2026-10-10', DOC_SYNC, {
    input: 2,
    output: 10,
    cache_read: 0.1,
    cache_write_5m: 2.5,
  }),
  ...rates('claude-opus-5-5', '2026-10-10T00:00:00.000Z', 'claude-opus-5-5@2026-10-10', DOC_SYNC, {
    input: 4,
    output: 20,
    cache_read: 0.2,
    cache_write_5m: 5,
  }),
  ...rates('gemini-3.8-flash', '2026-10-11T00:00:00.000Z', 'gemini-3.8-flash@2026-10-11-list', GEMINI_LIST, {
    input: 1.5,
    output: 7.5,
    cache_read: 0.15,
  }),
  ...rates('claude-haiku-5-5', '2026-10-06T00:00:00.000Z', 'claude-haiku-5-5@2026-10-06-le100k', HAIKU, {
    input: 0.1,
    output: 0.5,
    cache_read: 0.01,
    cache_write_5m: 0.125,
  }),
];

/** Prompt tokens above which a model's book rows do not apply (its other rate card). */
export const PROMPT_TIER_LIMIT: Readonly<Record<string, number>> = {
  'claude-haiku-5-5': 100_000,
};

/** The row for one token type in effect at `at`, or undefined. */
export function rowAt(
  book: readonly PriceRow[],
  providerModelId: string,
  tokenType: TokenType,
  at: Date,
  trafficTier: TrafficTier = 'standard',
): PriceRow | undefined {
  const t = at.getTime();
  return book.find(
    (r) =>
      r.providerModelId === providerModelId &&
      r.tokenType === tokenType &&
      r.trafficTier === trafficTier &&
      Date.parse(r.effectiveFrom) <= t &&
      (r.effectiveTo === null || t < Date.parse(r.effectiveTo)),
  );
}

/** Pairs of rows that overlap in time for the same model, token type and tier (should be none). */
export function overlaps(book: readonly PriceRow[]): Array<[PriceRow, PriceRow]> {
  const out: Array<[PriceRow, PriceRow]> = [];
  for (let i = 0; i < book.length; i += 1) {
    for (let j = i + 1; j < book.length; j += 1) {
      const a = book[i]!;
      const b = book[j]!;
      if (a.providerModelId !== b.providerModelId || a.tokenType !== b.tokenType || a.trafficTier !== b.trafficTier) continue;
      const aEnd = a.effectiveTo === null ? Infinity : Date.parse(a.effectiveTo);
      const bEnd = b.effectiveTo === null ? Infinity : Date.parse(b.effectiveTo);
      if (Date.parse(a.effectiveFrom) < bEnd && Date.parse(b.effectiveFrom) < aEnd) out.push([a, b]);
    }
  }
  return out;
}
