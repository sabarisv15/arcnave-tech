# tech-audit.A — summary

Conformance audit of the 21 locked stages against the built repo, plus three deep-dives (files,
AI output, architecture). **Docs only — no code, config or test changed.** 2026-10-15.

| | |
|---|---|
| Repo audited | `sabarisv15/arcnave-tech`, branch `audit/stage-1-21` from `origin/main` @ `baca408` (PR #39 + #40 merged), cloned to `D:\arcnave-tech` |
| Target spec | `docs/architecture/` mirror (latest doc-sync line wins). The owner's `D:\Architecture` is an older snapshot (3 Oct, Stages 1–13) — used only for the 68 Stage 6 eval cases, prompt history and Stage 8 skill-test files |
| Yardstick | Owner rule 2026-10-15 → [ADR-0061](../../decisions/0061-locked-decisions-win-outside-stack-and-infra.md): match every locked outcome except tech stack and infra; ADR-0053 #2 "repo wins" withdrawn |
| Port source | Archived Python repo `sabarisv42/arcnave.in` — **reachable** as the local clone `D:\arcnave.in` (`backend/packages/*`, `backend/apps/*`, `infra/`, `prompts/`); read, not changed |
| Reference handbook | `docs/architecture/reference/claude-managed-agents-handbook.pdf` — **absent**; not used, no pattern from it proposed |
| Models | Main session **Claude Opus 5.5** (`claude-opus-5-5`): setup, ADR-0061, reconciliation, 13 claim spot-checks + 15 KEEP spot-checks, FINDINGS / EVIDENCE / DEFERRED assembly, this file, NEW-PLAN. Eight subagents, all **Claude Sonnet 5.5**: G1 (Stages 1–5), G2 (6–9), G3 (10–14), G4 (15–18), G5 (19–21 + numbers), D1 files, D2 AI output, D3 architecture. No Haiku. No provider calls. |
| Process deviations | The custom read-only agent type could not be loaded mid-session, so the auditors ran as `general-purpose` with the tool limit as an instruction; three of them used Bash / Edit on their own files (logged). `.env.example` could not be read by anyone (permission rule; not bypassed). Details: [AUDIT-LOG.md](AUDIT-LOG.md) §2, §3, §5 |

## 1. What the audit found

The repo is a working single-user product, but against the locked design it is **mostly not
there yet**: of 669 bucketed decision rows, 132 are KEEP, **362 need work (195 REWRITE, 167
NEW-BUILD)**, 48 differ only by stack or infra, 71 are owner-deferred and 52 belong to another
stage's row. The owner's three complaints are confirmed in code:

- **Files (D1):** a synchronous, in-process extractor with three statuses. No OCR at upload
  (scans over 100 pages are unreadable; mixed PDFs drop their scanned pages), no ZIP, legacy
  `.xls` accepted, failed files sent along with no Retry, untrusted files parsed inside the API
  process, and project search that cannot see Tamil or Hindi text (ASCII-only tokenizer). Deleting
  a project file breaks every sandbox call in chats that picked it. 8 P0, 26 P1 gaps.
- **AI output (D2, hypotheses until confirmed):** one Claude-app-shaped prompt of roughly 30 k
  tokens with 35 tools goes to every model, including the default Gemini 3.8 Flash, and tells it
  to "be concise by default"; Auto keeps plain turns on Gemini Flash and pins the chat; Gemini
  still clears old tool results against ADR-0023; history is cut using the `Auto` window with no
  summary; nothing measures answer quality (0 of the 68 locked cases run). The locked per-model
  renderings, profiles, summary job and Stage 13 validators are not built.
- **Architecture (D3):** run state lives in process memory with up to 8 instances; answer text
  is saved only at the end, with no sweeper or drain; a turn settles through independent commits
  in two orders; a retry after a tool round runs the tools again; the SSRF guard is a hostname
  regex; the rate-limit key is the proxy address; failed migrations are ignored at boot. 12 P1,
  15 P2 flaws. Most fixes are already prescribed by a locked stage and need neither Redis nor
  Cloud Tasks.

What is sound and kept: storage-key and ownership guards, the 10 / 20 file counts, page-image
rendering on demand, Gemini page images by `gs://`, no sampling parameters anywhere, explicit
effort, Claude SDK retries off, usage summed per round, SSE headers, typed errors in one
catalogue (42 codes), and the honest labelling of the model that answered.

## 2. Counts per bucket per stage

Mechanical count of the rows in each stage file's §3 table (rows can group several ids, so
these differ slightly from the auditors' id counts in their returns; AUDIT-LOG C-4). "n/a" = the
row is bucketed in another stage's file. "SUPERSEDED" here = a §3 row bucketed as superseded; the
37 superseded decisions from §1 tables are listed in §5.

| Stage | KEEP | REWRITE | NEW-BUILD | DISCARD | DIFF-STACK | DIFF-INFRA | DEFERRED | n/a | owner-Q | SUPERSEDED | rows |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 17 | 8 | 4 | 0 | 0 | 1 | 1 | 2 | 0 | 0 | 33 |
| 2 | 11 | 4 | 2 | 0 | 0 | 3 | 5 | 1 | 0 | 0 | 26 |
| 3 | 9 | 7 | 2 | 0 | 0 | 0 | 1 | 7 | 0 | 0 | 26 |
| 4 | 15 | 10 | 9 | 0 | 3 | 2 | 11 | 22 | 0 | 0 | 72 |
| 5 | 7 | 12 | 4 | 0 | 1 | 1 | 1 | 11 | 0 | 0 | 37 |
| 6 | 4 | 23 | 18 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 48 |
| 7 | 5 | 5 | 4 | 0 | 0 | 1 | 1 | 1 | 0 | 0 | 17 |
| 8 | 5 | 13 | 9 | 0 | 0 | 0 | 1 | 1 | 1 | 0 | 30 |
| 9 | 2 | 10 | 13 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 27 |
| 10 | 8 | 4 | 14 | 0 | 0 | 1 | 1 | 1 | 0 | 0 | 29 |
| 11 | 6 | 14 | 2 | 0 | 0 | 0 | 2 | 1 | 0 | 0 | 25 |
| 12 | 2 | 6 | 15 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 26 |
| 13 | 4 | 7 | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 26 |
| 14 | 7 | 9 | 10 | 0 | 2 | 1 | 2 | 0 | 0 | 0 | 31 |
| 15 | 8 | 24 | 8 | 0 | 1 | 2 | 7 | 1 | 0 | 0 | 51 |
| 16 | 7 | 14 | 12 | 0 | 0 | 3 | 12 | 0 | 0 | 0 | 48 |
| 17 | 4 | 4 | 3 | 0 | 2 | 0 | 18 | 0 | 0 | 1 | 32 |
| 18 | 3 | 4 | 3 | 0 | 0 | 1 | 4 | 2 | 1 | 0 | 18 |
| 19 | 2 | 7 | 2 | 0 | 2 | 8 | 0 | 0 | 0 | 0 | 21 |
| 20 | 4 | 7 | 13 | 0 | 11 | 0 | 0 | 0 | 0 | 0 | 35 |
| 21 | 2 | 3 | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 11 |
| **All** | **132** | **195** | **167** | **0** | **24** | **24** | **71** | **52** | **2** | **2** | **669** |

**Deep-dives:** D1 files — 46 gap rows: REWRITE 24 · NEW-BUILD 16 · DISCARD 4 · KEEP 1 row (14 items) · DIFF-STACK 1; P0 8 · P1 26 · P2 6.
D2 AI output — 45 finding rows (9 High, 20 Medium, 14 Low, 2 no-gap KEEP) and 8 ranked hypotheses.
D3 architecture — 27 flaws (P0 0 · P1 12 · P2 15).
**Numbers register (77 N-ids):** DIFF 23 · ABSENT 24 · NOT-WIRED 2 · MATCH 3 · N/A-deferred 25; 23 literals without an N-id ([numbers-diff.md](numbers-diff.md)).
**Master register:** [FINDINGS.md](FINDINGS.md) — 1,484 rows, every source section count-checked.

**Read KEEP with care:** of 15 KEEP rows re-opened by the main session, 5 needed a qualifier
(AUDIT-LOG §4.2): DS-D self-signup is contested (ADR-0010 vs ADR-0056); E2 "one run per chat"
holds on one instance only; RT-9 "Opus manual only" is broken by Auto; CVS6 Gemini model id is
unverified; NO-SILENT-SUB labels the answering model but shows no reason. Treat a KEEP as "KEEP for
the single-user, single-instance prototype" unless a later check says more.

## 3. Highest-impact findings (each checked in code by the main session unless marked)

| # | Finding | Evidence | Check |
|---|---|---|---|
| 1 | Project search is ASCII-only — Tamil / Hindi text has zero tokens | `backend/src/services/retrieval.ts:415-418` | S-05 confirmed |
| 2 | Scanned PDFs get no OCR at upload; > 100-page scans unreadable; mixed PDFs drop scanned pages | `processUpload.ts:224-226`, `retrieval.ts:155-180` | D1 trace (not re-run) |
| 3 | A retry after a tool-only round re-runs the tools (incl. write tools) | `services/generation.ts:1376-1392` | S-09 confirmed in code |
| 4 | Run state in process memory; text saved only at the end; no sweeper / drain | `container.ts:71`, `routes/chats.ts:568`, `generation.ts:2138` | K-13 confirmed |
| 5 | SSRF guard is a hostname regex; redirects followed before the check; `[::1]` passes | `services/webFetch.ts:19-37,82,89-92` | S-07 confirmed |
| 6 | Gemini clears old tool results, against ADR-0023 | `providers/gemini.ts:382-408` | S-03 confirmed |
| 7 | One ~30 k-token prompt + 35 tools to every model; "Be concise by default" | `services/systemPrompt.ts:66`; D2 §2 (size is an estimate) | S-06 confirmed (size not measured) |
| 8 | Rate-limit key falls back to the proxy IP before the session is resolved; no `trustProxy` | `app.ts:56,93-106`, `plugins/context.ts:40,55` | S-08 confirmed in code |
| 9 | Failed migration still starts the server | `backend/Dockerfile:69` | S-01 confirmed |
| 10 | `/v1/models` and `/models/refresh` need no login (probe spends provider calls) | `routes/models.ts:39,166` | S-12 confirmed |
| 11 | Deleting a project file deletes bytes chat attachments still use | `routes/projects.ts:530-535` | D1 trace |
| 12 | Hard-coded identifiers in launch code (service-account default, project-numbered URL) | `tools/sandbox/cloudRunSandboxClient.ts:215`, `arcnave-frontend/src/api.ts:33` | G5 (values not reproduced) |
| 13 | AGPL `pymupdf` in the sandbox image, against TD-4c / Stage 20 | `backend/sandbox/Dockerfile.service:28` | three auditors |
| 14 | Turn deadline 59 min vs register 10 min; Gemini retry set by text match | `config/numbers.ts:38-39`, `providers/gemini.ts:233-238` | S-10, S-11 confirmed |
| 15 | `@google/genai` retries not turned off (locked VS-29) | `providers/gemini.ts:349-353` | S-02 confirmed |
| 16 | 0 of 68 locked prompt cases run; the kit's gates are string checks | `test/promptKit/cases.ts:1-20` | D2 (two auditors) |

## 4. The REWRITE / NEW-BUILD / DISCARD list

Every row, with its phase in the proposed plan: [NEW-PLAN.md](NEW-PLAN.md) Appendix A (362 stage
rows) and Appendix B (D1 / D2 / D3 rows). Compact id list per stage:

| Stage | REWRITE | NEW-BUILD |
|---|---|---|
| 1 | FT-2 · FT-3 · FT-5 · FT-6 · FT-7 · FT-10 · FT-11 · FT-12 | R3m, A5 · R15a · FT-4 · FT-15 |
| 2 | S2-3 · S2-4 · RL2 · GB-1 | S2-7 · DS-3b |
| 3 | 1.3 · 1.5 · 1.6 · 1.7 · 1.8 · 6.1 · 7.3 | 1.4 · 6.4 |
| 4 | B2 · B20 · B24 · C4 · D6 · D8 · E19 · F6 · G4 · H10 | B11 · D11 · D12 · E15 · E18 · E20 · E22 · F3 · G3 |
| 5 | P2 · P3, TB2 · P9 · TB1 · TB6 · TC1, TC2 · TF · F3b · F4b · F4c · F6b · F8b | P5 · P11 · TB3 · TB8 |
| 6 | CXD-1 · CXD-2 · CXD-5 · CXD-7 · SR-ESC · SR-PROV · SR-SKILLS · PS-AU · PS-UC · PS-ST · PS-HO · PS-SA · PS-PT · PS-WB · PS-CF · PS-WS · PS-ME · PS-TO · PS-AR · PS-SK · HIST-WINDOW · MP-2 · CR1 | CXD-3b · CXD-4 · CXD-6 · CXD-10 · SR-SESSION · SR-TURN · SR-USER · SR-CACHE-G · PS-ID · PS-CP · PS-CI · PS-TI · PS-PK-LM · PS-FI · PS-PR · STAMPS · REC · HP-TITLE |
| 7 | RT-1 (Auto rules + 7.9 hard rules) · RT-4 · RT-9 / 7.10 registry rows · 7.9 capability matrix · 7.14 upgrade process | RT-2 / RT-3 / M2 (Haiku router) · RT-6 / 7.12 fallback chain + labels · M7 / `job` role · BREAKER |
| 8 | T-file_search · T-read_file · T-web_search (+TD-2b, TD-21, TX1-TX5, CX1-CX3) · TD-14 controls · T-fetch_url (+TD-3) · TD-12 / TS-1..5 / TS-9 · TS-6 / TS-7 · SB-TOPOLOGY (TD-4b, TD-5d, Stage 19 ID-7) · SB-LIMITS (TD-5c, N-08, N-68) · SB-IMAGE (TD-4c) · TD-7 · TD-11 · SF-10 | T-run_code · T-create_artifact / T-update_artifact · T-load_skill (+SF-5) · T-get_operation_status · TS-12 / TD-20 · TD-6 / TD-18 · TD-8 · SF-PACKS (SF-1..SF-4, SF-6..SF-8) · SF-9 |
| 9 | INTAKE · TYPES · LIMITS · AUDIO · EXCEL · IMAGES · PDF->MODEL · CHUNK · CLAUDE-IMG/PDF · LIFE-MORE | PIPE · SCAN · ZIP · ISOLATION · OFFICE->PDF · EXTRACT · OCR-M11 · MIC · NORM · EMBED · TOKENS · RETRY · G13 |
| 10 | AG10 · O-2/N-06 · RG2 · RG6 | AO-6 · AO-7 · AO-10 · AO-4b · RS-1 (+AO-1, AG14, AG15, RD-13 data) · RS-2 · RS-3 · RS-5 · RS-6 · RG1 · RG3 · RG4 · RG7 · RG8 |
| 11 | M-02 · M-03 · M-04 · M-05 · M-06 · M-07 · M-08 · M-09 · M-10 · M-11 · M-13 · M-16 · M-17 · M-20 | M-12 · M-19 |
| 12 | L-01 · L-02 · L-03 · L-06 · L-07 · L-10 | L-04 · L-05 · L-08 · L-09 · L-11 · L-13 · L-14 · L-15 · L-16 · L-17 · L-18 · L-20 · L-21 · L-22 · L-25 |
| 13 | V-02 · V-05 · V-06 · V-09 · V-15 · V-21 · V-24 | V-01 · V-03 · V-04 · V-07 · V-08 · V-10 · V-11 · V-12 · V-13 · V-14 · V-16 · V-17 · V-18 · V-19 · V-20 |
| 14 | D-03 · D-07 · D-09 · D-14 · D-18 · D-19 · D-22 · D-23 · D-26 | D-02 · D-06 · D-10 · D-11 · D-12 · D-13 · D-17 · D-24 · D-29 · D-31 |
| 15 | ER-1b · ER-2b · ER-2e · ER-2f · ER-2g · ER-2h · ER-3c · ER-3d · ER-4a · ER-4b · ER-4c · ER-4d · ER-6a · ER-8a · ER-8b · ER-8c · ER-9 · ER-10a · ER-10c · ER-11 · ER-12a · AL-1 · AL-2 · AL-4 | ER-3b · ER-4f · ER-12b · ER-13 · ER-14a · ER-14b · AL-5 · DS-3 |
| 16 | SD-1b · SD-1d · SD-1f · SD-1g · SD-2b · SD-6c · PH-2 · PH-4 · FL-4 · FL-5 · SD-9a · SD-10 · INJ-2 · INJ-7 | SD-1a · SD-6b · FL-1 · FL-2 · FL-3 · SD-7 · SD-9b · INJ-3 · INJ-4 · INJ-6 · SD-11 · AB-1 |
| 17 | OD-2b · OD-8 · OD-13 · LG-3 | OD-15b · LG-1 · LG-2 |
| 18 | FD-08 / FD-10-L1 · FD-09-L7 · LED-1 · N-74c | FD-10-L4 · CD-1 · FD-26 |
| 19 | S19-01 (ID-1 / R11 region defaults) · S19-07 (ID-8 no-CDN, hosting) · S19-08 (ID-8 same-site hosts, cookie) · S19-13 (ID-12 images) · S19-14 (ID-13 fail-closed) · S19-17 (DS19-D health path) · S19-18 (SIGTERM deadline) | S19-05 (ID-7, DS19-F) · S19-09 (DS19-B usercontent domain) |
| 20 | VS-1 · VS-2b · VS-12b · VS-16 · VS-29b · VS-32 · VS-33 | VS-6b · VS-7b · VS-8 · VS-9 · VS-10 · VS-12c · VS-13 · VS-14 · VS-17 · VS-19 · VS-20b · VS-22 · VS-26 |
| 21 | S21-02 (CLAUDE.md content, per-app files) · S21-10 (P-5 numbers) · S21-11 (A1 identifiers) | S21-03 (IP-4 `lv1/` pack) · S21-05 (IP-5 prompt kit) · S21-06 (IP-5 skill evals 99 %) · S21-08 (IP-5 licence / SBOM / scans) · S21-09 (IP-10 docs structure) |

**DISCARD** (no stage row is DISCARD; the four come from D1 §5): D1-D1 the memory-per-byte table
and process-wide `oneAtATime` queue (after P06 parity) · D1-D2 the single-call pdf-parse OCR path
(after P09) · D1-D3 the "Files marked with a warning are sent without their text" disclaimer
(P01) · D1-D4 `pymupdf` / `pytesseract` in the sandbox image (P18, tesseract per OQ-14).

## 5. Superseded decisions — do not build

Locked lines that a later doc-sync or owner decision replaced (from each stage file's §1). The
replacement is what the buckets above measure against.

| Stage | Id | Decision | Status | Source |
|---|---|---|---|---|
| 1 | R4 | Gemini + Claude, "both via Vertex" | SUPERSEDED for Claude (arcnave.in ADR-0012 2026-10-12, repo ADR-0054); Gemini part LOCKED | [stage-01.md:12](stage-01.md#L12) |
| 1 | R12 | Claude budget ₹1,000/month | SUPERSEDED by RT-7 per-company limit (doc-sync 2026-10-03) -> DEFERRED | [stage-01.md:20](stage-01.md#L20) |
| 1 | R13 | Login: e-mail + password, and Google | SUPERSEDED in part: Stage 5 doc-sync 2026-10-09 (ADR-0010: passwordless, invite-only) -> owner question Q1 | [stage-01.md:21](stage-01.md#L21) |
| 1 | C2 | Models via Vertex global endpoint | LOCKED for Gemini; Claude path SUPERSEDED (R4) | [stage-01.md:25](stage-01.md#L25) |
| 2 | S2-2 | Auth: e-mail/password + Google, sessions, company + role | LOCKED; method SUPERSEDED in part by ADR-0010 (Q1 in stage-01.md); company/role DEFERRED | [stage-02.md:10](stage-02.md#L10) |
| 2 | A8 | 1 codebase, 2 deploys (API, worker) | SUPERSEDED by DS-1 | [stage-02.md:29](stage-02.md#L29) |
| 3 | 6.3 | Memory update (async worker) | SUPERSEDED by doc-sync 2026-10-03 (Stage 11 MEM-WRITE=1: saved in the turn) | [stage-03.md:36](stage-03.md#L36) |
| 4 | D3 | L3 pipeline 4, 6, 8 — Rate limit per user + company; idempotency key (24 h); one error formatter | LOCKED; formatter SUPERSEDED by Stage 15 doc-sync (RFC 9457) | [stage-04.md:53](stage-04.md#L53) |
| 4 | D15 | A-1 — Backend Python + FastAPI + Pydantic | SUPERSEDED by build plan B-1 (Node/Fastify) -> DIFF-STACK | [stage-04.md:65](stage-04.md#L65) |
| 6 | HP-MEM | Background memory-extraction prompt | SUPERSEDED by Stage 11 MEM-WRITE=1 (checkpoint doc-sync note in 06-policy-spec-v3.md) | [stage-06.md:52](stage-06.md#L52) |
| 7 | RT-2 | Classifier router (`gemini-3.5-flash-lite`, ~400 ms) Later | SUPERSEDED by ADR-0009 / ADR-0013 (2026-10-08, 2026-10-12): M2 = `claude-haiku-5-5`, thinking disabled, effort low, timeout 1.5 s (N-69), shadow mode, call switched OFF until the intent list exists | [stage-07.md:8](stage-07.md#L8) |
| 7 | M7 | Summarizer + title | SUPERSEDED by doc-sync 2026-10-14: registry role `job` (no M-number), row `title-claude-haiku` = `claude-haiku-5-5`, thinking disabled, effort low, 40 output tokens, no fallback; summary job is a second row (ADR-0014, N-76 / N-77) | [stage-07.md:20](stage-07.md#L20) |
| 10 | AO-1 | Research mode in MVP (draft said Later) | SUPERSEDED draft by 10b + checkpoint (2026-10-02): MVP, provisional; built by RS-1…RS-8 | [stage-10.md:12](stage-10.md#L12) |
| 10 | AO-9 | Sub-agents Later (normal chat); research mode only | SUPERSEDED draft by 10b (sub-agents = research only) | [stage-10.md:20](stage-10.md#L20) |
| 10 | AO-10 | Completion check before final answer | LOCKED; detail SUPERSEDED-INTO Stage 13 VD-6/OV11 (doc-sync 2026-10-03) | [stage-10.md:21](stage-10.md#L21) |
| 15 | ER-2d | Provider Retry-After honoured up to 10 s, longer -> straight to fallback (N-42) | LOCKED; "Vertex 429 has no Retry-After" (2026-10-04) SUPERSEDED for Claude by the first-party move (ADR-0012 doc-sync 2026-10-10) | [stage-15.md:18](stage-15.md#L18) |
| 15 | ER-2g | Classifier additions: Gemini quota-0 429 and persistent quota-0 = configuration error (alert, no retry loop); 401/403/404 = config; Claude spend limits (429 `enforced_spend_limit_reached`, 400 "API usage limits", 402) = `claude_limit`, skip all Claude rows; WIF/401 = `credentials` | LOCKED (2026-10-06, -10-11, -10-12); Vertex-Claude 429 classification of 2026-10-04 SUPERSEDED by 2026-10-12 | [stage-15.md:21](stage-15.md#L21) |
| 16 | SD-1a | No passwords; sign-in = Google or e-mail code/link (single-use, short, attempt-limited, neutral answers); invite-only | SD-1 password length/blocklist/Argon2id lines SUPERSEDED by doc-sync 2026-10-09 (ADR-0010) | [stage-16.md:12](stage-16.md#L12) |
| 16 | SD-2c | No self-signup (invite-only), per-company `hd`, one e-mail = one company | SD-2 self-signup/Gmail lines SUPERSEDED by 2026-10-09; DEFERRED (company) | [stage-16.md:23](stage-16.md#L23) |
| 16 | SD-7 | M9 safety screen: separate Gemini Flash-Lite call, structured verdict on inputs, web/file tool outputs, sampled outputs; rules block hard categories instantly; calibrated on a human-rated Tanglish/Tamil/Hindi/English set | LOCKED; model revised to `gemini-3.5-flash-lite` (provisional) by doc-sync 2026-10-08 (3.1 text SUPERSEDED) | [stage-16.md:40](stage-16.md#L40) |
| 17 | OD-12b | `X-Vertex-AI-Labels` on Claude PayGo calls | SUPERSEDED (Claude no longer on Vertex, ADR-0012 doc-sync 2026-10-10) | [stage-17.md:27](stage-17.md#L27) |
| 18 | PB-1 | Cost basis: FD-01 tokens per turn (Fast 3k/6k/0.9k, Normal 14k/6k/2.7k, Deep 50k/6k/9k), FD-02 per-turn cost, FD-03 25 turns/day (50 peak), FD-04 40/45/15 mix, FD-05 extras, FD-06 Research run, FD-07 infra phases, FD-11/13 per-user scale totals, FD-12 no self-hosting, FD-14 commitments, FD-15 seat floors, N-59, N-60; FD-09 levers L3-L6, L9-L11; CD-6 withdrawn (judge stays sync) | LOCKED planning basis; FD-02 figures SUPERSEDED by the worst-case row in the checkpoint (mixed Rs 2.93); FD-25 (2026-10-04) removes the Gemini cache discount from the plan | [stage-18.md:12](stage-18.md#L12) |
| 18 | PB-2 | College segment FD-16..FD-19, N-64 (Rs 50,000/month), CD-3 default caps | FD-16..FD-19 PARKED by FD-21 (2026-10-03: general B2B first); CD-3 caps SUPERSEDED by the pool model (N-30); business numbers, validate in pilot | [stage-18.md:13](stage-18.md#L13) |
| 18 | CD-1 | Cost model as code + price book with effective dates: Gemini 3.8 Flash list price and a 2027-01-01 row (FD-20), promo credit as a separate credit row (FD-20 b), cache storage per token-hour (FD-26), Flash-Lite (FD-31), Haiku 5.5 tiered by prompt size (FD-36), Sonnet/Opus 5.5 first-party incl. cache writes and reads (ADR-0012 sync: Sonnet read $0.10, Opus read $0.20), Vertex Ranking row (FD-27); cost per call in USD micros and INR paise; GST at invoice level; N-36 | LOCKED (the "Sonnet cache read $0.20" standing fact is Vertex-era, SUPERSEDED 2026-10-10) | [stage-18.md:21](stage-18.md#L21) |
| 18 | CD-5 / FD-25 | Caching rules: verify, never pad a prompt to reach a minimum; cached share is a parameter, default 0 for Gemini; Claude minimum 512 tokens for 5.5 models | LOCKED (2026-10-04; FD-09 "Gemini >= 6,144" SUPERSEDED by LV-128 explicit minimum 4,096, 2026-10-05) | [stage-18.md:24](stage-18.md#L24) |
| 18 | FD-26 | Gemini explicit context cache built in Phase 1: one cache per enabled tool set, base system prompt + tools; recreate on expiry/prompt change; cost plan unchanged | LOCKED (2026-10-05; CP5 "no explicit caches in MVP" SUPERSEDED) | [stage-18.md:25](stage-18.md#L25) |
| 19 | ID-3 | One VPC per project; subnets run-main /24, run-isolated /26, fetcher **/26** (SUPERSEDED /28 by 2026-10-04), PSA; PGA + private DNS; Delhi mirror; Cloud NAT only for fetcher | LOCKED; /28 line SUPERSEDED 2026-10-04 | [stage-19.md:11](stage-19.md#L11) |
| 19 | ID-6 | Cloud Run per service (gen2, concurrency/timeout explicit, ingress internal+LB, OTel sidecar); Executor 4 GiB reason gone | LOCKED; Executor memory SUPERSEDED by 2026-10-06 (ADR-0007: size by measurement) | [stage-19.md:14](stage-19.md#L14) |
| 19 | ID-8 | Global external ALB (EXTERNAL_MANAGED) + serverless NEGs; hosts app/api/share (`arcnave.in`), usercontent on **`arcnave.tech`**; **no Cloud CDN**; SSL policy MODERN + TLS 1.2; Certificate Manager; CAA; DNSSEC | LOCKED; host names SUPERSEDED by 2026-10-03 domain sync (`arcnave.in`) and 2026-10-06 (usercontent stays on `arcnave.tech`); `invoker_iam_disabled` pattern 2026-10-07 | [stage-19.md:16](stage-19.md#L16) |
| 19 | ID-12 | GitHub Actions + WIF (SHA-pinned actions), images in asia-south1 registry (no `latest`), scan gate, SBOM, Binary Authorization, Cloud Deploy canary 25/50/100; `--no-traffic` + migrate | LOCKED; protected-environment line SUPERSEDED for dev by FD-23 (2026-10-04); order decided 2026-10-08 (`upgrade` before deploy, fail = no deploy) | [stage-19.md:20](stage-19.md#L20) |
| 19 | ID-18 | Claude on Vertex `global` via PGA, no VPC-SC | SUPERSEDED by doc-sync 2026-10-10 (ADR-0012: first-party Claude API in every environment, WIF, NAT + egress firewall for tagged workloads) | [stage-19.md:26](stage-19.md#L26) |
| 19 | DS19-G | Claude path doc-syncs ADR-0002, ADR-0008, ADR-0012 | ADR-0002/0008 SUPERSEDED by ADR-0012 (2026-10-10) | [stage-19.md:33](stage-19.md#L33) |
| 20 | VS-9 | Reranker bge-reranker ONNX int8 | SUPERSEDED by doc-sync 2026-10-06 (ADR-0007: Vertex Ranking API, REST via AuthorizedSession, retry-free) | [stage-20.md:17](stage-20.md#L17) |
| 20 | VS-29 | `anthropic[vertex]` with `max_retries=0`; google-genai Vertex mode with retries off (`HttpRetryOptions(attempts=1)`, doc-sync 2026-10-04); connector | `AsyncAnthropicVertex` SUPERSEDED by 2026-10-10 (ADR-0012: `AsyncAnthropic(max_retries=0)` + WIF); rest LOCKED | [stage-20.md:37](stage-20.md#L37) |
| 20 | CVS1-CVS8 | Claude-only facts: SDK retries off + explicit deadlines (1); `count_tokens` (2); no Files API on Vertex (3); output_config.format vs citations exclusive (4); betas per header (5); pin exact model ids (6); Agent SDK not used (7); schema cache (8) | CVS1, CVS3, CVS5, CVS8 Vertex-specific: SUPERSEDED by 2026-10-10 (first-party API); others LOCKED | [stage-20.md:43](stage-20.md#L43) |
| 21 | IP-1 | Build order Phases 0-6, verification first | SUPERSEDED by build plan B-10 (owner 2026-10-14: phase order, per phase compare-build-exit); not an outcome to bucket | [stage-21.md:7](stage-21.md#L7) |
| 21 | IP-4 | LV-1 127 tests in batches B1-B7, `lv1/` folder, FAIL on a design-changing test = ADR + doc-sync before dependent code; ADRs in `docs/architecture/adr/` | LOCKED; Claude-test refinement 2026-10-06 SUPERSEDED for Claude by 2026-10-10 | [stage-21.md:10](stage-21.md#L10) |

## 6. Every owner question, in one list

The auditors asked 126 questions (many the same question from several stages). They are merged
below into 32; the right-hand column lists every raw question (FINDINGS.md row id) behind each,
so none is lost. Nothing here is decided. "Phases" = NEW-PLAN phases that wait on the answer.

| OQ | Question | Raw questions (FINDINGS) | Phases |
|---|---|---|---|
| OQ-01 | **Helper models vs B-4 "three models only".** Locked: Haiku 5.5 as router M2 (ADR-0013) and title / summary job model (ADR-0014, N-76 / N-77); Flash-Lite as retrieval planner, claim judge, completion check and M9 safety screen; Embedding 2 and the Ranking API. ADR-0055 / B-4 list three chat models. Allow helper rows (which), or rules-only / one of the three? Asked by 8 auditors. | F-0035, F-0097, F-0176, F-0269, F-0296, F-0409 (Stage 10 has no conflict), F-0475, F-0515, F-0678, F-0764, F-0797, F-0838, F-0856, F-0941, F-1010 | P10, P13, P15, P20, P25 |
| OQ-02 | **Fallback chain and breaker under Invariant 1.** Locked 7.12 / ER-14 / L4-G17-18: a labelled switch to another model; may a Gemini outage fall to Sonnet now that the per-company Claude switch is dropped? | F-0173, F-0297, F-0619, F-1052 | P11 |
| OQ-03 | **Sign-in.** ADR-0010 / SD-1 revised (passwordless, invite-only, no password tables) vs ADR-0056 (password + Google + self-signup). Decides `password_hash`, e-mail codes, mailer, error codes. | F-0034, F-0068, F-0176, F-0218, F-0623, F-0676, F-0837, F-0856 | P25 |
| OQ-04 | **Claude credential.** ADR-0054 (API key in env for the prototype) vs ADR-0012 (WIF, no key anywhere). Keep as deferred? | F-0677, F-0796, F-0839, F-0856 | — (deferred unless changed) |
| OQ-05 | **System prompt.** Locked v3 per-model renderings (CXD-3b) vs the repo prompt (planned "0057 repo prompt kept"; repo rule "Claude is the reference"). And which tool vocabulary the renderings describe. | F-0272, F-0273, F-1007, F-1008 | P07, P17 |
| OQ-06 | **Tool surface.** Keep by ADR or discard the tools outside TD-1c (13 display cards, `show_widget` / `read_me`, `ask_user_input_v0`, `image_search`, past-chat tools, `bash_tool` family); memory: six file tools vs three line-op tools. | F-0335, F-0441 | P07, P17, P23 |
| OQ-07 | **Language paragraph** (Tanglish / Latin script, ADR-0043 / 0049) vs CXD-1, which removed the language section. | F-0271, F-1011 | P07 |
| OQ-08 | **Token counts.** Main-session reading (AUDIT-LOG S-13): Invariant 3 bans an *estimator*; a provider count call is provider metadata, so file / budget / cap counting via the count APIs fits the invariant — confirm. Separately, N-75 (local estimate first) and OD-13 (`usage_source='estimated'`) do conflict: amend the invariant, or use characters / provider-reported partial usage? | F-0270, F-0442, F-0476, F-0622, F-0718, F-0931 | P12, P13, P20, P22, P23 |
| OQ-09 | **Long chats.** Planned "0058 compaction kept" vs Stage 6 summary job (60 % trigger, last 6 turns); and reinstate ADR-0023 for Gemini (stop clearing tool results). | F-1009, F-1013 | P02, P13 |
| OQ-10 | **Retrieval.** Stage 12 hybrid (pgvector + Embedding 2 + RRF + Ranking API) now and amend Invariant 4, or BM25 until the P2-D eval (ADR-0059)? Whole-file threshold: locked 30 k tokens vs repo 200,000 chars. Visual page vectors. | F-0066, F-0176, F-0219, F-0372, F-0474, F-0477 | P12, P20 |
| OQ-11 | **Build-plan Phase 5 deferrals vs ADR-0061.** ClamAV, Document AI OCR, the file queue and embeddings were deferred by the build plan (line 72), not by ADR-0053 #7. Is their outcome (scan states, OCR quality) in this pass? May ClamAV ship with a no-op dev scanner behind a flag? | F-0371, F-0933, F-0934 | P09, P19 |
| OQ-12 | **File types.** ZIP via a Node library or the sandbox; legacy `.xls` (reject only true OLE2, accept HTML / XML table exports?); keep or trim the extra types (odt, rtf, epub, code, video); failed-file rule (AS-D6 "processing blocks Send" vs FG3 "failed must be removed first"). | F-0036, F-0037, F-0038, F-0097, F-0373, F-0938, F-0939 | P01, P06, P14 |
| OQ-13 | **Office files on sandbox turns.** ADR-0045 (pointer only) vs Stage 9 CF4 / D9-8 (inline normalised text ≤ 30 k tokens). Which is the product path for reading and for Office creation (TypeScript renderers or Python)? | F-0932, F-1056 | P12, P21 |
| OQ-14 | **Sandbox.** Warm shared service (ADR-0010 / 0015) vs fresh isolated run per call (TD-4b, ID-7); `run_code` 300 s vs 60 / 120 s; keep or remove tesseract; confirm pymupdf removal. | F-0337, F-0338, F-0374, F-0621, F-0794, F-0856, F-0937, F-1053 | P09, P18 |
| OQ-15 | **Repo numbers that differ from the register.** Turn deadline 59 min vs 10; tool rounds 16 vs 1–2 / 5 / 15; max output 64 k vs 8 k / 16 k / 32 k; message 100 k vs 32 k chars; session 14 d vs 24 h idle / 28 d; image 10 vs 20 MB; Claude request 32 vs 30 MB; Gemini inline image 20 vs 7 MB; instruction cap 20,000 vs 5,000 chars. All 23 DIFFs: [numbers-diff.md](numbers-diff.md) §2. | F-0098, F-0175, F-0176, F-0299, F-0408, F-0620, F-0680, F-0853, F-0940 | P06, P07, P10, P11, P18, P21, P22 |
| OQ-16 | **First-token and stall timers.** ER-4a/b lock 20 / 45 / 90 s and 30 s; ADR-0024 / ADR-0054 keep them off. | F-0618 | P11 |
| OQ-17 | **Error body.** RFC 9457 problem+json (Stage 15 doc-sync) vs the repo `{error:{…}}` (planned "typed errors kept" ADR). G4 option A keeps the catalogue and changes only the body. | F-0174 | P11 |
| OQ-18 | **API shape.** Rename to the L3 catalogue / `turns` resource or keep `/chats/*`; move search text out of URL query strings now (DF-2) or at Phase 5. | F-0172, F-0559, F-0720 | P22, P26 |
| OQ-19 | **Hosting and edge.** Cloudflare (ADR-0060 never written) vs Google-only Mumbai with no CDN; same-site API instead of `SameSite=None`; user-content domain `arcnave.tech`. | F-0558, F-0679, F-0795, F-0839, F-0856, F-1055 | P27 |
| OQ-20 | **Routing UI.** Keep the user `routingPreference` setting and the sticky model for Auto, or remove them; Auto → Opus for attachments now or with the profile router. | F-0298, F-0767 | P10 |
| OQ-21 | **Research mode.** Stage 10 locks it as MVP (provisional); build plan P3-E says Later. | F-0407 | P28 |
| OQ-22 | **Memory.** Sensitive memory off until each user opts in (MEM-5) vs the reference rule in `memory/policy.ts:61`; keep project memory, past-chat search and import (built, locked Later)? | F-0440, F-0443 | P23 |
| OQ-23 | **Rendering choices.** Charts ECharts JSON vs Recharts; markdown-it vs react-markdown; math delimiter `\( \)` vs `$$`; knowledge-cutoff line; thought summaries shown now (RT-4 condition met?). | F-0300, F-0516, F-0556, F-0557, F-1012, F-1015 | P07, P10, P24, P26 |
| OQ-24 | **Sharing.** Full artifact content in public links vs name + type; store grounded snippets in normal chat or links only. | F-0215, F-0410 | P25 |
| OQ-25 | **Data model now.** Nullable `company_id` on every table built from now on (three auditors: avoids a rewrite at tenancy); split message text from metadata now; repo-only tables (goals, saved_sources, styles, turn_logs …); `model_call_blocks`; container injection before tenancy. | F-0216, F-0217, F-0935, F-1060 | P06, P08, P12, P13, P15, P20, P21, P22 |
| OQ-26 | **Database version.** PostgreSQL 16 (prod, CI) vs locked 18 (`pg_textsearch` needs 17+). | F-0798, F-1058 | P20 |
| OQ-27 | **Cost.** Money as decimals now; a rupee ceiling beside per-user token budgets; one cache breakpoint (N-74) vs the repo's two. | F-0765, F-0766, F-0768 | P07, P22 |
| OQ-28 | **Observability now.** Latency metric for T-1 / T-2 now or Phase 5; confirm `turn_logs` keeps full content until Phase 5; keep retracted text (hash + encrypted) or drop it. | F-0096, F-0517, F-0719 | P15, P22 |
| OQ-29 | **New dependencies.** sharp + HEIC decoder, `@google-cloud/documentai`, `pdfjs-dist`, ffmpeg, ClamAV client, CSRF / helmet helpers, OpenAPI type generator, SSE helper; ExcelJS vs VS-16 "no ExcelJS". | F-0681, F-0836, F-0936, F-1057 | P09, P16, P19, P21, P25 |
| OQ-30 | **Search provider.** SerpAPI / Google CSE and native search in the main call vs the grounding-only sub-call (TD-2b). | F-0336 | P17 |
| OQ-31 | **Process and docs.** Copy the 68-case JSON into the repo; skills provenance and notices (TD-11); a CLAUDE.md exception for dev scripts that call SDKs; identifiers in `docs/` outside `docs/ops`; "sweeper + flush + drain" as the interim before Cloud Tasks; hardened in-process fetch until the TD-3 fetch service; where the 68-case kit lives (answered: `D:\Architecture\…\06-eval-cases-v1.json`). | F-0067, F-0274, F-0339, F-0854, F-0855, F-1054, F-1059 | P03, P08, P17, P24 |
| OQ-32 | **Inputs the audit lacked.** Message ids of the "very poor" turns and the model shown; live `ENABLE_*`, `TOOL_MAX_ROUNDS`, `PRICING_TABLE`; may an auditor read the committed `.env.example` (blocked by a `.env*` read rule for this audit)? | F-1014 | P03 |

Not questions but recorded with them: F-0799, F-0840, F-0857 ("could not check" lines — see §7)
and F-1016 (owner-deferred items D2 touched — see [DEFERRED.md](DEFERRED.md)).

## 7. Limits of this audit

- Static reading only: nothing was run, no provider was called, no live system was read. Claims
  marked "prove with a test" (D3 A-04, A-08, A-09) and every D2 hypothesis stay unproven until
  their confirm step runs.
- `.env.example` was not read by anyone; live flag values, the Gemini model id and `PRICING_TABLE`
  are unverified (X-1 in FINDINGS).
- `backend/node_modules` is not installed: what officeParser / pdf-parse emit for PPTX notes and
  DOCX comments, and SDK default retry behaviour, are unverified.
- Statements "from the model's knowledge" (D1: `xlsx@0.18.5` CVEs; G5: pymupdf licence) are leads.
- Not audited line by line: Stage 12 RE ids not named in 12c, 12a / 11-memory MG details,
  04a vendor research, 05 DB provider comparison, Stage 4 L4-G50…G63 (text absent from the mirror),
  `docs/openapi.json` vs route schemas, live regions, the Cloud Build trigger, LV-1 outcomes.
- G1's "Port source: none" lines in stage-01 … 05 are unreliable (AUDIT-LOG C-5); NEW-PLAN names
  the port package where one exists.

## 8. Files

| File | What |
|---|---|
| [SUMMARY.md](SUMMARY.md) | this file |
| [NEW-PLAN.md](NEW-PLAN.md) | proposed phases P01–P29 + appendices mapping every work row |
| [FINDINGS.md](FINDINGS.md) | master register, 1,484 rows, with the main-session verdicts and a coverage check |
| [AUDIT-LOG.md](AUDIT-LOG.md) | start-to-end log: setup, launches, every auditor return verbatim, spot-checks, corrections |
| [stage-01.md](stage-01.md) … [stage-21.md](stage-21.md) | per-stage audits (decisions, repo evidence, buckets, options, questions, KEEP spot-check) |
| [D1-file-handling.md](D1-file-handling.md), [D2-ai-output.md](D2-ai-output.md), [D3-architecture.md](D3-architecture.md) | deep-dives |
| [numbers-diff.md](numbers-diff.md) | all 77 N-ids vs repo values |
| [EVIDENCE.md](EVIDENCE.md) | evidence pack (names and shapes only) |
| [DEFERRED.md](DEFERRED.md) | owner-deferred items and the raise-now list |
| `_parts/` | the auditors' raw evidence and deferred files that EVIDENCE.md and DEFERRED.md were assembled from |
