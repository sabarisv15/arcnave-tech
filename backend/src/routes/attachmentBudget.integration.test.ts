/**
 * G15: a historical PDF over the history byte budget keeps its identity and is rehydrated on
 * demand by fileId. The budget is shrunk to 100 bytes so a small fixture exceeds it; the code
 * path is the one a real 12 MB overflow takes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAnthropicMessages } from '../providers/anthropicVertex.js';
import { buildGeminiContents } from '../providers/gemini.js';
import type { GenerationRequest, ToolResult } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { pdfWithPages } from '../test/fixtures/files.js';
import { createTestApp, multipart, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({
    ENABLE_TOOL_USE: 'true',
    ENABLE_RUN_PYTHON: 'true',
    SANDBOX_ENGINE: 'process',
    HISTORY_MAX_ATTACHMENT_BYTES: '100',
  });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

let PDF: Buffer;
beforeAll(async () => {
  PDF = await pdfWithPages(1, ['Opening balance 100']);
});

describe('G15: historical PDF over the budget', () => {
  it('keeps identity, is described (not emptied), and rehydrates exactly by fileId', async () => {
    const part = multipart('statement.pdf', PDF, 'application/pdf');
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/v1/files',
      headers: { ...part.headers, cookie: user.cookie },
      payload: part.payload,
    });
    expect(upload.statusCode).toBe(201);
    const fileId = (upload.json() as { id: string }).id;

    const chat = await ctx.app.inject({
      method: 'POST',
      url: '/v1/chats',
      headers: { cookie: user.cookie },
      payload: { title: 'New conversation' },
    });
    const chatId = (chat.json() as { id: string }).id;
    // Pinned: the history budget is Gemini's (Claude's requests are bounded by their byte limit),
    // and under Auto the chat keeps the model its upload turn chose.
    const send = (payload: Record<string, unknown>) =>
      ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload: { model: 'Gemini 3.8 Flash', ...payload } });

    expect((await send({ prompt: 'Here is my statement', attachmentIds: [fileId] })).statusCode).toBe(200);

    let turn2: GenerationRequest | undefined;
    let rehydrated: ToolResult | undefined;
    ctx.provider.onRequest = async (request) => {
      turn2 = request;
      rehydrated = await request.toolExecutor!.execute(
        {
          id: 'call-1',
          name: 'run_python',
          input: { code: "print(open('input/statement.pdf','rb').read()[:8])", input_files: [fileId] },
        },
        new AbortController().signal,
      );
    };
    expect((await send({ prompt: 'Count the rows' })).statusCode).toBe(200);
    ctx.provider.onRequest = null;

    // Identity survives the budget; the bytes do not ride along.
    const old = turn2!.history.flatMap((t) => t.attachments ?? []).find((a) => a.id === fileId);
    expect(old).toMatchObject({ id: fileId, filename: 'statement.pdf', mimeType: 'application/pdf', omittedReason: 'history_budget' });
    expect(old!.storageKey).toBeTruthy();
    expect(old!.base64).toBeUndefined();

    // Neither provider receives an empty block; both name the fileId.
    for (const wire of [JSON.stringify(buildAnthropicMessages(turn2!)), JSON.stringify(buildGeminiContents(turn2!))]) {
      expect(wire).toContain(fileId);
      expect(wire).not.toContain('"data":""');
      expect(wire).not.toContain('Empty or unreadable');
    }

    // On demand, the exact stored bytes come back.
    expect(rehydrated!.ok).toBe(true);
    const out = (rehydrated!.content.find((c) => c.type === 'json') as { data: { stdout: string } }).data.stdout;
    expect(out).toContain("b'%PDF-1.7");
  });
});
