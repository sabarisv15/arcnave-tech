/**
 * The history window applied to one turn's request, and the turn's stamps (Stage 6 HIST-WINDOW,
 * STAMPS; ADR-0080). Called once from the context build, after the system instruction is known
 * (its size is the fixed part) and before anything reads the history (attachments, manifest).
 */
import { eq } from 'drizzle-orm';

import { NUMBERS } from '../../config/numbers.js';
import { messages } from '../../db/schema.js';
import type { ModelEntry } from '../../providers/registry.js';
import type { ToolDefinition, Turn } from '../../providers/types.js';
import type { TurnLog } from '../turnLog.js';
import type { GenerateInput } from '../turn/input.js';
import type { TurnServices } from '../turn/services.js';
import { exchangeCountText, groupExchanges, selectWindow } from './historyWindow.js';
import { countTexts } from './tokenCounts.js';

export interface TurnStamps {
  historyTurns: number;
  historyDroppedTurns: number;
  ctxTokens: number | null;
  ctxFixedTokens: number | null;
  ctxCountSource: 'provider' | 'none';
  overBudget: boolean | null;
  summaryVersion: number | null;
  promptVersion: string | null;
  /** Null until the registry is versioned (P10). */
  registryVersion: null;
}

/**
 * The fixed part as it is counted: the stable text and the session state (wherever the provider's
 * layout puts them) and the tool declarations. Not counted: the `<current_time>` line, the tags
 * around the summary and the history, and attachments (the file budget sizes those, CXD-4).
 */
export function fixedPartText(systemInstruction: string, tools: readonly ToolDefinition[]): string {
  return tools.length === 0
    ? systemInstruction
    : `${systemInstruction}\n${JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })))}`;
}

export async function applyHistoryWindow(
  svc: TurnServices,
  input: GenerateInput,
  args: {
    entry: ModelEntry;
    history: Turn[];
    systemInstruction: string;
    tools: readonly ToolDefinition[];
    promptVersion: string;
    turnLog: TurnLog;
  },
): Promise<Turn[]> {
  const exchanges = groupExchanges(args.history);
  const summary = input.historySummary ?? null;
  if (!svc.cfg.ENABLE_HISTORY_SUMMARY) {
    // The legacy path is unchanged: no count, no window; only what it sent is stamped.
    await writeTurnStamps(svc, input.messageId, {
      historyTurns: exchanges.length,
      historyDroppedTurns: 0,
      ctxTokens: null,
      ctxFixedTokens: null,
      ctxCountSource: 'none',
      overBudget: null,
      summaryVersion: null,
      promptVersion: args.promptVersion,
      registryVersion: null,
    });
    return args.history;
  }

  const provider = svc.registry.providerFor(args.entry);
  const counts = provider
    ? await countTexts(
        provider,
        [fixedPartText(args.systemInstruction, args.tools), input.prompt, summary?.text ?? '', ...exchanges.map(exchangeCountText)],
        NUMBERS.HISTORY_COUNT_TIMEOUT_MS.value, // N-75
        input.signal,
      )
    : null;
  const result = selectWindow({
    exchanges,
    exchangeTokens: counts ? counts.slice(3) : null,
    fixedTokens: counts ? counts[0]! : null,
    promptTokens: counts ? counts[1]! : null,
    summaryTokens: counts ? counts[2]! : 0,
    budget: NUMBERS.INPUT_BUDGET_NORMAL.value, // N-03 (Normal; profiles are P10)
    maxTurns: NUMBERS.HISTORY_TURNS.value, // N-16
    floor: NUMBERS.HISTORY_FLOOR_TURNS.value, // N-75
    keepUncovered: svc.cfg.HISTORY_KEEP_UNCOVERED,
  });
  const stamps: TurnStamps = {
    historyTurns: result.kept.length,
    historyDroppedTurns: result.dropped,
    ctxTokens: result.totalTokens,
    ctxFixedTokens: counts ? counts[0]! : null,
    ctxCountSource: counts ? 'provider' : 'none',
    overBudget: result.overBudget,
    summaryVersion: summary?.summaryVersion ?? null,
    promptVersion: args.promptVersion,
    registryVersion: null,
  };
  await writeTurnStamps(svc, input.messageId, stamps);
  args.turnLog.stage('history window', {
    exchanges: exchanges.length,
    kept: stamps.historyTurns,
    dropped: stamps.historyDroppedTurns,
    ctxTokens: stamps.ctxTokens,
    countSource: stamps.ctxCountSource,
    overBudget: stamps.overBudget,
    summaryVersion: stamps.summaryVersion,
  });
  return result.kept.flat();
}

/** The stamps go on the assistant row: ids and counts only (Stage 17 NO_CONTENT). */
export async function writeTurnStamps(svc: Pick<TurnServices, 'db'>, messageId: string, stamps: TurnStamps): Promise<void> {
  await svc.db.update(messages).set(stamps).where(eq(messages.id, messageId));
}
