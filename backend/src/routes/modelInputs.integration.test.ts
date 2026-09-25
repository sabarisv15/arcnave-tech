/**
 * ADR-0016 through the route: Gemini is sent a PDF's page images as `gs://` URIs, never their
 * bytes; Claude, which takes base64 only on Vertex, is sent the bytes of the same pages.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAnthropicMessages } from '../providers/anthropicVertex.js';
import { buildGeminiContents } from '../providers/gemini.js';
import type { ModelInputStore } from '../services/attachments/modelInputStore.js';
import { pdfWithPages } from '../test/fixtures/files.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, FakeProvider, multipart, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;
const stored: Buffer[] = [];
const store: ModelInputStore = {
  uriFor: async (data) => {
    stored.push(data);
    return `gs://model-inputs/pages/${String(stored.length)}.jpg`;
  },
};

beforeAll(async () => {
  ctx = await createTestApp({}, new FakeProvider(), { modelInputs: store });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

describe('page images by URI for Gemini', () => {
  it('sends Gemini URIs and Claude bytes for the same PDF', async () => {
    const headers = { cookie: user.cookie };
    const part = multipart('statement.pdf', await pdfWithPages(2, ['Opening 100', 'Closing 250']), 'application/pdf');
    const up = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...headers }, payload: part.payload });
    const chatId = ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers, payload: { title: 'p' } })).json() as { id: string }).id;
    const send = async (model: string, attachmentIds: string[]) => {
      const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers, payload: { prompt: 'read', model, attachmentIds } });
      expect(parseSse(res.body).at(-1)!.event).toBe('done');
      return ctx.provider.seen.at(-1)!;
    };

    const gemini = JSON.stringify(buildGeminiContents(await send('Gemini 3.8 Flash', [(up.json() as { id: string }).id])));
    expect(gemini).toContain('"fileUri":"gs://model-inputs/pages/1.jpg"');
    expect(gemini).toContain('"fileUri":"gs://model-inputs/pages/2.jpg"');
    expect(gemini).not.toContain('"inlineData"');
    expect(gemini).toContain('Text of page 2:\\nClosing 250');
    expect(stored).toHaveLength(2);
    expect(stored[0]!.subarray(0, 3).toString('hex')).toBe('ffd8ff'); // a JPEG

    // The next turn goes to Claude, with the PDF from the history: bytes, no URIs.
    const claude = JSON.stringify(buildAnthropicMessages(await send('Opus 5', [])));
    expect(claude).toContain('"type":"base64"');
    expect(claude).toContain('"media_type":"image/jpeg"');
    expect(claude).not.toContain('gs://');
  });
});

describe('earlier files over the inline budget (ADR-0019)', () => {
  let small: TestContext;
  let owner: TestUser;
  beforeAll(async () => {
    small = await createTestApp({ HISTORY_MAX_ATTACHMENT_BYTES: '100' }, new FakeProvider(), { modelInputs: store });
    owner = await signUp(small);
  });
  afterAll(async () => {
    await small.close();
  });

  it('still reach Gemini by URI and Claude within its own request limit', async () => {
    const headers = { cookie: owner.cookie };
    const part = multipart('old.pdf', await pdfWithPages(1, ['Opening 100']), 'application/pdf');
    const fileId = ((await small.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...headers }, payload: part.payload })).json() as { id: string }).id;
    const chatId = ((await small.app.inject({ method: 'POST', url: '/v1/chats', headers, payload: { title: 'p' } })).json() as { id: string }).id;
    const send = async (model: string, attachmentIds: string[] = []) => {
      await small.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers, payload: { prompt: 'read', model, attachmentIds } });
      return small.provider.seen.at(-1)!;
    };
    await send('Gemini 3.8 Flash', [fileId]);

    const gemini = await send('Gemini 3.8 Flash');
    const old = gemini.history.flatMap((t) => t.attachments ?? []).find((a) => a.id === fileId)!;
    expect(old.omittedReason).toBeUndefined();
    expect(JSON.stringify(buildGeminiContents(gemini))).toContain('"fileUri":"gs://model-inputs/pages/');

    const claude = await send('Opus 5');
    const forClaude = claude.history.flatMap((t) => t.attachments ?? []).find((a) => a.id === fileId)!;
    expect(forClaude.omittedReason).toBeUndefined();
    expect(JSON.stringify(buildAnthropicMessages(claude))).toContain('"type":"base64"');
  });
});
