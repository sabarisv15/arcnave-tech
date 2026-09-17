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

### 2026-09-16 — Drizzle wraps driver errors, so `err.code` is empty

- **Symptom:** Registering with an email already in use returned `internal_error` instead of
  `email_taken`. The unique index was doing its job; the handler could not tell.
- **Cause:** Drizzle wraps the underlying `postgres` error. The SQLSTATE lives on `err.cause`,
  sometimes nested more than one level deep — never on the top-level `err.code`.
- **Rule:** **Never read a driver error code off the thrown object directly.** Walk the cause
  chain (`isUniqueViolation()` in [`src/services/auth.ts`](backend/src/services/auth.ts)).
- **Verify:** Register the same email twice; the second must be `409 email_taken`.

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

### 2026-09-17 — An npm script pointed at a file that was never written

- **Symptom:** `npm run openapi` failed: `src/openapi.ts` did not exist. It had been in
  `package.json` since the first backend commit.
- **Cause:** The script was added while scaffolding, in anticipation of the file. Nothing runs
  scripts in CI, so nothing noticed for two commits.
- **Rule:** **Never add an npm script before the thing it runs.** A script in `package.json` is
  a promise that it works.
- **Verify:** Every entry in `scripts` runs to completion, or is removed.
- **Fixed:** [`backend/src/openapi.ts`](backend/src/openapi.ts) now exists and emits
  `docs/openapi.json`. It doubles as a database-free check that all 38 routes register.

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

### 2026-09-17 — A comment asserted a guarantee the code did not provide

- **Symptom:** Two concurrent `POST /artifacts/:id/versions` returned `[500, 201]`. The 500 was
  a unique-index violation on `(artifact_id, version)`.
- **Cause:** The handler took the next version from `max(version) + 1` inside a transaction, and
  a comment claimed that was why concurrent writers could not collide. It is not. Under READ
  COMMITTED an aggregate takes no lock — both transactions read the same max, both insert it.
  The fix was a `FOR UPDATE` on the parent artifact row, which is the pattern the usage counters
  already used three files away.
- **Rule:** **A transaction is not a lock.** Serialising writers requires `FOR UPDATE`, a unique
  constraint plus a retry, or `SERIALIZABLE` — never a bare `SELECT max(...)`. And **never let a
  comment state a guarantee without a test that fails when it stops holding.** The comment here
  was the most confident sentence in the file and it was wrong.
- **Verify:** `src/routes/artifacts.integration.test.ts` fires two appends with `Promise.all`
  and requires `[201, 201]` with history `[3,2,1]`.

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

---

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
