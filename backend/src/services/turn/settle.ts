/**
 * The turn's settle step: the message row, the turn log's outcome, the usage record, then the
 * debug trace and `done` for a complete turn. Cut from the turn generator unchanged (ADR-0073):
 * `this` became `svc`, the turn's locals arrive in `turn`, and its state in `state`.
 */
import { logger } from '../../logger.js';
import type { ModelEntry } from '../../providers/registry.js';
import type { ReasoningEffort } from '../../providers/types.js';
import type { RuntimeDebugTrace } from '../routing/turnRouter.js';
import type { SkillDetail } from '../skills.js';
import type { TurnLog } from '../turnLog.js';
import { usdToInr } from '../usage.js';
import { type StreamEvent, computeCostFor, toUsageDto } from './events.js';
import type { GenerateInput, PreferencesRow } from './input.js';
import { finalise } from './persistence.js';
import type { TurnServices } from './services.js';
import type { TurnLogOutcome, TurnState } from './turnState.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

/** The turn's values the settle step reads, besides its state. */
export interface SettleInput {
  entry: ModelEntry;
  prefs: PreferencesRow;
  /** The answer's text as the stream and the forced answer left it. */
  text: string;
  reasoningEffort: ReasoningEffort | undefined;
  turnLog: TurnLog;
  logOutcome: TurnLogOutcome;
  startedAt: Date;
  allowedTools: string[];
  loadedSkills: SkillDetail[];
}

export async function* settleTurn(
  svc: TurnServices,
  input: GenerateInput,
  state: TurnState,
  turn: SettleInput,
): AsyncGenerator<StreamEvent> {
  const { entry, prefs, text, reasoningEffort, turnLog, logOutcome, startedAt, allowedTools, loadedSkills } = turn;
  const questions: string[] = [];

  await finalise(svc, input, {
    text,
    thinking: state.collectedThinking.join(''),
    segments: state.segments,
    sources: state.collectedSources,
    searchEntryPoint: state.searchEntryPoint,
    status: state.status === 'cancelled' ? 'stopped' : state.status === 'error' ? 'error' : 'complete',
    errorCode: state.errorCode,
    finishReason: state.status === 'cancelled' ? 'cancelled' : state.finishReason,
    entry,
    mode: input.mode,
    questions,
    effort: reasoningEffort,
  });

  turnLog.stage('saved', { status: state.status, textCharacters: text.length, segments: state.segments.length });
  Object.assign(logOutcome, {
    status: state.status === 'cancelled' ? 'stopped' : state.status,
    finishReason: state.status === 'cancelled' ? 'cancelled' : state.finishReason,
    errorCode: state.errorCode,
    usage: state.usage,
  });
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
    status: state.status === 'cancelled' ? 'cancelled' : state.status === 'error' ? 'error' : 'complete',
    finishReason: state.status === 'cancelled' ? 'cancelled' : state.finishReason,
  });

  // A cancelled run has no terminal `done`: the client already knows it stopped, and
  // emitting "done" would claim a completion that did not happen.
  if (state.status === 'complete') {
    const debugTrace: RuntimeDebugTrace = {
      loadedSkills: loadedSkills.map((s) => s.name),
      allowedTools,
      toolsCalled: state.toolsCalled,
    };
    log.info({ debugTrace }, 'Runtime debug trace');
    yield { type: 'debug', trace: debugTrace };

    const costUsd = computeCostFor(svc.cfg, entry.providerModelId!, state.usage);
    yield {
      type: 'done',
      questions,
      usage: toUsageDto(state.usage, costUsd, usdToInr(svc.cfg, costUsd)),
      finishReason: state.finishReason,
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
      ...(state.endedPartial ? { partial: true as const, errorCode: 'partial_after_tool_run' as const } : {}),
    };
  }
}
