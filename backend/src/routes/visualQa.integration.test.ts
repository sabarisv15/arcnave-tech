/**
 * G14 through the real route: a file operation's visual layer is decided by the vision
 * provider the app was built with, and only a real verdict makes it `passed`.
 */
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ToolResult } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

async function uploadPdf(text: string): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText(text);
  const part = multipart(`${text}.pdf`, Buffer.from(await doc.save()), 'application/pdf');
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/v1/files',
    headers: { ...part.headers, cookie: user.cookie },
    payload: part.payload,
  });
  return (res.json() as { id: string }).id;
}

async function merge(): Promise<Record<string, any>> {
  const ids = [await uploadPdf('one'), await uploadPdf('two')];
  let result: ToolResult | undefined;
  ctx.provider.onRequest = async (request) => {
    if (result || !request.toolExecutor) return;
    result = await request.toolExecutor.execute({ id: 'c', name: 'mergePdfFiles', input: { fileIds: ids } }, request.signal);
  };
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 't' } });
  await ctx.app.inject({
    method: 'POST',
    url: `/v1/chats/${(chat.json() as { id: string }).id}/generate`,
    headers: { cookie: user.cookie },
    payload: { prompt: 'merge these' },
  });
  ctx.provider.onRequest = null;
  return (result!.content.find((c) => c.type === 'json') as { data: Record<string, any> }).data;
}

describe('visual QA on a file operation (G14)', () => {
  it('a real vision verdict makes the visual layer passed and the result verified', async () => {
    ctx.provider.mediaHandler = async (_parts, prompt) =>
      prompt.includes('visual QA inspector') ? '{"passed":true,"defects":[]}' : 'text';
    const data = await merge();
    expect(ctx.provider.mediaSeen.some((m) => m.prompt.includes('visual QA inspector'))).toBe(true);
    expect(data.visual.status).toBe('passed');
    expect(data.structural.passed).toBe(true);
    expect(data.overall).toBe('verified');
  });

  it('a vision reply without a verdict leaves the layer not_checked and the result unverified', async () => {
    ctx.provider.mediaHandler = async () => 'It looks fine.';
    const data = await merge();
    expect(data.visual.status).toBe('not_checked');
    expect(data.visual.passed).toBe(false);
    expect(data.structural.passed).toBe(true);
    expect(data.overall).toBe('unverified');
  });
});
