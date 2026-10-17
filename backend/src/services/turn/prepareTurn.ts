/**
 * The turn's start: preferences, project and the latest compaction, the history, the model and
 * the history read again for it, and the capability gates; then, after `start`, the compaction
 * of a long conversation. Cut from the turn generator unchanged (ADR-0073); `this` became `svc`.
 *
 * The turn reassigned its `input` when the message's attachments came from the history; the
 * reassigned input is returned, and the turn reads it from here on.
 */
import { ApiError } from '../../errors.js';
import { type ModelEntry, AUTO_ALIAS } from '../../providers/registry.js';
import type { Provider, Turn } from '../../providers/types.js';
import { compactionService } from '../compaction/compactionService.js';
import type { ConversationCompactionRow } from '../compaction/types.js';
import type { TurnLog } from '../turnLog.js';
import type { TurnTiming } from '../turnTiming.js';
import { compactIfNeeded, loadHistory, loadPreferences, loadProject } from './context.js';
import type { ModelInfo, StreamEvent } from './events.js';
import type { GenerateInput, PreferencesRow } from './input.js';
import { resolveModel } from './modelRouting.js';
import type { TurnServices } from './services.js';
import { messages } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { activeSummary } from '../summary/summaryStore.js';

/** What the rest of the turn reads from its start. */
export interface PreparedTurn {
  input: GenerateInput;
  prefs: PreferencesRow;
  project: { id: string; title: string; instructions: string } | null;
  latestCompaction: ConversationCompactionRow | null;
  history: Turn[];
  entry: ModelEntry;
  provider: Provider;
  grounded: boolean;
  modelInfo: ModelInfo;
  /** P11 (K-15): the asked-for model was unavailable and the turn starts down its chain. */
  switched?: { from: string; reason: string };
  /** What any model of the turn must be able to do (P11: the fallback chain checks it). */
  needs: { vision: boolean; grounding: boolean };
}

export async function prepareTurn(
  svc: TurnServices,
  input: GenerateInput,
  timing: TurnTiming,
  turnLog: TurnLog,
): Promise<PreparedTurn> {
  const prefs = await loadPreferences(svc, input.userId);

  const project = input.projectId ? await loadProject(svc, input.userId, input.projectId) : null;
  let latestCompaction = svc.cfg.ENABLE_CONTEXT_COMPACTION
    ? await compactionService.getLatestCompaction(input.chatId, svc.db)
    : null;
  // P13 (ADR-0080): the history summary this turn may use, read once; history starts after it.
  if (svc.cfg.ENABLE_HISTORY_SUMMARY) {
    const [self] = await svc.db.select({ seq: messages.seq }).from(messages).where(eq(messages.id, input.messageId)).limit(1);
    input = { ...input, historySummary: self ? await activeSummary(svc.db, input.chatId, self.seq - 1) : null };
  }
  const historyAfterSeq = (): number | undefined => latestCompaction?.throughSeq ?? input.historySummary?.coversUptoSeq;
  // Loaded before model resolution (not its historical position) because whether this turn
  // needs a vision-capable model depends on what's carried forward, not only on what's newly
  // attached. Its character backstop is the model's window, so it is sized by a named model
  // only; under Auto this first read keeps every turn, and the history is read again for the
  // resolved model below (D2 X-2: `Auto` has no window and fell back to 128,000 tokens).
  let historyAlias: string | null = input.modelAlias === AUTO_ALIAS ? null : input.modelAlias;
  const loaded = await loadHistory(
    svc,
    input.chatId,
    input.messageId,
    historyAfterSeq(),
    historyAlias,
  );
  timing.mark('history');
  turnLog.stage('history', {
    earlierTurns: loaded.turns.length,
    compactedThroughSeq: latestCompaction?.throughSeq ?? null,
    ...(input.historySummary ? { summaryCoversUptoSeq: input.historySummary.coversUptoSeq } : {}),
    prompt: `${String(input.prompt.length)} characters`,
    attachmentsOfThisMessage: input.attachments.length || loaded.currentUserAttachments.length,
  });
  let history = loaded.turns;
  const currentUserAttachments = loaded.currentUserAttachments;
  if (input.attachments.length === 0 && currentUserAttachments.length > 0) {
    input = { ...input, attachments: currentUserAttachments, hasAttachments: true };
  }

  // --- resolve the model ------------------------------------------------
  const requiresGrounding = input.mode !== 'chat';
  const requiresVision =
    (input.attachments?.length ?? 0) > 0 || history.some((t) => (t.attachments?.length ?? 0) > 0);
  const { entry, routing, switched } = await resolveModel(svc, input, requiresGrounding, requiresVision);
  timing.mark('model_resolve');
  if (historyAlias !== entry.alias) {
    historyAlias = entry.alias;
    ({ turns: history } = await loadHistory(svc, input.chatId, input.messageId, historyAfterSeq(), historyAlias));
  }
  // P13 (ADR-0080): the router M2 shadow call, never awaited; it logs its pick and changes nothing.
  svc.helperJobs?.routerShadow({ userId: input.userId, chatId: input.chatId, messageId: input.messageId, prompt: input.prompt, resolvedAlias: entry.alias });
  turnLog.stage('model', {
    requested: input.modelAlias,
    resolved: entry.alias,
    provider: entry.provider,
    providerModelId: entry.providerModelId,
    needsVision: requiresVision,
    needsGrounding: requiresGrounding,
    ...(routing ? { autoRule: routing.rule, considered: routing.considered } : {}),
    ...(switched ? { switchedFrom: switched.from, switchReason: switched.reason } : {}),
  });
  // A probe ran inside resolution when the alias's status was checked during this turn.
  timing.note('probed', (svc.registry.lastProbedAt(entry.alias) ?? 0) >= timing.since);
  timing.note('model', entry.alias);
  const provider = svc.registry.providerFor(entry);
  if (!provider) {
    throw new ApiError('model_unavailable', {
      detail: `No adapter is registered for provider "${entry.provider}".`,
    });
  }

  // The web is searched when it helps, in every chat: the search
  // tool is offered on every turn the web is on, and the model decides whether to use it.
  // Search and Research modes still require it.
  const searchAvailable = entry.supportsGrounding && provider.supportsGrounding();
  const grounded = searchAvailable && (requiresGrounding || svc.cfg.ENABLE_WEB);
  if (requiresGrounding && !grounded) {
    // Search and research promise cited answers. Rather than quietly degrade to an
    // uncited chat reply, say the capability is off and let the user choose.
    throw new ApiError('capability_unavailable', {
      detail:
        `${input.mode === 'research' ? 'Research' : 'Search'} needs a grounding provider, ` +
        'which is not enabled for the selected model. Switch to Chat, or enable ' +
        'grounding in the server configuration.',
      meta: { mode: input.mode, alias: entry.alias },
    });
  }

  const codeExecution = input.codeExecution && (provider.supportsCodeExecution?.() ?? false);
  if (input.codeExecution && !codeExecution) {
    // The Anthropic adapter has no code-execution tool on Vertex (ADR-0004): never silently run the turn
    // on a different model than the one the caller asked for just because it can run code.
    throw new ApiError('capability_unavailable', {
      detail:
        'Code execution needs a provider with a code-execution tool, which the selected ' +
        'model does not have on Vertex. Switch to a Gemini model, or turn code execution off.',
      meta: { alias: entry.alias },
    });
  }

  const modelInfo: ModelInfo = {
    requested: input.modelAlias,
    resolved: entry.alias,
    provider: entry.provider,
    providerModelId: entry.providerModelId!,
    ...(routing ? { routing: { rule: routing.rule, considered: routing.considered } } : {}),
    grounded,
    codeExecution,
  };

  turnLog.setModel({ requested: input.modelAlias, resolved: entry.alias, providerModelId: entry.providerModelId!, grounded });
  turnLog.stage('capabilities', { builtInSearch: grounded, searchAvailable, codeExecution });
  return {
    input,
    prefs,
    project,
    latestCompaction,
    history,
    entry,
    provider,
    grounded,
    modelInfo,
    ...(switched ? { switched } : {}),
    needs: { vision: requiresVision, grounding: requiresGrounding },
  };
}

/** The compaction stage's result: the latest compaction and the history, reloaded if it ran. */
export interface CompactedTurn {
  compactedNow: boolean;
  latestCompaction: ConversationCompactionRow | null;
  history: Turn[];
}

export async function* compactStage(
  svc: TurnServices,
  input: GenerateInput,
  turn: {
    prefs: PreferencesRow;
    entry: ModelEntry;
    provider: Provider;
    latestCompaction: ConversationCompactionRow | null;
    history: Turn[];
    timing: TurnTiming;
    turnLog: TurnLog;
  },
): AsyncGenerator<StreamEvent, CompactedTurn> {
  const { prefs, entry, provider, timing, turnLog } = turn;
  let { latestCompaction, history } = turn;
  // --- compact a long conversation (ADR-0019) ------------------------------
  let compactedNow = false;
  if (svc.cfg.ENABLE_CONTEXT_COMPACTION) {
    timing.mark('before_compaction');
    const compacted = yield* compactIfNeeded(svc, input, prefs, entry, provider);
    compactedNow = compacted;
    timing.mark('compaction');
    timing.note('compacted', compacted);
    turnLog.stage('compaction', { compacted });
    if (compacted) {
      latestCompaction = await compactionService.getLatestCompaction(input.chatId, svc.db);
      ({ turns: history } = await loadHistory(svc, input.chatId, input.messageId, latestCompaction?.throughSeq, entry.alias));
    }
  }
  return { compactedNow, latestCompaction, history };
}
