/**
 * One cost, rupees first and dollars second: `₹12.32 · $0.1400`.
 *
 * Null is not zero. A null figure is left out, and when both are null the result is null so the
 * caller says "not priced" (or "—") exactly as it did for a null USD cost before rupees existed.
 * A mixed case (dollars known, rupees not) shows the dollars alone: rows written before the
 * rupee column existed have no rate to convert with, and a made-up one would be a lie.
 */
export function formatCost(usd: number | null, inr: number | null): string | null {
  const parts: string[] = [];
  if (inr !== null) parts.push(`₹${inr.toFixed(2)}`);
  if (usd !== null) parts.push(`$${usd.toFixed(4)}`);
  return parts.length === 0 ? null : parts.join(" · ");
}
