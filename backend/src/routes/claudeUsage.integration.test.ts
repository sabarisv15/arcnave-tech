/**
 * A Claude turn's usage reaches the ledger the way a Gemini turn's does (ADR-0021, ADR-0054):
 * the real first-party adapter runs against a fake SDK client (no network), makes two requests
 * in a tool loop, and `usage_records` holds the sum of both — input, output, cache read and
 * cache write — marked exact.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { usageRecords } from '../db/schema.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, parseSse, signUp } from '../test/harness.js';

function fakeStream(final: { content: unknown[]; stop_reason: string; usage: Record<string, number> }, text?: string) {
  const events = text ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }] : [];
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => Promise.resolve(i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true }) };
    },
    finalMessage: () => Promise.resolve(final),
  };
}

const responses: ReturnType<typeof fakeStream>[] = [];
const client = { messages: { stream: () => responses.shift()! } };

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  const placeholder = await createTestApp({ ENABLE_TOOL_USE: 'true' });
  await placeholder.close();
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' }, new AnthropicProvider(placeholder.cfg, client as never) as never);
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

describe('Claude usage in the ledger', () => {
  it('records every request of the turn, cache read and write included', async () => {
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
    const chatId = (chat.json() as { id: string }).id;
    responses.push(
      fakeStream({
        content: [{ type: 'tool_use', id: 'c1', name: 'search_tools', input: { query: 'x' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
      }),
      fakeStream(
        { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 } },
        'Done.',
      ),
    );

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/chats/${chatId}/generate`,
      headers: { cookie: user.cookie },
      payload: { prompt: 'Find it', model: 'Sonnet 5.5' },
    });
    const frames = parseSse(response.body);
    expect(frames.at(-1)?.event).toBe('done');

    const rows = await ctx.db.select().from(usageRecords).where(eq(usageRecords.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      modelAlias: 'Sonnet 5.5',
      providerModelId: 'fake-sonnet',
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 2200,
      cacheWriteTokens: 200,
      tokensExact: true,
      provider: 'anthropic',
    });
  });
});
