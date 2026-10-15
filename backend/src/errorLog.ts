/**
 * What an error may put in a log line: its type and codes, never its text.
 *
 * A failed query is a `DrizzleQueryError` whose message and `params` carry the query's values
 * (on sign-up, the e-mail and the Argon2 hash), and the postgres.js error under `cause` can
 * carry them too (`detail`: "Key (email)=(...) already exists"). Logging the error object, even
 * through pino's `err` serialiser, writes all of that out, and logs outlive the row's delete
 * controls (Stage 17 NO_CONTENT: ids, codes, sizes, durations only).
 *
 * So only the class name, `code` / SQLSTATE and the message length are read, along the `cause`
 * chain, and each string is held to identifier shape so a value cannot ride in as a "code".
 */

const MAX_CAUSE_DEPTH = 5;
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,64}$/;

function identifier(value: unknown): string | undefined {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && IDENTIFIER.test(text) ? text : undefined;
}

export interface ErrorLogFields {
  /** Class name of the error (`DrizzleQueryError`, `PostgresError`, `TypeError`). */
  errorType: string;
  /** Its `code` when it has one: a SQLSTATE such as `23505`, or `ECONNREFUSED`. */
  errorCode?: string;
  /** The `code` of the innermost error in the `cause` chain (for Drizzle: the postgres SQLSTATE). */
  rootType?: string;
  rootCode?: string;
  /** Size only; the message itself is never logged. */
  messageLength?: number;
}

function typeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    return identifier((error as { constructor?: { name?: unknown } }).constructor?.name) ?? 'Object';
  }
  return typeof error;
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? identifier((error as { code?: unknown }).code)
    : undefined;
}

export function errorLogFields(error: unknown): ErrorLogFields {
  const fields: ErrorLogFields = { errorType: typeOf(error) };
  const code = codeOf(error);
  if (code) fields.errorCode = code;
  if (error instanceof Error) fields.messageLength = error.message.length;

  let root: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const next = typeof root === 'object' && root !== null ? (root as { cause?: unknown }).cause : undefined;
    if (next === undefined || next === null) break;
    root = next;
  }
  if (root !== error) {
    fields.rootType = typeOf(root);
    const rootCode = codeOf(root);
    if (rootCode) fields.rootCode = rootCode;
  }
  return fields;
}
