/**
 * ADR-0045: with a sandbox on the turn, an Office file is read from its file with code, as the
 * reference assistant reads types it does not show in context. Its flattened text is not sent,
 * on the attaching turn or later ones; the model is told where the file is.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAnthropicMessages } from '../providers/anthropicVertex.js';
import { buildGeminiContents } from '../providers/gemini.js';
import type { GenerationRequest } from '../providers/types.js';
import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true', ENABLE_RUN_PYTHON: 'true', SANDBOX_ENGINE: 'process' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const MARKER = 'UNIQUEMARKER4417';

function wires(request: GenerationRequest): string[] {
  return [JSON.stringify(buildAnthropicMessages(request)), JSON.stringify(buildGeminiContents(request))];
}

describe('Office files with a sandbox on the turn', () => {
  it('are pointed to, not inlined, on the attaching turn and the next', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['label', MARKER]);
    const part = multipart(
      'ledger.xlsx',
      Buffer.from(await wb.xlsx.writeBuffer()),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
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
    const send = (payload: Record<string, unknown>) =>
      ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: user.cookie }, payload });

    await send({ prompt: 'Total of column B?', attachmentIds: [fileId] });
    const turn1 = ctx.provider.seen.at(-1)!;
    await send({ prompt: 'And the count?' });
    const turn2 = ctx.provider.seen.at(-1)!;

    for (const request of [turn1, turn2]) {
      expect(request.tools?.map((t) => t.name)).toContain('bash_tool');
      for (const wire of wires(request)) {
        expect(wire).not.toContain(MARKER);
        expect(wire).toContain('is read from its file');
        expect(wire).toContain(fileId);
      }
    }
  });
});
