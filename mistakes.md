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
- **Same class, 2026-09-24:** to force a final answer, a text note was appended to the
  function-response turn. Vertex rejected every such request with 400 "Requests ending with a
  model turn are not supported", and it happened only live, because the fake client accepts
  anything. **Never change the shape of a Gemini `contents` turn without a live probe.** Put
  per-round instructions in `systemInstruction`, and give any new request shape a fallback to
  the old one (`gemini.adapter-loop.test.ts`: the final round falls back on INVALID_ARGUMENT).

---

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

### 2026-09-24 — A phase passed locally on a warm process sandbox and failed on cold Cloud Run Jobs

- **Symptom:** Phase 3 table extraction passed every local test, then failed live on the real
  12-page statement. The normalise step reported "Skill script produced no result", the model
  spent its rounds on `run_python`, and Cloud Run cut the request at 240 s, so the UI showed
  "Response stopped".
- **Cause:** Locally the sandbox is a child process: it starts in milliseconds and its files
  are already on disk. In production each call is a fresh Cloud Run Job, with 20–40 s of
  start-up, staging and signed URLs. One extraction made 3–15 such calls, and a swallowed output
  upload failure (G22) lost the result file. The local suite exercised none of that.
- **Rule:** **Never close a feature on local tests alone when production runs it on a different
  engine.** Count the remote round trips a turn makes, multiply by that engine's real latency,
  and compare the total with the platform timeout before shipping. Trusted work now runs in the
  backend (ADR-0008), and every turn has its own deadline (`TURN_DEADLINE_MS`).
- **Verify:** `executionRuntime.trusted.test.ts` routes poppler and skill scripts to the trusted
  executor and `run_python` to the sandbox. `providerTimeout.integration.test.ts` checks that a turn
  over its deadline ends as `turn_deadline_exceeded`. Live: the same prompt on the real PDF
  finishes well inside the deadline.

### 2026-09-24 — A 4096-token output limit cut Gemini answers at a few hundred words, silently

- **Symptom:** After a correct extraction of the real statement, the answer stopped mid-line
  at "Account: 12". Asking for "the remaining output" stopped at the same kind of point. The UI
  showed an ordinary finished answer.
- **Cause:** Every user's `preferences.max_output_tokens` defaulted to 4096. Gemini 3.x counts
  its thinking tokens against `maxOutputTokens`, so thinking over ~325 rows used almost all of
  it. The stored finish reason (`MAX_TOKENS`) never reached the UI.
- **Rule:** **An output limit on a thinking model is a thinking-plus-answer budget; size it for
  both.** A finish reason of `MAX_TOKENS`/`max_tokens`/`tool_limit` is a cut-off answer and must
  be shown as one. Long row lists go in a file, not in chat.
- **Verify:** migration `0008` moves 4096 rows to 32000. `usage.integration.test.ts` checks the
  new default. `types.test.ts` `cutOffReason` checks the UI's cut-off detection.

### 2026-09-25 — Stop did nothing when it landed before the provider call began

- **Symptom:** After a change that only added two database reads before the provider call,
  `runResume`'s "stop still aborts a detached run" streamed the whole answer ("abc") and
  `stop` still returned `stopped: true`. It passed alone and failed after the file's earlier
  tests.
- **Cause:** The TTFT retry loop linked each attempt's controller to the turn's signal with
  `addEventListener('abort', …)`. A listener added after the signal has already aborted never
  fires. Before the change the Stop always arrived mid-stream; with more work before the call,
  it arrived first, and the attempt ran unaborted. `AgentLoop` and `webFetch` had the same shape.
- **Rule:** **Never link a controller to a signal with `addEventListener` alone.** Check
  `signal.aborted` first and abort at once, then add the listener.
- **Verify:** `grep -rn "addEventListener('abort'" backend/src` shows an `aborted` check just
  before each hit; `npx vitest run src/routes/runResume.integration.test.ts` passes.

### 2026-09-25 — A tool loop's usage was one request's, marked exact

- **Symptom:** Live: a PDF answer made 16 model requests (13 `run_python` calls), and the footer
  said "19,725 in · $0.0158", which is the size of one request.
- **Cause:** Inside one provider call, each tool round is a new request. Gemini's adapter
  overwrote `usage` each round; Anthropic's merged rounds with `Math.max`; generation's forced
  synthesis replaced the first request's usage. `AgentLoop` summed its steps from `EMPTY_USAGE`
  (`exact: false`), so every agent turn came out inexact. The tests scripted usage on the last
  round only, and so never saw it.
- **Rule:** **A turn's usage is `addRequestUsage` over every request it made.** One request
  missing a count makes the turn `exact: false` with zeros. Anything that needs the
  conversation's size (compaction) reads `lastRequest` / `context_tokens`, never the total.
- **Verify:** `npx vitest run src/providers/*.adapter-loop.test.ts` ("bills every round"), and
  `src/routes/longChat.integration.test.ts` ("reads the size of the last request").

### 2026-09-25 — A generated migration was stamped before the hand-written one, and would have been skipped

- **Symptom:** `drizzle-kit generate` wrote 0011 with `when: 1790354536272`. 0010 had been
  stamped by hand at `1790400000000`, which is later. Nothing failed locally, because a fresh
  test database applies every file.
- **Cause:** Drizzle's migrator applies a migration only when `created_at < folderMillis` for
  the last applied one. Production already had 0010, so 0011 would have been silently skipped.
  The same generate also added `CREATE TABLE analysis_*` for four `schema.ts` tables that no
  migration ever created. Nothing reachable used them, so they were removed with their dead
  service code.
- **Rule:** **After `drizzle-kit generate`, read the SQL and the journal.** Keep only the
  change you meant, and stamp `when` after the previous entry.
  Never regenerate a migration that has already run anywhere under the same stamp. The
  migrator records it as applied and skips the new SQL. That happened to 0012 in the local test
  database; `drop database arcnave_test` recovered it.
- **Verify:** `npx vitest run src/db/journal.test.ts` (stamp order, and every `schema.ts`
  table in the latest snapshot); `npx drizzle-kit generate` says "No schema changes".

### 2026-09-25 — Follow-up turns redid the work, because the history kept only each turn's text

- **Symptom:** Live: after a turn that counted a statement's rows, "federal bank la evalo
  entries?" ran `load_skill`, `search_tools` and 10 `run_python` calls and read the PDF again.
  The system prompt said "unless it is already loaded in this generation/session".
- **Cause:** A history `Turn` was `{ role, text, attachments }`. Tool calls and results were
  stored in `tool_calls` and shown in the UI, but never sent to the model again. The prompt
  promised the model something the request did not contain.
- **Rule:** **Before a prompt tells the model that something is "already in context", check
  the captured request for it.** Earlier tool calls go into the history (`Turn.toolCalls`), and
  only compaction shortens it, not the loader.
- **Verify:** `npx vitest run src/routes/toolHistory.integration.test.ts`.

### 2026-09-25 — An opt-in API feature was made the default, and follow-ups lost their results

- **Symptom:** Live: after a two-PDF turn (1.1M input tokens over ~13 rounds), "federal la evlo
  entries and kvb la evlo entries?" re-ran OCR on the statement instead of answering from the
  counts the previous turn found.
- **Cause:** ADR-0022 cleared all but the last 3 tool results once a request passed 100,000
  tokens, the defaults of the API's `clear_tool_uses`. The docs say "Context editing is opt-in";
  the Claude app summarizes only "when your conversation approaches the context window limit".
  The last 3 results were the file step, so the counts went.
- **Rule:** **"Claude does X" needs the source that says Claude's app does it, not an API
  option's default.** A default is what happens after someone opts in, and is no evidence anyone
  does.
  The same mistake set compaction at 150,000 on a 1M window (the compaction beta's default);
  Claude Code compacts at about 967K (ADR-0027).
- **Verify:** `npx vitest run src/routes/toolHistory.integration.test.ts` (every result past
  100,000 tokens is replayed in full).

### 2026-09-26 — Our own first-token cutoff aborted large follow-ups that were still working

- **Symptom:** Live: the 3rd to 5th reply in a two-PDF chat failed with "The model took too
  long". Every attempt logged `First token wait exceeded 12000ms`.
- **Cause:** ArcNave cut off a request that had sent nothing for 12 s, then retried the same
  slow request. History PDFs travel as `pages`, which the media check missed. And Gemini sends
  nothing while it thinks, so a large request looked hung. Claude's SDK has no such cutoff: a
  request gets 10 minutes, and only failures are retried.
- **Rule:** **Do not treat "slow" as "failed".** Bound a request by a total timeout and retry
  only real failures (connection error, timeout, 408/409/429/5xx). A first draft scaled the
  cutoff by a guessed ms-per-token; a number with no measurement behind it is not a fix.
- **Verify:** `npx vitest run src/routes/providerTimeout.integration.test.ts` (a slow first
  event completes with one request).

### 2026-09-26 — The system prompt named tools the turn could not use

- **Symptom:** The audit found the prompt telling the model to call `get_goal`, to use the
  `research-deep-dive` skill with web search off, to search project files outside a project, and
  to "store" memories with no tool that stores one. While fixing it, two new lines named
  `run_python` in static text and were only caught by the test below.
- **Cause:** Guidance was written once, in static text, while the tools come and go per turn.
  Nothing compared the two.
- **Rule:** **Guidance that names a tool goes in only when the turn allows that tool.** Put it in
  the dynamic runtime context, gated on the turn's allowed tools, and list a skill only when its
  `requires.tools` are allowed.
- **Verify:** `npx vitest run src/routes/promptToolParity.integration.test.ts`.

### 2026-09-26 — A PDF was "converted" to Excel by splitting its extracted text

- **Symptom:** "Convert this PDF into Excel" produced a sheet cut on spaces and commas; the
  user's instructions were printed as a note, and a scanned PDF failed.
- **Cause:** The prompt told the model to pass only `sourceAttachmentId`, and the executor turned
  the PDF's text layer into rows with a delimiter heuristic. The pdf and xlsx skills already
  said not to do this; the prompt said the opposite.
- **Rule:** **A file conversion is built from what the model read, never from a heuristic on
  extracted text.** A tool that cannot do the conversion says so; it does not return something
  that looks like one.
- **Verify:** `npx vitest run src/tools/deliverableExecutor.test.ts`.

### 2026-09-26 — Gemini's thinking was left out of output tokens

- **Symptom:** A Gemini turn's cost counted only the answer's tokens.
- **Cause:** `usageFrom` read `candidatesTokenCount`, which excludes `thoughtsTokenCount`; Vertex
  prices "Text output (response and reasoning)" at one rate.
- **Rule:** **Read what the provider bills, not only what it shows.** Output is candidates plus
  thoughts; the context the next request resends is prompt plus answer.
- **Verify:** `npx vitest run src/providers/gemini.test.ts` (usageFrom).

### 2026-09-26 — Claude models' thinking was assumed off, when only its display was

- **Symptom:** ADR-0030 left the Claude adapter without a `thinking` setting, saying thinking was
  the user's choice in Claude's app. Claude answers in ArcNave showed no thought process.
- **Cause:** Claude 5 models think adaptively when `thinking` is omitted; what defaults off is the
  display (`"omitted"` returns empty thinking text). The app's own Help Center says thinking
  cannot be turned off on Opus 5 and later.
- **Rule:** **Check a model's defaults per model before deciding a feature is off.** Here that
  means `thinking: {type: "adaptive", display: "summarized"}` on Claude 5 models.
- **Verify:** `npx vitest run src/providers/anthropicVertex.adapter-loop.test.ts`.

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

- **2026-09-25** — Added the abort-listener entry. Retired "A decision changed and its ADR did
  not": its rule is in `CLAUDE.md` ("A decision is not changed until the document recording it
  is changed"), and the entry was closed on 2026-09-17 (pruning criterion 2). **40 entries.**
- **2026-09-24** — Added the output-limit entry. Retired the Gemini `thoughtSignature` entry:
  `gemini.adapter-loop.test.ts` fails if that regresses (pruning criterion 1). **40 entries.**
- **2026-09-24** — Added the local-vs-Cloud-Run phase entry, from Phase 3's live failure.
  Retired "`run_python` had no real timeout…": `VertexSandboxClient`, the class it is about,
  no longer exists, and the Cloud Run client has its own orchestration deadline. **40 entries.**
- **2026-09-24** — Added the first-token-timer entry. Found by the user's local live run on
  the real scanned statement. Retired three entries whose subject no longer exists: the Neon
  pooled-endpoint entry (production moved to Cloud SQL on 2026-09-18), and the two Vertex
  Agent Engine sandbox REST entries (the sandbox is Cloud Run Jobs and `VertexSandboxClient`
  is gone). **40 entries.**
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
- **2026-09-24** — No new heading (over the cap). Stored table extractions under a key I made up
  (`extractions/<user>/<id>.json`); `ObjectStorage` rejects any key not in `generateStorageKey`'s
  shape (`SAFE_KEY` in `services/storage.ts`), so every extraction failed with "Invalid storage
  key". The end-to-end test caught it on its first run; a unit test with a mocked store would
  not have. Before writing to a shared store, read its key validator, not just its interface.
  Verify: `tableExtraction.integration.test.ts` runs against the real `LocalObjectStorage`.
- **2026-09-24** — No new heading (over the cap). Phase 3 shipped with silent-ish caps on the
  exact path: 500 rows in the extraction result, 300 row refs per analysis, 2000 classify rows.
  Each carried a note, but an "every transaction" answer built from a cut list is still wrong.
  Rule: on an exact/exhaustive path, bound size by chunking the input (pages per call), never by
  cutting the output. Verify: `tableExtractionExecutor.test.ts` returns all 1200 rows.
- **2026-09-24** — No new heading (over the cap). Phase 3 rendered pages at a fixed 150 dpi PNG,
  tested only on letter-size fixtures. The real scanned statement has 1413 x 2000 pt pages
  holding ~75 ppi photos: 150 dpi meant 2944 x 4167 px up-sampled PNGs, ~18 s per page, 3.5 min
  for 12 pages, far past the sandbox's 10 s code timeout, so the live run would have died at
  render. Rule: size renders in pixels, not dpi, and encode as JPEG; test on the real document's
  page size before calling a pipeline done. Verify: `pdfinfo` page size + a timed render of the
  real file; the first pass now takes ~0.7 s for all 12 pages.
- **2026-09-24**: No new heading (over the cap). The KVB turn failed live four times, and I shipped
  four fixes, each aimed at a symptom: token limit, round limit, forced answer, and a 400 that
  the third fix caused. I judged tool calls by their "Done" labels. I never read the tool
  inputs and outputs. The actual causes were in those payloads. The sandbox left out inputs
  over 2 MiB without an error, so the PDF never arrived and the model got "file not found"
  even though its `input_files` argument was correct. Every call was a cold, stateless Job. The
  analyzer used column indexes that shifted on page 3. Rule: before fixing a failed agent turn,
  read every tool call's full input and output, and the transport code between them. A "Done"
  label proves only that no exception was thrown. Verify: the audit
  (`phase3-root-cause-audit-2026-09-24.md`) cites payloads; the transport fix has a test that
  a 4.7 MB input is refused, never dropped (`warmSandboxClient.test.ts`).
- **2026-09-25**: No new heading (over the cap). Warm-sandbox turns still produced wrong counts,
  for three reasons, all in the model's instructions and none in the tools:
  - The pdf skill pointed exact work at `extract_scanned_table_rows`/`analyze_table_rows`,
    which have known column-index defects.
  - The skill was never loaded. The only trigger was a general system-prompt rule, and the
    model reads `run_python` as "computation", not "PDF work".
  - Files reached the sandbox only when the model passed their UUIDs.
  The model fell back to tesseract on phone photos and answered without verifying. Rules:
  1. Put the path and the skill hint on the file's own manifest line, where the model looks.
  2. Make every conversation file present in the sandbox, as Claude's container does.
  3. When a tool's defects are found, update the skill that recommends it in the same change.
  Verify: `attachmentContinuity.integration.test.ts` reads two files with no `input_files`;
  `manifest.test.ts`.
- **2026-09-25 (later)**: No new heading (over the cap). Two lessons from the stage 1 decode
  against Claude.
  - **Comparisons stated from memory were wrong three times in one reply.** The claims were
    that Claude does not extract text (it does, for every non-PDF document), that the warm
    sandbox expires after 5 minutes idle (the code says `WORKSPACE_TTL_S` = 3 hours), and that
    .doc/.ppt are accepted (`ALLOWED` rejects both). Rule: a comparison table cites the file,
    or the doc page, for every cell. Verify: ADR-0011's table links Claude's support article
    and names `FILE_LIMITS`.
  - **`drizzle-kit generate` also emitted the never-migrated `analysis_*` tables** into a
    one-column migration. Shipped as generated, that would have created those tables in
    production without anyone deciding to. Rule: read every generated migration. When it
    carries unrelated drift, hand-write the SQL, and base the snapshot on the previous one
    plus your change only. Verify: `drizzle/0009_*.sql` is one `ALTER TABLE`;
    `grep -c analysis drizzle/meta/0009_snapshot.json` is 0.
- **2026-09-25 (memory)**: No new heading (over the cap). I set an upload extraction limit of
  100 MB without measuring it. Measurements showed the in-process parsers peak at 90–370× the
  file's size: a 44 MB .xlsx reached 3.8 GB and a 4.5 MB .docx 1.65 GB, on a 4 GiB instance.
  The guessed limit would have let one upload kill the backend for every user. Rule: every
  resource limit comes from a measurement on the real code path, and the measurement is
  written next to the constant. Verify: `EXTRACTION_MEMORY_PER_BYTE` in `processUpload.ts`
  cites the files it was measured on; `processUpload.test.ts` pins the derived limits.
- **2026-09-25 (shared keys)**: No new heading (over the cap). `POST /files/cleanup` deleted the
  stored object of every stale attachment, including those picked from a project, whose
  `storageKey` is the project file's own. Cleaning up an unsent pick would have destroyed the
  project file. `DELETE /files/:id` already had the guard; the bulk path did not. Rule: every
  path that deletes stored bytes checks `projectFileId`, and each such path has a test that
  fails without the check. Verify: `retention.integration.test.ts`, "leaves the project's
  bytes alone". Seen failing with the guard removed.
- **2026-09-25 (overflow retry)**: No new heading (over the cap). On a context overflow the
  retry halves the history, then "made it start with a user turn" by walking *forward*. For a
  chat with one earlier exchange that kept only the assistant reply: the question and its PDF
  were dropped, and the history opened with an assistant turn. The existing test copied the
  retry loop into the test file and tested the copy, so it never saw the real path. Also, the
  retry only counted `base64` as droppable, not ADR-0013's `pages`. Rule: test a recovery path
  through the real service (FakeProvider `onRequest` can throw once), not a copy of it. Verify:
  `files.integration.test.ts`, "when the context overflows…", and the single-exchange case in
  `batch6OverflowStreamingSafety.test.ts`. Both seen failing without the fix.
- **2026-09-25 (disk cap)**: No new heading (over the cap). I gave the user a Cloud Run command
  for a 30 GiB ephemeral disk. A search result I had read said "10 GB of total space by
  default", and I did not follow it up. The deploy was refused ("cannot exceed 10 GiB"). I also
  first sized 5 × 2 GiB for a 10 GiB ext4 disk, forgetting ext4's ~5% root reserve, which
  the non-root workspace uids cannot use. Rule: every limit quoted in a source is checked
  against the plan before a command is handed over. Size partitions of a filesystem from its
  usable space. Verify: runbook step 7 uses 10Gi and 5 × 1.8 GiB.
- **2026-09-25 (unread limit)**: No new heading (over the cap). I gave the user a command for a
  30 GiB Cloud Run ephemeral disk. The search result I had in hand said "10 GB of total space by
  default", and Cloud Run refused with "cannot exceed 10 GiB". Rule: before handing over an
  infrastructure command, check each size and count in it against the limit the source states,
  and quote that limit next to the command. Verify: ADR-0014 and runbook step 7 state 10 GiB.
- **2026-09-25 (storage keys)**: No new heading (over the cap). I named checkpoint objects
  `sandbox-state/<ws>/...` before reading `SAFE_KEY` in `storage.ts`, which accepts only
  `generateStorageKey` output; every put would have thrown `storage_error`. Caught before running,
  by reading the validator. Rule: a new kind of stored object gets its key from
  `generateStorageKey`, and its location from a database column, never from a path scheme.
  Verify: `workspaceState.integration.test.ts` stores and restores through LocalObjectStorage,
  which applies the same key check.
- **2026-09-25 (spec is not serving)**: No new heading (over the cap). The ephemeral-disk update
  was taken as done because `services describe` showed the volume. Every revision with the disk
  failed its startup probe, and the old revision kept serving for hours. The spec records what
  was asked for, not what runs. Rule: a Cloud Run change is live only when `status.traffic` names
  the new revision; check that, then a behaviour probe. Verify: runbook step 7's verification
  starts with `status.traffic`.
- **2026-09-26** — Added three entries from the Claude-parity fix pass (prompt naming unusable
  tools, PDF "conversion" by splitting text, Gemini thinking left out of output tokens) and
  extended the opt-in-default entry with the 150,000 compaction trigger. Retired three to stay
  at 40: the first-token timer recorded as Stop (the timer is gone, ADR-0024), Cloud Run Jobs'
  missing concurrency field (a platform fact, recorded in its ADR), and the `compact` composer
  surfaces (fixed and covered by tests).
- **2026-09-26** — Added the Claude-thinking-display entry; retired the third-party `.d.ts` entry
  to stay at 40 (a one-off typing workaround, recorded in the code it concerns).
