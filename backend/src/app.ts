/**
 * Fastify application factory.
 *
 * Exported separately from `index.ts` so tests can build an app against an injected database
 * and fake providers without binding a port.
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import type { Config } from './config.js';
import type { BuildOptions, Services } from './container.js';
import { buildServices } from './container.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';
import contextPlugin from './plugins/context.js';
import securityPlugin, { rateLimitKey, trustProxyHops } from './plugins/security.js';
import { artifactRoutes } from './routes/artifacts.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chats.js';
import { fileRoutes } from './routes/files.js';
import { healthRoutes } from './routes/health.js';
import { memoryRoutes } from './routes/memory.js';
import { modelRoutes } from './routes/models.js';
import { preferenceRoutes } from './routes/preferences.js';
import { projectRoutes } from './routes/projects.js';
import { skillRoutes } from './routes/skills.js';
import { styleRoutes } from './routes/styles.js';
import { shareRoutes } from './routes/share.js';
import { accountRoutes } from './routes/account.js';
import { usageRoutes } from './routes/usage.js';
import { errorLogFields } from './errorLog.js';
import { sqlState } from './services/turn/turnStore.js';
import type { AppInstance } from './types.js';

/**
 * SQLSTATEs that mean the database could not serve the request in time, not that the request
 * was wrong: a statement timeout (57014, `statement_timeout`, N-45), a lock wait timeout (55P03,
 * `lock_timeout`) and no free connection (53300).
 */
export const DB_UNAVAILABLE_CODES = new Set(['57014', '55P03', '53300']);
/** Ours: the Retry-After of that 503. */
export const DB_RETRY_AFTER_S = 5;

export function dbUnavailable(error: unknown): boolean {
  const state = sqlState(error);
  return state !== undefined && DB_UNAVAILABLE_CODES.has(state);
}

export interface CreateAppOptions extends BuildOptions {
  services?: Services;
}

export async function createApp(cfg: Config, options: CreateAppOptions = {}): Promise<AppInstance> {
  const services = options.services ?? buildServices(cfg, options);
  // The skill registry loads from disk; a request served before it finished listed only some
  // skills (a cold start, or a test app, answered before the last directory was read).
  await services.skills.whenLoaded();

  const app = Fastify({
    // Trust the client's request id when present so a trace survives a reverse proxy, but
    // fall back to a UUID rather than Fastify's default sequential counter, which collides
    // across restarts and across instances.
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      const value = Array.isArray(header) ? header[0] : header;
      return value && value.length <= 64 ? value : randomUUID();
    },
    // Hand Fastify our configured pino instance rather than letting it build its own. This
    // is what makes `request.log` real: it binds the request id automatically, so every line
    // a handler or the error handler writes is correlated without passing the id around.
    loggerInstance: logger,
    // Uploads are additionally capped per-file by @fastify/multipart; this is the hard
    // transport ceiling, with headroom for multipart framing.
    bodyLimit: cfg.MAX_UPLOAD_BYTES + 1024 * 1024,
    // request.ip is the client, not the platform's front end, and a client-written
    // X-Forwarded-For entry cannot choose it (ADR-0065).
    trustProxy: trustProxyHops(cfg.TRUST_PROXY_HOPS),
  }).withTypeProvider<ZodTypeProviderAlias>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie, {
    // In development a stable secret is unnecessary but a random one per boot would log
    // every user out on restart, so it is derived deterministically instead.
    secret: cfg.COOKIE_SECRET ?? 'arcnave-development-cookie-secret-not-for-production',
  });

  await app.register(cors, {
    origin: cfg.CORS_ORIGINS,
    // Required for the session cookie to travel on cross-origin XHR from the Vite dev server.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-ID', 'Idempotency-Key', 'If-Match', 'Last-Event-ID'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  });

  // Security headers on every response, and the Origin check on state-changing requests, before
  // the session is looked up: a refused request costs no database read.
  await app.register(securityPlugin, { allowedOrigins: cfg.CORS_ORIGINS });

  await app.register(rateLimit, {
    global: true,
    max: cfg.RATE_LIMIT_WRITE_PER_MINUTE,
    timeWindow: '1 minute',
    // The limiter attaches this hook to each route; route-level onRequest hooks run after the
    // context plugin's instance-level one, so the session is already resolved when the key is
    // computed. Per user when signed in, per client address otherwise
    // (edgeSecurity.integration.test.ts fails if either stops holding).
    hook: 'onRequest',
    keyGenerator: rateLimitKey,
    enableDraftSpec: true,
  });

  await app.register(multipart, {
    limits: { fileSize: cfg.MAX_UPLOAD_BYTES, files: 10, fields: 20 },
  });

  await app.register(contextPlugin, { services });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ArcNave API',
        version: '1.0.0',
        description:
          'Backend for the ArcNave workspace. Session cookie authentication; streaming ' +
          'generation over SSE.',
      },
      servers: [{ url: cfg.API_PREFIX }],
      tags: [
        { name: 'ops', description: 'Health and readiness' },
        { name: 'auth', description: 'Accounts and sessions' },
        { name: 'models', description: 'Model aliases and availability' },
        { name: 'chats', description: 'Conversations, messages, and generation' },
        { name: 'projects', description: 'Projects, files, and saved sources' },
        { name: 'artifacts', description: 'Artifacts and version history' },
        { name: 'usage', description: 'Token accounting and limits' },
        { name: 'preferences', description: 'User preferences' },
        { name: 'styles', description: 'Response styles (presets and custom)' },
        { name: 'share', description: 'Public links to chat and artifact snapshots' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  // The OpenAPI document is still built (npm run openapi); only the UI is gated (ADR-0065).
  if (cfg.docsEnabled) await app.register(swaggerUi, { routePrefix: '/docs' });

  // --- error handling ----------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof ApiError) {
      // Expected outcomes (a 404, a budget block) are not warnings; only log the detail at
      // debug level so operational logs stay signal.
      request.log.debug({ code: error.code, statusCode: error.status, requestId }, 'api error');
      return reply.status(error.status).send(error.toBody(requestId));
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const apiError = new ApiError('validation_error', {
        meta: {
          issues: error.validation.map((v) => ({
            path: v.instancePath,
            message: v.message ?? 'Invalid value',
          })),
        },
      });
      return reply.status(apiError.status).send(apiError.toBody(requestId));
    }

    // Stage 15 ER-6a (N-45): the database said "too slow" or "too busy". A typed 503 the client
    // retries after 5 s, not a 500 (`dbUnavailable`).
    if (dbUnavailable(error)) {
      request.log.warn({ ...errorLogFields(error), requestId, route: request.routeOptions.url }, 'database unavailable');
      const apiError = new ApiError('unavailable');
      return reply.status(503).header('Retry-After', String(DB_RETRY_AFTER_S)).send(apiError.toBody(requestId));
    }

    const statusCode = (error as { statusCode?: number }).statusCode;

    if (statusCode === 429) {
      const apiError = new ApiError('rate_limit');
      return reply.status(429).send(apiError.toBody(requestId));
    }

    if (statusCode === 413) {
      const apiError = new ApiError('payload_too_large');
      return reply.status(413).send(apiError.toBody(requestId));
    }

    // Anything reaching here is a bug. The log carries where and what kind (route pattern, method,
    // error type, code / SQLSTATE), never the error's message, params or stack: a failed query's
    // text holds the query's values (Stage 17 NO_CONTENT). The client is told nothing but the id.
    request.log.error(
      {
        ...errorLogFields(error),
        requestId,
        method: request.method,
        route: request.routeOptions.url,
        statusCode: 500,
      },
      'unhandled error',
    );
    const apiError = new ApiError('internal_error');
    return reply.status(500).send(apiError.toBody(requestId));
  });

  app.setNotFoundHandler((request, reply) => {
    const apiError = new ApiError('not_found', {
      detail: `No route for ${request.method} ${request.url}.`,
    });
    return reply.status(404).send(apiError.toBody(request.id));
  });

  // --- routes ------------------------------------------------------------
  await app.register(healthRoutes);
  await app.register(
    async (scope) => {
      // Each route module is registered as its own encapsulated plugin, so the `requireAuth`
      // hook a module adds applies to that module's routes and nowhere else. Registering them
      // into one shared scope would put the guard on `/auth/login` too.
      await scope.register(authRoutes);
      await scope.register(modelRoutes);
      await scope.register(chatRoutes);
      await scope.register(projectRoutes);
      await scope.register(artifactRoutes);
      await scope.register(usageRoutes);
      await scope.register(preferenceRoutes);
      await scope.register(fileRoutes);
      await scope.register(skillRoutes);
      await scope.register(memoryRoutes);
      await scope.register(styleRoutes);
      await scope.register(shareRoutes);
      await scope.register(accountRoutes);
    },
    { prefix: cfg.API_PREFIX },
  );

  // The file worker is started by the process (index.ts), not here: building the app (OpenAPI,
  // tests) must not reach the database. Closing waits for its in-flight jobs; a job cut short
  // by a crash is taken over by another worker when its lease lapses.
  app.addHook('onClose', async () => {
    await services.files.stop();
  });

  return app as AppInstance;
}

// Local alias avoids importing the provider type twice in this file.
type ZodTypeProviderAlias = import('fastify-type-provider-zod').ZodTypeProvider;
