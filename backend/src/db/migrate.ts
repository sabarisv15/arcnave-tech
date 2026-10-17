/**
 * Migration runner.
 *
 * Applies the SQL files drizzle-kit generated in ./drizzle. Run as its own process (by
 * `npm run db:migrate`, and by the container entrypoint before the server starts). The
 * entrypoint starts the server only when this exits 0, so a failed migration stops the new
 * revision instead of leaving it serving traffic on the old schema (ADR-0065, Stage 19 ID-13).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { errorLogFields } from '../errorLog.js';

/**
 * Session advisory lock taken around every run (ours: any constant no other code uses).
 * Cloud Run starts several instances of a new revision at once and each runs this; drizzle's
 * migrator takes no lock of its own (drizzle-orm 0.45 `PgDialect.migrate`), so without this the
 * instances raced the same CREATE TABLE (mistakes.md 2026-09-18). The second instance waits, then
 * finds nothing left to apply.
 */
export const MIGRATION_LOCK_KEY = 72_430_065;

export async function runMigrations(databaseUrl: string, socketPath?: string): Promise<void> {
  // A dedicated single connection, so the advisory lock and the DDL are on the same session.
  // Built independently of db/client.ts's pool, so it needs the same Cloud SQL socket override
  // (see the comment on DB_SOCKET_PATH in config.ts) applied here too.
  const sql = postgres(databaseUrl, {
    max: 1,
    onnotice: () => {},
    ...(socketPath ? { host: socketPath } : {}),
  });
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
    } finally {
      // benign: the advisory lock ends with the connection, closed just below
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => undefined);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isMain = process.argv[1]?.includes('migrate');

if (isMain) {
  const cfg = config();
  runMigrations(cfg.DATABASE_URL, cfg.DB_SOCKET_PATH)
    .then(() => {
      logger.info('migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      // Type and code only: a failed statement's text and parameters stay out of the logs.
      logger.fatal(errorLogFields(err), 'migration failed');
      process.exit(1);
    });
}
