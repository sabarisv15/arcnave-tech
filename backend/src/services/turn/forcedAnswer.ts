/**
 * The forced answer: when the tool loop ended with no text, one more request, without tools,
 * asks for the answer from this turn's tool steps. Cut from the turn generator unchanged
 * (ADR-0073); it returns the answer's text, which the turn kept in a local.
 */
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { type GenerationRequest, type Provider, toolCallAsText } from '../../providers/types.js';
import { neutraliseReservedTags } from '../prompt/reservedTags.js';
import type { TurnLog } from '../turnLog.js';
import { type StreamEvent, toUsageDto } from './events.js';
import { type TurnState, addCall, addCallFromCompleted } from './turnState.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

/** The turn's values the forced answer reads, besides its state. */
export interface ForcedAnswerInput {
  request: GenerationRequest;
  provider: Provider;
  turnLog: TurnLog;
  addSegment: (type: 'thinking' | 'text', text: string) => void;
}

export async function* forcedAnswer(
  state: TurnState,
  turn: ForcedAnswerInput,
  text: string,
): AsyncGenerator<StreamEvent, string> {
  const { request, provider, turnLog, addSegment } = turn;
  // Guaranteed Final Outcome: synthesize text if tool loop finished blank. Not after a provider
  // failure that ended the turn partial: it ends with what it has (ER-2b).
  if (state.status === 'complete' && !state.endedPartial && text.trim().length === 0) {
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
      const synthesisStream = provider.stream(synthesisRequest);
      let reported = 0;
      for await (const event of synthesisStream) {
        if (event.type === 'call_usage') {
          // P22: the forced answer's own request, a row of its own in the ledger.
          addCall(state, event, 'forced_answer', request.providerModelId, new Date());
          reported += 1;
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
          // A second request of the same turn: billed on top of the first (its own call row).
          // One request, so its own size is the last request's (as `addRequestUsage` counted it).
          const own = event.usage.exact && !event.usage.lastRequest
            ? { ...event.usage, lastRequest: { inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens } }
            : event.usage;
          if (reported === 0) addCallFromCompleted(state, own, event.finishReason, 'forced_answer', request.providerModelId);
          // A loop that ran out of tool steps stays marked so: the user is offered Continue, and
          // the forced answer's own "stop" must not hide that the work was cut short.
          if (state.finishReason !== 'tool_limit') state.finishReason = event.finishReason;
        }
      }
      text = state.collectedText.join('');
    } catch (synthErr) {
      log.warn({ err: synthErr }, 'Forced synthesis round failed');
      if (synthErr instanceof ApiError && synthErr.code === 'tool_protocol_in_text') {
        state.status = 'error';
        state.errorCode = synthErr.code;
        text = state.collectedText.join('');
        yield { type: 'error', code: synthErr.code, title: synthErr.title, detail: synthErr.detail, usage: toUsageDto(state.usage, null) };
      }
    }

    if (state.status !== 'error' && text.trim().length === 0) {
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
  }
  return text;
}
