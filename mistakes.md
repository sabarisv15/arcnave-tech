# mistakes.md

**Owner:** the coding agent. Humans may prune it; the agent writes it.
**Read:** at the start of every session, before touching code.
**Write:** before closing any task, while the mistake is still fresh.

This is the *learning log*, deliberately separate from the rules file. `CLAUDE.md` says how to
work here; this says what went wrong and what must be true so it does not go wrong again. The
split is the prevailing convention for agent memory — a rules file that doubles as an
append-only incident log stops being read, and context-file bloat measurably *reduces* task
success rather than improving it. See [Convention and sources](#convention-and-sources).

**Wired in as of 2026-09-17.** `.claude/hooks/session-start.mjs` injects these entry headings
into every session, [`CLAUDE.md`](CLAUDE.md) points here twice, and a `Stop` hook notices when
source changed and this file did not. It is memory, not documentation — keep it that way.

---

## How to write an entry

One mistake per entry. Four lines, in this order:

| Line | Content |
| --- | --- |
| **Symptom** | What was observed, not what was wrong. The thing a future session will recognise. |
| **Cause** | The actual mechanism. If it is not known, say so — a guess recorded as a cause is worse than a blank. |
| **Rule** | An imperative. "Never X." "Always Y." Phrase it as a constraint, not a suggestion. |
| **Verify** | The command or check that proves the rule held. If none exists, write the check instead of the entry. |

Rules of thumb:

- **A rule a test can enforce belongs in a test, not here.** Write the test, then record the
  entry only if the class of mistake is broader than the test.
- **Negative constraints beat positive advice.** "Never trust `err.code` on a Drizzle error"
  survives; "be careful with errors" does not.
- **Date every entry.** A rule about a library version expires when the version does.
- **No entry for a one-off typo.** If it would not recur, it is not a lesson.

## Pruning policy

This file is capped at **40 entries**. When it is full, something leaves before something
enters. Retire an entry when any of these is true, and note *why* in the changelog at the
bottom:

- A test, type, or lint rule now makes the mistake impossible. The check is the memory.
- The rule has been stable for long enough to be a house convention — promote it into
  `CLAUDE.md` and delete it here.
- The dependency, file, or endpoint it refers to no longer exists.

Review the whole file whenever it crosses 30 entries. Growth without pruning is the documented
failure mode of this pattern, not a sign it is working.

---

## Entries

### 2026-09-16 — A `preHandler` guard cannot see state set in `onRequest`

- **Symptom:** Every authenticated route returned 401, including with a valid session cookie.
- **Cause:** `requireAuth` ran as an `onRequest` hook, but the session was resolved in
  `preHandler`. Fastify runs *all* `onRequest` hooks before *any* `preHandler`, so the guard
  always saw `request.user === null`.
- **Rule:** **Always resolve request context in the same phase as, or an earlier phase than,
  whatever reads it.** When adding a hook, name the phase out loud and check the ordering.
- **Verify:** `GET /v1/auth/me` with a fresh cookie returns 200.

### 2026-09-16 — A failure *before* the stream opened left a row spinning forever

- **Symptom:** With no model configured, the assistant message stayed `generating` after a page
  reload. A spinner with nothing behind it.
- **Cause:** The assistant row is created before streaming so a reload has something to show.
  `GenerationService` marks it `error` on failure — but a failure raised *before* the service is
  entered (no model available, budget exhausted) never reaches that code.
- **Rule:** **Every early-exit path out of a streaming handler must close out the row it
  already created.** If a handler writes a row before doing work, the `catch` owns that row.
- **Verify:** Unset every `MODEL_*`, generate, reload — the message reads `error`, not a spinner.

### 2026-09-16 — `request.log` wrote nothing

- **Symptom:** The error handler logged on every 500 and the logs were empty.
- **Cause:** Fastify was constructed without `loggerInstance`, so its logger was disabled and
  `request.log` was a silent no-op. Nothing failed; the lines simply went nowhere.
- **Rule:** **Never assume a logging call worked because it compiled.** After wiring any logger,
  trigger one line and read it back.
- **Verify:** Hit an unknown route; a `warn`/`error` line with the matching `reqId` appears.

### 2026-09-16 — A decision changed and its ADR did not

- **Symptom:** [`docs/decisions/0001-stack.md`](docs/decisions/0001-stack.md) still argues for
  Python/FastAPI. The entire backend is Node and TypeScript.
- **Cause:** The stack decision was reversed in conversation. The code followed; the document
  that existed specifically to record the decision did not.
- **Rule:** **A decision is not changed until the document recording it is changed.** Superseding
  an ADR is an edit to that ADR in the same commit, not a follow-up.
- **Verify:** `grep -ril fastapi docs/` returns nothing outside a superseded-by note.
- **Closed 2026-09-17:** ADR-0001 is marked superseded and
  [ADR-0003](docs/decisions/0003-node-stack.md) records the stack that exists. The original
  text was left unedited on purpose — an ADR records what was decided, and rewriting this one
  would erase the fact that the stack was chosen, argued for, and then reversed.

### 2026-09-17 — Test expectations asserted from memory instead of computation

- **Symptom:** Two brand-new tests failed on first run — a DST boundary expected
  `2026-03-06T05:00Z` when the correct instant was `2026-03-07T05:00Z`, and a chunk-overlap
  assertion compared the wrong slice width. Both times the *implementation was right*.
- **Cause:** The expected values were reasoned out in my head rather than derived. Timezone
  arithmetic and off-by-one slice maths are exactly where that fails.
- **Rule:** **Never hand-compute an expected value for date arithmetic or string slicing.**
  Derive it (`node -e`, or express the property in terms of the inputs), then assert.
  Corollary: **a failing new test is a suspect assertion until the implementation is read.**
- **Verify:** `npx vitest run` — 63 passing.

### 2026-09-17 — Tested against the concrete class, not the interface callers hold

- **Symptom:** `npx vitest run` was green while `npx tsc --noEmit` failed: `put()` called with
  three arguments, "expected 2".
- **Cause:** The test declared `let storage: LocalObjectStorage`. That class's `put` legitimately
  omits the `contentType` parameter it has nowhere to store; the `ObjectStorage` interface every
  caller actually holds declares it.
- **Rule:** **Type a test at the interface under contract, not at the implementation.** A test
  bound to the concrete type verifies the wrong thing and misses interface drift.
- **Verify:** `npx tsc --noEmit` is clean — tests are typechecked, not only executed.

### 2026-09-17 — Invented an enum instead of reading the code that consumes it

- **Symptom:** `PATCH /usage/limits` accepted `routingPreference: "fast"`, stored it, and echoed
  it back. The router reads `'economy' | 'balanced' | 'quality'` and silently treats everything
  else as `balanced`, so the setting did nothing.
- **Cause:** I wrote the Zod enum from what the word ought to be rather than from
  `normalizeTier()` in the generation service. Nothing failed — the value round-tripped
  perfectly through the API and was discarded one layer below it.
- **Rule:** **Never write a validator for a value you have not traced to its consumer.** An enum
  at an API boundary is a promise the system acts on that value; grep for the reader first.
- **Verify:** `src/routes/usage.integration.test.ts` requires `fast`, `cheap` and `best` to be
  rejected and all three real tiers to be accepted.
- **Note:** This is the same failure the project's own ADR-0002 exists to prevent — a label that
  does not name what actually happens.

### 2026-09-17 — `.dockerignore` excluded a file the Dockerfile copies

- **Symptom:** `docker compose build` failed with `"/nginx.conf": not found` on a `COPY` of a
  file that plainly exists in the directory.
- **Cause:** I listed `nginx.conf` in `.dockerignore` while thinking about image size. A file
  excluded from the build context cannot be copied *out* of it, however present it is on disk.
- **Rule:** **Before ignoring a path, grep the Dockerfile for it.** `.dockerignore` controls
  what the daemon can see, not merely what it ships.
- **Verify:** `docker compose build` completes.

### 2026-09-17 — A devDependency the production image asks for but does not have

- **Symptom:** The backend container crash-looped with
  `unable to determine transport target for "pino-pretty"`, exiting before it could log why.
- **Cause:** `logger.ts` attached the `pino-pretty` transport whenever `NODE_ENV !==
  production`. The image is built with `npm ci --omit=dev`, so the package is absent — and
  `NODE_ENV=development` is a *supported* way to run that image, because a Secure cookie is
  dropped over plain HTTP and the local path in `.env.example` therefore sets it. My own
  documented instructions crashed the container.
- **Rule:** **Never branch on `NODE_ENV` to decide whether a module is present.** Ask whether
  it resolves. Environment is intent; installation is fact, and only one of them can be wrong.
- **Verify:** `docker compose up` with `NODE_ENV=development` reaches `healthy`; logs fall back
  to JSON instead of dying.
- **Wider point:** this could only be found by *running* the image. The Dockerfile built, the
  types checked, and 167 tests passed — none of which execute `dist/logger.js` under
  `--omit=dev`. A build that succeeds is not a program that starts.

### 2026-09-17 — Reconciling with the server raced the server's own write

- **Symptom:** Pressing stop mid-answer left the response spinning "Thinking…" forever, even
  though `GET /v1/chats/:id` showed the row as `stopped` a second later.
- **Cause:** After a stream ends the client re-reads the chat so ids and status come from the
  database rather than from what it guessed. Aborting closes the socket, so the client resumes
  *immediately* — while the server is still in its own `finally` writing the final row. The
  read won the race, returned `generating`, and that overwrote the `stopped` the client had
  correctly just set.
- **Rule:** **A read issued because you closed a connection can arrive before the other side
  has finished reacting to the close.** When reconciling, never let a non-terminal server
  status overwrite a terminal status you observed locally; keep yours and re-read on a short
  bounded delay. Generally: **reconciliation must be a merge, not an assignment.**
- **Verify:** Stop a long answer; the message reads "Response stopped" with its partial text,
  and `GET /v1/chats/:id` agrees. (`loadTranscript`'s `settled` argument in
  [`arcnave-frontend/src/workspace.tsx`](arcnave-frontend/src/workspace.tsx).)
- **Wider point:** this is the third appearance of the stuck-`generating` failure in this
  project, and the first on the client. The backend fix from 2026-09-16 was correct and did not
  help, because the bug had moved.

### 2026-09-17 — A deliberate sign-out announced itself as an expired session

- **Symptom:** Clicking "Sign out" showed "Your session ended. Sign in to pick up where you
  left off." — telling the user something alarming about something they had just chosen.
- **Cause:** A single global `onUnauthorized` handler turns any 401 into "expired". Signing out
  clears the cookie, so requests already in flight 401 a moment later and tripped it.
- **Rule:** **A global error handler cannot distinguish a failure from a consequence of an
  intent it does not know about.** Give it the intent — a flag set before the action — rather
  than trying to infer it from the error.
- **Verify:** Sign out; the sign-in screen appears with no "session ended" notice.
- **2026-09-20 addendum:** An expired session is useful context, not a form-level error. Keep
  that notice as quiet supporting text, and never put `overflow-y: auto` on the desktop auth
  column merely to compensate for oversized composition—the page must fit the viewport without
  introducing a scrollbar between its two panels.

### 2026-09-17 — A Cloud Run service attached to a VPC with no NAT reached nothing

- **Symptom:** The deployed backend passed its health check and served `/healthz`, but every
  database call failed with `ETIMEDOUT` — both the startup migration and a live signup insert.
  Vertex AI would have failed identically for the same reason, just not yet observed.
- **Cause:** The service had Direct VPC egress to a custom network with `vpc-egress: all-traffic`
  — routing *every* outbound call, not just private-range traffic, through that VPC. The VPC's
  only firewall rule was `deny-all-egress` to `0.0.0.0/0`, and the project had zero Cloud
  Routers and zero Cloud NATs anywhere. Nothing could leave the instance. `/healthz` deliberately
  checks nothing but the process (by design, see the Dockerfile), so the container reported
  healthy while completely unable to reach Neon or any external API.
- **Rule:** **A "healthy" Cloud Run service has not been shown to have working egress.** Before
  trusting a deployment, either confirm there is no VPC attached, or confirm the attached VPC
  has a Cloud NAT (or Private Google Access, for Google APIs specifically). `all-traffic` egress
  with no NAT is a silent, total outage that passes liveness checks.
- **Verify:** `gcloud run services describe <svc> --format=json | grep network-interfaces` — if
  present, `gcloud compute routers list` must show a router with a NAT in the same region, or
  the service should use `--clear-network` instead.

### 2026-09-17 — `gcloud run services update --set-env-vars` after a failed deploy compounded the damage

- **Symptom:** Adding two Vertex env vars with `--set-env-vars` crashed the new revision on
  `COOKIE_SECRET must be set to at least 32 characters`. Cloud Run correctly kept serving the
  last good revision, but the *next* `--update-env-vars` call — which should only have merged in
  two more keys — produced the exact same crash.
- **Cause:** `--set-env-vars` replaces the entire env var set, not just the keys given, so the
  first command deleted `COOKIE_SECRET`, `DATABASE_URL`, and everything else in the same
  request. Separately, and less obviously: a `gcloud run services update` call persists its env
  vars onto the Service object's desired spec **the moment it is submitted**, regardless of
  whether the resulting Revision ever passes its startup probe. The second, "safe" merge command
  was merging onto that already-emptied spec, not onto the last Revision that actually served
  traffic — there was nothing left under it to merge onto.
- **Rule:** **Never use `--set-env-vars` for an incremental change; use `--update-env-vars` or an
  `--env-vars-file` with the complete desired state.** And after any failed deploy, assume the
  service's *spec* — not just its live traffic — is now in the failed state; the fix is to
  restate every variable in one file-based update, not to patch on top of the last command.
- **Verify:** `gcloud run revisions describe <new-revision> --format='value(status.conditions)'`
  reports `True` before trusting any subsequent incremental update to it.

### 2026-09-17 — The frontend pointed at the Cloud Run URL directly, and the session cookie stopped working

- **Symptom:** Logging in returned `200` with the correct user object — server logs showed
  nothing wrong — but the app immediately behaved as signed out, showing "Your session ended."
  (Same banner text as the unrelated 2026-09-17 sign-out entry above; a different cause,
  confirm which one before reusing that fix.)
- **Cause:** `src/api.ts`'s `API_BASE` fallback had been pointed at the Cloud Run service's own
  `*.run.app` URL directly — a different registrable domain from the frontend at
  `www.arcnave.tech` — while the session cookie is `SameSite=Lax`. A Lax cookie is stored from a
  cross-site response but is **never attached to a subsequent cross-site `fetch`**, only to
  same-site requests or top-level navigations. Login worked and set the cookie; the very next
  `fetch` (checking the session) silently went out without it.
- **Rule:** **The frontend and the API must be same-origin in production, not merely
  CORS-permitted.** `credentials: "include"` and a permissive `Access-Control-Allow-Origin` do
  not fix a `SameSite=Lax` cookie across origins — only same-site (or `SameSite=None`, with its
  own trade-offs) does. Route `/v1/*` through the same host the frontend is served from (a
  Worker/proxy in production, matching what `vite.config.ts` already does in development) rather
  than pointing `VITE_API_BASE` at the backend's own domain.
- **Verify:** After login, `document.cookie` will not show the (HttpOnly) session cookie, but
  the *next* authenticated request must succeed. If `GET /v1/auth/me` right after login returns
  `user: null`, the API is cross-site from the frontend's perspective — check `API_BASE` first.

### 2026-09-17 — A Worker proxying to a non-Cloudflare origin added ~1.2s per request

- **Symptom:** `GET /v1/chats` took 1.5–1.9s through `www.arcnave.tech`, versus ~0.2–0.3s
  hitting the Cloud Run URL directly. The gap sat entirely between TLS handshake and first
  byte, ruling out anything client-side.
- **Cause:** The Worker fixing the previous entry's cookie bug (proxying `/v1/*` to Cloud Run)
  runs at whichever Cloudflare edge received the client's request, and Cloud Run is not a
  Cloudflare-fronted origin — so every proxied request pays a fresh cross-region TCP+TLS
  handshake from that edge to `asia-south1`, with none of Cloudflare's connection reuse.
- **Rule:** **A Worker that proxies to a non-Cloudflare origin needs `placement: { mode: "smart"
  }` in `wrangler.jsonc`, or it pays a full handshake to that origin on every single request**
  from whatever edge the client happened to hit. Smart Placement relocates the Worker's
  execution near the origin instead, so the expensive hop happens once. It is not instant:
  Cloudflare's own docs say convergence needs sustained multi-location traffic and can take up
  to ~15 minutes after deploy — do not conclude the fix failed from measurements taken
  immediately after deploying it.
- **Verify:** `curl -D - <url> | grep -i cf-placement` — `local-<colo>` means unconverged (or
  not proxying to a distant origin at all); `remote-<colo>` means Smart Placement is active.

### 2026-09-17 — Neon's pooled endpoint would have broken prepared statements, silently, under load

- **Symptom:** Never actually shipped — caught while investigating a separate latency issue
  (Neon free-tier compute auto-suspends after 5 minutes idle, causing multi-second cold-start
  spikes on the next query; switching to Neon's `-pooler` endpoint was the fix for a related,
  correct reason, but almost went out without this).
- **Cause:** `src/db/client.ts` used `postgres.js` with its default `prepare: true` — server-side
  prepared statements over a persistent connection. Neon's pooled endpoint is PgBouncer in
  transaction-pooling mode: each transaction can land on a *different* backend server
  connection, so a prepared statement created during one transaction is not guaranteed to exist
  for the next. This fails intermittently under real load, not in a quick smoke test, which is
  exactly the kind of bug that reaches production before anyone reproduces it.
- **Rule:** **Never point a client at Neon's (or any PgBouncer transaction-pooling) endpoint
  without checking what the client's driver assumes about connection-scoped state first.** For
  `postgres.js`, that means `prepare: false`. Trace the assumption before changing the
  connection string, not after something fails under load.
- **Verify:** Full suite (`npx vitest run`, 183 tests) against real Postgres with `prepare:
  false` set, before the pooled endpoint went anywhere near production.

### 2026-09-17 — Chased the "proper" same-site fix through two dead ends before taking the trade-off

- **Symptom:** Not a bug — a record of a decision reversed twice in one session, so the next
  session does not re-walk the same two dead ends. The cross-origin cookie entry above
  (frontend pointed at Cloud Run directly) was fixed with a same-origin Worker proxy; that
  proxy was then removed again in favor of `SameSite=None`.
- **Cause of each dead end:**
  - The Worker proxy fixed the cookie correctly, but added ~1.2s/request (see the Smart
    Placement entry above), and Smart Placement does not converge at this app's traffic level
    — it needs sustained, concentrated real usage to relocate the Worker, which a single test
    user does not produce. No amount of waiting fixed it; there was no traffic to converge on.
  - Cloud Run's own domain-mapping feature (`api.arcnave.tech` on the same registrable domain,
    same-site without a proxy) does not support `asia-south1` — mapping is Preview-only,
    limited to ten specific regions, and Google's own docs call it "not production-ready" even
    where it is supported.
- **Rule:** **When the textbook-correct fix is blocked by a platform limitation two ways in a
  row, stop and name the trade-off explicitly rather than reaching for a third workaround.**
  `SameSite=None` was accepted deliberately here, for single-user testing, with its real
  cost stated plainly: Safari and strict Firefox tracking-protection modes block it by
  default, no site-level opt-out for a plain fetch flow. This is not a fix to reproduce
  reflexively — it is a stated, temporary trade-off. Revisit before real multi-browser traffic:
  either move the Cloud Run service to a domain-mapping-supported region, or put a real load
  balancer in front of it, or move to a token-based session.
- **Verify:** `curl -D - <backend-url>/v1/auth/login ... | grep -i set-cookie` shows
  `SameSite=None; Secure`. Test login in Safari specifically before trusting this for anyone
  but the single test account this was built against.
- **2026-09-19 addendum:** the same trade-off silently breaks **local browser QA against
  `npm run dev`**, not just Safari/Firefox in production. `sameSite: 'none'` requires `secure:
  true` per spec; `SESSION_COOKIE_SECURE` defaults `false` locally (plain `http://localhost`,
  no TLS), so Chrome accepts the `Set-Cookie` response but silently drops the cookie — `POST
  /auth/login` returns 200, the very next `GET /auth/me` says `{"user":null}`, and the UI bounces
  back to the sign-in screen with no error. `curl` never sees this (it doesn't enforce cookie
  policy), which is exactly why it went unnoticed through every prior session's local testing.
  Cost real time chasing a phantom "login is broken" before checking the console for the CORS/
  cookie warning. **Rule:** when a browser-only auth flow "loses" the session right after a
  successful login locally, check the console for a dropped-cookie warning before suspecting the
  session logic itself — `curl` cannot reproduce this class of bug at all. To actually drive the
  local dev UI through a real login, temporarily flip `sameSite` to `'lax'` in
  `routes/auth.ts` for that session only — never commit it, `SameSite=None` is a real,
  considered production decision, not a bug to "fix" here.

### 2026-09-17 — The SSE generate endpoint had no CORS headers, only visible once cross-origin

- **Symptom:** In a real browser, sending a chat message hung on "Thinking…" forever. Every
  other endpoint (login, chats list, models) worked fine from the same page. Curl-based testing
  all session had not caught this — curl does not enforce CORS, only browsers do.
- **Cause:** `/chats/:id/generate` writes its response with `reply.raw.writeHead(...)` to
  stream SSE frames, bypassing Fastify's reply pipeline entirely — which is exactly where
  `@fastify/cors` (registered in `app.ts`) injects `Access-Control-Allow-Origin` and
  `-Credentials`. Every other route uses `reply.send()`/Fastify's normal response path and got
  CORS headers for free; this one silently never had them. Invisible for the entire time the
  frontend and API were same-origin (via `vite.config.ts`'s proxy, or the Worker proxy tried
  and reverted earlier tonight) — a hard, silent failure the moment they were not.
- **Rule:** **Any handler that reaches for `reply.raw` to bypass Fastify's response pipeline
  must be checked against every `onSend`-hook-based plugin the app registers — CORS, but also
  anything else added later that assumes it runs through `reply.send()`.** Test it with an
  actual cross-origin `Origin` header via `app.inject()`, not just same-origin curl calls;
  curl and `fetch` with no `Origin` set will never reproduce a CORS failure.
- **Verify:** `chats.integration.test.ts` — "sends CORS headers on the SSE response for an
  allowed origin" and its negative counterpart for a non-allow-listed origin. Both fail if the
  header logic in `chats.ts`'s generate handler regresses.

### 2026-09-17 — Sign out looked broken because the UI waited for a cross-region round trip

- **Symptom:** Reported live as "sign out not working." Reproduced in a real session: clicking
  "Sign out" closed the menu and then visibly did nothing — same signed-in screen — until an
  unrelated later interaction finally showed the sign-in form. No error, no console output, no
  network request even visible to the debugging tooling used (cross-origin `fetch` calls don't
  show up there), which made it look like the click handler never fired at all.
- **Cause:** `session.tsx`'s `signOut` awaited `api.auth.logout()` *before* clearing local state
  (`setUser(null)`, etc.). The call is a real cross-region request (frontend on Cloudflare,
  API on Cloud Run `asia-south1`, see the `SameSite=None` entry above), so the UI sat frozen on
  the signed-in screen for however long that round trip took, with zero loading indicator on the
  menu item to show anything was happening — indistinguishable from the click doing nothing.
- **Rule:** **Never make a client-side state change wait on a server call whose failure is
  already handled as a no-op.** The code's own comment already said a failed logout shouldn't
  block ending the local session — the same reasoning means a *slow* one shouldn't either. Clear
  local state synchronously in the handler, then fire the server call and swallow its failure.
- **Verify:** Manual — click Sign out and confirm the sign-in screen appears on the same paint as
  the click, not after a visible delay. No automated coverage: the frontend suite has no
  component-rendering harness (`vitest` only, no `@testing-library/react`), so this is
  reasoned from the diff, not asserted by a test — adding one means introducing that dependency,
  which is a bigger decision than this fix.

### 2026-09-17 — `docker start arcnave-pg` fails in this Claude Code web/cloud sandbox

- **Symptom:** `global-setup.ts`'s own error message ("Is Postgres running? `docker start
  arcnave-pg`") is wrong advice here: `docker start arcnave-pg` fails with `failed to connect to
  the docker API at unix:///var/run/docker.sock ... no such file or directory` — there is no
  Docker daemon in a Claude Code on the web / cloud-session container.
- **Cause:** The sandbox this session runs in has no `dockerd`, but it does ship a real
  `postgresql-16` cluster pre-installed and stopped (`pg_lsclusters` shows `16 main 5432 down`).
  The `arcnave` role and `arcnave` database also do not exist yet on a fresh container.
- **Rule:** **In a Claude Code web/cloud session with no Docker, use the native cluster instead
  of trying to make `docker` work:** `service postgresql start`, then, as the `postgres` OS
  user, create the `arcnave` superuser role and `arcnave` database matching
  `TEST_DATABASE_URL`'s defaults (`postgres://arcnave:arcnave@localhost:5432/arcnave_test`) —
  `global-setup.ts` creates the `_test` database itself once the base role exists.
- **Verify:** `pg_lsclusters` shows `5432 online`; `psql -U arcnave -h localhost -c 'select 1'`
  connects; `npx vitest run` (which needs the database) passes.

### 2026-09-18 — Attaching an image to any model on production returned "Not found"

- **Symptom:** Live in production (real browser, real account): attach an image, ask about it —
  every model, not just one — answered with the generic `not_found` card ("That item does not
  exist, or you do not have access to it") instead of describing the image. Confirmed the same
  card appears with Claude selected, ruling out a Claude-specific capability gap before looking
  at storage.
- **Cause:** `STORAGE_BACKEND=local` (`LocalObjectStorage`) writes attachment bytes to the
  container's local filesystem. `POST /files` (the upload) and `POST /chats/:id/generate` (which
  reads the bytes back via `storage.get()` in `chats.ts`'s native-attachment path, and again
  later via `loadHistory`'s carry-forward in `generation.ts`) are two separate HTTP requests.
  Cloud Run does not guarantee both land on the same instance, and `arcnave-sandbox-service`
  cold-starts from empty local disk on every new instance (`minScale=0`, see the 2026-09-17
  entry on cold starts) — so the second request's `storage.get()` throws `ENOENT`, which
  `LocalObjectStorage.get()` deliberately maps to `ApiError('not_found')`. Before this
  session's multimodal-file-input feature, nothing ever called `storage.get()` in a *later*
  request than the upload — attachment text was extracted and persisted to the database at
  upload time, and every later read used that column, never the filesystem. Native image/PDF
  attachments are the first feature to need the raw bytes back in a subsequent request, which is
  exactly where local storage's instance-locality assumption breaks.
- **Rule:** **Never rely on `STORAGE_BACKEND=local` surviving past the request that wrote it, on
  Cloud Run or any other autoscaled/stateless compute.** It is correct only for the Docker
  Compose stack, where the volume is one host's disk under one process. Production must run
  `STORAGE_BACKEND=gcs` with `STORAGE_GCS_BUCKET` set. `@google-cloud/storage` is now a real
  `dependencies` entry (`backend/package.json`) — it was previously a comment telling whoever
  enabled this path to install it themselves, which nobody had reason to do until this feature
  made the path load-bearing for the first time.
- **Verify:** Not yet possible from this session (no `gcloud`, no GCP credentials — see
  `docs/checkpoints/CURRENT.md`'s "Blocked on the user"). Once a human sets `STORAGE_BACKEND=gcs`
  and `STORAGE_GCS_BUCKET` on the live service and grants the service's identity
  `roles/storage.objectAdmin` on that bucket: attach an image, ask a follow-up two turns later
  with no re-attachment, confirm both turns succeed regardless of which Cloud Run instance
  serves each request.

### 2026-09-18 — `.xlsx` uploads failed with "unsupported media type"

- **Symptom:** Live user report: uploading a spreadsheet (`.xlsx`) failed outright at upload
  time, not silently — a real `415` from `POST /files` (and the same route logic under
  `POST /projects/:id/files`).
- **Cause:** Two separate gaps, both pre-existing (neither introduced this session):
  1. `checkUpload` only accepted `.xlsx` when the browser's claimed MIME type matched the exact
     canonical string (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
     Many real browsers — reliably on Linux, inconsistently elsewhere — have no Office MIME type
     registered at the OS level and send `application/octet-stream` or an empty type instead,
     which is exactly the case `TEXTUAL_EXTENSIONS`' fallback already existed to handle, but
     only for code/text files. `.xlsx` and `.docx` had no equivalent fallback.
  2. Even had upload succeeded, `extractText()` had no branch for spreadsheets at all —
     `mammoth` (docx) and `pdf-parse` (pdf) were wired in, nothing was for `.xlsx`. It would
     have stored the file but thrown `ExtractionUnsupported` on every attempt to read it.
  Neither gap was caught by the existing suite because nothing in it ever exercised a real
  `.xlsx` byte stream — `checkUpload`'s tests covered the MIME/extension logic in the abstract,
  and no test called `extractText` with real spreadsheet bytes.
- **Rule:** **A file type "supported" in the upload allow-list is not supported until something
  can also extract its text.** Adding a MIME type to `ALLOWED` without a matching `extractText`
  branch is a promise the upload accepts that the rest of the system cannot keep — the same
  "traced to its consumer" principle `CLAUDE.md` already states for enums applies here.
  **And a MIME-fallback list needs every extension the ALLOWED table promises to accept**, not
  only the ones covered when it was first written.
- **Verify:** `src/services/storage.test.ts` (`checkUpload` accepts `.xlsx` via octet-stream,
  empty claim, and the canonical type; rejects an active `text/*` claim on it) and
  `src/services/retrieval.test.ts` (`extractText` round-trips a real workbook built with
  `exceljs`, labels multiple sheets, rejects an empty one) plus one full-stack
  `files.integration.test.ts` case uploading a real `.xlsx` buffer as `octet-stream` through
  `POST /files` end to end.

### 2026-09-18 — `z.coerce.boolean()` on a query string is not what it looks like

- **Symptom:** `GET /models?probe=false` — the frontend's own cached-status request — took
  30.59s in production, hitting the probe abort timeout exactly. The composer was paying for a
  live provider call to every alias on every login, not just when Settings' "Refresh" was
  clicked.
- **Cause:** `probe: z.coerce.boolean().default(true)` in [`models.ts`](backend/src/routes/models.ts).
  `z.coerce.boolean()` runs `Boolean(value)`, and `Boolean("false")` is `true` — any non-empty
  query string coerces to `true`, so `probe=false` was silently indistinguishable from
  `probe=true` or no param at all.
- **Rule:** **Never use `z.coerce.boolean()` on a query string.** Use an explicit
  `z.enum(['true', 'false']).transform(v => v === 'true')`, or any coercion that actually
  branches on the string's content instead of its truthiness.
- **Verify:** `node -e "require('zod').z.coerce.boolean().parse('false')"` must never print
  `true`. `src/routes/models.ts`'s querystring schema is the only place this pattern could
  recur — grepped clean as of this fix.

### 2026-09-18 — `postgres.js` does not understand `pg`'s `?host=` Unix-socket convention

- **Symptom:** Two consecutive production deploys (revisions `00045`, `00046`) never became
  Ready — Cloud Run's startup TCP probe failed repeatedly, `docker` logs showed the container
  calling `exit(1)` before ever binding to `$PORT`. Traffic kept serving from the last Ready
  revision throughout, so nothing looked broken from outside; two full deploys silently did
  nothing.
- **Cause:** `DATABASE_URL` was set to a Cloud SQL Unix-socket DSN in `pg`/libpq style —
  `postgresql://postgres:***@/arcnave?host=/cloudsql/<instance>` — which is a `node-postgres`
  convention, not one `postgres.js` (the driver this codebase uses) implements at all.
  `postgres.js`'s `parseUrl` runs a plain `new URL(...)` on the connection string first; an
  empty host before `/arcnave` is invalid per the WHATWG URL spec for a special scheme, so it
  throws `ERR_INVALID_URL` synchronously — inside `container.ts`'s eager `getDb()` call, before
  `app.listen()` ever runs, and separately inside `migrate.ts`'s own independent `postgres()`
  connection.
- **Rule:** **A Cloud SQL Unix socket has to be passed as the `host` *option*, never embedded
  in the connection string.** `postgres.js` detects a `/` in `options.host` and builds
  `<host>/.s.PGSQL.<port>` itself, then connects on that path directly
  (`connection.js`: `if (options.path) return socket.connect(options.path)`) — bypassing TCP
  entirely. `DATABASE_URL` still needs a syntactically valid placeholder hostname (e.g.
  `localhost`) so `new URL()` doesn't throw before the override is even applied. **Every place
  that builds its own `postgres()` connection needs this separately** — `db/client.ts`'s pool
  and `db/migrate.ts`'s dedicated single connection are two different call sites, and fixing
  one does not fix the other (confirmed live: revision `00048` booted fine after the `client.ts`
  fix, but `migrate.ts` still failed with `ECONNREFUSED 127.0.0.1:5432` on every instance until
  it got the same `DB_SOCKET_PATH` override).
- **Verify:** `gcloud run revisions list` shows the new revision reaching `Ready`, and its logs
  show `"msg":"migrations applied"` rather than `"msg":"migration failed"`.

### 2026-09-18 — Concurrent cold-start instances raced the same non-idempotent migration

- **Symptom:** After the fix above, most but not all instances of the same revision logged
  `"migrations applied"`; a few logged `"migration failed"` with
  `duplicate key value violates unique constraint "pg_type_typname_nsp_index"` on a `CREATE
  TABLE`.
- **Cause:** The Dockerfile's entrypoint runs `node dist/db/migrate.js` on every container
  boot (documented, deliberate — see `docs/checkpoints/CURRENT.md`'s "free improvement…not
  implemented" note). A deploy that starts several instances at once had several of them run
  the migrator concurrently against a schema that did not exist yet; Drizzle's migrations are
  plain `CREATE TABLE`, not `CREATE TABLE IF NOT EXISTS`, so the instance that lost the race on
  table creation crashed. The `|| true` in the entrypoint means a losing instance still starts
  the server afterward, so this was not user-visible this time — the schema was already
  correct from whichever instance won — but it is not something to rely on.
- **Rule:** **Do not assume a single migration run when several instances can cold-start at
  once.** This is the same tradeoff the checkpoint already named (migrations run at container
  boot, not a separate deploy step) — this entry is the concrete failure mode that tradeoff
  produces under a multi-instance rollout, not a new decision to make here.
- **Verify:** Not yet fixed. Moving the migration to a separate deploy step (a Cloud Build
  step, or a Cloud Run Job run once before traffic shifts) is the real fix; tracked as a known
  issue in the checkpoint rather than patched under time pressure.

### 2026-09-18 — `pdf-parse`'s concatenated `.text` is never truly empty, even for a blank page

- **Symptom:** A scanned (image-only) PDF's OCR fallback never triggered — `extractPdf`'s
  `text.trim() === ''` check was always false, even against a hand-built PDF with zero real
  content.
- **Cause:** `PDFParse.getText()`'s top-level `.text` is the per-page strings joined with a
  `-- N of M --` separator — inserted even when every page is blank, so the concatenated string
  is never actually empty. Only `result.pages[i].text` is.
- **Rule:** **Test "is there real text" against `result.pages[].text`, never the concatenated
  `.text`.** Any pdf-parse boilerplate lives in the join, not the per-page values.
- **Verify:** `extractText` on a hand-built blank-page PDF (no `/Contents`) with no vision
  provider configured rejects with the OCR-unavailable message — see
  `retrieval.test.ts`'s "fails with a typed reason rather than silently skipping OCR".

### 2026-09-18 — Two third-party `.d.ts` files lied about their own exports under this tsconfig

- **Symptom:** `new ExcelJS.Workbook()` compiled fine, but `workbook.xlsx.load(buffer)` refused
  a real `Buffer` — "Buffer is not assignable to Buffer". Separately, `new PptxGenJS()` refused
  to compile at all: "has no construct signatures" — on both a value import and a type-only one.
- **Cause:** `exceljs`'s `index.d.ts` shadows the global `Buffer` with its own
  `interface Buffer extends ArrayBuffer {}` (a pre-`@types/node`-generics-era workaround), so
  `Buffer` inside that file's own signatures means something structurally different from ours.
  `pptxgenjs` is CommonJS with an ESM-authored `.d.ts`; under this project's
  `NodeNext` + `verbatimModuleSyntax`, its `export default` does not narrow past the whole
  module namespace on import — confirmed on both a value and a type-only import, so it is the
  declaration file's interaction with our tsconfig, not our import style.
- **Rule:** **When a `.d.ts` and its own package disagree with reality, don't fight the types
  into submission with guesses.** Confirm the actual runtime shape first (a quick
  `node -e` script bypassing TS entirely), then either a narrow, commented `as any` at the one
  call site (exceljs) or pull the *value* via `createRequire`/`require` typed against a small
  local interface covering only what's actually called (pptxgenjs) — never loosen the type
  everywhere just to make one broken declaration compile.
- **Verify:** `npx tsc --noEmit` clean; `retrieval.ts`'s `extractXlsx` and
  `projects.integration.test.ts`'s pptx-deck test both pass against real generated files.

### 2026-09-18 — `@google-cloud/storage` was never a declared dependency, and production had `STORAGE_BACKEND=gcs`

- **Symptom:** None observed yet — found by reading `storage.ts`'s own comment
  ("Requires `@google-cloud/storage`, which is not a declared dependency") while preparing to
  deploy, then checking the live Cloud Run service's env vars and finding
  `STORAGE_BACKEND=gcs` / `STORAGE_GCS_BUCKET=arcnave-attachments` already set.
- **Cause:** `GcsObjectStorage.getBucket()` dynamically imports `@google-cloud/storage`, which
  was never added to `package.json`. `npm ci --omit=dev` in the Dockerfile would not have
  installed it, so the first real upload/download on the deployed revision would throw at the
  dynamic `import()` — silent until that exact code path ran.
- **Rule:** **A backend value in production config (`STORAGE_BACKEND=gcs`) is a claim that the
  code path it selects actually works. Trace every env-driven branch to what it imports before
  trusting that a deploy exercises it.**
- **Verify:** `npm install @google-cloud/storage`; `docker build` the backend image, then
  `docker run --rm <image> node -e "import('@google-cloud/storage').then(...)"` resolves
  inside the real runtime image, not just locally where dev dependencies are also present.

### 2026-09-18 — A backend-only push re-deployed the frontend anyway, from a stale `main`

- **Symptom:** Live UI briefly looked like it had reverted to an older style each time a
  backend-only fix (this session's Cloud SQL / probe work, none of it touching
  `arcnave-frontend/`) was merged and pushed to `main`.
- **Cause:** This repo has a Cloudflare Workers Build hooked to `main` (visible as the "Workers
  Builds: site" check on any PR) with no path filter, as far as this session could see — no
  build config in `arcnave-frontend/wrangler.jsonc` scopes it, and no ignore-paths setting is
  visible from the repo side (Cloudflare project build settings live outside this repo and
  weren't checked directly). It rebuilds and redeploys the frontend from whatever
  `arcnave-frontend/` looks like on `main` *at that push*, regardless of which files the push
  actually changed. If newer UI/UX work is sitting uncommitted, on another branch, or deployed
  some other way outside `main` (a parallel session, e.g. Codex, working the frontend), any
  unrelated push to `main` — even a one-line backend fix or a docs-only commit — re-triggers
  that build and republishes the older frontend `main` still has, overwriting whatever newer
  version was live a moment before.
- **Rule:** **A push to `main` redeploys the whole site, not just what changed.** When backend
  and frontend work are happening in parallel across different sessions/tools, the frontend
  side has to actually be merged into `main` to stay live — deploying it some other way (direct
  `wrangler deploy`, a local preview, a different branch) will not survive the next unrelated
  push to `main`. A backend-only session should not need to reason about this — the fix belongs
  in the Cloudflare Workers Build config (path-based ignore rules, or split into separate
  frontend/backend Pages projects) — but until that exists, know that it doesn't exist.
- **Verify:** Check the Cloudflare dashboard's build settings for this project for a "Build
  configuration" / "Path" filter; none was found from inside this repo. Until one exists,
  coordinate: land frontend work on `main` before or immediately after any backend push, not
  in a separate long-lived deploy.

---

### 2026-09-19 — Vitest hid a CommonJS dynamic-import failure in production ESM

- **Symptom:** A deployed `.xlsx` upload failed with `ExcelJS.Workbook is not a constructor`
  even though every spreadsheet unit and integration test passed.
- **Cause:** `await import('exceljs')` returns a Node ESM namespace whose CommonJS export lives
  under `default`; Vitest's transform exposed named exports and made `new ExcelJS.Workbook()`
  appear valid in tests, while compiled Node returned `Workbook === undefined`.
- **Rule:** **Never trust a test runner's CommonJS interop shape for production ESM.** Import a
  CommonJS package through its documented default export, and inspect the built/runtime import
  shape with plain `node --input-type=module` whenever code uses dynamic `import()`.
- **Verify:** `node --input-type=module -e "import ExcelJS from 'exceljs'; new ExcelJS.Workbook();"`
  exits successfully, and an actual deployed `.xlsx` upload reaches `ready` with extracted text.

---

### 2026-09-19 — A captured system prompt was read as if it were API documentation

- **Symptom:** The items 9–12 design in `tools/MAPPING.md` recommended adopting Gemini's
  `retriever:expand_tools` as ArcNave's lazy tool-loading mechanism, stated the tool-name
  ceiling as 64 because "Anthropic caps at 64", and presented "build our own skills system"
  as a design preference. All three were written from the captured vendor system prompts under
  `tools/`, before any vendor documentation was checked.
- **Cause:** A captured system prompt shows what a **product** does internally. It is not
  evidence about what an **API** exposes to us, and it says nothing about what a **partner
  platform** like Vertex supports. `retriever:expand_tools` is an in-product mechanism inside
  the Gemini app — the Gemini API has no `defer_loading` and no tool search at all (open request:
  `googleapis/python-genai#2185`). The real version of that feature is Anthropic's `tool_search`,
  which *is* available on Vertex. Anthropic's name regex is `^[a-zA-Z0-9_-]{1,128}$` — 128, not
  64; Gemini and OpenAI are what bind it to 64, and only Gemini requires a leading letter.
  Building our own skills registry is not a preference but a hard constraint: Anthropic's native
  Agent Skills needs the code-execution tool and is listed **unsupported on Vertex**, alongside
  programmatic tool calling, the MCP connector, the Files API and `task_budget`.
- **Rule:** **A leaked or captured system prompt is a design reference, never a capability
  claim.** Before designing against any provider feature, check (1) the vendor's own API docs for
  the feature's existence and exact constraints, and (2) the **platform availability table** for
  whether it works on the platform we actually call — for Anthropic that is
  `shared/platform-availability.md` in the `claude-api` skill, which states it is the single
  source of truth and must not be inferred from elsewhere. This is Invariant 1 turned inward: do
  not silently substitute one vendor's mechanism for another's and present it as available.
- **Verify:** Every capability named in a design doc cites a vendor doc URL or the availability
  table, and each says explicitly whether it works **on Vertex**. `tools/MAPPING.md` §10 is the
  worked example. The still-unverified item is logged there as N1 — whether Vertex accepts custom
  `function_declarations` alongside the `googleSearch` grounding ArcNave already ships (it used to
  400 with "multiple tools are supported only when they are all search tools"); confirm with one
  live call to `gemini-3.8-flash` before building on it.

---

### 2026-09-19 — `@google/genai` rewrote a shared tool schema in place, breaking the other provider

- **Symptom:** A live probe sent one tool definition to Gemini (4 calls, all fine) and then the
  same definition to Claude on Vertex, which returned
  `400 tools.0.custom.input_schema.type: Input should be 'object'` — even though the object was
  written with `type: 'object'`.
- **Cause:** `@google/genai` normalises the JSON Schema it is handed into Vertex's proto enum
  form **by mutating the caller's object**, not a copy: `"object"` → `"OBJECT"`,
  `"string"` → `"STRING"`, `"integer"` → `"INTEGER"`. Claude's API requires lowercase, so the
  second provider received a schema the first had already rewritten. Printing the object before
  and after the Gemini call showed the flip. (A first attempt to reproduce it with the
  declaration built inline for a single call did *not* show mutation, so it is not reliably
  visible from a one-shot check — do not conclude "no mutation" from one call.)
- **Rule:** **Treat any object handed to a provider SDK as owned by that SDK.** For anything
  shared across adapters — tool schemas above all — keep one neutral internal type and have each
  adapter build its wire payload from its own `structuredClone`. This is what makes "one
  `ToolDefinition`, two serialisers" actually true rather than true-looking; the shared-reference
  version passes a single-provider test and fails the moment both providers run in one process.
- **Verify:** `JSON.stringify(schema)` immediately before and after a Gemini call is unchanged;
  and a probe that calls Gemini and then Claude with the same `ToolDefinition` gets
  `stop_reason: tool_use` from both rather than a 400.

---

### 2026-09-19 — A single heavy focus rule changed the visual language of unrelated controls

- **Symptom:** Clicking ordinary text fields, Settings items, and menu choices drew a thick,
  offset rectangle and menu hover states became bold, while the model picker remained quiet.
- **Cause:** A global `:focus-visible` rule applied a two-pixel outline with a three-pixel
  offset to every interactive element. A later typography override also made every highlighted
  menu label semibold, so the same interaction state looked materially different by component.
- **Rule:** **Do not use one high-emphasis focus treatment as a catch-all UI style.** Keep a
  visible but single-line keyboard indicator, and let ordinary menus use the same soft
  background selection state as the model picker unless a control needs a stronger state.
- **Verify:** Click and keyboard-tab through text fields, Settings, sidebar navigation, and
  mode menus: no thick outer box or weight jump appears; keyboard focus remains distinguishable.

### 2026-09-19 — A Gemini tool loop only checked `AbortSignal` mid-stream, not before the next round's request

- **Symptom:** Caught in Task 8's own adapter-loop test, never shipped — "stops issuing provider
  requests once the signal is aborted" failed by asserting `client.calls.length`, not just that
  the generator eventually threw.
- **Cause:** The Gemini tool loop (Task 7) checked `request.signal.aborted` inside the
  chunk-consuming loop, i.e. only while a stream was actively being read. An abort that fired
  while `await request.toolExecutor!.execute(...)` was in flight — between rounds, with no
  stream open to check anything against — was invisible to that check, so the loop went on to
  issue one more `generateContentStream()` call before anything noticed the abort. A test that
  only asserts "the generator throws eventually" cannot tell an immediate abort from one that
  waited for a spurious extra round trip; asserting the call count can.
- **Rule:** **A bounded, multi-round provider loop must check `signal.aborted` at the top of
  *every* round, before issuing that round's request — not only inside the loop that consumes an
  already-open stream.** Between-round work (a tool execution, a delay) is exactly where a
  mid-stream-only check goes blind. The same gap was checked for and fixed proactively in the
  Anthropic adapter (Task 9) before it ever shipped, once this pattern was known.
- **Verify:** The adapter-loop test asserts `client.calls.length` stays at the pre-abort count
  when the signal fires during tool execution, for both `gemini.ts` and `anthropic.ts`'s tool
  loops — not just that the call under test eventually rejects.

### 2026-09-19 — Gemini's functionCall thought_signature was dropped when echoing a tool call back

- **Symptom:** Live in production, right after turning `ENABLE_TOOL_USE`/`ENABLE_RUN_PYTHON` on:
  every `search_project_files` call on Gemini 3.8 Flash correctly ran and returned real results
  (`tool_use`/`tool_result` frames both fired, with the right data), but the *next* round always
  failed with a generic `provider_error`. Nothing useful was logged — `run()`'s catch block
  mapped the error to a client-facing code but never logged the original exception (fixed in the
  same commit as this entry).
- **Cause:** Once logging was added and the failure reproduced, the real error was
  `400 INVALID_ARGUMENT: Function call is missing a thought_signature in functionCall parts`.
  Gemini's `thoughtSignature` is a field on the response `Part` that carries a `functionCall`,
  not on the `FunctionCall` object itself — but `gemini.ts`'s round loop built `roundCalls` from
  `chunk.functionCalls`, a flattening SDK getter that returns only `FunctionCall[]` and silently
  drops the sibling `Part`-level field. Reconstructing the continuation turn's `functionCall`
  part from that stripped-down shape therefore never echoed the signature Gemini requires back
  unchanged. Adapter-loop tests never caught this because their fakes constructed chunks with a
  bare `functionCalls` array, the same shape the buggy code actually read — the fake matched the
  implementation's assumption instead of the real API's.
- **Rule:** **When an SDK exposes both a raw response shape and a flattening convenience getter
  over it, treat the getter as lossy by default — check what it does *not* carry before building
  a round-trip (echo-back) on top of it,** especially for anything a provider requires to be
  replayed verbatim (this is the same class of requirement as Claude's "echo thinking blocks
  back unchanged" rule, just a different vendor). A fake built to match the current
  implementation's field usage, rather than the real wire shape, cannot catch this — it will
  agree with a wrong assumption as readily as a right one.
- **Verify:** `gemini.adapter-loop.test.ts`'s "echoes a functionCall part's thoughtSignature back
  on the continuation turn" constructs a fake chunk with `candidates[0].content.parts[].
  thoughtSignature` (the real shape) and asserts the second round's request carries it — this
  fails if the getter-only reading regresses. Live: a `search_project_files` call on Gemini 3.8
  Flash in production now completes with real final text instead of erroring after the tool result.

### 2026-09-19 — `run_python` had no real timeout and hung for minutes against the live sandbox

- **Symptom:** Live in production with `ENABLE_RUN_PYTHON=true`: a `run_python` tool call fired
  (`tool_use` frame appeared) and then never produced a `tool_result` — no error, no further SSE
  frames, still running after 2 minutes, until manually stopped via `POST /chats/:id/stop`. Cloud
  Logging showed nothing between the initial request and the stop; whatever was slow produced no
  log line of its own.
- **Cause:** `RUN_PYTHON_TIMEOUT_MS` (Task 2's config) is only used as the sandbox's `ttl` value
  sent to the Code Execution API — it was never actually wired as a client-side deadline on the
  create→poll→execute call chain, despite the plan's own text claiming it would be ("enforced
  client-side (an AbortController on the `:execute` fetch)"). `pollUntilDone` loops with no
  attempt cap or elapsed-time check beyond the caller's own (unrelated) `AbortSignal`, so a slow
  or stalled Preview-API operation blocks the whole generate request indefinitely instead of
  failing fast with a typed result the model could react to.
- **Rule:** **A documented timeout config value that is only read in one place (here: as a
  request payload field) is not the same as an enforced deadline — grep every place a "timeout"
  config is actually consumed before trusting it bounds anything.** A polling loop against an
  external LRO needs its own elapsed-time or attempt-count cap independent of whatever
  `AbortSignal` the caller happens to pass in.
- **Rule:** **Turned back off in production** (`ENABLE_RUN_PYTHON=false`) immediately on finding
  this — an unbounded hang on a live user request is worse than the feature being unavailable.
  Do not re-enable until `VertexSandboxClient` wraps its own internal calls in a real deadline
  (a `setTimeout`-driven `AbortController` scoped to `RUN_PYTHON_TIMEOUT_MS`, independent of the
  request's own signal) and that is verified live to actually fire.
- **Verify:** **Fixed and confirmed 2026-09-19.** `VertexSandboxClient.runPython` now starts its
  own `setTimeout`-driven `AbortController` combined with the caller's signal via
  `AbortSignal.any`; a fake-timers unit test proves the deadline fires without waiting in real
  time. Live-verified locally against the real Preview API (not production): a `run_python` call
  returned in ~9-37s with a real (if wrong-shaped, see the next entry) API error — no hang, no
  2-minute stall. Still `ENABLE_RUN_PYTHON=false` in production, now blocked on the next entry
  instead.

### 2026-09-19 — The `execute` REST call was against the wrong resource entirely

- **Symptom:** With the timeout fix confirmed (previous entry) and a real local test run against
  the actual Preview API (`GOOGLE_CLOUD_PROJECT` + ADC, not production), `run_python` no longer
  hung — but every attempt failed fast with `400 INVALID_ARGUMENT: Request contains an invalid
  argument` from `POST .../reasoningEngines/{id}/sandboxEnvironments/{id}:execute`. Reasoning
  engine creation and sandbox creation both succeeded (real resource names came back); only the
  execute call was rejected.
- **Cause:** The previous entry's own fix (finding the REST reference instead of inferring from
  the Python SDK) still landed on the wrong method. `sandboxEnvironments` does not expose a plain
  `execute` — only `bidiExecute` (a streaming/bidirectional method) and lifecycle methods
  (`create`/`list`/`resume`/`delete`). The actual stateless single-call entry point is a
  **different resource path**: `reasoningEngines.executeCode`, called as
  `POST {reasoningEngineName}:executeCode` directly on the reasoning engine — not on a
  separately-created sandbox at all. A `sandboxEnvironments`-shaped URL with a nonexistent
  `:execute` suffix still routes far enough to return a generic `INVALID_ARGUMENT` rather than a
  clean 404, which is why the failure looked like a malformed body instead of a wrong endpoint.
- **Rule:** **Finding *a* REST reference page is not the same as finding the *right* one.**
  Preview APIs can have near-identical sibling resources (`sandboxEnvironments` vs
  `reasoningEngines`, `execute` vs `executeCode` vs `bidiExecute`) that differ in exactly the
  field that matters. Confirm the method name and its parent resource against the reference
  page's own method list before writing the client, and treat a `400` from a plausible-looking
  URL as "maybe the wrong endpoint," not only "maybe the wrong body."
- **Verify:** **Rewritten and live-tested 2026-09-19 — still broken, one layer deeper.**
  `VertexSandboxClient` now creates a bare reasoning engine and calls
  `{reasoningEngineName}:executeCode` directly, no `sandboxEnvironments` involved. Live test
  against the real Preview API: reasoning-engine creation succeeds every time (a real resource
  name comes back), but `executeCode` still 400s with the same generic `INVALID_ARGUMENT` as
  before. One targeted follow-up was tried and also failed cleanly: adding
  `spec: { codeExecutionEnvironment: { codeLanguage: 'LANGUAGE_PYTHON' } }` to the reasoning
  engine's own creation body (guessing the code-execution capability belongs on the engine, not
  a separate sandbox) got a *more specific* error — `Unknown name "codeExecutionEnvironment" at
  'reasoning_engine...'` — proving that field name is wrong too, and reverted. Web research
  during this session turned up `ReasoningEngineSpec`'s real fields
  (`agentFramework`/`packageSpec`/`deploymentSpec`/`sourceCodeSpec`) — all shaped around
  deploying an actual agent package, not declaring "this engine can run arbitrary code." **Open
  question this session could not resolve:** whether `executeCode` works on a bare reasoning
  engine at all, or whether it requires one deployed with a real `packageSpec`/`deploymentSpec` —
  which would make "point ADC at a REST endpoint" a materially bigger lift than planned.
- **A fourth shape was found and tried, 2026-09-19, using an actual working example rather than
  a reference page:** Google's own quickstart notebook
  (`GoogleCloudPlatform/generative-ai/.../tutorial_get_started_with_code_execution.ipynb`) and
  its Python SDK show `client.agent_engines.sandboxes.execute_code(name=sandbox_name,
  input_data={"code": python_code})` — a **sandbox**-targeted call (not the reasoning engine)
  with an `{"code": ...}` body (not `Chunk`-shaped `inputs[]`). Rewrote `VertexSandboxClient` to
  match: create reasoning engine → create sandbox (`spec.codeExecutionEnvironment`, which had
  already worked back when the first shape was tried) → `POST {sandboxName}:executeCode` with
  `{ inputData: { code } }`. Live-tested: reasoning engine and sandbox creation both still
  succeed, but `executeCode` on the sandbox now returns a clean **`404`, empty body** — a
  different failure signature from every prior attempt, meaning the URL itself doesn't route to
  anything, not just a malformed body.
- **Conclusion — Google's own documentation is internally inconsistent here, not just sparse.**
  Three real, distinct request shapes have now been tried against the live Preview API, each
  grounded in an actual Google source (a stable-`v1` REST reference page, a Python-SDK quickstart
  notebook, and a targeted field guess), and each failed differently (400 opaque, 400 specific,
  404 empty). The REST reference page and the product's own official quickstart disagree about
  which *resource* `executeCode` even targets (`reasoningEngines` vs `sandboxEnvironments`) — this
  is not a case of "read more carefully," it's the vendor's documentation contradicting itself for
  a Preview feature. **Rule: past a certain point, further live-testing against undocumented or
  contradictorily-documented behavior stops being useful and starts being expensive random
  search — three grounded, distinct attempts is the point to stop and report the contradiction,
  not keep guessing a fourth and fifth combination.** The code was left on the shape backed by
  the only stable (non-`v1beta1`) REST reference page found, since that is the best-evidenced of
  the three, but it is **not confirmed working** — `ENABLE_RUN_PYTHON` stays `false` everywhere.
  Unblocking this for real needs either a Google support ticket or someone who has this specific
  Preview API working already; it is not a research-harder problem from here.
- **A fifth shape came from the user pasting an externally-generated answer** (an AI-written
  response to the support-question doc this session wrote — `docs/support/2026-09-19-vertex-code-
  execution-question.md`) claiming `sandboxEnvironments.execute` (not `executeCode`) with an
  `{ inputData: { code } }` body was the fix. **Tested rather than trusted** — live result:
  `400`, `"Invalid JSON payload received. Unknown name 'inputData'"`. That specific claim was
  wrong, but the error shape is informative: Google's validator names the exact unknown field
  when one is wrong (it did the same for `codeExecutionEnvironment` two entries up), and it did
  **not** do that for `inputs` back in the very first shape tried (`sandboxEnvironments:execute`
  with `{ inputs: [Chunk] }`, which only got a generic "invalid argument"). That absence of an
  "Unknown name" complaint is the strongest signal found all session that `inputs` is a real,
  accepted field on this endpoint — the reverted-to, currently-on-disk shape is `sandboxEnvironments
  .execute` (not `executeCode`) with `{ inputs: [{ mimeType: 'text/x-python', data: base64(code) }] }`,
  chosen specifically because it is the only one of five tried shapes where the failure looks
  like "right field, wrong value" rather than "wrong field entirely." **Still not confirmed
  working** — `ENABLE_RUN_PYTHON` stays `false`. **Rule, reinforced:** treat a fluent,
  confident-sounding externally-sourced answer as a hypothesis to verify live, not as ground
  truth — this one was wrong on the exact point it was most confident about (the body field name)
  but still moved the investigation forward by producing a new, diagnostic error message.

### 2026-09-19 — A Python-SDK quickstart is not a REST contract

- **Symptom:** The checkpoint named "Vertex AI Agent Engine's Code Execution service" as the
  planned sandbox for item 9 phase 2's `run_python`, but the only documentation on record was a
  Python-SDK quickstart (`client.sandboxes.create/execute_code/delete`). This codebase's backend
  is Node/TypeScript, and a live check found the JS/TS SDK has **no support for this resource at
  all** (`googleapis/js-genai#2185`, open) — so the quickstart could not be translated into code
  without guessing HTTP paths and body shapes.
- **Cause:** A language-specific SDK quickstart documents *a client library's* call shape, not
  *the service's* wire contract — the same category of gap as reading a captured system prompt
  as API documentation (this file, `A captured system prompt was read as if it were API
  documentation`), just one layer earlier: an SDK sample is still real documentation, but it is
  documentation of the wrong layer for a language that SDK doesn't cover.
- **Rule:** **When the only available documentation for an external API is another language's
  SDK, find the REST reference before writing an HTTP client against it — do not infer the wire
  shape from the SDK sample.** For Google Cloud APIs this is
  `docs.cloud.google.com/.../reference/rest/...`; the resource, method, and field names there are
  normative even when no code sample exists for your language.
- **Verify:** `VertexSandboxClient`'s request/response shapes in
  [`vertexSandboxClient.ts`](backend/src/tools/sandbox/vertexSandboxClient.ts) cite the REST
  reference pages read for each one (`reasoningEngines.create`,
  `sandboxEnvironments.create`/`execute`/`delete`), not the Python quickstart — and its tests
  assert those exact request shapes against a fake `fetch`, so a shape drift fails a test instead
  of only failing a real, unverifiable-in-this-environment live call.
- **2026-09-19 addendum:** `VertexSandboxClient` is retired (design in
  [ADR-0005](docs/decisions/0005-cloud-run-sandbox.md)), replaced by `CloudRunSandboxClient`
  (`backend/src/tools/sandbox/cloudRunSandboxClient.ts`) — a self-hosted Cloud Run Job, not
  another Agent Engine REST guess. This entry and the two above it about the five failed shapes
  stay as the historical record of why that path was abandoned, per ADR-0005's own instruction not
  to prune them just because the code is gone. `vertexSandboxClient.ts`/its test are still present
  and still unwired from `container.ts` — deleted only once `CloudRunSandboxClient` is
  live-verified against a real deployed Cloud Run Job, not before. One real gap found while
  building it: `docker build`/`docker run` against `backend/sandbox/Dockerfile` worked and all six
  integration checks in `run-integration-tests.sh` passed on this machine, but no real Cloud Run
  Job, IAM role, or service account was created — `CloudRunSandboxClient`'s Operation/Execution/
  Cloud-Logging shapes are only proven against a fake `fetch`, the same unverified-until-live gap
  every prior sandbox attempt had. **Do not set `ENABLE_RUN_PYTHON=true` anywhere until a real
  deployed Job answers a real call end to end.**
- **2026-09-20 addendum:** Closed that exact gap partially, with a real local browser session
  (`GOOGLE_CLOUD_PROJECT` + ADC, `ENABLE_TOOL_USE`/`ENABLE_RUN_PYTHON` temporarily flipped on in
  `backend/.env`, reverted after): the model actually called `run_python`, and
  `CloudRunSandboxClient` correctly built and sent a real, authenticated `jobs:run` POST to
  `https://run.googleapis.com/v2/projects/<project>/locations/us-central1/jobs/arcnave-python-sandbox:run`
  with `{"code": "print(17 * 23)"}` as a container override. Google's real answer was a typed
  `404 NOT_FOUND` ("Resource 'arcnave-python-sandbox' of kind 'JOB' ... does not exist") — expected,
  since no Job/IAM/service-account setup from `docs/deploy/cloud-run-sandbox-setup.md` was actually
  run. The failure surfaced as a clean, typed tool result (not a hang, not a crash); the model
  recovered and answered from its own arithmetic. This proves the client's auth, URL construction,
  and request shape are correct against the real API — the remaining unverified surface is
  specifically Operation/Execution/Cloud-Logging polling, which only exercises once a real Job
  exists to actually run. **Still do not set `ENABLE_RUN_PYTHON=true` in production** — this was a
  local-only, reverted flag flip, and the Job itself still needs to be deployed first.
- **2026-09-20 addendum #2:** Closed the gap fully. Deployed the real infrastructure
  (`arcnave-sandbox-runtime` service account with zero project IAM, the `arcnave_sandbox_launcher`
  custom role bound to the backend's service account, the `arcnave-python-sandbox` Cloud Run Job
  in `asia-south1` — matching the existing Artifact Registry repo and backend service region,
  not the `us-central1` the docs originally guessed) and live-verified `run_python` end to end in
  production with `ENABLE_RUN_PYTHON=true`: the real `jobs:run` → Operation → Execution polling →
  Cloud Logging result correlation chain completed and returned the correct `391` for `17*23`,
  twice. One non-bug found along the way: `docker push` from Cloud Shell failed twice with `dial
  tcp ... connect: connection refused` to two different Google IPs — not a credentials or image
  problem, Cloud Shell's own local Docker networking; `gcloud builds submit --tag ...` (server-side
  build+push via Cloud Build) worked on the first try. **`ENABLE_RUN_PYTHON` is now left `true` in
  production** — deliberately, because `REGISTRATION_ENABLED=false` and the user is the only
  account that can sign in, so the "arbitrary code execution exposed to any user" blast radius
  this flag exists to gate does not currently apply. Revisit before opening registration again.

### 2026-09-19 — `compact` did not mean the same thing on every composer surface

- **Symptom:** The chat reply composer still occupied a large empty block even though its caller
  passed `compact`; shrinking the shared rule would also have cramped project and artifact work.
- **Cause:** `compact` covered placement for three different surfaces, but the shared textarea
  effect imposed a 46px minimum everywhere. A live reply has different intent from a project or
  artifact prompt, so one generic minimum encoded the wrong product decision.
- **Rule:** **Scope visual compaction to the interaction intent, not a reused boolean prop.** A
  conversation reply may begin at one line and auto-grow within a bounded portion of the
  viewport; project and artifact prompts retain their writing space.
- **Verify:** A blank chat reply is 34px and grows to at most 42% of the viewport; project and
  artifact composers retain their existing minimum heights. The chat reply wrapper stays
  centered at a 760px maximum width so it does not consume nearly the full conversation pane.

### 2026-09-20 — Cloud Run Jobs has no field for "max concurrent executions"

- **Symptom:** Went looking for a way to cap how many `run_python` sandbox executions
  (`arcnave-python-sandbox`) could run at once across all users, expecting a job-level setting
  like a queue's concurrency limit. `gcloud run jobs update --help` only offers `--parallelism`
  and `--tasks`, which looked like the right knobs at a glance.
- **Cause:** `--parallelism`/`--tasks` bound concurrency **within one `jobs:run` execution**
  (how many tasks of *that* execution run together) — not across separate `jobs:run` calls.
  Since `CloudRunSandboxClient.runPython` issues one `jobs:run` per tool call, that flag never
  applied here. Cloud Run Jobs, as a GCP resource, simply has no field that limits how many
  *separate* executions run concurrently; the only ceiling is the project-wide
  `RunningExecutionsPerProject` quota (1000 in this project) and `JobRunPerMinutePerProjectRegion`
  (180/min — the one actually reachable by real traffic), both shared with everything else in the
  region.
- **Rule:** **Do not look to the job/service resource for a concurrency cap that has to span
  separate invocations — it has to be enforced in application code**, and since the backend
  autoscales (`maxScale: 8`), an in-process counter only caps per-instance. Use a shared source of
  truth (here, a Postgres-backed semaphore, `pg_advisory_xact_lock` plus a leased claim row so a
  crashed instance's claim self-expires instead of leaking capacity) — see
  `tools/sandbox/semaphore.ts`.
- **Verify:** `src/tools/sandbox/semaphore.test.ts` — real Postgres, ten concurrent `claim()`
  calls against a cap of 3 grant exactly 3; an expired lease is reaped and its slot reused.

### 2026-09-20 — Injected turn-specific context had no carry-forward story

- **Symptom:** A file attached to a chat message (text, code, docx, xlsx) was unreadable by the
  model on the very next turn ("the model forgot what I uploaded"), even though the file was
  still listed in chat history.
- **Cause:** `loadHistory` re-attached image/PDF attachment bytes across turns so vision kept
  seeing them, but had no equivalent branch for text-extracted attachments. That text only ever
  reached the model on the turn it was uploaded (`attachmentText` in `chats.ts`), and was
  silently dropped from every subsequent turn.
- **Rule:** **Anything injected into context "for this turn" needs an explicit carry-forward
  story, or it silently vanishes one turn later.** If the user expects the model to remember an
  attachment across a multi-turn conversation, `loadHistory` must re-attach it (bounded by
  `HISTORY_MAX_ATTACHMENT_TEXT_CHARS`), not only the current turn's prompt assembler.
- **Verify:** `src/routes/chats.integration.test.ts` (`attachment text across turns`) uploads a
  text file, asks a question with the attachment, then asks a follow-up with no attachment;
  asserts the provider's second request still contains the file's text.

### 2026-09-21 — A legacy transcript field crashed the whole workspace

- **Symptom:** Opening a chat after an `.xlsx` analysis could replace the workspace with the
  error boundary: `Cannot read properties of undefined (reading 'map')`, even though the
  response had been saved.
- **Cause:** `toMessage` treated transcript evidence collections (`sources`, `events`,
  `toolCalls`, `attachments`, and `questions`) as always-present arrays. A persisted/returned
  message missing any one of those fields threw while mapping the transcript, and the uncaught
  render error took down the entire chat view.
- **Rule:** **Normalize optional wire collections at the DTO boundary before rendering.** A
  missing collection means no data was supplied; it must not be allowed to crash unrelated,
  saved transcript content.
- **Verify:** `arcnave-frontend/src/types.test.ts` covers a legacy message with every optional
  collection absent; `npm test` and `npm run build` pass.

## Convention and sources

The structure above follows the `lessons.md` / `learnings.md` pattern the agentic-coding
community converged on, with the two guardrails its critics raise:

- Keep the learning log **separate** from the rules file, start it empty, and make the write
  step explicit in the instructions — models skip it when context is heavy near the end of a
  session. ([bswen on lessons.md](https://docs.bswen.com/blog/2026-03-27-what-is-lessons-md-in-claude-code/),
  [MindStudio's Learnings.md + wrap-up skill](https://www.mindstudio.ai/blog/self-learning-ai-skill-system-learnings-md-wrap-up))
- The loop itself — observe a mismatch, encode the correction, read it next session — is the
  core of self-improving agent setups.
  ([Eric Ma, building self-improving coding agents](https://ericmjl.github.io/blog/2026/1/17/how-to-build-self-improving-coding-agents-part-1/))
- **The failure mode is append-only growth.** Analysis across 2,500+ repositories found context
  files past ~150 lines deliver diminishing returns and raise inference cost without improving
  agent performance, and that the strongest files lean on explicit negative constraints —
  "must", "always", "never". Hence the 40-entry cap, the pruning policy, and the imperative
  phrasing. ([GitHub blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/),
  [Stork.AI on the AGENTS.md trap](https://www.stork.ai/blog/your-agentsmd-file-is-a-trap))

These are community conventions rather than vendor documentation — treat the specifics as
practice, not canon.

## Changelog

- **2026-09-21** — Added the transcript DTO normalization entry: missing optional evidence
  arrays in an older/degraded chat payload must not trip the workspace error boundary.
- **2026-09-20** — Added entry for the attachment-text carry-forward bug: text-extracted
  attachments were only injected into the upload turn's system prompt and vanished on turn two.
- **2026-09-20** — Retired "A comment asserted a guarantee the code did not provide" (the
  `FOR UPDATE`-vs-bare-`max()` concurrency entry) — its rule was promoted into `CLAUDE.md`'s own
  "Rules for changing this codebase" section verbatim ("A transaction is not a lock...") and its
  regression test still guards it, satisfying both the first and second pruning criteria at once.
  Added one entry from adding a Postgres-backed concurrency cap on `run_python`: Cloud Run Jobs
  has no resource-level field for capping concurrent *executions* (only within-execution
  parallelism), a platform gap that cost real investigation time before landing on an
  application-level semaphore.
- **2026-09-20** — Retired "A hand-written GFM table-separator regex was wrong for the common
  case" — `documents.test.ts`'s two-table test already fails if that exact regex bug recurs, per
  the pruning policy's first criterion. Also de-duplicated an identical "`compact` did not mean
  the same thing on every composer surface" entry that a merge with a parallel push had
  introduced twice.
- **2026-09-17** — File created. Seeded with the four bugs fixed on 2026-09-16 (recorded in
  `docs/checkpoints/CURRENT.md`), the stale-ADR drift, and three mistakes from this session.
  Nothing retired yet.
- **2026-09-17** — Two entries added after the integration suite caught real defects in code
  written earlier the same day: a bare `SELECT max(...)` mistaken for a lock, and an API enum
  invented rather than traced to its consumer.
- **2026-09-17** — Two more from building the Docker stack, both found by running the image
  rather than building it. The stale-ADR entry is closed. **12 entries, 28 to the cap.**
  Wired into context by a SessionStart hook, which was this file's own open caveat.
- **2026-09-17** — Three entries from the first production deploy: a VPC with no NAT that made
  a "healthy" service unable to reach anything, a `--set-env-vars` call that clobbered
  production config and compounded across a second "safe" update, and the frontend pointed at
  the Cloud Run URL directly, silently breaking the `SameSite=Lax` session cookie. All three
  were found by testing the deployed service itself, not by any local check. **17 entries, 23
  to the cap.**
- **2026-09-17** — Two more chasing a slow-chats-list report: the cookie-fix Worker proxying to
  a non-Cloudflare origin without Smart Placement, and a caught-before-shipping one — the
  latency fix's own remedy (Neon's pooled endpoint) would have broken prepared statements under
  load if `prepare: false` had not been added and verified against the full suite first. **19
  entries, 21 to the cap.**
- **2026-09-17** — One more closing out the same latency chase: Smart Placement didn't converge
  and Cloud Run's domain mapping doesn't support this region, so the Worker proxy was removed
  again and the cookie moved to `SameSite=None` as a stated, temporary trade-off rather than a
  fix. **20 entries, 20 to the cap** — halfway; worth a pruning pass soon.
- **2026-09-17** — One more found by actually opening the site in a browser and sending a
  message, not just curling individual endpoints: the SSE generate route had no CORS headers
  at all, invisible for the entire session until the cross-origin architecture change above
  made it a hard failure. **21 entries, 19 to the cap.**
- **2026-09-17** — One more from a live user report: sign out awaited a real cross-region round
  trip before clearing local state, so the UI sat frozen long enough to look broken. Found by
  reproducing in a real browser session against production, not by reading the code first.
  **22 entries, 18 to the cap.**
- **2026-09-18** — Two more: `docker start arcnave-pg` doesn't work in a Claude Code web/cloud
  sandbox (no Docker daemon; the native `postgresql-16` cluster is there instead), and a live
  production report — attaching an image returned "not found" for every model because
  `STORAGE_BACKEND=local` doesn't survive Cloud Run routing the upload and the later generate
  request to different instances. **24 entries, 16 to the cap.**
- **2026-09-18** — One more from a live user report: `.xlsx` uploads failed outright, from two
  compounding pre-existing gaps — no MIME fallback for browsers that send `octet-stream` for
  spreadsheets, and no text extractor for spreadsheets at all even when upload succeeded.
  **25 entries, 15 to the cap.**
- **2026-09-18** — Three more from a live user report of multi-second login and workspace load
  times, root-caused against real Cloud Run logs rather than the docs (which turned out to be
  right about Neon at the time, then immediately wrong once two in-flight deploy attempts to
  migrate to Cloud SQL were discovered mid-investigation): a `z.coerce.boolean()` query-string
  trap that made `/models` always live-probe regardless of what the frontend asked for, and two
  entries from actually completing that Cloud SQL cutover — `postgres.js` silently ignoring the
  `pg`-style `?host=` socket convention in two separate connection call sites, and a migration
  race under concurrent cold-start instances found only after the first fix was already live.
  **28 entries, 12 to the cap.**
- **2026-09-18** — One more, from a live user report of the deployed UI looking reverted: a
  Cloudflare Workers Build hooked to `main` with no visible path filter redeploys the whole
  frontend on any push, so a backend-only or docs-only commit can republish an older frontend
  if newer UI/UX work (being done in a parallel session/tool) hasn't landed on `main` yet.
  **29 entries, 11 to the cap.**
- **2026-09-18** — Four entries from building the file-handling parity work (ADR-0004, items
  1-8: spreadsheet/PowerPoint extraction, OCR, docx tables, audio/video transcription, page
  citations, Gemini code execution, and deterministic Markdown-to-Office export) and from
  preparing to deploy it, all caught by writing real tests against real generated files or by
  tracing an env-driven branch to what it actually imports, rather than trusting library docs
  or a hand-trace: `pdf-parse`'s concatenated `.text` masking a genuinely empty scanned page,
  two third-party `.d.ts` files that disagreed with their own runtime shape under this
  project's `NodeNext` + `verbatimModuleSyntax` config, a hand-written GFM table-separator
  regex that only looked correct until a second table exposed it, and a second, independent
  discovery that `@google-cloud/storage` was still an undeclared dependency in this session's
  own branch even after a parallel session had already fixed the same gap on `main` — found by
  merging the two together rather than deploying blind. **33 entries, 7 to the cap.**
- **2026-09-19** — One more, and the first from design work rather than from code: the items
  9-12 tool-use/skills plan was written from the captured vendor system prompts under `tools/`
  and asserted three capabilities that vendor documentation contradicts — a Gemini lazy-tool-
  loading API that does not exist, a tool-name ceiling attributed to the wrong provider, and a
  "we'll build our own skills system" choice that is actually a hard Vertex constraint. Caught
  by checking the docs *before* writing code, on the user's instruction, rather than after a
  failed deploy. **34 entries, 6 to the cap.**
- **2026-09-19** — One more, from actually running the live probe those doc checks called for:
  `@google/genai` normalises a tool's JSON Schema by mutating the caller's object (lowercase
  `type` → Vertex's uppercase proto enum), so the one shared `ToolDefinition` the items 9-12
  design is built on corrupted Claude's copy the moment both providers ran in one process. The
  good news from the same run: Vertex does accept custom `functionDeclarations` alongside
  `googleSearch` and `codeExecution` on `gemini-3.8-flash`, so the item-9 design is not blocked.
  **35 entries, 5 to the cap.**
- **2026-09-19** — One more from building the item 9 (revised) tool-calling framework: the
  Gemini adapter's tool loop checked `AbortSignal` only inside the chunk-consuming loop, missing
  an abort that fired between rounds while a tool was executing — caught by an adapter-loop test
  asserting the provider call count, not just that the loop eventually threw, and fixed
  proactively in the Anthropic adapter before it shipped the same way. **38 entries, 2 to the
  cap.**
- **2026-09-19** — One more starting item 9 phase 2 (`run_python`): the checkpoint named "Vertex
  AI Agent Engine's Code Execution service" but only a Python-SDK quickstart was on record, and
  the JS/TS SDK turned out to have no support for that resource at all. Caught before writing
  `VertexSandboxClient` by finding the actual REST reference pages instead of inferring the wire
  shape from the Python samples. **39 entries, 1 to the cap.**
- **2026-09-19** — One more, and the first from actually turning phase 1 on in production: right
  after enabling `ENABLE_TOOL_USE`, a live `search_project_files` call worked (tool ran, real
  data came back) but the model's follow-up turn always 400'd — Gemini requires a
  `thought_signature` echoed back on a replayed `functionCall` part, and the round loop's
  `chunk.functionCalls` getter silently drops that field (it lives on the sibling `Part`, not on
  `FunctionCall`). Also fixed in the same pass: `run()`'s catch block never logged the original
  error before mapping it to a generic code, which is why this took a redeploy with real logging
  added before the cause was visible at all. **40 entries, at the cap.**
- **2026-09-19** — Retired the oldest entry (`Drizzle wraps driver errors, so err.code is empty`)
  — fully covered by `isUniqueViolation()` plus its own regression test, per the pruning policy's
  first criterion. One more added from continuing the same live-verification pass: `run_python`
  hung for minutes on a real request with no error, because `RUN_PYTHON_TIMEOUT_MS` was only ever
  read as the sandbox's `ttl`, never actually wired as a client-side deadline on the
  create→poll→execute chain — turned back off in production (`ENABLE_RUN_PYTHON=false`)
  immediately rather than leaving a live hang for the next real user. **Fixed 2026-09-19**:
  `VertexSandboxClient.runPython` now starts its own `setTimeout`-driven `AbortController` scoped
  to `timeoutMs` (wired from `RUN_PYTHON_TIMEOUT_MS` via `withAdc`) and combines it with the
  caller's signal via `AbortSignal.any`, so the deadline fires even when nothing else aborts;
  verified with a fake-timers test that never waits in real time
  (`vertexSandboxClient.test.ts`). Still not re-verified against the real Preview API — do not
  flip `ENABLE_RUN_PYTHON` back on until that live check happens. **40 entries, at the cap —
  prune before the next entry.**
- **2026-09-19** — Retired one more (`An npm script pointed at a file that was never written`) —
  the file it warned about (`src/openapi.ts`) has existed and run cleanly for three sessions now;
  fully covered by the script itself succeeding every time it's invoked, per the pruning policy's
  first criterion. Added from a real local live test (real `GOOGLE_CLOUD_PROJECT` + ADC, not
  production) of the timeout fix above: the timeout fix worked — no hang, calls returned in
  seconds — but every `run_python` call still failed, with a `400 INVALID_ARGUMENT` from the
  `sandboxEnvironments:execute` endpoint the client calls. Root cause: that endpoint doesn't
  exist as documented — the real stateless entry point is `reasoningEngines.executeCode`, a
  different resource path entirely, not a sibling method on the sandbox. The "find the real REST
  reference" fix from the entry above this one was necessary but not sufficient — it found *a*
  reference page, not the *right* one. `ENABLE_RUN_PYTHON` stays `false`; `VertexSandboxClient`
  needs a rewrite against the correct endpoint before this can be revisited. **40 entries, at the
  cap — prune before the next entry.**
- **2026-09-19** — No new heading; extended the "Chased the 'proper' same-site fix" entry above
  with an addendum rather than adding a 41st: the same `SameSite=None`/no-`Secure`-locally
  combination that's a stated production trade-off also silently drops the session cookie for
  anyone testing the real UI against a local `npm run dev` backend — `curl` can't see this class
  of bug at all, which is why it went unnoticed until this session actually drove a browser
  against it (to verify the new tool-call UI below). Also rewrote `VertexSandboxClient` to call
  `reasoningEngines.executeCode` directly instead of the nonexistent `sandboxEnvironments:execute`
  — see that entry above; still broken one layer deeper (creation succeeds, `executeCode` itself
  still 400s), `ENABLE_RUN_PYTHON` stays `false`. Separately, added `toolCalls` to the message DTO
  (`GET /chats/:id`) and a live-verified frontend UI for `tool_use`/`tool_result` frames — the
  gap flagged repeatedly in `docs/checkpoints/CURRENT.md` since item 9 phase 1 shipped. **40
  entries, at the cap.**
- **2026-09-24** — No new heading (42 entries, over the cap). While tracing the tools pipeline, called
  `evaluateDeliverablePolicy` "dead" after grepping only `generation.ts`; `agentLoop.ts` calls it.
  Same lesson as "Tested against the concrete class": before calling code unused, grep the whole
  `src/` tree for every caller, not the file you happen to be reading.
- **2026-09-24** — No new heading (over the cap). Said "Phases 1 + 2 done → the bank-statement
  acceptance test passes" when the audit had already shown there is no row-extraction capability
  for scanned PDFs. The review caught it. Routing and attachment fixes only let the model
  *reach* tools; they create no capability. Before promising an end-to-end result, trace every
  step of it to code that exists: here, scanned PDF → rendered pages → rows → count. Verify: each
  step in an acceptance test names the file that does it.
- **2026-09-24** — No new heading (over the cap). G27: every prompt and every current attachment
  was sent to the provider twice, because `loadHistory` excluded only the assistant row and kept
  the user message being answered. The existing test ("passes prior turns to the provider as
  history") only checked that an earlier turn was *present*, never that the current one was
  *absent*, so it passed throughout. When testing what goes into a model request, assert what
  must not be there as well as what must, and count occurrences of anything that should appear
  exactly once. Verify: `officeTextOnce.integration.test.ts` counts the prompt and the attachment
  text in the Claude and Gemini wire, on the attaching turn, the next turn and a retry.
