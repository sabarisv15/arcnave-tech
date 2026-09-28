/**
 * ADR-0016 through the route: Gemini is sent a PDF's page images as `gs://` URIs, never their
 * bytes; Claude, which takes base64 only on Vertex, is sent the bytes of the same pages.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

describe('a follow-up turn over an earlier PDF (audit B6)', () => {
  it('reuses the rendered pages without downloading the file again', async () => {
    const headers = { cookie: user.cookie };
    const part = multipart('again.pdf', await pdfWithPages(2, ['Row 1', 'Row 2']), 'application/pdf');
    const fileId = ((await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...headers }, payload: part.payload })).json() as { id: string }).id;
    const chatId = ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers, payload: { title: 'p' } })).json() as { id: string }).id;
    const send = (attachmentIds: string[]) =>
      ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers, payload: { prompt: 'read', model: 'Gemini 3.8 Flash', attachmentIds } });
    await send([fileId]);
    const get = vi.spyOn(ctx.app.services.storage, 'get');
    try {
      const res = await send([]);
      expect(parseSse(res.body).at(-1)!.event).toBe('done');
      expect(JSON.stringify(buildGeminiContents(ctx.provider.seen.at(-1)!))).toContain('Row 2');
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
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

describe('a turn log under every reply (ADR-0050)', () => {
  it('records the page images sent, each tool call with its input and result, and the outcome', async () => {
    const headers = { cookie: user.cookie };
    const part = multipart('scan.pdf', await pdfWithPages(3, ['', 'Row 2', '']), 'application/pdf');
    const fileId = ((await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, ...headers }, payload: part.payload })).json() as { id: string }).id;
    const chatId = ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers, payload: { title: 'log' } })).json() as { id: string }).id;
    const script = ctx.provider.script;
    ctx.provider.script = [
      { type: 'thinking', text: 'The pages are in view.' },
      { type: 'tool_use', toolCallId: 't1', name: 'bash_tool', input: { command: 'pdfinfo input/scan.pdf', description: 'count pages' } },
      { type: 'tool_result', toolCallId: 't1', name: 'bash_tool', result: { toolCallId: 't1', ok: true, content: [{ type: 'text', text: 'Pages: 3' }] } },
      { type: 'delta', text: 'Three pages.' },
      { type: 'completed', usage: { inputTokens: 5, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true }, finishReason: 'stop' },
    ];
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/v1/chats/${chatId}/generate`,
        headers: { ...headers, 'sec-ch-ua-mobile': '?1' },
        payload: { prompt: 'Evlo pages?', model: 'Gemini 3.8 Flash', attachmentIds: [fileId] },
      });
      const frames = parseSse(res.body);
      expect(frames.at(-1)!.event).toBe('done');
      const messageId = (frames.find((f) => f.event === 'start')!.data as { messageId: string }).messageId;

      const log = await ctx.app.inject({ method: 'GET', url: `/v1/chats/${chatId}/messages/${messageId}/log`, headers });
      expect(log.statusCode).toBe(200);
      expect(log.headers['content-type']).toContain('text/plain');
      expect(log.headers['content-disposition']).toContain('.txt');
      const md = log.body;
      expect(md).toContain('"scan.pdf" (application/pdf): 3 pages, 3 page images sent (3 by Cloud Storage URI); a text layer on 1 of 3');
      expect(md).toContain('- Client: mobile');
      expect(md).toContain('### 1. bash_tool');
      expect(md).toContain('Why: count pages');
      expect(md).toContain('Ran:\n\n```bash\npdfinfo input/scan.pdf\n```');
      expect(md).toContain("**Thinking** (the model's thought summary)");
      expect(md).toContain('Result (ok):');
      expect(md).toContain('Pages: 3');
      expect(md).toContain('The pages are in view.');
      expect(md).toContain('- Status: complete');
      // The pipeline, stage by stage, with what each decided.
      for (const stage of ['| history |', '| model |', '| routing |', '| skills |', '| system prompt |', '| attachments |', '| provider first event |', '| provider completed |', '| saved |']) {
        expect(md).toContain(stage);
      }
      expect(md).toContain('pageImages: 3');
      expect(md).toMatch(/### 1\. bash_tool \(at [\d.]+ s, took [\d.]+ s\)/);
      expect(md).not.toContain('## Where it failed');
      expect(md).toContain('Evlo pages?');
      // The system prompt's size and sections, never its text.
      expect(md).toMatch(/- System prompt: \d+ characters; sections: /);
      expect(md).not.toContain('You are ArcNave');

      // Another user cannot read it.
      const other = await signUp(ctx);
      const denied = await ctx.app.inject({ method: 'GET', url: `/v1/chats/${chatId}/messages/${messageId}/log`, headers: { cookie: other.cookie } });
      expect(denied.statusCode).toBe(404);
    } finally {
      ctx.provider.script = script;
    }
  });
});

describe('a failed turn says where it failed (ADR-0050)', () => {
  it('names the stage and the error', async () => {
    const headers = { cookie: user.cookie };
    const chatId = ((await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers, payload: { title: 'fail' } })).json() as { id: string }).id;
    ctx.provider.streamError = new Error('upstream exploded');
    try {
      const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers, payload: { prompt: 'hi', model: 'Gemini 3.8 Flash' } });
      const frames = parseSse(res.body);
      expect(frames.at(-1)!.event).toBe('error');
      const messageId = (frames.find((f) => f.event === 'start')!.data as { messageId: string }).messageId;
      const md = (await ctx.app.inject({ method: 'GET', url: `/v1/chats/${chatId}/messages/${messageId}/log`, headers })).body;
      expect(md).toContain('## Where it failed');
      expect(md).toContain('upstream exploded');
      expect(md).toContain('| provider failed |');
      expect(md).toContain('- Status: error');
    } finally {
      ctx.provider.streamError = null;
    }
  });
});
