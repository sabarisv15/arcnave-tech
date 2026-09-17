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
