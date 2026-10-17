/**
 * Review R9 (p05 round 1): a helper call's ledger row names the provider of the helper registry
 * row that served it, not a constant.
 */
import { describe, expect, it } from 'vitest';

import { HelperJobs } from './helperJobs.js';

describe('helper ledger rows (review R9)', () => {
  it('the provider comes from the helper registry entry', async () => {
    const entry = { alias: 'Helper', provider: 'google', providerModelId: 'helper-model', role: 'helper' };
    const usage = { inputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true };
    const registry = {
      helperStatus: () => ({ available: true, entry }),
      providerFor: () => ({
        classify: async () => ({ text: '{"intent":"chat","tier":"fast"}', value: { intent: 'chat', tier: 'fast' }, usage, finishReason: 'stop' }),
      }),
      recordHelperOutcome: () => {},
    };
    const recorded: Array<{ ctx: { provider: string }; rows: Array<{ provider?: string }> }> = [];
    const ledger = {
      recordCalls: async (_db: unknown, ctx: { provider: string }, rows: Array<{ provider?: string }>) => {
        recorded.push({ ctx, rows });
      },
    };
    const log = { info: () => {}, warn: () => {} };
    const jobs = new HelperJobs({ db: {} as never, cfg: { ROUTER_SHADOW: true } as never, registry: registry as never, log: log as never, ledger: ledger as never });
    jobs.routerShadow({ userId: 'u', chatId: 'c', messageId: 'm', prompt: 'hello', resolvedAlias: 'Auto' });
    await jobs.idle();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.ctx.provider).toBe('google');
    expect(recorded[0]!.rows[0]!.provider ?? recorded[0]!.ctx.provider).toBe('google');
  });
});
