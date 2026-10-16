# ADR-0065: Edge security and platform quick fixes (safeFetch, rate-limit key, Origin check, headers, docs, health, fail-closed migrations)

- Status: accepted (task tech-build.3, Part B, 2026-10-16). Tested by automated gates; not
  deployed. The owner verifies live after merging (`docs/ops/build-3-live-checklist.md`, Part B).
- Date: 2026-10-16
- Task: tech-build.3 Part B = P04 of [`docs/ops/audit/NEW-PLAN.md`](../ops/audit/NEW-PLAN.md).
- Yardstick: [ADR-0061](0061-locked-decisions-win-outside-stack-and-infra.md). Locked outcomes:
  Stage 8 C2 (SSRF), Stage 16 SE2 (Origin check), SE10 (headers), PH-4 (identifiers), INJ-7,
  Stage 3 1.5 / Stage 4 L3 A-3 (per-user rate limit, N-01), Stage 19 ID-13 (fail-closed,
  serialised migrations) and DS19-D (`/health`), Stage 20 VS-2b (docs UI off in production).
- Audit rows: D3 A-08, A-09, A-10; FINDINGS S2-3, 1.5, INJ-7, SD-1f, PH-2, PH-4, S19-14, S19-17,
  VS-2b, S21-11; main-session verdicts S-01, S-07, S-08, S-12.
- Supersedes: nothing. No earlier ADR records the hostname regex, the `|| true` start command,
  the rate-limit key or `/healthz` as a decision; they were code only. `CLAUDE.md` is unchanged.

## Claude

Where Claude has a published behaviour, from sources read on 2026-10-16:

- **Web fetch.** The web fetch tool page
  (platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) says the tool returns
  `url_not_allowed` for "URL blocked by domain filtering rules ... or by Anthropic-side
  restrictions, such as private addresses, `robots.txt`, and URLs that appear to contain a
  credential", fetches only "URLs that have previously appeared in the conversation", and errors
  are returned to the model as tool results (`url_not_accessible`, `too_many_requests`, ...).
  Anthropic does not publish how it checks a private address (DNS answers, redirects, pinning) or
  its size and redirect limits; `max_content_tokens` truncates content, not the transfer.
- **Rate limits, CSRF/Origin checks, security headers, API docs UI, health paths, database
  migrations.** These are server internals of claude.ai. Anthropic publishes nothing on how
  claude.ai implements them, so there is no Claude behaviour to match; everything below in those
  areas is the locked architecture's outcome or ours, labelled as such.

## ArcNave now (before this change)

- `services/webFetch.ts:19-37,61,82,89-96`: a hostname regex list; no DNS resolution; `redirect:
  'follow'` with only the final URL checked after the request was sent; `[::1]` never matched
  (WHATWG keeps the brackets); `response.text()` read the whole body before a 1 MB slice; the error
  text carried the raw URL. `providers/grounding.ts:80-82` followed Vertex grounding redirects to
  third-party pages with `redirect: 'follow'` and no check at all.
- `app.ts:56-72`: no `trustProxy`, so `request.ip` was the platform front end for everyone.
  `app.ts:93-101`: key `request.user?.id ?? request.ip`. (Measured here: the limiter attaches its
  hook per route, which runs after the context plugin's instance hook, so the user part did work;
  the anonymous part keyed every caller to one address.)
- `routes/models.ts`: `GET /models` (with `probe=true` spending a provider call per alias) and
  `POST /models/refresh` were public.
- No Origin or Sec-Fetch-Site check anywhere; the cookie is SameSite=None (OQ-19 open), so
  body-less POSTs (`/auth/logout`, `/chats/:id/stop`) were forgeable cross-site.
- API headers: nosniff on four download routes only. Web (Cloudflare): `public/_headers` had only
  `X-Robots-Tag` for `/s/*`. nginx (compose): nosniff, XFO, Referrer-Policy at server level, but
  dropped in `/assets/` and `/index.html` (nginx does not inherit `add_header` into a location that
  has its own).
- `tools/sandbox/cloudRunSandboxClient.ts:215`: a project-bearing service-account e-mail as a code
  default. No guard test.
- Swagger UI registered unconditionally (`app.ts:135`), so public in production.
- Only `/healthz`, which Google's front end answers itself on a public run.app URL.
- `backend/Dockerfile:69`: `node dist/db/migrate.js || true; exec node dist/index.js`; drizzle-orm
  0.45.2's `PgDialect.migrate` takes no lock (read in `node_modules`), contrary to the comment in
  `db/migrate.ts`.

## Gap

All of the above against the locked outcomes. None is a Claude-parity gap except web fetch, where
ArcNave let private addresses through and Claude's documented tool refuses them.

## Fix

1. **safeFetch** (`services/safeFetch.ts`; Stage 8 C2 outcome, mechanism ours, D3 A-08 option A).
   http/https only, no credentials in the URL, internal names refused before resolving
   (`localhost`, `*.localhost`, `metadata`, `metadata.google.internal`, `*.internal`, `*.local`,
   `*.home.arpa`). One resolution per hop with every answer checked; only global unicast passes
   (IPv4 special-purpose ranges incl. 0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12,
   192.168/16, multicast and reserved; IPv6 outside 2000::/3 — which refuses ::1, IPv4-mapped and
   compatible, NAT64, fc00::/7, fe80::/10 — plus 2001::/23, 2001:db8::/32, 2002::/16, 3fff::/20).
   Address spellings (octal, hex, single decimal) are canonicalised by WHATWG `URL` before the
   check. The connection uses the checked address through the socket's `lookup` (TLS still
   verifies the name), so a rebinding resolver is never asked twice. The checked addresses are
   tried in turn, IPv4 first, moving on only when the TCP connect fails (refused, unreachable,
   `SAFE_FETCH_CONNECT_TIMEOUT_MS` 3 s, ours), so a dual-stack host still works on an instance
   without IPv6 egress (review fix). Redirects are manual, each one a new hop with the same
   checks, at most `SAFE_FETCH_MAX_REDIRECTS` (3, ours) per call by default; grounding passes
   `SAFE_FETCH_GROUNDING_MAX_REDIRECTS` (8, ours) because its chains are longer. The body is
   streamed: `bytes()` refuses past `SAFE_FETCH_MAX_BYTES` (5 MB, Stage 8 08d "up to 5 MB"),
   `prefix()` stops reading there and reports the page cut, which web_fetch uses (it returns the
   first 5 MB marked `truncated`, as before this ADR; `Accept-Encoding: identity` so the ceiling
   counts wire bytes). One deadline
   `SAFE_FETCH_TIMEOUT_MS` = N-43 fetch_url 10 s. Error codes follow Claude's tool vocabulary where
   one exists (`url_not_allowed`, `url_not_accessible`) and never carry the URL. Call sites:
   `services/webFetch.ts` (web_fetch) and `providers/grounding.ts` (redirect resolution).
   Not routed (fixed hosts or operator config, listed in the wip file): `webSearch.ts` (search API
   endpoints), `tools/sandbox/*` (configured service URLs, Google APIs), `attachments/scanner.ts`
   (clamd from config), provider SDKs.
2. **Rate-limit key** (A-09 option A). `TRUST_PROXY_HOPS` (default 1, ours) becomes a Fastify
   `trustProxy` *function* `(addr, hop) => hop < N`. Not `true` (that returns the leftmost
   X-Forwarded-For entry, which the client writes) and not a number: Fastify 5.12.5
   `lib/request.js` turns a numeric `trustProxy` into "trust nothing" (read in `node_modules`,
   pinned by `plugins/security.test.ts`). Default 1 because Cloud Run's front end is the single
   proxy and appends the address it saw, so the client is the rightmost entry; in compose, nginx
   is the one hop (`$proxy_add_x_forwarded_for`). The Cloud Run header format could not be read
   from Google's docs in this session (docs host unreachable); the live checklist verifies it with
   the `ratelimit-remaining` header. Key: `user:<id>` when signed in, `ip:<addr>` otherwise; the
   limiter's hook is set to `onRequest` explicitly and runs per route, after the session hook.
   The in-memory store per instance stays (Redis is owner-deferred).
3. **`/models` signed-in only** (S2-3). The frontend calls `GET /models` only once a user is set
   (`arcnave-frontend/src/session.tsx:147-155`) and `POST /models/refresh` from Settings, which is
   behind sign-in (`Settings.tsx:811`).
4. **Origin check** (SD-1f, SE2; ours in mechanism) on POST/PUT/PATCH/DELETE, before the session
   lookup: Origin present → must be in `CORS_ORIGINS` (`null` never is); no Origin but
   `Sec-Fetch-Site: cross-site|same-site` → refused; neither header → allowed (not a browser, so no
   ambient cookie to abuse). New code `origin_not_allowed`, 403. Google sign-in uses GIS popup mode
   and the app posts the ID token as JSON from its own origin, so it passes; a form post from
   `https://accounts.google.com` (redirect mode, which ArcNave does not use) is refused on purpose.
   SD-1d (logout-all) has no route yet; when it gets one, this check covers it automatically.
5. **Identifiers out of code** (PH-4, S21-11). The sandbox signing service account moves to
   `SANDBOX_SIGNING_SA` (no default). `src/test/identifierGuard.test.ts` scans `backend/src`
   launch files (not tests, not `scripts/`) for a project id, a project-numbered compute account
   or run.app URL, and any `*.iam.gserviceaccount.com` address; a second case plants fakes.
   The frontend's fallback API URL (`arcnave-frontend/src/api.ts:31-33`) is **not** moved here:
   see "Not done".
6. **Security headers** (SE10, PH-2). API (`plugins/security.ts`, set on the raw response so the
   SSE stream keeps them): HSTS 2 y + includeSubDomains, nosniff, `Referrer-Policy: no-referrer`,
   `X-Frame-Options: DENY`, a deny-all Permissions-Policy, and
   `Content-Security-Policy-Report-Only: default-src 'none'; frame-ancestors 'none'; ...`. Web
   (`public/_headers` for Cloudflare, the same set in `nginx.conf`): HSTS, nosniff,
   `strict-origin-when-cross-origin`, XFO DENY, Permissions-Policy with `microphone=(self)` for
   dictation, and a report-only CSP. CSP is report-only first because a wrong enforced policy
   would break the live app; framing is enforced meanwhile through `X-Frame-Options`. COOP/CORP
   (also SE10) are left out: COOP `same-origin` breaks the Google sign-in popup, and choosing
   `same-origin-allow-popups` needs a live check first (DEFERRED).
7. **Docs and health** (VS-2b, DS19-D). `DOCS_ENABLED`: unset → Swagger UI on unless
   `NODE_ENV=production`; set → exactly what it says, in any environment. Production is detected
   by `NODE_ENV`, which `backend/Dockerfile` sets to `production` (compose defaults it too). The
   OpenAPI document is still generated. `/health` added; `/healthz` kept as an alias; `/readyz`
   unchanged; the image HEALTHCHECK uses `/health`.
8. **Migrations fail closed and serialised** (A-10 option A, ID-13). CMD
   `node dist/db/migrate.js && exec node dist/index.js`; `runMigrations` takes
   `pg_advisory_lock(72430065)` (ours) on its single connection before `migrate()` and releases it
   after. A failed or unreachable database now stops the new revision; Cloud Run keeps traffic on
   the previous revision. The migrator as a separate job before promotion (ID-13's shape) stays
   infra (DEFERRED).

## Consequences

- A deploy with a broken migration, or while Cloud SQL is stopped, no longer goes live; it fails
  its startup probe and the old revision keeps serving.
- `TRUST_PROXY_HOPS` must equal the real number of appending proxies. Too high lets a client pick
  its bucket; too low puts everyone behind one proxy into one bucket.
- web_fetch returns at most the first 5 MB of a page (marked truncated) and refuses chains of more
  than 3 redirects; a grounding citation whose target redirects more than 8 times stays unresolved
  (`urlResolved: false`), never guessed.
- New config: `TRUST_PROXY_HOPS`, `DOCS_ENABLED`, `SAFE_FETCH_MAX_BYTES`,
  `SAFE_FETCH_MAX_REDIRECTS`, `SAFE_FETCH_GROUNDING_MAX_REDIRECTS`, `SAFE_FETCH_TIMEOUT_MS`,
  `SAFE_FETCH_CONNECT_TIMEOUT_MS`, `SANDBOX_SIGNING_SA`; N-43 gains
  `FETCH_URL_TIMEOUT_MS` in `config/numbers.ts`.

## Not done

- The frontend's project-numbered fallback API URL. Removing it needs `VITE_API_BASE` set in the
  Cloudflare Workers Build settings first: CI's `npx vite build` and the Cloudflare build both run
  without it today, so a build-time requirement would fail them, and a silent `/v1` fallback would
  ship a bundle that calls the static host. Owner step, then a one-line change.
- COOP / CORP on the web; enforcing the CSP; a CSP report endpoint (logs would carry URLs; NO_CONTENT).
