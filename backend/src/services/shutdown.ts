/**
 * SIGTERM drain (Stage 19 S19-18, D3 A-02, ADR-0078). Cloud Run sends SIGTERM and kills the
 * container 10 s later. Inside N-73's 5 s budget: new generates are refused (503
 * `server_shutdown`), every run here is stopped with that typed reason and awaited until it has
 * settled (message, usage, reservation and turn in one transaction), which ends its SSE streams;
 * then the server and the pool close. A run that has not settled when the budget is up is left to
 * the sweeper of another instance (its lease lapses), and the process exits.
 */
import type { AppInstance } from '../types.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';

export interface DrainResult {
  runs: number;
  /** All stopped runs settled inside the budget. */
  settled: boolean;
  ms: number;
}

export async function drain(
  app: AppInstance,
  opts: { budgetMs?: number; closeDb?: () => Promise<void>; closeApp?: boolean } = {},
): Promise<DrainResult> {
  const { services } = app;
  const budgetMs = opts.budgetMs ?? services.cfg.SHUTDOWN_DRAIN_MS;
  const began = Date.now();
  services.lifecycle.draining = true;
  const runs = services.runHub.activeRuns();
  let timer: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    services.runHub.abortAll(new ApiError('server_shutdown')).then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), budgetMs);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);
  const result = { runs: runs.length, settled, ms: Date.now() - began };
  logger.info(result, 'drained');
  if (opts.closeApp !== false) await app.close();
  if (opts.closeDb) await opts.closeDb();
  return result;
}
