/**
 * Runs a started turn on this instance (ADR-0078): the run is detached from the request that
 * started it, publishes to the hub (its first frame is `ack`), holds the turn's lease while it
 * works, and ends through the settle transaction whatever happens. The run is loaded from the
 * turn's row (`loadTurnInput`), not from the request, which is the seam an out-of-process
 * executor would use.
 */
import type { Services } from '../../container.js';
import { ApiError } from '../../errors.js';
import { errorLogFields } from '../../errorLog.js';
import { logger } from '../../logger.js';
import type { Run } from '../runHub.js';
import type { BudgetPrefs } from '../usage.js';
import { TurnRuntime } from './turnLease.js';
import { type StartedTurn, failTurn } from './turnStart.js';
import { type TurnBinding, FencedOut, loadTurnInput, recordResolvedModel } from './turnStore.js';

const log = logger.child({ module: 'turns' });

export function launchTurn(
  services: Pick<Services, 'db' | 'cfg' | 'usage' | 'generation' | 'runHub'>,
  started: StartedTurn,
  ctx: { userId: string; chatId: string; requestId: string; prefs: BudgetPrefs },
): Run {
  const { db, cfg, runHub, generation } = services;
  const controller = new AbortController();
  const run = runHub.start(ctx.chatId, ctx.userId, started.assistantMessageId, controller, started.turnId);
  run.publish({ type: 'ack', turnId: started.turnId, messageId: started.assistantMessageId, userMessageId: started.userMessageId });

  run.done = (async () => {
    const startedAt = new Date();
    let binding: TurnBinding = { turnId: started.turnId, fencingToken: 1, reservation: null };
    let runtime: TurnRuntime | undefined;
    let mode = 'chat';
    let projectId: string | null = null;
    let model: { alias: string; provider: string; providerModelId: string } | null = null;
    try {
      const input = await loadTurnInput(db, started.turnId);
      binding = input.turn;
      mode = input.mode;
      projectId = input.projectId;
      runtime = new TurnRuntime(db, cfg, binding, input.messageId, controller, () => run.lastIndex);
      runtime.start();
      for await (const event of generation.run({ ...input, requestId: ctx.requestId, signal: controller.signal, checkpoint: runtime })) {
        if (event.type === 'start') {
          model = { alias: event.model.resolved, provider: event.model.provider, providerModelId: event.model.providerModelId };
          // So a takeover can bill the call it cannot see (an `exact: false` row, not none).
          await recordResolvedModel(db, binding, model).catch((err: unknown) => log.warn({ turnId: started.turnId, ...errorLogFields(err) }, 'resolved model not recorded'));
        }
        run.publish(event);
      }
    } catch (err) {
      if (err instanceof FencedOut || runtime?.lost) {
        // Another instance took the turn over and has already ended it; nothing is written here.
        log.warn({ turnId: started.turnId }, 'run ended after its lease was taken over');
        const lost = new ApiError('interrupted');
        run.publish({ type: 'error', code: lost.code, title: lost.title, detail: lost.detail });
        return;
      }
      // The response is already committed as 200/event-stream, so an error cannot become a
      // status code here. It is delivered as a typed frame the client already handles.
      const body =
        err instanceof ApiError
          ? { code: err.code, title: err.title, detail: err.detail }
          : { code: 'internal_error', title: 'Something went wrong', detail: 'The response could not finish.' };
      if (!(err instanceof ApiError)) log.error({ turnId: started.turnId, ...errorLogFields(err) }, 'generation failed');
      await failTurn(
        services,
        { userId: ctx.userId, chatId: ctx.chatId, messageId: started.assistantMessageId, requestId: ctx.requestId, projectId },
        binding,
        { code: body.code, mode, prefs: ctx.prefs, startedAt, model },
      );
      run.publish({ type: 'error', ...body });
    } finally {
      runtime?.stop();
      runHub.finish(run);
    }
  })();
  return run;
}
