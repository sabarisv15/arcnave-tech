/**
 * The forced answer: when the tool loop ended with no text, one more request, without tools,
 * asks for the answer from this turn's tool steps. Cut from the turn generator unchanged
 * (ADR-0073); it returns the answer's text, which the turn kept in a local.
 *
 * P11 (ADR-0081): the request goes through the gateway (its retries, the breaker), on the model
 * that served the turn, with no hop. A Stop during it ends the turn `stopped`, the deadline
 * `turn_deadline_exceeded` (DEFERRED P11). An answer cut at the output limit with no text is not
 * forced (M-25: the same request would only spend the limit again): it ends `empty_response`
 * with finish `max_tokens`.
 */
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { isOutputLimit } from '../../providers/finish.js';
import type { ProviderGateway } from '../../providers/gateway.js';
import type { ModelEntry } from '../../providers/registry.js';
import { type GenerationRequest, type Provider, isAbort, toolCallAsText, usageFromCalls } from '../../providers/types.js';
import { isTypedStop } from './providerLoop.js';
import { neutraliseReservedTags } from '../prompt/reservedTags.js';
import type { TurnLog } from '../turnLog.js';
import { type StreamEvent, toUsageDto } from './events.js';
import type { TurnState } from './turnState.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

/** The turn's values the forced answer reads, besides its state. */
export interface ForcedAnswerInput {
  request: GenerationRequest;
  provider: Provider;
  /** P11: the model that served the turn, and the gateway its forced answer goes through. */
  entry: ModelEntry;
  gateway: ProviderGateway;
  /** The turn's signal (its abort reason says Stop, deadline or shutdown). */
  signal: AbortSignal;
  deadlineAt?: number;
  turnLog: TurnLog;
  addSegment: (type: 'thinking' | 'text', text: string) => void;
}

export async function* forcedAnswer(
  state: TurnState,
  turn: ForcedAnswerInput,
  text: string,
): AsyncGenerator<StreamEvent, string> {
  const { request, provider, entry, gateway, signal, turnLog, addSegment } = turn;
  // Guaranteed Final Outcome: synthesize text if tool loop finished blank. Not after a provider
  // failure that ended the turn partial: it ends with what it has (ER-2b).
  if (state.status === 'complete' && !state.endedPartial && text.trim().length === 0 && !isOutputLimit(state.finishReason)) {
    turnLog.stage('empty reply', { note: 'the tool loop ended with no text; one more request, without tools, asks for the answer' });
    try {
      // The loop's tool steps live only in the adapter's own request, so they are written into
      // this one: an answer "from the results above" with no results in the request is a re-do.
      // Tool output (a fetched page, a viewed file) joins the user turn here: it must not forge a block.
      const workDone = neutraliseReservedTags(state.turnCalls.map((c) => toolCallAsText(c)).join('\n\n'));
      const synthesisRequest: GenerationRequest = {
        ...request,
        tools: [],
        toolExecutor: undefined,
        prompt:
          request.prompt +
          (workDone ? `\n\n<this_turn_tool_steps>\n${workDone}\n</this_turn_tool_steps>` : '') +
          `\n\n[System Instruction: Answer the user now from the conversation${workDone ? " and this turn's tool steps above" : ''}. ` +
          'Do not call a tool. If the work is not finished, say what is done and what remains.]',
      };
      // P22 + P11: the gateway writes the forced answer's rows (role `forced_answer`) into the
      // turn's calls, failed attempts included.
      const synthesisStream = gateway.call(
        { entry, provider, request: synthesisRequest },
        {
          signal,
          ...(turn.deadlineAt !== undefined ? { deadlineAt: turn.deadlineAt } : {}),
          calls: state.calls,
          callRole: 'forced_answer',
        },
      );
      for await (const event of synthesisStream) {
        if (event.type === 'call_usage') {
          // A second request of the same turn: billed on top of the first (its own call row).
          state.usage = usageFromCalls(state.calls);
          continue;
        }
        if (event.type === 'delta' && event.text) {
          const safe = state.answerGuard.push(event.text);
          state.collectedText.push(safe);
          addSegment('text', safe);
          turnLog.text(safe);
          if (safe) yield { type: 'delta', text: safe };
        } else if (event.type === 'completed') {
          const tail = state.answerGuard.finish();
          if (tail) {
            state.collectedText.push(tail);
            addSegment('text', tail);
            turnLog.text(tail);
            yield { type: 'delta', text: tail };
          }
          // An adapter that reports only the whole call gets its row from `completed` (gateway).
          // The forced answer is one request, so its own size is the last request's.
          const last = state.calls.at(-1);
          if (last?.role === 'forced_answer' && last.usage.exact && !last.usage.lastRequest) {
            last.usage = { ...last.usage, lastRequest: { inputTokens: last.usage.inputTokens, outputTokens: last.usage.outputTokens } };
          }
          state.usage = usageFromCalls(state.calls);
          // A loop that ran out of tool steps stays marked so: the user is offered Continue, and
          // the forced answer's own "stop" must not hide that the work was cut short.
          if (state.finishReason !== 'tool_limit') state.finishReason = event.finishReason;
        }
      }
      text = state.collectedText.join('');
    } catch (synthErr) {
      log.warn({ err: synthErr }, 'Forced synthesis round failed');
      // A failed forced-answer request has its own row (gateway); the turn is still their sum.
      state.usage = usageFromCalls(state.calls);
      if (signal.aborted && isTypedStop(signal.reason)) {
        // The deadline (or a shutdown) during the forced answer: that code, not `empty_response`.
        const reason = signal.reason;
        state.status = 'error';
        state.errorCode = reason.code;
        text = state.collectedText.join('');
        yield { type: 'error', code: reason.code, title: reason.title, detail: reason.detail, usage: toUsageDto(state.usage, null) };
      } else if (signal.aborted || isAbort(synthErr)) {
        // A Stop during the forced answer is a Stop.
        state.status = 'cancelled';
        text = state.collectedText.join('');
      } else if (synthErr instanceof ApiError && synthErr.code === 'turn_deadline_exceeded') {
        state.status = 'error';
        state.errorCode = synthErr.code;
        text = state.collectedText.join('');
        yield { type: 'error', code: synthErr.code, title: synthErr.title, detail: synthErr.detail, usage: toUsageDto(state.usage, null) };
      } else if (synthErr instanceof ApiError && synthErr.code === 'tool_protocol_in_text') {
        state.status = 'error';
        state.errorCode = synthErr.code;
        text = state.collectedText.join('');
        yield { type: 'error', code: synthErr.code, title: synthErr.title, detail: synthErr.detail, usage: toUsageDto(state.usage, null) };
      }
    }
  }
  // Still no text, and nothing else ended the turn: say so (an empty answer is never `done`).
  if (state.status === 'complete' && !state.endedPartial && text.trim().length === 0) {
    state.status = 'error';
    state.errorCode = 'empty_response';
    const emptyApi = new ApiError('empty_response');
    yield {
      type: 'error',
      code: emptyApi.code,
      title: emptyApi.title,
      detail: emptyApi.detail,
      usage: toUsageDto(state.usage, null),
    };
  }
  return text;
}
