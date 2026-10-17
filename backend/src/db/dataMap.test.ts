/**
 * Stage 5 P5 (ADR-0079): the data map covers every table, and every table that holds a person's
 * data is reached by account deletion through `ON DELETE CASCADE` foreign keys.
 */
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { DATA_MAP, RETENTION_CLASSES } from './dataMap.js';
import * as schema from './schema.js';

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
const configs = new Map(tables.map((t) => [getTableConfig(t).name, getTableConfig(t)]));

/** Tables a row's deletion cascades from: its foreign keys with `on delete cascade`. */
function cascadeParents(name: string): string[] {
  const cfg = configs.get(name);
  if (!cfg) return [];
  return cfg.foreignKeys
    .filter((fk) => fk.onDelete === 'cascade')
    .map((fk) => getTableConfig(fk.reference().foreignTable).name);
}

function reachesUsers(name: string, seen = new Set<string>()): boolean {
  if (name === 'users') return true;
  if (seen.has(name)) return false;
  seen.add(name);
  return cascadeParents(name).some((p) => reachesUsers(p, seen));
}

describe('data map (Stage 5 P5)', () => {
  it('finds the schema tables (the check is not vacuous)', () => {
    expect(configs.size).toBeGreaterThan(30);
    expect(configs.has('model_calls')).toBe(true);
  });

  it('has an entry for every table in the schema', () => {
    const missing = [...configs.keys()].filter((name) => !(name in DATA_MAP));
    expect(missing, 'add these tables to src/db/dataMap.ts with a retention class').toEqual([]);
  });

  it('names no table the schema does not have', () => {
    expect(Object.keys(DATA_MAP).filter((name) => !configs.has(name))).toEqual([]);
  });

  it('gives every entry a known retention class and a deletion path', () => {
    for (const [name, entry] of Object.entries(DATA_MAP)) {
      expect(RETENTION_CLASSES, name).toContain(entry.retention);
      expect(entry.deletedBy.length, name).toBeGreaterThan(0);
    }
  });

  it('reaches every personal table from users by cascading foreign keys (account deletion leaves nothing)', () => {
    const unreached = Object.entries(DATA_MAP)
      .filter(([name, entry]) => entry.personal && !reachesUsers(name))
      .map(([name]) => name);
    expect(unreached).toEqual([]);
  });

  it('the cascade walk would catch a table with no path (negative control)', () => {
    expect(reachesUsers('price_table')).toBe(false);
    expect(reachesUsers('model_calls')).toBe(true);
  });
});
