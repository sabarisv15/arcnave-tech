/**
 * Create and migrate the test database once per run.
 *
 * A separate database rather than the development one: the suite creates users, uploads files,
 * and writes usage rows, and none of that belongs in the database somebody is also clicking
 * around in. It is created if absent and reused if present, so a run costs one migration check
 * rather than a rebuild.
 */
import postgres from 'postgres';

import { runMigrations } from '../db/migrate.js';
import { TEST_DATABASE_URL } from './harness.js';

export default async function setup(): Promise<void> {
  if (process.env.SKIP_DB === '1') return;
  const url = new URL(TEST_DATABASE_URL);
  const database = url.pathname.replace(/^\//, '');

  // Connect to the maintenance database to issue CREATE DATABASE, which cannot run inside a
  // transaction and cannot target the database you are connected to.
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });

  try {
    const existing = await admin`select 1 from pg_database where datname = ${database}`;
    if (existing.length === 0) {
      // The identifier cannot be parameterised, so it is interpolated — from a URL this file
      // owns, not from anything a test supplies.
      await admin.unsafe(`create database "${database.replace(/"/g, '""')}"`);
    }
  } catch (err) {
    throw new Error(
      `Could not prepare the test database at ${adminUrl.host}. Is Postgres running? ` +
        `(docker start arcnave-pg)\n${String(err)}`,
    );
  } finally {
    await admin.end({ timeout: 5 });
  }

  await runMigrations(TEST_DATABASE_URL);
}
