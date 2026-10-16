/**
 * Persistence: the rows a turn writes as it runs (progress events, tool calls) and when it
 * ends (the assistant message, its sources, the chat's `updatedAt`). Moved from
 * `GenerationService` unchanged but for `this` becoming `svc` (ADR-0067).
 */
import { eq, sql } from 'drizzle-orm';
import { chats, messages, messageSources, researchEvents, toolCalls, type MessageSegment } from '../../db/schema.js';
import type { ModelEntry } from '../../providers/registry.js';
import { type Mode, type ProviderSource, type ReasoningEffort, type ToolResult, withoutImageBytes } from '../../providers/types.js';
import type { TurnServices } from './services.js';
import type { StreamEvent } from './events.js';
import type { GenerateInput } from './input.js';

export async function persistEvent(
  svc: TurnServices,
  messageId: string,
  event: StreamEvent,
  ordinal?: number,
): Promise<void> {
  if (event.type !== 'research') return;
  const index =
    ordinal ??
    (
      await svc.db
        .select({ next: sql<number>`coalesce(max(${researchEvents.ordinal}), -1) + 1` })
        .from(researchEvents)
        .where(eq(researchEvents.messageId, messageId))
    )[0]?.next ??
    0;
  await svc.db
    .insert(researchEvents)
    .values({
      messageId,
      ordinal: index,
      stage: event.event.stage,
      label: event.event.label.slice(0, 300),
      detail: event.event.detail,
      at: new Date(event.event.at),
    })
    .onConflictDoNothing();
}

/**
 * Persists the full bounded `ToolResult` the model actually received — not the SSE preview,
 * and never a further-truncated copy. `input` always becomes `{}` when the provider reported
 * none, so this insert can never contradict the column's `NOT NULL` constraint.
 */
export async function persistToolCall(
  svc: TurnServices,
  messageId: string,
  toolCallId: string,
  name: string,
  input: unknown,
  result: ToolResult,
  ordinal: number,
  thoughtSignature?: string,
): Promise<void> {
  await svc.db
    .insert(toolCalls)
    .values({
      messageId,
      ordinal,
      toolCallId,
      name,
      input: input ?? {},
      content: withoutImageBytes(result.content),
      ok: result.ok,
      thoughtSignature: thoughtSignature ?? null,
    })
    .onConflictDoNothing();
}

export async function finalise(
  svc: TurnServices,
  input: GenerateInput,
  result: {
    text: string;
    sources: ProviderSource[];
    searchEntryPoint: string | undefined;
    status: 'complete' | 'stopped' | 'error';
    errorCode: string | null;
    finishReason: string | null;
    entry: ModelEntry;
    mode: Mode;
    questions?: string[];
    thinking?: string;
    segments?: MessageSegment[];
    effort?: ReasoningEffort;
  },
): Promise<void> {
  const researchStage =
    result.mode === 'chat'
      ? null
      : result.status === 'error'
        ? 'error'
        : result.status === 'stopped'
          ? 'partial'
          : result.sources.length > 0
            ? 'complete'
            : 'partial';

  await svc.db
    .update(messages)
    .set({
      text: result.text,
      ...(result.thinking ? { thinking: result.thinking } : {}),
      ...(result.segments && result.segments.length > 0 ? { segments: result.segments } : {}),
      status: result.status,
      errorCode: result.errorCode,
      researchStage,
      questions: result.questions ?? [],
      modelAlias: result.entry.alias,
      effort: result.effort ?? null,
      provider: result.entry.provider,
      providerModelId: result.entry.providerModelId ?? null,
      finishReason: result.finishReason,
      searchEntryPoint: result.searchEntryPoint ?? null,
      completedAt: new Date(),
    })
    .where(eq(messages.id, input.messageId));

  if (result.sources.length > 0) {
    // Replace rather than append: a retry of the same message must not double its citations.
    await svc.db.delete(messageSources).where(eq(messageSources.messageId, input.messageId));
    await svc.db.insert(messageSources).values(
      result.sources.map((s, i) => ({
        messageId: input.messageId,
        ordinal: i + 1,
        title: s.title.slice(0, 500),
        url: s.url,
        urlResolved: s.urlResolved,
        domain: s.domain.slice(0, 255),
        sourceType: s.sourceType,
        snippet: s.snippet,
        passage: s.passage,
        retrievedAt: s.retrievedAt,
      })),
    );
  }

  await svc.db
    .update(chats)
    .set({ updatedAt: new Date() })
    .where(eq(chats.id, input.chatId));
}
