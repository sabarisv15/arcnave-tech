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
import { usageRoutes } from './routes/usage.js';
import type { AppInstance } from './types.js';

export interface CreateAppOptions extends BuildOptions {
  services?: Services;
}

export async function createApp(cfg: Config, options: CreateAppOptions = {}): Promise<AppInstance> {
  const services = options.services ?? buildServices(cfg, options);

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
    allowedHeaders: ['Content-Type', 'X-Request-ID', 'Idempotency-Key', 'If-Match'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: cfg.RATE_LIMIT_WRITE_PER_MINUTE,
    timeWindow: '1 minute',
    // Per user when signed in, per IP otherwise, so one noisy anonymous client cannot
    // exhaust the shared budget for everyone behind the same NAT.
    keyGenerator: (request) => request.user?.id ?? request.ip,
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

  await app.register(swaggerUi, { routePrefix: '/docs' });

  // --- error handling ----------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof ApiError) {
      // Expected outcomes (a 404, a budget block) are not warnings; only log the detail at
      // debug level so operational logs stay signal.
      request.log.debug({ err: error, code: error.code }, 'api error');
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

    const statusCode = (error as { statusCode?: number }).statusCode;

    if (statusCode === 429) {
      const apiError = new ApiError('rate_limit');
      return reply.status(429).send(apiError.toBody(requestId));
    }

    if (statusCode === 413) {
      const apiError = new ApiError('payload_too_large');
      return reply.status(413).send(apiError.toBody(requestId));
    }

    // Anything reaching here is a bug. Log it fully; tell the client nothing but the id.
    request.log.error({ err: error, requestId }, 'unhandled error');
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
    },
    { prefix: cfg.API_PREFIX },
  );

  return app as AppInstance;
}

// Local alias avoids importing the provider type twice in this file.
type ZodTypeProviderAlias = import('fastify-type-provider-zod').ZodTypeProvider;
