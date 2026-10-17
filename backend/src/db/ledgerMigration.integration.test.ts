/**
 * Migration 0031 (P22, ADR-0079) on a database that already holds data: 0000–0030 are applied to
 * a scratch database, rows are seeded the way the app writes them, then 0031 is applied. The old
 * rows must come through untouched, the new columns must be null (never 0), the ledger must be
 * partitioned, and the price table must take the book (the boot upsert, run twice) and refuse an
 * overlapping row.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import { PRICE_BOOK } from '../config/priceBook.js';
import { PricingService } from '../services/pricing.js';
import { TEST_DATABASE_URL } from '../test/harness.js';
import * as schema from './schema.js';

const BACKEND = path.resolve(__dirname, '..', '..');

function urlFor(database: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

const admin = postgres(urlFor('postgres'), { max: 1, onnotice: () => {} });
const name = `${new URL(TEST_DATABASE_URL).pathname.slice(1)}_ledger_${String(process.pid)}_${String(Date.now() % 100_000)}`;
let sql: postgres.Sql;
let before: string;

const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  chat: '22222222-2222-4222-8222-222222222222',
  userMsg: '33333333-3333-4333-8333-333333333333',
  asstMsg: '44444444-4444-4444-8444-444444444444',
  usage: '55555555-5555-4555-8555-555555555555',
  turn: '66666666-6666-4666-8666-666666666666',
  reservation: '77777777-7777-4777-8777-777777777777',
};

beforeAll(async () => {
  await admin.unsafe(`create database "${name}"`);
  sql = postgres(urlFor(name), { max: 1, onnotice: () => {} });

  // 0000–0030 only: a copy of the migrations folder whose journal stops before 0031.
  before = await mkdtemp(path.join(tmpdir(), 'arcnave-ledger-mig-'));
  await cp(path.join(BACKEND, 'drizzle'), before, { recursive: true });
  const journalPath = path.join(before, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
  journal.entries = journal.entries.filter((e) => e.idx <= 30);
  expect(journal.entries.at(-1)?.tag).toBe('0030_durable_turns');
  await writeFile(journalPath, JSON.stringify(journal));
  await migrate(drizzle(sql), { migrationsFolder: before });

  // Rows as the app writes them before 0031.
  await sql`insert into users (id, email, name) values (${ids.user}, ${'seed@example.test'}, ${'Seed'})`;
  await sql`insert into chats (id, user_id, title) values (${ids.chat}, ${ids.user}, ${'Seeded'})`;
  await sql`insert into messages (id, chat_id, user_id, seq, role, text, status) values
    (${ids.userMsg}, ${ids.chat}, ${ids.user}, 0, 'user', 'hi', 'complete'),
    (${ids.asstMsg}, ${ids.chat}, ${ids.user}, 1, 'assistant', 'hello', 'complete')`;
  await sql`insert into usage_records (id, user_id, request_id, chat_id, message_id, model_alias, provider, provider_model_id,
      input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens, tokens_exact, context_tokens,
      started_at, completed_at, latency_ms, finish_reason, status, cost_usd, cost_inr)
    values (${ids.usage}, ${ids.user}, 'req-1', ${ids.chat}, ${ids.asstMsg}, 'Sonnet 5.5', 'anthropic', 'claude-sonnet-5-5',
      100, 20, 120, 0, 0, true, 120, now() - interval '1 day', now() - interval '1 day', 900, 'end_turn', 'complete', 0.0004, 0.0352)`;
  await sql`insert into turns (id, chat_id, user_id, user_message_id, assistant_message_id, kind, state, request_id, params, deadline)
    values (${ids.turn}, ${ids.chat}, ${ids.user}, ${ids.userMsg}, ${ids.asstMsg}, 'send', 'done', 'req-1',
      ${JSON.stringify({ mode: 'chat', modelAlias: 'Auto', attachmentIds: [], codeExecution: false, projectId: null })}::jsonb, now())`;
  await sql`insert into budget_reservations (id, user_id, turn_id, owner, tokens, status, expires_at)
    values (${ids.reservation}, ${ids.user}, ${ids.turn}, 'turn', 16384, 'settled', now())`;

  // Now 0031, from the real folder.
  await migrate(drizzle(sql), { migrationsFolder: path.join(BACKEND, 'drizzle') });
}, 120_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.end({ timeout: 5 });
  if (before) await rm(before, { recursive: true, force: true });
});

describe('migration 0031_ledger on a seeded database', () => {
  it('leaves the old usage row as it was, with every new column null (not 0)', async () => {
    const [row] = await sql`select * from usage_records where id = ${ids.usage}`;
    expect(row).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      tokens_exact: true,
      context_tokens: 120,
      cost_usd: 0.0004,
      cost_inr: 0.0352,
      finish_reason: 'end_turn',
      status: 'complete',
    });
    expect(row).toMatchObject({ price_version: null, provider_ttft_ms: null, first_visible_ms: null, turn_total_ms: null, output_tps: null });
  });

  it('adds the reservation settle link and the active version as nulls', async () => {
    const [r] = await sql`select status, settled_usage_record_id, price_version from budget_reservations where id = ${ids.reservation}`;
    expect(r).toEqual({ status: 'settled', settled_usage_record_id: null, price_version: null });
    const [c] = await sql`select active_chat_id from chats where id = ${ids.chat}`;
    expect(c).toEqual({ active_chat_id: null });
  });

  it('partitions model_calls by month, with a DEFAULT partition and this and next month', async () => {
    const parts = await sql<{ name: string; bound: string }[]>`
      select c.relname as name, pg_get_expr(c.relpartbound, c.oid) as bound
      from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent
      where p.relname = 'model_calls' order by c.relname`;
    const now = new Date();
    const month = (offset: number) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      return `model_calls_y${String(d.getUTCFullYear())}m${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const names = parts.map((p) => p.name);
    expect(names).toContain('model_calls_default');
    expect(names).toContain(month(0));
    expect(names).toContain(month(1));
    expect(parts.find((p) => p.name === 'model_calls_default')?.bound).toBe('DEFAULT');
    const [kind] = await sql`select partstrat from pg_partitioned_table pt join pg_class c on c.oid = pt.partrelid where c.relname = 'model_calls'`;
    expect(kind?.partstrat).toBe('r');
  });

  it('takes the price book at boot, twice without a duplicate, with numeric money', async () => {
    const db = drizzle(sql, { schema, casing: 'snake_case' });
    const pricing = new PricingService(loadConfig({ NODE_ENV: 'test' }));
    expect(await pricing.syncTable(db)).toBe(PRICE_BOOK.length);
    expect(await pricing.syncTable(db)).toBe(PRICE_BOOK.length);
    const [count] = await sql`select count(*)::int as n from price_table`;
    expect(count?.n).toBe(PRICE_BOOK.length);
    const [sonnet] = await sql`select usd_per_mtok::text as rate, price_version from price_table
      where provider_model_id = 'claude-sonnet-5-5' and token_type = 'cache_read'`;
    expect(sonnet).toEqual({ rate: '0.100000', price_version: 'claude-sonnet-5-5@2026-10-10' });
  });

  it('refuses a price row that overlaps one in force, and takes one that starts where it ends', async () => {
    await expect(
      sql`insert into price_table (provider_model_id, token_type, usd_per_mtok, effective_from, price_version, source)
        values ('claude-sonnet-5-5', 'input', 3, '2026-11-01T00:00:00Z', 'overlap', 'test')`,
    ).rejects.toMatchObject({ code: '23P01' });
    await sql.begin(async (tx) => {
      await tx`update price_table set effective_to = '2026-12-01T00:00:00Z'
        where provider_model_id = 'claude-opus-5-5' and token_type = 'input'`;
      await tx`insert into price_table (provider_model_id, token_type, usd_per_mtok, effective_from, price_version, source)
        values ('claude-opus-5-5', 'input', 3, '2026-12-01T00:00:00Z', 'next', 'test')`;
      const rows = await tx`select price_version from price_table where provider_model_id = 'claude-opus-5-5' and token_type = 'input' order by effective_from`;
      expect(rows.map((r) => r.price_version)).toEqual(['claude-opus-5-5@2026-10-10', 'next']);
      throw new Error('rollback');
    }).catch((err: unknown) => {
      if ((err as Error).message !== 'rollback') throw err;
    });
  });

  it('writes a ledger row in the month partition, keyed by (id, started_at)', async () => {
    await sql`insert into model_calls (started_at, user_id, ordinal, role, provider, provider_model_id, outcome, usage_source)
      values (now(), ${ids.user}, 1, 'answer', 'anthropic', 'claude-sonnet-5-5', 'ok', 'provider')`;
    const [where] = await sql`select tableoid::regclass::text as part from model_calls where user_id = ${ids.user}`;
    expect(where?.part).toMatch(/^model_calls_y\d{4}m\d{2}$/);
  });
});
