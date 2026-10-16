/**
 * The provider stream of one turn: every event it yields, collected into the turn's state, and
 * the stream's failure (partial after a tool ran, a stop, or an error that settles the turn
 * here). Cut from the turn generator unchanged (ADR-0073); `this` became `svc`.
 *
 * Returns true when the turn ended here (the error branch saved the row, recorded usage and
 * yielded `error`): the caller returns at once, so its outer `finally` (timing, turn log,
 * workspace cleanup) still runs exactly once. The reservation is released in this function's
 * `finally`, before that, as it was in the turn generator.
 */
import { VISUAL_MAX_HTML_BYTES } from '../ui/validator.js';
import { logger } from '../../logger.js';
import type { ModelEntry } from '../../providers/registry.js';
import { type GenerationRequest, type Provider, type ReasoningEffort, isAbort, ModelNotFoundError, toolResultPreview, withoutImageBytes } from '../../providers/types.js';
import type { TurnLog } from '../turnLog.js';
import { StreamTimeSplit, type TurnTiming } from '../turnTiming.js';
import { type StreamEvent, presentedFiles, toSourceDto, toUsageDto } from './events.js';
import type { GenerateInput, PreferencesRow } from './input.js';
import { finalise, persistEvent, persistToolCall } from './persistence.js';
import { FailedAfterToolRun, isTurnDeadline, mapProviderError, refusalError, streamWithRetry, visualDrafts } from './providerLoop.js';
import type { TurnServices } from './services.js';
import type { TurnLogOutcome, TurnState } from './turnState.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

/** The turn's values the stream reads, besides its state. */
export interface StreamInput {
  provider: Provider;
  request: GenerationRequest;
  entry: ModelEntry;
  prefs: PreferencesRow;
  reasoningEffort: ReasoningEffort | undefined;
  startedAt: Date;
  timing: TurnTiming;
  turnLog: TurnLog;
  logOutcome: TurnLogOutcome;
  /** Called here once the stream ends, whatever happened; it acts only the first time. */
  releaseReservation: () => Promise<void>;
  addSegment: (type: 'thinking' | 'text', text: string) => void;
  /** Visuals a tool showed, sent after its tool result. */
  pendingUiEvents: StreamEvent[];
}

export async function* streamAndCollect(
  svc: TurnServices,
  input: GenerateInput,
  state: TurnState,
  turn: StreamInput,
): AsyncGenerator<StreamEvent, boolean> {
  const { provider, request, entry, prefs, reasoningEffort, startedAt, timing, turnLog, logOutcome, releaseReservation, addSegment, pendingUiEvents } = turn;
  try {
    const stream = streamWithRetry(svc, provider.stream.bind(provider), request);
    timing.mark('before_provider');
    let firstProviderEvent = true;
    let toolCallCount = 0;
    // Splits the stream's time between waiting on the model and waiting on tools, so a slow
    // turn's log says which one it was (a 462 s turn with 2 tool calls said neither).
    const split = new StreamTimeSplit();

    for await (const event of stream) {
      if (firstProviderEvent) {
        firstProviderEvent = false;
        timing.mark('provider_first_event');
        turnLog.stage('provider first event', { event: event.type });
      }
      split.observe(event.type);
      timing.note('streamMs', split.summary());
      if (event.type === 'tool_use') timing.note('toolCalls', (toolCallCount += 1));
      switch (event.type) {
        case 'delta': {
          const safe = state.answerGuard.push(event.text);
          state.collectedText.push(safe);
          addSegment('text', safe);
          turnLog.text(safe);
          if (safe) yield { type: 'delta', text: safe };
          break;
        }

        case 'thinking':
          turnLog.thinking(event.text);
          state.collectedThinking.push(event.text);
          addSegment('thinking', event.text);
          yield { type: 'thinking', text: event.text };
          break;

        case 'sources': {
          state.collectedSources.push(...event.sources);
          if (event.searchEntryPoint) state.searchEntryPoint = event.searchEntryPoint;
          const dtos = event.sources.map((s, i) => toSourceDto(s, i + 1));
          yield {
            type: 'sources',
            sources: dtos,
            ...(event.searchEntryPoint ? { searchEntryPoint: event.searchEntryPoint } : {}),
          };
          break;
        }

        case 'code':
          yield {
            type: 'code',
            ...(event.code ? { code: event.code } : {}),
            ...(event.language ? { language: event.language } : {}),
            ...(event.output ? { output: event.output } : {}),
          };
          break;

        case 'tool_input_partial': {
          if (event.name !== 'show_widget') break;
          // A call's index restarts each response; the calls already made keep the id unique.
          for (const draft of visualDrafts(event.input, `${String(state.toolsCalled.length + event.index)}`)) {
            const sent = state.draftSent.get(draft.draftId) ?? 0;
            const html = draft.html.slice(0, VISUAL_MAX_HTML_BYTES);
            if (html.length <= sent) continue;
            state.draftSent.set(draft.draftId, html.length);
            yield { type: 'ui_draft', draftId: draft.draftId, title: draft.title, from: sent, text: html.slice(sent) };
          }
          break;
        }

        case 'tool_use': {
          state.toolsCalled.push(event.name);
          {
            const last = state.segments.at(-1);
            if (last?.type === 'tools') last.toolCallIds.push(event.toolCallId);
            else state.segments.push({ type: 'tools', toolCallIds: [event.toolCallId] });
          }
          state.pendingToolInputs.set(event.toolCallId, event.input);
          turnLog.call(event.toolCallId, event.name, event.input);
            if (event.thoughtSignature) state.pendingSignatures.set(event.toolCallId, event.thoughtSignature);
          yield { type: 'tool_use', toolCallId: event.toolCallId, name: event.name, input: event.input };
          break;
        }

        case 'tool_result': {
          turnLog.result(event.toolCallId, event.result);
          state.turnCalls.push({
            id: event.toolCallId,
            name: event.name,
            input: state.pendingToolInputs.get(event.toolCallId),
            result: { ...event.result, content: withoutImageBytes(event.result.content) },
          });
          const preview = toolResultPreview(event.result, svc.cfg.TOOL_RESULT_PREVIEW_CHARS);
          const files = presentedFiles(event.name, event.result);
          yield {
            type: 'tool_result',
            toolCallId: event.toolCallId,
            name: event.name,
            ok: event.result.ok,
            preview,
            ...(files?.length ? { files } : {}),
            ...(event.result.errorCode ? { errorCode: event.result.errorCode } : {}),
          };
          await persistToolCall(
            svc,
            input.messageId,
            event.toolCallId,
            event.name,
            state.pendingToolInputs.get(event.toolCallId),
            event.result,
            state.eventOrdinal++,
            state.pendingSignatures.get(event.toolCallId),
          );
          while (pendingUiEvents.length > 0) {
            yield pendingUiEvents.shift()!;
          }
          break;
        }

        case 'progress': {
          const out: StreamEvent = {
            type: 'research',
            event: {
              stage: event.stage,
              label: event.label,
              detail: event.detail,
              at: new Date().toISOString(),
            },
          };
          yield out;
          await persistEvent(svc, input.messageId, out, state.eventOrdinal++);
          break;
        }

        case 'refusal':
          throw refusalError(event);

        case 'completed':
          {
            const tail = state.answerGuard.finish();
            if (tail) {
              state.collectedText.push(tail);
              addSegment('text', tail);
              turnLog.text(tail);
              yield { type: 'delta', text: tail };
            }
          }
          state.usage = event.usage;
          state.finishReason = event.finishReason;
          svc.registry.recordOutcome(entry.alias, { available: true });
          turnLog.stage('provider completed', { finishReason: event.finishReason, toolCalls: state.toolsCalled.length, stream: split.summary() });
          break;
      }
    }
  } catch (err) {
    if (err instanceof ModelNotFoundError) {
      svc.registry.recordOutcome(entry.alias, { available: false, detail: err.message });
    }
    const deadlineHit = isTurnDeadline(input.signal.reason);
    if (err instanceof FailedAfterToolRun && !deadlineHit && !input.signal.aborted) {
      // The answer so far, the tool calls already stored, and a typed code: never a second run
      // of a tool, never a failure presented as a finished answer (done carries `partial`).
      state.endedPartial = true;
      state.errorCode = 'partial_after_tool_run';
      state.finishReason = 'partial';
      const cause = mapProviderError(err.failure).code;
      turnLog.stage('provider failed after a tool ran', { code: cause, toolCalls: state.toolsCalled.length });
      log.warn({ code: cause, chatId: input.chatId, requestId: input.requestId, toolCalls: state.toolsCalled.length }, 'provider failed after a tool ran; ending the turn partial');
      const tail = state.answerGuard.finish();
      if (tail) {
        state.collectedText.push(tail);
        addSegment('text', tail);
        turnLog.text(tail);
        yield { type: 'delta', text: tail };
      }
    } else if (!deadlineHit && (isAbort(err) || input.signal.aborted)) {
      state.status = 'cancelled';
    } else {
      state.status = 'error';
      const mapped = mapProviderError(deadlineHit ? input.signal.reason : err);
      state.errorCode = mapped.code;
      turnLog.fail(err);
      turnLog.stage('provider failed', { code: mapped.code, deadline: deadlineHit, toolCalls: state.toolsCalled.length });
      log.error({ err, chatId: input.chatId, requestId: input.requestId }, 'generation failed');
      await finalise(svc, input, {
        text: state.collectedText.join(''),
        thinking: state.collectedThinking.join(''),
        segments: state.segments,
        sources: state.collectedSources,
        searchEntryPoint: state.searchEntryPoint,
        status: 'error',
        errorCode: mapped.code,
        finishReason: null,
        entry,
        mode: input.mode,
        effort: reasoningEffort,
      });
      await releaseReservation();
      await svc.usage.record({
        userId: input.userId,
        prefs,
        requestId: input.requestId,
        chatId: input.chatId,
        messageId: input.messageId,
        projectId: input.projectId,
        modelAlias: entry.alias,
        provider: entry.provider,
        providerModelId: entry.providerModelId!,
        usage: state.usage,
        startedAt,
        status: 'error',
        errorCode: mapped.code,
      });
      Object.assign(logOutcome, { status: 'error', errorCode: mapped.code, usage: state.usage });
      yield {
        type: 'error',
        code: mapped.code,
        title: mapped.title,
        detail: mapped.detail,
        usage: toUsageDto(state.usage, null),
      };
      return true;
    }
  } finally {
    await releaseReservation();
  }
  return false;
}
