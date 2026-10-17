/**
 * Routing: which model answers the turn. A named model is used when it can do what the turn
 * needs; `Auto` keeps the chat's model, else routes to Gemini 3.8 Flash (Stage 7 RT-1,
 * ADR-0076). The user's routing preference is not an input any more: Auto is rules only.
 * When the model asked for (or Auto's) is unavailable, the turn starts on the next model of its
 * fallback chain, labelled (P11, K-15, ADR-0081).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { messages } from '../../db/schema.js';
import { ApiError } from '../../errors.js';
import { type ModelEntry, AUTO_ALIAS } from '../../providers/registry.js';
import { AUTO_PROVIDER, type RoutingDecision, routeAuto } from '../../providers/routing.js';
import type { FallbackReason } from '../../providers/failures.js';
import { nextInChain } from '../../providers/fallback.js';
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

/** The model a turn starts on, and the labelled switch when it is not the one asked for (K-15). */
export interface ResolvedModel {
  entry: ModelEntry;
  routing: RoutingDecision | null;
  /** P11 (7.12, OQ-02 A): the asked-for model was unavailable; the turn starts down its chain. */
  switched?: { from: string; reason: FallbackReason };
}

/** The next model of `origin`'s chain that is configured, admitted and can do what the turn needs. */
function chainFrom(
  svc: TurnServices,
  origin: string,
  available: ModelEntry[],
  needs: { vision: boolean; grounding: boolean },
): ModelEntry | null {
  if (!svc.cfg.FALLBACK_ENABLED) return null;
  return nextInChain({
    origin,
    tried: new Set([origin]),
    skipProviders: new Set(),
    needs,
    entries: available,
    admissible: (e) => svc.gateway.breaker.wouldAdmit(e.alias, e.providerModelId).ok,
  });
}

export async function resolveModel(
  svc: TurnServices,
  input: GenerateInput,
  requiresGrounding: boolean,
  requiresVision: boolean,
): Promise<ResolvedModel> {
  const needs = { vision: requiresVision, grounding: requiresGrounding };
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
    // K-15 (P11, ADR-0081): a picked model that is switched off or known to be unavailable goes
    // down its own fallback chain, with a label on the answer; never silently through Auto.
    const reason: FallbackReason = status?.reason === 'disabled' ? 'disabled' : 'unavailable';
    const next = chainFrom(svc, input.modelAlias, await svc.registry.availableEntries({ probe: 'never' }), needs);
    if (next) {
      log.warn({ code: 'model_fallback', from: input.modelAlias, to: next.alias, reason }, 'requested model unavailable; next model of its chain, labelled');
      return { entry: next, routing: null, switched: { from: input.modelAlias, reason } };
    }
    throw new ApiError('model_unavailable', {
      detail: `"${input.modelAlias}" is not available right now, and no other model can take this turn. Choose another model, or try again later.`,
      meta: { alias: input.modelAlias, reason: status?.reason ?? 'unknown' },
    });
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
    // Auto's model (Gemini) cannot take the turn. P11 (7.12, OQ-02 A): its chain answers, and the
    // answer says so; Auto never substitutes silently (Invariant 1).
    const gemini = svc.registry.aliases.map((a) => svc.registry.entry(a)!).find((e) => e.provider === AUTO_PROVIDER);
    const next = gemini ? chainFrom(svc, gemini.alias, available, needs) : null;
    if (gemini && next) {
      const status = await svc.registry.status(gemini.alias, { probe: 'never' });
      const reason: FallbackReason = status?.reason === 'disabled' ? 'disabled' : 'unavailable';
      log.warn({ code: 'model_fallback', from: gemini.alias, to: next.alias, reason }, "Auto's model unavailable; next model of its chain, labelled");
      return {
        entry: next,
        routing: { alias: next.alias, entry: next, rule: 'auto_fallback', considered: [gemini.alias, next.alias] },
        switched: { from: gemini.alias, reason },
      };
    }
    throw new ApiError('no_model_available', {
      detail: 'Auto answers with Gemini 3.8 Flash, which is not available right now, and no other model can take this turn. Pick a model by name.',
      meta: { alias: input.modelAlias, reason: 'auto_model_unavailable' },
    });
  }
  return { entry: decision.entry, routing: decision };
}
