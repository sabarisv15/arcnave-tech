/**
 * Coded, allowlisted log lines (Stage 17 LG-1 / LG-3, OD-8; ADR-0079). A line is a stable code
 * plus fields from one allowlist; `logEvent` drops every field that is not on it, so a caller
 * that passes a prompt, a file name or a reply by mistake logs nothing of it (Stage 17
 * NO_CONTENT: ids, codes, sizes, durations only).
 *
 * The list is the contract: a new field is an allowlist addition, reviewed as one. No name on it
 * may look like a content field (`logEvent.test.ts` checks the list against
 * prompt|text|content|query|title|filename|email). `gateway_*` codes are reserved for P11.
 */
import type { Logger } from 'pino';

export const LOG_CODES = {
  /** One per model call, as the ledger stores it (LG-1). */
  model_call: 'model_call',
  /** One per turn, replacing the old "turn timing" line (LG-3). */
  chat_turn_finished: 'chat_turn_finished',
  retention_sweep: 'retention_sweep',
  deletion_ledger: 'deletion_ledger',
} as const;
export type LogCode = keyof typeof LOG_CODES;

/** Fields whose values are scalars: ids, codes, enums, counts, durations, money. */
export const FIELD_ALLOWLIST = [
  // ids
  'turnId',
  'chatId',
  'messageId',
  'requestId',
  'usageRecordId',
  'subjectId',
  // codes and enums
  'status',
  'finishCode',
  'finishReason',
  'errorCode',
  'role',
  'provider',
  'providerModelId',
  'modelAlias',
  'model',
  'effort',
  'requestedEffort',
  'outcome',
  'usageSource',
  'trafficTier',
  'priceVersion',
  'providerRefType',
  'providerRef',
  'kind',
  'phase',
  'compacted',
  'probed',
  'skipped',
  'tokensExact',
  // counts and sizes
  'ordinal',
  'attempt',
  'callCount',
  'toolCalls',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'chatsPurged',
  'uploadsPurged',
  'checkpointsPurged',
  'objectsDeleted',
  'rowsDeleted',
  // money
  'costUsd',
  'costInr',
  'fxInrPerUsd',
  // clocks (OD-8)
  'providerTtftMs',
  'firstVisibleMs',
  'turnTotalMs',
  'outputTps',
  'durationMs',
  'totalMs',
  // maps of phase name -> milliseconds; only numeric entries are kept
  'phasesMs',
  'streamMs',
] as const;
export type AllowedField = (typeof FIELD_ALLOWLIST)[number];

const ALLOWED = new Set<string>(FIELD_ALLOWLIST);
const NUMERIC_MAPS = new Set<string>(['phasesMs', 'streamMs']);
/** A string field is a code or an id: never longer than this. */
const MAX_STRING = 128;

/** The fields of a line, as written: allowlisted keys, scalar values (maps of numbers for the two map fields). */
export function allowlisted(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key) || value === undefined) continue;
    if (NUMERIC_MAPS.has(key)) {
      if (!value || typeof value !== 'object') continue;
      const map: Record<string, number> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'number' && /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k)) map[k] = v;
      }
      out[key] = map;
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, MAX_STRING);
    }
  }
  return out;
}

/** Writes one coded line: `{ code, ...allowlisted fields }`, message = the code. */
export function logEvent(
  log: Pick<Logger, 'info' | 'warn'>,
  code: LogCode,
  fields: Record<string, unknown>,
  level: 'info' | 'warn' = 'info',
): void {
  log[level]({ code: LOG_CODES[code], ...allowlisted(fields) }, LOG_CODES[code]);
}
