/**
 * What a turn is started with: the route's input and the user's preferences row. Moved from
 * `services/generation.ts` unchanged, which still exports every name (ADR-0067).
 */
import type { AttachmentBlock, AttachmentRef, Mode, ReasoningEffort } from '../../providers/types.js';
import type { ManifestFile } from '../attachments/manifest.js';

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
}

export interface PreferencesRow {
  instructions: string;
  styleId?: string;
  maxOutputTokens: number;
  dailyTokenBudget: number | null;
  monthlyTokenBudget: number | null;
  warnThresholdPct: number;
  routingPreference: string;
  timezone: string;
  effort?: ReasoningEffort | null;
  /** The user's memory setting (ADR-0052). */
  memoryEnabled: boolean;
  /** The user's past-chat search setting (ADR-0052). */
  chatSearchEnabled: boolean;
}
