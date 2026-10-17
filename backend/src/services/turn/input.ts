/**
 * What a turn is started with: the route's input and the user's preferences row. Moved from
 * `services/generation.ts` unchanged, which still exports every name (ADR-0067).
 */
import type { AttachmentBlock, AttachmentRef, Mode, ReasoningEffort } from '../../providers/types.js';
import type { ManifestFile } from '../attachments/manifest.js';
import type { TurnBinding } from './turnStore.js';

/**
 * What a run reports while it streams (ADR-0078): the answer so far, written to the message row at
 * most every TURN_FLUSH_MS, fenced on the turn's token. The route supplies it; without one (a
 * script driving the service directly) nothing is flushed.
 */
export interface TurnCheckpoint {
  flush(answer: { text: string; thinking: string; segments: unknown[] }, force?: boolean): Promise<void>;
}

/** What AgentLoop receives: the turn with its attachments already hydrated for the provider. */
export type AgentLoopInput = Omit<GenerateInput, 'attachments'> & {
  attachments: AttachmentBlock[];
  /** Every file in the conversation, as the attachment manifest lists them. */
  chatFiles?: ManifestFile[];
};

export interface GenerateInput {
  userId: string;
  requestId: string;
  chatId: string;
  /** The assistant message row to fill in. Created by the route before streaming starts. */
  messageId: string;
  prompt: string;
  mode: Mode;
  modelAlias: string;
  projectId: string | null;
  hasAttachments: boolean;
  /** This turn's attachments, normalised once by `toAttachmentRef`. */
  attachments: AttachmentRef[];
  /** Opt-in per request. Only Gemini has a code-execution sandbox on Vertex — see ADR-0004. */
  codeExecution: boolean;
  effort?: ReasoningEffort;
  /** Optional style override for this turn (preset name or custom style UUID). */
  styleId?: string;
  /** The device the request came from, so visuals are sized for it (ADR-0049). */
  clientPlatform?: 'mobile' | 'desktop';
  signal: AbortSignal;
  /** The durable turn this run writes for (ADR-0078). Absent for a script calling the service. */
  turn?: TurnBinding;
  checkpoint?: TurnCheckpoint;
  /**
   * P13 (ADR-0080): the history summary this turn uses, read once in `prepareTurn` so the
   * history, the rendered summary and the stamps describe the same row. Null: none applies.
   */
  historySummary?: import('../summary/summaryStore.js').ActiveSummary | null;
  /** P11 (ER-4f): epoch ms of the turn's deadline; past it no retry and no hop starts. */
  deadlineAt?: number;
}

export interface PreferencesRow {
  instructions: string;
  styleId?: string;
  maxOutputTokens: number;
  dailyTokenBudget: number | null;
  monthlyTokenBudget: number | null;
  warnThresholdPct: number;
  timezone: string;
  effort?: ReasoningEffort | null;
  /** The user's memory setting (ADR-0052). */
  memoryEnabled: boolean;
  /** The user's past-chat search setting (ADR-0052). */
  chatSearchEnabled: boolean;
}
