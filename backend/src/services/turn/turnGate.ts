/**
 * The checks a send passes before anything is written (Stage 3 1.6, ADR-0078): the user's
 * preferences, the budget, and an explicitly named model. A refusal here is an HTTP status with
 * a typed code (402 `budget_exceeded`, 400 `model_unavailable`), not an `error` frame after a
 * user message was already saved. The budget is decided for good by the reservation, under the
 * counter's row lock, in the start transaction; this read only refuses early what that would.
 * `Auto` is resolved when the turn runs (P10 moves its checks here).
 */
import type { Config } from '../../config.js';
import type { Database } from '../../db/client.js';
import { ApiError } from '../../errors.js';
import { AUTO_ALIAS, type ModelRegistry } from '../../providers/registry.js';
import { BudgetExceededError, type UsageService } from '../usage.js';
import { loadPreferences } from './context.js';
import type { PreferencesRow } from './input.js';

/** A model that is named but cannot be served by this deployment at all. */
const NOT_CONFIGURED = new Set(['not_configured', 'vertex_not_configured', 'anthropic_not_configured']);

export async function precheckTurn(
  svc: { db: Database; usage: UsageService; registry: ModelRegistry; cfg: Pick<Config, 'DEFAULT_MAX_OUTPUT_TOKENS' | 'MAX_OUTPUT_TOKENS_CEILING'> },
  userId: string,
  modelAlias: string,
): Promise<{ prefs: PreferencesRow; reserveTokens: number }> {
  const prefs = await loadPreferences(svc, userId);

  const state = await svc.usage.budgetState(userId, prefs);
  if (state.dailyLimit && state.dailyUsed >= state.dailyLimit) {
    throw new BudgetExceededError('daily', state.dailyUsed, state.dailyLimit);
  }
  if (state.monthlyLimit && state.monthlyUsed >= state.monthlyLimit) {
    throw new BudgetExceededError('monthly', state.monthlyUsed, state.monthlyLimit);
  }

  if (modelAlias !== AUTO_ALIAS) {
    const status = await svc.registry.status(modelAlias, { probe: 'never' });
    if (!status) {
      throw new ApiError('model_unavailable', {
        detail: `There is no model called "${modelAlias}". Choose one from the list, or Auto.`,
        meta: { alias: modelAlias, reason: 'unknown_alias' },
      });
    }
    if (!status.available && NOT_CONFIGURED.has(status.reason)) {
      throw new ApiError('model_unavailable', { detail: status.detail, meta: { alias: modelAlias, reason: status.reason } });
    }
  }

  // N-74: the worst case this turn can cost, held until it settles. The model is not known yet
  // under Auto, so it is the user's ceiling; the context build lowers it to the model's own.
  const reserveTokens = Math.min(prefs.maxOutputTokens || svc.cfg.DEFAULT_MAX_OUTPUT_TOKENS, svc.cfg.MAX_OUTPUT_TOKENS_CEILING);
  return { prefs, reserveTokens };
}
