/**
 * What a turn sends the browser: the SSE event shapes and the DTOs inside them. Moved from
 * `services/generation.ts` unchanged, which still exports every name (ADR-0067).
 */
import { type ProviderSource, type ProviderUsage, type ReasoningEffort, type ToolErrorCode, type ToolResult, totalTokens } from '../../providers/types.js';
import type { UIBlock } from '../ui/types.js';
import type { RuntimeDebugTrace } from '../routing/turnRouter.js';

/* -------------------------------------------------------------------------- SSE shapes */

/**
 * Events sent to the browser.
 *
 * Intentionally close to the frontend's existing `AdapterEvent` union so the mock generator
 * can be replaced without redesigning the UI, extended with the ids, usage, and routing
 * metadata a real backend has to report.
 */
export type StreamEvent =
  /**
   * The first frame of every run (Stage 3 1.8, ADR-0078): the turn and both rows exist, so a
   * client that loses the connection now can reattach to this turn, and a retried send with the
   * same Idempotency-Key gets the same ids.
   */
  | {
      type: 'ack';
      turnId: string;
      /**
       * P22: present only when the turn runs in another chat than the one the request named: a
       * regenerate that keeps the old answer runs in its new version (ADR-0079). The client
       * follows it there (and reconnects there).
       */
      chatId?: string;
      messageId: string;
      userMessageId: string | null;
    }
  | { type: 'start'; messageId: string; chatId: string; requestId: string; model: ModelInfo }
  | { type: 'research'; event: { stage: string; label: string; detail: string; at: string } }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'sources'; sources: SourceDto[]; searchEntryPoint?: string }
  | { type: 'code'; code?: string; language?: string; output?: string }
  | { type: 'tool_use'; toolCallId: string; name: string; input: unknown }
  /**
   * `files`: what present_files gave the user, so the client shows (and opens) them at once.
   * `errorCode`: a failure the client recognises by code (Invariant 5), e.g. `sandbox_misconfigured`.
   */
  | { type: 'tool_result'; toolCallId: string; name: string; ok: boolean; preview: string; files?: PresentedFileDto[]; errorCode?: ToolErrorCode }
  | { type: 'artifact_created'; artifactId: string; title: string; kind: string; version: number }
  | { type: 'ui_block'; block: UIBlock }
  /**
   * ADR-0037: a visual's HTML while the model is still writing it. `text` continues the draft
   * `draftId` from character `from`. Drafts are shown, never kept: the checked block replaces
   * them when the call completes.
   */
  | { type: 'ui_draft'; draftId: string; title: string; from: number; text: string }
  | { type: 'debug'; trace: RuntimeDebugTrace }
  | {
      type: 'done';
      questions: string[];
      usage: UsageDto;
      finishReason: string;
      effort?: ReasoningEffort;
      /**
       * The answer stopped early and was kept: the model failed after a tool ran (ER-2b,
       * `partial_after_tool_run`, ADR-0072) or after text was shown (ER-3c, finish
       * `interrupted`, `errorCode` the cause; ADR-0081).
       */
      partial?: true;
      errorCode?: string;
      /** P11 (7.12, OQ-02 A): the turn was answered by another model than the first; the label. */
      fallback?: { from: string; reason: string };
    }
  /**
   * P11 (7.12, ADR-0081): the turn moved to the next model of its chain before anything was
   * shown. The client labels the answer "Answered by `to` because `from` was unavailable".
   */
  | { type: 'model_switch'; from: string; to: string; reason: string }
  | { type: 'error'; code: string; title: string; detail: string; usage?: UsageDto };

export interface PresentedFileDto {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
}

/** The files a successful present_files result holds, without their storage keys. */
export function presentedFiles(name: string, result: ToolResult): PresentedFileDto[] | undefined {
  if (name !== 'present_files' || !result.ok) return undefined;
  const json = result.content.find((c) => c.type === 'json') as { data?: { persistedFiles?: unknown } } | undefined;
  const files = Array.isArray(json?.data?.persistedFiles) ? (json.data.persistedFiles as PresentedFileDto[]) : [];
  return files.map(({ attachmentId, filename, mimeType, sizeBytes, downloadUrl }) => ({ attachmentId, filename, mimeType, sizeBytes, downloadUrl }));
}

export interface ModelInfo {
  requested: string;
  resolved: string;
  provider: string;
  providerModelId: string;
  /** Present only when the request asked for `Auto`, so routing is never opaque. */
  routing?: { rule: string; considered: string[] };
  grounded: boolean;
  codeExecution: boolean;
}

export interface SourceDto {
  id: number;
  title: string;
  url: string;
  urlResolved: boolean;
  domain: string;
  type: string;
  snippet: string;
  passage: string;
  retrievedAt: string;
}

export interface UsageDto {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** False means the provider reported nothing. The UI must not present zeros as measured. */
  exact: boolean;
  costUsd: number | null;
  /** `costUsd` at the planning rate (N-37); null whenever `costUsd` is. */
  costInr: number | null;
}

export function toUsageDto(
  usage: ProviderUsage,
  costUsd: number | null,
  costInr: number | null = null,
): UsageDto {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: totalTokens(usage),
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    exact: usage.exact,
    costUsd,
    costInr,
  };
}

export function toSourceDto(source: ProviderSource, id: number): SourceDto {
  return {
    id,
    title: source.title,
    url: source.url,
    urlResolved: source.urlResolved,
    domain: source.domain,
    type: source.sourceType,
    snippet: source.snippet,
    passage: source.passage,
    retrievedAt: source.retrievedAt.toISOString(),
  };
}
