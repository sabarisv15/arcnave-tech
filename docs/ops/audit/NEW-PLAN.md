# tech-audit.A — proposed build / rewrite plan (NEW-PLAN)

**Status: PROPOSAL. The owner decides.** Nothing here is decided; every phase that depends on an
owner answer names the question (OQ-xx, listed in [SUMMARY.md](SUMMARY.md) §6) and runs only after it.
Written by the main session (Claude Opus 5.5) from the audit files in this folder, 2026-10-15.

## How this plan was built

- Yardstick: [ADR-0061](../../decisions/0061-locked-decisions-win-outside-stack-and-infra.md) —
  every locked decision's outcome is met except tech stack and infra; how it is met is chosen by
  safety first, then least time. Owner-deferred items ([DEFERRED.md](DEFERRED.md)) are not
  scheduled except where a phase must leave a seam for them.
- Order: highest value first — file handling, AI output, architecture flaws — with two
  exceptions made for safety: the security quick fixes (P04) and a behaviour-neutral split of the
  two largest files (P05) come early because later phases would otherwise build on them.
- **Every** REWRITE / NEW-BUILD / DISCARD row of the 21 stage files (362 rows) is assigned to
  exactly one phase in Appendix A (mechanical, no row left out), and every D1 gap, D2 finding and
  D3 flaw in Appendix B. Each phase's "Covers" names the ids; the appendices hold the full list.
- Path per item = the auditor's pick in the source file unless a main-session check changed it
  (AUDIT-LOG §4). High-risk areas (gateway, auth, DB, file pipeline, layout) keep the app runnable
  at every commit: additive migrations, new path beside the old one, switch after a parity test.
- Model per phase follows the brief: **Opus 5.5** for gateway / auth / DB / file pipeline / layout;
  **Sonnet 5.5** for the rest; Haiku 5.5 only as a test runner.
- Size: S ≤ ½ day, M 1–3 days, L > 3 days (one Claude Code session with local checks). A phase
  marked L is still one prompt and one commit; split it if review prefers.
- Every phase ends with: `npx tsc --noEmit`, `npx vitest run`, frontend build + tests where touched,
  `npm run openapi` if a route schema changed, a CHANGELOG/CURRENT.md line, `mistakes.md` if
  something went wrong, and its own exit test below. No dev run or deploy without the owner (B-11).

## Phase 0 — owner answers (no code; can run beside P01–P04)

P01–P04 need no answer. The questions that unblock the most phases, in order:

| OQ | Question (short) | Unblocks |
|---|---|---|
| OQ-01 | Helper models (Haiku 5.5 router / jobs, Flash-Lite planner / judge / M9, Embedding 2, Ranking API) vs B-4 "three models only" | P10, P13, P15, P20, P25 |
| OQ-05 | Locked v3 prompt renderings vs repo prompt (and v3 tool vocabulary) | P07, P17 |
| OQ-08 | Token counting: provider count API (Invariant 3 allows it, AUDIT-LOG S-13) for files / budgets; estimator lines (N-75, OD-13) | P12, P13, P20, P22, P23 |
| OQ-10 | Hybrid retrieval now vs BM25 until the P2-D eval (Invariant 4, ADR-0059) | P12, P20 |
| OQ-12 | File types: ZIP route, legacy `.xls`, extra types, failed-file Send rule | P01 (one item), P06, P14 |
| OQ-15 | Repo numbers that differ from the register (turn deadline, rounds, output, message size, session, limits) | P06, P07, P10, P11, P18, P21 |
| OQ-14 | Warm shared sandbox vs fresh run per call; run_code time; tesseract | P18 |
| OQ-02 / OQ-16 / OQ-17 | Fallback chain under Invariant 1; ER-4 timers vs ADR-0024; RFC 9457 body | P11 |
| OQ-03 | Passwordless invite-only (ADR-0010) vs password + Google (ADR-0056) | P25 |
| OQ-25 | `company_id` (nullable) on tables built from now on; message text / metadata split now | P06, P08, P12, P13, P15, P20, P22 |

## Phases

### P01 — File pipeline fixes that lose or corrupt content (F1)
- **Scope:** claim guard `message_id IS NULL` (D1 #18); reference check before deleting project-file bytes (D1 #17); a picked project file carries its text, page count and status (D1 #19); Unicode tokenizer `\p{L}\p{M}\p{N}` + NFC at index and query time, no language logic (D1 #12a, LANG-1); the 400-chunk cap becomes an explicit warning and moves to E4 (~2,000) (D1 #12b); guard `pdftotext` → `unreadable` (D1 #34); server 409 `file_not_ready` for a non-ready attachment, Send disabled, Retry + Remove on chips, delete the "sent without their text" disclaimer (D1 #2, DISCARD D1-D3); `error_code` column + ER-9 copy table, no raw `String(err)` to users (D1 #23).
- **Covers:** Stage 1 FT-10 · Stage 15 ER-9 · Stage 12 L-01 · D1 #2, #12a, #12b, #17, #18, #19, #23, #34, D3 · spot-check S-05.
- **Path:** REWRITE in place (D1 picks A). Additive column; guards only.
- **Model / size / deps:** Opus 5.5 (file pipeline) · M · none.
- **Blocked by:** OQ-12 only for the failed-file rule (AS-D6 "processing blocks Send" vs FG3 "failed must be removed first"); the rest is unblocked.
- **Exit test:** new integration tests — Tamil and Hindi chunks are found by project search; a file with > 400 chunks reports a visible warning; claiming an already-claimed attachment → 409; deleting a project file leaves a picked chat attachment readable in the sandbox; a picked project DOCX reaches a no-sandbox turn as text; generate with a non-ready attachment → `file_not_ready`; a corrupt PDF in history → `unreadable`, not "storage unavailable".

### P02 — Context and retry defects in the gateway (A2)
- **Status (2026-10-16):** built in tech-build.3 Part A on `build/gateway-security` ([ADR-0064](../../decisions/0064-gateway-history-and-retry-defects.md), [build-3-result.md](../build-3-result.md)); not merged. X-4 option B not built (owner decision); ER-2b resume-from-round deferred.
- **Scope:** remove Gemini tool-result clearing (or default the trigger off) and record the supersession of ADR-0031 §5 (D2 X-1, H4-A; ADR-0023); load history with the resolved model, not `Auto` (X-2); omit blocked / errored / empty exchanges from history (X-3, H6-A, Stage 6 doc-sync R-3); retry gate counts tool and thinking events so executed tools never run twice — continue from the failed round or end with the partial (ER-2b); Gemini errors classified by status (502 / 408 / 409 retryable, quota-0 429 = configuration, no loop) (ER-2e); `@google/genai` retries explicitly off + guard test (ER-1b, VS-29b); duplicate failed-call guard in the Gemini loop (X-10); `describeMedia` output cap + finish-reason check (X-7); escape the filename in `<document filename>` (X-9); Claude thinking replayed with signatures (CC4 / MR10).
- **Covers:** Stage 15 ER-1b, ER-2b, ER-2e · Stage 20 VS-29b · D2 X-1, X-2, X-3, X-4 (option B only if the owner wants it), X-7, X-9, X-10, CC4 · S-02, S-03, S-09, S-10.
- **Path:** REWRITE (D2 H4-A / H6-A, G4 stage-15 picks).
- **Model / size / deps:** Opus 5.5 (gateway) · M · none.
- **Blocked by:** OQ-09 only to confirm ADR-0023 is reinstated for Gemini (the D2 pick).
- **Exit test:** offline tests from D2 §4 — `loadHistory` with `Auto` and 600 k chars of tool results keeps the earliest turn; a Gemini request with `previousContextTokens: 120000` carries every function response unchanged; a provider failure after a tool-only round does not call the tool again (spy); Gemini 502 retried, quota-0 429 not; the `GoogleGenAI` client is constructed with retries off.

### P03 — Measure answer quality before changing it (A1)
- **Scope:** bring the 68 Stage 6 cases into the repo (needs OQ-31) and run them data-driven: offline wiring in vitest, `LIVE=1` against the three models with a cross-vendor judge (CXD-7), report-only until calibrated; golden request snapshots per provider for five canonical turns; per-section prompt and tool-declaration size budgets; a grep guard for `temperature|top_p|top_k`; repair the stale live scripts (X-6); an `lv1/`-style results folder for live checks (S21-03); live provider conformance suite as a dev-run-only script (E15).
- **Covers:** Stage 6 CXD-7 · Stage 21 S21-05, S21-03 · Stage 4 E15 · D2 H7, X-5, X-6, §6 gaps 1–9 · D3 A-27 (quality part).
- **Path:** NEW-BUILD beside the derived kit; the derived kit's string checks are retired only when the new runner is green.
- **Model / size / deps:** Sonnet 5.5 · M · none.
- **Blocked by:** OQ-31 (copy the JSON into the repo); OQ-32 (which turns were poor — used to pick the five snapshot turns).
- **Exit test:** `npx vitest run` executes the 68 cases' offline structure checks; `LIVE=1 npm run eval:prompt` (owner-run, never in CI) prints a per-case table with C-gate status; snapshot and size-budget tests fail on an unplanned prompt change.

### P04 — Security and platform quick fixes (B1)
- **Status (2026-10-16):** built in tech-build.3 Part B on `build/gateway-security` ([ADR-0065](../../decisions/0065-edge-security-and-platform-quick-fixes.md), [build-3-result.md](../build-3-result.md)); not merged. Frontend fallback URL (PH-4 web half), COOP/CORP, CSP enforcement and SD-1d logout-all deferred.
- **Scope:** SSRF: resolve DNS and check every address (IPv4, IPv6 incl. `[::1]`, mapped, link-local, metadata), follow redirects manually with a check per hop, 5 MB cap (D3 A-08, INJ-7); rate limit: `trustProxy` for Cloud Run and a per-user key computed after the session hook (A-09, 3:1.5); `requireAuth` on `/models` and `/models/refresh` (S2-3); Origin / `Sec-Fetch-Site` check on state-changing routes incl. the body-less POSTs (SD-1f); SD-1d route; identifiers out of code — the service-account default and the project-numbered production URL move to config, with a guard test (PH-4, S21-11, A1 rule); security headers on web and API (PH-2); Swagger UI off in production, `/health` with `/healthz` kept as alias (VS-2b, S19-17); a failed migration stops the container (S19-14, A-10).
- **Covers:** Stage 2 S2-3 · Stage 3 1.5 · Stage 16 INJ-7, SD-1d, SD-1f, PH-2, PH-4 · Stage 19 S19-14, S19-17 · Stage 20 VS-2b · Stage 21 S21-11 · D3 A-08, A-09, A-10 · S-01, S-07, S-08, S-12.
- **Path:** REWRITE (D3 picks A). The cookie stays `SameSite=None` until OQ-19; the Origin check is what protects it meanwhile.
- **Model / size / deps:** Opus 5.5 (auth / platform) · M · none.
- **Blocked by:** none.
- **Exit test:** fetches of `http://[::1]/`, a name resolving to 10.x and a redirect to 169.254.169.254 are refused before a byte leaves; unauthenticated `GET /v1/models` → 401; cross-site `POST /v1/auth/logout` → 403; two users behind one proxy address get separate buckets; the identifier guard fails on a planted project id; the container exits non-zero when `migrate` fails.

### P05 — Behaviour-neutral split of the turn code (B4a)
- **Status (2026-10-16):** built in tech-build.3 Part C on `build/gateway-security` ([ADR-0067](../../decisions/0067-turn-code-split-by-stage.md), [build-3-result.md](../build-3-result.md)); characterization snapshots stand in for P03's golden snapshots until P03 lands; not merged.
- **Scope:** split `services/generation.ts` (2,381 lines, one 830-line generator) by stage — context build, routing, provider loop, persistence — and move turn start (`appendTurn`, `resetForRetry`, file-count rule, ownership) from `routes/chats.ts` into a turn service. No behaviour change; P07, P08, P10, P11, P13 and P15 all edit this code next.
- **Covers:** Stage 2 S2-4, RL2 · D3 A-13, A-14.
- **Path:** REWRITE, mechanical moves only, tests unchanged.
- **Model / size / deps:** Opus 5.5 (layout refactor) · M · after P02 (so its fixes move with the code).
- **Blocked by:** none.
- **Exit test:** the full backend suite passes unchanged; P03's golden request snapshots are byte-identical before and after.

### P06 — File state machine and isolated extraction (F2)
- **Scope:** `file_jobs` table + in-process worker with a `FOR UPDATE SKIP LOCKED` lease; `/complete` → 202 and the chip polls; states queued / scanning / extracting / ocr / transcribing / indexing / ready / failed + `error_code`; small-file fast lane; the synchronous path stays behind a flag until parity (D1 #3, PIPE, RETRY, LIFE-MORE, D3 A-20); extractors in a child process with memory and time limits and a pre-flight (ZIP central-directory ratio, XML DTD refusal), SheetJS replaced (D1 #7, ISOLATION, DS-3b first step, VS-16); encrypted detection (D1 #6, FT-11); magic-byte sniff and macro / legacy refusal with the locked "save as" text (D1 #4, INTAKE, FT-2, FT-3, FT-12, FL-5); per-type limits from N-10 in `config/numbers.ts` (D1 #14, LIMITS, FT-7); per-user upload quota (D1 #24, FT-15); chip shows stage and warnings (D1 #27). DISCARD D1-D1 (memory-per-byte table, `oneAtATime`) after parity.
- **Covers:** Stage 1 FT-2, FT-3, FT-7, FT-11, FT-12, FT-15 · Stage 2 DS-3b · Stage 9 PIPE, INTAKE, LIMITS, ISOLATION, RETRY, LIFE-MORE · Stage 16 FL-5 · D1 #3, #4, #6, #7, #14, #24, #27, D1 · D3 A-20.
- **Path:** NEW-BUILD beside the old path, then switch (D1 picks).
- **Model / size / deps:** Opus 5.5 (file pipeline, DB) · L · P01.
- **Blocked by:** OQ-12 (`.xls`, extra types), OQ-15 (limit values), OQ-25 (`company_id` on `file_jobs`).
- **Exit test:** upload → 202 → states observed by polling; a worker killed mid-job is resumed after lease expiry; a decompression-bomb DOCX is refused in pre-flight without memory growth; `.docm` → refusal with save-as text; password XLSX → `encrypted`; per-type limits enforced in `checkUpload` and `validateFile`; three concurrent uploads no longer serialise.

### P07 — System prompt to the locked renderings (A3)
- **Scope (if OQ-05 = locked v3):** port the v3 Gemini and Claude renderings (`arcnave.in:prompts/system/v3/`) with a sha256 version stamp, chosen per provider, the old builder behind a switch until the A/B passes (D2 H1-A); first content change = completeness and "ask only for missing essentials" (ST-2 / S18, ST-7, H2-A); session and turn blocks, `<current_time>` IST, user-turn order, `<` → `&lt;` escaping on all untrusted text, per-provider layout (SR-*); identity / `<model_info>`, `<capabilities_state>`, India set (helplines, SEBI, ECI), HO / SA / TI / WS / TO / AR / SK lines (PS-*); precedence ladder and instruction caps (CXD-2, F6); skills mandate narrowed (H5-A); `Asia/Kolkata` default + time of day (H8-A); Gemini explicit cache and one Claude breakpoint (FD-26, DS-3, SR-CACHE-G, N-74c); research directive reconciled with the no-headers rule (X-8). **If OQ-05 = keep the repo prompt:** D2 H1-B (per-provider static base, Gemini critical rules first, base cut to ≈ 6.5 k tokens) plus an ADR recording the deviation.
- **Covers:** Stage 6 CXD-1, CXD-2, CXD-3b, SR-*, PS-* (31 rows) · Stage 4 F6 · Stage 15 DS-3 · Stage 18 FD-26, N-74c · D2 CXD-3b, GEM-1, ST-2/S18, ST-3, ST-4, ST-7, ID-1/2, CXD-1, AU/UC, LAY-1, TI-1, HO-4/FI-2, SA-2/PT-3/PT-4/WB-1, X-8, Doc-sync 2026-10-10 display · S-06.
- **Path:** NEW-BUILD beside the old builder (A) or REWRITE (B), per OQ-05.
- **Model / size / deps:** Opus 5.5 · L · P03 (measure before and after), P05.
- **Blocked by:** OQ-05, OQ-06 (tool vocabulary the renderings name), OQ-07 (language paragraph), OQ-15 (caps), OQ-23 (math delimiter, cutoff line), OQ-27 (cache breakpoint).
- **Exit test:** P03 offline C-gates 100 %; an owner `LIVE=1` run on the 68 cases shows no regression and S18 / Y2 / Y3 / S10 pass on Gemini 3.8 Flash; static base within its size budget; snapshots updated deliberately in this commit.

### P08 — Durable runs, one turn per chat (B2)
- **Scope:** `turns` table with a partial unique index (one running turn per chat) and state (TB3, 1.7); DB lease + cancel flag (AO-4b; Stage 5 R13, Stage 10 AO-5); throttled text flush, tool calls persisted per call, a sweeper for rows left `generating`, SIGTERM drain inside Cloud Run's 10 s (D3 A-01/A-02, 7.3, S19-18); `Idempotency-Key` wired end to end (1.4, ER-10c); budget / policy check before the user message is saved, as an HTTP refusal (1.6); typed `ack` frame (1.8); one transaction settles message + sources + usage in one order; reservations get an owner and an expiry (6.1, A-05, A-06, A-21, A-22); regenerate guarded (A-04); SSE contract on the store — `Last-Event-ID`, `snapshot`, named `ping`, send timeout (D-26, D8); reconnect jitter (F3b, ER-10a); 60 s session re-check (D-29); one controller per chat in the tab (RG6); DB statement / lock / idle timeouts (H10, ER-6a, N-45); turn parameters persisted so a run loads from a message id (seam for the deferred Cloud Tasks executor, D-G3-02).
- **Covers:** Stage 3 1.4, 1.6, 1.7, 1.8, 6.1, 7.3 · Stage 4 D8, H10 · Stage 5 TB3, F3b · Stage 10 AO-4b, RG6 · Stage 14 D-26, D-29 · Stage 15 ER-6a, ER-10a, ER-10c · Stage 19 S19-18 · D3 A-01–A-06, A-21, A-22 · K-13.
- **Path:** NEW-BUILD (store + lease) beside the in-memory hub, which becomes a cache of the store; no Redis (D3 §4: no later rewrite if the hub stays the only publish seam).
- **Model / size / deps:** Opus 5.5 (DB, executor) · L · P05.
- **Blocked by:** OQ-25 (`company_id` on `turns`), OQ-31 (agree "sweeper + flush + drain" as the interim before Cloud Tasks).
- **Exit test:** two app instances on one database (two Fastify apps in one test) — concurrent generate on one chat → exactly one 409; a killed process leaves the turn `interrupted` with its flushed text; reconnect with `Last-Event-ID` replays only missing events; a repeated `Idempotency-Key` returns the same message; SIGTERM waits for the checkpoint.

### P09 — OCR, audio and images (F3)
- **Scope:** `OcrEngine` with per-page need-OCR detection (empty, `(cid:`, garbage ratio incl. legacy Tamil fonts), ≤ 15-page batches, own deadline, ≤ 1 retry, finish-reason check, per-page text + `ocr_engine` / `ocr_version`; Gemini engine now, Document AI engine plugs in later (D1 #8, OCR-M11); audio: `gs://` part now, then ffmpeg split 60–120 s with timestamps and a 3 h check (D1 #16, AUDIO, FT-6); images: normalised copy (EXIF strip / rotate, ≤ 2,576 px, ≤ 5 MB), HEIC (D1 #15, IMAGES, FT-5, FL-3); Claude uses the normalised copy and the 2,000 px rule (D1 #21, CLAUDE-IMG/PDF); large images and audio sent by `gs://` (D1 #32). DISCARD D1-D2 (single-call pdf-parse OCR) after parity.
- **Covers:** Stage 1 FT-5, FT-6 · Stage 9 OCR-M11, AUDIO, IMAGES, CLAUDE-IMG/PDF · Stage 16 FL-3 · D1 #8, #15, #16, #21, #32, D2.
- **Path:** NEW-BUILD behind interfaces (D1 picks A).
- **Model / size / deps:** Opus 5.5 (file pipeline) · L · P06.
- **Blocked by:** OQ-11 (Document AI in this pass?), OQ-14 (tesseract), OQ-29 (sharp + HEIC decoder, ffmpeg).
- **Exit test:** the unused `buildScannedPdf` fixture goes through upload → per-page OCR text → project search; a mixed PDF keeps text and scanned pages; a 150-page scan is readable; a 40 MB audio file is transcribed with segment timestamps; an 8 MB JPEG with GPS EXIF reaches Claude without error and the stored copy has no GPS.

### P10 — Routing and Fast / Normal / Deep profiles (A4)
- **Scope:** Auto rules to the lock — Gemini by default, Opus never by default, attachments no longer force Opus (RT-1, FD-09-L7, D2 H3-A); profiles → effort, tool steps (N-06), output ceiling (N-74), Deep → Sonnet / Opus (RT-4, PS-PR, O-2, MP-2, D2 H3-B); effort ladder with xhigh / max off (AG10); registry rows with role, fallbacks, effort map, thinking mode, max output, enabled, version stamped on every turn (RT-9, 7.10, 7.9, 7.14); runtime kill switch (E20, FD-10-L4); profile budgets for validators (V-14); thought-summary display rule (D2 doc-sync row, OQ-23).
- **Covers:** Stage 4 E20 · Stage 6 PS-PR, MP-2 · Stage 7 RT-1, RT-4, RT-9, 7.9, 7.14 · Stage 10 O-2, AG10 · Stage 13 V-14 · Stage 18 FD-09-L7, FD-10-L4 · D2 RT-1/MR1, RT-3/MR16, PR-1/RT-4, RT-9, Numbers · S-04, K-14.
- **Path:** REWRITE (registry, routing) + NEW-BUILD (profiles).
- **Model / size / deps:** Opus 5.5 (gateway) · M–L · P05, P07.
- **Blocked by:** OQ-01 (router M2 row), OQ-15 (step / output numbers), OQ-20 (keep `routingPreference` and sticky model?).
- **Exit test:** routing table test — every locked rule → expected alias, Auto never picks Opus; profile → request parameters snapshot per provider; registry version in the done event and the turn log.

### P11 — Error matrix, timers, fallback (B3)
- **Scope:** the Stage 15 matrix row by row — classifiers for `blocked`, quota-0, configuration, `claude_limit`, mid-stream errors (ER-2f/g/h); finish mapping `interrupted` / `blocked` / `max_tokens` / `other` (ER-3c/d, AL-4); first-token and stall timers and timers from config (ER-4a/b/c, per OQ-16); turn deadline (ER-4d, OQ-15); wire body (ER-11 per OQ-17 — G4 option A keeps the `ApiError` catalogue and changes only the body); copy, support code, banner flag (ER-12a/b); breaker, kill switch, retry budget (ER-13, BREAKER, E18 per-model token bucket); fallback chain with a labelled switch and capability stripping (ER-14a/b, ER-4f, RT-6 / 7.12, E22, OQ-02) and a visible notice when a picked model was unavailable (K-15); partial usage and refusal category in the ledger, thinking-400 repair (AL-1/2/5); Gemini safety thresholds (SD-9a/b).
- **Covers:** Stage 4 E18, E22 · Stage 7 RT-6, BREAKER · Stage 15 ER-2f, ER-2g, ER-2h, ER-3c, ER-3d, ER-4a–f, ER-11, ER-12a/b, ER-13, ER-14a/b, AL-1/2/4/5 · Stage 16 SD-9a/b · D2 RT-6/§7.12 · D3 A-07 · S-11, K-15.
- **Path:** REWRITE inside `backend/src/providers/` (retries live in the app gateway only).
- **Model / size / deps:** Opus 5.5 (gateway) · L · P02, P08, P10.
- **Blocked by:** OQ-02, OQ-15, OQ-16, OQ-17 (classifiers and finish codes are unblocked and can land first).
- **Exit test:** one table-driven test with a fake provider error per matrix row asserting retry count, delay bounds, final code and user copy; the breaker opens and half-opens at the N-xx thresholds; a fallback answer carries the switch label in the done event and the UI.

### P12 — Normalised derivatives, token gating, one ingest path (F4)
- **Scope:** `file_derivatives` (Markdown, JSON sidecar, warnings, extractor version, per-page rows) beside `extracted_text`, staged XLSX → PPTX → DOCX → PDF (D1 #9, NORM, EXCEL, EXTRACT); provider count APIs at ingest per model family, whole ≤ 30 k tokens else retrieval (D1 #10, TOKENS, CXD-4, VS-10); one ingest service for chat and project files (D1 #20); normalised text inline on sandbox turns when small (D1 #28, per OQ-13); PDF → model by budget — full text + images only for the first K / retrieved pages (D1 #11, PDF->MODEL, N-13); CSV / TXT encodings and NUL check (D1 #31); formula-injection escaping (G13); PDF form fields / comments (D1 #30); hash reuse (G3); file columns + `file_versions`, parsed text to GCS (TC1, P9); object generation + checksum at `complete` (D1 #35); chunked resumable upload (D1 #36); preview size guard (D1 #33); derived page images removed with the file (D1 #37); replace a project file (D1 #38); chunker at ~800 tokens / 15 % (CHUNK, N-14).
- **Covers:** Stage 4 G3 · Stage 5 TC1, P9 · Stage 6 CXD-4 · Stage 9 NORM, EXCEL, EXTRACT, TOKENS, PDF->MODEL, CHUNK, G13 · Stage 20 VS-10, VS-16 · D1 #9, #10, #11, #20, #28, #30, #31, #33, #35–#38.
- **Path:** NEW-BUILD beside the old text column; switch per type after parity tests.
- **Model / size / deps:** Opus 5.5 (file pipeline, DB) · L · P06, P09.
- **Blocked by:** OQ-08, OQ-10, OQ-13, OQ-25.
- **Exit test:** the Stage 8 skill-test files (A4 Tamil DOCX, 16:9 PPTX, lakh-format XLSX) plus a Tamil PDF and a UTF-16 CSV each yield a derivative with locators; a 300 MB CSV goes through retrieval, not whole (no `context_overflow`); a 100-page PDF on Claude stays under the request limit; token counts are stored per model family (fake count API).

### P13 — History budget, summary and title jobs (A5)
- **Scope:** `summaries` table (`covers_upto_message_id`, on the branch path), 60 % trigger, `<earlier_conversation_summary>` escaped, last 6 turns verbatim (CXD-5, N-77, N-16); profile input budgets (CXD-6, N-03); history window rules and turn stamps (HIST-WINDOW, STAMPS, REC); title job, 40 output tokens (HP-TITLE, 6.4, M7, N-76); router M2 in shadow mode, switch OFF (RT-2) — model per OQ-01; relation to the existing compaction (OQ-09).
- **Covers:** Stage 3 6.4 · Stage 6 CXD-5, CXD-6, HP-TITLE, HIST-WINDOW, STAMPS, REC · Stage 7 M7, RT-2 · D2 CXD-5/N-16, CXD-6/N-03, H4-B.
- **Path:** NEW-BUILD; compaction kept or retired per OQ-09.
- **Model / size / deps:** Opus 5.5 · M · P05, P08 (jobs need persisted turns), P10.
- **Blocked by:** OQ-01, OQ-08, OQ-09, OQ-25.
- **Exit test:** long-chat integration test — after the trigger the request carries the summary + last 6 turns, the summary covers exactly the uncovered turns on the current branch; the title is set once by the job; router shadow logs its decision without changing the route.

### P14 — ZIP and the accepted type list (F5a)
- **Scope:** inspect the central directory without inflating, then stream-extract with running byte counters (`fflate`, already a dependency); members become attachments (`parent_attachment_id`); no nested ZIP, ≤ 20 members, ≤ 500 MB unpacked, no symlink / `..` / encryption (D1 #1, FT-4, ZIP, FL-2, N-10 ZIP); type list trimmed or extended per OQ-12 (TYPES).
- **Covers:** Stage 1 FT-4 · Stage 9 ZIP, TYPES · Stage 16 FL-2 · D1 #1.
- **Path:** NEW-BUILD (D1 pick A, no new dependency).
- **Model / size / deps:** Sonnet 5.5 · M · P06.
- **Blocked by:** OQ-12.
- **Exit test:** UD-2 cases — nested, zip-slip, bomb ratio, > 20 members, encrypted, disallowed member type — each refused with its code; a valid ZIP becomes member chips that go through the normal pipeline.

### P15 — Output validation, Stage 13 (A6)
- **Scope:** validator contract with release points (V-01); finish-code map (V-02); one auto-continue on truncation (V-05, VD-3, ER-3b); structured-output post-check + reask (V-06); retract event, withdrawn card, context reset (V-07, D12, V-24); completion check — deterministic first (V-08, AO-10, VD-6); artifact gate render / recalc / strict (V-09, VD-7); typed values reconciliation (V-10); language log (V-11); canary + secret + internal-tag scan on every final answer (V-12, INJ-6, RP-1); sampled and async claim judges, annotate only (V-03, V-04, V-13, VD-1/2); idempotent tool retry (V-15); recitation notice (V-18); `validation_result` table, ids and codes only (V-19); UI marks (D-24); `AnswerProtocolGuard` marks, not fails, a bracketed word (D2 note).
- **Covers:** Stage 4 D12 · Stage 10 AO-10 · Stage 13 V-01–V-13, V-15, V-18, V-19, V-24 · Stage 14 D-24 · Stage 15 ER-3b · Stage 16 INJ-6 · D2 RP-1/VD-10, VD-3, VD-1/2, VD-6, VD-7, VD-8/9/11/12.
- **Path:** NEW-BUILD.
- **Model / size / deps:** Opus 5.5 · L · P08 (retract over durable events), P18 (render image for V-09).
- **Blocked by:** OQ-01 (judge / completion model), OQ-25, OQ-28 (keep withdrawn text?).
- **Exit test:** one unit test per check with fixtures — truncated answer → one continue; canary in output → retract; missing requested section → one more step; judge runs report-only on a fixture set.

### P16 — Citations and the viewer (F6)
- **Scope:** `chat_citation` registry (cite id → file version + page / sheet!range / time + hash), `[file:n]` / `[web:n]` in tool results and context blocks, client parser (D1 #13, L-16, CXD-10, PS-CI, D-07, TB6, V-16); viewer with pdf.js page jump, then text-layer highlight (D-06, VS-20b).
- **Covers:** Stage 5 TB6 · Stage 6 CXD-10, PS-CI · Stage 12 L-16 · Stage 13 V-16 · Stage 14 D-06, D-07 · Stage 20 VS-20b · D1 #13 · D2 CXD-9/10, CI-1…6.
- **Path:** NEW-BUILD; replaces the bare PDF iframe (`Panels.tsx:950`).
- **Model / size / deps:** Opus 5.5 · M–L · P07, P12.
- **Blocked by:** OQ-25, OQ-29 (`pdfjs-dist`).
- **Exit test:** an answer citing a PDF page opens the viewer at that page; a deleted source renders "[source deleted]"; citations survive regenerate.

### P17 — Tool contract to TD-1c (A7a)
- **Scope:** one tool spec file, schema keyword allow-list, snake_case, CI check, sorted rendering (TD-12, TS-1…9); Claude `strict: true`, Gemini `VALIDATED` (TS-6/7); result envelope with 11 codes, 8 k cap, pagination, `full_output_file` (TD-6, TD-18); per-tier caps with `LIMIT_REACHED` (TS-12, TD-20); search controls 1 / 3 / 8 (TD-14); `file_search`, `read_file`, `fetch_url`, `web_search` (grounding sub-call, never `googleSearch` with function declarations in one call — TD-2b), `create_artifact` / `update_artifact`, `load_skill`, `get_operation_status` (T-*); tool errors returned as `is_error` (ER-8a/b/c); per-tool caps and an approval slot (INJ-4); dev scripts stop importing model SDKs (GB-1, OQ-31); extras kept by ADR or discarded (OQ-06).
- **Covers:** Stage 2 GB-1 · Stage 8 T-* (except run_code), TD-12, TS-*, TD-6/18, TS-12/TD-20, TD-14 · Stage 15 ER-8a/b/c · Stage 16 INJ-4 · D2 tool-vocabulary questions.
- **Path:** REWRITE (renames as aliases first, then switch).
- **Model / size / deps:** Sonnet 5.5 · L · P07.
- **Blocked by:** OQ-05, OQ-06, OQ-30.
- **Exit test:** the tool-spec CI check passes; every tool returns the envelope; a cap returns `LIMIT_REACHED` at N; no Gemini request carries `googleSearch` and function declarations together.

### P18 — Sandbox to TD-4 / TD-5 (A7b)
- **Scope:** topology — fresh isolated run per call, or the warm service kept by an owner-approved ADR (SB-TOPOLOGY, S19-05, ID-7, D3 A-12); limits — time, memory, ≤ 30 MB × 10 inputs, runs per turn, parallel cap, dispatch deadline; one missing file gives a per-file note, not a failure of every call (SB-LIMITS, N-08, D1 #26); image — remove pymupdf and rewrite the skill snippets to pypdfium2 / pdfplumber / pypdf, add DuckDB, fonts, pinned LibreOffice; tesseract per OQ-14 (SB-IMAGE, TD-4c, VS-12b, D1 #25, DISCARD D1-D4); `run_code` tool (T-run_code); A4 / Indic / lakh / UNO recalc (TD-7); Playwright render image (VS-14); one code-execution path, no shell string (D3 A-24).
- **Covers:** Stage 8 T-run_code, SB-TOPOLOGY, SB-LIMITS, SB-IMAGE, TD-7 · Stage 19 S19-05 · Stage 20 VS-12b, VS-14 · D1 #25, #26, D4 · D3 A-12, A-24 · licence flag pymupdf.
- **Path:** REWRITE (image, limits) + NEW-BUILD (`run_code`, render image).
- **Model / size / deps:** Opus 5.5 (executor) · L · P17.
- **Blocked by:** OQ-14, OQ-15.
- **Exit test:** the sandbox image has no AGPL package (licence scan in CI); a missing input file → one tool error, other calls still work; a `run_code` timeout returns `TOOL_FAILED` with partial stdout.

### P19 — Malware scan and the parser sandbox (F5b)
- **Scope:** `Scanner` interface + clamd INSTREAM client, `scanning` / `malware` / `scan_incomplete`, a no-op dev scanner behind a flag (D1 #5, SCAN, FL-1, VS-12c); LibreOffice in the parser sandbox (macros off, no trusted locations) → page images for Office files (D1 #29, OFFICE->PDF, VS-13, FL-4); PDF JavaScript / OpenAction strip (D1 #22); the isolated parser service as the end state of P06's child process (D1 #7 option B, DS-3b).
- **Covers:** Stage 9 SCAN, OFFICE->PDF · Stage 16 FL-1, FL-4 · Stage 20 VS-12c, VS-13 · D1 #5, #22, #29.
- **Path:** NEW-BUILD. The clamd daemon and the parser service deployment are DIFF-INFRA (owner, Phase 5 infra).
- **Model / size / deps:** Opus 5.5 (file pipeline) · L · P06, P18.
- **Blocked by:** OQ-11, OQ-29.
- **Exit test:** the EICAR file → `malware`; a DOCX renders to page images in the sandbox with macros disabled; a PDF with an OpenAction comes back stripped.

### P20 — Retrieval to Stage 12 (A9)
- **Scope:** per-file whole-vs-retrieve and chat scope (L-02); chunker with heading path, labels, NFC, furniture removal (L-03); access re-resolved per turn (L-06); token share (L-07, OQ-08); planner (L-08, OQ-01); intent routing + DuckDB for tables (L-09, L-22); scoring in Postgres, not over every chunk in Node (L-10, D3 A-11); vectors, RRF, rerank (L-04, L-11, L-13, L-14, EMBED, VS-7b/8/9, D1 #12c — per OQ-10); audio segments (L-05); selection, caps, retrieval record, stubs, degraded flags (L-15, L-17, L-18, L-20, L-21); labelled eval set + metrics = build plan P2-D (L-25).
- **Covers:** Stage 9 EMBED · Stage 12 L-02 … L-25 (23 rows) · Stage 20 VS-7b, VS-8, VS-9 · D1 #12c · D2 FI-1/5/6 · D3 A-11.
- **Path:** REWRITE behind the existing `Retriever` seam (`retrieval.ts:434-441`); vectors NEW-BUILD only if OQ-10 says now.
- **Model / size / deps:** Opus 5.5 (DB) · L · P12, P16.
- **Blocked by:** OQ-01, OQ-08, OQ-10, OQ-25 (chunk partition per company), OQ-26 (PG16 vs PG18).
- **Exit test:** the P2-D 20-document Indian set (PDF / DOCX / XLSX / scanned / Tamil / Hindi) — recall, citation match and p95 latency recorded against the LV-72 targets; no request scores every chunk in Node.

### P21 — Module boundaries, config and numbers (B4)
- **Scope:** container injection instead of `getDb()` singletons (D3 A-16, before tenancy per OQ-25); config consolidated — every N-id read from `config/numbers.ts` with its comment, the 23 DIFF values set per OQ-15, the 23 literals wired (S21-10, D3 A-17, `numbers-diff.md`); one path per job (A-18, per OQ-13); dead code, default-off flags and scripts out of the shipped tree (A-19); typed errors for the ~65 silent catch sites (A-23); auth read path without writes (A-25); SSE through Fastify (A-26); generated client types from `docs/openapi.json` (B2, A-15); per-route body limits (C4); ESLint configured and in CI (VS-33); repo CLAUDE.md gains the locked forbidden list and A1 rule (S21-02).
- **Covers:** Stage 4 B2, C4 · Stage 20 VS-33 · Stage 21 S21-02, S21-10 · D3 A-15–A-19, A-23, A-25, A-26 · numbers-diff DIFF / NOT-WIRED rows and literals.
- **Path:** REWRITE, behaviour-neutral except where OQ-15 changes a value.
- **Model / size / deps:** Opus 5.5 (layout) · L · P05; best after P11.
- **Blocked by:** OQ-13, OQ-15, OQ-25, OQ-29 (OpenAPI types dev dependency).
- **Exit test:** a test fails if a literal for a registered N-id appears outside `config/numbers.ts`; ESLint passes in CI; no module-level `getDb()` call remains outside the container.

### P22 — Data model and the ledger (B5)
- **Scope:** UUIDv7 + `updated_at` (P2); message text split from metadata (P3 / TB2, raise-now); data map + sweep test (P5); deletion ledger and 23-day purge (P11, G4); chat columns + paging 50 (TB1); feedback table (TB8); file columns (TC2); effective-dated price table, reservation rows, monthly-partitioned ledger (TF, CD-1); rupee reservation + daily ceiling (FD-08, OQ-27); money as decimals (LED-1, OQ-27); one usage row per model call (E19, OD-13 — provider-reported partial, not estimated, per OQ-08); regenerate keeps the old answer as a version (F4b); edited prompt keeps or changes its files (F4c); project delete deletes its chats (F8b); four clocks stored (OD-8); coded, allowlisted log lines (LG-1/2/3, NO_CONTENT shadow); telemetry endpoint (OD-15b); search text out of URLs (OD-2b, OQ-18); N-02 32 k + 413 + unknown file ids (1.3); table cell-count log and one `en-IN` formatter (V-20, V-21).
- **Covers:** Stage 3 1.3 · Stage 4 E19, G4 · Stage 5 P2, P3/TB2, P5, P11, TB1, TB8, TC2, TF, F4b, F4c, F8b · Stage 13 V-20, V-21 · Stage 17 OD-2b, OD-8, OD-13, OD-15b, LG-1/2/3 · Stage 18 CD-1, FD-08, LED-1 · evidence-g4 log rows flagged C (shadow part).
- **Path:** NEW-BUILD tables + additive migrations with backfill; old columns dropped only after readers move.
- **Model / size / deps:** Opus 5.5 (DB) · L · P08.
- **Blocked by:** OQ-08, OQ-15 (N-02), OQ-18, OQ-25, OQ-27.
- **Exit test:** migrations apply on a copy of a seeded database with backfill checks; per-call ledger rows sum to the turn total; regenerate keeps the earlier answer; the content-leak test covers the new log lines.

### P23 — Memory to Stage 11 (A8)
- **Scope:** doc / line / source / tombstone / settings tables, line ops, three tools (per OQ-06), write after the answer text, sensitive opt-in per user not retroactive (per OQ-22), per-line 300 chars, provenance and tombstones (INJ-3), chat delete removes its lines, caps per OQ-08, UI chip and notices (M-02 … M-20, PS-ME).
- **Covers:** Stage 6 PS-ME · Stage 11 M-02 … M-20 (18 rows) · Stage 16 INJ-3.
- **Path:** REWRITE (data kept; files become lines by a migration).
- **Model / size / deps:** Sonnet 5.5 (Opus for the migration if the owner prefers — DB) · L · P07, P22.
- **Blocked by:** OQ-06, OQ-08, OQ-22, OQ-25.
- **Exit test:** a memory eval set — a tombstoned fact is never re-saved; a sensitive fact is refused without opt-in; deleting a chat removes the lines it sourced.

### P24 — Skill packs and evals (A7c)
- **Scope:** six skill packs in standard folders with scripts and templates, the four office skills rewritten (SF-PACKS); eval framework with a 99 % gate as a nightly job (SF-9, S21-06); CI validator (SF-10); provenance statement and notices (TD-11, OQ-31); chart as an ECharts JSON artifact (TD-8, CR1, per OQ-23).
- **Covers:** Stage 6 CR1 · Stage 8 TD-8, TD-11, SF-PACKS, SF-9, SF-10 · Stage 21 S21-06.
- **Path:** REWRITE + NEW-BUILD.
- **Model / size / deps:** Opus 5.5 for pack design, Sonnet 5.5 for the rest · L · P17, P18.
- **Blocked by:** OQ-23, OQ-31.
- **Exit test:** ≥ 30 eval cases per pack; the nightly job reports per pack; gate 99 %.

### P25 — Security and safety, the rest of Stage 16 (B6)
- **Scope:** sign-in to the decided model — e-mail code / link, idle expiry, rotation, replay detection, per-account throttle, Google `sub`, password-less self-deletion, mailer (SD-1a/b/g, SD-2b, B24, VS-22, per OQ-03); M9 safety screen, crisis path, India helplines (SD-7, AB-1, F3, per OQ-01); categories and rules table (SD-10); red-team set (SD-11); app CSP and third-party images (INJ-2); CI security gates and pinned sandbox pip (SD-6b/c); CSP / COOP + Report for the user-content host (D-10); robots / X-Robots-Tag / OG / print (D-23); share snapshot rules and Search Suggestions rendering (F6b, RG2, D-11, per OQ-24).
- **Covers:** Stage 4 B24, F3 · Stage 5 F6b · Stage 10 RG2 · Stage 14 D-10, D-11, D-23 · Stage 16 SD-1a, SD-1b, SD-1g, SD-2b, SD-6b/c, SD-7, SD-10, SD-11, AB-1, INJ-2 · Stage 20 VS-22.
- **Path:** REWRITE (auth) + NEW-BUILD (safety service).
- **Model / size / deps:** Opus 5.5 (auth) · L · P04, P22.
- **Blocked by:** OQ-01, OQ-03, OQ-24, OQ-29.
- **Exit test:** auth tests per decided flow; red-team subset meets its thresholds; CSP report-only then enforced; a share snapshot shows what OQ-24 decides.

### P26 — Streaming and rendering polish (B8)
- **Scope:** close unfinished constructs while streaming (D-02); coalesce deltas (D-03); audio + transcript, image zoom (D-09); virtualised transcript + cursor paging (D-13); self-hosted Devanagari, `word-break: normal` (D-14); copy as Markdown, CSV download (D-18); code wrap + line numbers (D-19); `role=log`, announce on done, per-message `lang` (D-22); full-text search (B20); app-version header (B11); rate-limit headers and "N left" (D11); other-chat completion notice (AO-7, D-12); route aliases per OQ-18 (D6).
- **Covers:** Stage 4 B11, B20, D6, D11 · Stage 10 AO-7 · Stage 14 D-02, D-03, D-09, D-12, D-13, D-14, D-18, D-19, D-22.
- **Path:** REWRITE / NEW-BUILD in the frontend.
- **Model / size / deps:** Sonnet 5.5 · M · P08.
- **Blocked by:** OQ-18 (D6 only), OQ-23 (markdown parser).
- **Exit test:** a frontend test per item; a 500-message chat scrolls with a bounded DOM size.

### P27 — CI, images, region, hosting (B7)
- **Scope:** every default region `asia-south1`, bucket locations verified (S19-01, build plan P2-C); digest-pinned images, sandbox Python 3.13, pinned apt / pip (S19-13, VS-1); secret / dependency / image scans, Dependabot, SBOM, notices register (VS-26, S21-08); hosting and same-site API, user-content domain (S19-07, S19-08, S19-09, VS-32, per OQ-19); load and failure-injection harness (VS-6b); docs structure (S21-09).
- **Covers:** Stage 19 S19-01, S19-07, S19-08, S19-09, S19-13 · Stage 20 VS-1, VS-6b, VS-26, VS-32 · Stage 21 S21-08, S21-09 · licence flags (jszip dual, sharp LGPL dev).
- **Path:** REWRITE (config, CI) — anything that is Terraform stays deferred (DIFF-INFRA).
- **Model / size / deps:** Sonnet 5.5 · M · P04.
- **Blocked by:** OQ-19.
- **Exit test:** CI fails on a planted secret and on a known-vulnerable dependency; every image reference has a digest; config contains no non-Mumbai region default.

### P28 — Research mode (A10)
- **Scope:** plan → helpers → report with caps 30 min / 50 searches / 5 helpers, notes checkpoint, cancel → partial report, budget reservation, per-run search override, one ledger row per helper call, whole-document map-reduce (RS-1 … RS-6, RG1, RG3, RG4, RG7, RG8, AO-6, D-17, V-17).
- **Covers:** Stage 10 RS-*, RG1, RG3, RG4, RG7, RG8, AO-6 · Stage 13 V-17 · Stage 14 D-17.
- **Path:** NEW-BUILD (in-process worker first; the Cloud Run job host is DIFF-INFRA).
- **Model / size / deps:** Opus 5.5 · L · P08, P15, P17, P20.
- **Blocked by:** OQ-21.
- **Exit test:** a research run respects every cap; cancel returns a partial report; each helper call has its own ledger row.

### P29 — Server dictation (B9)
- **Scope:** server speech-to-text (Gemini, ≤ 2 min, audio deleted) beside the browser path; engine choice recorded (R3m / A5, S2-7, MIC, VS-17).
- **Covers:** Stage 1 R3m, A5 · Stage 2 S2-7 · Stage 9 MIC · Stage 20 VS-17.
- **Path:** NEW-BUILD.
- **Model / size / deps:** Sonnet 5.5 · M · P09.
- **Blocked by:** none beyond OQ-29 if a new dependency is needed.
- **Exit test:** a 2-minute clip transcribes; the audio object is gone afterwards.

### Later (build plan Phase 6) — Android app
Stage 1 R15a · Stage 14 D-31 · Stage 20 VS-19. Not planned here.

## What is deliberately not in this plan
- Owner-deferred work ([DEFERRED.md](DEFERRED.md)): tenancy / RLS / roles, Redis, Cloud Tasks,
  NO_CONTENT enforcement, Terraform, OTel. Phases leave seams for them: P08 (turn parameters
  persisted, hub as the only publish seam), P21 (container injection), and `company_id` on new
  tables if OQ-25 says so.
- Superseded locked lines (SUMMARY.md §5): not built.
- Live checks, dev runs and deploys: owner only, after the local-stable gate (B-11).

## Appendix A — every REWRITE / NEW-BUILD / DISCARD row of the stage files (362 rows) → phase

Mechanical: generated from the §3 bucket tables; a row appears once. Reason is the auditor's one-line text; Source links the row.

| Phase | Stage | Id | Bucket | Reason (auditor) | Source |
|---|---|---|---|---|---|
| P01 | 1 | FT-10 | REWRITE | no Retry; failed files do not block Send | [stage-01.md:126](stage-01.md#L126) |
| P01 | 12 | L-01 | REWRITE | English-only tokenizer and stop list make Tamil/Hindi invisible (retrieval.ts:415-419) | [stage-12.md:73](stage-12.md#L73) |
| P01 | 15 | ER-9 | REWRITE | free-text upload error, no taxonomy codes or Retry/Remove | [stage-15.md:161](stage-15.md#L161) |
| P02 | 15 | ER-1b | REWRITE | no explicit retry-off, own client or guard test on the Gemini client | [stage-15.md:134](stage-15.md#L134) |
| P02 | 15 | ER-2b | REWRITE | gate ignores thinking/tool events; a failure in tool round 2 re-runs round 1 tools | [stage-15.md:136](stage-15.md#L136) |
| P02 | 15 | ER-2e | REWRITE | Gemini transient set by text match; misses 502/408/409 | [stage-15.md:139](stage-15.md#L139) |
| P02 | 20 | VS-29b | REWRITE | google-genai retries not explicitly off | [stage-20.md:112](stage-20.md#L112) |
| P03 | 4 | E15 | NEW-BUILD | live provider conformance suite (dev-run only, owner gate B-11) | [stage-04.md:253](stage-04.md#L253) |
| P03 | 6 | CXD-7 | REWRITE | Replace derived kit with the 68 original cases; stamp prompt version | [stage-06.md:118](stage-06.md#L118) |
| P03 | 21 | S21-03 (IP-4 `lv1/` pack) | NEW-BUILD | No LV register results folder or per-id scripts; live scripts are ad hoc | [stage-21.md:52](stage-21.md#L52) |
| P03 | 21 | S21-05 (IP-5 prompt kit) | NEW-BUILD | 0 of 68 locked kit cases ported (file not in the mirror); derived cases gate CI | [stage-21.md:54](stage-21.md#L54) |
| P04 | 2 | S2-3 | REWRITE | `/models` and `/models/refresh` are public; `/models?probe=true` spends a provider call per alias for anyone | [stage-02.md:70](stage-02.md#L70) |
| P04 | 3 | 1.5 | REWRITE | per-user key is probably never set (hook order) | [stage-03.md:105](stage-03.md#L105) |
| P04 | 16 | SD-1d | REWRITE | service method exists, no route | [stage-16.md:110](stage-16.md#L110) |
| P04 | 16 | SD-1f | REWRITE | no CSRF/Origin check; two body-less POSTs exposed | [stage-16.md:113](stage-16.md#L113) |
| P04 | 16 | PH-2 | REWRITE | headers incomplete on web and API | [stage-16.md:126](stage-16.md#L126) |
| P04 | 16 | PH-4 | REWRITE | credential default and project-bearing URL in code; no guard test | [stage-16.md:128](stage-16.md#L128) |
| P04 | 16 | INJ-7 | REWRITE | SSRF filter bypasses (IPv6, DNS, redirects) | [stage-16.md:146](stage-16.md#L146) |
| P04 | 19 | S19-14 (ID-13 fail-closed) | REWRITE | A failed migration is swallowed and the server starts anyway | [stage-19.md:81](stage-19.md#L81) |
| P04 | 19 | S19-17 (DS19-D health path) | REWRITE | `/healthz` is a Cloud Run reserved-style path; locked path is `/health` | [stage-19.md:84](stage-19.md#L84) |
| P04 | 20 | VS-2b | REWRITE | Docs UI public in production; per-request access logging on; frontend image root; `/health` path | [stage-20.md:86](stage-20.md#L86) |
| P04 | 21 | S21-11 (A1 identifiers) | REWRITE | Project id, service-account e-mail and project number in code, scripts and the production API URL | [stage-21.md:60](stage-21.md#L60) |
| P05 | 2 | S2-4 | REWRITE | route files hold turn-start logic; move to a turn service (low priority, behaviour-neutral) | [stage-02.md:71](stage-02.md#L71) |
| P05 | 2 | RL2 | REWRITE | same change as S2-4 (counted there) | [stage-02.md:83](stage-02.md#L83) |
| P06 | 1 | FT-2 | REWRITE | macro files hit the generic refusal; no "save as" message | [stage-01.md:118](stage-01.md#L118) |
| P06 | 1 | FT-3 | REWRITE | `.xls` accepted and read; `.doc/.ppt` get the generic refusal | [stage-01.md:119](stage-01.md#L119) |
| P06 | 1 | FT-7 | REWRITE | no per-type caps (docs 100 MB, XLSX 50 MB) | [stage-01.md:123](stage-01.md#L123) |
| P06 | 1 | FT-11 | REWRITE | encrypted files stored as `unsupported`, not refused with a reason at upload | [stage-01.md:127](stage-01.md#L127) |
| P06 | 1 | FT-12 | REWRITE | no signature check; extra types beyond the locked list | [stage-01.md:128](stage-01.md#L128) |
| P06 | 1 | FT-15 | NEW-BUILD | no upload quota | [stage-01.md:131](stage-01.md#L131) |
| P06 | 2 | DS-3b | NEW-BUILD | build the parser sandbox path beside the in-process parsers, then switch | [stage-02.md:92](stage-02.md#L92) |
| P06 | 9 | PIPE | NEW-BUILD | Async file state machine with idempotent steps, states, sidecar, Retry / Remove; in-process runner first | [stage-09.md:69](stage-09.md#L69) |
| P06 | 9 | INTAKE | REWRITE | Magic sniff, macro / legacy rejection with message, encrypted rejection | [stage-09.md:70](stage-09.md#L70) |
| P06 | 9 | LIMITS | REWRITE | Per-type sizes, images 20 MB, audio 3 h, <= 10 per message, upload rate, project limits | [stage-09.md:72](stage-09.md#L72) |
| P06 | 9 | ISOLATION | NEW-BUILD | Parser service with no egress, no secrets, subprocess limits | [stage-09.md:75](stage-09.md#L75) |
| P06 | 9 | LIFE-MORE | REWRITE | Cancel in-flight work, replace re-process, artifacts via pipeline | [stage-09.md:91](stage-09.md#L91) |
| P06 | 9 | RETRY | NEW-BUILD | Needs the failed states of PIPE | [stage-09.md:92](stage-09.md#L92) |
| P06 | 16 | FL-5 | REWRITE | legacy formats accepted | [stage-16.md:134](stage-16.md#L134) |
| P07 | 4 | F6 | REWRITE | caps 5,000/3,000, precedence order, Asia/Kolkata default | [stage-04.md:261](stage-04.md#L261) |
| P07 | 6 | CXD-1 | REWRITE | Delete the Tanglish/language paragraph (blocked on OQ6-3) | [stage-06.md:112](stage-06.md#L112) |
| P07 | 6 | CXD-2 | REWRITE | Add the ladder + versioned blocks + 5,000-char project limit; company level deferred | [stage-06.md:113](stage-06.md#L113) |
| P07 | 6 | CXD-3b | NEW-BUILD | Two renderings as files, loader, hash version, CI guard, beside the old prompt | [stage-06.md:114](stage-06.md#L114) |
| P07 | 6 | SR-SESSION | NEW-BUILD | Session-state blocks do not exist | [stage-06.md:122](stage-06.md#L122) |
| P07 | 6 | SR-TURN | NEW-BUILD | `<current_time>` / `<pending_operations>` do not exist | [stage-06.md:123](stage-06.md#L123) |
| P07 | 6 | SR-USER | NEW-BUILD | User-turn block order and tags do not exist | [stage-06.md:124](stage-06.md#L124) |
| P07 | 6 | SR-ESC | REWRITE | Replace closing-tag trick by the `<` -> `&lt;` rule on all untrusted text | [stage-06.md:125](stage-06.md#L125) |
| P07 | 6 | SR-PROV | REWRITE | Per-provider layout (leading context part, append-only Claude updates) | [stage-06.md:126](stage-06.md#L126) |
| P07 | 6 | SR-SKILLS | REWRITE | Registry list exists; spec shape (`id`, `v`, "use when") and format gating differ | [stage-06.md:127](stage-06.md#L127) |
| P07 | 6 | SR-CACHE-G | NEW-BUILD | Explicit cache + moved per-turn blocks | [stage-06.md:129](stage-06.md#L129) |
| P07 | 6 | PS-ID | NEW-BUILD | AI statement + `<model_info>` rule absent | [stage-06.md:130](stage-06.md#L130) |
| P07 | 6 | PS-AU | REWRITE | Four-level ladder + replace rule | [stage-06.md:131](stage-06.md#L131) |
| P07 | 6 | PS-UC | REWRITE | Close; align to spec wording and tool-result-only placement | [stage-06.md:132](stage-06.md#L132) |
| P07 | 6 | PS-CP | NEW-BUILD | `<capabilities_state>` flags absent | [stage-06.md:133](stage-06.md#L133) |
| P07 | 6 | PS-ST | REWRITE | Align list / math / filler rules | [stage-06.md:134](stage-06.md#L134) |
| P07 | 6 | PS-HO | REWRITE | Add HO-3, HO-7, HO-4 wording | [stage-06.md:135](stage-06.md#L135) |
| P07 | 6 | PS-TI | NEW-BUILD | `current_time` + cutoff rules absent | [stage-06.md:137](stage-06.md#L137) |
| P07 | 6 | PS-SA | REWRITE | Quote limit 15 -> 25 words, defensive security, SA-2..4 | [stage-06.md:138](stage-06.md#L138) |
| P07 | 6 | PS-PT | REWRITE | Add PT-2, PT-3 (SEBI), PT-4 (ECI) | [stage-06.md:139](stage-06.md#L139) |
| P07 | 6 | PS-WB | REWRITE | Add India helplines | [stage-06.md:140](stage-06.md#L140) |
| P07 | 6 | PS-CF | REWRITE | Add secrets masking + CF-1 wording; tenant rules deferred | [stage-06.md:141](stage-06.md#L141) |
| P07 | 6 | PS-PK-LM | NEW-BUILD | Sections absent | [stage-06.md:142](stage-06.md#L142) |
| P07 | 6 | PS-FI | NEW-BUILD | Coverage / retrieval_status / ids absent | [stage-06.md:143](stage-06.md#L143) |
| P07 | 6 | PS-WS | REWRITE | Trim to WS-1..4 + WS-2 suggestion | [stage-06.md:144](stage-06.md#L144) |
| P07 | 6 | PS-TO | REWRITE | Add TO-2, TO-4, TO-7 | [stage-06.md:146](stage-06.md#L146) |
| P07 | 6 | PS-AR | REWRITE | Tool names / formats gate follow Stage 8 | [stage-06.md:147](stage-06.md#L147) |
| P07 | 6 | PS-SK | REWRITE | SK-2 / SK-3 wording | [stage-06.md:148](stage-06.md#L148) |
| P07 | 15 | DS-3 | NEW-BUILD | arrives with the Gemini explicit cache (Stage 18) | [stage-15.md:182](stage-15.md#L182) |
| P07 | 18 | FD-26 | NEW-BUILD | Gemini explicit cache absent | [stage-18.md:69](stage-18.md#L69) |
| P07 | 18 | N-74c | REWRITE | two breakpoints instead of system-prompt only | [stage-18.md:70](stage-18.md#L70) |
| P08 | 3 | 1.4 | NEW-BUILD | request-id / Idempotency-Key replay is built as helpers but wired nowhere | [stage-03.md:104](stage-03.md#L104) |
| P08 | 3 | 1.6 | REWRITE | budget/policy check must come before saving the user message and be an HTTP refusal | [stage-03.md:106](stage-03.md#L106) |
| P08 | 3 | 1.7 | REWRITE | message state `received` + trace id; folded into the turns table (stage-05 T-turns) | [stage-03.md:107](stage-03.md#L107) |
| P08 | 3 | 1.8 | REWRITE | emit a typed `ack` frame before any slow work (also covers T-1) | [stage-03.md:108](stage-03.md#L108) |
| P08 | 3 | 6.1 | REWRITE | no final transaction around message + sources + usage | [stage-03.md:114](stage-03.md#L114) |
| P08 | 3 | 7.3 | REWRITE | answer survives a closed tab but not a crashed or redeployed instance | [stage-03.md:119](stage-03.md#L119) |
| P08 | 4 | D8 | REWRITE | add `ack`, `status`, `ping`, `retract`, `Last-Event-ID`; keep existing frames | [stage-04.md:240](stage-04.md#L240) |
| P08 | 4 | H10 | REWRITE | set N-45 statement/lock/idle timeouts | [stage-04.md:271](stage-04.md#L271) |
| P08 | 5 | TB3 | NEW-BUILD | turns table + one-running-turn partial unique index | [stage-05.md:143](stage-05.md#L143) |
| P08 | 5 | F3b | REWRITE | add jitter to the reconnect delays (N-46) | [stage-05.md:156](stage-05.md#L156) |
| P08 | 10 | AO-4b | NEW-BUILD | run state is process memory; durable event log + lease + resume needed (Postgres first, Redis later = DIFF-INFRA) | [stage-10.md:87](stage-10.md#L87) |
| P08 | 10 | RG6 | REWRITE | single controller ref blocks parallel chats in one tab (workspace.tsx:443-444) | [stage-10.md:98](stage-10.md#L98) |
| P08 | 14 | D-26 | REWRITE | event contract on the durable store (`ping`, `snapshot`, `Last-Event-ID`, send timeout); store itself = Stage 10 AO-4b | [stage-14.md:108](stage-14.md#L108) |
| P08 | 14 | D-29 | NEW-BUILD | 60 s session re-check inside the stream | [stage-14.md:111](stage-14.md#L111) |
| P08 | 15 | ER-6a | REWRITE | no timeouts, retry or 53300 mapping | [stage-15.md:155](stage-15.md#L155) |
| P08 | 15 | ER-10a | REWRITE | 8 attempts, no jitter, no banner, no foreground refetch | [stage-15.md:162](stage-15.md#L162) |
| P08 | 15 | ER-10c | REWRITE | client never sends Idempotency-Key on generate | [stage-15.md:164](stage-15.md#L164) |
| P08 | 19 | S19-18 (SIGTERM deadline) | REWRITE | Shutdown has no deadline against Cloud Run's 10 s SIGKILL | [stage-19.md:85](stage-19.md#L85) |
| P09 | 1 | FT-5 | REWRITE | image cap 10 MB vs 20 MB; HEIC refused | [stage-01.md:121](stage-01.md#L121) |
| P09 | 1 | FT-6 | REWRITE | m4a/webm audio missing, no 3 h check | [stage-01.md:122](stage-01.md#L122) |
| P09 | 9 | OCR-M11 | NEW-BUILD | Document AI pinned RC + Gemini fallback, per-page engine / version (OQ9-1) | [stage-09.md:78](stage-09.md#L78) |
| P09 | 9 | AUDIO | REWRITE | Split + merge + timestamps + 3 h limit on top of the existing Gemini call | [stage-09.md:79](stage-09.md#L79) |
| P09 | 9 | IMAGES | REWRITE | Normalise (EXIF, HEIC, resize, 5 MB), OCR, 20 MB limit | [stage-09.md:82](stage-09.md#L82) |
| P09 | 9 | CLAUDE-IMG/PDF | REWRITE | Follows PDF->MODEL and IMAGES (22 MB native rule, 30 MB request guard) | [stage-09.md:89](stage-09.md#L89) |
| P09 | 16 | FL-3 | NEW-BUILD | no PDF/image sanitising | [stage-16.md:132](stage-16.md#L132) |
| P10 | 4 | E20 | NEW-BUILD | runtime kill switch for model/tool/profile | [stage-04.md:256](stage-04.md#L256) |
| P10 | 6 | PS-PR | NEW-BUILD | Profile concept absent | [stage-06.md:149](stage-06.md#L149) |
| P10 | 6 | MP-2 | REWRITE | Per-profile effort and N-74 ceilings | [stage-06.md:155](stage-06.md#L155) |
| P10 | 7 | RT-1 (Auto rules + 7.9 hard rules) | REWRITE | Auto must default to Gemini, never pick Opus, filter by limits | [stage-07.md:59](stage-07.md#L59) |
| P10 | 7 | RT-4 | REWRITE | Profile -> effort, xhigh / max off | [stage-07.md:61](stage-07.md#L61) |
| P10 | 7 | RT-9 / 7.10 registry rows | REWRITE | Add role, fallbacks, effort map, thinking mode, max output, enabled, version | [stage-07.md:65](stage-07.md#L65) |
| P10 | 7 | 7.9 capability matrix | REWRITE | Gemini limits `null`; Claude 32 MB vs spec 30 MB | [stage-07.md:68](stage-07.md#L68) |
| P10 | 7 | 7.14 upgrade process | REWRITE | Needs `enabled`, rollout, version stamp, eval gate | [stage-07.md:70](stage-07.md#L70) |
| P10 | 10 | AG10 | REWRITE | xhigh/max accepted at API, DB check, UI ladder | [stage-10.md:83](stage-10.md#L83) |
| P10 | 10 | O-2/N-06 | REWRITE | one cap of 16 rounds, no Fast/Normal/Deep tool-step profiles | [stage-10.md:86](stage-10.md#L86) |
| P10 | 13 | V-14 | NEW-BUILD | profile budgets (needs profiles, Stage 10 O-2) | [stage-13.md:97](stage-13.md#L97) |
| P10 | 18 | FD-09-L7 | REWRITE | Auto routes attachment, research and long-project turns to Opus | [stage-18.md:61](stage-18.md#L61) |
| P10 | 18 | FD-10-L4 | NEW-BUILD | no kill switch | [stage-18.md:64](stage-18.md#L64) |
| P11 | 4 | E18 | NEW-BUILD | per-model token bucket in the gateway | [stage-04.md:254](stage-04.md#L254) |
| P11 | 4 | E22 | NEW-BUILD | fallback chain, circuit breaker, refusal retry on allowed categories (open question Q-FB) | [stage-04.md:258](stage-04.md#L258) |
| P11 | 7 | RT-6 / 7.12 fallback chain + labels | NEW-BUILD | No model hop, no label; blocked on OQ7-2 | [stage-07.md:64](stage-07.md#L64) |
| P11 | 7 | BREAKER | NEW-BUILD | Per-model breaker absent (Stage 15 audit also lists it) | [stage-07.md:72](stage-07.md#L72) |
| P11 | 15 | ER-2f | REWRITE | no `blocked`; Gemini safety finishes not classified | [stage-15.md:140](stage-15.md#L140) |
| P11 | 15 | ER-2g | REWRITE | no quota-0, credentials/config split, `claude_limit` skip semantics | [stage-15.md:141](stage-15.md#L141) |
| P11 | 15 | ER-2h | REWRITE | Claude mid-stream error events unclassified | [stage-15.md:142](stage-15.md#L142) |
| P11 | 15 | ER-3c | REWRITE | partial kept but state `error`, no `interrupted`, no Continue for failures | [stage-15.md:145](stage-15.md#L145) |
| P11 | 15 | ER-3d | REWRITE | no `blocked`/`max_tokens`/`other` mapping, no no-finish-reason rule | [stage-15.md:146](stage-15.md#L146) |
| P11 | 15 | ER-4a | REWRITE | no first-token timer (ADR-0024 conflict) | [stage-15.md:148](stage-15.md#L148) |
| P11 | 15 | ER-4b | REWRITE | no stall timer | [stage-15.md:149](stage-15.md#L149) |
| P11 | 15 | ER-4c | REWRITE | only fetch_url and sandbox have timers; values not from config | [stage-15.md:150](stage-15.md#L150) |
| P11 | 15 | ER-4d | REWRITE | 59 min vs 10 min (owner question Q3) | [stage-15.md:151](stage-15.md#L151) |
| P11 | 15 | ER-4f | NEW-BUILD | needs fallback chain | [stage-15.md:153](stage-15.md#L153) |
| P11 | 15 | ER-11 | REWRITE | wire shape differs (options in section 4) | [stage-15.md:166](stage-15.md#L166) |
| P11 | 15 | ER-12a | REWRITE | copy exists; support code, reset time, labelled switch missing | [stage-15.md:167](stage-15.md#L167) |
| P11 | 15 | ER-12b | NEW-BUILD | no banner flag or status page | [stage-15.md:168](stage-15.md#L168) |
| P11 | 15 | ER-13 | NEW-BUILD | no breaker, kill switch or retry budget | [stage-15.md:169](stage-15.md#L169) |
| P11 | 15 | ER-14a | NEW-BUILD | no fallback chain | [stage-15.md:170](stage-15.md#L170) |
| P11 | 15 | ER-14b | NEW-BUILD | capability stripping on switch does not exist | [stage-15.md:171](stage-15.md#L171) |
| P11 | 15 | AL-1 | REWRITE | partial usage lost on failure | [stage-15.md:174](stage-15.md#L174) |
| P11 | 15 | AL-2 | REWRITE | refusal category not in ledger | [stage-15.md:175](stage-15.md#L175) |
| P11 | 15 | AL-4 | REWRITE | covered in the ER-3d change (`other` + warn) | [stage-15.md:177](stage-15.md#L177) |
| P11 | 15 | AL-5 | NEW-BUILD | no thinking-400 repair | [stage-15.md:178](stage-15.md#L178) |
| P11 | 16 | SD-9a | REWRITE | explicit Gemini thresholds absent | [stage-16.md:137](stage-16.md#L137) |
| P11 | 16 | SD-9b | NEW-BUILD | needs fallback chain + M9 | [stage-16.md:138](stage-16.md#L138) |
| P12 | 4 | G3 | NEW-BUILD | compute and store file hash, reuse extraction in the same account | [stage-04.md:263](stage-04.md#L263) |
| P12 | 5 | P9 | REWRITE | parsed text to GCS, keep chunks in DB (counted with TC1) | [stage-05.md:134](stage-05.md#L134) |
| P12 | 5 | TC1, TC2 | REWRITE | file columns (hash, scan, pipeline version, error code), `file_versions`; chunk fields are Stage 12 | [stage-05.md:149](stage-05.md#L149) |
| P12 | 6 | CXD-4 | NEW-BUILD | Per-file ~30k budget gate does not exist | [stage-06.md:115](stage-06.md#L115) |
| P12 | 9 | EXTRACT | NEW-BUILD | Docling-class extractor layer behind the isolation boundary | [stage-09.md:77](stage-09.md#L77) |
| P12 | 9 | EXCEL | REWRITE | 30k gate, per-sheet summary + sample, CSV / Parquet, addresses, hidden sheets | [stage-09.md:81](stage-09.md#L81) |
| P12 | 9 | PDF->MODEL | REWRITE | Budget-driven whole vs retrieved pages, N-13 caps, 22 MB rule | [stage-09.md:83](stage-09.md#L83) |
| P12 | 9 | NORM | NEW-BUILD | Markdown + JSON sidecar with versions | [stage-09.md:85](stage-09.md#L85) |
| P12 | 9 | CHUNK | REWRITE | 800 tokens / 15 %, headings, table headers, locations (shared with Stage 12) | [stage-09.md:86](stage-09.md#L86) |
| P12 | 9 | TOKENS | NEW-BUILD | Per-file per-model token counts at ingest via the free count APIs | [stage-09.md:88](stage-09.md#L88) |
| P12 | 9 | G13 | NEW-BUILD | Formula-injection escaping on generated CSV / XLSX | [stage-09.md:93](stage-09.md#L93) |
| P12 | 20 | VS-10 | NEW-BUILD | No pre-send provider token counting (usage only after the call) | [stage-20.md:94](stage-20.md#L94) |
| P12 | 20 | VS-16 | REWRITE | Stale SheetJS `xlsx` in the retrieval path (ExcelJS kept as stack equivalent, see Q) | [stage-20.md:101](stage-20.md#L101) |
| P13 | 3 | 6.4 | NEW-BUILD | title is the first 80 characters of the prompt | [stage-03.md:116](stage-03.md#L116) |
| P13 | 6 | CXD-5 | REWRITE | Re-point compaction to the N-77 summary (trigger, 6 turns, tag, Haiku job) | [stage-06.md:116](stage-06.md#L116) |
| P13 | 6 | CXD-6 | NEW-BUILD | Profiles + context budget builder (blocked on OQ6-2) | [stage-06.md:117](stage-06.md#L117) |
| P13 | 6 | HIST-WINDOW | REWRITE | 6-turn window, text-only, blocked / whitespace rules | [stage-06.md:150](stage-06.md#L150) |
| P13 | 6 | STAMPS | NEW-BUILD | Turn stamps absent | [stage-06.md:151](stage-06.md#L151) |
| P13 | 6 | REC | NEW-BUILD | Continuation text file absent | [stage-06.md:152](stage-06.md#L152) |
| P13 | 6 | HP-TITLE | NEW-BUILD | Generated title job absent | [stage-06.md:153](stage-06.md#L153) |
| P13 | 7 | RT-2 / RT-3 / M2 (Haiku router) | NEW-BUILD | Router call type + shadow switch OFF; blocked on OQ7-1 | [stage-07.md:60](stage-07.md#L60) |
| P13 | 7 | M7 / `job` role | NEW-BUILD | Title / summary job rows (Stage 6 HP-TITLE, CXD-5); blocked on OQ7-1 | [stage-07.md:67](stage-07.md#L67) |
| P14 | 1 | FT-4 | NEW-BUILD | no ZIP path at all | [stage-01.md:120](stage-01.md#L120) |
| P14 | 9 | TYPES | REWRITE | Trim the allowlist to the spec list (+ CSV / TXT / MD), add HEIC and ZIP type; extras per OQ9-3 | [stage-09.md:71](stage-09.md#L71) |
| P14 | 9 | ZIP | NEW-BUILD | Safe ZIP unpack | [stage-09.md:74](stage-09.md#L74) |
| P14 | 16 | FL-2 | NEW-BUILD | no ZIP containment | [stage-16.md:131](stage-16.md#L131) |
| P15 | 4 | D12 | NEW-BUILD | `retract` event + client handling (rules: Stage 13) | [stage-04.md:243](stage-04.md#L243) |
| P15 | 10 | AO-10 | NEW-BUILD | only empty-reply guard exists; built together with Stage 13 VD-6 | [stage-10.md:81](stage-10.md#L81) |
| P15 | 13 | V-01 | NEW-BUILD | validator contract with release points and latency per check | [stage-13.md:84](stage-13.md#L84) |
| P15 | 13 | V-02 | REWRITE | no Gemini finish-code map, no `message_delta`/empty-`end_turn` rule | [stage-13.md:85](stage-13.md#L85) |
| P15 | 13 | V-03 | NEW-BUILD | async claim judge; model question Q1 | [stage-13.md:86](stage-13.md#L86) |
| P15 | 13 | V-04 | NEW-BUILD | annotate note + weak-citation marks; Deep regenerate | [stage-13.md:87](stage-13.md#L87) |
| P15 | 13 | V-05 | REWRITE | note + manual Continue exist; auto-continue and profile split missing | [stage-13.md:88](stage-13.md#L88) |
| P15 | 13 | V-06 | REWRITE | schema checks exist for UI blocks/compaction; no reask, no enum/refusal/max_tokens rules | [stage-13.md:89](stage-13.md#L89) |
| P15 | 13 | V-07 | NEW-BUILD | `retract` event, withdrawn card, fixed trigger list | [stage-13.md:90](stage-13.md#L90) |
| P15 | 13 | V-08 | NEW-BUILD | deterministic + Flash-Lite completion check (with AO-10) | [stage-13.md:91](stage-13.md#L91) |
| P15 | 13 | V-09 | REWRITE | structural gate exists (codeExecutionExecutor.ts:401-417); render/recalc/strict/allowlist/ECharts missing | [stage-13.md:92](stage-13.md#L92) |
| P15 | 13 | V-10 | NEW-BUILD | typed-values envelope + reconciliation | [stage-13.md:93](stage-13.md#L93) |
| P15 | 13 | V-11 | NEW-BUILD | log-only language check (answerLang.ts is display only) | [stage-13.md:94](stage-13.md#L94) |
| P15 | 13 | V-12 | NEW-BUILD | canary + secret + tag scan on every final answer | [stage-13.md:95](stage-13.md#L95) |
| P15 | 13 | V-13 | NEW-BUILD | ~10 % sampled judge | [stage-13.md:96](stage-13.md#L96) |
| P15 | 13 | V-15 | REWRITE | gate exists in parts; add idempotency and malformed-call retry | [stage-13.md:98](stage-13.md#L98) |
| P15 | 13 | V-18 | NEW-BUILD | recitation notice + regenerate offer | [stage-13.md:101](stage-13.md#L101) |
| P15 | 13 | V-19 | NEW-BUILD | `validation_result` table (shape: deferred file D-G3-01) | [stage-13.md:102](stage-13.md#L102) |
| P15 | 13 | V-24 | REWRITE | retract + context reset; partial today stays visible | [stage-13.md:107](stage-13.md#L107) |
| P15 | 14 | D-24 | NEW-BUILD | verify note, weak marks, retract card, recitation notice (cut-short already exists) | [stage-14.md:106](stage-14.md#L106) |
| P15 | 15 | ER-3b | NEW-BUILD | no continuation attempt exists | [stage-15.md:144](stage-15.md#L144) |
| P15 | 16 | INJ-6 | NEW-BUILD | no canary | [stage-16.md:145](stage-16.md#L145) |
| P16 | 5 | TB6 | REWRITE | add `grounded_by` (needed by SL-1) and cite fields (Stage 12) | [stage-05.md:145](stage-05.md#L145) |
| P16 | 6 | CXD-10 | NEW-BUILD | Typed source ids do not exist | [stage-06.md:120](stage-06.md#L120) |
| P16 | 6 | PS-CI | NEW-BUILD | Typed citations absent | [stage-06.md:136](stage-06.md#L136) |
| P16 | 12 | L-16 | NEW-BUILD | citation registry + prompt layout + flags | [stage-12.md:88](stage-12.md#L88) |
| P16 | 13 | V-16 | NEW-BUILD | depends on Stage 12 registry | [stage-13.md:99](stage-13.md#L99) |
| P16 | 14 | D-06 | NEW-BUILD | pdf.js + registry-driven highlight; depends on Stage 12 L-16 | [stage-14.md:88](stage-14.md#L88) |
| P16 | 14 | D-07 | REWRITE | `[web:n]` token and producer; card exists | [stage-14.md:89](stage-14.md#L89) |
| P16 | 20 | VS-20b | NEW-BUILD | pdf.js / react-pdf citation viewer, virtualised lists absent | [stage-20.md:106](stage-20.md#L106) |
| P17 | 2 | GB-1 | REWRITE | four dev scripts import `@google/genai` directly | [stage-02.md:93](stage-02.md#L93) |
| P17 | 8 | T-file_search | REWRITE | `search_project_files` -> `file_search` (scope chat / project / all, ids, citation ids); retrieval core = Stage 12 | [stage-08.md:66](stage-08.md#L66) |
| P17 | 8 | T-read_file | REWRITE | `read_project_file` -> `read_file` (file_id, part, cursor, envelope) | [stage-08.md:67](stage-08.md#L67) |
| P17 | 8 | T-web_search (+TD-2b, TD-21, TX1-TX5, CX1-CX3) | REWRITE | Gemini grounding sub-call tool; Claude native config per tier; drop SerpAPI unless owner OKs | [stage-08.md:68](stage-08.md#L68) |
| P17 | 8 | TD-14 controls | REWRITE | per-chat default OFF, tier caps, prefer-Gemini rule | [stage-08.md:69](stage-08.md#L69) |
| P17 | 8 | T-fetch_url (+TD-3) | REWRITE | Rename, SSRF with DNS + per-hop checks, 5 MB, cursor; separate service = infra later | [stage-08.md:70](stage-08.md#L70) |
| P17 | 8 | T-create_artifact / T-update_artifact | NEW-BUILD | Tool path into the existing artifact tables | [stage-08.md:72](stage-08.md#L72) |
| P17 | 8 | T-load_skill (+SF-5) | NEW-BUILD | Loader tool with dedupe, resources, version pin, log | [stage-08.md:73](stage-08.md#L73) |
| P17 | 8 | T-get_operation_status | NEW-BUILD | No operations / jobs exist yet | [stage-08.md:74](stage-08.md#L74) |
| P17 | 8 | TD-12 / TS-1..5 / TS-9 | REWRITE | One spec file, schema keyword allow-list, snake_case, CI check, sorted rendering | [stage-08.md:75](stage-08.md#L75) |
| P17 | 8 | TS-6 / TS-7 | REWRITE | Claude `strict:true`; Gemini `parameters` + `VALIDATED` | [stage-08.md:76](stage-08.md#L76) |
| P17 | 8 | TS-12 / TD-20 | NEW-BUILD | Per-tier caps with `LIMIT_REACHED` | [stage-08.md:79](stage-08.md#L79) |
| P17 | 8 | TD-6 / TD-18 | NEW-BUILD | Envelope, 11 codes, 8k cap, pagination, `full_output_file` | [stage-08.md:80](stage-08.md#L80) |
| P17 | 15 | ER-8a | REWRITE | dispatcher does not convert throws into `is_error` | [stage-15.md:158](stage-15.md#L158) |
| P17 | 15 | ER-8b | REWRITE | no read-tool retry | [stage-15.md:159](stage-15.md#L159) |
| P17 | 15 | ER-8c | REWRITE | sandbox timeout throws instead of returning `TOOL_FAILED` + partial stdout (to verify at build) | [stage-15.md:160](stage-15.md#L160) |
| P17 | 16 | INJ-4 | NEW-BUILD | no per-tool caps / approval slot | [stage-16.md:143](stage-16.md#L143) |
| P18 | 8 | T-run_code | NEW-BUILD | `run_code(language, title, code, input_files)` beside the five sandbox tools | [stage-08.md:71](stage-08.md#L71) |
| P18 | 8 | SB-TOPOLOGY (TD-4b, TD-5d, Stage 19 ID-7) | REWRITE | Shared warm service with per-chat uid vs fresh isolated run | [stage-08.md:81](stage-08.md#L81) |
| P18 | 8 | SB-LIMITS (TD-5c, N-08, N-68) | REWRITE | Timeouts, memory, files, runs per turn, parallel cap, dispatch deadline | [stage-08.md:82](stage-08.md#L82) |
| P18 | 8 | SB-IMAGE (TD-4c) | REWRITE | Remove pymupdf (AGPL); add the missing libraries, fonts, LibreOffice pin, DuckDB | [stage-08.md:83](stage-08.md#L83) |
| P18 | 8 | TD-7 | REWRITE | A4 + Indic slot, UNO recalc + error scan, lakh format, rupee fonts | [stage-08.md:84](stage-08.md#L84) |
| P18 | 19 | S19-05 (ID-7, DS19-F) | NEW-BUILD | Job-per-run exists as an engine but the product path is the warm shared service | [stage-19.md:72](stage-19.md#L72) |
| P18 | 20 | VS-12b | REWRITE | `pymupdf` is AGPL; licence rule forbids it | [stage-20.md:96](stage-20.md#L96) |
| P18 | 20 | VS-14 | NEW-BUILD | No Playwright/Chromium render image | [stage-20.md:99](stage-20.md#L99) |
| P19 | 9 | SCAN | NEW-BUILD | ClamAV scan + malware / scan_incomplete states + hardening (OQ9-1) | [stage-09.md:73](stage-09.md#L73) |
| P19 | 9 | OFFICE->PDF | NEW-BUILD | LibreOffice render for page images | [stage-09.md:76](stage-09.md#L76) |
| P19 | 16 | FL-1 | NEW-BUILD | no scanner or quarantine | [stage-16.md:130](stage-16.md#L130) |
| P19 | 16 | FL-4 | REWRITE | LibreOffice macro level not configured | [stage-16.md:133](stage-16.md#L133) |
| P19 | 20 | VS-12c | NEW-BUILD | No ClamAV quarantine, no FFmpeg, no ZIP intake | [stage-20.md:97](stage-20.md#L97) |
| P19 | 20 | VS-13 | NEW-BUILD | No isolated, pinned LibreOffice parser image | [stage-20.md:98](stage-20.md#L98) |
| P20 | 9 | EMBED | NEW-BUILD | Embedding 2 text + visual vectors; blocked by Invariant 4 (Stage 12 question) and OQ9-1 | [stage-09.md:87](stage-09.md#L87) |
| P20 | 12 | L-02 | REWRITE | all-or-nothing project chars, no per-file decision, no chat scope | [stage-12.md:74](stage-12.md#L74) |
| P20 | 12 | L-03 | REWRITE | 1,400/180 chars, 400-chunk cap, no heading path / label / NFC / furniture removal | [stage-12.md:75](stage-12.md#L75) |
| P20 | 12 | L-04 | NEW-BUILD | no embeddings, versions, index_status — **blocked by owner question Q1 (Invariant 4 / ADR-0059)** | [stage-12.md:76](stage-12.md#L76) |
| P20 | 12 | L-05 | NEW-BUILD | audio gets time segments | [stage-12.md:77](stage-12.md#L77) |
| P20 | 12 | L-06 | REWRITE | scope becomes chat+project, access re-resolved each turn (RLS deferred) | [stage-12.md:78](stage-12.md#L78) |
| P20 | 12 | L-07 | REWRITE | char caps → 6k/20k/80k token share (Q3 on token counting) | [stage-12.md:79](stage-12.md#L79) |
| P20 | 12 | L-08 | NEW-BUILD | planner call; model question Q2 | [stage-12.md:80](stage-12.md#L80) |
| P20 | 12 | L-09 | NEW-BUILD | intent routing; DuckDB under L-22 | [stage-12.md:81](stage-12.md#L81) |
| P20 | 12 | L-10 | REWRITE | move scoring out of JS into Postgres (tsvector `simple` / pg_textsearch) | [stage-12.md:82](stage-12.md#L82) |
| P20 | 12 | L-11 | NEW-BUILD | pgvector search — blocked by Q1 | [stage-12.md:83](stage-12.md#L83) |
| P20 | 12 | L-13 | NEW-BUILD | RRF, merge, MMR, coverage | [stage-12.md:85](stage-12.md#L85) |
| P20 | 12 | L-14 | NEW-BUILD | Vertex Ranking API client in the provider layer | [stage-12.md:86](stage-12.md#L86) |
| P20 | 12 | L-15 | NEW-BUILD | selection order, history dedupe | [stage-12.md:87](stage-12.md#L87) |
| P20 | 12 | L-17 | NEW-BUILD | per-turn call caps + "already provided" | [stage-12.md:89](stage-12.md#L89) |
| P20 | 12 | L-18 | NEW-BUILD | retrieval record + stubs | [stage-12.md:90](stage-12.md#L90) |
| P20 | 12 | L-20 | NEW-BUILD | stub earlier turns | [stage-12.md:92](stage-12.md#L92) |
| P20 | 12 | L-21 | NEW-BUILD | degraded flags | [stage-12.md:93](stage-12.md#L93) |
| P20 | 12 | L-22 | NEW-BUILD | DuckDB in sandbox image + several-tables detection | [stage-12.md:94](stage-12.md#L94) |
| P20 | 12 | L-25 | NEW-BUILD | labelled set + metrics (reuse rankmetrics.py ideas) | [stage-12.md:97](stage-12.md#L97) |
| P20 | 20 | VS-7b | NEW-BUILD | pgvector + pg_textsearch per-company partitions on PG18 absent (Stage 12 owner) | [stage-20.md:91](stage-20.md#L91) |
| P20 | 20 | VS-8 | NEW-BUILD | No NFC normalisation, no pg_trgm | [stage-20.md:92](stage-20.md#L92) |
| P20 | 20 | VS-9 | NEW-BUILD | Vertex Ranking API reranker absent (ADR-0007; Phase 2) | [stage-20.md:93](stage-20.md#L93) |
| P21 | 4 | B2 | REWRITE | client is hand-written; generate types from `docs/openapi.json` | [stage-04.md:213](stage-04.md#L213) |
| P21 | 4 | C4 | REWRITE | one 31 MiB body limit for every route | [stage-04.md:230](stage-04.md#L230) |
| P21 | 20 | VS-33 | REWRITE | ESLint declared but not configured or run | [stage-20.md:115](stage-20.md#L115) |
| P21 | 21 | S21-02 (CLAUDE.md content, per-app files) | REWRITE | Locked forbidden list and A1 rule missing from `CLAUDE.md`; no per-app files | [stage-21.md:51](stage-21.md#L51) |
| P21 | 21 | S21-10 (P-5 numbers) | REWRITE | Many literals without N-id; no settings / price_book; five repo values differ from the register | [stage-21.md:59](stage-21.md#L59) |
| P22 | 3 | 1.3 | REWRITE | N-02 32k limit, 413 code, unknown/foreign file ids must be an error | [stage-03.md:103](stage-03.md#L103) |
| P22 | 4 | E19 | REWRITE | one usage row per turn instead of per model call | [stage-04.md:255](stage-04.md#L255) |
| P22 | 4 | G4 | REWRITE | purge at 23 d, add deletion ledger + sweep (ledger: stage-05) | [stage-04.md:264](stage-04.md#L264) |
| P22 | 5 | P2 | REWRITE | UUIDv7 generated in the app; add `updated_at` where missing | [stage-05.md:127](stage-05.md#L127) |
| P22 | 5 | P3, TB2 | REWRITE | split message text and provider fields from message metadata (counted once) | [stage-05.md:128](stage-05.md#L128) |
| P22 | 5 | P5 | NEW-BUILD | data map + sweep test | [stage-05.md:130](stage-05.md#L130) |
| P22 | 5 | P11 | NEW-BUILD | deletion ledger outside the restorable DB | [stage-05.md:136](stage-05.md#L136) |
| P22 | 5 | TB1 | REWRITE | add `title_version`, `memory_enabled`, `last_message_at`; message paging 50 | [stage-05.md:142](stage-05.md#L142) |
| P22 | 5 | TB8 | NEW-BUILD | feedback table with reason + comment | [stage-05.md:147](stage-05.md#L147) |
| P22 | 5 | TF | REWRITE | effective-dated `price_table`, reservation rows, monthly-partitioned ledger with price version / traffic tier | [stage-05.md:152](stage-05.md#L152) |
| P22 | 5 | F4b | REWRITE | regenerate must keep the old answer as a version; chosen version stored on the server | [stage-05.md:157](stage-05.md#L157) |
| P22 | 5 | F4c | REWRITE | an edited prompt must be able to keep or change its files | [stage-05.md:158](stage-05.md#L158) |
| P22 | 5 | F8b | REWRITE | project delete must delete its chats too, with a count warning | [stage-05.md:160](stage-05.md#L160) |
| P22 | 13 | V-20 | NEW-BUILD | server table cell-count log; client part under Stage 14 | [stage-13.md:103](stage-13.md#L103) |
| P22 | 13 | V-21 | REWRITE | one `en-IN` formatter for app-generated numbers/dates | [stage-13.md:104](stage-13.md#L104) |
| P22 | 17 | OD-2b | REWRITE | three GET routes put search text in the URL | [stage-17.md:81](stage-17.md#L81) |
| P22 | 17 | OD-8 | REWRITE | name and store the four clocks; two exist as log fields | [stage-17.md:88](stage-17.md#L88) |
| P22 | 17 | OD-13 | REWRITE | per-call usage capture and ledger columns missing | [stage-17.md:94](stage-17.md#L94) |
| P22 | 17 | OD-15b | NEW-BUILD | no `/telemetry` endpoint | [stage-17.md:97](stage-17.md#L97) |
| P22 | 17 | LG-1 | NEW-BUILD | no per-attempt `model_call` line | [stage-17.md:104](stage-17.md#L104) |
| P22 | 17 | LG-2 | NEW-BUILD | no gateway event lines | [stage-17.md:105](stage-17.md#L105) |
| P22 | 17 | LG-3 | REWRITE | `turn timing` replaced by coded, allowlisted turn lines | [stage-17.md:106](stage-17.md#L106) |
| P22 | 18 | FD-08 / FD-10-L1 | REWRITE | reserve in rupees per turn using the price book; add the daily ceiling | [stage-18.md:60](stage-18.md#L60) |
| P22 | 18 | CD-1 | NEW-BUILD | price book as dated code rows; env JSON stays until the switch | [stage-18.md:65](stage-18.md#L65) |
| P22 | 18 | LED-1 | REWRITE | money in doubles | [stage-18.md:66](stage-18.md#L66) |
| P23 | 6 | PS-ME | REWRITE | Prompt side follows Stage 11 rewrite (see G3 audit) | [stage-06.md:145](stage-06.md#L145) |
| P23 | 11 | M-02 | REWRITE | `/projects` vs `/areas`, `(stated)` vs `[stated]`, no per-line format | [stage-11.md:70](stage-11.md#L70) |
| P23 | 11 | M-03 | REWRITE | whole-file rows → doc/line/source/tombstone/settings tables (company_id: deferred file D-G3-01) | [stage-11.md:71](stage-11.md#L71) |
| P23 | 11 | M-04 | REWRITE | add "write after the answer text" rule; writes become line ops | [stage-11.md:72](stage-11.md#L72) |
| P23 | 11 | M-05 | REWRITE | sensitive opt-in per user missing (company layer deferred); owner question Q1 | [stage-11.md:73](stage-11.md#L73) |
| P23 | 11 | M-06 | REWRITE | snapshot budget, alias prefetch, per-chat gate, change notice | [stage-11.md:74](stage-11.md#L74) |
| P23 | 11 | M-07 | REWRITE | six file tools → three line-op tools; owner question Q2 | [stage-11.md:75](stage-11.md#L75) |
| P23 | 11 | M-08 | REWRITE | server validator covers secrets + ID numbers only | [stage-11.md:76](stage-11.md#L76) |
| P23 | 11 | M-09 | REWRITE | per-user sensitive switch, not retroactive, separate write; Q1 | [stage-11.md:77](stage-11.md#L77) |
| P23 | 11 | M-10 | REWRITE | prompt-only; add a server check for the fixed patterns | [stage-11.md:78](stage-11.md#L78) |
| P23 | 11 | M-11 | REWRITE | restrict `/people` to work context | [stage-11.md:79](stage-11.md#L79) |
| P23 | 11 | M-12 | NEW-BUILD | tombstone table + check on write | [stage-11.md:80](stage-11.md#L80) |
| P23 | 11 | M-13 | REWRITE | per-line ≤300 chars (N-35), one fact per line | [stage-11.md:81](stage-11.md#L81) |
| P23 | 11 | M-16 | REWRITE | add the chip and the sensitive/refusal notices (labels exist) | [stage-11.md:84](stage-11.md#L84) |
| P23 | 11 | M-17 | REWRITE | line-level edit, sensitive opt-in, per-chat toggle | [stage-11.md:85](stage-11.md#L85) |
| P23 | 11 | M-19 | NEW-BUILD | needs line sources + `origin`; today chat delete does nothing to memory | [stage-11.md:87](stage-11.md#L87) |
| P23 | 11 | M-20 | REWRITE | caps in docs/lines/tokens vs bytes/chars; Q3 | [stage-11.md:88](stage-11.md#L88) |
| P23 | 16 | INJ-3 | NEW-BUILD | no memory provenance/tombstones | [stage-16.md:142](stage-16.md#L142) |
| P24 | 6 | CR1 | REWRITE | Chart as JSON-spec artifact; csv/zip file types per Stage 8 TD-7 | [stage-06.md:156](stage-06.md#L156) |
| P24 | 8 | TD-8 | NEW-BUILD | ECharts JSON chart artifact | [stage-08.md:85](stage-08.md#L85) |
| P24 | 8 | TD-11 | REWRITE | Rewrite skills from library docs, add notices, lawyer check (part of skill packs) | [stage-08.md:87](stage-08.md#L87) |
| P24 | 8 | SF-PACKS (SF-1..SF-4, SF-6..SF-8) | NEW-BUILD | 6 packs in standard folders with scripts and templates; existing 4 office skills rewritten | [stage-08.md:88](stage-08.md#L88) |
| P24 | 8 | SF-9 | NEW-BUILD | Eval framework + 99 % gate | [stage-08.md:89](stage-08.md#L89) |
| P24 | 8 | SF-10 | REWRITE | Add CI validator; ownership rule already true | [stage-08.md:90](stage-08.md#L90) |
| P24 | 21 | S21-06 (IP-5 skill evals 99 %) | NEW-BUILD | No skill eval cases or nightly job | [stage-21.md:55](stage-21.md#L55) |
| P25 | 4 | B24 | REWRITE | password-less (Google) accounts cannot delete themselves | [stage-04.md:226](stage-04.md#L226) |
| P25 | 4 | F3 | NEW-BUILD | Safety service (M9 screen, tool-output screen, crisis path) — build plan Phase 4 | [stage-04.md:260](stage-04.md#L260) |
| P25 | 5 | F6b | REWRITE | store a token hash and a filtered snapshot; strip Google-grounded answers; artifact = name + type (owner question Q-Share) | [stage-05.md:159](stage-05.md#L159) |
| P25 | 10 | RG2 | REWRITE | share route returns sources of grounded answers (share.ts:383-393) | [stage-10.md:94](stage-10.md#L94) |
| P25 | 14 | D-10 | NEW-BUILD | header CSP/COOP route + Report button; separate origin host is DIFF-INFRA | [stage-14.md:92](stage-14.md#L92) |
| P25 | 14 | D-11 | NEW-BUILD | render `renderedContent` (compliance) | [stage-14.md:93](stage-14.md#L93) |
| P25 | 14 | D-23 | REWRITE | X-Robots-Tag on the HTML, drop `/s/` from robots.txt, generic OG, print CSS, hide grounded answers, Report link | [stage-14.md:105](stage-14.md#L105) |
| P25 | 16 | SD-1a | NEW-BUILD | e-mail code/link sign-in absent; provisional until owner Q-S1 | [stage-16.md:107](stage-16.md#L107) |
| P25 | 16 | SD-1b | REWRITE | no idle expiry, rotation or replay detection | [stage-16.md:108](stage-16.md#L108) |
| P25 | 16 | SD-1g | REWRITE | no per-account throttle | [stage-16.md:114](stage-16.md#L114) |
| P25 | 16 | SD-2b | REWRITE | `sub` not stored or used | [stage-16.md:117](stage-16.md#L117) |
| P25 | 16 | SD-6b | NEW-BUILD | CI has no security gates | [stage-16.md:123](stage-16.md#L123) |
| P25 | 16 | SD-6c | REWRITE | sandbox pip installs unpinned | [stage-16.md:124](stage-16.md#L124) |
| P25 | 16 | SD-7 | NEW-BUILD | no M9 (conflicts with "three models only": Q-S3) | [stage-16.md:135](stage-16.md#L135) |
| P25 | 16 | SD-10 | REWRITE | prompt-only; categories/actions table and rules layer missing | [stage-16.md:139](stage-16.md#L139) |
| P25 | 16 | INJ-2 | REWRITE | no app CSP; third-party image cards | [stage-16.md:141](stage-16.md#L141) |
| P25 | 16 | SD-11 | NEW-BUILD | only two ad-hoc scenarios | [stage-16.md:147](stage-16.md#L147) |
| P25 | 16 | AB-1 | NEW-BUILD | no crisis detector or India helplines | [stage-16.md:148](stage-16.md#L148) |
| P25 | 20 | VS-22 | NEW-BUILD | No SES mailer (conditional on the Stage 16 passwordless decision) | [stage-20.md:108](stage-20.md#L108) |
| P26 | 4 | B11 | NEW-BUILD | no app-version header or force-update screen | [stage-04.md:215](stage-04.md#L215) |
| P26 | 4 | B20 | REWRITE | search covers titles only | [stage-04.md:223](stage-04.md#L223) |
| P26 | 4 | D6 | REWRITE | paths and the missing turn resource differ from the catalogue (alias routes, with the turns table) | [stage-04.md:238](stage-04.md#L238) |
| P26 | 4 | D11 | NEW-BUILD | expose rate-limit headers and show "N left" | [stage-04.md:242](stage-04.md#L242) |
| P26 | 10 | AO-7 | NEW-BUILD | no in-app "finished in another chat" notice | [stage-10.md:79](stage-10.md#L79) |
| P26 | 14 | D-02 | NEW-BUILD | termination of unfinished constructs while streaming | [stage-14.md:84](stage-14.md#L84) |
| P26 | 14 | D-03 | REWRITE | coalesce deltas (server flush 100 ms + client rAF) | [stage-14.md:85](stage-14.md#L85) |
| P26 | 14 | D-09 | REWRITE | audio+transcript, image zoom missing; DOCX/PPTX client renderers differ from LibreOffice→PDF but meet the outcome | [stage-14.md:91](stage-14.md#L91) |
| P26 | 14 | D-12 | NEW-BUILD | in-app notice for other-chat completion (with Stage 10 AO-7) | [stage-14.md:94](stage-14.md#L94) |
| P26 | 14 | D-13 | NEW-BUILD | virtualized transcript + cursor paging | [stage-14.md:95](stage-14.md#L95) |
| P26 | 14 | D-14 | REWRITE | self-host Devanagari, `word-break: normal` | [stage-14.md:96](stage-14.md#L96) |
| P26 | 14 | D-18 | REWRITE | add copy-as-Markdown and CSV download | [stage-14.md:100](stage-14.md#L100) |
| P26 | 14 | D-19 | REWRITE | add wrap toggle and line numbers | [stage-14.md:101](stage-14.md#L101) |
| P26 | 14 | D-22 | REWRITE | transcript `role=log`, announce-on-done, per-message lang | [stage-14.md:104](stage-14.md#L104) |
| P27 | 19 | S19-01 (ID-1 / R11 region defaults) | REWRITE | Code defaults a sandbox location to `us-central1`; every service/bucket must be asia-south1 | [stage-19.md:68](stage-19.md#L68) |
| P27 | 19 | S19-07 (ID-8 no-CDN, hosting) | REWRITE | Frontend on Cloudflare (worldwide CDN) vs Google-only Mumbai hosting, no CDN | [stage-19.md:74](stage-19.md#L74) |
| P27 | 19 | S19-08 (ID-8 same-site hosts, cookie) | REWRITE | Bundle calls a public `run.app` URL; cookie forced to `SameSite=None` | [stage-19.md:75](stage-19.md#L75) |
| P27 | 19 | S19-09 (DS19-B usercontent domain) | NEW-BUILD | Previews are same-origin iframes; locked design is a separate registrable domain | [stage-19.md:76](stage-19.md#L76) |
| P27 | 19 | S19-13 (ID-12 images) | REWRITE | `:latest` tag, no digest pins, unpinned apt/pip in images | [stage-19.md:80](stage-19.md#L80) |
| P27 | 20 | VS-1 | REWRITE | Digest-pin base images, move sandbox to 3.13 (same work as stage-19 S19-13) | [stage-20.md:84](stage-20.md#L84) |
| P27 | 20 | VS-6b | NEW-BUILD | No load / failure-injection harness (Phase 5 gate) | [stage-20.md:89](stage-20.md#L89) |
| P27 | 20 | VS-26 | NEW-BUILD | No secret / dependency / image scan, Dependabot, SBOM, notices register | [stage-20.md:110](stage-20.md#L110) |
| P27 | 20 | VS-32 | REWRITE | Cloudflare hosting and CDN-loaded scripts sit outside the stated SaaS boundary | [stage-20.md:114](stage-20.md#L114) |
| P27 | 21 | S21-08 (IP-5 licence / SBOM / scans) | NEW-BUILD | Same work as stage-20 VS-26 | [stage-21.md:57](stage-21.md#L57) |
| P27 | 21 | S21-09 (IP-10 docs structure) | NEW-BUILD | `product`, `api`, `ops`, `legal-trust`, `changelog`, `startup-pack` absent | [stage-21.md:58](stage-21.md#L58) |
| P28 | 10 | AO-6 | NEW-BUILD | nothing exists; whole-document map-reduce with coverage % | [stage-10.md:78](stage-10.md#L78) |
| P28 | 10 | RS-1 (+AO-1, AG14, AG15, RD-13 data) | NEW-BUILD | only a mode flag + prompt paragraph exist | [stage-10.md:88](stage-10.md#L88) |
| P28 | 10 | RS-2 | NEW-BUILD | provider-consistent helpers + lead | [stage-10.md:89](stage-10.md#L89) |
| P28 | 10 | RS-3 | NEW-BUILD | per-run caps 30 min / 50 searches / 5 helpers | [stage-10.md:90](stage-10.md#L90) |
| P28 | 10 | RS-5 | NEW-BUILD | notes checkpoint table, cancel → partial report; the Cloud Run job host is DIFF-INFRA (in-process worker first) | [stage-10.md:91](stage-10.md#L91) |
| P28 | 10 | RS-6 | NEW-BUILD | web + chat/project files for helpers (needs Stage 12 file search) | [stage-10.md:92](stage-10.md#L92) |
| P28 | 10 | RG1 | NEW-BUILD | notes table stores only own notes + links | [stage-10.md:93](stage-10.md#L93) |
| P28 | 10 | RG3 | NEW-BUILD | Claude research budget reservation + Gemini offer | [stage-10.md:95](stage-10.md#L95) |
| P28 | 10 | RG4 | NEW-BUILD | per-run search override, cap 50 | [stage-10.md:96](stage-10.md#L96) |
| P28 | 10 | RG7 | NEW-BUILD | helper/lead effort; with AG10 | [stage-10.md:99](stage-10.md#L99) |
| P28 | 10 | RG8 | NEW-BUILD | one ledger row per helper call | [stage-10.md:100](stage-10.md#L100) |
| P28 | 13 | V-17 | NEW-BUILD | depends on Stage 10 research | [stage-13.md:100](stage-13.md#L100) |
| P28 | 14 | D-17 | NEW-BUILD | with research mode | [stage-14.md:99](stage-14.md#L99) |
| P29 | 1 | R3m, A5 | NEW-BUILD | server STT (Gemini, 2 min, audio deleted) beside the browser Web Speech path | [stage-01.md:101](stage-01.md#L101) |
| P29 | 2 | S2-7 | NEW-BUILD | counted at stage-01 R3m | [stage-02.md:76](stage-02.md#L76) |
| P29 | 9 | MIC | NEW-BUILD | Backend dictation endpoint (<= 2 min) replacing browser-only recognition | [stage-09.md:80](stage-09.md#L80) |
| P29 | 20 | VS-17 | NEW-BUILD | Browser dictation only; no engine bake-off, audio leaves via browser vendor | [stage-20.md:102](stage-20.md#L102) |
| Later | 1 | R15a | NEW-BUILD | Android app absent (build plan Phase 6) | [stage-01.md:112](stage-01.md#L112) |
| Later | 14 | D-31 | NEW-BUILD | Android client, Phase 6 | [stage-14.md:113](stage-14.md#L113) |
| Later | 20 | VS-19 | NEW-BUILD | Expo app absent (Phase 6) | [stage-20.md:104](stage-20.md#L104) |

## Appendix B — deep-dive rows to phases (hand-assigned, every row)

**D1 file handling, §5 gap list (46 rows)**

| D1 row | Phase | | D1 row | Phase | | D1 row | Phase |
|---|---|---|---|---|---|---|---|
| #1 ZIP | P14 | | #14 per-type limits | P06 | | #27 chip stages | P06 |
| #2 send-block, Retry | P01 | | #15 image normalise, HEIC | P09 | | #28 inline vs pointer | P12 |
| #3 state machine | P06 | | #16 audio | P09 | | #29 Office → page images | P19 |
| #4 sniff, legacy, macro | P06 | | #17 project delete refs | P01 | | #30 PDF forms / comments | P12 |
| #5 malware scan | P19 | | #18 claim guard | P01 | | #31 CSV / TXT encodings | P12 |
| #6 encrypted | P06 | | #19 picked project file | P01 | | #32 large media by gs:// | P09 |
| #7 isolated parsing | P06 → P19 | | #20 one ingest path | P12 | | #33 preview size guard | P12 |
| #8 OCR | P09 | | #21 Claude image rule | P09 | | #34 pdftotext guard | P01 |
| #9 derivatives | P12 | | #22 PDF JS strip | P19 | | #35 generation + checksum | P12 |
| #10 token gating | P12 | | #23 error taxonomy | P01 | | #36 resumable upload | P12 |
| #11 PDF → model budget | P12 | | #24 quotas | P06 | | #37 derived image cleanup | P12 |
| #12a Unicode tokenizer | P01 | | #25 pymupdf / tesseract | P18 | | #38 replace project file | P12 |
| #12b chunk cap | P01 | | #26 sandbox caps | P18 | | D1 discard memory table | P06 |
| #12c hybrid retrieval | P20 | | D2 discard single-call OCR | P09 | | D3 discard disclaimer | P01 |
| #13 citations | P16 | | D4 discard pymupdf | P18 | | K1–K14 KEEP · S1 DIFF-STACK | — |

**D2 AI output, §3 findings (45 rows) and §4 hypotheses**

| D2 row | Phase | | D2 row | Phase |
|---|---|---|---|---|
| CXD-3b, GEM-1, ST-2/S18, ST-7, ST-3, ST-4, ID-1/2, CXD-1, AU-1…4/UC-1, LAY-1, TI-1, HO-4/FI-2, SA-2/PT-3/PT-4/WB-1, Doc-sync 2026-10-10 (display) | P07 | | RT-1/MR1, RT-3/MR16, PR-1/RT-4, RT-9/§7.10, Numbers | P10 |
| CXD-4 | P12 | | RT-6/§7.12 | P11 |
| CXD-5/N-16, CXD-6/N-03 | P13 | | RT-4/CR1, §7.9 params (KEEP) | — |
| CXD-9/10, CI-1…6 | P16 | | CC4/MR10 | P02 |
| FI-1/5/6 | P20 | | RP-1/VD-10, VD-3, VD-1/2, VD-6, VD-7, VD-8/9/11/12 | P15 |
| ME-* (KEEP-ish) | P23 | | X-1, X-2, X-3, X-4, X-7, X-9, X-10 | P02 |
| X-5, X-6 | P03 | | X-8 | P07 (and P28) |
| H1, H2, H5, H8 | P07 | | H3 | P10 |
| H4 | P02 (A) / P13 (B) | | H6 | P02 |
| H7 | P03 | | | |

**D3 architecture, §3 flaw register (27 flaws)**

| Flaw | Phase | | Flaw | Phase | | Flaw | Phase |
|---|---|---|---|---|---|---|---|
| A-01 run state in memory | P08 | | A-10 migrate `\|\| true` | P04 | | A-19 dead code, flags | P21 |
| A-02 runs not durable | P08 | | A-11 retrieval loads all chunks | P20 | | A-20 uploads in the request | P06 |
| A-03 concurrent send | P08 | | A-12 warm sandbox state | P18 | | A-21 I/O inside transactions | P08 |
| A-04 unguarded regenerate | P08 | | A-13 generation.ts monolith | P05 | | A-22 lost updates | P08 |
| A-05 settle order | P08 | | A-14 chats.ts orchestration | P05 | | A-23 untyped / silent catches | P21 |
| A-06 budget sources | P08 | | A-15 frontend monoliths, API types | P21 | | A-24 four exec paths | P18 |
| A-07 retries outside gateway | P11 | | A-16 container bypassed | P21 | | A-25 auth read writes | P21 |
| A-08 SSRF regex | P04 | | A-17 config sprawl | P21 | | A-26 SSE transport | P21 |
| A-09 rate-limit key | P04 | | A-18 duplicated paths | P21 | | A-27 test gaps | P03 + each phase's exit test |

**Other register rows:** `numbers-diff.md` DIFF / NOT-WIRED rows and literals without an N-id → P21
(values per OQ-15); `log-content` rows → P22 (coded lines, shadow) and Phase 5 NO_CONTENT enforce
(deferred); licence rows → P18 (pymupdf) and P27 (notices register); test-gap rows → the phase of
their area (D1 §6 → P01 / P06 / P09 / P12 / P14; D2 §6 → P03); owner questions → Phase 0.
