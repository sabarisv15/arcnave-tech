/**
 * Process entry point.
 *
 * Owns only process concerns: configuration, listening, periodic housekeeping, and graceful
 * shutdown. The application itself is built by `createApp` so tests never bind a port.
 */
import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db/client.js';
import { logger } from './logger.js';
import { sweepRetention } from './services/retention.js';

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
    }, new Date(), logger)
      .then((r) => {
        if (r.chatsPurged > 0 || r.uploadsPurged > 0) logger.info(r, 'retention sweep');
      })
      .catch((err: unknown) => logger.error({ err }, 'retention sweep failed'));
  }, SESSION_SWEEP_INTERVAL_MS);
  retention.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(sweep);
    clearInterval(retention);

    // Abort in-flight generations first so their SSE connections close and their usage rows
    // are written, rather than being cut off mid-stream by the socket closing under them.
    for (const controller of app.services.activeRuns.values()) controller.abort();

    try {
      await app.close();
      await closeDb();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error during shutdown');
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

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  logger.info(
    {
      port: cfg.PORT,
      host: cfg.HOST,
      env: cfg.NODE_ENV,
      apiPrefix: cfg.API_PREFIX,
      vertexConfigured: cfg.vertexConfigured,
      docs: `http://${cfg.HOST}:${cfg.PORT}/docs`,
    },
    'arcnave backend listening',
  );

  if (!cfg.vertexConfigured) {
    logger.warn(
      'GOOGLE_CLOUD_PROJECT is not set. Every model alias will report unavailable; ' +
        'chats, projects, and settings still work.',
    );
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
