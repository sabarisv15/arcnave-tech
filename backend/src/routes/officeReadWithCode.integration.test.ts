/**
 * Office files on a turn that can run code (ADR-0063, superseding ADR-0045 §1 per locked Stage 9
 * CF4 / D9-8 and OQ-13): a file whose provider token count fits the whole-file limit (N-05) goes
 * inline as its normalised text (cell addresses kept); a larger one is pointed to, with the
 * excerpts retrieved for the question. Either way the model is told where the file is.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAnthropicMessages } from '../providers/anthropic.js';
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

async function upload(wb: ExcelJS.Workbook, name: string): Promise<string> {
  const part = multipart(name, Buffer.from(await wb.xlsx.writeBuffer()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, cookie: user.cookie }, payload: part.payload });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe('Office files with a sandbox on the turn', () => {
  it('a small one goes inline as normalised text, with its cell addresses, on the attaching turn and the next', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['label', MARKER]);
    const fileId = await upload(wb, 'small.xlsx');
    const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: user.cookie }, payload: { title: 'c' } });
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
        expect(wire).toContain(`| 1 | label | ${MARKER} |`);
        expect(wire).not.toContain('is read from its file');
        expect(wire).toContain(fileId);
      }
    }
  });

  it('a large one is pointed to, with excerpts for the question, on the attaching turn and the next', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Sheet1');
    sheet.addRow(['label', MARKER]);
    // Over N-05 by the (fake) count API: 30k tokens is ~120,000 characters at its 4 per token.
    for (let i = 0; i < 4000; i++) sheet.addRow([`row ${String(i)}`, 'filler '.repeat(6)]);
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
        expect(wire).toContain('is read from its file');
        expect(wire).toContain('Excerpts of');
        expect(wire).toContain(fileId);
      }
    }
  });
});
