# tech-build.3 — result (P02 gateway, P04 security, Part D review fixes, P05 turn split)

Branch `build/gateway-security`, cut from `origin/build/files-ingest` (`ff1cab5`; not yet merged
into `main` when this task started). One squashed commit, one push; no PR, no deploy
([ADR-0063](../decisions/0063-files-ingest-and-automated-gates.md): the owner merges and verifies
live with [build-3-live-checklist.md](build-3-live-checklist.md)). Code review:
[build-3-review.md](build-3-review.md).

ADRs: [0064](../decisions/0064-gateway-history-and-retry-defects.md) (Part A, supersedes ADR-0031
§5 only) · [0065](../decisions/0065-edge-security-and-platform-quick-fixes.md) (Part B) ·
[0066](../decisions/0066-file-pipeline-review-fixes.md) (Part D) ·
[0067](../decisions/0067-turn-code-split-by-stage.md) (Part C) ·
[0068](../decisions/0068-code-review-after-every-big-prompt.md) (the standing review step).

## Gates (automated; numbers copied from the runs)

| Run | Backend `tsc` | Backend vitest (files / passed / skipped) | Frontend `tsc -b` · `vite build` · vitest |
|---|---|---|---|
| Baseline (`ff1cab5`) | clean | 119 / 1179 / 19 | clean · — · 42 files / 403 |
| After Wave 1 merge (A, B, D) | clean | 131 / 1300 / 19 | clean · ok · 43 / 407 |
| After Wave 2 merge (C) | clean | 132 / 1314 / 19 | clean · ok · 43 / 407 |
| After review round 1 fixes | clean | 134 / 1341 / 19 | clean · ok · 43 / 408 |
| Final (after round 2 fixes) | clean | 134 / 1353 / 19 | clean · ok · 43 / 408 |

No failing test in any run. The 19 skipped tests are the same 19 as at baseline (live-only and
platform-gated cases). `npm run openapi` regenerated `docs/openapi.json` after Wave 1 (routes:
`/health` added, `/models` 401, `/docs` gated); later merges left it unchanged.

## Exit tests → evidence

| Exit test | Test (file › name) |
|---|---|
| Gemini request with previousContextTokens 120000 carries every function response | `providers/gemini.gateway.test.ts` › "a request with previousContextTokens 120000 carries every function response unchanged" (12 results; the removed policy would have cleared 5); `gemini.adapter-loop.test.ts` › "keeps every tool result whole however large the requests grow" |
| Auto + 600k chars keeps the earliest turn | `routes/gatewayTurn.integration.test.ts` › "Auto with 600k characters of tool results keeps the earliest turn" |
| Failure after a tool-only round does not call the tool again (spy) | `gatewayTurn.integration.test.ts` › "a failure after a tool-only round does not call the tool again; the turn ends partial with a typed code" |
| Gemini 502 retried, quota-0 429 not | `gemini.gateway.test.ts` › `classifyGeminiError` block, "a 502 from the stream reaches the gateway as retryable; a quota-0 429 does not"; `gatewayTurn.integration.test.ts` › "retries a 502 (PROVIDER_MAX_RETRIES times) and never a quota-0 429" |
| genai and Anthropic clients constructed with retries off | `gemini.gateway.test.ts` › "builds the Vertex client with one attempt per request", "the option is the one the SDK obeys: one fetch on a 503 with it, three with attempts 3"; `anthropic.gateway.test.ts` › "a 529 is one fetch, not the SDK default of three" |
| http://[::1]/, name → 10.x, redirect → 169.254.169.254 refused | `services/safeFetch.test.ts` › "http://[::1]/ is refused and opens no socket", "a public-looking name that resolves to 10.x is refused and opens no socket", "a redirect to 169.254.169.254 is refused at that hop; only the public first hop was opened" (+ mapped IPv6, numeric forms, rebinding resolver) |
| Unauthenticated GET /v1/models → 401 | `routes/edgeSecurity.integration.test.ts` › "answers 401 without a session and 200/204 with one" |
| Cross-site POST /v1/auth/logout → 403 | `edgeSecurity.integration.test.ts` › "refuses a cross-site POST /v1/auth/logout with a typed 403 and keeps the session" |
| Two users behind one proxy → separate buckets; spoofed XFF does not move the bucket | `edgeSecurity.integration.test.ts` › "two signed-in users behind the same proxy and client address get separate buckets", "a spoofed leftmost X-Forwarded-For entry does not move an anonymous caller to a new bucket" |
| Identifier guard fails on a planted id | `test/identifierGuard.test.ts` › "catches a planted identifier of each kind, and skips tests and scripts" |
| Migrate failure exits non-zero | `db/migrate.integration.test.ts` › "exits non-zero when the database cannot be migrated", "does not start the server when migration fails, and exits non-zero" |
| Encrypted .xlsx → `encrypted` | `routes/fileReviewFixes.integration.test.ts` › "a real password-protected workbook (D0a) › ends `failed` with errorCode `encrypted`" (genuine fixture `build-2-fixtures/11-encrypted-password-test.xlsx`, msoffcrypto-tool, password `test`) |
| ffmpeg env has no secrets, carries the protocol whitelist; ID3+m3u8 yields nothing | `services/attachments/untrustedTools.test.ts` › "a real recording: both tools carry no secret, -nostdin and the whitelist before -i", "an ID3 tag followed by an m3u8 playlist pointing at file:///etc/hostname yields nothing from that file" |
| Lying ZIP and comment-padded DOCTYPE refused | `services/attachments/preflightPass.test.ts` › "refuses a member that declares 1 KB and really inflates to 200 MB of zeros, with bounded memory", "refuses a DOCX whose document.xml has a 10 KB comment before <!DOCTYPE" |
| Failed enqueue leaves the file `uploading` | `fileReviewFixes.integration.test.ts` › "a failed enqueue leaves the file `uploading` with no job, and complete can be called again" |
| `complete` never reads the object | `fileReviewFixes.integration.test.ts` › "complete never opens the object; the job puts the SHA-256 on the row" |
| A markdown file mentioning %PDF- is accepted | `fileReviewFixes.integration.test.ts` › "notes.md / table.csv / plain.txt that mentions %PDF- at line 5 is read as text" |
| Two large jobs never run together | `fileReviewFixes.integration.test.ts` › "two large jobs queued never run together, and both finish" (+ control under the threshold) |
| Characterization snapshots byte-identical before and after the split | `test/turnCharacterization.integration.test.ts` (14 scenarios) written on the unsplit code (worker commit `92554f6`); `git diff 92554f6 ea7da34 -- '*.snap'` empty; passes without `-u` on the split and on every later merge |
| Full backend suite passes | gates table above |

## Defaults used (all new settings; "ours" = no N-id)

| Setting | Default | Source |
|---|---|---|
| `MEDIA_MAX_OUTPUT_TOKENS` | 65536 | ours (model maximum) |
| `TRUST_PROXY_HOPS` | 1 | ours (Cloud Run front end) |
| `DOCS_ENABLED` | unset → on unless `NODE_ENV=production` | ours |
| `SAFE_FETCH_MAX_BYTES` | 5 MB | Stage 8 08d |
| `SAFE_FETCH_MAX_REDIRECTS` / `SAFE_FETCH_GROUNDING_MAX_REDIRECTS` | 3 / 8 | ours |
| `SAFE_FETCH_TIMEOUT_MS` | 10000 | N-43 |
| `SAFE_FETCH_CONNECT_TIMEOUT_MS` | 3000 | ours |
| `SANDBOX_SIGNING_SA` | unset (no code default) | PH-4 |
| `FILE_TMP_DIR` | '' = `os.tmpdir()` | ours |
| `FILE_LARGE_JOB_BYTES` | 100 MB | ours |
| `FILE_ORPHAN_GRACE_MS` | 60000 | ours |
| `ZIP_PREFLIGHT_TIMEOUT_MS` | 120000 | ours |
| `CONTEXT_EDIT_TRIGGER_TOKENS`, `CONTEXT_EDIT_KEEP_TOOL_RESULTS`, `CONTEXT_EDIT_CLEAR_BATCH` | removed | ADR-0064 |

New `ApiError` codes (backend catalog and frontend `errorCopy`): `provider_quota_unavailable` (503),
`partial_after_tool_run` (502), `origin_not_allowed` (403). No migration.

## Decisions (the owner may change them)

From the brief: OQ-09 ADR-0023 reinstated for Gemini (ADR-0064); D2 X-4 option B not built
(DEFERRED); cookie stays `SameSite=None` (OQ-19), protected by the Origin check; numbers from
`config/numbers.ts` with N-ids, the rest in config labelled ours.

Taken during the task (details in the part sections below):

1. Partial turn stored as `status = complete`, `error_code = partial_after_tool_run`,
   `finish_reason = partial`; the UI shows a cut-short note (review fix). Text or thinking already
   shown without a tool run ends as an `error` row (not retried), as before.
2. Quota-0 429 detected by `limit: 0` or `quotaValue` 0 → `provider_quota_unavailable`; Gemini
   `RetryInfo` honoured as Retry-After up to 10 s (N-42).
3. History: failed / refused / empty exchanges dropped both sides, except an errored answer whose
   tools ran (kept) and a question that carried files (kept) — review fix.
4. `trustProxy` is a hop function, not a number (Fastify 5.12 treats a number as "trust nothing").
5. The Origin check also refuses `Origin: null`, same-site without Origin, and a Google form post;
   a browser `Sec-Fetch-Site: same-origin` passes whatever the Origin (review fix).
6. CSP report-only on API and web; framing enforced with `X-Frame-Options: DENY`.
7. Migrations under advisory lock 72430065; Dockerfile `migrate && exec index`.
8. ffprobe gets stdin closed instead of `-nostdin` (it rejects the flag); the parser child keeps
   `NODE_ENV`.
9. The workbook preview opens only `ready` files without a `not_extracted` warning
   (`preview_unsupported`).
10. A chat ZIP-archive expansion job counts as large; EPUB members all scanned with a lenient
    DOCTYPE rule (no internal subset, no ENTITY), `.xml/.rels/.vml` strict.
11. Filenames in prompt text: only `<`, `>` and control characters neutralised; `xmlAttr` for
    attributes.
12. `runTurn` stays one generator (stream loop and settle not split: not a mechanical move).
13. `regenerate` clears the old attempt's tool calls (pre-existing bug found by review in moved code).
14. A start-up error log when `SANDBOX_STAGE_BUCKET` is set without `SANDBOX_SIGNING_SA` (main).

## Not done

- Frontend fallback API URL with the project number (`arcnave-frontend/src/api.ts:31-33`): needs
  `VITE_API_BASE` set in the Cloudflare build first.
- ER-2b resume from the failed round; Claude thinking persisted across turns (schema stores text
  only); compaction transcript still carries failed exchanges.
- COOP/CORP, CSP enforcement, SD-1d logout-all route, migrator as a separate job.
- `routes/projects.ts` two-statement insert + enqueue (covered by the orphan reconcile).
- `streamAndCollect` / `settleTurn` extraction.
- Every MINOR review finding not fixed: see build-3-review.md and DEFERRED.md.

All deferred lines are in [audit/DEFERRED.md](audit/DEFERRED.md) under "Deferred by tech-build.3".

## Models and workers

- Main session: Opus 5.5 (orchestration, merges, conflict resolution, small review fixes, docs,
  `/code-review` ×2, `/security-review`).
- Writers, Opus 5.5, worktree-isolated: Wave 1 — three in parallel (A gateway, B security, D file
  pipeline); Wave 2 — one (C turn split). The same four workers made the review fixes (round 1:
  four in parallel; round 2: three in parallel).
- Independent reviewers, Opus 5.5, read-only: R1, R2, R3 in parallel (round 1); R4 (round 2); one
  `/security-review` finder sub-task.
- Test runners, Haiku 5.5: two per gate run, in parallel (baseline, after Wave 1, after Wave 2,
  after round 1, final): ten runs.
- No Sonnet worker was needed (every part was high-risk: gateway, auth / platform, file pipeline,
  layout refactor).

---

The sections below are the four workers' notes, folded in unchanged except for headings
(evidence per item, decisions, outbound fetch inventory, live checks, review-round tables).


## build-3 Part A (Worker A) — P02 gateway defects

Base 583d449. Model: Opus 5.5. ADR: [ADR-0064](../decisions/0064-gateway-history-and-retry-defects.md)
(supersedes ADR-0031 §5 only; ADR-0031's status line points at it).

Checks run: `npx tsc --noEmit` (backend) clean; `npx tsc -b` (frontend) clean; test files below, plus
the existing files they could break (`toolHistory`, `providerTimeout`, `runResume`, `toolLimit`,
`refusal`, `stickyModel`, `longChat`, `claudeUsage`, `chats`, `files`, `officeTextOnce`,
`attachmentContinuity`, `promptToolParity`, `batch6*`, `brandNeutral`, `contentLeak`,
`configUsage`, `attachmentContent`, `retryPolicy`, `toolLoopPolicy`, frontend `types` and
`ChatStates`): all green on `arcnave_test_a`. Full suite not run (main runs it).

### Evidence per item

| # | Item | Proof (file › test) |
|---|---|---|
| 1 | Gemini tool-result clearing removed (X-1) | `providers/gemini.gateway.test.ts` › "a request with previousContextTokens 120000 carries every function response unchanged"; `providers/gemini.adapter-loop.test.ts` › "keeps every tool result whole however large the requests grow (ADR-0023, ADR-0064)" (replaces the old clearing test); `contextEditing.ts` + its test deleted |
| 2 | loadHistory by resolved model (X-2) | `routes/gatewayTurn.integration.test.ts` › "Auto with 600k characters of tool results keeps the earliest turn" (fails on the old `generation.ts`, checked) |
| 3 | Failed / refused / empty exchanges omitted, both sides (X-3, R-3) | `services/history/failedExchanges.test.ts` (6); `routes/gatewayTurn.integration.test.ts` › "omits both sides of a refused, a failed and an empty exchange, and keeps a stopped one that has text" (fails on old code) |
| 4 | Retry gate counts tool + thinking; tool never re-run; partial end (ER-2b) | `routes/gatewayTurn.integration.test.ts` › "a failure after a tool-only round does not call the tool again; the turn ends partial with a typed code" (spy on `AskUserInputExecutor.prototype.execute`: 1 call, 1 provider attempt, `done` has `partial: true`, `errorCode: partial_after_tool_run`), › "a transient failure before any step is still retried", › "a failure after thinking was shown is not retried" (first and third fail on old code) |
| 5 | Gemini errors by status; quota-0 429 = config (ER-2e/g) | `providers/gemini.gateway.test.ts` › `classifyGeminiError` block (408/409/429/500/502/503/504 retried; 400/401/403/404/413 not; stream-chunk 502; quota-0 by "limit: 0" and by `quotaValue: "0"`; RetryInfo → retryAfterMs; `fetch failed`); › "a 502 from the stream reaches the gateway as retryable; a quota-0 429 does not"; `routes/gatewayTurn.integration.test.ts` › "retries a 502 (PROVIDER_MAX_RETRIES times) and never a quota-0 429" |
| 6 | SDK retries explicitly off (ER-1b, VS-29b) | `providers/gemini.gateway.test.ts` › "builds the Vertex client with one attempt per request", › "the option is the one the SDK obeys: one fetch on a 503 with it, three with attempts 3"; `providers/anthropic.gateway.test.ts` › "a 529 is one fetch, not the SDK default of three" |
| 7 | Duplicate failed-call guard in Gemini loop (X-10) | `providers/gemini.gateway.test.ts` › "does not run a call again that already failed with the same input in this turn" |
| 8 | Media output cap + finish-reason mark (X-7) | `providers/gemini.gateway.test.ts` › "describeMedia sends the configured cap and marks a MAX_TOKENS reading as incomplete", "describeMedia returns a whole reading unmarked", "readMedia sends the cap and reports truncated for anything but STOP", "the default cap is Gemini 3.8 Flash's own maximum" |
| 9 | `<document filename>` escaped (X-9) | `providers/gemini.gateway.test.ts` › `<document filename> is attribute-escaped` (4 hostile/plain names) |
| 10 | Claude thinking replayed in the loop (CC4, MR10) | `providers/anthropic.gateway.test.ts` › "replays thinking and redacted_thinking blocks with their signatures, unmodified and in order, every round", › "keeps the blocks of a paused turn too when it resumes it (pause_turn)". Code already did this (`final.content`); tests pin it. Cross-turn: `messages.thinking` is text only, no signatures → not persisted (no migration), as the brief allows |

Tests added: `gemini.gateway.test.ts` 32, `anthropic.gateway.test.ts` 3,
`gatewayTurn.integration.test.ts` 6, `failedExchanges.test.ts` 6; `gemini.adapter-loop.test.ts`
1 replaced; `contextEditing.test.ts` (2) deleted with its module.

### Decisions taken on my own

- **Partial turn storage (item 4):** status `complete` (not `error`), `error_code =
  partial_after_tool_run`, `finish_reason = partial`; `done` adds `partial: true` and `errorCode`.
  `complete` so item 3 keeps the exchange and the next turn sees what the tool did. No forced
  synthesis request after such a failure. Applies only when the failure is one a retry would
  have answered; a non-retryable failure after a tool stays an `error` turn (as before).
- **What counts as a step (item 4):** non-empty `delta`, `code`, non-empty `thinking`,
  `tool_input_partial` (visual drafts are shown), `tool_use`, `tool_result`. `progress` and
  `sources` do not. The context-overflow retry is gated the same way (it also re-ran tools).
- **Quota-0 detection (item 5):** QuotaFailure `quotaValue` 0 **or** `limit: 0` in the message;
  proto3 omits a zero int64, so the message is the dependable signal. New code
  `provider_quota_unavailable` (503). 401/403 → `model_unavailable` (as the Claude adapter).
  Unknown status-less errors are retried only for `TypeError('fetch failed')` / socket error codes
  (the old text match retried any message containing "500", "deadline", …).
- **Gemini RetryInfo:** `retryDelay` is now the Retry-After the gateway honours (≤ 10 s, N-42); a
  longer one fails the turn at once, as for Claude.
- **"Empty" exchange (item 3):** assistant with no text and no tool calls, any status. A stopped
  answer with text or tool calls stays. The user message is dropped only when it is directly
  before (seq − 1) the failed answer.
- **Item 2 under Auto:** the pre-resolution read has no character backstop (it is needed for the
  vision check); the history is re-read for the resolved alias. One extra read per Auto turn.
- **`MEDIA_MAX_OUTPUT_TOKENS` = 65,536** (ours, no N-id): the model's own maximum, so only the
  model cuts a reading.
- **Duplicate-call guard text** moved to `toolLoopPolicy.ts` and shared by both adapters (text
  unchanged).

### Not done, and why

- Resume-from-the-failed-round (NEW-PLAN's other ER-2b option): needs per-round state (Phase 5
  executor). Brief chose "end with partial".
- Cross-turn persistence of Claude thinking blocks with signatures: schema stores text only.
- Compaction summarizer (`services/compaction/autoCompact.ts`, not mine) still includes failed
  exchanges and writes `[Response stopped]` for empty answers in its transcript.
- Quota-0 429 shape on **Vertex** is unverified (Google error docs unreachable from here; fixtures
  follow the AI Studio shape from public reports + googleapis proto). Live check below.

### Cross-ownership / shared-file edits

- `backend/src/config.ts` (shared): appended `MEDIA_MAX_OUTPUT_TOKENS` at the end of the schema;
  **deleted** the three `CONTEXT_EDIT_*` lines (not additive): `src/configUsage.test.ts` fails on a
  setting no production code reads, and their only reader was removed (item 1).
- `backend/src/errors.ts` (shared): appended `provider_quota_unavailable`, `partial_after_tool_run`
  at the end of `ERROR_CATALOG`.
- `arcnave-frontend/src/api.ts` (shared): appended the same two codes at the end of `errorCopy`.
- `docs/decisions/0031-…md`: status line only.

### DEFERRED lines (for main to paste into docs/ops/audit/DEFERRED.md)

- D2 X-4 option B (replay non-native tool history as a structured user-side note instead of
  assistant prose) — not built by owner decision (tech-build.3); option A guard stays.
- Stage 15 ER-2b continuation — resume a turn from the failed tool round instead of ending it
  partial; needs per-round checkpoint state (Phase 5 executor, ER-3e). ADR-0064 §4.
- D2 CC4 / MR10 across turns — persist Claude thinking / redacted_thinking blocks with signatures
  (needs a `messages` column; additive migration) so prior turns replay them; in-loop replay done.
- Compaction transcript (`autoCompact.ts`) still carries failed exchanges and the
  `[Response stopped]` placeholder; align with ADR-0064 §3.

### mistakes.md lines (entry format)

- **2026-10-16 (tech-build.3 A, unused config)** — Symptom: after deleting Gemini result
  clearing, `configUsage.test.ts` failed on `CONTEXT_EDIT_*`; I had meant to leave the settings
  because `config.ts` is append-only for parallel workers. Cause: removing a feature's last reader
  leaves its settings dead, which the guard test forbids. Rule: when you delete the code that reads
  a setting, delete the setting in the same change and say so as a shared-file exception; run
  `src/configUsage.test.ts` after any removal. Verify: `npx vitest run src/configUsage.test.ts`.
- **2026-10-16 (tech-build.3 A, SDK defaults)** — Symptom: `HttpRetryOptions.attempts` in
  `@google/genai`'s `.d.ts` says "If not specified, default to 5", and the audit read the client as
  retrying; in the 2.22 runtime (`apiCall`) there is no retry at all unless `retryOptions` is
  given. Cause: a type comment describes the option's default once the option object exists, not
  the client's default. Rule: before stating what an SDK does by default, read the code path in
  `dist/` that consumes the option, and pin it with a stubbed-`fetch` test that counts requests.
  Verify: `npx vitest run src/providers/gemini.gateway.test.ts` (one fetch with ours, three with
  `attempts: 3`).

### Live checklist (owner, on the live service after merge; ADR-0063: no local run needed)

1. **Gemini keeps every tool result (exit 1).** In a chat pinned to Gemini 3.8 Flash, ask for work
   that runs several tools on a large PDF (turn > 100,000 tokens), then ask a follow-up that only
   needs an early result ("first step la evlo rows irundhuchu?").
   Expected: the answer comes without re-running the tool; `GET /v1/chats/:id/messages/:messageId/log`
   for the follow-up shows `previousContextTokens` ≥ 100000 and no `cleared` text anywhere.
   Failure: the log shows the same tool re-run, or the model says a result "was cleared".
2. **Auto keeps the earliest turn (exit 2).** In an Auto chat whose tool results exceed ~470k
   characters (a few large-file turns), ask "what was my very first question in this chat?".
   Expected: it quotes the first question. Failure: it cannot, or quotes a later one.
3. **Failed exchanges leave the history (item 3).** In a chat, trigger a refusal or an error, then
   ask "what did I ask just before this?". Expected: it names the last exchange that succeeded;
   the turn log's history stage does not include the failed question. Failure: it names the
   failed question, or `[Response stopped]` appears in any turn log.
4. **Tool never re-run after a failure (exit 3).** Not triggerable on demand. Over a week, search
   Cloud Logging for `provider failed after a tool ran`. Expected for each hit: the message has
   `status = complete`, `error_code = partial_after_tool_run`, and
   `select tool_call_id, count(*) from tool_calls where message_id = '<id>' group by 1 having count(*) > 1`
   returns no rows. Failure: duplicate tool calls for one message, or `retrying provider call`
   logged after a tool ran in the same turn.
5. **502 retried, quota-0 not (exit 4).** Over a week, Cloud Logging `retrying provider call`
   lines for Gemini: each is followed by at most 2 retries. If a Gemini model id with no regional
   quota is ever configured (or a quota-0 429 occurs), expected: the turn fails at once with code
   `provider_quota_unavailable` and no `retrying provider call` line. Failure: retries on a
   `limit: 0` 429, or a quota-0 shape on Vertex that is not detected (record the body's
   `error.details` / message shape and send it to the next task).
6. **SDK retries off (exit 5).** Covered by tests (stubbed `fetch`); nothing to run live.

### New / removed config and env variables

| Variable | Default | Note |
|---|---|---|
| `MEDIA_MAX_OUTPUT_TOKENS` | 65536 | new; output cap for OCR / transcription readings (ours, no N-id) |
| `CONTEXT_EDIT_TRIGGER_TOKENS` | — | removed |
| `CONTEXT_EDIT_KEEP_TOOL_RESULTS` | — | removed |
| `CONTEXT_EDIT_CLEAR_BATCH` | — | removed |

New `ApiError` codes: `provider_quota_unavailable` (503), `partial_after_tool_run` (502). No route
schema changed (`done` is an SSE payload; OpenAPI regeneration is main's). No migration. No new
npm dependency.

### Review round 1 (2026-10-16)

| Fix | Proof (file › test) |
|---|---|
| 1 Errored answer with tool calls kept; question with files kept | `services/history/failedExchanges.test.ts` › "keeps an errored answer that made tool calls, with its question: the calls ran", › "keeps the question of a failed exchange when it carried files, and drops only the answer"; `routes/gatewayTurn.integration.test.ts` › "keeps the question with its file when the answer failed, and an errored answer that ran a tool" |
| 2 Partial end visible in the UI | `arcnave-frontend/src/types.test.ts` › "cutOffReason" (`partial`); `src/ChatStates.test.tsx` › "says a partial answer stopped early after a tool ran, and still offers Continue (ADR-0064)" |
| 3 120000 test can fail against the old policy | `providers/gemini.gateway.test.ts` › "a request with previousContextTokens 120000 carries every function response unchanged" (12 results; old policy would clear 5) |
| 4 Filename escaped in page labels and attachment notes | `providers/attachmentContent.test.ts` › "a filename in page labels and attachment notes cannot add markup" (3) |
| 5 Stale comment | `services/generation.ts` (previousContextTokens comment) |

### Review round 2 (2026-10-16)

Filenames in prompt TEXT now go through `filenameInText` (`<`/`>` → `&lt;`/`&gt;`, control
characters → space; `&`, quotes, apostrophes unchanged); `xmlAttr` stays for real attributes.
Round 1's attribute escaping of `pageLabel` / `describe` is replaced.

Sites changed (cross-ownership, interpolation lines only): `providers/attachmentContent.ts`
(pageLabel, describe), `services/attachments/manifest.ts` (Worker D), `services/attachments/fileBudget.ts`
(Worker D), `services/retrieval.ts` (formatContext, formatWholeFiles), `services/compaction/autoCompact.ts`
(transcript file list), `tools/codeExecutionExecutor.ts` (missing-file errors). Left as is (not prompt
text): Content-Disposition, turnLog, `ApiError` details (`modelLimits.ts`), research progress detail
(`turn/contextPrompt.ts`), the sandbox `input/` name (already sanitised).

| Proof (file › test) |
|---|
| `providers/attachmentContent.test.ts` › "a filename in prompt text: named as stored, no markup, no new line (D2 X-9, review r2)" (4) |
| `services/attachments/manifest.test.ts` › "names a file as stored (R&D John's notes.pdf), and a hostile name cannot close the block or start a line (review r2)" |
| `routes/fileDerivatives.integration.test.ts` › "names the file as stored in the excerpt note and the manifest, with only < and > neutralised (review r2)" |

## build-3-b — Part B, P04 security and platform quick fixes (Worker B)

Base: `583d449`. ADR: [0065](../decisions/0065-edge-security-and-platform-quick-fixes.md).
Models used: Opus 5.5 (this worker, all items).

Gates run here: `cd backend && npx tsc --noEmit` clean; `cd arcnave-frontend && npx tsc -b` clean;
the test files below pass with `TEST_DATABASE_URL=.../arcnave_test_b`. Also: a production-mode
boot of the built `dist/` (NODE_ENV=production, real Postgres) answered `/health` 200 with the
headers, `/docs` 404, cross-site logout 403, app-origin logout 204, anonymous `/v1/models` 401,
and `ratelimit-remaining` kept counting down across spoofed X-Forwarded-For values; built
`dist/db/migrate.js` exits 0 on the test DB and 1 on a missing DB. The full suite was not run
(main runs it). `npm run openapi` was not run (owned by main): **routes changed** (`/health` added,
`/docs` gated, 401 on `/models`), so main must regenerate `docs/openapi.json`.

### Evidence per item

| # | Item | Proof (file › test) |
|---|---|---|
| 1 | SSRF / safeFetch | `backend/src/services/safeFetch.test.ts` › "http://[::1]/ is refused and opens no socket"; "a public-looking name that resolves to 10.x is refused and opens no socket"; "a redirect to 169.254.169.254 is refused at that hop; only the public first hop was opened"; "IPv4-mapped IPv6 is refused, in the literal and as a DNS answer"; "numeric, octal, hex and decimal spellings of loopback are refused"; "a rebinding resolver (public first, private second) is asked once and the public answer is pinned"; "checks every DNS answer, not only the first"; limits block (redirect cap, byte cap, Content-Length, timeout, abort, no URL in errors); "nodeTransport ... uses the pinned address for a name that does not resolve" (real socket to a local server, `.invalid` host). `backend/src/services/webFetch.test.ts` (web_fetch goes through it). |
| 2 | Rate-limit key | `backend/src/routes/edgeSecurity.integration.test.ts` › "two signed-in users behind the same proxy and client address get separate buckets"; "a spoofed leftmost X-Forwarded-For entry does not move an anonymous caller to a new bucket". `backend/src/plugins/security.test.ts` › trustProxyHops (incl. "a plain number would trust nothing in this Fastify version"). Mutation-checked: an IP-only key fails the first test. |
| 3 | /models auth | `edgeSecurity.integration.test.ts` › "answers 401 without a session and 200/204 with one" (and no provider probe on the anonymous call). |
| 4 | Origin check | `edgeSecurity.integration.test.ts` › "refuses a cross-site POST /v1/auth/logout with a typed 403 and keeps the session" (real origin passes, 204, ACAO echoed); "refuses the body-less POST /chats/:id/stop cross-site"; "a form post from Google to the sign-in route is refused; the app posting the token is not"; "leaves reads alone". `security.test.ts` › originAllowed table. |
| 5 | Identifiers | `backend/src/test/identifierGuard.test.ts` › "finds no cloud identifier in backend/src launch code"; "catches a planted identifier of each kind, and skips tests and scripts". |
| 6 | Headers | API: `security.test.ts` › "reach a response the handler writes itself (the SSE path)"; `edgeSecurity.integration.test.ts` › "serves /health and keeps /healthz ... a 404 carries them too". Web: `arcnave-frontend/src/securityHeaders.test.ts` (4 tests: set present, CSP report-only only, nginx == _headers, prerender inline-script hash). |
| 7 | Docs + health | `security.test.ts` › DOCS_ENABLED (both rules); `edgeSecurity.integration.test.ts` › "serves Swagger UI only when docs are enabled", "/health and /healthz". |
| 8 | Migrations | `backend/src/db/migrate.integration.test.ts` › "three instances starting at once on an empty database all succeed, and each migration runs once" (fails without the lock: 1 fulfilled, 2 rejected — mutation-checked); "waits while another session holds the migration lock"; "exits non-zero when the database cannot be migrated"; Dockerfile CMD run by `sh` with stub scripts: "does not start the server when migration fails, and exits non-zero", "starts the server after a successful migration". |

Test counts added: safeFetch.test.ts 17, webFetch.test.ts 2, security.test.ts 10,
edgeSecurity.integration.test.ts 9, migrate.integration.test.ts 5, identifierGuard.test.ts 2,
arcnave-frontend securityHeaders.test.ts 4 (49 total). Also re-run, unchanged and green:
configUsage, models.integration, webExecutor, brandNeutral, frontend types/ChatStates/Styles.

### Outbound fetch inventory (backend/src, non-test)

| Call | User-chosen URL? | Now |
|---|---|---|
| `services/webFetch.ts` (web_fetch tool) | yes | safeFetch |
| `providers/grounding.ts:80-82` (Vertex grounding redirect → third-party page) | yes (third-party redirect chain) | safeFetch (cross-ownership edit) |
| `services/webSearch.ts:52,70,107,127` | no: fixed SerpAPI / Google CSE endpoints, user text only in the query string | unchanged |
| `tools/sandbox/signedUrl.ts:64` | no: Google IAM signBlob endpoint | unchanged |
| `tools/sandbox/cloudRunSandboxClient.ts`, `warmSandboxClient.ts` (`fetchImpl`) | no: Cloud Run API / `SANDBOX_SERVICE_URL` from config | unchanged |
| `services/attachments/scanner.ts:59` (`net.connect`) | no: `CLAMD_HOST`/`PORT` from config | unchanged |
| provider SDKs (`providers/**`) | no: fixed provider hosts | unchanged |
| `scripts/evalScope.ts` | script, not launch code | unchanged |

No undici, axios or `http.request` use elsewhere; `services/attachments/**` and `routes/files.ts`
fetch no user URL.

### Frontend callers of /models (item 3)

`arcnave-frontend/src/session.tsx:147-155` calls `api.models.list` only inside
`if (!user) { setModels(null); return; }` — after sign-in. `arcnave-frontend/src/Settings.tsx:811`
calls `api.models.refresh()` from the Settings screen, which is only reachable signed in.
`api.ts:927-929` defines both. Nothing calls them before sign-in.

### Decisions taken here (ours unless stated)

- `trustProxy` is a hop function, not a number: Fastify 5.12.5 `lib/request.js` makes a numeric
  trustProxy trust nothing. Default 1 (Cloud Run front end; nginx in compose).
- Rate-limit key prefixes `user:` / `ip:`; hook `onRequest` stated explicitly (it was already the
  default and already ran after the session hook; the user half was never broken — measured).
- Origin rule also refuses `Sec-Fetch-Site: same-site` without Origin (a sibling subdomain is not
  in the allowlist either), and `Origin: null`.
- A Google form post (`Origin: https://accounts.google.com`) to `/auth/google` is refused: the app
  uses GIS popup mode (`GoogleSignInButton.tsx` `ux_mode: "popup"`) and posts JSON itself.
- safeFetch also refuses `*.internal`, `*.local`, `*.home.arpa`, credentials in the URL, all IPv6
  outside 2000::/3, 6to4, Teredo/ORCHID; max 3 redirects; 5 MB body (Stage 8 08d); N-43 10 s.
- API CSP report-only; framing enforced via `X-Frame-Options: DENY` on API and web.
- Web Permissions-Policy keeps `microphone=(self)` for dictation (ADR-0042).
- Web CSP-RO allows the jsDelivr/cdnjs hosts and `https://*.run.app` (no project number) and
  `https://storage.googleapis.com` (direct uploads); the prerender inline script by hash.
- nginx: Cache-Control moved to a `map` so no location has its own `add_header` (nginx drops
  server-level headers in such a location — the old `/assets/` and `/index.html` blocks had lost
  nosniff/XFO/Referrer-Policy). `/health` proxied. `nginx -t` NOT run (no nginx in this sandbox).
- Migration lock key 72430065; migrate failure log now `errorLogFields(err)` (no statement text).
- Docker HEALTHCHECK uses `/health`.

### Not done, and why

- Frontend fallback API URL with the project number (`arcnave-frontend/src/api.ts:31-33`): needs
  `VITE_API_BASE` set in the Cloudflare Workers Build settings first; CI's `npx vite build` and the
  Cloudflare build both run without it, so requiring it fails both and a `/v1` fallback would ship
  a broken bundle. Owner step + one-line follow-up (DEFERRED line below). The backend guard does
  not scan the frontend.
- COOP/CORP (SE10): COOP `same-origin` breaks the Google popup; needs a live check of
  `same-origin-allow-popups`.
- CSP enforcement and a report endpoint.
- SD-1d logout-all route (no route exists; the Origin check will cover it when added).
- N-70 migration `lock_timeout`/`statement_timeout`; migrator as a separate job (ID-13 shape).

### DEFERRED lines (for main to paste into docs/ops/audit/DEFERRED.md)

- PH-4 / S21-11 (frontend): remove the project-numbered fallback API URL from `arcnave-frontend/src/api.ts`; prerequisite: owner sets `VITE_API_BASE` in the Cloudflare Workers Build variables (and CI's frontend build env). Then extend `identifierGuard.test.ts` to `arcnave-frontend/src`. (build-3-b)
- SE10 COOP/CORP on the web host: try `Cross-Origin-Opener-Policy: same-origin-allow-popups` with a live Google sign-in; CORP `same-site` on static assets. (build-3-b)
- PH-2 / INJ-2: enforce the CSP after the report-only run is clean; srcdoc visuals inherit the parent CSP, so they need their own origin or explicit allowances first. (build-3-b)
- A-08 option B / TD-3: separate fetch service with a zero-permission service account (infra). (build-3-b)
- ID-13 shape: migrator as a Cloud Run Job / build step before traffic shifts; N-70 lock_timeout 5 s / statement_timeout 300 s in the migration transaction. (build-3-b)
- A-09 option B: shared rate-limit store (Redis) so the per-user limit holds across instances. (build-3-b)
- SD-1d: logout-all route. (build-3-b)

### mistakes.md lines (only what went wrong or nearly did)

- **2026-10-16 (build-3-b, trustProxy)** — Symptom: the brief and the audit both said "set
  `trustProxy` to the hop count"; Fastify 5.12.5 accepts `trustProxy: 1` without error and then
  trusts no forwarded header at all (`lib/request.js`: a number "fails closed"), so `request.ip`
  would have stayed the proxy address while looking fixed. Cause: a security hardening in the
  installed version changed what a number means; the `.d.ts` does not even list `number`. Rule:
  read the installed library's implementation, not its docs or the brief, before setting a
  security option, and pin the behaviour in a test. Verify: `npx vitest run
  src/plugins/security.test.ts` ("a plain number would trust nothing in this Fastify version").
- **2026-10-16 (build-3-b, nginx add_header)** — Symptom: nginx.conf's security headers were
  absent from `/assets/*` and `/index.html`, the two paths that serve the app. Cause: nginx does
  not inherit server-level `add_header` into a location that has its own `add_header` (both had
  Cache-Control). Rule: never `add_header` inside a location of nginx.conf; route per-path values
  through a `map`. Verify: `arcnave-frontend/src/securityHeaders.test.ts` compares the server-level
  set with `public/_headers`; `grep -n "add_header" arcnave-frontend/nginx.conf` shows only
  server-level lines.

### Live checklist — Part B (paste into docs/ops/build-3-live-checklist.md)

`$API` = live API base (ends before `/v1`), `$WEB` = live frontend origin.

**Before merging (owner):** if the Cloud Run Job sandbox engine is used with a staging bucket,
set `SANDBOX_SIGNING_SA` on the service (`gcloud run services update <svc> --update-env-vars
SANDBOX_SIGNING_SA=<account>`; never `--set-env-vars`). The warm sandbox does not need it. Leave
`DOCS_ENABLED` unset (production default off) and `TRUST_PROXY_HOPS` unset (1).

1. New revision started. `gcloud run revisions list --service <svc> --region <region> --limit 3`
   → newest revision `Ready=True`, and `gcloud run services describe <svc> --region <region>
   --format='value(status.traffic)'` names it. Failure: newest not ready, logs show
   `"migration failed"` → the database is stopped or a migration broke; traffic stays on the old
   revision (intended). Fix the cause, redeploy.
2. Migrations once. Logs of the new revision: `"migrations applied"` on each instance, no
   `duplicate key ... pg_type` errors. Failure: any `migration failed` line.
3. Health. `curl -s $API/health` → `{"status":"ok",...}`; `curl -s -o /dev/null -w '%{http_code}' $API/readyz` → 200.
   (`$API/healthz` from outside may be answered by Google, not the app — that is why `/health` exists.)
4. Docs off. `curl -s -o /dev/null -w '%{http_code}\n' $API/docs` → `404`. Failure: 200/302.
5. /models needs sign-in. `curl -s -w ' %{http_code}\n' $API/v1/models` → `401` with
   `"code":"unauthorized"`. In the app (signed in), the model menu still lists the three models.
6. Origin check. `curl -s -w ' %{http_code}\n' -X POST -H 'Origin: https://evil.example' $API/v1/auth/logout`
   → `403` with `"code":"origin_not_allowed"`. Then `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Origin: $WEB" $API/v1/auth/logout` → `204`.
   In the app: sign in with e-mail, sign in with Google, send a message, stop a reply, sign out —
   all work. Failure: any of them shows "Request blocked" → `CORS_ORIGINS` lacks `$WEB` exactly.
7. Rate-limit bucket (verifies TRUST_PROXY_HOPS=1 on Cloud Run).
   `for x in 1.1.1.1 2.2.2.2 3.3.3.3; do curl -s -D - -o /dev/null -H "X-Forwarded-For: $x" $API/v1/auth/me | grep -i ratelimit-remaining; done`
   → the number goes down by one each time (the spoofed value did not give a fresh bucket).
   Then run the same `curl` once from a different network (phone hotspot) → the count starts near
   the top again (a different client gets its own bucket). Failure A: the count resets with every
   spoofed value → a header is trusted too far left (stop, set `TRUST_PROXY_HOPS=0`, report).
   Failure B: the second network continues the first network's count → Cloud Run appends more
   than one entry; report it (do not raise the value blindly).
8. API headers. `curl -s -D - -o /dev/null $API/health` → `Strict-Transport-Security`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
   `Permissions-Policy`, `Content-Security-Policy-Report-Only`.
9. Web headers. `curl -s -D - -o /dev/null $WEB/` and `curl -s -D - -o /dev/null $WEB/some/deep/route`
   → both show the six headers from `public/_headers`. Failure: the deep route lacks them
   (Cloudflare's SPA fallback may not apply `_headers`; report — this could not be verified from docs here).
10. CSP reports. Open `$WEB` in Chrome, DevTools → Console, use the app for a few minutes (sign in,
   chat, open a visual, attach a file, Settings). Lines starting `[Report Only]` are what an
   enforced CSP would block; the app itself keeps working because nothing is blocked. Copy each
   distinct line (directive + blocked host, no page text) into the report. Expected: reports for
   inline scripts inside visuals and third-party images in cards; anything else is new.
11. web_fetch still works. In a chat with web tools on, paste a public article URL and ask for a
   summary → answer cites it. Paste `http://169.254.169.254/` and ask to read it → the tool
   answers `url_not_allowed`, no content.

### New config / env variables

| Variable | Default | Meaning |
|---|---|---|
| `TRUST_PROXY_HOPS` | `1` | appending proxies in front of the backend (ours) |
| `DOCS_ENABLED` | unset → on unless `NODE_ENV=production` | Swagger UI at /docs |
| `SAFE_FETCH_MAX_BYTES` | `5242880` | safeFetch body ceiling (Stage 8 08d) |
| `SAFE_FETCH_MAX_REDIRECTS` | `3` | redirects followed, each re-checked (ours) |
| `SAFE_FETCH_TIMEOUT_MS` | `10000` (N-43, `NUMBERS.FETCH_URL_TIMEOUT_MS`) | whole fetch deadline |
| `SAFE_FETCH_GROUNDING_MAX_REDIRECTS` | `8` | grounding redirect cap (ours, review fix 3) |
| `SAFE_FETCH_CONNECT_TIMEOUT_MS` | `3000` | one connect attempt before the next checked address (ours, review fix 1) |

### Review round 1 fixes

1. Address fallback: `safeFetch.test.ts` › "first address fails to connect → the next checked one
   is used, IPv4 first, one lookup only"; "a dual-stack host whose first answer is AAAA falls back
   to IPv6 only after IPv4 fails"; "never tries a blocked address, and does not move on after a
   non-connect failure"; "the real transport reports a refused connect as ConnectError".
2. Truncate instead of refuse: `webFetch.test.ts` › "returns a 6 MB page cut at the ceiling, marked
   truncated, reading no further"; `safeFetch.test.ts` › "reads at most the ceiling and says the
   body was cut".
3. Grounding cap: `providers/groundingRedirects.test.ts` › "resolves a 5-hop public chain"; "takes
   the configured grounding cap (8) by default, above web_fetch's 3"; "a hop to 169.254.169.254 is
   still refused and the citation stays unresolved". `grounding.ts` (Worker A's file) gained an
   optional third argument on `resolveUrls`; `gemini.ts` is unchanged.

### Review round 2 fixes

1. Connect timeout and deadline: `safeFetch.test.ts` › "an address that never connects times out
   after the connect timeout and the next is used"; "the overall deadline stops the address loop
   with a timeout; later addresses are never tried".
2. Cut inside a block: `webFetch.ts` drops an unclosed `<script`/`<style` block to the end of the
   text after the closed ones are stripped. `webFetch.test.ts` › "a truncated page ending
   mid-script yields no script text".
| `SANDBOX_SIGNING_SA` | unset | Cloud Run Job sandbox URL-signing account; no code default |

### Cross-ownership and shared-file edits

- `backend/src/providers/grounding.ts` (Worker A): import of `safeFetch` and the two fetch lines
  in `resolveOne` (+ `response.cancel()`), nothing else.
- `backend/src/services/webFetch.ts`: rewritten onto safeFetch (call-site file; `isForbiddenHost`
  removed — no other caller). Constructor stays compatible with `new WebFetchService()` in
  `generation.ts`, which is unchanged.
- `backend/src/tools/sandbox/cloudRunSandboxClient.ts`: the identifier default removed (item 5).
- `backend/src/container.ts` (shared): one added option line `signingSaEmail: cfg.SANDBOX_SIGNING_SA`
  inside the Cloud Run sandbox options (not at the end of a block; smallest edit possible).
- `backend/src/config.ts` (shared): new keys appended at the end of `envSchema`; `docsEnabled`
  appended to the `Config` interface and to `loadConfig`'s return object.
- `backend/src/config/numbers.ts`, `backend/src/errors.ts` (`origin_not_allowed`),
  `arcnave-frontend/src/api.ts` (`errorCopy.origin_not_allowed`): appended at the end of the block.
- Existing test to watch in the full run: `chats.integration.test.ts` "omits the CORS origin
  header for an origin that is not allow-listed" now gets 403 from the Origin check; it asserts
  only the missing ACAO header, so it should still pass.

## tech-build.3 — Part D (Worker D): file pipeline review fixes

ADR: [ADR-0066](../decisions/0066-file-pipeline-review-fixes.md). Base 583d449. Model used:
Claude Opus 5.5 (whole part; high-risk items: executor/claim, DB transaction).

### Evidence per item

Commands (backend): `npx tsc --noEmit` clean;
`TEST_DATABASE_URL=postgres://arcnave:arcnave@localhost:5432/arcnave_test_d npx vitest run <file>`.

| Item | Proof (file › test) |
|---|---|
| D0a | `src/routes/fileReviewFixes.integration.test.ts` › "a real password-protected workbook (D0a) › ends `failed` with errorCode `encrypted`" (fixture `docs/ops/build-2-fixtures/11-encrypted-password-test.xlsx`, genuine: olefile lists `EncryptionInfo` + `EncryptedPackage`; msoffcrypto decrypts with `test`) |
| D0b | `docs/architecture/00-Handoff/00-lawyer-list-addendum-2026-10-16.md` (LW-56) |
| D0c | DEFERRED lines below |
| D1 (M2) | `src/services/attachments/untrustedTools.test.ts` › "pdfinfo, pdftotext and pdfimages run with PATH and TMPDIR only"; "the parser child for an Office file carries no secret"; "a real recording: both tools carry no secret, -nostdin and the whitelist before -i"; "an ID3 tag followed by an m3u8 playlist pointing at file:///etc/hostname yields nothing from that file"; "the whitelist stops a playlist from fetching a URL"; "argument order"; "no file in services/attachments or routes/files.ts calls execFile, spawn, mkdtemp or os.tmpdir() itself". Real-ffmpeg block runs when ffmpeg exists or CI=true; on CI without ffmpeg its beforeAll throws (fails, not skips). |
| D2 (M3+N1) | `src/services/attachments/preflightPass.test.ts` › "refuses a member that declares 1 KB and really inflates to 200 MB of zeros, with bounded memory"; "a parser never runs on a document that failed the pass" (spawn spy = 0, control = 1); "stops at the total cap (N-10)…"; "has a wall clock…"; "refuses a DOCX whose document.xml has a 10 KB comment before <!DOCTYPE"; "finds an entity declared deep in a UTF-16 part"; "finds a marker split across two inflate chunks"; "real documents still pass" (04 docx, 05 pptx, 06 xlsx); existing `isolatedExtract.test.ts` preflight cases still pass. Preview: `fileReviewFixes.integration.test.ts` › "a workbook that failed the pre-flight is never parsed by the preview (M3)". |
| D3 (N3) | `fileReviewFixes.integration.test.ts` › "a failed enqueue leaves the file `uploading` with no job, and complete can be called again" (failure injected after the job insert + status move); "a file orphaned in `queued` past the grace period gets a job on its next poll; a fresh one does not" |
| D4 (N4) | `fileReviewFixes.integration.test.ts` › "complete never opens the object; the job puts the SHA-256 on the row" (spies on `openRead`/`get`/`downloadTo`); "an object replaced between complete and the job fails `corrupt`, before any scan"; existing `fileDerivatives.integration.test.ts` › "the bytes read are the bytes checked at complete (D1 #35)" still passes |
| D5 (N5) | `fileReviewFixes.integration.test.ts` › "notes.md / table.csv / plain.txt that mentions %PDF- at line 5 is read as text"; "a real PDF with junk before its header, declared .pdf, still reads" |
| D6 (M1) | `fileReviewFixes.integration.test.ts` › "two large jobs queued never run together, and both finish" + "control: under the threshold the same pair does run together"; "the job's directory is made under the configured root" |

Regression run (not the full suite): `src/services/attachments/` + the 13 file-related route
integration files (fileIngest, filePipeline, fileDerivatives, fileSafety, fileGuards, files,
fileReading, attachmentBudget, attachmentContinuity, projectKnowledge, projects, sheetPreview,
zipUpload) — 22 files, 236 tests, all pass.

Tests added: `fileReviewFixes.integration.test.ts` 13, `preflightPass.test.ts` 11,
`untrustedTools.test.ts` 7.

### Review round 2 (base a2cfdda)

| Item | Proof (file › test) |
|---|---|
| r2 #1 EPUB 2 NCX DOCTYPE refused | `preflightPass.test.ts` › "EPUB members: one lenient rule, every member scanned (review r2)" › "accepts an EPUB 2 toc.ncx with its NISO DOCTYPE"; "refuses the same NCX with an internal subset"; "keeps .xml/.rels/.vml strict inside an EPUB" |
| r2 #2 EPUB members chosen by extension | same describe › "refuses an entity-laden chapter named ch1.xht"; "refuses an entity-laden chapter with no extension" (also under a `.zip` name, by layout); "accepts a normal EPUB with images, a font and a stylesheet" |
| r2 #3 unclassified errors lost their retry | `untrustedTools.test.ts` › "a provider error whose code says a retry cannot help (quota unavailable) is asked once per piece"; "a retryable or unclassified provider error, or any other failure, gets its one retry" (a default `ProviderError` and `provider_timeout` with `retryable: false` are asked twice) |

Decision (mine): `context_overflow` is in the no-retry set beside `provider_quota_unavailable` and
`model_unavailable`: the identical piece overflows again. ADR-0066 §8 records the amendments.

### Reproduction (every finding holds)

See ADR-0066 "ArcNave before this ADR": M1, M2, M3, N1, N3, N4, N5 all reproduced from the code at
583d449 (N5 also by running `sniffBuffer` on a .md that mentions `%PDF-`: `unsupported_type`).

### Decisions taken on my own

- ffprobe has no `-nostdin` (6.1: "Option not found"): stdin is closed for every tool instead;
  ffmpeg gets `-nostdin` as well.
- The parser child keeps `NODE_ENV` beside PATH/TMPDIR (not a secret; the child imports API
  modules). Test pins its env keys to exactly these three.
- On ffmpeg 6.1 the hostile playlists are already refused without the whitelist (HLS probe needs a
  playlist extension; `allowed_extensions`; nested default `file,crypto,data`). The whitelist is
  kept as version-independent pinning; no control case can show it alone on 6.1 (recorded in ADR).
- Pass read step 4 KB (ours) → ~4 MB max per inflate step. Wall clock 120 s (ours).
- `.xhtml`/`.opf` in EPUB are not DTD-scanned (XHTML legitimately has `<!DOCTYPE html>`).
- The workbook preview (`GET /files/:id/preview`, in-process ExcelJS) now requires `ready`, so a
  file that failed the pass is never parsed there (`file_not_ready`, existing code).
- `retry` got the same one-transaction enqueue as `complete`. `enqueueProjectFile` also takes an
  optional tx (used by orphan reconcile); `routes/projects.ts` callers are unchanged (not mine).
- Orphan grace measured from the row's `created_at` and the last job's `updated_at`.
- The job overwrites the row's checksum with the checksum of the bytes it read (a retry of a
  stripped PDF reads the stripped bytes); the derivative stores the checksum of its input.
- `FILE_TMP_DIR` is process-wide (`workDir.ts`), set when the file service is built; `pdfPages.ts`
  (used by generation) follows it too.

### Not done

- Sync reads in a request (multipart `POST /files`, `FILE_PIPELINE=sync`) are not counted by the
  one-large-job limit (they are not jobs).
- `routes/projects.ts` project upload/replace still insert-then-enqueue in two statements (not my
  file); the orphan reconcile covers a crash between them for project files too.
- Deploy config unchanged (as briefed).

### DEFERRED lines (for main to paste into docs/ops/audit/DEFERRED.md)

- tech-build.3 D0c: the documents upload limit 500 → 100 MB (N-10 says docs 100 MB) awaits the
  owner's explicit OK; unchanged.
- tech-build.3 D0c: `FILE_JOB_LEASE_MS` stays 15 min until the owner decides (ADR-0063 Decision 2).
- tech-build.3 D6: a lapsed lease consumes an attempt: when a heartbeat is starved (request-based
  CPU) and the lease lapses, the next claim counts `attempts + 1`, so a healthy-but-starved job can
  burn its N-44 attempts and end `timeout`. Fix candidates: do not count a takeover of a job whose
  stage advanced recently, or `--no-cpu-throttling`.
- tech-build.3 D1: consider `-format_whitelist` (demuxer allow-list per declared type) for
  ffmpeg/ffprobe as a further hardening (ours; not built).

### mistakes.md lines (for main)

- **2026-10-16 (tech-build.3 D1) — No new heading.** I wrote the real-ffmpeg test with a "control"
  that runs the same hostile playlist without `-protocol_whitelist` and expects the HTTP fetch;
  it failed: ffmpeg 6.1 already limits a local playlist's segments to `file,crypto,data` and
  refuses a playlist without a playlist extension. Rule: before asserting a security flag's
  effect, run the tool without it and read what it does; record when the default already
  protects. Verify: `untrustedTools.test.ts` › "the whitelist stops a playlist from fetching a URL"
  (no control) and ADR-0066 Decision 1.
- Also: ffprobe rejects `-nostdin` ("Option not found") although ffmpeg takes it; a flag list
  shared between ffmpeg and ffprobe broke ffprobe. Verify: `untrustedTools.test.ts` › "argument order".

### Live checklist steps (Part D) — owner, after merge

1. **Encrypted workbook.** In the app, attach `docs/ops/build-2-fixtures/11-encrypted-password-test.xlsx`.
   Expected: the chip ends with "This file is protected by a password…". Failure: it reaches
   `ready`, or shows "could not be opened" (corrupt) instead.
2. **Markdown that mentions a PDF header.** Make `notes.md` whose fifth line is
   `The header %PDF-1.7 starts every PDF file.`; attach it, ask "what does line 5 say?".
   Expected: ready, and the answer quotes the line. Failure: "The content of this file does not
   match its name (.md)".
3. **Complete answers quickly for a big file.** Attach a ~200 MB audio or video file. Expected:
   after the upload bar finishes, the chip moves to "queued/reading" within a couple of seconds
   (the request no longer hashes the file). Failure: the chip sits at 100 % for many seconds before
   moving. Then check the row has its checksum once ready:
   `gcloud logging read 'resource.labels.service_name="arcnave-sandbox-service" AND jsonPayload.msg="file job finished"' --limit 5 --freshness 15m --project <project>` shows the job.
4. **Bomb document refused.** Attach a DOCX bomb (any small `.docx` whose ZIP holds a member that
   inflates hugely, e.g. made with `python3 -c` from the test's recipe). Expected: `failed` with
   "expands far more than normal documents do". Failure: the instance restarts (OOM) or the file
   reaches `ready`.
5. **Memory limit and CPU (read-only, no change).**
   `gcloud run services describe arcnave-sandbox-service --region asia-south1 --format="value(spec.template.spec.containers[0].resources.limits)"`
   Expected: memory larger than 3 × the largest file you allow + 1 GiB (500 MB audio → ≥ 2.5 GiB)
   while `FILE_TMP_DIR` is unset (in-memory `/tmp`). If smaller, raise memory or set `FILE_TMP_DIR`
   to a mounted volume. For long OCR/audio jobs consider `--no-cpu-throttling` (ADR-0063 Decision 2;
   a cost decision). Failure signal: Cloud Run logs "Memory limit of … exceeded" during large uploads.
6. **Two large files at once.** Attach two files over 100 MB together. Expected: both finish; the
   second starts reading after the first (its chip stays "queued" meanwhile). Failure: an OOM
   restart, or one stuck `queued` for more than a few minutes after the other is ready.

### New config / env variables (all ours)

| Variable | Default | Meaning |
|---|---|---|
| `FILE_TMP_DIR` | `''` (= `os.tmpdir()`) | root of every working copy the file pipeline makes |
| `FILE_LARGE_JOB_BYTES` | `104857600` (100 MB) | above this, at most one job per instance at a time |
| `FILE_ORPHAN_GRACE_MS` | `60000` | a `queued` file with no live job this long gets a job on its next poll |
| `ZIP_PREFLIGHT_TIMEOUT_MS` | `120000` | wall clock of the ZIP pre-flight streaming pass |

No migration. No new npm dependency. msoffcrypto-tool / openpyxl / olefile were used once, in a
scratch virtualenv, to make the fixture; they are not project dependencies.

### Cross-ownership edits

- `backend/src/config.ts` (shared, append-only): four variables appended at the end of the schema.
- `backend/src/test/fixtures/archives.ts`: `RawEntry.compressed` (optional, additive) for a
  pre-compressed bomb body.
- `docs/decisions/0062-…md`, `0063-…md`: status lines only, pointing at ADR-0066.
- `services/attachments/pdfPages.ts` (mine by path; called from Worker A's `generation.ts`):
  now runs poppler through `runTool` and makes its directory under `FILE_TMP_DIR`; no signature change.

## build-3 Part C (Worker C) — P05 behaviour-neutral split of the turn code

Base 0264b08. Model: Opus 5.5. ADR: [ADR-0067](../decisions/0067-turn-code-split-by-stage.md)
(supersedes nothing).

Commits on this worktree branch (main squashes later; two commits for the proof):

- **A** `92554f6` `test(build-3-c): characterization snapshots before the split` — only
  `backend/src/test/turnCharacterization.integration.test.ts` and its `.snap`, on the unsplit code.
- **B** `wip(build-3-c): …` — the split, this file and ADR-0067. `git diff A B -- '*.snap'` is
  empty; the snapshot tests pass without `-u`.

Checks run (all with `TEST_DATABASE_URL=…/arcnave_test_c`): `npx tsc --noEmit` clean; the
characterization file (14 tests) green 4 runs in a row on A and green on B; the files that import
the moved code (`attachmentContent`, `retryPolicy`, `batch6ContextRegression`,
`batch6OverflowStreamingSafety`, `codeExecutionExecutor`, `visualDraft`) plus `chats`,
`gatewayTurn`, `runResume`, `brandNeutral`, `identifierGuard`, `contentLeak`: 13 files, 139 tests
green; full backend suite on B: see "Full suite" below. No existing test was edited.

### Evidence per item

| # | Item | Proof (file › test) |
|---|---|---|
| 1 | Characterization before moving code | `src/test/turnCharacterization.integration.test.ts` (commit A): › "plain chat, two turns", › "chat with files: a text file, then an image, then a follow-up", › "a tool-loop turn", › "a tool loop that ends with no text gets one forced answer", › "a transient failure is retried, then succeeds", › "a failure after a tool ran ends the turn partial" (Part A's `partial_after_tool_run`), › "a refused turn", › "a provider failure that is not retried", › "a turn blocked before the stream opens (code execution on a model without it)", › "a regenerated reply (retryMessageId) replaces the earlier attempt", › "turn-start refusals: ownership, retry target and file rules" (404 unknown / other user's chat, 404 unknown retry target, 422 retry of a user message, 409 `file_already_attached`, 409 `too_many_files` at N-10's 20 per chat), › "a Gemini turn with a file and one tool round" (real `GeminiProvider`, fake SDK client: every `generateContentStream` request), › "a Claude turn with a file and one tool round" (real `AnthropicProvider`, fake client: every `messages.stream(params, options)`), › "every long text and large structure the scenarios referenced, by sha256". Each snapshot holds the provider requests, every SSE frame, and the rows written (messages, tool calls, research events, attachments, usage ledger). |
| 2 | Snapshots byte-identical after the split | `git diff 92554f6 <B> -- '*.snap'` empty; the file passes on B without `-u` |
| 3 | `generation.ts` split by stage, old imports kept | `services/turn/{services,events,input,context,contextAttachments,contextPrompt,modelRouting,toolset,providerLoop,persistence}.ts`; `generation.ts` 2,458 → 914 lines and re-exports every name it exported (the six test files that import from it pass unchanged) |
| 4 | Turn start moved to a turn service, route thin | `services/turn/turnStart.ts` (`loadChat`, `startTurn`, `appendTurn`, `resetForRetry`, `loadTurnAttachments`, `markTurnFailed`); `routes/chats.ts` 1,240 → 1,028 lines; same SQL, same transaction, same errors and status codes (item 1's "turn-start refusals" snapshot) |
| 5 | Full suite passes unchanged | "Full suite" below |

### Normaliser (documented in the test file's header)

Only volatile values are replaced, never payload content: UUIDs → `<uuid-n>` (numbered by first
appearance, so equal ids stay equal), storage keys → `<storage-key>`, ISO timestamps → `<iso>`,
the system prompt's date line keeps its time zone but not the day; the abort signal and the tool
executor (live objects) → `[ClassName]`. Strings over 1,000 characters, and structures below a
scenario's top three levels whose JSON passes 4,000 characters (tool declarations, the prompt
assembly), are stored once in the last snapshot and referenced by sha256, so the 2.6 MB of
repeated tool schemas became one 490 KB file with every byte still compared.

### Glue lines that changed (everything else is cut/paste, indentation aside)

Listed by `glue.py` (a line-multiset comparison of the old and new files after reading `this.x`
as `svc.x`); the categories:

1. Signatures: 17 methods became `export [async] function[*] name(svc: TurnServices, …)`.
2. Call sites in `runTurn`: `this.m(…)` → `m(this.svc, …)` (21 calls); in moved bodies
   `this.x` → `svc.x`.
3. `this.reduceHistoryForOverflow(h)` (a private method that only delegated) →
   `reduceHistoryForOverflow(h)`; the method is gone.
4. `await this.previousContextTokens(input)` → `await previousContextTokensOf(this.svc, input)`:
   import alias, because `runTurn`'s `const previousContextTokens` would shadow the function.
5. Two blocks cut out of `runTurn`: the skills context (now
   `const { skillsContext, loadedSkills, skillsEnabled } = await buildSkillsContext(this.svc, input, activeToolNames, latestCompaction);`)
   and the tool executors (now `const { pendingUiEvents, toolMap, codeExecutor, toolExecutor } = buildToolExecutors(this.svc, { … })`).
   Each function returns what the block declared.
6. `const segments: MessageSegment[] = [];` (with its two comment lines) moved up from after the
   request build to just before `buildToolExecutors`, which takes it. A declaration of an empty
   array; no await or side effect moved.
7. `function isTurnDeadline` → `export function isTurnDeadline` (now used across modules).
8. Constructor: `this.svc = { db, cfg, registry, usage, retriever, storage, sandboxClient, skills, capabilities: this.capabilities, executionRuntime: this.executionRuntime, modelInputs }` and its field.
9. Route: `if (activeRuns.has(chat.id)) throw …; const assistantMessageId = retryMessageId ? … : …`
   → `startTurn(request, chat.id, user.id, { prompt, mode, attachmentIds, retryMessageId })`
   (the check is the same, before any write); the attachment read →
   `loadTurnAttachments(db, user.id, attachmentIds)` (`user.id` → `userId`); the failed-row update
   → `markTurnFailed(db, assistantMessageId, mode, body.code, request.log)` (`assistantMessageId`
   → `messageId`, `body.code` → `code`, `request.log` → `log`).
10. `loadChat`, `appendTurn`, `resetForRetry`: `request: { services: AppInstance['services'] … }`
    → `Pick<AppInstance['services'], 'db'>`; bodies unchanged.
11. Each moved module that logs has its own `const log = logger.child({ module: 'generation' })`.
12. Imports and re-exports.

No guard test reads `generation.ts` or `chats.ts` by path (`brandNeutral`, `identifierGuard`,
`untrustedTools` walk directories, which include `services/turn/`), so no path list changed.

### Decisions taken on my own

- Layout names: `services/turn/` with one file per stage; context build is three files (inputs
  and history; attachments; prompt and skills) to keep each under ~300 lines.
- `runTurn` stays one generator: the stream loop, forced answer and settle share ~15 mutable
  locals; splitting them needs state objects, which is not a mechanical move (ADR-0067).
- `loadChat` (chat ownership, used by all 9 chat routes that load a chat) moved into the turn service with the
  turn start, as the brief lists ownership; the routes import it.
- The characterization file lives in `src/test/` (cross-cutting, route-level) rather than under
  `services/turn/`, so it existed before the split did.
- Several files in one message are snapshotted only as responses and rows, not requests: their
  order in the request is the database's row order (no `ORDER BY`), which is unstable — found when
  the second run of the file-limit scenario failed. The files scenario sends one file per message.

### Not done, and why

- D3's `streamAndCollect` / `settleTurn` extraction: not mechanical (above). P07/P08 edit it.
- The unused `const api = new ApiError('provider_payload_limit')` in `mapProviderError`, the
  attachment order, the "file is too large to send whole" label the Claude wire gives a 30-byte
  text file, and `appendTurn` accepting another user's file id silently (200, file not attached):
  all seen in the snapshots, none changed (no logic change in P05). See DEFERRED.

### Cross-ownership / shared-file edits

None. `services/generation.ts` and the new `services/turn/**` are this part's per the brief.
`src/test/harness.ts` not touched.

### DEFERRED lines (for main to paste into docs/ops/audit/DEFERRED.md)

- `services/turn/turnStart.ts` `loadTurnAttachments`: the query has no `ORDER BY`, so a message
  with several files sends them in the database's row order, which can change between runs
  (seen in a characterization run). Order by the request's `attachmentIds` or `createdAt`; a
  prompt-cache and reproducibility fix, not done in P05 (behaviour-neutral). Owner: P07/P08.
- `appendTurn`: an `attachmentId` the caller does not own is skipped without an error; the turn
  runs as if it was never sent (characterization "turn-start refusals", "their file" → 200).
  Decide: 404 `not_found` for a foreign file id. Owner: P08.
- Claude wire labels a 30-byte text file "Excerpts … The file is too large to send whole"
  (characterization "a Claude turn with a file"); the fake-provider request says
  `wholeWithinBudget: true`. Check the label's condition in the Claude adapter. Owner: Worker A
  area (providers).
- `mapProviderError`: an unused `const api = new ApiError('provider_payload_limit')`. Remove when
  the gateway error map is next edited.

### mistakes.md lines (entry format)

- **2026-10-16 (tech-build.3 C, characterization)** — Symptom: the first characterization run
  wrote a 2.6 MB snapshot, and the second run of an identical scenario failed. Cause: every request
  repeats ~120 KB of tool schemas and prompt assembly; and a message with ten files is read with
  no `ORDER BY`, so its file order is whatever Postgres returns. Rule: run a new snapshot test at
  least twice before committing it, and store repeated large values once (by hash) rather than per
  request; a value a test cannot reproduce is a finding, not something to normalise away.
  Verify: `for i in 1 2 3 4; do npx vitest run src/test/turnCharacterization.integration.test.ts; done`
  is green each time; the `.snap` is under 0.5 MB.
- **2026-10-16 (tech-build.3 C, generated imports)** — Not a new heading. Generating each new
  module's imports by finding names in its text pulled in names that appear only in comments
  (`and`, `attachments`, `compact`); `tsc --noEmit` is clean with unused imports here. Rule: after
  generating or moving code, run `npx tsc --noEmit --noUnusedLocals | grep <new files>` and fix
  what it lists.

### Live checklist (owner, on the live service after merge; ADR-0063)

Behaviour-neutral, so the checks are that nothing moved:

1. Send "hello" in a new chat (Auto). Expect: a streamed answer, the chat renamed to "hello",
   the footer with tokens and cost. Failure: an error card, or the chat stays "New conversation".
2. Attach a small `.txt` and ask about it; then ask a follow-up without it. Expect: both answers
   use the file. Failure: "file not found", or the follow-up forgets it.
3. Press Regenerate on the last reply. Expect: a new answer replaces the old one in place, with
   no duplicated sources. Failure: two replies, or an error.
4. Send a message while a reply is still streaming in the same chat (second tab). Expect: 409
   `run_in_progress` card. Failure: two runs interleave.
5. Send the same file again in another chat. Expect: "This file is already in a sent message"
   (409). Failure: the send goes through.
6. Pick Sonnet 5.5, ask something that uses a tool (e.g. "ask me which of two options"). Expect:
   the tool card, then an answer. Failure: an error, or the tool card without an answer.
7. Cloud Run logs for one turn: the `turn timing` and `provider first event` lines still carry
   `"module":"generation"`. Failure: the module tag is missing or different.

### New / removed config and env variables

None.

### Full suite

Run once on commit B's tree, `TEST_DATABASE_URL=…/arcnave_test_c npx vitest run`:
`Test Files  132 passed (132)` · `Tests  1314 passed | 19 skipped (1333)`. No snapshot written or
updated. No existing test file was changed.

### Review round 1 (R1#2): regenerate clears the old attempt's tool calls

Separate from the moves; a deliberate behaviour change (ADR-0067 "Post-split fix").
`resetForRetry` deletes the message's `tool_calls` beside sources and research events.
Proof: `src/routes/regenerateToolCalls.integration.test.ts` › "keeps only the new attempt's call,
and the next turn replays only that one" (fails without the delete: the row left is `call_old`).
`turnCharacterization.integration.test.ts` passes unchanged without `-u`. References checked:
no FK to `tool_calls`; `messages.segments` (tool call ids) is reset to null in the same function;
display blocks are derived from the rows; artifacts (by chat) and presented files (attachments,
by message) are not keyed by tool call. Live check: run a turn that calls a tool, Regenerate it,
then download its turn log / reload: only the new attempt's tool card shows.
