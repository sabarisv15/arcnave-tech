/**
 * Production equivalent of the `/v1` proxy in `vite.config.ts`.
 *
 * The session cookie is HttpOnly, Secure, SameSite=Lax (see `backend/src/routes/auth.ts`).
 * A Lax cookie is never attached to a cross-site `fetch`, so the frontend and the API must
 * appear to the browser as the same origin — not merely CORS-permitted, actually same-origin.
 * This worker is what makes that true in production: static assets and `/v1/*` are both
 * served from `www.arcnave.tech`, and only this worker knows the request underneath `/v1/*`
 * actually goes to Cloud Run.
 *
 * Do not "simplify" this by pointing the frontend straight at the Cloud Run URL again — that
 * is the bug this file exists to prevent. See mistakes.md.
 */

export interface Env {
  ASSETS: Fetcher;
  API_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/v1/')) {
      // Rewrite onto the Cloud Run origin, keeping method, headers, and body untouched so
      // cookies, content-type, and the request body all pass through unmodified. Response
      // streaming (SSE generation frames) is preserved automatically — `fetch` never buffers.
      const upstream = new URL(url.pathname + url.search, env.API_ORIGIN);
      return fetch(new Request(upstream, request));
    }

    return env.ASSETS.fetch(request);
  },
};
