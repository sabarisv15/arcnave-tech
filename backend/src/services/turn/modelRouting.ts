/**
 * Routing: which model answers the turn. A named model is used when it can do what the turn
 * needs; `Auto` keeps the chat's model, else routes. Moved from `GenerationService` unchanged
 * but for `this` becoming `svc` (ADR-0067).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { messages } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { type ModelEntry, AUTO_ALIAS } from '../../providers/registry.js';
import { type RoutingDecision, routeAuto } from '../../providers/routing.js';
import type { TurnServices } from './services.js';
import type { GenerateInput, PreferencesRow } from './input.js';
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
  prefs: PreferencesRow,
  requiresGrounding: boolean,
  requiresVision: boolean,
  contextChars: number,
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
    log.info(
      { requested: input.modelAlias },
      'Requested model is disabled or unavailable; falling back to active Gemini 3.8 Flash via Auto',
    );
  }

  const available = await svc.registry.availableEntries({ probe: 'never' });
  // One model per conversation. Auto picks once, then the chat stays on that
  // model while it is available and can do what the turn needs: a follow-up about a file is
  // not handed to a weaker model, and thinking tied to the model is not lost mid-task.
  const earlier = await chatModelAlias(svc, input.chatId, input.messageId);
  const kept = available.find(
    (e) =>
      e.alias === earlier &&
      (!requiresVision || e.supportsVision) &&
      (!requiresGrounding || e.supportsGrounding),
  );
  if (kept) {
    return { entry: kept, routing: { alias: kept.alias, entry: kept, rule: 'same_model_as_chat', considered: [kept.alias] } };
  }
  const decision = routeAuto(
    {
      mode: input.mode,
      promptChars: input.prompt.length,
      contextChars,
      hasAttachments: input.hasAttachments,
      requiresVision,
      routingPreference: normalizeTier(prefs.routingPreference),
      requiresGrounding,
    },
    svc.cfg,
    available,
  );
  if (!decision) {
    throw new ApiError('no_model_available', {
      detail: requiresVision
        ? 'No configured model can see images or PDFs. Remove the attachment, or configure ' +
          'a model that can.'
        : requiresGrounding
          ? 'No configured model supports grounded search. Enable grounding or use Chat mode.'
          : 'No model in the registry is configured and reachable. Check the MODEL_* ' +
            'environment variables.',
    });
  }
  return { entry: decision.entry, routing: decision };
}

function normalizeTier(value: string): 'quality' | 'balanced' | 'economy' {
  return value === 'quality' || value === 'economy' ? value : 'balanced';
}
