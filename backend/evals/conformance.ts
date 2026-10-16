/**
 * Provider conformance checks (tech-p03, E15): the small set of things the adapters promise,
 * checked against a real provider by `npm run conformance:live` and against a scripted fake by
 * `src/test/evalRunner.test.ts`. A check takes any `Provider`, so the logic is tested without
 * reaching one.
 *
 * Checks, per provider:
 *  1. streaming text      – more than one text delta, a normal finish
 *  2. tool round trip     – the model calls the tool, gets the mock result, and uses it
 *  3. exact usage         – the provider reported token counts (`exact`, non-zero)
 *  4. thinking replay     – a tool round trip with effort on is accepted by the provider (the
 *                           Claude thinking block and signature, or Gemini's thought signature,
 *                           are replayed inside the loop) and Gemini's signature is surfaced
 *  5. history replay      – the next turn, built from the first turn's tool call (with its
 *                           signature), is accepted
 *  6. typed error mapping – a bad model id comes back as ProviderError `model_unavailable`
 *
 * Nothing here logs or returns model text: a row carries a status, a short code and a latency.
 */
import type { GenerationRequest, Provider, ProviderEvent, ProviderUsage, ReasoningEffort, ToolDefinition, ToolExecutor, Turn } from '../src/providers/types.js';
import { ProviderError } from '../src/providers/types.js';

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckRow {
  provider: string;
  check: string;
  status: CheckStatus;
  /** A short code, never provider or model text. */
  code: string;
  latencyMs: number;
}

export interface ConformanceTarget {
  /** Label for the table (`gemini` / `claude`). */
  label: string;
  provider: Provider;
  providerModelId: string;
  /** The effort level used for the thinking checks. */
  effort: ReasoningEffort;
}

const SYSTEM = 'You are a conformance test assistant. Follow the instruction exactly and keep answers short.';
const SECRET = 'purple';

const LOOKUP_TOOL: ToolDefinition = {
  name: 'lookup_code',
  description: 'Looks up the colour registered for a code. Always use it when asked for a code\'s colour.',
  inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'The code, e.g. ZX-41' } }, required: ['code'] },
};

class RecordingExecutor implements ToolExecutor {
  readonly inputs: unknown[] = [];

  execute(call: { id: string; input: unknown }): Promise<{ toolCallId: string; ok: boolean; content: Array<{ type: 'text'; text: string }> }> {
    this.inputs.push(call.input);
    return Promise.resolve({ toolCallId: call.id, ok: true, content: [{ type: 'text', text: JSON.stringify({ colour: SECRET }) }] });
  }
}

interface Collected {
  text: string;
  deltas: number;
  thinking: number;
  toolUses: Array<{ name: string; toolCallId: string; input: unknown; thoughtSignature?: string }>;
  toolResults: number;
  usage: ProviderUsage | null;
  finishReason: string;
}

async function collect(provider: Provider, request: GenerationRequest): Promise<Collected> {
  const out: Collected = { text: '', deltas: 0, thinking: 0, toolUses: [], toolResults: 0, usage: null, finishReason: 'none' };
  for await (const event of provider.stream(request) as AsyncIterable<ProviderEvent>) {
    if (event.type === 'delta') {
      out.text += event.text;
      out.deltas += 1;
    } else if (event.type === 'thinking') out.thinking += 1;
    else if (event.type === 'tool_use') out.toolUses.push({ name: event.name, toolCallId: event.toolCallId, input: event.input, ...(event.thoughtSignature ? { thoughtSignature: event.thoughtSignature } : {}) });
    else if (event.type === 'tool_result') out.toolResults += 1;
    else if (event.type === 'completed') {
      out.usage = event.usage;
      out.finishReason = event.finishReason;
    }
  }
  return out;
}

function base(t: ConformanceTarget, prompt: string, over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    prompt,
    history: [],
    systemInstruction: SYSTEM,
    mode: 'chat',
    maxOutputTokens: 1500,
    providerModelId: t.providerModelId,
    grounded: false,
    codeExecution: false,
    signal: AbortSignal.timeout(120_000),
    ...over,
  };
}

const TOOL_PROMPT = 'What colour is registered for code ZX-41? Use the tool, then answer with the colour in one short sentence.';

async function timed(t: ConformanceTarget, check: string, work: () => Promise<{ status: CheckStatus; code: string }>): Promise<CheckRow> {
  const started = Date.now();
  try {
    const { status, code } = await work();
    return { provider: t.label, check, status, code, latencyMs: Date.now() - started };
  } catch (err) {
    const code = err instanceof ProviderError ? err.code : err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'threw';
    return { provider: t.label, check, status: 'fail', code: `error:${code}`, latencyMs: Date.now() - started };
  }
}

export async function runConformance(t: ConformanceTarget): Promise<CheckRow[]> {
  const rows: CheckRow[] = [];

  rows.push(
    await timed(t, 'streaming text', async () => {
      const got = await collect(t.provider, base(t, 'Count from 1 to 30 separated by spaces and write nothing else.'));
      if (got.deltas < 2) return { status: 'fail', code: `deltas:${String(got.deltas)}` };
      if (got.text.trim().length === 0) return { status: 'fail', code: 'empty' };
      return { status: 'pass', code: `deltas:${String(got.deltas)} finish:${got.finishReason}` };
    }),
  );

  // Checks 2-4 share one request; each reads its own facts from it.
  const executor = new RecordingExecutor();
  let trip: Collected | null = null;
  let tripError: string | null = null;
  const tripRow = await timed(t, 'tool call round trip', async () => {
    trip = await collect(t.provider, base(t, TOOL_PROMPT, { tools: [LOOKUP_TOOL], toolExecutor: executor, reasoningEffort: t.effort }));
    const called = trip.toolUses.find((u) => u.name === LOOKUP_TOOL.name);
    if (!called) return { status: 'fail', code: 'no_tool_call' };
    if (executor.inputs.length === 0) return { status: 'fail', code: 'executor_not_called' };
    if (!trip.text.toLowerCase().includes(SECRET)) return { status: 'fail', code: 'result_not_used' };
    return { status: 'pass', code: `calls:${String(trip.toolUses.length)}` };
  });
  if (tripRow.status === 'fail' && tripRow.code.startsWith('error:')) tripError = tripRow.code;
  rows.push(tripRow);

  const got = trip as Collected | null;
  rows.push({
    provider: t.label,
    check: 'exact usage metadata',
    status: got === null ? 'skip' : got.usage?.exact && got.usage.inputTokens > 0 && got.usage.outputTokens > 0 ? 'pass' : 'fail',
    code: got === null ? (tripError ?? 'no_response') : got.usage === null ? 'no_usage' : got.usage.exact ? `in:${String(got.usage.inputTokens)} out:${String(got.usage.outputTokens)}` : 'exact:false',
    latencyMs: 0,
  });

  const needsSignature = t.label === 'gemini';
  rows.push({
    provider: t.label,
    check: 'thinking replay (in loop)',
    status: got === null || tripRow.status !== 'pass' ? 'skip' : needsSignature && !got.toolUses.some((u) => u.thoughtSignature) ? 'fail' : 'pass',
    code:
      got === null || tripRow.status !== 'pass'
        ? 'round_trip_not_passed'
        : needsSignature
          ? got.toolUses.some((u) => u.thoughtSignature) ? 'thought_signature_surfaced' : 'no_thought_signature'
          : `round_trip_accepted thinking_events:${String(got.thinking)}`,
    latencyMs: 0,
  });

  rows.push(
    await timed(t, 'history replay (next turn)', async () => {
      if (got === null || tripRow.status !== 'pass') return { status: 'skip', code: 'round_trip_not_passed' };
      const call = got.toolUses[0]!;
      const history: Turn[] = [
        { role: 'user', text: TOOL_PROMPT },
        {
          role: 'assistant',
          text: got.text,
          toolCalls: [
            {
              id: call.toolCallId,
              name: call.name,
              input: call.input,
              result: { toolCallId: call.toolCallId, ok: true, content: [{ type: 'text', text: JSON.stringify({ colour: SECRET }) }] },
              ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
            },
          ],
        },
      ];
      const next = await collect(t.provider, base(t, 'Repeat the colour you found, in one word.', { history, tools: [LOOKUP_TOOL], toolExecutor: new RecordingExecutor(), reasoningEffort: t.effort }));
      return next.text.toLowerCase().includes(SECRET) ? { status: 'pass', code: 'replayed' } : { status: 'fail', code: 'colour_not_recalled' };
    }),
  );

  rows.push(
    await timed(t, 'typed error on bad model id', async () => {
      try {
        await collect(t.provider, base(t, 'Say ok.', { providerModelId: 'arcnave-conformance-no-such-model', maxOutputTokens: 20 }));
        return { status: 'fail', code: 'no_error' };
      } catch (err) {
        if (err instanceof ProviderError && err.code === 'model_unavailable') return { status: 'pass', code: 'model_unavailable' };
        return { status: 'fail', code: err instanceof ProviderError ? `wrong_code:${err.code}` : 'untyped' };
      }
    }),
  );

  return rows;
}

export function formatConformance(rows: CheckRow[]): string {
  return [
    '| provider | check | result | code | latency ms |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.provider} | ${r.check} | ${r.status} | ${r.code} | ${String(r.latencyMs)} |`),
  ].join('\n');
}
