/**
 * G16: an Office attachment's extracted text reaches each provider exactly once, on the turn it
 * is attached and on later turns that carry it as history.
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
  ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' });
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const MARKER = 'UNIQUEMARKER7731';
const occurrences = (haystack: string) => haystack.split(MARKER).length - 1;

function wires(request: GenerationRequest): Array<[string, string]> {
  return [
    ['Claude', JSON.stringify({ system: request.systemInstruction, messages: buildAnthropicMessages(request) })],
    ['Gemini', JSON.stringify({ system: request.systemInstruction, contents: buildGeminiContents(request) })],
  ];
}

describe('G16: Office text is sent once', () => {
  it('on the attaching turn and on the next turn, for both providers', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['label', MARKER]);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const part = multipart(
      'marker.xlsx',
      xlsx,
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

    await send({ prompt: 'What is in this sheet?', attachmentIds: [fileId] });
    const turn1 = ctx.provider.seen.at(-1)!;
    await send({ prompt: 'And again?' });
    const turn2 = ctx.provider.seen.at(-1)!;

    for (const [label, request] of [['turn 1', turn1], ['turn 2', turn2]] as const) {
      for (const [provider, wire] of wires(request)) {
        expect(occurrences(wire), `${provider} ${label}`).toBe(1);
      }
    }

    // G27: the turn being answered is the current turn, not also a history entry.
    expect(turn1.history).toEqual([]);
    expect(turn2.history.map((t) => t.text)).toEqual(['What is in this sheet?', 'Hello, world.']);
    for (const [, wire] of wires(turn2)) {
      expect(wire.split('And again?').length - 1).toBe(1);
    }

    // A retry that does not resend attachmentIds still sends the turn's attachment, once.
    const transcript = await ctx.app.inject({ url: `/v1/chats/${chatId}`, headers: { cookie: user.cookie } });
    const firstAssistant = (transcript.json() as { messages: Array<{ id: string; role: string }> }).messages.find(
      (m) => m.role === 'assistant',
    )!;
    const retry = await send({ prompt: 'What is in this sheet?', retryMessageId: firstAssistant.id });
    expect(retry.statusCode).toBe(200);
    const retried = ctx.provider.seen.at(-1)!;
    expect((retried.attachments ?? []).map((a) => a.id)).toEqual([fileId]);
    for (const [provider, wire] of wires(retried)) {
      expect(occurrences(wire), `${provider} retry`).toBe(1);
    }
  });
});
