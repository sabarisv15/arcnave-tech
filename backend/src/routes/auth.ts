/**
 * Authentication routes.
 *
 * The session cookie is HttpOnly, signed, and Secure in production. SameSite is `none`: the
 * frontend (Cloudflare) and this API (Cloud Run) are deliberately on different origins, and a
 * `Lax` cookie is never attached to a cross-site `fetch` — only to same-site requests or a
 * top-level navigation. `None` requires `Secure`, which production already forces. Trade-off,
 * accepted deliberately: Safari (and some Firefox tracking-protection modes) block `SameSite=
 * None` third-party cookies by default with no site-level opt-out for a plain fetch flow, so
 * login will not work there under this architecture. Revisit before this has real multi-browser
 * traffic — either a same-site domain for the API (Cloud Run domain mapping, unsupported in
 * this service's region as of 2026-09-17, or a load balancer) or a token-based session. See
 * mistakes.md for the two things already tried and reverted (a same-origin Worker proxy added
 * ~1.2s/request with no Smart Placement convergence at low traffic; Cloud Run's own domain
 * mapping does not support this region).
 */
import type { FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Config } from '../config.js';
import { currentUser, requireAuth } from '../plugins/context.js';
import type { AppInstance } from '../types.js';

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(1).max(1024);

const userResponse = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});

function setSessionCookie(reply: FastifyReply, cfg: Config, token: string, expiresAt: Date): void {
  void reply.setCookie(cfg.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'none',
    secure: cfg.SESSION_COOKIE_SECURE,
    signed: true,
    path: '/',
    expires: expiresAt,
  });
}

export async function authRoutes(app: AppInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create an account and start a session',
        body: z.object({
          email: emailSchema,
          password: passwordSchema,
          name: z.string().trim().max(120).default(''),
        }),
        response: { 201: z.object({ user: userResponse }) },
      },
      config: { rateLimit: { max: app.services.cfg.RATE_LIMIT_AUTH_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, password, name } = request.body;
      const result = await request.services.auth.register(email, password, name);
      setSessionCookie(reply, request.services.cfg, result.token, result.expiresAt);
      return reply.status(201).send({ user: result.user });
    },
  );

  typed.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Start a session',
        body: z.object({ email: emailSchema, password: passwordSchema }),
        response: { 200: z.object({ user: userResponse }) },
      },
      config: { rateLimit: { max: app.services.cfg.RATE_LIMIT_AUTH_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const result = await request.services.auth.login(
        email,
        password,
        request.headers['user-agent'] ?? '',
      );
      setSessionCookie(reply, request.services.cfg, result.token, result.expiresAt);
      return reply.send({ user: result.user });
    },
  );

  typed.post(
    '/auth/logout',
    { schema: { tags: ['auth'], summary: 'End the current session', response: { 204: z.null() } } },
    async (request, reply) => {
      const cfg = request.services.cfg;
      const raw = request.cookies[cfg.SESSION_COOKIE_NAME];
      if (raw) {
        const unsigned = request.unsignCookie(raw);
        if (unsigned.valid && unsigned.value) await request.services.auth.logout(unsigned.value);
      }
      void reply.clearCookie(cfg.SESSION_COOKIE_NAME, { path: '/' });
      return reply.status(204).send(null);
    },
  );

  typed.get(
    '/auth/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'The signed-in user, or null',
        response: { 200: z.object({ user: userResponse.nullable() }) },
      },
    },
    async (request) => ({ user: request.user }),
  );

  typed.post(
    '/auth/password',
    {
      onRequest: requireAuth,
      schema: {
        tags: ['auth'],
        summary: 'Change password; ends all other sessions',
        body: z.object({ currentPassword: passwordSchema, newPassword: passwordSchema }),
        response: { 204: z.null() },
      },
      config: { rateLimit: { max: app.services.cfg.RATE_LIMIT_AUTH_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const user = currentUser(request);
      const { currentPassword, newPassword } = request.body;
      await request.services.auth.changePassword(user.id, currentPassword, newPassword);
      // The current session was invalidated along with the rest; clear the cookie so the
      // client is told to sign in again rather than silently 401-ing on the next call.
      void reply.clearCookie(request.services.cfg.SESSION_COOKIE_NAME, { path: '/' });
      return reply.status(204).send(null);
    },
  );
}
