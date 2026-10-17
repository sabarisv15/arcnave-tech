/**
 * The state one turn builds while it streams and settles: what the provider reported, how the
 * turn ended, and everything collected for the message row. One object, so the stages of the
 * turn generator (stream, forced answer, settle) can each be a function that takes it
 * (ADR-0073). Its fields were `runTurn`'s locals, with the same initial values.
 */
import type { MessageSegment } from '../../db/schema.js';
import { type CallRole, type CallUsage, type HistoryToolCall, type ProviderEvent, type ProviderSource, type ProviderUsage, EMPTY_USAGE, usageFromCalls } from '../../providers/types.js';
import { AnswerProtocolGuard } from '../answerProtocolGuard.js';

/** What the turn log's outcome records; filled as the turn ends, written by the outer finally. */
export interface TurnLogOutcome {
  status: string;
  finishReason?: string | null;
  errorCode?: string | null;
  usage?: object;
}

export interface TurnState {
  usage: ProviderUsage;
  finishReason: string;
  status: 'complete' | 'cancelled' | 'error';
  errorCode: string | null;
  /** Set when the provider failed after a tool ran (ER-2b): the turn ends with what it has. */
  endedPartial: boolean;
  collectedText: string[];
  collectedThinking: string[];
  /**
   * The answer in the order it happened: thinking, text and tool steps interleaved. Kept on the
   * message so a reload shows the same timeline. The same array the tool executors push a visual
   * into, so it is passed in, never replaced.
   */
  segments: MessageSegment[];
  answerGuard: AnswerProtocolGuard;
  collectedSources: ProviderSource[];
  searchEntryPoint: string | undefined;
  /** The ordinal of the next tool call or progress row; the context events come first. */
  eventOrdinal: number;
  pendingToolInputs: Map<string, unknown>;
  /** Gemini's signature for a call, stored so a later turn can replay the call as it was made. */
  pendingSignatures: Map<string, string>;
  toolsCalled: string[];
  /**
   * This turn's calls with their results. The adapter's loop keeps them in its own request; a
   * forced answer after the loop is a new request, and without these it cannot see the work.
   */
  turnCalls: HistoryToolCall[];
  /** Characters of each visual draft already sent, by draft id. */
  draftSent: Map<string, number>;
  /** P22 (E19): every model call of the turn, in order; `usage` is their sum. */
  calls: CallUsage[];
  /** P22 OD-8: request sent → first stream event, and turn start → first answer text sent. */
  clocks: { providerTtftMs: number | null; firstVisibleMs: number | null };
}

export function createTurnState(segments: MessageSegment[], eventOrdinal: number): TurnState {
  return {
    usage: EMPTY_USAGE,
    finishReason: 'stop',
    status: 'complete',
    errorCode: null,
    endedPartial: false,
    collectedText: [],
    collectedThinking: [],
    segments,
    answerGuard: new AnswerProtocolGuard(),
    collectedSources: [],
    searchEntryPoint: undefined,
    eventOrdinal,
    pendingToolInputs: new Map<string, unknown>(),
    pendingSignatures: new Map<string, string>(),
    toolsCalled: [],
    turnCalls: [],
    draftSent: new Map<string, number>(),
    calls: [],
    clocks: { providerTtftMs: null, firstVisibleMs: null },
  };
}

/* -------------------------------------------------------------------------- P22: calls */

type CallUsageEvent = Extract<ProviderEvent, { type: 'call_usage' }>;

/** Adds one provider request to the turn's calls and makes the turn's usage their sum (E19). */
export function addCall(state: TurnState, event: CallUsageEvent, role: CallRole, providerModelId: string, at: Date): void {
  state.calls.push({
    ordinal: state.calls.length + 1,
    // P11 numbers the gateway's attempts; a failed attempt reports no call, so this is the one that answered.
    attempt: 1,
    role,
    providerModelId,
    usage: event.usage,
    usageSource: event.usageSource,
    finishReason: event.finishReason,
    ...(event.providerRef ? { providerRef: event.providerRef } : {}),
    ...(event.ttftMs !== undefined ? { ttftMs: event.ttftMs } : {}),
    ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
    startedAt: new Date(at.getTime() - (event.durationMs ?? 0)),
  });
  state.usage = usageFromCalls(state.calls);
}

/**
 * A stream's `completed` with no `call_usage` before it (a provider that reports only the
 * whole call): the call is that total, as one request. Its counts are the provider's own.
 */
export function addCallFromCompleted(state: TurnState, usage: ProviderUsage, finishReason: string, role: CallRole, providerModelId: string): void {
  state.calls.push({
    ordinal: state.calls.length + 1,
    attempt: 1,
    role,
    providerModelId,
    usage,
    usageSource: usage.exact ? 'provider' : 'none',
    finishReason,
  });
  state.usage = usageFromCalls(state.calls);
}

/** A request that failed: it was sent, and nothing says what it used (`none`, zeros, no price). */
export function addFailedCall(state: TurnState, role: CallRole, providerModelId: string): void {
  state.calls.push({
    ordinal: state.calls.length + 1,
    attempt: 1,
    role,
    providerModelId,
    usage: EMPTY_USAGE,
    usageSource: 'none',
    finishReason: 'error',
  });
  state.usage = usageFromCalls(state.calls);
}
