/**
 * The provider stream of one turn: every event it yields, collected into the turn's state, and
 * the stream's failure (partial after a tool ran, a stop, or an error that settles the turn
 * here). Cut from the turn generator unchanged (ADR-0073); `this` became `svc`.
 *
 * Returns true when the turn ended here (the error branch settled the turn in one transaction
 * and yielded `error`): the caller returns at once, so its outer `finally` (timing, turn log,
 * workspace cleanup) still runs exactly once. The reservation stays held after a normal end, through
 * the forced answer, until the settle step ends it (ADR-0078).
 *
 * P11 (ADR-0081): the stream comes from the provider gateway, which retries and may hand the turn
 * to the next model of its chain (`model_switch`, labelled, never silent). A failure after text
 * was shown keeps the partial answer: the turn ends complete with `partial`, finish `interrupted`
 * and the cause's code (ER-3c), so the history keeps it with a cut marker.
 */
import { VISUAL_MAX_HTML_BYTES } from '../ui/validator.js';
import type { MessageSegment } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { kindOf } from '../../providers/failures.js';
import type { HopNeeds } from '../../providers/fallback.js';
import type { GatewayTurn, HopTarget } from '../../providers/gateway.js';
import type { ModelEntry } from '../../providers/registry.js';
import { type GenerationRequest, type Provider, type ProviderUsage, type ReasoningEffort, isAbort, ModelNotFoundError, ProviderError, toolResultPreview, withoutImageBytes } from '../../providers/types.js';
import type { TurnLog } from '../turnLog.js';
import { StreamTimeSplit, type TurnTiming } from '../turnTiming.js';
import { type StreamEvent, presentedFiles, toSourceDto, toUsageDto } from './events.js';
import type { GenerateInput, PreferencesRow } from './input.js';
import { persistEvent, persistToolCall } from './persistence.js';
import { FailedAfterToolRun, isTypedStop, mapProviderError, refusalError, visualDrafts } from './providerLoop.js';
import { endStateFor, settleTurn } from './turnStore.js';
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
  addSegment: (type: 'thinking' | 'text', text: string) => void;
  /** Visuals a tool showed, sent after its tool result. */
  pendingUiEvents: StreamEvent[];
  /** P11: how the turn may move down its fallback chain (absent = it may not). */
  hop?: TurnHop;
}

/** The turn rebuilt for another model (ER-14b: capability stripping is a rebuild). */
export interface HopBuild {
  target: HopTarget;
  reasoningEffort: ReasoningEffort | undefined;
  pendingUiEvents: StreamEvent[];
  segments: MessageSegment[];
}

export interface TurnHop {
  needs: HopNeeds;
  entries: readonly ModelEntry[];
  canServe: (entry: ModelEntry) => boolean;
  build: (entry: ModelEntry) => Promise<HopBuild | null>;
}

/** What a failure reported before it ended (AL-1), when anything. */
function partialUsageOf(err: unknown): ProviderUsage | undefined {
  if (err instanceof FailedAfterToolRun) return err.failure.partialUsage;
  return err instanceof ProviderError ? err.partialUsage : undefined;
}

export async function* streamAndCollect(
  svc: TurnServices,
  input: GenerateInput,
  state: TurnState,
  turn: StreamInput,
): AsyncGenerator<StreamEvent, boolean> {
  const { provider, request, prefs, startedAt, timing, turnLog, logOutcome, addSegment } = turn;
  // The model serving the turn, and what goes with it: they change when the turn moves down its
  // fallback chain (P11).
  let entry = turn.entry;
  let reasoningEffort = turn.reasoningEffort;
  let pendingUiEvents = turn.pendingUiEvents;
  // The answer so far, to the message row (throttled, fenced): a run that dies keeps it.
  const checkpoint = async (): Promise<void> => {
    await input.checkpoint?.flush({ text: state.collectedText.join(''), thinking: state.collectedThinking.join(''), segments: state.segments });
  };
  try {
    const builds = new Map<string, HopBuild>();
    const run: GatewayTurn = {
      signal: request.signal,
      ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
      calls: state.attempts,
      ...(turn.hop
        ? {
            needs: turn.hop.needs,
            entries: turn.hop.entries,
            canServe: turn.hop.canServe,
            build: async (next: ModelEntry) => {
              const built = await turn.hop!.build(next);
              if (!built) return null;
              builds.set(next.alias, built);
              return built.target;
            },
          }
        : {}),
    };
    const stream = svc.gateway.stream({ entry, provider, request }, run);
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
          await checkpoint();
          break;
        }

        case 'thinking':
          turnLog.thinking(event.text);
          state.collectedThinking.push(event.text);
          addSegment('thinking', event.text);
          yield { type: 'thinking', text: event.text };
          await checkpoint();
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
          await checkpoint();
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
          // AL-2: the category goes to the usage row; M-14: finish `blocked`, no fallback.
          state.refusalCategory = event.category?.slice(0, 32) ?? null;
          throw refusalError(event);

        case 'model_switch': {
          // 7.12 / OQ-02 A: nothing was shown and no tool ran on the failed model; the next one
          // answers, rebuilt for it, and the answer carries the label.
          const built = builds.get(event.to);
          if (event.cause instanceof ModelNotFoundError) {
            svc.registry.recordOutcome(entry.alias, { available: false, detail: event.cause.message });
          }
          entry = event.target.entry;
          reasoningEffort = built?.reasoningEffort;
          state.served = { entry, provider: event.target.provider, request: event.target.request, reasoningEffort };
          state.fallback ??= { from: event.from, reason: event.reason };
          if (built) {
            pendingUiEvents = built.pendingUiEvents;
            state.segments = built.segments;
          }
          turnLog.stage('model switch', { from: event.from, to: event.to, reason: event.reason });
          turnLog.setModel({ requested: input.modelAlias, resolved: entry.alias, providerModelId: entry.providerModelId!, grounded: event.target.request.grounded });
          yield { type: 'model_switch', from: event.from, to: event.to, reason: event.reason };
          break;
        }

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
    // A typed stop (the deadline, a shutdown, a lost lease) is an error with its code, not a cancel.
    const deadlineHit = isTypedStop(input.signal.reason);
    const reported = partialUsageOf(err);
    if (reported !== undefined) state.usage = reported;
    const textShown = state.collectedText.join('').trim().length > 0;
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
    } else if (textShown && !deadlineHit && !(err instanceof ApiError) && kindOf(err) !== 'blocked') {
      // M-17 / ER-3c: a failure after text keeps the partial answer, finish `interrupted` with the
      // cause's code; never retried (the text would repeat), never another model.
      const cause = mapProviderError(err).code;
      state.endedPartial = true;
      state.errorCode = cause;
      state.finishReason = 'interrupted';
      turnLog.stage('provider failed after text', { code: cause, toolCalls: state.toolsCalled.length });
      log.warn({ code: cause, chatId: input.chatId, requestId: input.requestId }, 'provider failed after text; the partial answer is kept');
      const tail = state.answerGuard.finish();
      if (tail) {
        state.collectedText.push(tail);
        addSegment('text', tail);
        turnLog.text(tail);
        yield { type: 'delta', text: tail };
      }
    } else {
      state.status = 'error';
      const mapped = mapProviderError(deadlineHit ? input.signal.reason : err);
      state.errorCode = mapped.code;
      // M-14 / M-23: a refusal or a safety block ends `blocked`, with its category (AL-2).
      const blocked = !deadlineHit && ((err instanceof ApiError && err.code === 'model_refused') || kindOf(err) === 'blocked');
      if (err instanceof ProviderError && err.refusalCategory) state.refusalCategory = err.refusalCategory;
      turnLog.fail(err);
      turnLog.stage('provider failed', { code: mapped.code, deadline: deadlineHit, toolCalls: state.toolsCalled.length });
      log.error({ err, chatId: input.chatId, requestId: input.requestId }, 'generation failed');
      // One transaction: the row, its sources, the usage row, the counters, the reservation and
      // the turn's state (ADR-0078).
      await settleTurn(
        svc,
        { userId: input.userId, chatId: input.chatId, messageId: input.messageId, requestId: input.requestId, projectId: input.projectId },
        input.turn,
        {
          message: {
            kind: 'final',
            text: state.collectedText.join(''),
            thinking: state.collectedThinking.join(''),
            segments: state.segments,
            sources: state.collectedSources,
            searchEntryPoint: state.searchEntryPoint,
            status: 'error',
            errorCode: mapped.code,
            finishReason: blocked ? 'blocked' : null,
            model: { alias: entry.alias, provider: entry.provider, providerModelId: entry.providerModelId ?? null },
            mode: input.mode,
            ...(reasoningEffort ? { effort: reasoningEffort } : {}),
            ...(state.fallback ? { fallback: state.fallback } : {}),
          },
          usage: {
            prefs,
            modelAlias: entry.alias,
            provider: entry.provider,
            providerModelId: entry.providerModelId!,
            usage: state.usage,
            startedAt,
            status: blocked ? 'blocked' : 'error',
            errorCode: mapped.code,
            ...(blocked ? { finishReason: 'blocked' } : {}),
            refusalCategory: state.refusalCategory,
          },
          end: endStateFor('error', mapped.code),
          finishCode: mapped.code,
        },
      );
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
  }
  return false;
}
