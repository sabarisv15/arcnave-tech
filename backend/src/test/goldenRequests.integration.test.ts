/**
 * Golden request snapshots (tech-p03): the request each provider is sent, for five canonical
 * turns on each of the two provider paths.
 *
 * The real Gemini and Claude adapters run against fake SDK clients that record what they would
 * have put on the wire (system, tools, messages/contents, generation config). Nothing reaches a
 * provider. Opus uses the Claude adapter and the same request shape as Sonnet, so one Claude set
 * covers both.
 *
 * Purpose: a prompt, tool-declaration or message-assembly change shows up as a snapshot diff in
 * review. P07 (prompt) updates these on purpose with `vitest -u`; nothing else should have to.
 *
 * The five turns (no turn logs were supplied, so the defaults): 1 plain chat with no tools;
 * 2 a PDF attached and a question about it; 3 web search on (search mode); 4 a project chat with
 * project instructions and a file; 5 code run and file creation. Fixtures are synthetic: no real
 * user file text is in the snapshot.
 *
 * Same normaliser as the P05 characterization snapshots (`turnSnapshot.ts`): UUIDs, storage keys,
 * timestamps and the date line become placeholders; every long text is stored once, by sha256, in
 * the "long texts" snapshot at the end.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AnthropicProvider } from '../providers/anthropic.js';
import { GeminiProvider } from '../providers/gemini.js';
import { createTestApp, multipart, postProjectFile, signUp } from './harness.js';
import { generate, longTexts, newChat, normalise, plain, type Session, upload } from './turnSnapshot.js';

/* -------------------------------------------------------------------------- fake SDK clients */

function geminiStream() {
  const list = [{ text: 'Understood.' }, { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 }, candidates: [{ finishReason: 'STOP' }] }];
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => Promise.resolve(i < list.length ? { value: list[i++]!, done: false } : { value: undefined, done: true }) };
    },
  };
}

function claudeStream() {
  const events = [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Understood.' } }];
  const final = { content: [{ type: 'text', text: 'Understood.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => Promise.resolve(i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true }) };
    },
    finalMessage: () => Promise.resolve(final),
  };
}

type Wire = string[];

interface Rig {
  label: 'gemini' | 'claude';
  model: string;
  wire: Wire;
  /** Without tools. */
  plain: Session;
  /** Tools, the computer and projects on. */
  full: Session;
}

const RIGS: Rig[] = [];

async function openRig(label: Rig['label'], model: string): Promise<Rig> {
  const wire: Wire = [];
  const client =
    label === 'gemini'
      ? { models: { generateContentStream: (req: unknown) => { wire.push(plain(req)); return Promise.resolve(geminiStream()); } } }
      : { messages: { stream: (params: unknown, options: unknown) => { wire.push(plain({ params, options })); return claudeStream(); } } };

  const open = async (env: Record<string, string>): Promise<Session> => {
    const placeholder = await createTestApp(env);
    await placeholder.close();
    const provider = label === 'gemini' ? new GeminiProvider(placeholder.cfg, client as never) : new AnthropicProvider(placeholder.cfg, client as never);
    const ctx = await createTestApp(env, provider as never);
    return { ctx, user: await signUp(ctx) };
  };
  return {
    label,
    model,
    wire,
    plain: await open({ ENABLE_TOOL_USE: 'false' }),
    full: await open({ ENABLE_TOOL_USE: 'true', ENABLE_RUN_PYTHON: 'true', SANDBOX_ENGINE: 'process' }),
  };
}

beforeAll(async () => {
  RIGS.push(await openRig('gemini', 'Gemini 3.8 Flash'), await openRig('claude', 'Sonnet 5.5'));
});
afterAll(async () => {
  for (const rig of RIGS) {
    await rig.plain.ctx.close();
    await rig.full.ctx.close();
  }
});

/** The wire request(s) one turn produced, normalised. */
async function capture(rig: Rig, run: () => Promise<void>): Promise<unknown> {
  const before = rig.wire.length;
  await run();
  const sent = rig.wire.slice(before).map((c) => JSON.parse(c) as unknown);
  expect(sent.length, `${rig.label}: the turn sent no request`).toBeGreaterThan(0);
  return normalise({ provider: rig.label, requests: sent });
}

/**
 * A byte-for-byte reproducible PDF: the fixture helper used elsewhere stamps the current time
 * into the file, so its size changes from run to run and would flicker a snapshot that states it.
 */
async function fixedPdf(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of lines) doc.addPage([200, 200]).drawText(line, { x: 10, y: 100, size: 10, font });
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false }));
}

/* -------------------------------------------------------------------------- the five turns */

const TURNS: Array<{ name: string; run: (rig: Rig) => Promise<void> }> = [
  {
    name: '1 plain chat, no tools',
    run: async (rig) => {
      const chatId = await newChat(rig.plain);
      const res = await generate(rig.plain, chatId, { prompt: 'Explain the difference between revenue and profit in two sentences.', model: rig.model });
      expect(res.statusCode).toBe(200);
    },
  },
  {
    name: '2 PDF attached, a question about it',
    run: async (rig) => {
      const pdf = await upload(rig.full, 'policy.pdf', await fixedPdf(['Leave policy: 18 days of earned leave.', 'Carry forward: up to 30 days.']), 'application/pdf');
      const chatId = await newChat(rig.full);
      const res = await generate(rig.full, chatId, { prompt: 'How many earned leave days does the policy give?', model: rig.model, attachmentIds: [pdf] });
      expect(res.statusCode).toBe(200);
    },
  },
  {
    name: '3 web search on',
    run: async (rig) => {
      const chatId = await newChat(rig.full);
      const res = await generate(rig.full, chatId, { prompt: 'What is the current RBI repo rate?', model: rig.model, mode: 'search' });
      expect(res.statusCode).toBe(200);
    },
  },
  {
    name: '4 project chat with instructions',
    run: async (rig) => {
      const s = rig.full;
      const created = await s.ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: { cookie: s.user.cookie }, payload: { title: 'Q3 review', instructions: 'Answer in a formal tone. Use rupees and lakh/crore.' } });
      expect(created.statusCode).toBe(201);
      const projectId = (created.json() as { id: string }).id;
      const file = await postProjectFile(s.ctx, { cookie: s.user.cookie }, projectId, multipart('notes.txt', Buffer.from('Q3 notes: revenue 12 crore, costs 9.5 crore, 3 new clients.'), 'text/plain'));
      expect(file.statusCode).toBe(202);
      const chat = await s.ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: s.user.cookie }, payload: { title: 'In a project', projectId } });
      expect(chat.statusCode).toBe(201);
      const res = await generate(s, (chat.json() as { id: string }).id, { prompt: 'Summarise the Q3 notes.', model: rig.model });
      expect(res.statusCode).toBe(200);
    },
  },
  {
    name: '5 code run and file creation',
    run: async (rig) => {
      const chatId = await newChat(rig.full);
      const res = await generate(rig.full, chatId, { prompt: 'Compute the average of 3, 5 and 10 and save the three numbers and their average in a CSV file.', model: rig.model });
      expect(res.statusCode).toBe(200);
    },
  },
];

describe('golden requests: what each provider is sent', () => {
  for (const turn of TURNS) {
    for (const label of ['gemini', 'claude'] as const) {
      it(`${turn.name} · ${label}`, async () => {
        const rig = RIGS.find((r) => r.label === label)!;
        expect(await capture(rig, () => turn.run(rig))).toMatchSnapshot();
      });
    }
  }

  it('the long texts and large structures the requests referenced, by sha256', () => {
    expect(Object.fromEntries([...longTexts.entries()].sort(([a], [b]) => a.localeCompare(b)))).toMatchSnapshot();
  });
});
