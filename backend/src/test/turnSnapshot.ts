/**
 * The normaliser, fake provider and helpers of the turn characterization snapshots, shared by
 * `turnCharacterization.integration.test.ts` (the first 14) and
 * `turnCharacterizationPaths.integration.test.ts` (the paths added for P05's split). Moved out of
 * the first file unchanged; its snapshot file did not change with the move.
 *
 * See the first file's header for what the normaliser replaces and why.
 */
import { createHash } from 'node:crypto';

import { and, asc, eq, inArray } from 'drizzle-orm';
import { expect } from 'vitest';

import { attachments, chats, messages, researchEvents, toolCalls, usageRecords } from '../db/schema.js';
import type { GenerationRequest, ProviderEvent } from '../providers/types.js';
import type { TestContext, TestUser } from './harness.js';
import { FakeProvider, multipart, parseSse } from './harness.js';

/* -------------------------------------------------------------------------- normaliser */

const LONG_TEXT = 1_000;
const LARGE_STRUCTURE = 4_000;
export const longTexts = new Map<string, unknown>();

const STORAGE_KEY = /\b[0-9a-f]{4}\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{16}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const DATE_LINE = /The current date is [^()]+? \(time zone ([^)]+)\)\./g;
/** The v3 per-turn time (ADR-0075): IST with offset and weekday. */
const CURRENT_TIME = /<current_time>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30 [A-Z][a-z]+day IST<\/current_time>/g;

export function plain(value: unknown): string {
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
export function normalise(value: unknown): unknown {
  const ids = new Map<string, number>();
  const text = plain(value)
    .replace(STORAGE_KEY, '<storage-key>')
    .replace(UUID, (id) => {
      const key = id.toLowerCase();
      if (!ids.has(key)) ids.set(key, ids.size + 1);
      return `<uuid-${String(ids.get(key))}>`;
    })
    .replace(ISO, '<iso>')
    .replace(DATE_LINE, 'The current date is <date> (time zone $1).')
    .replace(CURRENT_TIME, '<current_time><ist-now></current_time>');
  return extractLong(JSON.parse(text));
}

/* -------------------------------------------------------------------------- providers */

/** A fake whose next attempts are scripted as functions, so one can drive the real tool executor. */
export class AttemptsProvider extends FakeProvider {
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

export const usage = (inputTokens = 10, outputTokens = 2) => ({ inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true });
export const answer = (text: string): ProviderEvent[] => [
  { type: 'delta', text },
  { type: 'completed', usage: usage(), finishReason: 'stop' },
];
export const ASK = { questions: [{ question: 'Which one?', options: ['A', 'B'] }] };

/* -------------------------------------------------------------------------- helpers */

export interface Session {
  ctx: TestContext;
  user: TestUser;
}

export async function newChat(s: Session, title = 'New conversation'): Promise<string> {
  const res = await s.ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: s.user.cookie }, payload: { title } });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

export async function generate(s: Session, chatId: string, payload: Record<string, unknown>) {
  const res = await s.ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: { cookie: s.user.cookie }, payload });
  return { statusCode: res.statusCode, frames: res.statusCode === 200 ? parseSse(res.body) : [], body: res.statusCode === 200 ? null : (res.json() as unknown) };
}

export async function upload(s: Session, filename: string, bytes: Buffer | string, mimeType: string): Promise<string> {
  const part = multipart(filename, bytes, mimeType);
  const res = await s.ctx.app.inject({ method: 'POST', url: '/v1/files', headers: { ...part.headers, cookie: s.user.cookie }, payload: part.payload });
  expect(res.statusCode, res.body).toBe(201);
  await s.ctx.app.services.files.idle();
  return (res.json() as { id: string }).id;
}

/** Every row the turns of this chat wrote, in a stable order, without timing columns. */
export async function rowsOf(s: Session, chatId: string) {
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
