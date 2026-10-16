/**
 * Characterization snapshots of one turn, end to end (tech-build.3 Part C, NEW-PLAN P05).
 *
 * Written on the unsplit `services/generation.ts` and `routes/chats.ts`, before the turn code
 * was split by stage (ADR-0067). The split is behaviour-neutral exactly when these snapshots do
 * not change: every provider request payload, every SSE frame, and every row the turn writes.
 *
 * Nothing reaches a provider: the fake provider records each `GenerationRequest`, and the Gemini
 * and Claude paths run the real adapters against fake SDK clients that record each call.
 *
 * The normaliser replaces only values that change from run to run, never payload content:
 * - UUIDs (users, chats, messages, files, request ids) become `<uuid-n>`, numbered by first
 *   appearance in the scenario, so "the same id" stays visible;
 * - a storage key (`<shard>/<year>/<month>/<owner>/<random>`) becomes `<storage-key>`;
 * - ISO timestamps become `<iso>`, and the system prompt's date line keeps its time zone but not
 *   the day it ran;
 * - live objects that are not data (the abort signal, the tool executor) become `[ClassName]`.
 * Text longer than 1,000 characters (the system prompt and its parts), and any structure below a
 * scenario's top three levels whose JSON passes 4,000 characters (the tool declarations, the
 * prompt assembly), is stored once in the "long texts" snapshot at the end and referenced from
 * the scenarios by its sha256: all of the content is snapshotted, once rather than per request.
 */
import { createHash } from 'node:crypto';

import { and, asc, eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attachments, chats, messages, researchEvents, toolCalls, usageRecords } from '../db/schema.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest, ProviderEvent } from '../providers/types.js';
import { ProviderError } from '../providers/types.js';
import type { TestContext, TestUser } from './harness.js';
import { createTestApp, FakeProvider, multipart, parseSse, signUp } from './harness.js';

/* -------------------------------------------------------------------------- normaliser */

const LONG_TEXT = 1_000;
const LARGE_STRUCTURE = 4_000;
const longTexts = new Map<string, unknown>();

const STORAGE_KEY = /\b[0-9a-f]{4}\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{16}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const DATE_LINE = /The current date is [^()]+? \(time zone ([^)]+)\)\./g;

function plain(value: unknown): string {
  return JSON.stringify(value, function (this: unknown, _key, v: unknown) {
    if (typeof v === 'function') return '[Function]';
    if (v instanceof AbortSignal) return '[AbortSignal]';
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const proto = Object.getPrototypeOf(v) as object | null;
      if (proto !== null && proto !== Object.prototype) return `[${(v as object).constructor.name}]`;
    }
    return v;
  });
}

function stored(kind: string, value: unknown, text: string): string {
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  longTexts.set(hash, value);
  return `<${kind} ${hash} (${String(text.length)} chars)>`;
}

/** Bottom-up: a long string, or a large structure below a scenario's top levels, is stored once. */
function extractLong(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length <= LONG_TEXT ? value : stored('text', value, value);
  if (!value || typeof value !== 'object') return value;
  const inner = Array.isArray(value)
    ? value.map((v) => extractLong(v, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, extractLong(v, depth + 1)]));
  if (depth < 3) return inner;
  const text = JSON.stringify(inner);
  return text.length <= LARGE_STRUCTURE ? inner : stored('json', inner, text);
}

/** One scenario's record, with volatile values replaced (see the file header). */
function normalise(value: unknown): unknown {
  const ids = new Map<string, number>();
  const text = plain(value)
    .replace(STORAGE_KEY, '<storage-key>')
    .replace(UUID, (id) => {
      const key = id.toLowerCase();
      if (!ids.has(key)) ids.set(key, ids.size + 1);
      return `<uuid-${String(ids.get(key))}>`;
    })
    .replace(ISO, '<iso>')
    .replace(DATE_LINE, 'The current date is <date> (time zone $1).');
  return extractLong(JSON.parse(text));
}

/* -------------------------------------------------------------------------- providers */

/** A fake whose next attempts are scripted as functions, so one can drive the real tool executor. */
class AttemptsProvider extends FakeProvider {
  attempts: Array<(request: GenerationRequest) => AsyncGenerator<ProviderEvent>> = [];

  override async *stream(request: GenerationRequest): AsyncGenerator<ProviderEvent> {
    const next = this.attempts.shift();
    if (!next) {
      yield* super.stream(request);
      return;
    }
    this.seen.push(request);
    yield* next(request);
  }
}

const usage = (inputTokens = 10, outputTokens = 2) => ({ inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true });
const answer = (text: string): ProviderEvent[] => [
  { type: 'delta', text },
  { type: 'completed', usage: usage(), finishReason: 'stop' },
];
const ASK = { questions: [{ question: 'Which one?', options: ['A', 'B'] }] };

/* -------------------------------------------------------------------------- helpers */

interface Session {
  ctx: TestContext;
  user: TestUser;
}

async function newChat(s: Session, title = 'New conversation'): Promise<string> {
  const res = await s.ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: s.user.cookie }, payload: { title } });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

async function generate(s: Session, chatId: string, payload: Record<string, unknown>) {
  const res = await s.ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: s.user.cookie }, payload });
  return { statusCode: res.statusCode, frames: res.statusCode === 200 ? parseSse(res.body) : [], body: res.statusCode === 200 ? null : (res.json() as unknown) };
}

async function upload(s: Session, filename: string, bytes: Buffer | string, mimeType: string): Promise<string> {
  const part = multipart(filename, bytes, mimeType);
  const res = await s.ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, cookie: s.user.cookie }, payload: part.payload });
  expect(res.statusCode, res.body).toBe(201);
  await s.ctx.app.services.files.idle();
  return (res.json() as { id: string }).id;
}

/** Every row the turns of this chat wrote, in a stable order, without timing columns. */
async function rowsOf(s: Session, chatId: string) {
  const db = s.ctx.db;
  const [chat] = await db.select({ title: chats.title }).from(chats).where(eq(chats.id, chatId));
  const msgs = await db
    .select({
      id: messages.id,
      seq: messages.seq,
      role: messages.role,
      text: messages.text,
      mode: messages.mode,
      status: messages.status,
      errorCode: messages.errorCode,
      researchStage: messages.researchStage,
      questions: messages.questions,
      modelAlias: messages.modelAlias,
      effort: messages.effort,
      provider: messages.provider,
      providerModelId: messages.providerModelId,
      finishReason: messages.finishReason,
      searchEntryPoint: messages.searchEntryPoint,
      thinking: messages.thinking,
      segments: messages.segments,
      completedAt: messages.completedAt,
    })
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.seq));
  const ids = msgs.map((m) => m.id);
  const none = ids.length === 0;
  const calls = none
    ? []
    : await db
        .select({
          messageId: toolCalls.messageId,
          ordinal: toolCalls.ordinal,
          toolCallId: toolCalls.toolCallId,
          name: toolCalls.name,
          input: toolCalls.input,
          content: toolCalls.content,
          ok: toolCalls.ok,
          thoughtSignature: toolCalls.thoughtSignature,
        })
        .from(toolCalls)
        .where(inArray(toolCalls.messageId, ids))
        .orderBy(asc(toolCalls.messageId), asc(toolCalls.ordinal));
  const events = none
    ? []
    : await db
        .select({ messageId: researchEvents.messageId, ordinal: researchEvents.ordinal, stage: researchEvents.stage, label: researchEvents.label, detail: researchEvents.detail })
        .from(researchEvents)
        .where(inArray(researchEvents.messageId, ids))
        .orderBy(asc(researchEvents.messageId), asc(researchEvents.ordinal));
  const files = none
    ? []
    : await db
        .select({ id: attachments.id, messageId: attachments.messageId, filename: attachments.filename, mimeType: attachments.mimeType, status: attachments.status })
        .from(attachments)
        .where(inArray(attachments.messageId, ids))
        .orderBy(asc(attachments.filename));
  const ledger = await db
    .select({
      messageId: usageRecords.messageId,
      modelAlias: usageRecords.modelAlias,
      provider: usageRecords.provider,
      providerModelId: usageRecords.providerModelId,
      inputTokens: usageRecords.inputTokens,
      outputTokens: usageRecords.outputTokens,
      totalTokens: usageRecords.totalTokens,
      cacheReadTokens: usageRecords.cacheReadTokens,
      cacheWriteTokens: usageRecords.cacheWriteTokens,
      tokensExact: usageRecords.tokensExact,
      contextTokens: usageRecords.contextTokens,
      finishReason: usageRecords.finishReason,
      status: usageRecords.status,
      errorCode: usageRecords.errorCode,
      costUsd: usageRecords.costUsd,
      costInr: usageRecords.costInr,
    })
    .from(usageRecords)
    .where(and(eq(usageRecords.userId, s.user.id), eq(usageRecords.chatId, chatId)))
    .orderBy(asc(usageRecords.startedAt));
  return {
    chat,
    messages: msgs.map(({ completedAt, ...m }) => ({ ...m, completed: completedAt !== null })),
    toolCalls: calls,
    researchEvents: events,
    attachments: files,
    usage: ledger,
  };
}

/* -------------------------------------------------------------------------- fake provider */

describe('turn characterization: fake provider', () => {
  const provider = new AttemptsProvider();
  const s = {} as Session;

  beforeAll(async () => {
    s.ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' }, provider);
    s.user = await signUp(s.ctx);
  });
  afterAll(async () => {
    await s.ctx.close();
  });

  /**
   * `withRequests: false` leaves the provider requests out: a message with several files lists
   * them in the database's row order (the route's attachment read has no ORDER BY), which is not
   * stable, so those requests are not a fixed expectation.
   */
  async function scenario(run: () => Promise<{ chatId: string; responses: unknown[] }>, withRequests = true) {
    provider.attempts = [];
    provider.streamError = null;
    provider.script = answer('Hello, world.');
    const before = provider.seen.length;
    const { chatId, responses } = await run();
    return normalise({ requests: withRequests ? provider.seen.slice(before) : [], responses, rows: await rowsOf(s, chatId) });
  }

  it('plain chat, two turns', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.script = answer('First answer.');
        const first = await generate(s, chatId, { prompt: 'What is a turn?' });
        provider.script = answer('Second answer.');
        const second = await generate(s, chatId, { prompt: 'And the next one?' });
        return { chatId, responses: [first, second] };
      }),
    ).toMatchSnapshot();
  });

  // One file per message: several files in one message are listed in an unstable order (above).
  it('chat with files: a text file, then an image, then a follow-up', async () => {
    expect(
      await scenario(async () => {
        const text = await upload(s, 'notes.txt', 'Line one of the notes.\nLine two of the notes.\n', 'text/plain');
        const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } }).png().toBuffer();
        const image = await upload(s, 'square.png', png, 'image/png');
        const chatId = await newChat(s);
        provider.script = answer('I read the notes.');
        const first = await generate(s, chatId, { prompt: 'What do the notes hold?', attachmentIds: [text] });
        provider.script = answer('A blue square.');
        const second = await generate(s, chatId, { prompt: 'And this image?', attachmentIds: [image] });
        provider.script = answer('Still here.');
        const third = await generate(s, chatId, { prompt: 'And the second line?' });
        return { chatId, responses: [first, second, third] };
      }),
    ).toMatchSnapshot();
  });

  it('a tool-loop turn', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.attempts = [
          async function* (request) {
            const call = { id: 'call_1', name: 'ask_user_input_v0', input: ASK };
            yield { type: 'thinking', text: 'Asking first.' };
            yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
            const result = await request.toolExecutor!.execute(call, request.signal);
            yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
            yield { type: 'progress', stage: 'reading', label: 'Reading', detail: 'one step' };
            yield { type: 'delta', text: 'Pick one above.' };
            yield { type: 'completed', usage: usage(20, 5), finishReason: 'stop' };
          },
        ];
        const res = await generate(s, chatId, { prompt: 'Help me choose.' });
        return { chatId, responses: [res] };
      }),
    ).toMatchSnapshot();
  });

  it('a tool loop that ends with no text gets one forced answer', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.attempts = [
          async function* (request) {
            const call = { id: 'call_2', name: 'ask_user_input_v0', input: ASK };
            yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
            const result = await request.toolExecutor!.execute(call, request.signal);
            yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
            yield { type: 'completed', usage: usage(30, 3), finishReason: 'tool_limit' };
          },
          async function* () {
            yield* answer('Here is the answer from the steps.');
          },
        ];
        const res = await generate(s, chatId, { prompt: 'Work it out.' });
        return { chatId, responses: [res] };
      }),
    ).toMatchSnapshot();
  });

  it('a transient failure is retried, then succeeds', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.attempts = [
          // eslint-disable-next-line require-yield
          async function* () {
            throw new ProviderError('busy', { retryable: true, statusCode: 503 });
          },
          async function* () {
            yield* answer('Second try worked.');
          },
        ];
        const res = await generate(s, chatId, { prompt: 'Try this.' });
        return { chatId, responses: [res] };
      }),
    ).toMatchSnapshot();
  });

  it('a failure after a tool ran ends the turn partial', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.attempts = [
          async function* (request) {
            const call = { id: 'call_3', name: 'ask_user_input_v0', input: ASK };
            yield { type: 'delta', text: 'Partly done. ' };
            yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
            const result = await request.toolExecutor!.execute(call, request.signal);
            yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
            throw new ProviderError('Gemini request failed: 502', { retryable: true, statusCode: 502 });
          },
        ];
        const res = await generate(s, chatId, { prompt: 'Pick for me.' });
        return { chatId, responses: [res] };
      }),
    ).toMatchSnapshot();
  });

  it('a refused turn', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.script = [
          { type: 'refusal', category: 'cyber', explanation: null },
          { type: 'completed', usage: usage(), finishReason: 'refusal' },
        ];
        const res = await generate(s, chatId, { prompt: 'Something refused.' });
        return { chatId, responses: [res] };
      }),
    ).toMatchSnapshot();
  });

  it('a provider failure that is not retried', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.streamError = new ProviderError('bad request', { retryable: false, statusCode: 400 });
        const res = await generate(s, chatId, { prompt: 'This fails.' });
        return { chatId, responses: [res] };
      }),
    ).toMatchSnapshot();
  });

  it('a turn blocked before the stream opens (code execution on a model without it)', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        const res = await generate(s, chatId, { prompt: 'Run code.', codeExecution: true });
        return { chatId, responses: [res] };
      }),
    ).toMatchSnapshot();
  });

  it('a regenerated reply (retryMessageId) replaces the earlier attempt', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.script = [{ type: 'progress', stage: 'reading', label: 'Look', detail: 'once' }, ...answer('Old answer.')];
        const first = await generate(s, chatId, { prompt: 'Say it.', mode: 'search' });
        const [assistant] = await s.ctx.db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant')));
        provider.script = answer('New answer.');
        const second = await generate(s, chatId, { prompt: 'Say it.', mode: 'search', retryMessageId: assistant!.id });
        return { chatId, responses: [first, second] };
      }),
    ).toMatchSnapshot();
  });

  it('turn-start refusals: ownership, retry target and file rules', async () => {
    expect(
      await scenario(async () => {
        const chatId = await newChat(s);
        provider.script = answer('ok');
        const responses: unknown[] = [];
        // A chat that does not exist, or belongs to someone else.
        responses.push(await generate(s, '00000000-0000-4000-8000-000000000000', { prompt: 'x' }));
        const other = await signUp(s.ctx);
        const otherChat = await newChat({ ctx: s.ctx, user: other });
        responses.push(await generate(s, otherChat, { prompt: 'x' }));
        // Retry targets: unknown, and a user message.
        responses.push(await generate(s, chatId, { prompt: 'x', retryMessageId: '00000000-0000-4000-8000-000000000001' }));
        await generate(s, chatId, { prompt: 'first' });
        const [userRow] = await s.ctx.db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.chatId, chatId), eq(messages.role, 'user')));
        responses.push(await generate(s, chatId, { prompt: 'x', retryMessageId: userRow!.id }));
        // A file already sent in another message, and someone else's file.
        const sent = await upload(s, 'once.txt', 'sent once', 'text/plain');
        responses.push(await generate(s, chatId, { prompt: 'with file', attachmentIds: [sent] }));
        const again = await newChat(s);
        responses.push(await generate(s, again, { prompt: 'same file', attachmentIds: [sent] }));
        const theirs = await upload({ ctx: s.ctx, user: other }, 'theirs.txt', 'not yours', 'text/plain');
        responses.push(await generate(s, again, { prompt: 'their file', attachmentIds: [theirs] }));
        // The per-chat file limit (N-10): two messages of ten, then one more.
        const full = await newChat(s);
        for (let batch = 0; batch < 2; batch += 1) {
          const ids: string[] = [];
          for (let i = 0; i < 10; i += 1) ids.push(await upload(s, `f${String(batch)}-${String(i)}.txt`, `file ${String(batch)} ${String(i)}`, 'text/plain'));
          responses.push(await generate(s, full, { prompt: `batch ${String(batch)}`, attachmentIds: ids }));
        }
        const extra = await upload(s, 'extra.txt', 'one too many', 'text/plain');
        responses.push(await generate(s, full, { prompt: 'one more', attachmentIds: [extra] }));
        return { chatId, responses: [...responses, await rowsOf(s, again), await rowsOf(s, full)] };
      }, false),
    ).toMatchSnapshot();
  });
});

/* -------------------------------------------------------------------------- Gemini adapter */

interface GeminiChunk {
  text?: string;
  functionCalls?: { id?: string; name: string; args?: Record<string, unknown> }[];
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  candidates?: { finishReason?: string; content?: { parts?: unknown[] } }[];
}

function chunks(list: GeminiChunk[]): AsyncIterable<GeminiChunk> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => Promise.resolve(i < list.length ? { value: list[i++]!, done: false } : { value: undefined, done: true }) };
    },
  };
}

describe('turn characterization: Gemini adapter wire', () => {
  const calls: string[] = [];
  const responses: AsyncIterable<GeminiChunk>[] = [];
  const client = {
    models: {
      generateContentStream: async (req: unknown) => {
        // Serialised at once: the adapter keeps building on the same contents array.
        calls.push(plain(req));
        const next = responses.shift();
        if (!next) throw new Error('no scripted Gemini response left');
        return next;
      },
    },
  };
  const s = {} as Session;

  beforeAll(async () => {
    const placeholder = await createTestApp({ ENABLE_TOOL_USE: 'true' });
    await placeholder.close();
    s.ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' }, new GeminiProvider(placeholder.cfg, client as never) as never);
    s.user = await signUp(s.ctx);
  });
  afterAll(async () => {
    await s.ctx.close();
  });

  it('a Gemini turn with a file and one tool round', async () => {
    const file = await upload(s, 'brief.txt', 'The brief says ship on Friday.', 'text/plain');
    const chatId = await newChat(s);
    responses.push(
      chunks([{ functionCalls: [{ id: 'g1', name: 'ask_user_input_v0', args: ASK }] }]),
      chunks([
        { text: 'Friday, per the brief.' },
        { usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 }, candidates: [{ finishReason: 'STOP' }] },
      ]),
    );
    const before = calls.length;
    const res = await generate(s, chatId, { prompt: 'When do we ship?', model: 'Gemini 3.8 Flash', attachmentIds: [file] });
    expect(
      normalise({ wire: calls.slice(before).map((c) => JSON.parse(c) as unknown), responses: [res], rows: await rowsOf(s, chatId) }),
    ).toMatchSnapshot();
  });
});

/* -------------------------------------------------------------------------- Claude adapter */

function claudeStream(final: { content: unknown[]; stop_reason: string; usage: Record<string, number> }, text?: string) {
  const events = text ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }] : [];
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return { next: () => Promise.resolve(i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true }) };
    },
    finalMessage: () => Promise.resolve(final),
  };
}

describe('turn characterization: Claude adapter wire', () => {
  const calls: string[] = [];
  const responses: ReturnType<typeof claudeStream>[] = [];
  const client = {
    messages: {
      stream: (params: unknown, options: unknown) => {
        calls.push(plain({ params, options }));
        return responses.shift()!;
      },
    },
  };
  const s = {} as Session;

  beforeAll(async () => {
    const placeholder = await createTestApp({ ENABLE_TOOL_USE: 'true' });
    await placeholder.close();
    s.ctx = await createTestApp({ ENABLE_TOOL_USE: 'true' }, new AnthropicProvider(placeholder.cfg, client as never) as never);
    s.user = await signUp(s.ctx);
  });
  afterAll(async () => {
    await s.ctx.close();
  });

  it('a Claude turn with a file and one tool round', async () => {
    const file = await upload(s, 'brief.txt', 'The brief says ship on Friday.', 'text/plain');
    const chatId = await newChat(s);
    responses.push(
      claudeStream({
        content: [{ type: 'tool_use', id: 'c1', name: 'ask_user_input_v0', input: ASK }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
      }),
      claudeStream(
        { content: [{ type: 'text', text: 'Friday.' }], stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 } },
        'Friday.',
      ),
    );
    const before = calls.length;
    const res = await generate(s, chatId, { prompt: 'When do we ship?', model: 'Sonnet 5.5', attachmentIds: [file] });
    expect(
      normalise({ wire: calls.slice(before).map((c) => JSON.parse(c) as unknown), responses: [res], rows: await rowsOf(s, chatId) }),
    ).toMatchSnapshot();
  });
});

/* -------------------------------------------------------------------------- long texts */

describe('turn characterization: long texts', () => {
  it('every long text and large structure the scenarios referenced, by sha256', () => {
    expect(Object.fromEntries([...longTexts.entries()].sort(([a], [b]) => a.localeCompare(b)))).toMatchSnapshot();
  });
});
