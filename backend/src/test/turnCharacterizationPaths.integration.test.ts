/**
 * Characterization snapshots of the turn paths the first 14 scenarios do not reach (task
 * tech-p05, step 0). Written on the unsplit `runTurn`, before it was split into stage generators;
 * the split is behaviour-neutral exactly when these snapshots and the first file's do not change.
 *
 * Each scenario records, besides the provider requests, the SSE frames and the rows of
 * `turnCharacterization.integration.test.ts`:
 * - `effects`: the turn's side effects in the order they ran, interleaved with every event the
 *   turn generator yielded (`usage.reserve` / `usage.release` / `usage.record`, workspace create
 *   and cleanup, `yield <type>`), so a moved `release` or `record` shows up as a reordering;
 * - `counts`: terminal frames (`done` or `error`) per response, and how many times each effect ran.
 *   `usage.release` is what `releaseReservation` does the one time it acts: the closure is
 *   idempotent, so a second call is not visible and does not need to be;
 * - `turnLogs`: the `turn_logs` row of every assistant message, line by line, with stage times,
 *   the timing summary and the error stack (whose file:line numbers move with any code move)
 *   replaced; the stage names, their order and every fact they log are kept;
 * - `sources`: the `message_sources` rows.
 *
 * Every scenario also asserts the one thing its path exists for (a `ui_block` frame, no `done`
 * after a stop, ...), so a scenario cannot pass by drifting away from the path it names.
 * The proof that each fails when its branch is broken is in `docs/ops/p05-result.md`.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { messages, messageSources, turnLogs, usageCounters } from '../db/schema.js';
import type { GenerationRequest, ProviderEvent, ProviderSource } from '../providers/types.js';
import { ModelNotFoundError, ProviderError } from '../providers/types.js';
import { compactionTrigger, SUMMARY_PROMPT } from '../services/compaction/autoCompact.js';
import type { TestContext } from './harness.js';
import { pdfWithPages } from './fixtures/files.js';
import { createTestApp, multipart, postProjectFile, promptOf, signUp } from './harness.js';
import { answer, ASK, AttemptsProvider, freezeSnapshotClock, generate, longTexts, newChat, normalise, plain, rowsOf, type Session, upload, usage } from './turnSnapshot.js';

freezeSnapshotClock();

/* -------------------------------------------------------------------------- instruments */

type Frame = { event: string; data: Record<string, unknown> };
type Response = Awaited<ReturnType<typeof generate>>;

/** Records the turn's side effects and yields, in order, on the app's own service instances. */
function instrument(ctx: TestContext): string[] {
  const effects: string[] = [];
  const { usage: ledger, executionRuntime, generation } = ctx.app.services;
  const reserve = ledger.reserve.bind(ledger);
  vi.spyOn(ledger, 'reserve').mockImplementation(async (...args: Parameters<typeof reserve>) => {
    effects.push('usage.reserve');
    try {
      return await reserve(...args);
    } catch (err) {
      effects.push(`usage.reserve threw ${(err as { code?: string }).code ?? 'unknown'}`);
      throw err;
    }
  });
  const release = ledger.release.bind(ledger);
  vi.spyOn(ledger, 'release').mockImplementation(async (...args: Parameters<typeof release>) => {
    effects.push('usage.release');
    await release(...args);
  });
  const record = ledger.record.bind(ledger);
  vi.spyOn(ledger, 'record').mockImplementation(async (...args: Parameters<typeof record>) => {
    effects.push(`usage.record ${args[0].status}${args[0].errorCode ? ` ${args[0].errorCode}` : ''}`);
    return record(...args);
  });
  const create = executionRuntime.createWorkspace.bind(executionRuntime);
  vi.spyOn(executionRuntime, 'createWorkspace').mockImplementation(async (...args: Parameters<typeof create>) => {
    effects.push('workspace.create');
    return create(...args);
  });
  const cleanup = executionRuntime.cleanupWorkspace.bind(executionRuntime);
  vi.spyOn(executionRuntime, 'cleanupWorkspace').mockImplementation(async (...args: Parameters<typeof cleanup>) => {
    effects.push('workspace.cleanup');
    return cleanup(...args);
  });
  const run = generation.run.bind(generation);
  vi.spyOn(generation, 'run').mockImplementation(async function* (input) {
    effects.push('run.start');
    try {
      for await (const event of run(input)) {
        effects.push(`yield ${event.type}`);
        yield event;
      }
      effects.push('run.end');
    } catch (err) {
      effects.push(`run.threw ${(err as { code?: string }).code ?? 'unknown'}`);
      throw err;
    }
  });
  return effects;
}

function countsOf(responses: Response[], effects: string[]) {
  const times = (name: string) => effects.filter((e) => e === name || e.startsWith(`${name} `)).length;
  return {
    terminalEvents: responses.map((r) => r.frames.filter((f) => f.event === 'done' || f.event === 'error').length),
    reserve: times('usage.reserve') - times('usage.reserve threw'),
    release: times('usage.release'),
    record: times('usage.record'),
    workspaceCreate: times('workspace.create'),
    workspaceCleanup: times('workspace.cleanup'),
  };
}

/** Stage times, the timing summary and the stack: the values that change from run to run. */
function turnLogLines(markdown: string): string[] {
  const out: string[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]!;
    // The stack under "## Where it failed": its file:line numbers move with any code move.
    if (line.startsWith('- Error:') && lines[i + 1] === '' && /^`{3,}$/.test(lines[i + 2] ?? '')) {
      const fenceMark = lines[i + 2]!;
      let end = i + 3;
      while (end < lines.length && lines[end] !== fenceMark) end += 1;
      out.push(line, '', fenceMark, '<stack>', fenceMark);
      i = end;
      continue;
    }
    line = line
      // `<chatId>_<messageId>`: the `_` keeps the normaliser's \b-bounded UUID pattern from matching.
      .replace(/(runId: [0-9a-f-]{36})_([0-9a-f-]{36})/, '$1 _ $2')
      .replace(/\| \d+\.\d{2} s \| \d+ ms \|/, '| <s> s | <ms> ms |')
      .replace(/\(at \d+\.\d s(, took \d+\.\d s)?\)/, (_m, took?: string) => `(at <s> s${took ? ', took <s> s' : ''})`)
      .replace(/^- Took: \d+\.\d s$/, '- Took: <s> s')
      .replace(/"(model|tools|longestModelWait|totalMs)":\d+/g, '"$1":0')
      .replace(/"phasesMs":\{[^}]*\}/g, (m) => m.replace(/":\d+/g, '":0'));
    out.push(line);
  }
  return out;
}

/** The rows `rowsOf` does not read: the turn logs and the sources. */
async function moreRowsOf(ctx: TestContext, chatId: string) {
  const ids = (await ctx.db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.seq))).map((m) => m.id);
  if (ids.length === 0) return { turnLogs: [], sources: [] };
  const logs = await ctx.db.select({ messageId: turnLogs.messageId, markdown: turnLogs.markdown }).from(turnLogs).where(inArray(turnLogs.messageId, ids));
  const sources = await ctx.db
    .select({ messageId: messageSources.messageId, ordinal: messageSources.ordinal, title: messageSources.title, url: messageSources.url, domain: messageSources.domain, snippet: messageSources.snippet })
    .from(messageSources)
    .where(inArray(messageSources.messageId, ids))
    .orderBy(asc(messageSources.messageId), asc(messageSources.ordinal));
  return {
    // One array of lines per log (its first line names the message), kept two levels down so the
    // normaliser leaves the lines inline rather than storing the log once by hash.
    turnLogs: ids.flatMap((id) => logs.filter((l) => l.messageId === id).map((l) => turnLogLines(l.markdown))),
    sources,
  };
}

interface PathSession extends Session {
  provider: AttemptsProvider;
  effects: string[];
}

async function openSession(env: Record<string, string>, seams: Parameters<typeof createTestApp>[2] = {}): Promise<PathSession> {
  const provider = new AttemptsProvider();
  const ctx = await createTestApp(env, provider, seams);
  return { ctx, user: await signUp(ctx), provider, effects: instrument(ctx) };
}

async function scenario(
  s: PathSession,
  run: () => Promise<{ chatId: string; responses: Response[]; extra?: unknown }>,
) {
  s.provider.attempts = [];
  s.provider.streamError = null;
  s.provider.onRequest = null;
  s.provider.grounding = true;
  s.provider.codeExecutionSupported = false;
  s.provider.script = answer('Hello, world.');
  s.effects.length = 0;
  const before = s.provider.seen.length;
  const { chatId, responses, extra } = await run();
  return normalise(blockIdsNumbered({
    requests: s.provider.seen.slice(before),
    responses,
    effects: [...s.effects],
    counts: countsOf(responses, s.effects),
    rows: await rowsOf(s, chatId),
    ...(await moreRowsOf(s.ctx, chatId)),
    ...(extra !== undefined ? { extra } : {}),
  }));
}

/** A visual's block id is random (`blk_` and 12 hex): numbered by first appearance, as the UUIDs are. */
function blockIdsNumbered(record: unknown): unknown {
  const ids = new Map<string, number>();
  return JSON.parse(
    plain(record).replace(/\bblk_[0-9a-f]{12}\b/g, (id) => {
      if (!ids.has(id)) ids.set(id, ids.size + 1);
      return `<block-${String(ids.get(id))}>`;
    }),
  ) as unknown;
}

const frameTypes = (r: Response) => r.frames.map((f: Frame) => f.event);
const aborted = () => new DOMException('The operation was aborted.', 'AbortError');

/* -------------------------------------------------------------------------- main app */

describe('turn characterization paths', () => {
  let s: PathSession;

  beforeAll(async () => {
    // The computer's tools are declared (view reads a skill), and a small project limit makes a
    // small fixture cross into search.
    s = await openSession({ ENABLE_TOOL_USE: 'true', ENABLE_RUN_PYTHON: 'true', SANDBOX_ENGINE: 'process', PROJECT_FULL_CONTEXT_MAX_CHARS: '20000' });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await s.ctx.close();
  });

  it('(1) stop mid-stream: no done, the row stopped, the reservation released once', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      let stopped: unknown;
      s.provider.attempts = [
        async function* (request) {
          yield { type: 'thinking', text: 'Thinking first.' };
          yield { type: 'delta', text: 'Before the stop. ' };
          const res = await s.ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/stop`, headers: { cookie: s.user.cookie } });
          stopped = res.json();
          if (request.signal.aborted) throw aborted();
          yield* answer('Never sent.');
        },
      ];
      const res = await generate(s, chatId, { prompt: 'Start, then stop.' });
      expect(frameTypes(res)).not.toContain('done');
      return { chatId, responses: [res], extra: { stopped } };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(3) compaction: the summary request, then the answer on the reloaded history', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      const responses: Response[] = [];
      for (const prompt of ['Turn 1', 'Turn 2', 'Turn 3']) responses.push(await generate(s, chatId, { prompt }));
      s.provider.script = [
        { type: 'delta', text: 'ok' },
        { type: 'completed', usage: usage(compactionTrigger(s.ctx.cfg.COMPACTION_TRIGGER_TOKENS, 1_000_000), 1), finishReason: 'stop' },
      ];
      responses.push(await generate(s, chatId, { prompt: 'Turn 4' }));
      s.provider.onRequest = async (request: GenerationRequest) => {
        s.provider.script =
          request.prompt === SUMMARY_PROMPT
            ? [{ type: 'delta', text: '<summary>Turns 1 to 2 asked nothing.</summary>' }, { type: 'completed', usage: usage(900, 40), finishReason: 'stop' }]
            : answer('After the compaction.');
      };
      const last = await generate(s, chatId, { prompt: 'Turn 5' });
      responses.push(last);
      expect(last.frames.some((f) => f.event === 'research' && JSON.stringify(f.data).includes('Conversation compacted'))).toBe(true);
      return { chatId, responses };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(4) a context overflow is retried once on a shorter history', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      const responses: Response[] = [];
      for (const prompt of ['Earlier 1', 'Earlier 2']) responses.push(await generate(s, chatId, { prompt }));
      s.provider.attempts = [
        // eslint-disable-next-line require-yield
        async function* () {
          throw new ProviderError('input token count exceeds the maximum', { code: 'context_overflow' });
        },
        async function* () {
          yield* answer('Answered on less history.');
        },
      ];
      const last = await generate(s, chatId, { prompt: 'Now the big one.' });
      responses.push(last);
      expect(frameTypes(last).at(-1)).toBe('done');
      return { chatId, responses };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(5) sources and the search entry point', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      const source = (n: number): ProviderSource => ({
        title: `Source ${String(n)}`,
        url: `https://example.org/${String(n)}`,
        domain: 'example.org',
        snippet: `Snippet ${String(n)}.`,
        passage: `Passage ${String(n)}.`,
        urlResolved: true,
        sourceType: 'Web',
        retrievedAt: new Date('2026-10-01T00:00:00Z'),
      });
      s.provider.script = [
        { type: 'sources', sources: [source(1), source(2)], searchEntryPoint: '<div class="chips">search</div>' },
        { type: 'delta', text: 'Cited answer.' },
        { type: 'completed', usage: usage(), finishReason: 'stop' },
      ];
      const res = await generate(s, chatId, { prompt: 'Look it up.', mode: 'search' });
      expect(frameTypes(res)).toContain('sources');
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(6) code events', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.codeExecutionSupported = true;
      s.provider.script = [
        { type: 'code', code: 'print(6 * 7)', language: 'python' },
        { type: 'code', output: '42\n' },
        { type: 'delta', text: 'It is 42.' },
        { type: 'completed', usage: usage(), finishReason: 'stop' },
      ];
      const res = await generate(s, chatId, { prompt: 'Compute it.', codeExecution: true });
      expect(frameTypes(res).filter((t) => t === 'code')).toHaveLength(2);
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(7) a visual: ui_draft pieces, then its ui_block drained after the tool result', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      const draft = (html: string): ProviderEvent => ({
        type: 'tool_input_partial',
        index: 0,
        name: 'show_widget',
        input: { title: 'square', loading_messages: ['Drawing a square'], widget_code: html },
      });
      s.provider.attempts = [
        async function* (request) {
          yield draft('<svg viewBox="0 0 10 10">');
          yield draft('<svg viewBox="0 0 10 10"><rect width="5" height="5"/>');
          yield draft('<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>');
          const call = {
            id: 'call_ui',
            name: 'show_widget',
            input: { title: 'square', loading_messages: ['Drawing a square'], widget_code: '<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>' },
          };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          yield { type: 'delta', text: 'Here is the square.' };
          yield { type: 'completed', usage: usage(), finishReason: 'stop' };
        },
      ];
      const res = await generate(s, chatId, { prompt: 'Draw a square.' });
      expect(frameTypes(res)).toContain('ui_draft');
      expect(frameTypes(res)).toContain('ui_block');
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  /** A tool loop that ends at its step limit with no text: the forced answer follows. */
  const loopWithoutText = (id: string) =>
    async function* (request: GenerationRequest): AsyncGenerator<ProviderEvent> {
      const call = { id, name: 'ask_user_input_v0', input: ASK };
      yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
      const result = await request.toolExecutor!.execute(call, request.signal);
      yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
      yield { type: 'completed', usage: usage(30, 3), finishReason: 'tool_limit' };
    };

  it('(8a) the forced answer writes tool protocol as text: tool_protocol_in_text', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.attempts = [
        loopWithoutText('call_8a'),
        async function* () {
          yield { type: 'delta', text: '[Tool call] render_ui({"html":"x"})' };
          yield { type: 'completed', usage: usage(), finishReason: 'stop' };
        },
      ];
      const res = await generate(s, chatId, { prompt: 'Work it out.' });
      expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'tool_protocol_in_text' } });
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(8b) the forced answer request fails: empty_response', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.attempts = [
        loopWithoutText('call_8b'),
        // eslint-disable-next-line require-yield
        async function* () {
          throw new ProviderError('bad request', { retryable: false, statusCode: 400 });
        },
      ];
      const res = await generate(s, chatId, { prompt: 'Work it out.' });
      expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'empty_response' } });
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(8c) the forced answer comes back empty: empty_response', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.attempts = [
        loopWithoutText('call_8c'),
        async function* () {
          yield { type: 'completed', usage: usage(4, 0), finishReason: 'stop' };
        },
      ];
      const res = await generate(s, chatId, { prompt: 'Work it out.' });
      expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'empty_response' } });
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  // P11 (ADR-0081, DEFERRED tech-p05): a Stop during the forced answer is a Stop, saved
  // `stopped`, no longer `empty_response`. Changed deliberately; the old snapshot is retired.
  it('(8d) a stop during the forced answer: the request ends, saved as stopped', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.attempts = [
        loopWithoutText('call_8d'),
        async function* (request) {
          await s.ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/stop`, headers: { cookie: s.user.cookie } });
          if (request.signal.aborted) throw aborted();
          yield* answer('Never sent.');
        },
      ];
      const res = await generate(s, chatId, { prompt: 'Work it out.' });
      expect(res.frames.map((f) => f.event)).not.toContain('error');
      expect(res.frames.map((f) => f.event)).not.toContain('done');
      const [row] = await s.ctx.db.select({ status: messages.status }).from(messages).where(and(eq(messages.chatId, chatId), eq(messages.role, 'assistant')));
      expect(row?.status).toBe('stopped');
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(P) a failure after a tool ran ends the turn partial, with its counters', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.attempts = [
        async function* (request) {
          const call = { id: 'call_p', name: 'ask_user_input_v0', input: ASK };
          yield { type: 'delta', text: 'Partly done. ' };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          throw new ProviderError('Gemini request failed: 502', { retryable: true, statusCode: 502 });
        },
      ];
      const res = await generate(s, chatId, { prompt: 'Pick for me.' });
      expect(res.frames.at(-1)).toMatchObject({ event: 'done', data: { partial: true } });
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(R) a refusal and a provider failure that is not retried, with their counters', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.script = [
        { type: 'refusal', category: 'cyber', explanation: null },
        { type: 'completed', usage: usage(), finishReason: 'refusal' },
      ];
      const refused = await generate(s, chatId, { prompt: 'Something refused.' });
      s.provider.streamError = new ProviderError('bad request', { retryable: false, statusCode: 400 });
      const failed = await generate(s, chatId, { prompt: 'This fails.' });
      for (const res of [refused, failed]) expect(res.frames.at(-1)?.event).toBe('error');
      return { chatId, responses: [refused, failed] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(9) the provider says the model does not exist: model marked unavailable', async () => {
    const snap = await scenario(s, async () => {
      const { registry } = s.ctx.app.services;
      registry.invalidate();
      const chatId = await newChat(s);
      s.provider.streamError = new ModelNotFoundError('fake-flash', 'global');
      const res = await generate(s, chatId, { prompt: 'Which model?', model: 'Gemini 3.8 Flash' });
      const status = await registry.status('Gemini 3.8 Flash', { probe: 'never' });
      registry.invalidate();
      expect(status?.available).toBe(false);
      return { chatId, responses: [res], extra: { available: status?.available, detail: status?.detail ?? null } };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(10) the budget refuses the turn at usage.reserve', async () => {
    const owner = await signUp(s.ctx);
    const o: PathSession = { ...s, user: owner };
    const snap = await scenario(o, async () => {
      await s.ctx.app.inject({ method: 'PATCH', url: '/v1/usage/limits', headers: { cookie: owner.cookie }, payload: { dailyTokenBudget: 10 } });
      const chatId = await newChat(o);
      const first = await generate(o, chatId, { prompt: 'Spend the budget.' });
      const second = await generate(o, chatId, { prompt: 'One more.' });
      // P08 (ADR-0078): refused before any row is written, as HTTP 402, not as an error frame.
      expect(second).toMatchObject({ statusCode: 402, body: { error: { code: 'budget_exceeded' } } });
      const counters = await s.ctx.db
        .select({ periodKind: usageCounters.periodKind, tokensUsed: usageCounters.tokensUsed, tokensReserved: usageCounters.tokensReserved })
        .from(usageCounters)
        .where(eq(usageCounters.userId, owner.id))
        .orderBy(asc(usageCounters.periodKind));
      return { chatId, responses: [first, second], extra: { counters } };
    });
    expect(snap).toMatchSnapshot();
  });

  async function project(files: Record<string, string>): Promise<string> {
    const res = await s.ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: { cookie: s.user.cookie }, payload: { title: 'p' } });
    const projectId = (res.json() as { id: string }).id;
    for (const [name, body] of Object.entries(files)) {
      expect((await postProjectFile(s.ctx, { cookie: s.user.cookie }, projectId, multipart(name, Buffer.from(body), 'text/plain'))).statusCode).toBe(202);
    }
    return projectId;
  }

  async function projectChat(projectId: string): Promise<string> {
    const res = await s.ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: { cookie: s.user.cookie }, payload: { title: 'In a project', projectId } });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  // Distinct paragraphs, so the chunker splits the file and the search ranks parts of it.
  const doc = (tag: string, paragraphs: number) =>
    Array.from({ length: paragraphs }, (_, i) => `${tag} paragraph ${String(i)}: ${'lorem ipsum dolor '.repeat(12).trim()}`).join('\n\n');

  it('(11) a project chat past the whole-file limit: <project_knowledge> and the project executor', async () => {
    const snap = await scenario(s, async () => {
      const projectId = await project({ 'big.txt': `${doc('big', 150)}\n\nThe budget figure is 4200.` });
      const chatId = await projectChat(projectId);
      s.provider.attempts = [
        async function* (request) {
          const call = { id: 'call_proj', name: 'search_project_files', input: { query: 'budget figure', limit: 2 } };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          yield { type: 'delta', text: 'The budget figure is 4200.' };
          yield { type: 'completed', usage: usage(), finishReason: 'stop' };
        },
      ];
      const res = await generate(s, chatId, { prompt: 'What is the budget figure?' });
      expect(promptOf(s.provider.seen.at(-1)!)).toContain('<project_knowledge>\n');
      expect(res.frames.find((f) => f.event === 'tool_result')?.data).toMatchObject({ name: 'search_project_files', ok: true });
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(12) a skill read before a compaction is given back after it', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      const responses: Response[] = [];
      s.provider.script = [
        { type: 'tool_use', toolCallId: 'ls1', name: 'view', input: { path: '/skills/pdf/SKILL.md', description: 'read the skill' }, thoughtSignature: 'sig-ls1' },
        { type: 'tool_result', toolCallId: 'ls1', name: 'view', result: { toolCallId: 'ls1', ok: true, content: [{ type: 'text', text: 'pdf skill' }] } },
        { type: 'delta', text: 'read it' },
        { type: 'completed', usage: usage(1000, 1), finishReason: 'stop' },
      ];
      responses.push(await generate(s, chatId, { prompt: 'turn 1' }));
      s.provider.script = answer('ok');
      for (const prompt of ['turn 2', 'turn 3']) responses.push(await generate(s, chatId, { prompt }));
      s.provider.script = [
        { type: 'delta', text: 'ok' },
        { type: 'completed', usage: usage(compactionTrigger(s.ctx.cfg.COMPACTION_TRIGGER_TOKENS, 1_000_000), 1), finishReason: 'stop' },
      ];
      responses.push(await generate(s, chatId, { prompt: 'turn 4' }));
      s.provider.onRequest = async (request: GenerationRequest) => {
        s.provider.script = request.prompt === SUMMARY_PROMPT ? [{ type: 'delta', text: '<summary>s</summary>' }, { type: 'completed', usage: usage(5, 1), finishReason: 'stop' }] : answer('ok');
      };
      const last = await generate(s, chatId, { prompt: 'turn 5' });
      responses.push(last);
      expect(promptOf(s.provider.seen.at(-1)!)).toContain('### Skill read earlier: /skills/pdf/SKILL.md');
      expect(last.frames.find((f) => f.event === 'debug')?.data).toMatchObject({ trace: { loadedSkills: ['pdf'] } });
      return { chatId, responses };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(13) context events: a project file in full, then a tool call numbered after it', async () => {
    const snap = await scenario(s, async () => {
      const projectId = await project({ 'notes.txt': 'Notes: the budget is 4200.' });
      const chatId = await projectChat(projectId);
      s.provider.attempts = [
        async function* (request) {
          const call = { id: 'call_ctx', name: 'ask_user_input_v0', input: ASK };
          yield { type: 'tool_use', toolCallId: call.id, name: call.name, input: call.input };
          const result = await request.toolExecutor!.execute(call, request.signal);
          yield { type: 'tool_result', toolCallId: call.id, name: call.name, result };
          yield { type: 'delta', text: 'Pick one.' };
          yield { type: 'completed', usage: usage(), finishReason: 'stop' };
        },
      ];
      const res = await generate(s, chatId, { prompt: 'What is the budget?' });
      expect(res.frames.find((f) => f.event === 'research')?.data).toMatchObject({ event: { label: 'Using all 1 project file in full' } });
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(14) a turn with effort', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      const res = await generate(s, chatId, { prompt: 'Think hard.', model: 'Sonnet 5.5', effort: 'max' });
      // Sonnet 5.5 takes max; the default would be medium.
      expect(s.provider.seen.at(-1)!.reasoningEffort).toBe('max');
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(15) no adapter for the resolved model: model_unavailable before the stream', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      const spy = vi.spyOn(s.ctx.app.services.registry, 'providerFor').mockReturnValueOnce(undefined);
      const res = await generate(s, chatId, { prompt: 'Anyone there?' });
      spy.mockRestore();
      expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'model_unavailable' } });
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });

  it('(16) search and research asked for without grounding: capability_unavailable', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.grounding = false;
      const search = await generate(s, chatId, { prompt: 'Search it.', mode: 'search' });
      const research = await generate(s, chatId, { prompt: 'Research it.', mode: 'research' });
      for (const res of [search, research]) expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'capability_unavailable' } });
      return { chatId, responses: [search, research] };
    });
    expect(snap).toMatchSnapshot();
  });
});

/* -------------------------------------------------------------------------- model limits */

describe('turn characterization paths: a limit check that fails after the reservation', () => {
  let s: PathSession;

  beforeAll(async () => {
    // Gemini reads page images from a model-input store (ADR-0016); this one cannot store them, so
    // the model-limit step (limitToModel) fails after the budget was reserved.
    s = await openSession({ ENABLE_TOOL_USE: 'true' }, { modelInputs: { uriFor: () => Promise.reject(new Error('the model-input store is unavailable')) } });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await s.ctx.close();
  });

  it('(L) limitToModel fails: the reservation it was handed is released, then the error goes on', async () => {
    const snap = await scenario(s, async () => {
      const file = await upload(s, 'two.pdf', await pdfWithPages(2, ['Page one', 'Page two']), 'application/pdf');
      const chatId = await newChat(s);
      const res = await generate(s, chatId, { prompt: 'Read it.', model: 'Gemini 3.8 Flash', attachmentIds: [file] });
      expect(res.frames.at(-1)?.event).toBe('error');
      expect(s.effects).toContain('usage.release');
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });
});

/* -------------------------------------------------------------------------- the deadline */

describe('turn characterization paths: the turn deadline', () => {
  let s: PathSession;

  beforeAll(async () => {
    // Long enough for a warm turn to reach the provider; the provider then waits for the deadline.
    s = await openSession({ ENABLE_TOOL_USE: 'true', TURN_DEADLINE_MS: '4000' });
    await generate(s, await newChat(s), { prompt: 'Warm up.' });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await s.ctx.close();
  });

  it('(2) the deadline lands mid-stream: turn_deadline_exceeded, not a stop', async () => {
    const snap = await scenario(s, async () => {
      const chatId = await newChat(s);
      s.provider.attempts = [
        async function* (request) {
          yield { type: 'delta', text: 'Before the deadline. ' };
          await new Promise<void>((resolve) => {
            if (request.signal.aborted) resolve();
            else request.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw aborted();
        },
      ];
      const res = await generate(s, chatId, { prompt: 'Take your time.' });
      expect(res.frames.at(-1)).toMatchObject({ event: 'error', data: { code: 'turn_deadline_exceeded' } });
      return { chatId, responses: [res] };
    });
    expect(snap).toMatchSnapshot();
  });
});

/* -------------------------------------------------------------------------- long texts */

describe('turn characterization paths: long texts', () => {
  it('every long text and large structure the scenarios referenced, by sha256', () => {
    expect(Object.fromEntries([...longTexts.entries()].sort(([a], [b]) => a.localeCompare(b)))).toMatchSnapshot();
  });
});
