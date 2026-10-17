/**
 * Persistence: the rows a turn writes as it runs (progress events, tool calls). Moved from
 * `GenerationService` unchanged but for `this` becoming `svc` (ADR-0067). What it writes when it
 * ends (the message, its sources, usage, the turn) is one transaction in `turnStore.ts` (ADR-0078).
 */
import { eq, sql } from 'drizzle-orm';
import { researchEvents, toolCalls } from '../../db/schema.js';
import { type ToolResult, withoutImageBytes } from '../../providers/types.js';
import type { TurnServices } from './services.js';
import type { StreamEvent } from './events.js';

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
