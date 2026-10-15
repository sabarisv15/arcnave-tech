/**
 * Migration 0027 (ADR-0055): a saved default naming a retired alias moves to its successor, and
 * gpt-oss to Auto. The statements are re-run against rows written after the test database was
 * migrated, so the test fails if the SQL stops matching the aliases it is meant to move.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createTestApp, signUp, type TestContext } from '../test/harness.js';
import { preferences } from './schema.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.close();
});

it('moves Sonnet 5 / Opus 5 to their 5.5 successors and GPT-OSS 120B to Auto, and leaves the rest', async () => {
  const cases = [
    ['Sonnet 5', 'Sonnet 5.5'],
    ['Opus 5', 'Opus 5.5'],
    ['GPT-OSS 120B', 'Auto'],
    ['Gemini 3.8 Flash', 'Gemini 3.8 Flash'],
  ] as const;
  const users = [];
  for (const [before] of cases) {
    const user = await signUp(ctx);
    await ctx.db.update(preferences).set({ modelAlias: before }).where(eq(preferences.userId, user.id));
    users.push(user);
  }

  const file = readFileSync(path.resolve(__dirname, '../../drizzle/0027_model_aliases_55.sql'), 'utf8');
  for (const statement of file.split('--> statement-breakpoint')) await ctx.db.execute(sql.raw(statement));

  for (const [i, [, after]] of cases.entries()) {
    const [row] = await ctx.db.select({ modelAlias: preferences.modelAlias }).from(preferences).where(eq(preferences.userId, users[i]!.id));
    expect(row?.modelAlias).toBe(after);
  }
});
