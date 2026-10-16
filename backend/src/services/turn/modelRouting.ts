/**
 * Routing: which model answers the turn. A named model is used when it can do what the turn
 * needs; `Auto` keeps the chat's model, else routes to Gemini 3.8 Flash (Stage 7 RT-1,
 * ADR-0076). The user's routing preference is not an input any more: Auto is rules only.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { messages } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { type ModelEntry, AUTO_ALIAS } from '../../providers/registry.js';
import { type RoutingDecision, routeAuto } from '../../providers/routing.js';
import type { TurnServices } from './services.js';
import type { GenerateInput } from './input.js';
import { logger } from '../../logger.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

/** The model that answered this chat's latest completed turn, if any. */
export async function chatModelAlias(svc: TurnServices, chatId: string, currentMessageId: string): Promise<string | null> {
  const [row] = await svc.db
    .select({ alias: messages.modelAlias })
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        eq(messages.role, 'assistant'),
        eq(messages.status, 'complete'),
        sql`${messages.id} <> ${currentMessageId}`,
        sql`${messages.modelAlias} is not null`,
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(1);
  return row?.alias ?? null;
}

export async function resolveModel(
  svc: TurnServices,
  input: GenerateInput,
  requiresGrounding: boolean,
  requiresVision: boolean,
): Promise<{ entry: ModelEntry; routing: RoutingDecision | null }> {
  if (input.modelAlias !== AUTO_ALIAS) {
    const status = await svc.registry.status(input.modelAlias, { probe: 'never' });
    if (status && status.available) {
      if (requiresVision && !status.entry.supportsVision) {
        throw new ApiError('capability_unavailable', {
          detail:
            `"${input.modelAlias}" cannot see images or PDFs. Choose a different model, or ` +
            'remove the attachment.',
          meta: { alias: input.modelAlias, capability: 'vision' },
        });
      }
      return { entry: status.entry, routing: null };
    }
    // A substitution with a log line only: no fallback reason or label reaches the answer yet
    // (Invariant 1 gap, DEFERRED to P11, ADR-0076). It goes through Auto below, so the chat's
    // earlier model may be kept, which can be another Claude model.
    log.info({ requested: input.modelAlias }, 'Requested model is disabled or unavailable; answering through Auto');
  }

  const available = await svc.registry.availableEntries({ probe: 'never' });
  // One model per conversation. Auto picks once, then the chat stays on that
  // model while it is available and can do what the turn needs: a follow-up about a file is
  // not handed to a weaker model, and thinking tied to the model is not lost mid-task.
  const earlier = await chatModelAlias(svc, input.chatId, input.messageId);
  // Opus is a manual choice only (Stage 7 M1, Stage 18 "Opus never default", ADR-0076): Auto
  // never keeps it, so a chat the old Auto promoted to Opus, or one where the user picked Opus,
  // goes to Auto's own model once the user selects Auto.
  const kept = available.find(
    (e) =>
      e.alias === earlier &&
      e.tier !== 'quality' &&
      (!requiresVision || e.supportsVision) &&
      (!requiresGrounding || e.supportsGrounding),
  );
  if (kept) {
    return { entry: kept, routing: { alias: kept.alias, entry: kept, rule: 'same_model_as_chat', considered: [kept.alias] } };
  }
  const decision = routeAuto({ requiresVision, requiresGrounding }, available);
  if (!decision) {
    // A new Auto decision is Gemini or nothing: routeAuto never picks a Claude model in its place
    // (Invariant 1). The user can pick one by name.
    throw new ApiError('no_model_available', {
      detail:
        input.modelAlias === AUTO_ALIAS
          ? 'Auto answers with Gemini 3.8 Flash, which is not available right now. Pick a model by name.'
          : `"${input.modelAlias}" is not available, and Auto's model (Gemini 3.8 Flash) is not available either.`,
      meta: { alias: input.modelAlias, reason: 'auto_model_unavailable' },
    });
  }
  return { entry: decision.entry, routing: decision };
}
