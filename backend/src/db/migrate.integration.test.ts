/**
 * Migrations fail closed and run one at a time (ADR-0065, A-10, Stage 19 ID-13).
 *
 * Each case that needs an empty schema creates its own throwaway database next to the test
 * database and drops it afterwards, so nothing here touches the shared one.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { TEST_DATABASE_URL } from '../test/harness.js';
import { MIGRATION_LOCK_KEY, runMigrations } from './migrate.js';

const BACKEND = path.resolve(__dirname, '..', '..');
const created: string[] = [];

function urlFor(database: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

const admin = postgres(urlFor('postgres'), { max: 1, onnotice: () => {} });

async function freshDatabase(): Promise<string> {
  const base = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const name = `${base}_mig_${String(process.pid)}_${String(created.length)}_${String(Date.now() % 100_000)}`;
  await admin.unsafe(`create database "${name}"`);
  created.push(name);
  return urlFor(name);
}

afterAll(async () => {
  for (const name of created) await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.end({ timeout: 5 });
});

async function journalLength(): Promise<number> {
  const journal = JSON.parse(await readFile(path.join(BACKEND, 'drizzle/meta/_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

describe('runMigrations', () => {
  it('three instances starting at once on an empty database all succeed, and each migration runs once', async () => {
    const url = await freshDatabase();
    const results = await Promise.allSettled([runMigrations(url), runMigrations(url), runMigrations(url)]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);

    const sql = postgres(url, { max: 1, onnotice: () => {} });
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from drizzle.__drizzle_migrations`;
    await sql.end({ timeout: 5 });
    expect(row?.n).toBe(await journalLength());
  }, 120_000);

  it('waits while another session holds the migration lock', async () => {
    const url = await freshDatabase();
    const holder = postgres(url, { max: 1, onnotice: () => {} });
    await holder`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;

    let done = false;
    const run = runMigrations(url).then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(done).toBe(false);
    const [schema] = await holder<{ n: number }[]>`select count(*)::int as n from information_schema.schemata where schema_name = 'drizzle'`;
    expect(schema?.n).toBe(0);

    await holder`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    await run;
    expect(done).toBe(true);
    await holder.end({ timeout: 5 });
  }, 120_000);
});

describe('migrate process', () => {
  it('exits non-zero when the database cannot be migrated', () => {
    const tsx = path.join(BACKEND, 'node_modules', '.bin', 'tsx');
    const result = spawnSync(tsx, ['src/db/migrate.ts'], {
      cwd: BACKEND,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: urlFor('arcnave_db_that_does_not_exist_b'),
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.status).not.toBeNull();
  }, 90_000);
});

describe('backend/Dockerfile start command', () => {
  async function runCmd(migrateExit: number): Promise<{ status: number | null; started: boolean }> {
    const dockerfile = await readFile(path.join(BACKEND, 'Dockerfile'), 'utf8');
    const match = /^CMD (\[.*\])\s*$/m.exec(dockerfile);
    expect(match, 'Dockerfile has a JSON-form CMD').not.toBeNull();
    const argv = JSON.parse(match![1]!) as string[];

    const dir = await mkdtemp(path.join(tmpdir(), 'arcnave-cmd-'));
    try {
      await mkdir(path.join(dir, 'dist', 'db'), { recursive: true });
      await writeFile(path.join(dir, 'dist', 'db', 'migrate.js'), `process.exit(${String(migrateExit)});\n`);
      await writeFile(
        path.join(dir, 'dist', 'index.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, 'started'))}, 'yes');\n`,
      );
      const status = await new Promise<number | null>((resolve) => {
        const child = spawn(argv[0]!, argv.slice(1), { cwd: dir, env: { PATH: process.env.PATH ?? '' } });
        child.on('exit', (code) => resolve(code));
      });
      return { status, started: existsSync(path.join(dir, 'started')) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('does not start the server when migration fails, and exits non-zero', async () => {
    const failed = await runCmd(1);
    expect(failed.status).not.toBe(0);
    expect(failed.started).toBe(false);
  });

  it('starts the server after a successful migration', async () => {
    const ok = await runCmd(0);
    expect(ok.status).toBe(0);
    expect(ok.started).toBe(true);
  });
});
