/**
 * Structured logging (Pino).
 *
 * Redaction is configured here rather than left to discipline at call sites: an accidental
 * `log.info({ body })` that happens to contain a password cannot print it. Pino applies these
 * paths before serialisation, so the secret never reaches the output stream.
 */
import { createRequire } from 'node:module';

import { pino } from 'pino';

import { config } from './config.js';

const cfg = config();

/**
 * Is `pino-pretty` actually installed?
 *
 * It is a devDependency, so a production image built with `npm ci --omit=dev` does not have
 * it. Asking for the transport anyway makes pino throw at import time and the process exits
 * before it has logged anything — a container that crash-loops with no usable output.
 *
 * NODE_ENV is the wrong thing to branch on here: `NODE_ENV=development` is a supported way to
 * run the shipped image (it is how you run it over plain HTTP locally, since a Secure cookie
 * is dropped by the browser there). Resolvability is the real question, so ask it directly.
 */
function prettyAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Wildcards cover nested objects one level deep in the usual places (`req.headers.cookie`,
 * `body.password`). Anything deeper should not be logged wholesale in the first place.
 */
export const REDACT_PATHS = [
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
  // A Google ID token (POST /auth/google body, ADR-0056) and the Claude API key (ADR-0054).
  'credential',
  '*.credential',
  'ANTHROPIC_API_KEY',
  '*.ANTHROPIC_API_KEY',
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
  // Human-readable in development when the formatter is present, JSON everywhere else so log
  // shipping works unmodified.
  ...(cfg.isProduction || cfg.isTest || !prettyAvailable()
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }),
});

export type Logger = typeof logger;
