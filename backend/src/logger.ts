/**
 * Structured logging (Pino).
 *
 * Redaction is configured here rather than left to discipline at call sites: an accidental
 * `log.info({ body })` that happens to contain a password cannot print it. Pino applies these
 * paths before serialisation, so the secret never reaches the output stream.
 */
import { pino } from 'pino';

import { config } from './config.js';

const cfg = config();

/**
 * Wildcards cover nested objects one level deep in the usual places (`req.headers.cookie`,
 * `body.password`). Anything deeper should not be logged wholesale in the first place.
 */
const REDACT_PATHS = [
  'password',
  'newPassword',
  'passwordHash',
  'token',
  'tokenHash',
  'sessionToken',
  'apiKey',
  'credentials',
  'privateKey',
  'clientSecret',
  'refreshToken',
  'accessToken',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
];

export const logger = pino({
  level: cfg.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'arcnave-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Human-readable in development, JSON everywhere else so log shipping works unmodified.
  ...(cfg.isProduction || cfg.isTest
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }),
});

export type Logger = typeof logger;
