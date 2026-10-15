# Stage 01 — Requirements: conformance audit
Sources read: docs/architecture/Stage-01-Requirements/01-requirements.md; Stage-09 00-checkpoint-stage9.md (G32, N-10 limits, referenced by the Stage 1 doc-sync); Stage-03 03-request-lifecycle.md (D1); Stage-05 05-2-flows.md (F5 UG/UD, AS-D6 via 04-L6); 00-Handoff/00-numbers-register.md (N-01, N-02, N-10, N-11, N-12, N-35); 00-Handoff/00-build-plan-arcnave-tech.md; repo ADR-0053…0057; arcnave.in:docs/architecture/adr/0010, 0012; repo code listed in section 2. Not read: `.env.example` (access denied to the tool), `D:\arcnave.in` code (the local checkout holds only `backend/tests/test_smoke.py` and ADRs, so "Port source" is ADR-only). Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Stage 1 has no checkpoint file. Ids are taken from the requirements table (R1–R15), the decision log (C1–C3, O3), the assumptions (A1–A6), the five doc-sync blocks (DS-A…DS-F, numbered here) and the file-behaviour locks that the 2026-10-03 doc-sync delegates to Stage 9 (FT-1…FT-15, numbered here; source ids in column 2).

## 1. Locked decisions
| Id | Decision (one line) | Status |
|---|---|---|
| R1 | Customers are B2B companies | DEFERRED (company) |
| R2 | ~50 users x ~50 req/day start; must scale without redesign | DEFERRED (scale infra) |
| R3 | Composer inputs: text, file, mic, model picker | LOCKED |
| R4 | Gemini + Claude, "both via Vertex" | SUPERSEDED for Claude (arcnave.in ADR-0012 2026-10-12, repo ADR-0054); Gemini part LOCKED |
| R5 | File types PDF, DOCX, XLSX, PPTX, images, audio, ZIP | LOCKED (+CSV/TXT/MD per DS-A) |
| R6 | Fast reply beats cost | LOCKED |
| R7 | India first | LOCKED |
| R8 | Memory in MVP | LOCKED (design Stage 11) |
| R9 | Built with Claude Code | process, n/a |
| R10 | Google Cloud only | LOCKED, but see R4 |
| R11 | Storage in Mumbai; AI processing may be global | LOCKED |
| R12 | Claude budget ₹1,000/month | SUPERSEDED by RT-7 per-company limit (doc-sync 2026-10-03) -> DEFERRED |
| R13 | Login: e-mail + password, and Google | SUPERSEDED in part: Stage 5 doc-sync 2026-10-09 (ADR-0010: passwordless, invite-only) -> owner question Q1 |
| R14 | ~5,000 users in a year | DEFERRED (scale infra) |
| R15 | Web + Android (iOS later) | LOCKED |
| C1 | Claude is a per-company admin switch, default OFF (UI-5: ArcNave ops only) | DEFERRED (company); repo B-6 dropped it |
| C2 | Models via Vertex global endpoint | LOCKED for Gemini; Claude path SUPERSEDED (R4) |
| C3 | Storage Mumbai only; global managed AI services allowed | LOCKED |
| O3 | Memory design decided at Stage 11 | closed (Stage 11 doc-sync) |
| A1 / A2 | Multi-tenant isolation per company; roles admin + user | DEFERRED (company, roles) |
| A3 | "Fast reply" = streaming, first words ~1–3 s | LOCKED |
| A4 | Peak 3–5x average | DEFERRED (scale infra) |
| A5 | Mic = speech-to-text dictation (not live voice) | LOCKED (engine: Stage 9 SPD-5, Gemini 3.8 Flash) |
| A6 | Memory per user inside a company | LOCKED (company part DEFERRED) |
| DS-A | File types add CSV, TXT, MD (G32); reject macro + legacy Office with "save as" message | LOCKED -> FT-1…FT-3 |
| DS-B | Claude budget = RT-7 per-company limit | DEFERRED (company) |
| DS-C | Memory: document memory, in-turn saves, default ON | LOCKED (Stage 11) |
| DS-D | Billing out of MVP scope; self-signup in MVP (review G-B/G-C) | LOCKED, but see Q1 (ADR-0010 makes sign-up invite-only) |
| DS-E / DS-F | Segment: general B2B first, academics vertical later (FD-21); college cost case parked (FD-16…19) | information, n/a |
| F1–F8, V2–V4 | Verified facts / not-verified items (trial credit, Claude regions, prices) | facts, no repo action |
| FT-1 | CSV, TXT, MD accepted (G32) | LOCKED |
| FT-2 | Macro files .docm/.xlsm/.pptm rejected with a "save as" message | LOCKED |
| FT-3 | Legacy .doc/.xls/.ppt rejected with a "save as" message | LOCKED |
| FT-4 | ZIP (UD-2): 1 level, allowed types only, nested ZIP rejected, ≤100 MB, ≤20 files, ≤500 MB unpacked, zip-slip + zip-bomb guard | LOCKED |
| FT-5 | Images JPEG/PNG/GIF/WebP, HEIC converted, ≤20 MB, ≤8000 px | LOCKED (N-10, UG7) |
| FT-6 | Audio ≤500 MB and ≤3 h; mic max 2 min (N-12) | LOCKED |
| FT-7 | Docs ≤100 MB / ≤1,000 pages; XLSX ≤50 MB (N-10) | LOCKED |
| FT-8 | ≤10 files per message, ≤20 per chat | LOCKED |
| FT-9 | Send blocked until every attached file is "ready" (Stage 3 D1; server 409 "file not ready") | LOCKED |
| FT-10 | Failed file shows reason + Retry + Remove; Send blocked only by files still processing (AS-D6) | LOCKED (FG3 text differs, see Q3) |
| FT-11 | Password-protected PDF/Office fails with a clear reason (UG6, N3) | LOCKED |
| FT-12 | Allowlist by extension after decoding + content-type + file-signature; none alone is enough (UG1, DFR6) | LOCKED |
| FT-13 | Upload starts on attach, direct to storage, resumable, size re-checked on complete (0.2, UD-3, UD-4) | LOCKED |
| FT-14 | Unfinished uploads swept after ~24 h (UG9, 05-3) | LOCKED |
| FT-15 | Upload quota before issuing the upload URL; N-11 = 50 uploads/user/day (AS24, UG3) | LOCKED |

## 2. Repo today
| Id | Evidence (file:line) or not found |
|---|---|
| R3 | Text/file/model picker: `arcnave-frontend/src/Composer.tsx:388-437` (addFiles), `:808` (send button), model menu `:471`. Mic differs: see R3m below. |
| R3m / A5 | Mic is the browser's own speech recognition: `arcnave-frontend/src/Dictation.tsx:2,40-41` (`SpeechRecognition`/`webkitSpeechRecognition`), error copy `:58` ("browser's speech service"). Not found (searched `backend/src/routes` for `speech`, `transcribe`): no server STT endpoint, no 2-minute cap (N-12), no Gemini audio path for the mic. |
| R4 | Gemini adapter `backend/src/providers/gemini.ts:8-9`; Claude adapter on the first-party API `backend/src/providers/anthropic.ts:8,53` (`maxRetries: 0`); ADR-0054 `docs/decisions/0054-claude-first-party-api.md`. |
| R5 / FT-1 | Types: PDF, DOCX, XLSX, PPTX, images, audio accepted: `backend/src/services/storage.ts:341-390` (`ALLOWED`). CSV/TXT/MD accepted: `storage.ts:366-368`, `:393-396`; frontend mirror `arcnave-frontend/src/storage.ts:46-47`. |
| R6 / A3 | SSE streaming with deltas: `backend/src/routes/chats.ts:531-663`; fetch-based client `arcnave-frontend/src/adapter.ts:109-147`. First-word latency is not measured anywhere in the repo (searched `ack`, first-token timers: only `turnTiming.ts` stage marks, `generation.ts:451`). |
| R7 | Tamil/brand fonts bundled: `arcnave-frontend/src/main.tsx:5-8`; Tanglish rule `CLAUDE.md:100`. |
| R8 / A6 | Per-user memory: `backend/src/db/schema.ts:763-799` (`memory_items.user_id`), routes `backend/src/routes/memory.ts:55-296`. |
| R10 | Everything except the Claude API runs on Google (Vertex Gemini, GCS, Cloud Run per ADR-0053); Claude is outside GCP by owner decision (ADR-0054). |
| R11 / C3 | `backend/src/config.ts:112` `VERTEX_LOCATION` default `global`; storage region is bucket config only (`config.ts:326-333`, no region in code); `SANDBOX_LOCATION` default `us-central1` at `config.ts:254`; build plan P2-C re-points it to asia-south1. |
| R13 | Argon2id m=19 MiB t=2 p=1: `backend/src/services/auth.ts:54-56`; Google ID-token sign-in: `backend/src/routes/auth.ts:96-115`, `backend/src/services/googleSignIn.ts:18-48`, ADR-0056. |
| R15 | Web SPA yes (`arcnave-frontend/src/App.tsx:120-164`). Android: not found (searched repo top level: only `backend/`, `arcnave-frontend/`, `tools/`). |
| C2 | `config.ts:112,114` (`VERTEX_LOCATION` default `global`, `GEMINI_LOCATION` optional). |
| DS-C | `backend/src/db/schema.ts:95` (`memory_enabled` default true); `backend/src/config.ts:303` (`ENABLE_MEMORY`). |
| DS-D | Self-signup on: `config.ts:91` (`REGISTRATION_ENABLED` true), `routes/auth.ts:49-71`. No billing code found (searched `invoice`, `plan`, `payment` in backend/src: none). |
| FT-2 | Not found: no macro rule. A `.docm`/`.xlsm`/`.pptm` falls to the generic refusal "This file format is not supported. Try a document, image, spreadsheet, or code file." `storage.ts:479-483`; `.xlsm` is absent from `OFFICE_EXTENSIONS` (`storage.ts:405-413`). No "save as" wording anywhere (searched `save as`, `Save as` in backend/src and arcnave-frontend/src). |
| FT-3 | `.xls` is accepted and read: `storage.ts:349,353-354,407`; extractor `processUpload.ts:97,129`; `retrieval.ts:68,328`; frontend regex `arcnave-frontend/src/storage.ts:47`. `.doc` and `.ppt` are refused only by the generic message `storage.ts:479-483`. |
| FT-4 | Not found (searched `application/zip`, `.zip`, `zip` in `backend/src/services/storage.ts`, `services/attachments/*`, `routes/files.ts`; the only zip use is `.epub` as a container at `storage.ts:364` and the data-export writer `services/accountExport.ts`). |
| FT-5 | Images JPEG/PNG/WebP/GIF accepted `storage.ts:376-379`; limit 10 MB `processUpload.ts:36` and `arcnave-frontend/src/storage.ts:52` (register: 20 MB); 8000 px `processUpload.ts:34,258-264` (matches). HEIC/HEIF not accepted (not in `ALLOWED`). |
| FT-6 | Audio mp3/wav/ogg/flac/aac accepted `storage.ts:381-386`; m4a and audio/webm absent; 500 MB is the generic cap for every type `config/numbers.ts:59`, `routes/files.ts:160`; no 3-hour check (searched `duration`, `ffprobe`: not found; sandbox image has no ffmpeg: `backend/sandbox/Dockerfile:12`, `Dockerfile.service:18`). |
| FT-7 | No per-type caps: multipart `/files` 30 MB `numbers.ts:57`, direct upload 500 MB for all types `numbers.ts:59`. PDF 1,000 pages enforced `processUpload.ts:31,185-191` (matches). No 50 MB XLSX or 100 MB document rule (searched `50 * 1024`, `100 * 1024`: not found). Extraction memory guard `processUpload.ts:107-137` stores big files without text. |
| FT-8 | 10 per message `routes/chats.ts:546`, `Composer.tsx:390`; 20 per chat `processUpload.ts:30`, enforced under a row lock `chats.ts:1098,1114`. |
| FT-9 | `Composer.tsx:445` (`pending` = any `uploading`), `:451`, `:808` (send disabled), `:833-836` ("Waiting for uploads to finish…"); server refuses `upload_incomplete` 409 `chats.ts:1103-1107`, `errors.ts:93-97`. No separate "processing" state: extraction runs inside `/files/:id/complete` (`routes/files.ts:261-264`). |
| FT-10 | Reason shown `Composer.tsx:215-216`; Remove button `:232-236`. Retry: not found (searched `Retry`, `retry` in Composer.tsx and ChatStates.tsx; error copy says "Remove the file and try again" `Composer.tsx:430`). Send is not blocked by failed files: `Composer.tsx:446-455` sends `ready` + `unsupported` files and silently drops `failed`; footnote "Files marked with a warning are sent without their text" `:837`. |
| FT-11 | Encrypted/corrupt PDF becomes `unsupported`, stored: `processUpload.ts:177-183`; not refused at upload. Office password files: `ExtractionUnsupported` -> `unsupported` `processUpload.ts:274-276`. |
| FT-12 | MIME + extension both checked `storage.ts:457-477`; code comment states "Neither is a content sniff" `storage.ts:337-340`; no magic-byte check (searched `magic`, `signature` in services/storage.ts, services/attachments: not found). Extras beyond the locked list are accepted: odt, rtf, epub, json, html, css, xml, js/ts/py/sql, mp4/webm/mov `storage.ts:361-389`. |
| FT-13 | Upload on attach `Composer.tsx:388-437`; direct resumable GCS session `services/storage.ts:282-300`, `routes/files.ts:137-187`; size re-check on complete `files.ts:251-260`. |
| FT-14 | `config.ts:338` `UNSENT_UPLOAD_TTL_HOURS` 24; sweeper `services/retention.ts:12-13`, scheduled hourly `index.ts:34-45`. |
| FT-15 | Not found (searched `UPLOADS_PER`, `quota`, `PER_DAY` in backend/src: only `UNSENT_UPLOAD_TTL_HOURS`). |

N-xx in scope (register vs repo):
| N | Register (line) | Repo (file:line) |
|---|---|---|
| N-10 | docs 100 MB/1,000 pp · XLSX 50 MB · images 20 MB · audio 500 MB/3 h · ZIP 100 MB/20 files/500 MB · ≤10/msg · ≤20/chat (numbers-register.md:15) | project files 30 MB `numbers.ts:57`; attachments 500 MB flat `numbers.ts:59`; images 10 MB `processUpload.ts:36`; pages 1,000 `processUpload.ts:31`; visual pages 100 `processUpload.ts:33`; 10/20 files `chats.ts:546`, `processUpload.ts:30`; no ZIP, no audio duration, no XLSX cap |
| N-11 | uploads 50/user/day, OCR 5,000 pages/company/month (register Stage-18 column, line 71 + review revision line 86) | none (uploads); OCR n/a |
| N-12 | mic 2 min (numbers-register.md:17) | none, Web Speech has no cap `Dictation.tsx` |
| N-02 | message 32,000 chars (register line 71) | 100,000 `routes/chats.ts:543`; no N-02 row in `config/numbers.ts` |
| N-01 | user 20 / company 300 / edge 600 req/min (register line 71) | generate 20 `numbers.ts:65`; every route 120 `numbers.ts:67`; auth 10 `config.ts:369`; no company or edge limit |

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| R1, R2, R12, R14, C1, A1, A2, A4, DS-B | DEFERRED | company / tenancy / scale infra — see deferred-g1.md |
| R3 | KEEP | text, file and model picker met (Composer.tsx:388-437, 808) |
| R3m, A5 | NEW-BUILD | server STT (Gemini, 2 min, audio deleted) beside the browser Web Speech path |
| R4 | KEEP | Gemini via Vertex and Claude via first-party API both implemented (owner ADR-0012/0054) |
| R5 | KEEP | the six non-ZIP types accepted (ZIP counted at FT-4) |
| R6, A3 | KEEP | streaming reply; first-word latency unmeasured (note, not a gap) |
| R7 | KEEP | Tamil fonts and Tanglish rule present |
| R8, A6, DS-C | KEEP | Markdown memory per user, default ON |
| R9 | n/a | process rule |
| R10 | KEEP | only Claude is off-GCP, by owner decision |
| R11, C3 | DIFF-INFRA | bucket region and `SANDBOX_LOCATION=us-central1` are deployment settings (build plan P2-C) |
| R13 | KEEP | Argon2id + Google sign-in present; passwordless conflict is Q1 |
| R15 | KEEP (web) | SPA present |
| R15a | NEW-BUILD | Android app absent (build plan Phase 6) |
| C2 | KEEP | `VERTEX_LOCATION` default global |
| O3 | KEEP | closed |
| DS-D | KEEP | self-signup + no billing; but Q1 |
| DS-E, DS-F, F1–F8, V2–V4 | n/a | information |
| FT-1 | KEEP | CSV/TXT/MD accepted |
| FT-2 | REWRITE | macro files hit the generic refusal; no "save as" message |
| FT-3 | REWRITE | `.xls` accepted and read; `.doc/.ppt` get the generic refusal |
| FT-4 | NEW-BUILD | no ZIP path at all |
| FT-5 | REWRITE | image cap 10 MB vs 20 MB; HEIC refused |
| FT-6 | REWRITE | m4a/webm audio missing, no 3 h check |
| FT-7 | REWRITE | no per-type caps (docs 100 MB, XLSX 50 MB) |
| FT-8 | KEEP | 10 and 20 enforced |
| FT-9 | KEEP | send blocked while uploading; server 409 |
| FT-10 | REWRITE | no Retry; failed files do not block Send |
| FT-11 | REWRITE | encrypted files stored as `unsupported`, not refused with a reason at upload |
| FT-12 | REWRITE | no signature check; extra types beyond the locked list |
| FT-13 | KEEP | resumable direct upload with size re-check |
| FT-14 | KEEP | 24 h sweeper |
| FT-15 | NEW-BUILD | no upload quota |

Counts: KEEP 20 (R3, R4, R5, R6, R7, R8, R10, R13, R15-web, C2, O3, A3, A6, DS-C, DS-D, FT-1, FT-8, FT-9, FT-13, FT-14) · REWRITE 8 (FT-2, FT-3, FT-5, FT-6, FT-7, FT-10, FT-11, FT-12) · NEW-BUILD 4 (R3m/A5, R15a, FT-4, FT-15) · DIFF-STACK 0 · DIFF-INFRA 2 (R11, C3) · DISCARD 0 · DEFERRED 9 (not bucketed) · n/a 4 groups (R9, DS-E/F, facts, A5 counted at R3m).

## 4. Non-KEEP items
### R3m / A5 — Mic through the server (SPD-5)
- Exact change: new `POST /v1/speech/transcribe` (audio ≤ N-12 2 min, verbatim-transcript prompt on Gemini 3.8 Flash through `backend/src/providers`, audio deleted after the transcript, typed errors for no-speech/too-long/bad-format); frontend records with MediaRecorder (webm/m4a, SP5) and puts the text in the composer, editable. Files touched: `backend/src/routes/speech.ts` (new), `backend/src/app.ts`, `backend/src/config/numbers.ts` (N-12), `backend/src/providers/*` (audio call), `arcnave-frontend/src/Dictation.tsx`, `arcnave-frontend/src/api.ts`. Port source: none locally (arcnave.in checkout has no code; Stage 9 SPD-5 is the spec).
- Option A (NEW-BUILD): build the server path behind a flag, keep Web Speech as fallback, switch when Tamil/Tanglish eval passes. Time M · risk: needs paid Gemini audio quota; Tanglish quality unproven · breaks: nothing (new route); ADR-0042 gets superseded.
- Option B (REWRITE Dictation.tsx in place): time M · risk: dictation unavailable while it is rebuilt · breaks: `Dictation.test.tsx`, ADR-0042.
- Pick: A — keeps the app runnable at every commit.

### R15a — Android app
- Exact change: Expo SDK 57 app (chat, stream/resume, files, mic, memory) on the same API; the API needs bearer/refresh tokens beside the cookie (L1b FE-3, Stage 4 L3 pipeline step 2) and a min-app-version header (P31). Files touched: new `mobile/`, `backend/src/routes/auth.ts`, `backend/src/services/auth.ts`. Port source: none.
- Option A (NEW-BUILD): follow build plan Phase 6. Time L · risk: auth model change · breaks: none until tokens are added.
- Option B: none acceptable (R15 is locked).
- Pick: A — schedule is already Phase 6; no change now.

### FT-2 / FT-3 — Macro and legacy Office refusal with "save as"
- Exact change: in `checkUpload` add an explicit refusal map before the allowlist (`.docm/.xlsm/.pptm` macro, `.doc/.xls/.ppt` legacy) returning `unsupported_media_type` with a "Save it as .docx/.xlsx/.pptx and upload it again" detail; delete the `.xls` MIME/extension entries and the `xls` extractor; update the frontend `allowed` regex. Files touched: `backend/src/services/storage.ts`, `backend/src/services/attachments/processUpload.ts`, `backend/src/services/retrieval.ts`, `arcnave-frontend/src/storage.ts`, tests `storage.test.ts`, `files.integration.test.ts`, `processUpload.test.ts`, `retrieval.test.ts`. Port source: none.
- Option A (REWRITE in place): time S · risk: users with .xls files get a refusal (intended) · breaks: tests that upload .xls.
- Option B: keep .xls reading and only warn — violates the locked "reject" line; not acceptable.
- Pick: A.

### FT-4 — ZIP upload (UD-2)
- Exact change: accept `application/zip`/`.zip`; expand with stream extraction and running byte/count counters (no stdlib `extractall`): 1 level, allowed inner types only, nested ZIP refused, ≤100 MB archive / ≤20 files / ≤500 MB unpacked, path check against zip-slip, encrypted entries refused; each inner file becomes its own attachment (counts toward the 10/20 limits). Files touched: new `backend/src/services/attachments/zipExpand.ts`, `storage.ts` (allowlist), `routes/files.ts` (complete), `chats.ts` file counting, frontend `allowed` regex + chip grouping. New dependency check: a streaming unzip library is not in the Stage 20 package register -> stop and ask (candidates: yauzl; `fflate` streaming). Port source: none locally.
- Option A (NEW-BUILD): leave current path, add the ZIP branch inside `complete` behind a flag. Time M · risk: zip-bomb handling is security-sensitive (review in full) · breaks: none.
- Option B (do ZIP inside the sandbox, Python `zipfile` with counters): time M · risk: sandbox has no egress (good) but adds a round trip for every ZIP · breaks: none.
- Pick: B if the dependency question is "no new Node library"; else A. Owner/reviewer to choose after the package register check (open question Q4).

### FT-5 — Image limits and HEIC
- Exact change: image cap 20 MB read from the N-10 row in `config/numbers.ts` (replace `FILE_LIMITS.imageMaxBytes` literal `processUpload.ts:36` and frontend `MAX_IMAGE_BYTES` `arcnave-frontend/src/storage.ts:52`); accept `.heic/.heif`, send natively to Gemini, convert for Claude (≤5 MB, UG7). Files touched: `processUpload.ts`, `numbers.ts`, `storage.ts` (both), `anthropic.ts` attachment path. HEIC conversion needs a library or sandbox tool not in the repo (new dependency -> stop and ask).
- Option A (REWRITE): cap now, HEIC later with the Stage 9 audit. Time S · risk: none · breaks: image limit tests.
- Option B: cap + HEIC together. Time M · risk: new dependency · breaks: tests.
- Pick: A.

### FT-6 — Audio formats and 3 h limit
- Exact change: add `audio/mp4`, `audio/x-m4a` (.m4a), `audio/webm`; enforce ≤3 h by probing duration (needs ffprobe: not installed in either image -> new dependency, ask) or, until then, refuse by the provider's own limit and map it to `provider_payload_limit`. Files touched: `storage.ts`, `processUpload.ts`, sandbox Dockerfile. 
- Option A (REWRITE with ffprobe in the sandbox image): time M · risk: image size, new dependency.
- Option B (formats now, duration by provider error): time S · risk: user waits for a late refusal.
- Pick: B now, A when the dependency is approved.

### FT-7 — Per-type size caps
- Exact change: one table in `config/numbers.ts` for N-10 (docs 100 MB, XLSX 50 MB, images 20 MB, audio 500 MB, ZIP 100 MB), applied in `checkUpload` by extension/MIME; keep 500 MB only as the transport ceiling; align `MAX_UPLOAD_BYTES` multipart 30 MB with the project-file rule (Stage 9 G43). Files touched: `numbers.ts`, `config.ts`, `storage.ts`, `routes/files.ts`, `projects.ts:374`. Time S, risk low, breaks upload-size tests. Pick: this (single option).

### FT-10 — Failed-file Retry and Send gating
- Exact change: add a Retry action on a failed chip (re-run `api.files.upload` for uploads that failed; call `/files/:id/complete` again for server-side failures); decide whether a failed/unsupported file blocks Send (Q3). Files touched: `Composer.tsx`, `ChatStates.tsx`, `routes/files.ts`. Time S. Pick: add Retry now; gate by the owner's answer.

### FT-11 — Encrypted file refusal
- Exact change: detect encrypted PDF (`pdfinfo` message) and password-protected OOXML (EncryptedPackage/OLE header) at `/complete`, delete the object and return a typed error with the reason (instead of storing as `unsupported`). Files touched: `processUpload.ts:170-184,268-279`, `routes/files.ts:233-266`. Time S. Pick: this.

### FT-12 — Signature check and allowlist trim
- Exact change: add a magic-byte check (PDF `%PDF`, OOXML `PK`, PNG/JPEG/GIF/WebP, MP3/WAV/OGG/FLAC) at `/complete`; double-extension/null-byte rejection; decide whether to drop the extra types (Q5). Files touched: `storage.ts` (new `sniff`), `routes/files.ts`. Time S–M. Pick: sniff now (security-reviewed); the allowlist trim waits for Q5.

### FT-15 — Upload quota
- Exact change: count uploads per user per day (50, N-11) before issuing the upload URL in `/files` and `/files/uploads`; typed error with reset time. Files touched: `routes/files.ts`, `usage` service or a counter table, `numbers.ts`. Time S. Pick: this.

## 5. Open questions for the owner
- Q1. Sign-in method: arcnave.in ADR-0010 (owner 2026-10-09; Stage 5 05-1 doc-sync) = passwordless, invite-only, no password tables; build plan Phase 1 + repo ADR-0056 (owner 2026-10-14) = keep e-mail/password and Google, self-signup. Which one is the target? (Stage 1 R13/DS-D read the old way.) Not resolved here.
- Q2. Haiku 5.5 is named by N-69 (router M2) and N-76/N-77 (title/summary jobs) but build plan B-4 / ADR-0055 says three models only. Do router and jobs use Haiku, or Gemini/Flash-Lite, or rules only? (Affects Stage 3 steps 2.1, 6.4, 6.5.)
- Q3. AS-D6 says Send is blocked only by files still processing; 05-2 FG3 says a failed file must be removed first. Which rule?
- Q4. ZIP expansion: allow a new Node library (package register) or do it in the Python sandbox?
- Q5. The repo accepts odt/rtf/epub/json/html/css/xml/js/ts/py/sql/video in addition to the locked list. Keep them (record as an extension) or trim to the locked list?

## 6. KEEP spot-check
20 KEEP rows; 3 re-opened in code this session (≥10 %): FT-8 (`chats.ts:546`, `chats.ts:1114`, `processUpload.ts:30` confirmed), FT-9 (`Composer.tsx:445`, `:808` confirmed; `chats.ts:1103-1107` confirmed), R13 (`auth.ts:54-56` confirmed). Downgrades: none. Note: R6/A3 stayed KEEP, but the first-word target is untested (no measurement in repo).
