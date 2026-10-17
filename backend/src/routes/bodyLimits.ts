/**
 * Per-route body limits (Stage 4 C4, P21, ADR-0082).
 *
 * Every route takes at most `API_BODY_LIMIT_BYTES` (1 MiB, ours) unless it sets its own here.
 * Before P21 the one global limit was the upload limit (MAX_UPLOAD_BYTES + 1 MiB) on every route,
 * so the routes below keep a limit no request they accepted then can exceed:
 *
 * - uploads (multipart, raw bytes) keep the upload limit itself;
 * - a JSON route whose schema admits more than 1 MiB gets the worst case of its schema: a JSON
 *   string escapes one UTF-16 unit to at most six bytes (`\u0001`), plus room for the rest.
 */
import type { Config } from '../config.js';

const MIB = 1024 * 1024;
/** Room for the keys, ids and framing around a route's largest strings. */
const JSON_FRAMING_BYTES = 64 * 1024;
/** The most bytes one UTF-16 unit of a JSON string can take (`\u0000`-style escape). */
const JSON_BYTES_PER_UNIT = 6;

/** The worst-case JSON body of a route whose strings total at most `units` UTF-16 units. */
export function jsonBodyLimit(units: number): number {
  return units * JSON_BYTES_PER_UNIT + JSON_FRAMING_BYTES;
}

/** A multipart or raw upload: the file limit plus 1 MiB of framing (the pre-P21 global limit). */
export function uploadBodyLimit(cfg: Pick<Config, 'MAX_UPLOAD_BYTES'>): number {
  return cfg.MAX_UPLOAD_BYTES + MIB;
}
