/**
 * Database client.
 *
 * One pooled `postgres.js` connection shared process-wide, wrapped by Drizzle. The pool is
 * created lazily so importing this module (which route files do) never opens a socket —
 * which is what lets unit tests import handlers without a database.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { config } from '../config.js';
import * as schema from './schema.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * A transaction handle.
 *
 * Drizzle types transactions separately from the pool (a transaction has no `$client`), so
 * helpers that must run inside one take this rather than `Database`. Typing it explicitly is
 * what stops a `FOR UPDATE` lock from being taken on a pooled connection by mistake, where it
 * would be released immediately and guarantee nothing.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Either handle, for read-only helpers that work in or out of a transaction. */
export type DbLike = Database | Transaction;

let sql: postgres.Sql | undefined;
let db: Database | undefined;

export function getSql(): postgres.Sql {
  if (!sql) {
    const cfg = config();
    sql = postgres(cfg.DATABASE_URL, {
      max: cfg.DB_POOL_MAX,
      // postgres.js parses timestamptz into Date objects by default, which is what we want;
      // but it returns `bigint` columns as strings. We use `integer` everywhere, so no
      // custom type parsers are needed.
      onnotice: () => {},
      connection: { application_name: 'arcnave-backend' },
      // A Cloud SQL Unix socket has to be the `host` option, not part of DATABASE_URL: see
      // the comment on DB_SOCKET_PATH in config.ts.
      ...(cfg.DB_SOCKET_PATH ? { host: cfg.DB_SOCKET_PATH } : {}),
      // Neon's pooled endpoint is PgBouncer in transaction-pooling mode: each transaction can
      // land on a different backend server connection, so a server-side prepared statement
      // from one transaction is not guaranteed to exist for the next. Session-scoped prepares
      // are exactly the kind of state transaction pooling does not preserve. Disabling prepare
      // costs a little query-planning overhead and makes the client correct against either
      // Neon endpoint (direct or pooled) rather than correct only by accident of which one is
      // configured today.
      prepare: false,
    });
  }
  return sql;
}

export function getDb(): Database {
  db ??= drizzle(getSql(), { schema, casing: 'snake_case' });
  return db;
}

/** Test/DI hook: run against an explicitly provided connection. */
export function setDb(instance: Database, connection?: postgres.Sql): void {
  db = instance;
  if (connection) sql = connection;
}

export async function closeDb(): Promise<void> {
  if (sql) await sql.end({ timeout: 5 });
  sql = undefined;
  db = undefined;
}

/** Liveness probe for the readiness endpoint. Cheap, and it exercises the real pool. */
export async function pingDb(): Promise<boolean> {
  try {
    await getSql()`select 1`;
    return true;
  } catch {
    return false;
  }
}

export { schema };
