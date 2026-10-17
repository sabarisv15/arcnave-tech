/**
 * Process entry point.
 *
 * Owns only process concerns: configuration, listening, periodic housekeeping, and graceful
 * shutdown. The application itself is built by `createApp` so tests never bind a port.
 */
import { createApp } from './app.js';
import { config, providerReadiness } from './config.js';
import { closeDb } from './db/client.js';
import { logger } from './logger.js';
import { sweepRetention } from './services/retention.js';
import { sweepCheckpoints } from './services/sandboxCheckpoints.js';
import { drain } from './services/shutdown.js';
import { sweepTurns } from './services/turn/turnStore.js';
import { errorLogFields } from './errorLog.js';

/** How often expired session rows are swept. Cheap, indexed, and not time-critical. */
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

async function main(): Promise<void> {
  const cfg = config();
  const app = await createApp(cfg);

  const sweep = setInterval(() => {
    void app.services.auth
      .purgeExpired()
      .then((count) => {
        if (count > 0) logger.info({ count }, 'purged expired sessions');
      })
      .catch((err: unknown) => logger.error({ err }, 'session sweep failed'));
  }, SESSION_SWEEP_INTERVAL_MS);
  // Do not hold the event loop open for housekeeping.
  sweep.unref();

  // Deleted chats and unsent uploads (services/retention.ts). Hourly is far inside the 30-day
  // promise; the advisory lock makes concurrent instances take turns.
  const retention = setInterval(() => {
    void sweepRetention(app.services.db, app.services.storage, {
      chatPurgeAfterDays: cfg.CHAT_PURGE_AFTER_DAYS,
      unsentUploadTtlHours: cfg.UNSENT_UPLOAD_TTL_HOURS,
      sandboxStateDays: cfg.SANDBOX_STATE_RETENTION_DAYS,
      statementTimeoutMs: cfg.DB_LONG_STATEMENT_TIMEOUT_MS,
    }, new Date(), logger)
      .then((r) => {
        if (r.chatsPurged > 0 || r.uploadsPurged > 0 || r.checkpointsPurged > 0) logger.info(r, 'retention sweep');
      })
      .catch((err: unknown) => logger.error({ err }, 'retention sweep failed'));
  }, SESSION_SWEEP_INTERVAL_MS);
  retention.unref();

  // Idle sandbox workspaces are checkpointed to storage (ADR-0015) after about 5 minutes
  // without a run. Every minute; the advisory lock makes instances take turns.
  const warmSandbox = app.services.warmSandbox;
  if (warmSandbox) {
    const checkpoints = setInterval(() => {
      void sweepCheckpoints(app.services.db, warmSandbox, cfg.SANDBOX_CHECKPOINT_IDLE_SECONDS, logger)
        .then((r) => {
          if (r.saved > 0 || r.failed > 0) logger.info(r, 'sandbox checkpoint sweep');
        })
        .catch((err: unknown) => logger.error({ err }, 'sandbox checkpoint sweep failed'));
    }, 60_000);
    checkpoints.unref();
  }

  // Durable turns (ADR-0078): turns whose runner died, reservations nobody settled, old
  // idempotency keys. Once at boot, then every N-76 60 s; SKIP LOCKED lets instances overlap.
  const sweepTurnsOnce = (): void => {
    void sweepTurns(app.services).catch((err: unknown) => logger.error(errorLogFields(err), 'turn sweep failed'));
  };
  sweepTurnsOnce();
  const turnSweep = cfg.TURN_SWEEP_INTERVAL_MS > 0 ? setInterval(sweepTurnsOnce, cfg.TURN_SWEEP_INTERVAL_MS) : undefined;
  turnSweep?.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(sweep);
    clearInterval(retention);
    clearInterval(turnSweep);
    // Cloud Run kills the container 10 s after SIGTERM; whatever the drain is waiting on by
    // then, the process ends first, on its own terms.
    setTimeout(() => process.exit(1), cfg.SHUTDOWN_HARD_EXIT_MS).unref();

    try {
      // Refuse new runs, stop the running ones with a typed reason and wait (N-73 5 s) until each
      // has settled, then close the server and the pool (services/shutdown.ts).
      await drain(app, { closeDb });
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error(errorLogFields(err), 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });

  // File jobs (ADR-0062): queued uploads, abandoned leases, and the re-index backfill.
  app.services.files.start();

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  logger.info(
    {
      port: cfg.PORT,
      host: cfg.HOST,
      env: cfg.NODE_ENV,
      apiPrefix: cfg.API_PREFIX,
      vertexConfigured: cfg.vertexConfigured,
      anthropicConfigured: cfg.anthropicConfigured,
      docs: `http://${cfg.HOST}:${cfg.PORT}/docs`,
    },
    'arcnave backend listening',
  );

  const readiness = providerReadiness(cfg);
  if (readiness.google.inUse && !readiness.google.configured) {
    logger.warn(
      'GOOGLE_CLOUD_PROJECT is not set. The Gemini alias will report vertex_not_configured; ' +
        'chats, projects, and settings still work.',
    );
  }
  if (readiness.anthropic.inUse && !readiness.anthropic.configured) {
    logger.warn(
      'ANTHROPIC_API_KEY is not set. The Claude aliases will report anthropic_not_configured; ' +
        'chats, projects, and settings still work.',
    );
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
