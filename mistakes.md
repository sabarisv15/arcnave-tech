# mistakes.md

- **2026-09-27 (chat sync; existing 40-entry cap)** — A successful stash save can still
  fail cleanup on Windows. Verify saved trees before restoring tracked files; retain the stash.
  PowerShell text pipelines rewrite patch line endings: use Git's native `--output` for patches.
  JavaScript replacement strings interpret dollar sequences: use replacement callbacks for
  arbitrary source text. Node 26 experimental webstorage breaks this project's jsdom setup;
  use the declared Node 22 runtime (or disable experimental webstorage for frontend checks).
  Isolate validation databases when migration histories differ. Python-backed tests require
  the configured `python` executable, not only `python3`. Parse Markdown front matter after
  normalizing CRLF so Windows checkouts validate the same content as Linux.

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
- **Verify:** migration `0008` moves 4096 rows to 32000, and `0015` moves 32000 rows to 64000
  (Claude's docs: 64,000 for agentic work), capped at the model's own maximum
  (`capabilitiesTable` `maxOutputTokens`). `usage.integration.test.ts` checks the default.
  `types.test.ts` `cutOffReason` checks the UI's cut-off detection.

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

### 2026-09-26 — Gemini's usage was mapped to Claude's fields without reading their meaning

- **Symptom:** A Gemini turn's cost counted only the answer's tokens. After that was fixed, the
  user saw costs that were still wrong: cached prompt tokens were charged twice.
- **Cause:** Two fields mean different things than the Claude ones they were copied into:
  - `candidatesTokenCount` excludes `thoughtsTokenCount`; Vertex prices "Text output
    (response and reasoning)" at one rate.
  - `promptTokenCount` "also includes the number of tokens in the cached content" (SDK
    `UsageMetadata`), while Claude's `input_tokens` excludes cache reads. Cached tokens were
    priced at the input rate and again at the cache-read rate. gpt-oss's `prompt_tokens`
    includes `cached_tokens` the same way.
- **Rule:** **Read what the provider bills, not only what it shows, and read each usage field's
  definition before mapping it.** `inputTokens` is the uncached part; output is candidates plus
  thoughts; the context the next request resends is the whole prompt plus the answer.
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

### 2026-09-26 — A React updater read a variable the loop had already changed

- **Symptom:** In production, some replies stayed on "Sending request" for the whole turn (up to
  700 s) while the tools ran and the answer was saved. I blamed the network (the request was
  logged as HTTP/1.1) and asked the user for DevTools screenshots.
- **Cause:** A local repro was set up: backend and frontend on different origins, a slow fake
  model, and Playwright. It showed every frame reaching the browser on time; the state was the
  fault. The `start` handler wrote
  `setMessages((all) => … m.id === assistantId …)` and then `assistantId = realId`. React runs an
  updater later when the fiber already has work queued, so it compared against the real id,
  renamed nothing, and every later patch addressed a row that did not exist.
- **Rule:** **An updater passed to setState must not read a variable the caller reassigns
  afterwards; copy the value into a const first.** Before blaming the network, reproduce locally
  in a real browser: it takes minutes, and it separates transport from state.
- **Verify:** `types.test.ts` (`adoptServerId`). The Playwright repro recipe is in
  `docs/checkpoints/CURRENT.md`; 7 of 7 messages start within 0.8 s, where 2 of 3 had stuck
  before the fix.

### 2026-09-26 — Scaffolding built for a weaker model made a strong one over-work

- **Symptom:** "statement elam consolidate paniru" on a 25-page statement ran more than 10
  minutes and hit the 16-round tool limit (the Continue button appeared). It built a 7-sheet
  Excel file nobody asked for. The model (Gemini 3.8 Flash) is within 0.3 points of Claude
  Opus 5 on DeepSWE.
- **Cause:** Layers added over earlier fixes, each reasonable alone:
  - keyword routing to a second pipeline, and keyword tool gates;
  - anti-laziness paragraphs;
  - a standing verification section;
  - a skill that required transcribing every record for any total;
  - thinking at HIGH on every round.

  Current models follow instructions precisely, so the layers stacked. Claude's guides say to
  remove exactly these. I also first "fixed" it by adding more rules from the user's test chats
  (reverted): that was fitting to test data, not following the reference.
- **Rule:** **Before adding a rule, check the reference for whether to remove one.** Take
  behaviour guidance from the vendor's published prompting guides and system prompts, cite the
  line, and measure with `evalScope` before and after. Do not write new rules from a handful
  of test chats.
- **Verify:** `behaviorEvaluation.test.ts` Eval 11b; `turnRouter.test.ts` (router takes no
  prompt); `evalScope.ts` against the deployed service. ADR-0032.

### 2026-09-27 — An inline frame's height was checked in its style, not on screen

- **Symptom:** WP-10 was reported as verified with "inline height 219px", but every inline
  visual showed only its first 150px. The user saw thin, cut-off graphics.
- **Cause:** The check read `iframe.style.height`, which the component had set correctly. The
  stylesheet's `flex: 1` on the same iframe made flex-basis win over `height`, so the browser
  laid it out at the iframe default of 150px.
- **Rule:** **A size is verified by the laid-out box (`offsetHeight`, a screenshot of the
  element), never by the style the code wrote.** jsdom has no layout, so this check belongs in
  the real-browser pass.
- **Verify:** In Chromium against the local stack, `.ui-visual iframe` has `offsetHeight`
  equal to the height its document reports (571 for 571 in the ADR-0036 check).

### 2026-09-27 — A correlated subquery in a select list compared a column with itself

- **Symptom:** Every chat's `lastSeq` came back as -1, so no prompt had versions, though the
  chats plainly had messages.
- **Cause:** Inside `db.select({ ... })`, drizzle renders a `${table.column}` in a `sql` field
  unqualified (`"id"`, not `"chats"."id"`). In `(select max(seq) from messages where chat_id =
  ${chats.id})`, the bare `"id"` resolved to the inner table's own `messages.id`. The same
  interpolation in a `where` clause is qualified, which is why it looked safe.
- **Rule:** **In a `sql` expression used as a select field, never interpolate a column of the
  outer query into a subquery.** Alias the inner table and write the outer column out in full
  (`"chats"."id"`).
- **Verify:** `chatVersions.integration.test.ts` fails when the subquery compares the wrong id.

### 2026-09-28 — A forced answer was told to use results its request did not carry

- **Symptom:** Live (turn 531d000c): a 26-call loop ended at the tool-step limit with no text.
  The answer came from one more request "based on the previous tool results above", took 86 s,
  and the message was saved as `stop`, so no Continue button showed.
- **Cause:** The loop's calls and results live only in the adapter's own request. The forced
  request was built from the turn's `request` (history plus prompt), so it carried none of them
  and the model re-derived the answer from the page images. Then `finishReason = event.finishReason`
  replaced `tool_limit`. Separately, the Claude adapter's last round dropped every tool, and a
  turn with only the search tool has one round, which is also the last.
- **Rule:** **A request that tells the model to use something must carry it.** When a follow-up
  request is built outside the adapter's loop, put the loop's results into it, and never let a
  later request's status overwrite a limit the turn already hit. Switch tools off with the
  provider's own control (`tool_choice: none`, Gemini `NONE`), not by removing them.
- **Verify:** `npx vitest run src/routes/toolLimit.integration.test.ts
  src/providers/anthropicVertex.adapter-loop.test.ts src/providers/gemini.adapter-loop.test.ts`.

### 2026-09-28 — A tool description invited the work the prompt said to skip

- **Symptom:** Live (turn 531d000c): with a scanned PDF already in view as 12 page images, the
  model ran `fitz`, `pytesseract` and `cv2` 26 times. The prompt said counting what it can see
  needs no tool. With "without using tesseract or any tools" it counted correctly in one request.
- **Cause:** Three texts pulled the other way. `bash_tool`'s description listed "opencv and
  pytesseract"; the attachment list said only that the file was on the computer, not that the
  model could already see it; and the prompt said converting or producing a file from an upload
  "does" need the computer. Tool descriptions are prompt too, and they sit next to the decision.
- **Rule:** **Audit tool descriptions and the attachment list with the prompt, as one text.** A
  capability list in a tool description is an invitation; put libraries in the skill that uses
  them. Tell the model on each file's line whether it already sees the content.
- **Verify:** `npx vitest run src/services/attachments/manifest.test.ts
  src/test/behaviorEvaluation.test.ts`; live, the same question on the same PDF makes no OCR call.

- **2026-10-14 (brand foundation G0, frontend)** — No new heading (at the cap). Two found
  before shipping. (1) The brand boards name their variables `--bg`, `--surface`, `--hover`,
  `--muted`, `--line`: the same names `styles.css` already uses with other values, so pasting the
  boards' tokens would have silently recoloured every old rule. Rule: brand tokens carry a prefix
  (`--color-*`) and the old variables are aliased to them in one place. Verify: `brand.test.tsx`
  "defines the core light tokens". (2) The generator that copied the AI-state CSS out of the board
  dropped the resting-state rules, because a filter meant to remove two unlocked variants matched
  their shared lines; the marks would have shown tools at full size at rest. Rule: after
  generating CSS from a design file, diff the selector list against the source, not only the
  keyframes. Verify: `logo.css` carries `.w-qin,.s-lin,...{transform:scale(0)}`.

- **2026-10-14 (app shell G1, frontend)** — No new heading (at the cap). The K3 composer edge
  rendered darker than the board in Chromium although `tokens.css` set `--composer-edge` on
  `:root`: `styles.css` already sets a `--composer-edge` on `.composer` itself, and a custom
  property set on the element beats the `:root` one for every `var()` there. jsdom tests could
  not see it; the computed `border-top-color` in a real browser did. Rule: before adding a global
  custom property, grep every stylesheet for that name being set on any selector, and prefix new
  tokens by component and variant (`--composer-k3-*`). Verify: `grep -n -- "--composer-k3-"
  arcnave-frontend/src/styles.css` is empty; in Chromium the composer's computed border colour is
  `rgba(46, 139, 99, 0.38)` (light) / `rgba(111, 203, 157, 0.42)` (dark).

- **2026-10-14 (chat states + Settings G3, frontend)** — No new heading (at the cap). Three found
  before shipping. (1) Restyling `.dropdown` in the new stylesheet did not change the model menu's
  corners: `styles.css` had a later, more specific `.dropdown[aria-label="Model selection"]
  {border-radius:10px}`. jsdom cannot see it; the computed `border-radius` in Chromium did. Rule: before
  restyling a shared selector, grep every stylesheet for its attribute-qualified variants.
  Verify: `getComputedStyle(document.querySelector(".dropdown")).borderTopLeftRadius` is `22px`.
  (2) Moving "edit a message" into the bubble left the old composer prefill and `edit` state live, so a
  message typed in the composer while an edit was open would have been sent as that edit
  (`workspace.send` reads `edit`). Rule: when a flag selects behaviour in a shared function, every other
  caller must be blocked or reset while it is set. Verify: `ChatView.test.tsx` "the composer waits while a
  message is being edited". (3) The Tamil answer rule `.markdown:lang(ta)` in `shell.css` outranked the
  user's Conversation font (system, dyslexic) for Tamil only. Rule: a language rule needs the same
  `[data-font]` carve-outs as the base rule. Verify: `chat-states.css` has the two `:lang(ta)` overrides.

### 2026-10-15 — A background worker started by `createApp` made the database-free OpenAPI build hang

- **Symptom:** `npm run openapi` (documented as "a database-free smoke test") never exited after
  the file-job worker was added. No error; the process just stayed open.
- **Cause:** the worker was started from an `onReady` hook inside `createApp`. Its first pump ran
  a query, which opened the `postgres.js` pool; `app.close()` stopped the worker but nothing
  closed the pool, so the event loop stayed alive. Every caller of `createApp` (OpenAPI, tests,
  scripts) got a database worker it never asked for.
- **Rule:** **Never start a loop that touches the database from `createApp`.** Building the app
  must not reach the database; the process entry (`index.ts`) starts background work, and the
  test harness starts it explicitly. Also, when tests share one database, a background worker
  must not claim work another test app queued: with polling off it runs only the jobs it was
  handed (`FILE_WORKER_POLL_MS=0` in `harness.ts`).
- **Verify:** `cd backend && timeout 150 npx tsx src/openapi.ts` exits 0;
  `grep -n "files.start" src/app.ts` is empty, and `src/index.ts` / `src/test/harness.ts` each
  have one.

### 2026-10-15 — A UTF-16 CSV was read as MPEG audio by the content sniff

- **Symptom:** A UTF-16 LE CSV with a byte-order mark was refused at upload with "The content of
  this file does not match its name (.csv)". Found only when a test uploaded a real UTF-16 file.
- **Cause:** `detectKind` checked the MPEG frame sync (`0xFF` then three set bits) before the
  UTF-16 BOM check. `FF FE` is both, so the BOM never got its turn and the file was `media`.
- **Rule:** **In a magic-byte table, test exact multi-byte signatures (BOMs, `%PDF`, `PK`) before
  loose bit patterns, and run every text encoding a type promises through the sniff in a test.**
  Same class, same task: pdf-lib's saved fixture hid `/OpenAction` inside object streams, and the
  first strip removed references but left the script objects in the saved file; check the saved
  bytes, not the object graph.
- **Verify:** `npx vitest run src/services/attachments/ingestUnits.test.ts` (sniff: UTF-16 with
  and without a BOM) and `src/routes/fileSafety.integration.test.ts` (no `/JavaScript`, `/Launch`
  or `app.alert` left in the stored bytes).

### 2026-10-16 — Fastify accepted `trustProxy: 1` and then trusted no forwarded header at all

- **Symptom:** The brief and the audit both said "set `trustProxy` to the hop count". Fastify
  5.12.5 accepts `trustProxy: 1` without an error, and `request.ip` stays the proxy's address —
  every anonymous caller behind Cloud Run would have shared one rate-limit bucket while the
  setting looked fixed.
- **Cause:** a security hardening in the installed version makes a numeric `trustProxy` "fail
  closed" (`lib/request.js`); the `.d.ts` does not even list `number`. The advice described an
  older version.
- **Rule:** **Before setting a security option, read the installed library's implementation, not
  its docs, the audit or the brief, and pin the behaviour with a test.** Here: a hop function
  `(addr, hop) => hop < N`, never a number.
- **Verify:** `npx vitest run src/plugins/security.test.ts` ("a plain number would trust nothing
  in this Fastify version").

### 2026-10-16 — An SDK default was read from a type comment, not from the code that consumes it

- **Symptom:** `@google/genai`'s `HttpRetryOptions.attempts` says "If not specified, default to 5",
  so the audit read the client as retrying by default. In the 2.22 runtime there is no retry at
  all unless `retryOptions` is given — the comment describes the option object, not the client.
- **Cause:** a `.d.ts` comment documents a field's default once the field's parent exists; it
  says nothing about the client when the parent is absent.
- **Rule:** **Never state what an SDK does by default from its types. Read the `dist/` code path
  that consumes the option, and pin it with a stubbed-`fetch` test that counts requests.** Same
  task: deleting a feature's last reader leaves its settings dead (`configUsage.test.ts` fails) —
  delete the settings in the same change.
- **Verify:** `npx vitest run src/providers/gemini.gateway.test.ts src/providers/anthropic.gateway.test.ts`
  (one fetch with ours; three with `attempts: 3`).

### 2026-10-16 — nginx dropped the security headers on the two paths that serve the app

- **Symptom:** `nginx.conf` set nosniff / X-Frame-Options / Referrer-Policy at server level, yet
  `/assets/*` and `/index.html` answered without them.
- **Cause:** nginx does not inherit server-level `add_header` into a `location` that has any
  `add_header` of its own; both blocks set `Cache-Control`.
- **Rule:** **Never `add_header` inside a `location` in `nginx.conf`; route per-path values
  through a `map` and keep every `add_header` at server level.**
- **Verify:** `cd arcnave-frontend && npx vitest run src/securityHeaders.test.ts`;
  `grep -n "add_header" arcnave-frontend/nginx.conf` shows server-level lines only.

### 2026-10-16 — A security flag's effect was asserted before running the tool without it

- **Symptom:** the real-ffmpeg test had a "control" that ran a hostile playlist without
  `-protocol_whitelist` and expected the fetch to happen; it failed — ffmpeg 6.1 already limits a
  local playlist to `file,crypto,data`. Separately, a flag list shared by ffmpeg and ffprobe broke
  ffprobe, which rejects `-nostdin` ("Option not found").
- **Cause:** both flags were added from their documentation, not from running the binaries.
- **Rule:** **Before asserting what a security flag changes, run the tool without it and read
  what it does; record when the default already protects. Never share a flag list between two
  binaries without running each.**
- **Verify:** `npx vitest run src/services/attachments/untrustedTools.test.ts` ("argument order";
  "the whitelist stops a playlist from fetching a URL").

### 2026-10-16 — Worktree-isolated subagents started from `main`, not from the phase branch

- **Symptom:** three writer subagents launched with `isolation: "worktree"` got checkouts at
  `main` (`baca408`) although the session was on `build/gateway-security`; without a reset their
  work would have been built on a base missing two whole tasks.
- **Cause:** the agent worktree is cut from the repository's default branch, not from the
  calling session's `HEAD`.
- **Rule:** **Every worktree brief names the exact base commit and tells the worker to
  `git reset --hard <sha>` when its `git log -1` differs; main checks every worktree's head
  before trusting its first commit.**
- **Verify:** `for w in .claude/worktrees/*; do git -C $w log --oneline -1; done` shows the
  phase commit for every worker.

### 2026-10-16 — A fix for a security finding made the next finding

- **Symptom:** build-3's round-2 fixes, written under time pressure and never reviewed, created
  three of the six open MAJORs (web_fetch dropped page text after `</style >`, an EPUB with an
  ordinary SVG was refused, audio retried a 400). In tech-build.3-fix the same thing happened
  inside the review loop: round 1 narrowed the sandbox signing check to outputs only, to stop it
  refusing every run in a chat with files, and that reopened the silent loss of an input that
  `runner.py` drops when the Job's account cannot read the bucket; the new Claude title cut split
  an emoji's surrogate pair. Each was caught only by the next fresh review.
- **Cause:** a fix is new code on an attacker-reachable path, written with less context than the
  original and judged against the one finding it answers. Regex rewrites were "proved" on inputs
  that are not adversarial for them, and a narrowed fail-closed check was trusted on an unchecked
  claim (an IAM grant).
- **Rule:** **A fix for a security finding needs (a) a test that fails on the pre-fix code, run
  and recorded; (b) for any scan over untrusted input, an adversarial linear-time test sized to
  the real limit (5–8 MB, asserted under a fixed bound) on inputs that are quadratic for the old
  code; and (c) its own fresh review before the push, repeated on each fix round. Never narrow a
  fail-closed check on a claim nothing in the code verifies.**
- **Verify:** `docs/ops/build-3-fix-review.md` lists three rounds; `npx vitest run
  src/services/webFetch.cleaner.test.ts src/services/attachments/preflightPass.test.ts
  src/tools/sandbox/cloudRunSandboxClient.test.ts` ("linear on any page", "the DTD scan is linear",
  "a run with an input file fails with sandbox_misconfigured").

### 2026-10-16 — Worktree isolation created from a stale `main` commit (`882e8de`), twice

- **Symptom:** in tech-build.3-fix both writer worktrees (`isolation: "worktree"`) were created at
  `882e8de`, an old `main` merge, not at the branch tip `fce4a22` — the second time in one day
  (the entry above: `baca408`).
- **Cause:** the agent worktree is cut from a `main` commit, not from the session's `HEAD`, and the
  brief did not name the base, although the entry above says it must.
- **Rule:** **The brief must say: base = branch tip (`<sha>`), verify with `git merge-base <sha>
  HEAD` (it must print `<sha>`) and `git log -1` before any work; reset to it if not.**
- **Verify:** `git -C .claude/worktrees/<agent> merge-base <sha> HEAD` prints `<sha>` for every
  worker before main trusts its first commit.

### 2026-10-16 — Two branches took the same ADR number, and the next free number moved

- **Symptom:** `git merge origin/main` was clean for `docs/decisions/`, yet main's
  `0064-claude-platform-gemini-vertex.md` and the branch's `0064-gateway-history-and-retry-defects.md`
  both existed: two decisions with one number, and 25 files citing "ADR-0064" for different things.
- **Cause:** Both tasks read "last ADR is 0063" at start and each wrote 0064 on its own branch.
  Different file names, so git saw no conflict. The same applies to a migration number.
- **Rule:** **A merge with no conflict is not a merge with no collision.** After any merge, list
  `docs/decisions/` and `backend/drizzle/` for a repeated number prefix. The file already on `main`
  keeps its number; the branch's is renumbered and every reference moves with it.
- **Verify:** `ls docs/decisions | cut -d- -f1 | sort | uniq -d` prints nothing; same for
  `ls backend/drizzle/*.sql | sed 's#.*/##' | cut -d_ -f1 | sort | uniq -d`.

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

- **2026-10-16 (tech-build.3)** — Added five entries (trustProxy number, SDK default from types,
  nginx `add_header`, security flag effect, worktree base). Retired the five oldest, by the
  owner's rule for this task ("cap 40, prune oldest"): "A failure *before* the stream opened left
  a row spinning forever" (still covered by `chats.integration.test.ts`, which asserts no row
  stays `generating`), "Test expectations asserted from memory", "Tested against the concrete
  class", "Invented an enum" (now the `CLAUDE.md` rule "Never write a validator for a value you
  have not traced to its consumer") and "A devDependency the production image asks for" (no CI
  check carries it: the image is built only by Cloud Build — keep `--omit=dev` in mind when adding
  a runtime import). Not new headings: the code review found a regenerate bug in code
  that Part C had moved verbatim — a characterization snapshot pins the bugs it captures too, so
  review moved code for its behaviour, not only for its diff. And the first characterization run passed once and failed on the second: a message with ten files is read with no `ORDER BY`. Run a new snapshot test at least twice before committing it; a value it cannot reproduce is a finding (DEFERRED), not something to normalise away. **40 entries.**

- **2026-10-15 (tech-build.2, files ingest)** — Added the sniff-order entry. Retired
  "`@google-cloud/storage` was never a declared dependency": it is declared and imported in the
  image, and the broader rule lives in "A devDependency the production image asks for" (pruning
  criterion 3). Not new headings: (1) a chunk-overlap test asserted `<` where the first chunk's
  last line is also the next chunk's first: the 2026-09-17 rule (derive, do not hand-compute)
  again. (2) officeparser's Markdown opens with YAML front matter carrying the document author's
  name; it went into extracted text until the DOCX derivative dropped it. Rule: read a parser's
  whole output on a real file before storing it as "text". (3) Tests that hit per-chat or
  per-message limits (N-10: 10 per message, 20 per chat) failed for the limit, not the feature;
  read the limits before sizing a fixture. **40 entries.**

- **2026-10-15** — No new heading (at the cap). tech-audit.A: I briefed eight auditors that
  `06-eval-cases-v1.json` holds "87 cases" after counting `"id"` keys with grep; it is an array of
  68 cases, and 19 of the ids belong to nested documents. Two auditors caught it. Rule: count
  records by parsing the structure, never by grepping a key name. Verify:
  `node -e "console.log(require('./06-eval-cases-v1.json').length)"` (prints 68). Also repeated
  the 2026-09-27 lesson in a scratch script: a `$` inside a `String.replace` replacement mangled
  the file — use a replacement callback or a written script, never inline `$` text.
- **2026-09-29** — No new heading (at the cap). Writing the line-by-line Fable comparison, I keyed
  the first rows from a head-of-file print without line numbers and was two lines off for the
  whole product-information section; a script validator later also caught one ArcNave line cited
  by the wrong number. Both were found before delivery only because every row was checked by
  script. Rule: write line-keyed judgments only from a numbered print (`awk '{printf "%d| %s\n",
  NR, $0}'`), and check coverage and every quoted excerpt by script, never by eye. Also: the
  reference pack's code gap audit, one day old, was already stale on G5 (the last round now keeps
  its tools with `tool_choice: none`); re-read each claimed gap in code before repeating it.
  Verify: before handing over such a file, a script reports zero uncovered lines and zero
  excerpts that are not verbatim substrings of the line they cite.
- **2026-09-28 (later)** — No new heading (at the cap). The audit blamed "the Word skill repeats
  it ('Fix and save again when something is wrong')" for the rebuild loop. I fixed the docx skill
  and told the owner every conflict in the audit was fixed; the pdf, pptx and xlsx skills still
  carried the same sentence, found only on a line-by-line reread. Rule: when an audit quotes a
  sentence as a cause, grep every prompt, tool and skill file for that wording before calling it
  fixed. Verify: `grep -rn "save again" backend/skills` lists only lines checked against the
  reference skill's own check step (pptx: "re-render only the slides you changed, and stop").
- **2026-09-28** — Added the forced-answer and tool-description entries (ADR-0052). Retired
  "`pdf-parse`'s concatenated `.text` is never truly empty" (`retrieval.test.ts`, "fails with a
  typed reason rather than silently skipping OCR", fails if it regresses) and "A Gemini tool loop
  only checked `AbortSignal` mid-stream" (both adapter-loop tests assert the call count on abort):
  pruning criterion 1. Not an entry: `drizzle-kit generate` stamped 0024 before 0023 again, and
  the 2026-09-25 rule caught it (re-stamped by tag). Also not an entry: in this Windows shell a
  quoted heredoc still mangled backslash escapes in inline Python, and a `;` chain deleted a temp file after
  the step that needed it failed; write edit scripts to a file and chain with `&&`. **40 entries.**
- **2026-09-27** — No new heading (WP-12). I re-stamped a generated migration with
  `sed 's/"when": 17904[0-9]*/…/'`, and the pattern also matched 0010's stamp. The test
  database then tried to create 0010's table again. The rule from the 2026-09-25 entry stands:
  change a journal entry by its `tag`, never by a pattern on `when`. Fix it with a JSON edit
  keyed on the tag, then read `git diff` of the journal. Also, WP-09's own test picked "the
  user message" with `limit(1)` and no `orderBy`, and failed once the table was busier. A test
  that means "the first row" must order by the column that makes it first.
- **2026-09-27** — No new heading (WP-11). The plan named a PowerPoint renderer by reputation;
  `pptx-preview` rendered a fixture deck but drew an empty frame for the decks ArcNave itself
  generates, with no error. Rule: try a rendering library on this app's own output before
  building on it. The check was a Playwright page loading the library against `gen.pptx`.
- **2026-09-27** — Added the select-list subquery entry (WP-09). Retired "A legacy transcript
  field crashed the whole workspace": `types.test.ts` ("does not crash when a legacy transcript
  omits optional evidence arrays") fails if it regresses (pruning criterion 1). Also, not an
  entry: the frontend's `API_BASE` defaulted to the production API even under `vite` dev, so a
  local browser check silently talked to production; it now defaults to `/v1` in dev. **40 entries.**
- **2026-09-27** — No new heading (at the cap). Merging WP-03 to WP-07 into one branch, I
  resolved conflicts by keeping both sides. In `styles.css` that split one rule's body from its
  selector, and the build failed with "Unclosed block"; in `CURRENT.md` it duplicated entries.
  Rule: keeping both sides is only safe for whole, independent blocks. After any conflict
  resolution, run the build and read the merged region before committing. Also: WP-06 made
  `ask_user_options` a tool on every turn but ran only its own test files, so
  `tableExtraction.integration.test.ts` (which lists the exposed tools) failed until updated.
  Run the whole suite before calling a package done.
- **2026-09-27** — Added the frame-height entry. Retired "Returning early before useEffect
  broke the Rules of Hooks during fence streaming": `MarkdownStreaming.test.tsx` fails if it
  regresses (pruning criterion 1). **40 entries.**
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
- **2026-09-26** — Extended the Gemini usage entry with the cached-token double charge (also in
  gpt-oss) instead of adding a 41st.
- **2026-09-26** — No new heading (at the cap). Two slips while fixing the audit (ADR-0031):
  - A `cat > file <<EOF` scratch write replaced an existing test file (`turnTiming.test.ts`),
    caught only because `ls` had printed it. Rule: before writing a file from the shell, check
    it does not exist, or use the Write tool, which refuses an unread existing file. Verify:
    `git diff --stat` shows only intended files.
  - A skill description containing ": " broke its YAML frontmatter, and the loader dropped
    pdf, docx, pptx and xlsx. `skills.test.ts` ("none is dropped by its own frontmatter")
    caught it. Rule: quote a frontmatter description that has a colon in it.
- **2026-09-26** — Added the React updater entry (the "Sending request" hang). Retired the
  sign-out round-trip entry: the fix clears local state before the request, and nothing has
  touched that path since 2026-09-17. **40 entries.**
- **2026-09-26** — Added the scaffolding entry (ADR-0032). Retired the `preHandler`/`onRequest`
  entry: a Fastify lifecycle fact, fixed on 2026-09-16 and untouched since. **40 entries.**
- **2026-09-26** — No new heading (at the cap). The reply-language rule sat in the middle of the
  prompt, and Gemini answered a Latin-script Tanglish message in Tamil script. It was placed
  without reading the model's own guidance on where constraints go (Gemini 3: behavioural
  constraints at the top of the system instruction). Rule: when a model ignores a rule that is
  in the prompt, check its vendor's placement guidance before rewording or repeating it.
  Verify: Eval 11c, then a live Tanglish turn.
- **2026-09-26** — The language-rule placement note above is superseded: the user chose to
  remove the rule, as Claude's app prompt has none. The rule stays: read the vendor's own
  guidance before rewording a rule a model ignores.
- **2026-09-26** — Added the streaming hook violation entry (`CodeBlock.tsx` early return breaking
  Rules of Hooks during fence streaming, resolved by making `pre` a hookless dispatcher and adding
  `MarkdownErrorBoundary`). Retired the 2026-09-17 `.dockerignore` entry (Docker builds have been
  stable and verified by CI). **40 entries.**
- **2026-09-26 (WP-03)** — No new heading (at the 40-entry cap). Vite dev server defaults `API_BASE`
  to the Cloud Run URL when `VITE_API_BASE` is unset, bypassing local `VITE_API_PROXY`; set
  `VITE_API_BASE="/v1"` when testing against alternate backend ports. Fastify schema validation
  maps to typed `validation_error` (HTTP 422, not 400). Rule: always trace `API_BASE` in client
  config and assert HTTP 422 for schema rejections.

- **2026-09-26** — No new heading (at the cap). Two near-misses while building WP-10:
  - `npm run db:generate` stamped migration 0016 at the machine clock (1790445…), which is
    before the hand-stamped 0015 (1790900000000), so it would have been skipped. This repeats
    the 2026-09-25 entry. Re-stamped by hand; `journal.test.ts` passes.
  - Running `vite` locally without `VITE_API_BASE` sends every request to the production Cloud
    Run URL (the default in `api.ts`). A local browser check then logs in against production.
    Rule: start local dev with `VITE_API_BASE=/v1` so the Vite proxy reaches the local backend.
- **2026-09-26 (WP-04)** — No new heading (at the cap). Two issues found during implementation and live browser verification:
  - Parallel worktrees collided on `TEST_DATABASE_URL`: `D:\new` had already applied migration `0016` at timestamp `1791000000000` to `arcnave_test`, so Drizzle silently skipped running `D:\arcnave-wp04`'s `0016` migration on the same timestamp, failing on `signUp` with `column "effort" of relation "preferences" does not exist`. Rule: isolate test databases across concurrent worktree branches (`TEST_DATABASE_URL=..._wp04`).
  - `updatePreferences` in `workspace.tsx` was resetting `modelAlias` back to `"Auto"` whenever any preference was saved because `toDto` returned `modelAlias: AUTO_ALIAS`. Caught by the live browser acceptance test; fixed by preserving `patch.modelAlias ?? curr.modelAlias` in frontend state.
- **2026-09-26 (WP-05)** — No new heading (at the 40-entry cap). Two catches during WP-05:
  (1) `resolveStyle` and `GET /styles/:id` accept both preset keys (`concise`) and custom style
  UUIDs; querying a Postgres `uuid` column with an unknown non-UUID string throws 500 `22P02`
  unless guarded by a UUID regex before the query (`style_not_found` 404).
  (2) On Windows git worktrees, a directory junction for `node_modules` causes Vite/Vitest to
  resolve `vitest` to the target realpath outside the worktree root and bundle a second copy
  (`Vitest failed to find the runner`); use `npm ci --prefer-offline` per worktree instead.

- **2026-09-27 (PDF reading split)** — No new heading (at the 40-entry cap). Two catches:
  (1) A skill and a tool description gave opposite orders: the pdf skill said to use
  `extract_scanned_table_rows` only *without* run_python, the tool said to call it first because
  run_python cannot read a scanned page. Live, with run_python on, Gemini followed the skill, read
  pages by eye a few at a time, hit the 16-round limit, then answered 172 entries for 277. Rule:
  when a skill names a tool, read that tool's description and make them agree; `skills.test.ts`
  now fails if `pdf-reading` makes the scanned path depend on run_python being off.
  (2) In the cloud container, 22 PDF tests failed with no code change: `pdftoppm`/`pdftotext`
  were missing. Rule: `apt-get install -y poppler-utils` alongside `service postgresql start`
  before judging a PDF test failure; `which pdftoppm` verifies.
- **2026-09-27 (brand)** — No new heading (at the cap). Launch code described ArcNave by another
  assistant ("as Claude does", "Claude-style", claude.ai limits: ~70 comment lines, a skill line,
  and two user-facing error strings). ArcNave is its own brand; the reference assistant is a
  design input only. Rule: in launch files, state the behaviour and cite an ADR, never "as X
  does"; provider names only where the code talks to that provider. Verify:
  `src/test/brandNeutral.test.ts` fails on reference wording in launch files.
- **2026-09-27 (skills load race)** — No new heading (at the cap). `GET /v1/skills` failed
  about 1 run in 3 of the full suite, listing 12 of 13 skills (the last directory, `xlsx`,
  missing). Cause: `container.ts` fired `void skills.load()`, which cleared the map and filled
  it asynchronously, so a request (or a cold-start turn's `<available_skills>`) could see a
  partial registry; one more skill made the window wider. Rule: a registry read by requests is
  built into a new map and swapped in whole, and the app awaits it before taking requests
  (`createApp` → `skills.whenLoaded()`). Verify: `skills.test.ts` "never shows a half-loaded
  registry" fails without the fix; the full suite passed 3 runs in a row with it.
- **2026-09-27 (office files)** — No new heading (at the cap). The docx and pptx skills told the
  model the extracted text "is sufficient … answer directly", and every Office file went inline
  as flattened text, losing cell addresses, formulas and hidden sheets. The reference assistant
  reads those types from the file with code. Rule: a skill's claim about how a file reaches the
  model must match the pipeline; check `attachmentContent.ts` before writing one. Verify:
  `officeReadWithCode.integration.test.ts` (ADR-0045).
- **2026-09-27 (tool clean-up, ADR-0046)** — No new heading (at the cap). Rewriting the pdf
  skill to build files with code, I first named `reportlab` and `qpdf` because the reference's
  pdf skill uses them; the sandbox image (`sandbox/Dockerfile.service`) has neither, so the
  model would have been sent to libraries that are not there. The check only covered libraries
  listed in `skillContent.test.ts`. Rule: every library or CLI a skill names is checked against
  the sandbox image before it is written, and added to that test's `LIBRARIES` so a later
  mention fails when the image lacks it. Verify: `npx vitest run src/services/skillContent.test.ts`
  fails if a skill names `reportlab` or `qpdf`.
- **2026-09-27 (computer tools, ADR-0047)** — No new heading (at the cap). Three found here.
  (1) I told the user the reference has one memory tool (`memory_user_edits`, from the Sonnet 5
  capture); the newer Opus 5.5 and Fable 5.1 captures have six `memory_*` file tools. Rule: when
  captures differ, read the newest ones before stating the reference's tool list, and say which
  capture a claim comes from. (2) Python source written inside a TypeScript template literal:
  `'\n'` in TS becomes a real newline in the Python, a syntax error the typecheck cannot see.
  Rule: write `\\n`/`\\t` for Python escapes in a template literal, and run the program on the
  process engine in a test. Verify: `codeExecutionExecutor.test.ts` "view numbers a text file"
  fails without the double escape. (3) I gated the memory prompt on the router's allowed tools;
  the router does not know `ENABLE_TOOL_USE`, so with tool use off it still queried memory
  (13 chat tests failed with CONNECTION_ENDED). Rule: gate prompt text on the tools actually
  declared on the request. Verify: `chats.integration.test.ts` passes whole, not only one test.
- **2026-09-27 (merge claim)** — No new heading (at the cap). Before merging PR #32 I told the
  owner "backend is not deployed by this merge", from the Cloudflare entry alone; CURRENT.md
  also records that main's Cloud Build trigger deploys the backend. The session had no GCP
  credentials to check which happened. Rule: before a merge to main, read CURRENT.md for every
  trigger on main and name each one to the owner; say "unverified" when it cannot be checked.
- **2026-09-27 (artifacts, questions, visuals, cards; ADR-0048)** — No new heading (at the cap).
  Four found here. (1) Asked for a totals comparison, I told the owner ArcNave's three artifact
  tools, `render_ui` and `ask_user_options` "do the same job as the reference under another
  name", from memory; the capture says an artifact is a file written with `create_file`, and
  the Visualizer and question tool have different schemas. Rule: a "same job" claim is checked
  against the capture's schema for that tool, not its name. (2) The show_widget description
  first said sendPrompt "sends a message as if the person typed it", copied from the reference;
  in ArcNave a visual's prompt only fills the message box (ADR-0035). Rule: a tool description
  says what ArcNave does, checked in the client code. Verify: `grep -n sendPrompt
  backend/src/tools/definitions.ts`. (3) `npx prettier --write` on one file reformatted 40
  unrelated lines; the repo is not prettier-formatted. Rule: never run a formatter over a
  whole file here; `git diff --stat` before moving on. (4) lucide-react's UMD build reads React
  from `window.react` (lowercase), which no UMD React defines. Rule: run a CDN runtime in real
  Chromium before shipping it (jsDelivr is blocked in this sandbox: mirror the npm tarballs and
  serve them locally). Verify: the harness in ADR-0048's session showed n=2→3, 3 bars, the icon,
  and Tailwind padding; `displayCards.test.tsx` checks the loader's inputs.
- **2026-09-27 (prompt audit, ADR-0048)** — No new heading (at the cap). Two found by reading
  the assembled prompt against the declared tools. (1) `web_search` was declared beside the
  model's built-in search, which on Anthropic is a server tool also named `web_search`: a 400
  ("Tool names must be unique"). Without a live provider the same tool returned a placeholder
  link. Rule: a tool is declared only when something real answers it, and never under a name a
  provider already uses. Verify: `promptToolParity.integration.test.ts` "declares one web
  search". (2) I wrote into the prompt that web_fetch can open "a source cited in an earlier
  reply"; history does not carry source URLs, so it cannot. Rule: every capability sentence in
  the prompt is traced to the code path that makes it true before it is written.
- **2026-09-28 (line-by-line audit, ADR-0049)** — No new heading (at the cap). After ADR-0048's
  audit I told the owner the prompt, tools and skills had no conflict. A live scanned-PDF turn
  then ran seven commands on pages already in view: the prompt mapped "reading a PDF exactly" to
  pdf-reading, our own exact-figure rule sent counts to tools, and the skill said to check the
  text layer in code first. The audit had checked the prompt against the tools, never our own
  skills (rewritten earlier, so assumed right) against the reference's text, where pdf-reading
  is "especially when file content is NOT in your context". Rule: an audit against the reference
  reads every skill description and body beside the reference's, including the ones we wrote,
  and reads how the prompt and a skill combine on one real request; "no conflict" is said only
  after that. Verify: `skills.test.ts` "splits PDF reading from PDF building" and
  `behaviorEvaluation.test.ts` Eval 11b2.
- **2026-10-14 (tech-p1.A, rupee cost)** — No new heading (at the cap). Two near-misses while
  adding `usage_records.cost_inr` beside `cost_usd`. (1) My first aggregate was a plain
  `sum(cost_inr)`; every row written before the column existed has a USD price and a NULL rupee
  figure, so the rupee total silently understated spend beside a USD total that included those
  rows. Rule: a new nullable column summed beside an old one needs a guard for rows that
  predate it (null the total, never skip the rows), and is not back-filled with today's rate.
  Verify: `usage.integration.test.ts` "does not sum rupees over rows that have a USD price but
  no rupee figure". (2) The worktree was cut from `main`, not from `phase1/core-turn`, so
  `numbers.ts`, the register and 0024 were missing; `git log` and `ls drizzle` before the first
  edit caught it, and `git merge --ff-only phase1/core-turn` fixed it. Rule: check the base
  branch's tip before reading the brief's file list as fact.
- **2026-10-14 (tech-p1.G2, sign-in screens)** — No new heading (at the cap). `styles.css` has
  bare element rules (`button:hover { background }`, `button:disabled { opacity: .45 }`,
  `input:focus-visible { outline }`) that out-rank any single-class rule in a new stylesheet, so
  text-style buttons would have grown a grey hover box and disabled primaries would have been
  dimmed twice. Rule: when styling controls in a new CSS file, read the element rules in
  `styles.css` first and state `:hover`, `:disabled` and `:focus-visible` explicitly, with
  enough specificity to win. Verify: `grep -n "^button" arcnave-frontend/src/styles.css` before
  writing the file. Also: a test that asserts "no mailto link" must scope the query to the
  element under test (the page footer has a Help mailto), or it fails for the wrong reason.
- **2026-10-14 (tech-p1.G4, app surfaces)** — No new heading (at the cap). (1) `ChartBlock.tsx`,
  `.ui-chart-*` and the other generative-ui CSS styled themselves with `var(--card, #fff)`,
  `var(--border, #e2e8f0)`, `var(--foreground)`, `var(--muted-foreground)`: shadcn names that no
  stylesheet here defines, so every one fell back to its literal hex and dark mode never reached
  them. Nothing failed; the colours were just never ours. Rule: never reference a CSS variable
  without checking that a stylesheet defines it (a fallback hides the miss). Verify:
  `grep -rn -- "--card:" src` returns a definition before any `var(--card` is trusted. Only the chart
  classes are fixed; ADR-0057 lists the rest. (2) A test that split `tokens.css` at the first
  `:root[data-theme="dark"]` hit the sentence in the file's header comment, not the rule, and read
  every light value as missing. Rule: cut a stylesheet at the rule (`"\n:root[data-theme=\"dark\"] {"`),
  never at a selector string that a comment may also contain. (3) A series-colour check that reads
  `style.fill` proves what the code wrote; the frame's own computed fill
  (`getComputedStyle(rect).fill` inside the iframe) proved `--c1` was brand green.
- **2026-10-14 (tech-p1 lead, parallel agents)** — No new heading (at the cap). Four from running
  the phase as one lead plus worktree agents. (1) Every isolated worktree was cut from `main`, not
  from the working branch; the first agent wrote its prompt-kit assertions against the pre-ADR-0052
  prompt and had to redo them. Rule: an agent's first command is `git reset --hard <working branch>`,
  and its report names the base hash; check it before merging. (2) `git add -A` after agents ran
  committed `.claude/worktrees/*` as embedded repositories. Rule: `.claude/worktrees/` is in
  `.gitignore`; `git show --stat HEAD` after every add-all. (3) Parallel sessions ran migrations with
  different hand-stamped sets against the one shared `arcnave_test`; a database that has 0026 skips a
  later-arriving 0025 for good (the 2026-09-25 rule). Rule: each session runs with its own
  `TEST_DATABASE_URL` (e.g. `arcnave_test_lead`), dropped when the migration set changes. (4) With
  `MODEL_SONNET` defaulting to the first-party id, `compose.yaml`'s `${MODEL_SONNET:-}` passes an
  empty string, which now means "alias off". Rule: when a default moves into config, grep every
  place that passes the variable through. Verify: `registry.test.ts` "an empty value turns an alias
  off"; `compose.yaml` spells the defaults. Also found by the boot smoke, not a test: a failed query
  logs its params (sign-up e-mail + Argon2 hash) at `src/app.ts:172` — logged in contentLeak.test.ts
  as the Phase 5 enforce item.
- **2026-10-15 (tech-p1 owner review, F-1/F-4)** — No new heading (at the cap). (1) The error
  handler logged `{ err: error }` for every unhandled error. A failed query is a `DrizzleQueryError`
  whose message and `params` carry the query's values (sign-up: the e-mail and the Argon2 hash) and
  whose `cause` (postgres.js) carries `detail: Key (email)=(...)`, so one sign-up failure wrote a
  user's e-mail and password hash to logs that outlive any delete. The shadow check passed because
  it only ran the happy path. Rule: never log an error object, its message, `params`, `query` or
  `stack` from a path that can touch user data; log `errorLogFields(error)` (type, code, SQLSTATE,
  message length) plus request id, method and route pattern. Verify: `npx vitest run
  src/test/contentLeak.test.ts` makes a real insert fail through the real Fastify handler and asserts
  the sentinel e-mail and hash are absent while the `unhandled error` line is present. Other
  `{ err }` log sites outside this handler (`generation.ts`, `files.ts`, `index.ts`, ...) are the
  same risk and remain a Phase 5 enforce item. (2) `assemblePrompt` wrapped user text in
  `<memory>`, `<standing_preferences>` etc. with `trim()` only, so text containing `</memory>` ended
  the wrapper. A blanket `<` escape would have been wrong: the memory block legitimately carries the
  system's own `<memory_listing>`. Rule: neutralise only the wrapper's own closing tag (`</tag` to
  `&lt;/tag`, any case, optional spaces), in the one `wrapTag` helper every wrapper uses. Verify:
  prompt-kit PK-PREC-04 and `promptCache.test.ts` "Wrapper text cannot close its own tag". (3) The
  static `<tool_use>` text named `read_me` for every turn (the 2026-09-26 rule again, in a sentence
  that only forbids narrating the tool). Rule: a sentence in the static base that names a tool is
  built from `buildStaticBasePrompt(allowed.has('read_me'))`, not written once. Verify: PK-HON-05
  with no `it.fails` left in `src/test/promptKit`.
- **2026-10-15 (tech-build.1, files fix)** — Pruned "The SSE generate endpoint had no CORS
  headers": `chats.integration.test.ts` ("sends CORS headers on the SSE response…") now carries it
  (pruning criterion 1). Added the `createApp` worker entry. Not new headings: `drizzle-kit
  generate` stamped 0028 (`1792079597911`) before 0027 (`1792100000000`) again; re-stamped by tag,
  `journal.test.ts` passes (the 2026-09-25 rule). An existing test (`modelLimits.integration`)
  sent the same file in two chats, which only worked because of the claim bug D1 #18 fixed; a
  test that relies on a bug is the bug's last defender — read a newly failing old test for that
  before "fixing" the code. And `pkill -f <pattern>` in this shell killed the shell itself,
  because its own command line contained the pattern; kill by PID.
- **2026-10-16 (tech-build.3-fix)** — Pruned "A generated migration was stamped before the
  hand-written one" (2026-09-25): `src/db/journal.test.ts` ("stamps every migration later than the
  one before it") makes it fail the suite (criterion 1). The oldest entry was not pruned: no test
  carries its rule (`loadTranscript`'s `settled` has none). Added "A fix for a security finding made the next finding". Not a new heading:
  the worktree entry above repeated itself — both writers got `882e8de` (an old `main` merge); W1
  branched from `fce4a22` on its own, W2 was told to `git reset --hard fce4a22` after main checked
  `git worktree list`. The brief had not named the reset although the rule says it must; main's
  check caught it before any work was built on the wrong base. **40 entries.**
- **2026-10-16 (tech-build.3-docs)** — Pruned the oldest entry, "Reconciling with the server raced
  the server's own write" (2026-09-17), at the cap; added the stale-worktree entry. **40 entries.**
- **2026-10-16 (Claude Platform task, existing 40-entry cap)** — A task brief described work
  (swap `AnthropicVertex` for the first-party client, per-provider readiness) that ADR-0054 had
  already done two days earlier; the brief was written from an older picture of the repo. Rule:
  grep the code and `docs/decisions/` for what a brief asks to build before planning, and do only
  the delta. Verify: `grep -rn "vertex-sdk\|AnthropicVertex" backend/src` is empty.
- **2026-10-16 (tech-ops.3b, merge with main)** — Added the ADR-number-collision entry. Retired the oldest, "A deliberate sign-out announced itself as an expired session" (2026-09-17), by the owner's rule for this task (cap 40, prune oldest); no test carries its rule, so the rule stays in this changelog: give a global 401 handler the intent (a flag set before sign-out) instead of inferring it. Main's own changelog line (Claude Platform task) moved here from the top of the file, text unchanged. **40 entries.**
