/**
 * The state one turn builds while it streams and settles: what the provider reported, how the
 * turn ended, and everything collected for the message row. One object, so the stages of the
 * turn generator (stream, forced answer, settle) can each be a function that takes it
 * (ADR-0073). Its fields were `runTurn`'s locals, with the same initial values.
 */
import type { MessageSegment } from '../../db/schema.js';
import type { AttemptCall } from '../../providers/gateway.js';
import type { ModelEntry } from '../../providers/registry.js';
import { type GenerationRequest, type HistoryToolCall, type Provider, type ProviderSource, type ProviderUsage, type ReasoningEffort, EMPTY_USAGE } from '../../providers/types.js';
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
  /**
   * P11 (7.12, ADR-0081): the model that answers after the turn moved down its fallback chain,
   * with the request rebuilt for it; null while the first model serves.
   */
  served: { entry: ModelEntry; provider: Provider; request: GenerationRequest; reasoningEffort: ReasoningEffort | undefined } | null;
  /** P11: the labelled switch, stored on the message (`fallback_from`, `fallback_reason`). */
  fallback: { from: string; reason: string } | null;
  /** P11 (AL-1, P22 contract): one row per provider attempt, for the ledger at merge. */
  attempts: AttemptCall[];
  /** P11 (AL-2): the refusal or block category, for the usage row. */
  refusalCategory: string | null;
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
    served: null,
    fallback: null,
    attempts: [],
    refusalCategory: null,
  };
}
