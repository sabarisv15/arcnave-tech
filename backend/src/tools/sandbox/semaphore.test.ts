/**
 * `SandboxSemaphore` against real Postgres — this class's whole job is atomic claim/release
 * under concurrency, which a mock cannot prove anything about. Runs against the shared test
 * harness's database, same as `executor.integration.test.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp } from '../../test/harness.js';
import type { TestContext } from '../../test/harness.js';
import { sandboxClaims } from '../../db/schema.js';
import { SandboxSemaphore } from './semaphore.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});

afterEach(async () => {
  await ctx.db.delete(sandboxClaims);
});

afterAll(async () => {
  await ctx.close();
});

describe('SandboxSemaphore.claim/release', () => {
  it('grants claims up to the cap and refuses the next one', async () => {
    const semaphore = new SandboxSemaphore(ctx.db, 2, 60_000);
    const a = await semaphore.claim();
    const b = await semaphore.claim();
    const c = await semaphore.claim();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).toBeNull();
  });

  it('frees a slot on release, letting a new claim through', async () => {
    const semaphore = new SandboxSemaphore(ctx.db, 1, 60_000);
    const a = await semaphore.claim();
    expect(a).not.toBeNull();
    expect(await semaphore.claim()).toBeNull();

    await semaphore.release(a!);
    const b = await semaphore.claim();
    expect(b).not.toBeNull();
  });

  it('never grants more concurrent claims than the cap, even racing', async () => {
    const semaphore = new SandboxSemaphore(ctx.db, 3, 60_000);
    const results = await Promise.all(Array.from({ length: 10 }, () => semaphore.claim()));
    const granted = results.filter((r) => r !== null);
    expect(granted.length).toBe(3);
  });

  it('a claim whose lease has expired stops counting against the cap', async () => {
    const semaphore = new SandboxSemaphore(ctx.db, 1, -1);
    const a = await semaphore.claim();
    expect(a).not.toBeNull();
    // The lease was negative, so it's already expired without an explicit release — the next
    // claim should reap it and succeed rather than seeing a stale, still-held slot.
    const b = await semaphore.claim();
    expect(b).not.toBeNull();
  });

  it('releasing an already-reaped or unknown claim id is a no-op, not an error', async () => {
    const semaphore = new SandboxSemaphore(ctx.db, 1, 60_000);
    await expect(semaphore.release('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});
