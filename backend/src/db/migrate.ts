/**
 * Migration runner.
 *
 * Applies the SQL files drizzle-kit generated in ./drizzle. Run as its own process (by
 * `npm run db:migrate`, and by the container entrypoint before the server starts) so a
 * failed migration stops the deploy rather than leaving a half-migrated database serving
 * traffic.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { config } from '../config.js';
import { logger } from '../logger.js';

export async function runMigrations(databaseUrl: string): Promise<void> {
  // A dedicated single connection: the migrator takes advisory locks, and running it through
  // the shared pool risks the lock landing on a different connection than the DDL.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isMain = process.argv[1]?.includes('migrate');

if (isMain) {
  const cfg = config();
  runMigrations(cfg.DATABASE_URL)
    .then(() => {
      logger.info('migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      logger.fatal({ err }, 'migration failed');
      process.exit(1);
    });
}
