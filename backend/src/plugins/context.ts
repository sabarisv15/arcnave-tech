/**
 * Request context: request IDs, the service container, and authentication.
 *
 * Registered as a Fastify plugin so every route gets `request.services`, `request.requestId`,
 * and `request.user` without importing globals.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { Services } from '../container.js';
import { ApiError } from '../errors.js';
import type { AuthedUser } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
  interface FastifyRequest {
    services: Services;
    requestId: string;
    user: AuthedUser | null;
  }
}

async function contextPlugin(app: FastifyInstance, opts: { services: Services }): Promise<void> {
  const { services } = opts;
  app.decorate('services', services);

  // Declare the slots up front: Fastify optimises the request object's hidden class when
  // properties exist before any handler assigns them. The casts are needed because Fastify
  // types a null default as a getter/setter pair rather than a value.
  app.decorateRequest('services', null as unknown as Services);
  app.decorateRequest('requestId', '');
  app.decorateRequest('user', null as unknown as AuthedUser | null);

  // Session resolution happens in `onRequest`, not `preHandler`, so that route guards can
  // themselves be `onRequest` hooks. Fastify runs every onRequest hook before any preHandler,
  // so a guard registered in that earlier phase would otherwise always see a null user.
  // This plugin is registered after @fastify/cookie, so cookies are already parsed here.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    request.services = services;
    request.requestId = request.id;
    // Echoed on every response, including errors, so a user can quote it in a bug report and
    // it can be grepped straight out of the logs.
    void reply.header('X-Request-ID', request.id);

    const token = request.cookies[services.cfg.SESSION_COOKIE_NAME];
    if (!token) {
      request.user = null;
      return;
    }
    const unsigned = request.unsignCookie(token);
    // An invalid signature means the cookie was tampered with; treat it as no session at all.
    const value = unsigned.valid && unsigned.value ? unsigned.value : null;
    request.user = value ? await services.auth.resolve(value) : null;
  });
}

export default fp(contextPlugin, { name: 'context' });

/** Route guard. Use as an `onRequest`/`preHandler` hook on anything user-owned. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.user) throw new ApiError('unauthorized');
}

/** Narrowed accessor so handlers do not repeat a non-null assertion. */
export function currentUser(request: FastifyRequest): AuthedUser {
  if (!request.user) throw new ApiError('unauthorized');
  return request.user;
}
