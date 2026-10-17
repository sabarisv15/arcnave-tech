/**
 * The turn's settle step: one transaction for the message row, its sources, the usage record, the
 * reservation and the turn's state (ADR-0078), then the turn log's outcome, then the debug trace and
 * `done` for a complete turn. Cut from the turn generator (ADR-0073): `this` became `svc`, the
 * turn's locals arrive in `turn`, and its state in `state`.
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
import { endStateFor, settleTurn as settleTurnRows } from './turnStore.js';
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

  const status = state.status === 'cancelled' ? 'stopped' : state.status === 'error' ? 'error' : 'complete';
  const finishReason = state.status === 'cancelled' ? 'cancelled' : state.finishReason;
  // One transaction, in the fixed order (ADR-0078): the turn locked and fenced, the row, its
  // sources, the usage row and the counters, the reservation, the turn's state, the chat.
  await settleTurnRows(
    svc,
    { userId: input.userId, chatId: input.chatId, messageId: input.messageId, requestId: input.requestId, projectId: input.projectId },
    input.turn,
    {
      message: {
        kind: 'final',
        text,
        thinking: state.collectedThinking.join(''),
        segments: state.segments,
        sources: state.collectedSources,
        searchEntryPoint: state.searchEntryPoint,
        status,
        errorCode: state.errorCode,
        finishReason,
        model: { alias: entry.alias, provider: entry.provider, providerModelId: entry.providerModelId ?? null },
        mode: input.mode,
        questions,
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
        status: state.status === 'cancelled' ? 'cancelled' : state.status === 'error' ? 'error' : 'complete',
        finishReason,
      },
      end: endStateFor(status, state.errorCode),
      // An answer kept after a failure (ER-2b / ER-3c) ends as what cut it: `partial_after_tool_run`
      // or `interrupted` (P11).
      finishCode:
        state.status === 'complete'
          ? state.endedPartial
            ? state.finishReason === 'interrupted'
              ? 'interrupted'
              : 'partial_after_tool_run'
            : state.finishReason
          : (state.errorCode ?? finishReason),
    },
  );

  turnLog.stage('saved', { status: state.status, textCharacters: text.length, segments: state.segments.length });
  Object.assign(logOutcome, {
    status: state.status === 'cancelled' ? 'stopped' : state.status,
    finishReason,
    errorCode: state.errorCode,
    usage: state.usage,
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
      ...(state.endedPartial ? { partial: true as const, errorCode: state.errorCode ?? 'partial_after_tool_run' } : {}),
      ...(state.fallback ? { fallback: state.fallback } : {}),
    };
  }
}
