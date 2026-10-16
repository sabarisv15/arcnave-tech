# tech-audit.A — every finding (master register)

Generated mechanically from the audit files by the main session (Opus 5.5) so that no finding is
dropped by hand: every bucket row (KEEP included, so nothing is hidden), every gap, flaw,
hypothesis, N-xx row, literal without an N-id, deferred item, content-carrying log line,
licence flag, owner question and "could not check" item. Each row links its source line;
options, picks and evidence detail stay in the source file. Corrections and spot-check
verdicts are in [AUDIT-LOG.md](AUDIT-LOG.md) §4–§5 and in the "Main-session verdicts" table below.

**Totals:** 1484 rows. By kind: bucket 669 · question 126 · keep-check 59 · number 123 · gap 46 · test-gap 26 · finding 45 · hypothesis 8 · flaw 27 · deferred 93 · literal 23 · deferred-note 2 · log-content 29 · licence 5 · trace 197 · coverage-gap 6.

Kinds: `bucket` = a locked decision's bucket (KEEP / REWRITE / NEW-BUILD / DISCARD / DIFF-STACK / DIFF-INFRA / DEFERRED / n/a) · `gap` (D1) · `finding` (D2) · `hypothesis` (D2, unconfirmed by definition) · `flaw` (D3) · `number` · `literal` · `deferred` · `log-content` (C = can carry content, I = identifier) · `licence` · `test-gap` · `question` · `coverage-gap`.

## Main-session verdicts (read these with the rows below)

The rows below are the auditors' words. Where the main session checked a claim in code, or found
an auditor wrong, the result is here; details in [AUDIT-LOG.md](AUDIT-LOG.md) §4–§5.

| Ref | Applies to rows citing | Verdict |
|---|---|---|
| S-01 | `backend/Dockerfile:69` (G5 stage-19, D3 A-10) | CONFIRMED |
| S-02 | `providers/gemini.ts:349` (G5) | CONFIRMED nothing turns SDK retries off; locked VS-29 says `HttpRetryOptions(attempts=1)` |
| S-03 | `providers/gemini.ts:382-408` (D2 X-1 / H4) | CONFIRMED, contradicts ADR-0023 Decision 1 |
| S-04 | `providers/routing.ts:61-76` (D2 H3, G2 #2, G4) | CONFIRMED; "almost everything to Gemini" holds for plain text turns, attachments/research go to Opus |
| S-05 | `services/retrieval.ts:415-418` (D1 #12a, G3 #1) | CONFIRMED, P0 for Tamil/Hindi |
| S-06 | `services/systemPrompt.ts:66` (D2 H2) | CONFIRMED |
| S-07 | `services/webFetch.ts:19-37,82,89-92` (D3 A-08, G2, G4) | CONFIRMED |
| S-08 | `app.ts:93-106`, `plugins/context.ts:40,55` (D3 A-09) | CONFIRMED in code; runtime effect still "prove with a test" |
| S-09 | `services/generation.ts:1376-1392` (G4 #1) | CONFIRMED in code; test owed |
| S-10 | `providers/gemini.ts:233-238` (G4 #2) | CONFIRMED |
| S-11 | `config/numbers.ts:38-39` (G3, G4, G5) | CONFIRMED |
| S-12 | `routes/models.ts:39,166` (G1 #2) | CONFIRMED |
| S-13 | every row that says token counts need Invariant 3 lifted (D1 #10 / Q1, G3 caps, G4 Q5) | RE-FRAMED: Invariant 3 bans an *estimator*; a provider count call is provider metadata. Only a tokenizer estimate (OD-13 `estimated`, Stage 6 N-75/CG13) truly conflicts |
| K-06 | stage-20 CVS6 KEEP | PARTIAL — Gemini model id lives in the unread `.env.example` |
| K-12 | stage-01 DS-D KEEP | DOWNGRADED → owner question (ADR-0010 invite-only vs ADR-0056 self-signup) |
| K-13 | stage-04 E2 KEEP | DOWNGRADED → KEEP on one instance only (D3 A-01/A-03) |
| K-14 | stage-07 RT-9 KEEP | DOWNGRADED → partial; "Opus manual only" broken by Auto |
| K-15 | stage-07 NO-SILENT-SUB KEEP (auditor flagged a downgrade risk) | PARTIAL: an unavailable requested model falls back to Auto with only a log line (`generation.ts:1300-1303`); the UI labels the answer with the model that answered (`workspace.tsx:492`, `App.tsx:1251`), so nothing is presented as the model asked for, but no reason or notice is shown (Stage 7 7.12 labelled switch) |
| C-1 | any text saying "87 cases" | WRONG (main session): 68 cases + 19 nested document ids |
| C-2 | `stage-14.md:87` | cross-reference corrected in place |
| C-3 | `_parts/evidence-g1.md:99` | 56 → 42 ApiError codes, corrected in place |
| C-4 | `stage-02.md` / `stage-04.md` count lines | garbled; annotated in place; SUMMARY uses mechanical row counts |
| C-5 | stage-01 … stage-05 rows that say "Port source: none" | UNRELIABLE: G1 thought `D:\arcnave.in` held only ADRs; it holds `backend/packages/{chat,context,db,gateway,ledger,memory,retrieval,safety,telemetry,tools,validation}` |
| X-1 | every "could not check `.env.example`" row | Not bypassed: a read permission rule on `.env*` blocked all auditors. Owner to decide whether the audit may read the committed template |
| X-2 | rows marked "from my knowledge" (D1 `xlsx@0.18.5` CVEs; G5 pymupdf AGPL licence) | UNVERIFIED in this audit; treat as leads |
| X-3 | every `hypothesis` row (D2 H1–H8) | Unproven by definition: each has a confirm step (turn-log read or offline test) |

## Stage 1 (39)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0001 | [stage-01.md:99](stage-01.md#L99) | bucket | R1, R2, R12, R14, C1, A1, A2, A4, DS-B | DEFERRED | company / tenancy / scale infra — see deferred-g1.md |
| F-0002 | [stage-01.md:100](stage-01.md#L100) | bucket | R3 | KEEP | text, file and model picker met (Composer.tsx:388-437, 808) |
| F-0003 | [stage-01.md:101](stage-01.md#L101) | bucket | R3m, A5 | NEW-BUILD | server STT (Gemini, 2 min, audio deleted) beside the browser Web Speech path |
| F-0004 | [stage-01.md:102](stage-01.md#L102) | bucket | R4 | KEEP | Gemini via Vertex and Claude via first-party API both implemented (owner ADR-0012/0054) |
| F-0005 | [stage-01.md:103](stage-01.md#L103) | bucket | R5 | KEEP | the six non-ZIP types accepted (ZIP counted at FT-4) |
| F-0006 | [stage-01.md:104](stage-01.md#L104) | bucket | R6, A3 | KEEP | streaming reply; first-word latency unmeasured (note, not a gap) |
| F-0007 | [stage-01.md:105](stage-01.md#L105) | bucket | R7 | KEEP | Tamil fonts and Tanglish rule present |
| F-0008 | [stage-01.md:106](stage-01.md#L106) | bucket | R8, A6, DS-C | KEEP | Markdown memory per user, default ON |
| F-0009 | [stage-01.md:107](stage-01.md#L107) | bucket | R9 | n/a | process rule |
| F-0010 | [stage-01.md:108](stage-01.md#L108) | bucket | R10 | KEEP | only Claude is off-GCP, by owner decision |
| F-0011 | [stage-01.md:109](stage-01.md#L109) | bucket | R11, C3 | DIFF-INFRA | bucket region and `SANDBOX_LOCATION=us-central1` are deployment settings (build plan P2-C) |
| F-0012 | [stage-01.md:110](stage-01.md#L110) | bucket | R13 | KEEP | Argon2id + Google sign-in present; passwordless conflict is Q1 |
| F-0013 | [stage-01.md:111](stage-01.md#L111) | bucket | R15 | KEEP (web) | SPA present |
| F-0014 | [stage-01.md:112](stage-01.md#L112) | bucket | R15a | NEW-BUILD | Android app absent (build plan Phase 6) |
| F-0015 | [stage-01.md:113](stage-01.md#L113) | bucket | C2 | KEEP | `VERTEX_LOCATION` default global |
| F-0016 | [stage-01.md:114](stage-01.md#L114) | bucket | O3 | KEEP | closed |
| F-0017 | [stage-01.md:115](stage-01.md#L115) | bucket | DS-D | KEEP | self-signup + no billing; but Q1 |
| F-0018 | [stage-01.md:116](stage-01.md#L116) | bucket | DS-E, DS-F, F1–F8, V2–V4 | n/a | information |
| F-0019 | [stage-01.md:117](stage-01.md#L117) | bucket | FT-1 | KEEP | CSV/TXT/MD accepted |
| F-0020 | [stage-01.md:118](stage-01.md#L118) | bucket | FT-2 | REWRITE | macro files hit the generic refusal; no "save as" message |
| F-0021 | [stage-01.md:119](stage-01.md#L119) | bucket | FT-3 | REWRITE | `.xls` accepted and read; `.doc/.ppt` get the generic refusal |
| F-0022 | [stage-01.md:120](stage-01.md#L120) | bucket | FT-4 | NEW-BUILD | no ZIP path at all |
| F-0023 | [stage-01.md:121](stage-01.md#L121) | bucket | FT-5 | REWRITE | image cap 10 MB vs 20 MB; HEIC refused |
| F-0024 | [stage-01.md:122](stage-01.md#L122) | bucket | FT-6 | REWRITE | m4a/webm audio missing, no 3 h check |
| F-0025 | [stage-01.md:123](stage-01.md#L123) | bucket | FT-7 | REWRITE | no per-type caps (docs 100 MB, XLSX 50 MB) |
| F-0026 | [stage-01.md:124](stage-01.md#L124) | bucket | FT-8 | KEEP | 10 and 20 enforced |
| F-0027 | [stage-01.md:125](stage-01.md#L125) | bucket | FT-9 | KEEP | send blocked while uploading; server 409 |
| F-0028 | [stage-01.md:126](stage-01.md#L126) | bucket | FT-10 | REWRITE | no Retry; failed files do not block Send |
| F-0029 | [stage-01.md:127](stage-01.md#L127) | bucket | FT-11 | REWRITE | encrypted files stored as `unsupported`, not refused with a reason at upload |
| F-0030 | [stage-01.md:128](stage-01.md#L128) | bucket | FT-12 | REWRITE | no signature check; extra types beyond the locked list |
| F-0031 | [stage-01.md:129](stage-01.md#L129) | bucket | FT-13 | KEEP | resumable direct upload with size re-check |
| F-0032 | [stage-01.md:130](stage-01.md#L130) | bucket | FT-14 | KEEP | 24 h sweeper |
| F-0033 | [stage-01.md:131](stage-01.md#L131) | bucket | FT-15 | NEW-BUILD | no upload quota |
| F-0034 | [stage-01.md:188](stage-01.md#L188) | question |  |  | Q1. Sign-in method: arcnave.in ADR-0010 (owner 2026-10-09; Stage 5 05-1 doc-sync) = passwordless, invite-only, no password tables; build plan Phase 1 + repo ADR-0056 (owner 2026-10-14) = keep e-mail/password and Google, self-signup. Which one is the target? (Stage 1 R13/DS-D read the old way.) Not resolved here. |
| F-0035 | [stage-01.md:189](stage-01.md#L189) | question |  |  | Q2. Haiku 5.5 is named by N-69 (router M2) and N-76/N-77 (title/summary jobs) but build plan B-4 / ADR-0055 says three models only. Do router and jobs use Haiku, or Gemini/Flash-Lite, or rules only? (Affects Stage 3 steps 2.1, 6.4, 6.5.) |
| F-0036 | [stage-01.md:190](stage-01.md#L190) | question |  |  | Q3. AS-D6 says Send is blocked only by files still processing; 05-2 FG3 says a failed file must be removed first. Which rule? |
| F-0037 | [stage-01.md:191](stage-01.md#L191) | question |  |  | Q4. ZIP expansion: allow a new Node library (package register) or do it in the Python sandbox? |
| F-0038 | [stage-01.md:192](stage-01.md#L192) | question |  |  | Q5. The repo accepts odt/rtf/epub/json/html/css/xml/js/ts/py/sql/video in addition to the locked list. Keep them (record as an extension) or trim to the locked list? |
| F-0039 | [stage-01.md:195](stage-01.md#L195) | keep-check | prose |  | 20 KEEP rows; 3 re-opened in code this session (≥10 %): FT-8 (`chats.ts:546`, `chats.ts:1114`, `processUpload.ts:30` confirmed), FT-9 (`Composer.tsx:445`, `:808` confirmed; `chats.ts:1103-1107` confirmed), R13 (`auth.ts:54-56` confirmed). Downgrades: none. Note: R6/A3 stayed KEEP, but the first-word target is untested (no measurement in repo). |

## Stage 2 (30)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0040 | [stage-02.md:68](stage-02.md#L68) | bucket | S2-1 | KEEP | web present; mobile counted at stage-01 R15a |
| F-0041 | [stage-02.md:69](stage-02.md#L69) | bucket | S2-2 | KEEP | own auth present; method question is Q1; company/role deferred |
| F-0042 | [stage-02.md:70](stage-02.md#L70) | bucket | S2-3 | REWRITE | `/models` and `/models/refresh` are public; `/models?probe=true` spends a provider call per alias for anyone |
| F-0043 | [stage-02.md:71](stage-02.md#L71) | bucket | S2-4 | REWRITE | route files hold turn-start logic; move to a turn service (low priority, behaviour-neutral) |
| F-0044 | [stage-02.md:72](stage-02.md#L72) | bucket | S2-4a | DEFERRED | company/role/kill-switch parts; per-user budget exists |
| F-0045 | [stage-02.md:73](stage-02.md#L73) | bucket | S2-4b, 4c, 4d, 4e | n/a (audited by Stage 6, 7, 8, 13 groups) | contract exists; depth not re-audited here |
| F-0046 | [stage-02.md:74](stage-02.md#L74) | bucket | S2-5 | KEEP | port + two adapters + registry; fallback chain is counted in stage-04 (L4-G17/G18, L5-G10) |
| F-0047 | [stage-02.md:75](stage-02.md#L75) | bucket | S2-6 | DEFERRED | async queue = Cloud Tasks (build plan: deferred to Phase 5); the parser isolation is DS-3b |
| F-0048 | [stage-02.md:76](stage-02.md#L76) | bucket | S2-7 | NEW-BUILD | counted at stage-01 R3m |
| F-0049 | [stage-02.md:77](stage-02.md#L77) | bucket | S2-8 | KEEP | memory service present (depth: Stage 11 group) |
| F-0050 | [stage-02.md:78](stage-02.md#L78) | bucket | S2-9 | KEEP | BM25 retrieval present (vector part: question Q-V below) |
| F-0051 | [stage-02.md:79](stage-02.md#L79) | bucket | S2-10 | KEEP | tool registry present (depth: Stage 8 group) |
| F-0052 | [stage-02.md:80](stage-02.md#L80) | bucket | S2-11 | DIFF-INFRA | Postgres 16 vs 17/18 and bucket region are infra; vector index see Q-V |
| F-0053 | [stage-02.md:81](stage-02.md#L81) | bucket | S2-12 | KEEP | usage + hard budget stop present; admin panel DEFERRED (company) |
| F-0054 | [stage-02.md:82](stage-02.md#L82) | bucket | RL1 | KEEP | adapters behind one port |
| F-0055 | [stage-02.md:83](stage-02.md#L83) | bucket | RL2 | REWRITE | same change as S2-4 (counted there) |
| F-0056 | [stage-02.md:84](stage-02.md#L84) | bucket | RL3 | DEFERRED | Cloud Tasks |
| F-0057 | [stage-02.md:85](stage-02.md#L85) | bucket | RL4 | DEFERRED | company |
| F-0058 | [stage-02.md:86](stage-02.md#L86) | bucket | RL5 | DIFF-INFRA | region settings |
| F-0059 | [stage-02.md:87](stage-02.md#L87) | bucket | RL6 | KEEP | per-user budget guard before every call; company part DEFERRED |
| F-0060 | [stage-02.md:88](stage-02.md#L88) | bucket | RL7 | KEEP | stream first, finalise after |
| F-0061 | [stage-02.md:89](stage-02.md#L89) | bucket | A7 | KEEP | API-first REST; token auth for native counted at stage-01 R15a |
| F-0062 | [stage-02.md:90](stage-02.md#L90) | bucket | A8, DS-1, DS-2, DS-4 | DEFERRED | deploy layout, Redis, Cloud Tasks, company limits |
| F-0063 | [stage-02.md:91](stage-02.md#L91) | bucket | DS-3a | DIFF-INFRA | warm service vs per-run job is Cloud Run layout |
| F-0064 | [stage-02.md:92](stage-02.md#L92) | bucket | DS-3b | NEW-BUILD | build the parser sandbox path beside the in-process parsers, then switch |
| F-0065 | [stage-02.md:93](stage-02.md#L93) | bucket | GB-1 | REWRITE | four dev scripts import `@google/genai` directly |
| F-0066 | [stage-02.md:128](stage-02.md#L128) | question |  |  | Q-V. Stage 2 S2-11 / Stage 4 L7 DB-2 lock a vector index in Postgres; build plan ADR-0059 ("BM25 now, pgvector at Phase 2 exit if the eval shows the gap") and repo Invariant 4 forbid an embedding column. Which wins for the schema built now? (Owner-decision vs stage decision; not resolved here.) |
| F-0067 | [stage-02.md:129](stage-02.md#L129) | question |  |  | Q-Gate. GB-1 text: should the repo CLAUDE.md name an exception for dev measuring scripts (like arcnave.in `apps/lvrunner`) or must they go through `providers/`? |
| F-0068 | [stage-02.md:130](stage-02.md#L130) | question |  |  | Q1 (stage-01.md). Sign-in method. |
| F-0069 | [stage-02.md:133](stage-02.md#L133) | keep-check | prose |  | 11 KEEP ids; 3 re-opened (>=10 %): S2-5 (`providers/types.ts:378` Provider interface, `providers/gemini.ts:8`, `providers/anthropic.ts:8` confirmed), RL7 (`generation.ts:1169-1182` finalise and `chats.ts:1145-1156` generating row confirmed), RL6 (`generation.ts:694` confirmed). Downgrades: none. S2-12 stays KEEP only for usage and budget stop; the admin panel is in the deferred file. |

## Stage 3 (30)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0070 | [stage-03.md:99](stage-03.md#L99) | bucket | 0.1, 0.2, 0.4 | KEEP | model list, immediate resumable upload, picker with Auto |
| F-0071 | [stage-03.md:100](stage-03.md#L100) | bucket | 0.3 | n/a | counted at stage-01 R3m |
| F-0072 | [stage-03.md:101](stage-03.md#L101) | bucket | 0.5, 1.1 | n/a | counted at 1.4 |
| F-0073 | [stage-03.md:102](stage-03.md#L102) | bucket | 1.2 | KEEP | login verified before every guarded route; company/role deferred; `/models` gap counted in stage-02 S2-3 |
| F-0074 | [stage-03.md:103](stage-03.md#L103) | bucket | 1.3 | REWRITE | N-02 32k limit, 413 code, unknown/foreign file ids must be an error |
| F-0075 | [stage-03.md:104](stage-03.md#L104) | bucket | 1.4 | NEW-BUILD | request-id / Idempotency-Key replay is built as helpers but wired nowhere |
| F-0076 | [stage-03.md:105](stage-03.md#L105) | bucket | 1.5 | REWRITE | per-user key is probably never set (hook order) |
| F-0077 | [stage-03.md:106](stage-03.md#L106) | bucket | 1.6 | REWRITE | budget/policy check must come before saving the user message and be an HTTP refusal |
| F-0078 | [stage-03.md:107](stage-03.md#L107) | bucket | 1.7 | REWRITE | message state `received` + trace id; folded into the turns table (stage-05 T-turns) |
| F-0079 | [stage-03.md:108](stage-03.md#L108) | bucket | 1.8 | REWRITE | emit a typed `ack` frame before any slow work (also covers T-1) |
| F-0080 | [stage-03.md:109](stage-03.md#L109) | bucket | 2.1, 2.2, 2.3 | n/a | audited by Stage 7 / 16 groups; fallback counted at stage-04 |
| F-0081 | [stage-03.md:110](stage-03.md#L110) | bucket | 3.1–3.7 | n/a | Stage 6 group |
| F-0082 | [stage-03.md:111](stage-03.md#L111) | bucket | 4.1, 4.2, 4.3, 4.4, 4.5 | KEEP | stream, bounded retries, tool-loop limit, finish reason carried (numbers differ, see N-xx; Stage 15/7 groups) |
| F-0083 | [stage-03.md:112](stage-03.md#L112) | bucket | 5.1, 5.2 | n/a | Stage 13 group |
| F-0084 | [stage-03.md:113](stage-03.md#L113) | bucket | 5.3 | KEEP | `done` frame carries usage and finish reason |
| F-0085 | [stage-03.md:114](stage-03.md#L114) | bucket | 6.1 | REWRITE | no final transaction around message + sources + usage |
| F-0086 | [stage-03.md:115](stage-03.md#L115) | bucket | 6.2, 6.3, 6.5, 6.6 | KEEP | counters, in-turn memory, compaction, timings |
| F-0087 | [stage-03.md:116](stage-03.md#L116) | bucket | 6.4 | NEW-BUILD | title is the first 80 characters of the prompt |
| F-0088 | [stage-03.md:117](stage-03.md#L117) | bucket | 7.1 | KEEP | rendering present (Stage 14 group) |
| F-0089 | [stage-03.md:118](stage-03.md#L118) | bucket | 7.2 | KEEP | stop keeps the partial answer as `stopped` |
| F-0090 | [stage-03.md:119](stage-03.md#L119) | bucket | 7.3 | REWRITE | answer survives a closed tab but not a crashed or redeployed instance |
| F-0091 | [stage-03.md:120](stage-03.md#L120) | bucket | D1, D2, D3, D4 | KEEP | met (D3 single-instance; multi-instance = DEFERRED infra) |
| F-0092 | [stage-03.md:121](stage-03.md#L121) | bucket | T-1 | n/a | counted at 1.8 |
| F-0093 | [stage-03.md:122](stage-03.md#L122) | bucket | T-2 | n/a | needs a measurement task (see Q below) |
| F-0094 | [stage-03.md:123](stage-03.md#L123) | bucket | T-3 | KEEP | file chip waits for ready |
| F-0095 | [stage-03.md:124](stage-03.md#L124) | bucket | DS-1, DS-2, DS-3 | DEFERRED | Cloud Tasks, Redis, cancel flag, company limit |
| F-0096 | [stage-03.md:164](stage-03.md#L164) | question |  |  | Q-T1. T-1/T-2 (ack < 0.5 s, first words 1–3 s) have no measurement in the repo. Add a latency metric in this phase, or at the Phase 5 observability task? |
| F-0097 | [stage-03.md:165](stage-03.md#L165) | question |  |  | Q2, Q3 (stage-01.md): router/title model (B-4 vs Haiku); failed-file Send rule. |
| F-0098 | [stage-03.md:166](stage-03.md#L166) | question |  |  | Q-T2. Turn deadline: repo keeps 59 min (ADR-0054 "deliberate"), register N-43 says 10 min. The owner rule withdraws "repo wins"; which number is the target while there is no executor? |
| F-0099 | [stage-03.md:169](stage-03.md#L169) | keep-check | prose |  | 21 KEEP ids; 3 re-opened (>=10 %): 7.2 (`chats.ts:696-712`, `generation.ts:1047-1048,1175` confirmed), 0.2 (`storage.ts:282-300` resumable session, `Composer.tsx:388-437` confirmed), D1 (`Composer.tsx:445,808` and `chats.ts:1103-1107` confirmed). Downgrades: none. |

## Stage 4 (78)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0100 | [stage-04.md:209](stage-04.md#L209) | bucket | A1 | n/a | same change as stage-02 S2-4 (counted there) |
| F-0101 | [stage-04.md:210](stage-04.md#L210) | bucket | A2, A4 | KEEP | provider port + adapters; one event format |
| F-0102 | [stage-04.md:211](stage-04.md#L211) | bucket | A3, A5, A6 | DEFERRED | company / Redis / deploy layout |
| F-0103 | [stage-04.md:212](stage-04.md#L212) | bucket | B1, B3, B4, B5, B8, B9, B10 | KEEP | client modules present |
| F-0104 | [stage-04.md:213](stage-04.md#L213) | bucket | B2 | REWRITE | client is hand-written; generate types from `docs/openapi.json` |
| F-0105 | [stage-04.md:214](stage-04.md#L214) | bucket | B6, B7 | n/a | counted at stage-01 R3m / Stage 14 group |
| F-0106 | [stage-04.md:215](stage-04.md#L215) | bucket | B11 | NEW-BUILD | no app-version header or force-update screen |
| F-0107 | [stage-04.md:216](stage-04.md#L216) | bucket | B12 | DEFERRED | client telemetry endpoint with Stage 17 (OTel / NO_CONTENT) |
| F-0108 | [stage-04.md:217](stage-04.md#L217) | bucket | B13, B17 | DEFERRED | admin panel, per-company Claude switch |
| F-0109 | [stage-04.md:218](stage-04.md#L218) | bucket | B14, C5 | DIFF-STACK | Vite SPA instead of Next.js |
| F-0110 | [stage-04.md:219](stage-04.md#L219) | bucket | B15 | KEEP | English UI |
| F-0111 | [stage-04.md:220](stage-04.md#L220) | bucket | B16, B23 | n/a | later / not needed / Stage 8 |
| F-0112 | [stage-04.md:221](stage-04.md#L221) | bucket | B18 | n/a | counted in stage-05 F4 (EG) |
| F-0113 | [stage-04.md:222](stage-04.md#L222) | bucket | B19 | KEEP | share link present (company-only default DEFERRED) |
| F-0114 | [stage-04.md:223](stage-04.md#L223) | bucket | B20 | REWRITE | search covers titles only |
| F-0115 | [stage-04.md:224](stage-04.md#L224) | bucket | B21 | n/a | counted in stage-05 (feedback table) |
| F-0116 | [stage-04.md:225](stage-04.md#L225) | bucket | B22 | KEEP | copy, drag-drop, paste, limit messages |
| F-0117 | [stage-04.md:226](stage-04.md#L226) | bucket | B24 | REWRITE | password-less (Google) accounts cannot delete themselves |
| F-0118 | [stage-04.md:227](stage-04.md#L227) | bucket | C1, C6 | DEFERRED | Terraform / edge / domain / bot protection |
| F-0119 | [stage-04.md:228](stage-04.md#L228) | bucket | C2, C7, C9 | KEEP | CORS, no-store share pages, one envelope + request id + 413 + mid-stream error |
| F-0120 | [stage-04.md:229](stage-04.md#L229) | bucket | C3 | DIFF-INFRA | headers belong to the web server / LB; nginx sets nosniff only |
| F-0121 | [stage-04.md:230](stage-04.md#L230) | bucket | C4 | REWRITE | one 31 MiB body limit for every route |
| F-0122 | [stage-04.md:231](stage-04.md#L231) | bucket | C8 | KEEP | 15 s heartbeat (comment frame); the typed `ping` is counted in D8 |
| F-0123 | [stage-04.md:232](stage-04.md#L232) | bucket | C10 | KEEP | Retry-After via plugin; distinct 402 code for quota (header survival to be tested) |
| F-0124 | [stage-04.md:233](stage-04.md#L233) | bucket | C11 | n/a | later / moved |
| F-0125 | [stage-04.md:234](stage-04.md#L234) | bucket | D1 | KEEP | request id, auth hook, zod/OpenAPI |
| F-0126 | [stage-04.md:235](stage-04.md#L235) | bucket | D2 | n/a | = B11 |
| F-0127 | [stage-04.md:236](stage-04.md#L236) | bucket | D3, D4 | n/a | rate key = stage-03 1.5; idempotency = stage-03 1.4; formatter = Stage 15 / Q-E; handler = A1 |
| F-0128 | [stage-04.md:237](stage-04.md#L237) | bucket | D5, D13 | DEFERRED | audit log, per-company quota ops |
| F-0129 | [stage-04.md:238](stage-04.md#L238) | bucket | D6 | REWRITE | paths and the missing turn resource differ from the catalogue (alias routes, with the turns table) |
| F-0130 | [stage-04.md:239](stage-04.md#L239) | bucket | D7 | n/a | endpoints owned by Stages 6, 10, 11, 14, 16, 17 |
| F-0131 | [stage-04.md:240](stage-04.md#L240) | bucket | D8 | REWRITE | add `ack`, `status`, `ping`, `retract`, `Last-Event-ID`; keep existing frames |
| F-0132 | [stage-04.md:241](stage-04.md#L241) | bucket | D9, D10 | KEEP | 409 on second run; additive client, cursors, cancel idempotent |
| F-0133 | [stage-04.md:242](stage-04.md#L242) | bucket | D11 | NEW-BUILD | expose rate-limit headers and show "N left" |
| F-0134 | [stage-04.md:243](stage-04.md#L243) | bucket | D12 | NEW-BUILD | `retract` event + client handling (rules: Stage 13) |
| F-0135 | [stage-04.md:244](stage-04.md#L244) | bucket | D14 | n/a | later |
| F-0136 | [stage-04.md:245](stage-04.md#L245) | bucket | D15 | DIFF-STACK | Node/Fastify instead of FastAPI |
| F-0137 | [stage-04.md:246](stage-04.md#L246) | bucket | E1, E16 | n/a | counted in stage-05 (turns table, model calls, config stamp) |
| F-0138 | [stage-04.md:247](stage-04.md#L247) | bucket | E2, E9, E13 | KEEP | runner, controlled failures, provider rules met |
| F-0139 | [stage-04.md:248](stage-04.md#L248) | bucket | E3, E5, E8, E11, E17, E24, E26 | DEFERRED | policy engine company parts, checkpoint/trace, 3 deploys, fairness |
| F-0140 | [stage-04.md:249](stage-04.md#L249) | bucket | E4, E10, E14, E23, E25 | n/a | Stage 7, 8, 13, 15 groups |
| F-0141 | [stage-04.md:250](stage-04.md#L250) | bucket | E6 | DIFF-STACK | own thin runner in Node instead of Python |
| F-0142 | [stage-04.md:251](stage-04.md#L251) | bucket | E7 | n/a | profiles are Stage 7 (N-06) |
| F-0143 | [stage-04.md:252](stage-04.md#L252) | bucket | E12 | n/a | later |
| F-0144 | [stage-04.md:253](stage-04.md#L253) | bucket | E15 | NEW-BUILD | live provider conformance suite (dev-run only, owner gate B-11) |
| F-0145 | [stage-04.md:254](stage-04.md#L254) | bucket | E18 | NEW-BUILD | per-model token bucket in the gateway |
| F-0146 | [stage-04.md:255](stage-04.md#L255) | bucket | E19 | REWRITE | one usage row per turn instead of per model call |
| F-0147 | [stage-04.md:256](stage-04.md#L256) | bucket | E20 | NEW-BUILD | runtime kill switch for model/tool/profile |
| F-0148 | [stage-04.md:257](stage-04.md#L257) | bucket | E21 | n/a | text of G50–G63 not in the mirror |
| F-0149 | [stage-04.md:258](stage-04.md#L258) | bucket | E22 | NEW-BUILD | fallback chain, circuit breaker, refusal retry on allowed categories (open question Q-FB) |
| F-0150 | [stage-04.md:259](stage-04.md#L259) | bucket | F1, F2, F4, F5 | n/a | Stage 6, 7, 8, 9, 11, 12, 13, 16 groups |
| F-0151 | [stage-04.md:260](stage-04.md#L260) | bucket | F3 | NEW-BUILD | Safety service (M9 screen, tool-output screen, crisis path) — build plan Phase 4 |
| F-0152 | [stage-04.md:261](stage-04.md#L261) | bucket | F6 | REWRITE | caps 5,000/3,000, precedence order, Asia/Kolkata default |
| F-0153 | [stage-04.md:262](stage-04.md#L262) | bucket | G1, G2 | DEFERRED | queue and job system |
| F-0154 | [stage-04.md:263](stage-04.md#L263) | bucket | G3 | NEW-BUILD | compute and store file hash, reuse extraction in the same account |
| F-0155 | [stage-04.md:264](stage-04.md#L264) | bucket | G4 | REWRITE | purge at 23 d, add deletion ledger + sweep (ledger: stage-05) |
| F-0156 | [stage-04.md:265](stage-04.md#L265) | bucket | G5 | KEEP | terminal file states; DB is truth |
| F-0157 | [stage-04.md:266](stage-04.md#L266) | bucket | G6 | n/a | = stage-01 FT-15, FT-10 |
| F-0158 | [stage-04.md:267](stage-04.md#L267) | bucket | H1 | DIFF-INFRA | Postgres 16, no HA yet |
| F-0159 | [stage-04.md:268](stage-04.md#L268) | bucket | H2, H3, H5, H6, H9 | n/a | Q-V / Stage 12 / Stage 9 / stack |
| F-0160 | [stage-04.md:269](stage-04.md#L269) | bucket | H4, H8 | DEFERRED | infra, RLS, tenancy |
| F-0161 | [stage-04.md:270](stage-04.md#L270) | bucket | H7 | DEFERRED | ClamAV: owner-deferred to Phase 5 by build plan |
| F-0162 | [stage-04.md:271](stage-04.md#L271) | bucket | H10 | REWRITE | set N-45 statement/lock/idle timeouts |
| F-0163 | [stage-04.md:272](stage-04.md#L272) | bucket | I1 | DEFERRED | Terraform platform |
| F-0164 | [stage-04.md:273](stage-04.md#L273) | bucket | I2, I3 | n/a | = B11 / later |
| F-0165 | [stage-04.md:274](stage-04.md#L274) | bucket | J1 | n/a | Stages 6, 7 (repo avoids the problem by never replaying old thinking) |
| F-0166 | [stage-04.md:275](stage-04.md#L275) | bucket | J2 | KEEP | atomic per-user reservation with FOR UPDATE; company ₹ DEFERRED |
| F-0167 | [stage-04.md:276](stage-04.md#L276) | bucket | J3, J7 | DEFERRED | Redis, executor, company |
| F-0168 | [stage-04.md:277](stage-04.md#L277) | bucket | J4 | KEEP | version = own chat, own compaction |
| F-0169 | [stage-04.md:278](stage-04.md#L278) | bucket | J5 | n/a | counted in stage-05 |
| F-0170 | [stage-04.md:279](stage-04.md#L279) | bucket | J6 | n/a | Stages 8, 14 |
| F-0171 | [stage-04.md:280](stage-04.md#L280) | bucket | J8 | KEEP | ownership + 404 on every route (company part DEFERRED) |
| F-0172 | [stage-04.md:341](stage-04.md#L341) | question |  |  | Q-API. Rename routes to the L3 catalogue now (aliases + turn resource) or keep `/chats*` as the contract? (D6) |
| F-0173 | [stage-04.md:342](stage-04.md#L342) | question |  |  | Q-FB. Locked: client-side fallback chain with a visible note (L4-G17/G18, PE-2, RV-2). Repo Invariant 1 / ADR-0054 section 5 forbid model substitution. Which rule governs? (E22) Not resolved here. |
| F-0174 | [stage-04.md:343](stage-04.md#L343) | question |  |  | Q-E. Build plan section 2 plans an ADR "typed errors kept" (repo `ApiError` instead of RFC 9457, Stage 15 doc-sync). Is that deviation still wanted after the 2026-10-15 rule? |
| F-0175 | [stage-04.md:344](stage-04.md#L344) | question |  |  | Q-INS. Instruction caps: apply 5,000 to existing 20,000-character instructions (truncate/refuse on next edit)? Is there a user-instruction cap (N-35 lists none)? |
| F-0176 | [stage-04.md:345](stage-04.md#L345) | question |  |  | Q-V, Q1, Q2, Q-T2 (see stage-01/02/03 files). |
| F-0177 | [stage-04.md:348](stage-04.md#L348) | keep-check | prose |  | 25 KEEP bucket lines; 4 re-opened in code (>=10 %): D9 (`chats.ts:568`, `errors.ts:128-132` confirmed), E13 (`config/numbers.ts:23-29` retries and `grep temperature\|topP\|top_p\|topK` = no match, confirmed), J2 (`usage.ts:225` FOR UPDATE and `:258` confirmed), C8 (`chats.ts:813-815` confirmed). Downgrades: none. D10 stays KEEP although memory/style/share lists are not paginated (small collections; noted). |

## Stage 5 (43)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0178 | [stage-05.md:125](stage-05.md#L125) | bucket | P0 | DIFF-STACK | Drizzle / Postgres instead of SQLAlchemy / Alembic |
| F-0179 | [stage-05.md:126](stage-05.md#L126) | bucket | P1, P14 (members), P15, TA (company, role, auth tables), TB9 (turn_stream_events), TG2 (jobs, audit, legal_hold), F1b FG8, F2b, F3c (SG9, SG11, SG12, SG13, SD-3, SD-5), F6c, F8c, LC (jobs, audit, safety, B1), DFR (DFR4, DF-7) | DEFERRED | company / RLS / roles / Redis / Cloud Tasks / lifecycle infra |
| F-0180 | [stage-05.md:127](stage-05.md#L127) | bucket | P2 | REWRITE | UUIDv7 generated in the app; add `updated_at` where missing |
| F-0181 | [stage-05.md:128](stage-05.md#L128) | bucket | P3, TB2 | REWRITE | split message text and provider fields from message metadata (counted once) |
| F-0182 | [stage-05.md:129](stage-05.md#L129) | bucket | P4 | n/a | purge timing counted at stage-04 G4 |
| F-0183 | [stage-05.md:130](stage-05.md#L130) | bucket | P5 | NEW-BUILD | data map + sweep test |
| F-0184 | [stage-05.md:131](stage-05.md#L131) | bucket | P6 | KEEP | no bytes in rows |
| F-0185 | [stage-05.md:132](stage-05.md#L132) | bucket | P7 | DIFF-INFRA | Postgres 16, no HA yet |
| F-0186 | [stage-05.md:133](stage-05.md#L133) | bucket | P8, TB5 | n/a | decided with the Stage 7 group (repo never replays old thinking) |
| F-0187 | [stage-05.md:134](stage-05.md#L134) | bucket | P9 | REWRITE | parsed text to GCS, keep chunks in DB (counted with TC1) |
| F-0188 | [stage-05.md:135](stage-05.md#L135) | bucket | P10 | n/a | = stage-03 1.4 |
| F-0189 | [stage-05.md:136](stage-05.md#L136) | bucket | P11 | NEW-BUILD | deletion ledger outside the restorable DB |
| F-0190 | [stage-05.md:137](stage-05.md#L137) | bucket | P12 | n/a | = stage-04 B20 |
| F-0191 | [stage-05.md:138](stage-05.md#L138) | bucket | P13 | n/a | owner question Q1 |
| F-0192 | [stage-05.md:139](stage-05.md#L139) | bucket | P14 (projects) | KEEP | projects, project files, instructions present (cap differs: stage-04 F6) |
| F-0193 | [stage-05.md:140](stage-05.md#L140) | bucket | P16 | KEEP | chat files purged with the chat |
| F-0194 | [stage-05.md:141](stage-05.md#L141) | bucket | TA (users, sessions) | KEEP | shape adequate; Q1 may change it |
| F-0195 | [stage-05.md:142](stage-05.md#L142) | bucket | TB1 | REWRITE | add `title_version`, `memory_enabled`, `last_message_at`; message paging 50 |
| F-0196 | [stage-05.md:143](stage-05.md#L143) | bucket | TB3 | NEW-BUILD | turns table + one-running-turn partial unique index |
| F-0197 | [stage-05.md:144](stage-05.md#L144) | bucket | TB4 | n/a | = stage-04 E19 (model_calls); tool_calls columns = Stage 8 |
| F-0198 | [stage-05.md:145](stage-05.md#L145) | bucket | TB6 | REWRITE | add `grounded_by` (needed by SL-1) and cite fields (Stage 12) |
| F-0199 | [stage-05.md:146](stage-05.md#L146) | bucket | TB7 | KEEP | compaction rows per chat/version |
| F-0200 | [stage-05.md:147](stage-05.md#L147) | bucket | TB8 | NEW-BUILD | feedback table with reason + comment |
| F-0201 | [stage-05.md:148](stage-05.md#L148) | bucket | TB9 (others) | n/a | Stage 12, 13 |
| F-0202 | [stage-05.md:149](stage-05.md#L149) | bucket | TC1, TC2 | REWRITE | file columns (hash, scan, pipeline version, error code), `file_versions`; chunk fields are Stage 12 |
| F-0203 | [stage-05.md:150](stage-05.md#L150) | bucket | TD, TH | n/a | Stage 11, 8, 10 groups |
| F-0204 | [stage-05.md:151](stage-05.md#L151) | bucket | TE | n/a | counted at F6b |
| F-0205 | [stage-05.md:152](stage-05.md#L152) | bucket | TF | REWRITE | effective-dated `price_table`, reservation rows, monthly-partitioned ledger with price version / traffic tier |
| F-0206 | [stage-05.md:153](stage-05.md#L153) | bucket | TG1 | n/a | Stage 6 / stage-04 E20 |
| F-0207 | [stage-05.md:154](stage-05.md#L154) | bucket | F1a, F2a, F3a, F4a, F5a, F6a, F8a | KEEP | flows met (7 lines) |
| F-0208 | [stage-05.md:155](stage-05.md#L155) | bucket | F1b, F2c, F5b, F7 | n/a | stage-03, stage-01, stage-04, Stage 11 |
| F-0209 | [stage-05.md:156](stage-05.md#L156) | bucket | F3b | REWRITE | add jitter to the reconnect delays (N-46) |
| F-0210 | [stage-05.md:157](stage-05.md#L157) | bucket | F4b | REWRITE | regenerate must keep the old answer as a version; chosen version stored on the server |
| F-0211 | [stage-05.md:158](stage-05.md#L158) | bucket | F4c | REWRITE | an edited prompt must be able to keep or change its files |
| F-0212 | [stage-05.md:159](stage-05.md#L159) | bucket | F6b | REWRITE | store a token hash and a filtered snapshot; strip Google-grounded answers; artifact = name + type (owner question Q-Share) |
| F-0213 | [stage-05.md:160](stage-05.md#L160) | bucket | F8b | REWRITE | project delete must delete its chats too, with a count warning |
| F-0214 | [stage-05.md:161](stage-05.md#L161) | bucket | DFR (DFR1, DFR2, DFR3, DFR5, DFR6, DF-3, DF-4) | KEEP / n/a | DFR1, DFR2 KEEP; DFR3 REWRITE (query-string search: below); DFR5 counted in TF; DFR6 = FT-12 |
| F-0215 | [stage-05.md:225](stage-05.md#L225) | question |  |  | Q-Share. Artifact sharing by link is a repo feature (ADR-0039); Stage 16 G-H says an artifact in a share snapshot shows name + type only. Keep full artifact content in public links? |
| F-0216 | [stage-05.md:226](stage-05.md#L226) | question |  |  | Q-Repo-only. Tables with no Stage 5 entry: `goals`, `goal_events` (multi-step goals), `saved_sources`, `research_events`, `styles`, `account_exports`, `sandbox_workspaces`, `sandbox_claims`, `turn_logs`. Keep, fold into a stage (Stage 10 research, Stage 8 sandbox), or discard? (No action taken.) |
| F-0217 | [stage-05.md:227](stage-05.md#L227) | question |  |  | Q-Blocks. `model_call_blocks`: needed now or only when server-tool blocks must be replayed across turns (repo replays text + tool calls only)? Decided with the Stage 7 audit. |
| F-0218 | [stage-05.md:228](stage-05.md#L228) | question |  |  | Q1 (stage-01.md): passwordless/invite-only vs password + Google; decides `users.password_hash`, `email_codes`, `auth_lookup`. |
| F-0219 | [stage-05.md:229](stage-05.md#L229) | question |  |  | Q-V (stage-02.md): vector column vs Invariant 4. |
| F-0220 | [stage-05.md:232](stage-05.md#L232) | keep-check | prose |  | 13 KEEP lines; 3 re-opened in code (>=10 %): F3a SG4 (`chats.ts:684-686` run owner check confirmed), F8a XG3 (`retention.ts:73-78` shared-bytes guard confirmed), TB7 (`schema.ts:806-828` unique `(chat_id, through_seq)` confirmed). Downgrades: none. F2a GG9 (`generation.ts:1070-1084`) re-read, confirmed. |

## Stage 6 (58)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0221 | [stage-06.md:112](stage-06.md#L112) | bucket | CXD-1 | REWRITE | Delete the Tanglish/language paragraph (blocked on OQ6-3) |
| F-0222 | [stage-06.md:113](stage-06.md#L113) | bucket | CXD-2 | REWRITE | Add the ladder + versioned blocks + 5,000-char project limit; company level deferred |
| F-0223 | [stage-06.md:114](stage-06.md#L114) | bucket | CXD-3b | NEW-BUILD | Two renderings as files, loader, hash version, CI guard, beside the old prompt |
| F-0224 | [stage-06.md:115](stage-06.md#L115) | bucket | CXD-4 | NEW-BUILD | Per-file ~30k budget gate does not exist |
| F-0225 | [stage-06.md:116](stage-06.md#L116) | bucket | CXD-5 | REWRITE | Re-point compaction to the N-77 summary (trigger, 6 turns, tag, Haiku job) |
| F-0226 | [stage-06.md:117](stage-06.md#L117) | bucket | CXD-6 | NEW-BUILD | Profiles + context budget builder (blocked on OQ6-2) |
| F-0227 | [stage-06.md:118](stage-06.md#L118) | bucket | CXD-7 | REWRITE | Replace derived kit with the 68 original cases; stamp prompt version |
| F-0228 | [stage-06.md:119](stage-06.md#L119) | bucket | CXD-9 | KEEP | Native citation metadata already read from both providers |
| F-0229 | [stage-06.md:120](stage-06.md#L120) | bucket | CXD-10 | NEW-BUILD | Typed source ids do not exist |
| F-0230 | [stage-06.md:121](stage-06.md#L121) | bucket | CXD-11 | KEEP | Skill reads never cleared; re-injected after compaction |
| F-0231 | [stage-06.md:122](stage-06.md#L122) | bucket | SR-SESSION | NEW-BUILD | Session-state blocks do not exist |
| F-0232 | [stage-06.md:123](stage-06.md#L123) | bucket | SR-TURN | NEW-BUILD | `<current_time>` / `<pending_operations>` do not exist |
| F-0233 | [stage-06.md:124](stage-06.md#L124) | bucket | SR-USER | NEW-BUILD | User-turn block order and tags do not exist |
| F-0234 | [stage-06.md:125](stage-06.md#L125) | bucket | SR-ESC | REWRITE | Replace closing-tag trick by the `<` -> `&lt;` rule on all untrusted text |
| F-0235 | [stage-06.md:126](stage-06.md#L126) | bucket | SR-PROV | REWRITE | Per-provider layout (leading context part, append-only Claude updates) |
| F-0236 | [stage-06.md:127](stage-06.md#L127) | bucket | SR-SKILLS | REWRITE | Registry list exists; spec shape (`id`, `v`, "use when") and format gating differ |
| F-0237 | [stage-06.md:128](stage-06.md#L128) | bucket | SR-CACHE-C | KEEP | `cache_control` on stable prefix in place |
| F-0238 | [stage-06.md:129](stage-06.md#L129) | bucket | SR-CACHE-G | NEW-BUILD | Explicit cache + moved per-turn blocks |
| F-0239 | [stage-06.md:130](stage-06.md#L130) | bucket | PS-ID | NEW-BUILD | AI statement + `<model_info>` rule absent |
| F-0240 | [stage-06.md:131](stage-06.md#L131) | bucket | PS-AU | REWRITE | Four-level ladder + replace rule |
| F-0241 | [stage-06.md:132](stage-06.md#L132) | bucket | PS-UC | REWRITE | Close; align to spec wording and tool-result-only placement |
| F-0242 | [stage-06.md:133](stage-06.md#L133) | bucket | PS-CP | NEW-BUILD | `<capabilities_state>` flags absent |
| F-0243 | [stage-06.md:134](stage-06.md#L134) | bucket | PS-ST | REWRITE | Align list / math / filler rules |
| F-0244 | [stage-06.md:135](stage-06.md#L135) | bucket | PS-HO | REWRITE | Add HO-3, HO-7, HO-4 wording |
| F-0245 | [stage-06.md:136](stage-06.md#L136) | bucket | PS-CI | NEW-BUILD | Typed citations absent |
| F-0246 | [stage-06.md:137](stage-06.md#L137) | bucket | PS-TI | NEW-BUILD | `current_time` + cutoff rules absent |
| F-0247 | [stage-06.md:138](stage-06.md#L138) | bucket | PS-SA | REWRITE | Quote limit 15 -> 25 words, defensive security, SA-2..4 |
| F-0248 | [stage-06.md:139](stage-06.md#L139) | bucket | PS-PT | REWRITE | Add PT-2, PT-3 (SEBI), PT-4 (ECI) |
| F-0249 | [stage-06.md:140](stage-06.md#L140) | bucket | PS-WB | REWRITE | Add India helplines |
| F-0250 | [stage-06.md:141](stage-06.md#L141) | bucket | PS-CF | REWRITE | Add secrets masking + CF-1 wording; tenant rules deferred |
| F-0251 | [stage-06.md:142](stage-06.md#L142) | bucket | PS-PK-LM | NEW-BUILD | Sections absent |
| F-0252 | [stage-06.md:143](stage-06.md#L143) | bucket | PS-FI | NEW-BUILD | Coverage / retrieval_status / ids absent |
| F-0253 | [stage-06.md:144](stage-06.md#L144) | bucket | PS-WS | REWRITE | Trim to WS-1..4 + WS-2 suggestion |
| F-0254 | [stage-06.md:145](stage-06.md#L145) | bucket | PS-ME | REWRITE | Prompt side follows Stage 11 rewrite (see G3 audit) |
| F-0255 | [stage-06.md:146](stage-06.md#L146) | bucket | PS-TO | REWRITE | Add TO-2, TO-4, TO-7 |
| F-0256 | [stage-06.md:147](stage-06.md#L147) | bucket | PS-AR | REWRITE | Tool names / formats gate follow Stage 8 |
| F-0257 | [stage-06.md:148](stage-06.md#L148) | bucket | PS-SK | REWRITE | SK-2 / SK-3 wording |
| F-0258 | [stage-06.md:149](stage-06.md#L149) | bucket | PS-PR | NEW-BUILD | Profile concept absent |
| F-0259 | [stage-06.md:150](stage-06.md#L150) | bucket | HIST-WINDOW | REWRITE | 6-turn window, text-only, blocked / whitespace rules |
| F-0260 | [stage-06.md:151](stage-06.md#L151) | bucket | STAMPS | NEW-BUILD | Turn stamps absent |
| F-0261 | [stage-06.md:152](stage-06.md#L152) | bucket | REC | NEW-BUILD | Continuation text file absent |
| F-0262 | [stage-06.md:153](stage-06.md#L153) | bucket | HP-TITLE | NEW-BUILD | Generated title job absent |
| F-0263 | [stage-06.md:154](stage-06.md#L154) | bucket | MP-1 | KEEP | No sampling parameters sent |
| F-0264 | [stage-06.md:155](stage-06.md#L155) | bucket | MP-2 | REWRITE | Per-profile effort and N-74 ceilings |
| F-0265 | [stage-06.md:156](stage-06.md#L156) | bucket | CR1 | REWRITE | Chart as JSON-spec artifact; csv/zip file types per Stage 8 TD-7 |
| F-0266 | [stage-06.md:157](stage-06.md#L157) | bucket | CXD-8 | (deferred) | company; see `_parts/deferred-g2.md` |
| F-0267 | [stage-06.md:158](stage-06.md#L158) | bucket | HP-MEM | (superseded) | not built, retired by Stage 11 |
| F-0268 | [stage-06.md:159](stage-06.md#L159) | bucket | HP-RQ | (Stage 12) | bucketed in the Stage 12 audit |
| F-0269 | [stage-06.md:256](stage-06.md#L256) | question |  |  | OQ6-1 (B-4 vs locked Haiku role): Summary and title jobs are locked on `claude-haiku-5-5`, thinking disabled (ADR-0014, Stage 7 doc-sync 2026-10-14, N-77, N-76). ADR-0055 / build-plan B-4 say three models only. Do you allow a fourth registry row (Haiku 5.5) for helper roles (router, title, summary), or should the jobs run on one of the three? Not decided by the auditor. |
| F-0270 | [stage-06.md:257](stage-06.md#L257) | question |  |  | OQ6-2 (repo Invariant 3 vs N-75): `CLAUDE.md:23-24` forbids any token estimator; Stage 6 CG13 / N-75 locks "local estimate first, count API near limits". Keep the invariant (then every turn near the limit needs the count API) or amend it for pre-send history selection only (usage stays exact)? |
| F-0271 | [stage-06.md:258](stage-06.md#L258) | question |  |  | OQ6-3 (CXD-1 vs ADR-0043 / Tanglish): the product prompt has a Tanglish / language paragraph; CXD-1 removed the language section. Remove it, or keep it by an owner-approved deviation? |
| F-0272 | [stage-06.md:259](stage-06.md#L259) | question |  |  | OQ6-4 (tool extras vs v3 text): the v3 renderings name the 12 TD-1c tools. If display cards, `show_widget`, `ask_user_input_v0`, `image_search`, past-chat tools, `bash_tool` family stay, the renderings need an owner-approved extension (an ADR extending TD-1c). Keep or drop? (same question as Stage 8 OQ8-1). |
| F-0273 | [stage-06.md:260](stage-06.md#L260) | question |  |  | OQ6-5 (repo rule "Claude is the reference" vs locked v3): the repo prompt is written line by line from the reference prompt (ADR-0049 / 0052). The locked v3 renderings replace it. Confirm v3 verbatim wins. |
| F-0274 | [stage-06.md:261](stage-06.md#L261) | question |  |  | OQ6-6: the 68-case JSON is only in `D:\Architecture`; copy it into the repo before CXD-7 (the zips could not be read). |
| F-0275 | [stage-06.md:265](stage-06.md#L265) | keep-check |  |  | CXD-11: re-opened `providers/contextEditing.ts:33-36` (`isSkillRead` true for `view` of a `/skills/` path) and `generation.ts:627-646` (re-injection after compaction): confirmed. Note: the re-injection cut at 20,000 chars (`generation.ts:332,639`) can only bite a skill larger than SF-5's 5k-token body; confirmed KEEP. |
| F-0276 | [stage-06.md:266](stage-06.md#L266) | keep-check |  |  | SR-CACHE-C: re-opened `providers/anthropic.ts:441-464` (system = [stable prefix with `cache_control: ephemeral`, dynamic text]) and `:369-376` (breakpoint on second-last message): confirmed. Gap noted, not a downgrade: the spec says the date/time and session state must not sit before the breakpoint; today the date sits in the dynamic part after it, which is fine for Claude. |
| F-0277 | [stage-06.md:267](stage-06.md#L267) | keep-check |  |  | MP-1 and CXD-9 not re-opened beyond the grep / reads above (MP-1: grep over `backend/src` non-test returned no hit; CXD-9: read `anthropic.ts:217-224`, `gemini.ts:517-518`). |
| F-0278 | [stage-06.md:264](stage-06.md#L264) | keep-check | prose |  | (4 KEEP rows; 2 re-opened = 50 %) |

## Stage 7 (26)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0279 | [stage-07.md:59](stage-07.md#L59) | bucket | RT-1 (Auto rules + 7.9 hard rules) | REWRITE | Auto must default to Gemini, never pick Opus, filter by limits |
| F-0280 | [stage-07.md:60](stage-07.md#L60) | bucket | RT-2 / RT-3 / M2 (Haiku router) | NEW-BUILD | Router call type + shadow switch OFF; blocked on OQ7-1 |
| F-0281 | [stage-07.md:61](stage-07.md#L61) | bucket | RT-4 | REWRITE | Profile -> effort, xhigh / max off |
| F-0282 | [stage-07.md:62](stage-07.md#L62) | bucket | RT-5 | KEEP | Model + routing rule reported on every turn |
| F-0283 | [stage-07.md:63](stage-07.md#L63) | bucket | RT-6 retries | KEEP | N-42 matrix implemented |
| F-0284 | [stage-07.md:64](stage-07.md#L64) | bucket | RT-6 / 7.12 fallback chain + labels | NEW-BUILD | No model hop, no label; blocked on OQ7-2 |
| F-0285 | [stage-07.md:65](stage-07.md#L65) | bucket | RT-9 / 7.10 registry rows | REWRITE | Add role, fallbacks, effort map, thinking mode, max output, enabled, version |
| F-0286 | [stage-07.md:66](stage-07.md#L66) | bucket | RT-9 public choices | KEEP | Same four choices; id spelling differs only (display alias vs slug) |
| F-0287 | [stage-07.md:67](stage-07.md#L67) | bucket | M7 / `job` role | NEW-BUILD | Title / summary job rows (Stage 6 HP-TITLE, CXD-5); blocked on OQ7-1 |
| F-0288 | [stage-07.md:68](stage-07.md#L68) | bucket | 7.9 capability matrix | REWRITE | Gemini limits `null`; Claude 32 MB vs spec 30 MB |
| F-0289 | [stage-07.md:69](stage-07.md#L69) | bucket | 7.13 regenerate / conversion | KEEP | Provider switch converts tool history; verified for tool calls only |
| F-0290 | [stage-07.md:70](stage-07.md#L70) | bucket | 7.14 upgrade process | REWRITE | Needs `enabled`, rollout, version stamp, eval gate |
| F-0291 | [stage-07.md:71](stage-07.md#L71) | bucket | NO-SILENT-SUB | KEEP | Invariant 1 enforced and reported |
| F-0292 | [stage-07.md:72](stage-07.md#L72) | bucket | BREAKER | NEW-BUILD | Per-model breaker absent (Stage 15 audit also lists it) |
| F-0293 | [stage-07.md:73](stage-07.md#L73) | bucket | ADR-0012 | DIFF-INFRA | API key now (owner decision ADR-0053 #5 / ADR-0054); WIF later; set `inference_geo` and Gemini retry-off now |
| F-0294 | [stage-07.md:74](stage-07.md#L74) | bucket | CR1-CR8 / MR2, MR4, MR5, MR9-MR11, MR13, MR14, MR16-MR19 | (covered) | Mapped to the rows above; MR16 (coding to Sonnet when allowed) belongs to the router tier map RT-3 |
| F-0295 | [stage-07.md:75](stage-07.md#L75) | bucket | RT-7 / RT-8 / 7.11 / RT-10 / MR6 (limit message) / MR8 | (deferred) | company / ops; `_parts/deferred-g2.md` |
| F-0296 | [stage-07.md:119](stage-07.md#L119) | question |  |  | OQ7-1 (build-plan B-4 / ADR-0055 "three models only" vs Haiku 5.5): ADR-0013 locks the router M2 and ADR-0014 locks the title / summary jobs on `claude-haiku-5-5`. Do you allow a fourth registry row (Haiku 5.5) for helper roles, or do these roles run on one of the three models (or not at all in the prototype)? The auditor did not decide. (Same as OQ6-1.) |
| F-0297 | [stage-07.md:120](stage-07.md#L120) | question |  |  | OQ7-2: 7.12 lets Gemini fall back to Sonnet only "if the company Claude switch is ON and a limit is left". ADR-0053 #6 dropped the per-company switch. For the prototype, may a Gemini outage fall back to Sonnet automatically (a Claude cost the user did not choose), or should it show "busy, retry" with a button? |
| F-0298 | [stage-07.md:121](stage-07.md#L121) | question |  |  | OQ7-3: The repo has a user setting `routingPreference` (economy / balanced / quality) and a sticky "one model per conversation" rule for Auto. The spec has neither (RT-8 allowlist / effort cap are Later; 7.13 says Auto follows the same rules each turn). Remove both, or keep them by an owner-approved ADR? |
| F-0299 | [stage-07.md:122](stage-07.md#L122) | question |  |  | OQ7-4: Stage 7 text 7.9 still says Claude "whole request <= 30 MB" (Vertex). With the first-party API the documented limit is 32 MB. Confirm the repo may use 32 MB and that the Architecture folder text is updated. |
| F-0300 | [stage-07.md:123](stage-07.md#L123) | question |  |  | OQ7-5: RT-4 keeps thought summaries off until "the web-app thinking panel". The repo already shows them (ADR-0030). Confirm that counts as the panel condition being met. |
| F-0301 | [stage-07.md:127](stage-07.md#L127) | keep-check |  |  | RT-6 retries: re-opened `generation.ts:1444-1450` (retry only when `retryable`, attempts < `PROVIDER_MAX_RETRIES`, delay from `retryDelayMs`, not after visible output) and `config/numbers.ts:23-29` (2 / 1,000 ms / 8,000 ms / 10,000 ms): confirmed, matches N-42. |
| F-0302 | [stage-07.md:128](stage-07.md#L128) | keep-check |  |  | NO-SILENT-SUB: re-opened `generation.ts:1287-1304` (requested alias unavailable -> Auto; logged) and `:524-543` (`requested` and `resolved` both in the `start` event): confirmed that the substitution is reported, but note the user-picked Sonnet silently becoming Gemini is allowed only with a label (7.12); the frontend label was not opened - downgrade risk noted, status stays KEEP for the backend. |
| F-0303 | [stage-07.md:129](stage-07.md#L129) | keep-check |  |  | RT-5, RT-9 choices, 7.13 not re-opened beyond the reads above. |
| F-0304 | [stage-07.md:126](stage-07.md#L126) | keep-check | prose |  | (5 KEEP rows; 2 re-opened = 40 %) |

## Stage 8 (39)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0305 | [stage-08.md:66](stage-08.md#L66) | bucket | T-file_search | REWRITE | `search_project_files` -> `file_search` (scope chat / project / all, ids, citation ids); retrieval core = Stage 12 |
| F-0306 | [stage-08.md:67](stage-08.md#L67) | bucket | T-read_file | REWRITE | `read_project_file` -> `read_file` (file_id, part, cursor, envelope) |
| F-0307 | [stage-08.md:68](stage-08.md#L68) | bucket | T-web_search (+TD-2b, TD-21, TX1-TX5, CX1-CX3) | REWRITE | Gemini grounding sub-call tool; Claude native config per tier; drop SerpAPI unless owner OKs |
| F-0308 | [stage-08.md:69](stage-08.md#L69) | bucket | TD-14 controls | REWRITE | per-chat default OFF, tier caps, prefer-Gemini rule |
| F-0309 | [stage-08.md:70](stage-08.md#L70) | bucket | T-fetch_url (+TD-3) | REWRITE | Rename, SSRF with DNS + per-hop checks, 5 MB, cursor; separate service = infra later |
| F-0310 | [stage-08.md:71](stage-08.md#L71) | bucket | T-run_code | NEW-BUILD | `run_code(language, title, code, input_files)` beside the five sandbox tools |
| F-0311 | [stage-08.md:72](stage-08.md#L72) | bucket | T-create_artifact / T-update_artifact | NEW-BUILD | Tool path into the existing artifact tables |
| F-0312 | [stage-08.md:73](stage-08.md#L73) | bucket | T-load_skill (+SF-5) | NEW-BUILD | Loader tool with dedupe, resources, version pin, log |
| F-0313 | [stage-08.md:74](stage-08.md#L74) | bucket | T-get_operation_status | NEW-BUILD | No operations / jobs exist yet |
| F-0314 | [stage-08.md:75](stage-08.md#L75) | bucket | TD-12 / TS-1..5 / TS-9 | REWRITE | One spec file, schema keyword allow-list, snake_case, CI check, sorted rendering |
| F-0315 | [stage-08.md:76](stage-08.md#L76) | bucket | TS-6 / TS-7 | REWRITE | Claude `strict:true`; Gemini `parameters` + `VALIDATED` |
| F-0316 | [stage-08.md:77](stage-08.md#L77) | bucket | TS-10 | KEEP | Calls run in order, results together (stricter than spec) |
| F-0317 | [stage-08.md:78](stage-08.md#L78) | bucket | TS-11 | KEEP | Disabled tools never declared or described |
| F-0318 | [stage-08.md:79](stage-08.md#L79) | bucket | TS-12 / TD-20 | NEW-BUILD | Per-tier caps with `LIMIT_REACHED` |
| F-0319 | [stage-08.md:80](stage-08.md#L80) | bucket | TD-6 / TD-18 | NEW-BUILD | Envelope, 11 codes, 8k cap, pagination, `full_output_file` |
| F-0320 | [stage-08.md:81](stage-08.md#L81) | bucket | SB-TOPOLOGY (TD-4b, TD-5d, Stage 19 ID-7) | REWRITE | Shared warm service with per-chat uid vs fresh isolated run |
| F-0321 | [stage-08.md:82](stage-08.md#L82) | bucket | SB-LIMITS (TD-5c, N-08, N-68) | REWRITE | Timeouts, memory, files, runs per turn, parallel cap, dispatch deadline |
| F-0322 | [stage-08.md:83](stage-08.md#L83) | bucket | SB-IMAGE (TD-4c) | REWRITE | Remove pymupdf (AGPL); add the missing libraries, fonts, LibreOffice pin, DuckDB |
| F-0323 | [stage-08.md:84](stage-08.md#L84) | bucket | TD-7 | REWRITE | A4 + Indic slot, UNO recalc + error scan, lakh format, rupee fonts |
| F-0324 | [stage-08.md:85](stage-08.md#L85) | bucket | TD-8 | NEW-BUILD | ECharts JSON chart artifact |
| F-0325 | [stage-08.md:86](stage-08.md#L86) | bucket | TD-10 | KEEP | Live per-tool labels exist (rename with the new tool names) |
| F-0326 | [stage-08.md:87](stage-08.md#L87) | bucket | TD-11 | REWRITE | Rewrite skills from library docs, add notices, lawyer check (part of skill packs) |
| F-0327 | [stage-08.md:88](stage-08.md#L88) | bucket | SF-PACKS (SF-1..SF-4, SF-6..SF-8) | NEW-BUILD | 6 packs in standard folders with scripts and templates; existing 4 office skills rewritten |
| F-0328 | [stage-08.md:89](stage-08.md#L89) | bucket | SF-9 | NEW-BUILD | Eval framework + 99 % gate |
| F-0329 | [stage-08.md:90](stage-08.md#L90) | bucket | SF-10 | REWRITE | Add CI validator; ownership rule already true |
| F-0330 | [stage-08.md:91](stage-08.md#L91) | bucket | TL-3 | KEEP | No external-action tool |
| F-0331 | [stage-08.md:92](stage-08.md#L92) | bucket | ART-DATA | KEEP | Artifact tables, endpoints and stream event exist |
| F-0332 | [stage-08.md:93](stage-08.md#L93) | bucket | TD-9, TD-14 quota, N-18, N-08 per-company | (deferred) | company; `_parts/deferred-g2.md` |
| F-0333 | [stage-08.md:94](stage-08.md#L94) | bucket | Memory trio (memory_read / write / delete) | (Stage 11) | bucketed in the Stage 11 audit |
| F-0334 | [stage-08.md:95](stage-08.md#L95) | bucket | Non-spec tools (EXTRAS) | (owner question) | OQ8-1 |
| F-0335 | [stage-08.md:147](stage-08.md#L147) | question |  |  | OQ8-1 (extras vs the locked 12): the repo ships tools outside TD-1c: 13 display cards, `show_widget` / `read_me`, `ask_user_input_v0`, `image_search`, `conversation_search` / `read_conversation` / `recent_chats`, `memory_list` / `memory_append` / `memory_str_replace`, and the sandbox family (`bash_tool`, `view`, `create_file`, `str_replace`, `present_files`) instead of `run_code`. Also skills outside SF-1 (`pdf-reading`, `file-reading`, `frontend-design`, `skill-creator`). Per CLAUDE.md "never change a locked decision": do you want an ADR extending TD-1c to keep any of them, or should they be discarded when the 12-tool set lands? The auditor did not decide. |
| F-0336 | [stage-08.md:148](stage-08.md#L148) | question |  |  | OQ8-2 (search provider): the repo sends queries to SerpAPI or Google CSE and uses Gemini's native Google Search inside the main call. TD-2b locks a grounding-only sub-call (Web Grounding for Enterprise) and Claude native search. Confirm the replacement and that SerpAPI / CSE are removed. |
| F-0337 | [stage-08.md:149](stage-08.md#L149) | question |  |  | OQ8-3 (AGPL): `pymupdf` is in the sandbox image today. Confirm removal (TD-4c excludes it). |
| F-0338 | [stage-08.md:150](stage-08.md#L150) | question |  |  | OQ8-4 (sandbox isolation): the warm shared service (ADR-0010 / 0014 / 0015) vs a fresh isolated run per call (TD-4b + Stage 19 ID-7). Keep the warm service as an owner-approved deviation for the prototype, or move to per-run Jobs? |
| F-0339 | [stage-08.md:151](stage-08.md#L151) | question |  |  | OQ8-5 (TD-11): were the repo's eight skills written from library docs or adapted from Anthropic's public skills? A short owner statement (and a THIRD_PARTY notice file if anything is adapted) closes the lawyer-list item. |
| F-0340 | [stage-08.md:155](stage-08.md#L155) | keep-check |  |  | TS-11: re-opened `tools/registry.ts:50-63` (memory, chat, UI, web, code and project tools are pushed only under their flag; code only when `context.allowCode === true`) and `services/promptCache/promptAssembly.ts:26-41` (policy text only when the tool is allowed): confirmed. |
| F-0341 | [stage-08.md:156](stage-08.md#L156) | keep-check |  |  | TL-3: re-read the tool name list of `tools/definitions.ts` and `tools/displayDefinitions.ts` (grep) for any send / post / email / payment tool: none; `message_compose_v1` renders a draft card only (`displayDefinitions.ts:289-325`): confirmed. |
| F-0342 | [stage-08.md:157](stage-08.md#L157) | keep-check |  |  | TS-10, TD-10, ART-DATA: confirmed from the reads of `docs/decisions/0026-parallel-tool-calls.md`, `ToolActivity.tsx:48-72`, `routes/artifacts.ts:72-446`; not re-opened a second time. |
| F-0343 | [stage-08.md:154](stage-08.md#L154) | keep-check | prose |  | (5 KEEP rows; 2 re-opened = 40 %) |

## Stage 9 (34)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0344 | [stage-09.md:69](stage-09.md#L69) | bucket | PIPE | NEW-BUILD | Async file state machine with idempotent steps, states, sidecar, Retry / Remove; in-process runner first |
| F-0345 | [stage-09.md:70](stage-09.md#L70) | bucket | INTAKE | REWRITE | Magic sniff, macro / legacy rejection with message, encrypted rejection |
| F-0346 | [stage-09.md:71](stage-09.md#L71) | bucket | TYPES | REWRITE | Trim the allowlist to the spec list (+ CSV / TXT / MD), add HEIC and ZIP type; extras per OQ9-3 |
| F-0347 | [stage-09.md:72](stage-09.md#L72) | bucket | LIMITS | REWRITE | Per-type sizes, images 20 MB, audio 3 h, <= 10 per message, upload rate, project limits |
| F-0348 | [stage-09.md:73](stage-09.md#L73) | bucket | SCAN | NEW-BUILD | ClamAV scan + malware / scan_incomplete states + hardening (OQ9-1) |
| F-0349 | [stage-09.md:74](stage-09.md#L74) | bucket | ZIP | NEW-BUILD | Safe ZIP unpack |
| F-0350 | [stage-09.md:75](stage-09.md#L75) | bucket | ISOLATION | NEW-BUILD | Parser service with no egress, no secrets, subprocess limits |
| F-0351 | [stage-09.md:76](stage-09.md#L76) | bucket | OFFICE->PDF | NEW-BUILD | LibreOffice render for page images |
| F-0352 | [stage-09.md:77](stage-09.md#L77) | bucket | EXTRACT | NEW-BUILD | Docling-class extractor layer behind the isolation boundary |
| F-0353 | [stage-09.md:78](stage-09.md#L78) | bucket | OCR-M11 | NEW-BUILD | Document AI pinned RC + Gemini fallback, per-page engine / version (OQ9-1) |
| F-0354 | [stage-09.md:79](stage-09.md#L79) | bucket | AUDIO | REWRITE | Split + merge + timestamps + 3 h limit on top of the existing Gemini call |
| F-0355 | [stage-09.md:80](stage-09.md#L80) | bucket | MIC | NEW-BUILD | Backend dictation endpoint (<= 2 min) replacing browser-only recognition |
| F-0356 | [stage-09.md:81](stage-09.md#L81) | bucket | EXCEL | REWRITE | 30k gate, per-sheet summary + sample, CSV / Parquet, addresses, hidden sheets |
| F-0357 | [stage-09.md:82](stage-09.md#L82) | bucket | IMAGES | REWRITE | Normalise (EXIF, HEIC, resize, 5 MB), OCR, 20 MB limit |
| F-0358 | [stage-09.md:83](stage-09.md#L83) | bucket | PDF->MODEL | REWRITE | Budget-driven whole vs retrieved pages, N-13 caps, 22 MB rule |
| F-0359 | [stage-09.md:84](stage-09.md#L84) | bucket | PAGEIMG | DIFF-STACK | On-demand render, not stored: poppler instead of pypdfium2, outcome met |
| F-0360 | [stage-09.md:85](stage-09.md#L85) | bucket | NORM | NEW-BUILD | Markdown + JSON sidecar with versions |
| F-0361 | [stage-09.md:86](stage-09.md#L86) | bucket | CHUNK | REWRITE | 800 tokens / 15 %, headings, table headers, locations (shared with Stage 12) |
| F-0362 | [stage-09.md:87](stage-09.md#L87) | bucket | EMBED | NEW-BUILD | Embedding 2 text + visual vectors; blocked by Invariant 4 (Stage 12 question) and OQ9-1 |
| F-0363 | [stage-09.md:88](stage-09.md#L88) | bucket | TOKENS | NEW-BUILD | Per-file per-model token counts at ingest via the free count APIs |
| F-0364 | [stage-09.md:89](stage-09.md#L89) | bucket | CLAUDE-IMG/PDF | REWRITE | Follows PDF->MODEL and IMAGES (22 MB native rule, 30 MB request guard) |
| F-0365 | [stage-09.md:90](stage-09.md#L90) | bucket | LIFE-DEL | KEEP | 30-day purge with bytes removed |
| F-0366 | [stage-09.md:91](stage-09.md#L91) | bucket | LIFE-MORE | REWRITE | Cancel in-flight work, replace re-process, artifacts via pipeline |
| F-0367 | [stage-09.md:92](stage-09.md#L92) | bucket | RETRY | NEW-BUILD | Needs the failed states of PIPE |
| F-0368 | [stage-09.md:93](stage-09.md#L93) | bucket | G13 | NEW-BUILD | Formula-injection escaping on generated CSV / XLSX |
| F-0369 | [stage-09.md:94](stage-09.md#L94) | bucket | G36 pixel cap | KEEP | 8000 x 8000 px cap enforced at upload |
| F-0370 | [stage-09.md:95](stage-09.md#L95) | bucket | NOT-USED, G26, G27 | (n/a) | Nothing to build (Later / not used) |
| F-0371 | [stage-09.md:135](stage-09.md#L135) | question |  |  | OQ9-1 (build plan vs ADR-0061): the build plan defers ClamAV, Document AI OCR, the Cloud Tasks file queue and embeddings to Phase 5 (`00-build-plan-arcnave-tech.md:72`, written before ADR-0061). ADR-0061 lists only company / RLS / Redis / Cloud Tasks / NO_CONTENT / Terraform / OTel as deferrable. Do ClamAV and Document AI OCR (M11, ADR-0006) count as owner-deferred, or must they be built now? The auditor bucketed them NEW-BUILD and did not decide. |
| F-0372 | [stage-09.md:136](stage-09.md#L136) | question |  |  | OQ9-2 (Stage 12 link): visual-page vectors (V-1 / V-2) and chunk embeddings need an embedding column; repo Invariant 4 forbids it. Answer belongs to the Stage 12 audit; recorded here because EMBED depends on it. |
| F-0373 | [stage-09.md:137](stage-09.md#L137) | question |  |  | OQ9-3 (extras): the repo also accepts `.odt .rtf .epub .html .css .xml .js .py .sql .yml`, `.xls`, and video (`mp4 webm mov`), which are not in the Stage 9 list. Keep any of them (ADR extending the list) or reject them? `.xls` is a locked rejection (D9-12). |
| F-0374 | [stage-09.md:138](stage-09.md#L138) | question |  |  | OQ9-4 (OCR in the sandbox): the warm sandbox image installs tesseract (eng, tam) for model-written OCR (`Dockerfile.service:19`). Keep it as a code-level tool, or remove it once Document AI is the OCR path? |
| F-0375 | [stage-09.md:142](stage-09.md#L142) | keep-check |  |  | G36 image pixel cap: re-opened `services/attachments/processUpload.ts:236-266`: `imageSize` reads the header, rejects `width` or `height` > `FILE_LIMITS.imageMaxDimension` 8000 with `payload_too_large`, deletes the row (`routes/files.ts:518-523`): confirmed. Note, not a downgrade: the 10 MB size limit there differs from the spec's 20 MB (LIMITS row). |
| F-0376 | [stage-09.md:143](stage-09.md#L143) | keep-check |  |  | LIFE-DEL: read `services/retention.ts:1-40` and `config/numbers.ts:61` (30 days, bytes and rows, locked sweep); not re-opened a second time; the 23 d + 7 d split is not implemented but the 30 d total is. |
| F-0377 | [stage-09.md:141](stage-09.md#L141) | keep-check | prose |  | (2 KEEP rows; 1 re-opened = 50 %) |

## Stage 10 (37)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0378 | [stage-10.md:74](stage-10.md#L74) | bucket | AO-2 | KEEP | live step list + persisted progress frames exist (ToolActivity.tsx:55-60, generation.ts:1007-1019) |
| F-0379 | [stage-10.md:75](stage-10.md#L75) | bucket | AO-3 | KEEP | ask_user_input_v0 + prompt rule meet the outcome (definitions.ts:522, systemPrompt.ts:44) |
| F-0380 | [stage-10.md:76](stage-10.md#L76) | bucket | AO-4 | DIFF-INFRA | Cloud Tasks executor / Cloud Run jobs are infra; the 10-min vs 59-min deadline is a number, see Q2 |
| F-0381 | [stage-10.md:77](stage-10.md#L77) | bucket | AO-5 | KEEP | Stop aborts at every step and keeps partial (chats.ts:696-712, generation.ts:1169-1177); cross-instance part is in AO-4b |
| F-0382 | [stage-10.md:78](stage-10.md#L78) | bucket | AO-6 | NEW-BUILD | nothing exists; whole-document map-reduce with coverage % |
| F-0383 | [stage-10.md:79](stage-10.md#L79) | bucket | AO-7 | NEW-BUILD | no in-app "finished in another chat" notice |
| F-0384 | [stage-10.md:80](stage-10.md#L80) | bucket | AO-8 | KEEP | no Claude betas; own guards (gemini.ts:408, config.ts:310-317) |
| F-0385 | [stage-10.md:81](stage-10.md#L81) | bucket | AO-10 | NEW-BUILD | only empty-reply guard exists; built together with Stage 13 VD-6 |
| F-0386 | [stage-10.md:82](stage-10.md#L82) | bucket | AO-12 | KEEP | send blocked while uploading; processing is inside the upload call (Composer.tsx:445, files.ts:249,303) |
| F-0387 | [stage-10.md:83](stage-10.md#L83) | bucket | AG10 | REWRITE | xhigh/max accepted at API, DB check, UI ladder |
| F-0388 | [stage-10.md:84](stage-10.md#L84) | bucket | AG12 | KEEP | systemPrompt.ts:44 |
| F-0389 | [stage-10.md:85](stage-10.md#L85) | bucket | FD-1 | KEEP | one run per chat, no steering (chats.ts:568) |
| F-0390 | [stage-10.md:86](stage-10.md#L86) | bucket | O-2/N-06 | REWRITE | one cap of 16 rounds, no Fast/Normal/Deep tool-step profiles |
| F-0391 | [stage-10.md:87](stage-10.md#L87) | bucket | AO-4b | NEW-BUILD | run state is process memory; durable event log + lease + resume needed (Postgres first, Redis later = DIFF-INFRA) |
| F-0392 | [stage-10.md:88](stage-10.md#L88) | bucket | RS-1 (+AO-1, AG14, AG15, RD-13 data) | NEW-BUILD | only a mode flag + prompt paragraph exist |
| F-0393 | [stage-10.md:89](stage-10.md#L89) | bucket | RS-2 | NEW-BUILD | provider-consistent helpers + lead |
| F-0394 | [stage-10.md:90](stage-10.md#L90) | bucket | RS-3 | NEW-BUILD | per-run caps 30 min / 50 searches / 5 helpers |
| F-0395 | [stage-10.md:91](stage-10.md#L91) | bucket | RS-5 | NEW-BUILD | notes checkpoint table, cancel → partial report; the Cloud Run job host is DIFF-INFRA (in-process worker first) |
| F-0396 | [stage-10.md:92](stage-10.md#L92) | bucket | RS-6 | NEW-BUILD | web + chat/project files for helpers (needs Stage 12 file search) |
| F-0397 | [stage-10.md:93](stage-10.md#L93) | bucket | RG1 | NEW-BUILD | notes table stores only own notes + links |
| F-0398 | [stage-10.md:94](stage-10.md#L94) | bucket | RG2 | REWRITE | share route returns sources of grounded answers (share.ts:383-393) |
| F-0399 | [stage-10.md:95](stage-10.md#L95) | bucket | RG3 | NEW-BUILD | Claude research budget reservation + Gemini offer |
| F-0400 | [stage-10.md:96](stage-10.md#L96) | bucket | RG4 | NEW-BUILD | per-run search override, cap 50 |
| F-0401 | [stage-10.md:97](stage-10.md#L97) | bucket | RG5 | KEEP | research_events persisted (schema.ts:348-362) |
| F-0402 | [stage-10.md:98](stage-10.md#L98) | bucket | RG6 | REWRITE | single controller ref blocks parallel chats in one tab (workspace.tsx:443-444) |
| F-0403 | [stage-10.md:99](stage-10.md#L99) | bucket | RG7 | NEW-BUILD | helper/lead effort; with AG10 |
| F-0404 | [stage-10.md:100](stage-10.md#L100) | bucket | RG8 | NEW-BUILD | one ledger row per helper call |
| F-0405 | [stage-10.md:101](stage-10.md#L101) | bucket | AO-11, RS-4, RS-7 | DEFERRED | company/tenancy quotas and admin switch — in `_parts/deferred-g3.md`, not bucketed |
| F-0406 | [stage-10.md:102](stage-10.md#L102) | bucket | RS-8 | n/a | process gate after Stage 21/18; no code |
| F-0407 | [stage-10.md:151](stage-10.md#L151) | question |  |  | Q1. Build plan P3-E says "Research mode: Later – record in ADR"; checkpoint Stage 10 + 10b lock it as MVP (provisional) with a Stage 21 keep/limit gate (RS-8). ADR-0061 says the locked decision wins. Confirm: build research mode now (Option A above), or write an owner-approved deviation ADR? |
| F-0408 | [stage-10.md:152](stage-10.md#L152) | question |  |  | Q2. Turn deadline: register N-06/N-43 say 10 min (Executor 15 min); repo runs turns inline up to 59 min (`numbers.ts:39`). Until a Cloud Tasks executor exists, keep 59 min (outcome "long work does not die") or cut to 10 min and push >10 min work to the research/map-reduce worker? |
| F-0409 | [stage-10.md:153](stage-10.md#L153) | question |  |  | Q3. ADR-0055/B-4 "three models only": RS-2 and AO-6 use Gemini Flash (in the three) and Sonnet/Opus (in the three); no Haiku/Flash-Lite needed for Stage 10 itself. Stage 10 raises no model conflict; the Flash-Lite judge for the completion check is Stage 13 (Q in `stage-13.md`). |
| F-0410 | [stage-10.md:154](stage-10.md#L154) | question |  |  | Q4. Stage 10 `RG1` lawyer item: normal-chat grounded snippets are already stored (`schema.ts:340-341`). Keep storing snippets for normal chat, or align with the research rule (links only)? |
| F-0411 | [stage-10.md:160](stage-10.md#L160) | keep-check | AO-5 |  | `chats.ts:696-712` (stop aborts `activeRuns` controller), `generation.ts:1169-1177` (status `stopped`, collected text saved), `anthropic.ts:440,502` (abort checked per round and per event) — confirmed for a single instance; DB-flag / cross-instance cancel is NOT present → carried in AO-4b |
| F-0412 | [stage-10.md:161](stage-10.md#L161) | keep-check | AO-8 |  | searched `context_management — betas — compact_20 — clear_tool_uses` in `backend/src` non-test → 0 hits; `gemini.ts:408` clears old function responses (own guard, not a Claude beta) — confirmed |
| F-0413 | [stage-10.md:162](stage-10.md#L162) | keep-check | AO-12 |  | `Composer.tsx:445,451,808`; `routes/files.ts:249,303` (status `uploading` → `ready` after server processing) — confirmed; failed files are excluded from the send rather than blocking it (`Composer.tsx:452-454`) — acceptable under AS-D6 Retry/Remove, checked by Stage 9 audit |
| F-0414 | [stage-10.md:157](stage-10.md#L157) | keep-check | prose |  | (8 KEEP rows; 3 re-opened = 37 %.) |

## Stage 11 (33)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0415 | [stage-11.md:69](stage-11.md#L69) | bucket | M-01 | KEEP | file-per-subject memory with listing + on-demand reads (memoryService.ts:446-466) |
| F-0416 | [stage-11.md:70](stage-11.md#L70) | bucket | M-02 | REWRITE | `/projects` vs `/areas`, `(stated)` vs `[stated]`, no per-line format |
| F-0417 | [stage-11.md:71](stage-11.md#L71) | bucket | M-03 | REWRITE | whole-file rows → doc/line/source/tombstone/settings tables (company_id: deferred file D-G3-01) |
| F-0418 | [stage-11.md:72](stage-11.md#L72) | bucket | M-04 | REWRITE | add "write after the answer text" rule; writes become line ops |
| F-0419 | [stage-11.md:73](stage-11.md#L73) | bucket | M-05 | REWRITE | sensitive opt-in per user missing (company layer deferred); owner question Q1 |
| F-0420 | [stage-11.md:74](stage-11.md#L74) | bucket | M-06 | REWRITE | snapshot budget, alias prefetch, per-chat gate, change notice |
| F-0421 | [stage-11.md:75](stage-11.md#L75) | bucket | M-07 | REWRITE | six file tools → three line-op tools; owner question Q2 |
| F-0422 | [stage-11.md:76](stage-11.md#L76) | bucket | M-08 | REWRITE | server validator covers secrets + ID numbers only |
| F-0423 | [stage-11.md:77](stage-11.md#L77) | bucket | M-09 | REWRITE | per-user sensitive switch, not retroactive, separate write; Q1 |
| F-0424 | [stage-11.md:78](stage-11.md#L78) | bucket | M-10 | REWRITE | prompt-only; add a server check for the fixed patterns |
| F-0425 | [stage-11.md:79](stage-11.md#L79) | bucket | M-11 | REWRITE | restrict `/people` to work context |
| F-0426 | [stage-11.md:80](stage-11.md#L80) | bucket | M-12 | NEW-BUILD | tombstone table + check on write |
| F-0427 | [stage-11.md:81](stage-11.md#L81) | bucket | M-13 | REWRITE | per-line ≤300 chars (N-35), one fact per line |
| F-0428 | [stage-11.md:82](stage-11.md#L82) | bucket | M-14 | KEEP | policy.ts:38-39 |
| F-0429 | [stage-11.md:83](stage-11.md#L83) | bucket | M-15 | KEEP | policy.ts:15-34,67-68 |
| F-0430 | [stage-11.md:84](stage-11.md#L84) | bucket | M-16 | REWRITE | add the chip and the sensitive/refusal notices (labels exist) |
| F-0431 | [stage-11.md:85](stage-11.md#L85) | bucket | M-17 | REWRITE | line-level edit, sensitive opt-in, per-chat toggle |
| F-0432 | [stage-11.md:86](stage-11.md#L86) | bucket | M-18 | DEFERRED | admins/company — deferred file |
| F-0433 | [stage-11.md:87](stage-11.md#L87) | bucket | M-19 | NEW-BUILD | needs line sources + `origin`; today chat delete does nothing to memory |
| F-0434 | [stage-11.md:88](stage-11.md#L88) | bucket | M-20 | REWRITE | caps in docs/lines/tokens vs bytes/chars; Q3 |
| F-0435 | [stage-11.md:89](stage-11.md#L89) | bucket | M-21 | KEEP | no TTL, condense note (memoryExecutor.ts:40-49) |
| F-0436 | [stage-11.md:90](stage-11.md#L90) | bucket | M-22 | KEEP | own tools only |
| F-0437 | [stage-11.md:91](stage-11.md#L91) | bucket | M-23 | KEEP | superset built; locked as Later, no action (Q4) |
| F-0438 | [stage-11.md:92](stage-11.md#L92) | bucket | M-24 | DEFERRED | NO_CONTENT enforce |
| F-0439 | [stage-11.md:93](stage-11.md#L93) | bucket | M-25 | n/a | contingent fallback |
| F-0440 | [stage-11.md:126](stage-11.md#L126) | question |  |  | Q1. Sensitive memory: locked = off until each user opts in (MEM-5/M-09, not retroactive). Repo ADR-0052 / `policy.ts:61` follow the reference ("no separate consent step; saved when the user asks to remember it"). Build the locked opt-in (my recommendation, ADR-0061) or keep the reference rule and write a deviation ADR? |
| F-0441 | [stage-11.md:127](stage-11.md#L127) | question |  |  | Q2. Tool surface: repo ADR-0047/0052 adopted the reference's six file tools; locked MEM-TOOLS is three line-op tools within a 12-tool budget (Stage 8 TD-1c). Switch to the three tools (recommended), or keep six and amend Stage 8? |
| F-0442 | [stage-11.md:128](stage-11.md#L128) | question |  |  | Q3. M-20 caps are in tokens (≤3k/doc, ≤1.5k snapshot) but repo Invariant 3 says no token estimator (N-75 "local estimator" is also in the register). Define the memory caps in characters/bytes (recommended) or allow an estimator for this one purpose? |
| F-0443 | [stage-11.md:129](stage-11.md#L129) | question |  |  | Q4. Project-scope memory, past-chat search and import are already built; locked as "Later". Keep them (extra surface, extra privacy review under DPDP) or remove until Stage 12 citations exist? |
| F-0444 | [stage-11.md:135](stage-11.md#L135) | keep-check | M-14 |  | `services/memory/policy.ts:38-39` — confirmed (the "did the user say this?" test and the not-saved list are present) |
| F-0445 | [stage-11.md:136](stage-11.md#L136) | keep-check | M-15 |  | `policy.ts:27,29,31,67,68`; `generation.ts:1941-1943` (memory block only when tools allowed) — confirmed |
| F-0446 | [stage-11.md:137](stage-11.md#L137) | keep-check | M-21 |  | `schema.ts:763-783` has no TTL/expiry column; `memoryExecutor.ts:40-49` consolidation note at 85 % of the 16 KiB cap — confirmed |
| F-0447 | [stage-11.md:132](stage-11.md#L132) | keep-check | prose |  | (6 KEEP rows; 3 re-opened = 50 %.) |

## Stage 12 (41)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0448 | [stage-12.md:73](stage-12.md#L73) | bucket | L-01 | REWRITE | English-only tokenizer and stop list make Tamil/Hindi invisible (retrieval.ts:415-419) |
| F-0449 | [stage-12.md:74](stage-12.md#L74) | bucket | L-02 | REWRITE | all-or-nothing project chars, no per-file decision, no chat scope |
| F-0450 | [stage-12.md:75](stage-12.md#L75) | bucket | L-03 | REWRITE | 1,400/180 chars, 400-chunk cap, no heading path / label / NFC / furniture removal |
| F-0451 | [stage-12.md:76](stage-12.md#L76) | bucket | L-04 | NEW-BUILD | no embeddings, versions, index_status — **blocked by owner question Q1 (Invariant 4 / ADR-0059)** |
| F-0452 | [stage-12.md:77](stage-12.md#L77) | bucket | L-05 | NEW-BUILD | audio gets time segments |
| F-0453 | [stage-12.md:78](stage-12.md#L78) | bucket | L-06 | REWRITE | scope becomes chat+project, access re-resolved each turn (RLS deferred) |
| F-0454 | [stage-12.md:79](stage-12.md#L79) | bucket | L-07 | REWRITE | char caps → 6k/20k/80k token share (Q3 on token counting) |
| F-0455 | [stage-12.md:80](stage-12.md#L80) | bucket | L-08 | NEW-BUILD | planner call; model question Q2 |
| F-0456 | [stage-12.md:81](stage-12.md#L81) | bucket | L-09 | NEW-BUILD | intent routing; DuckDB under L-22 |
| F-0457 | [stage-12.md:82](stage-12.md#L82) | bucket | L-10 | REWRITE | move scoring out of JS into Postgres (tsvector `simple` / pg_textsearch) |
| F-0458 | [stage-12.md:83](stage-12.md#L83) | bucket | L-11 | NEW-BUILD | pgvector search — blocked by Q1 |
| F-0459 | [stage-12.md:84](stage-12.md#L84) | bucket | L-12 | DEFERRED | Redis |
| F-0460 | [stage-12.md:85](stage-12.md#L85) | bucket | L-13 | NEW-BUILD | RRF, merge, MMR, coverage |
| F-0461 | [stage-12.md:86](stage-12.md#L86) | bucket | L-14 | NEW-BUILD | Vertex Ranking API client in the provider layer |
| F-0462 | [stage-12.md:87](stage-12.md#L87) | bucket | L-15 | NEW-BUILD | selection order, history dedupe |
| F-0463 | [stage-12.md:88](stage-12.md#L88) | bucket | L-16 | NEW-BUILD | citation registry + prompt layout + flags |
| F-0464 | [stage-12.md:89](stage-12.md#L89) | bucket | L-17 | NEW-BUILD | per-turn call caps + "already provided" |
| F-0465 | [stage-12.md:90](stage-12.md#L90) | bucket | L-18 | NEW-BUILD | retrieval record + stubs |
| F-0466 | [stage-12.md:91](stage-12.md#L91) | bucket | L-19 | KEEP | cascade delete + ready-only search (schema.ts:190-195, retrieval.ts:472) |
| F-0467 | [stage-12.md:92](stage-12.md#L92) | bucket | L-20 | NEW-BUILD | stub earlier turns |
| F-0468 | [stage-12.md:93](stage-12.md#L93) | bucket | L-21 | NEW-BUILD | degraded flags |
| F-0469 | [stage-12.md:94](stage-12.md#L94) | bucket | L-22 | NEW-BUILD | DuckDB in sandbox image + several-tables detection |
| F-0470 | [stage-12.md:95](stage-12.md#L95) | bucket | L-23 | DEFERRED | per-company caps / pool |
| F-0471 | [stage-12.md:96](stage-12.md#L96) | bucket | L-24 | KEEP | none of the excluded parts exists |
| F-0472 | [stage-12.md:97](stage-12.md#L97) | bucket | L-25 | NEW-BUILD | labelled set + metrics (reuse rankmetrics.py ideas) |
| F-0473 | [stage-12.md:98](stage-12.md#L98) | bucket | L-26 | DEFERRED | per-company partitions (raise-now flag in deferred file) |
| F-0474 | [stage-12.md:151](stage-12.md#L151) | question |  |  | Q1. Invariant 4 / ADR-0059 versus the Stage 12 hybrid lock (see §4 L-04/L-11): build pgvector + Embedding 2 + RRF + Ranking API now and amend Invariant 4 (Option A), or keep BM25 until the P2-D eval decides (Option B, the ADR-0059 plan)? Embedding every upload costs money (Embedding 2 $0.20 / M text tokens, N-36) and the eval needs both arms. |
| F-0475 | [stage-12.md:152](stage-12.md#L152) | question |  |  | Q2. Model policy: the planner is `gemini-3.5-flash-lite` (and, per the 2026-10-08 doc-sync, may merge with the Haiku 5.5 router, ADR-0013); repo ADR-0055 / B-4 say three models only (Gemini 3.8 Flash, Sonnet 5.5, Opus 5.5). Embedding 2 and the Ranking API are non-chat models. Do the helper models (planner, embedding, ranking, router, judge) sit outside the "three models" rule? |
| F-0476 | [stage-12.md:153](stage-12.md#L153) | question |  |  | Q3. N-14 (~800 tokens) and N-03/N-04/N-05 (tokens) need a token count; Invariant 3 forbids an estimator, N-75 introduces one for context. Express chunk size and the retrieval share in characters (recommended, as `numbers.ts` already does) or approve a counting call/estimator? |
| F-0477 | [stage-12.md:154](stage-12.md#L154) | question |  |  | Q4. D1 says Stage 21 decides 30k vs 100k; the repo has 200,000 chars all-or-nothing. Keep 200,000 chars until the test, or start at the locked 30k tokens? |
| F-0478 | [stage-12.md:160](stage-12.md#L160) | keep-check | L-19 |  | `schema.ts:190-195` (`onDelete: cascade` from `project_files`), `retrieval.ts:472` (`status = ready`) — confirmed for project files; text in earlier turns is not removed (that is L-20) |
| F-0479 | [stage-12.md:161](stage-12.md#L161) | keep-check | L-24 |  | `retrieval.ts` has no compression / HyDE / graph / SPLADE; no Vertex RAG Engine call (searched `rag`, `Vertex AI Search` → comment only) — confirmed |
| F-0480 | [stage-12.md:157](stage-12.md#L157) | keep-check | prose |  | (2 KEEP rows; both re-opened = 100 %.) |
| F-0481 | [stage-12.md:166](stage-12.md#L166) | number | N-04 | DIFF | retrieval share Fast 6k / Normal 20k / Deep 80k (l.9) — 8 excerpts / 12,000 chars without tools (`generation.ts:336-337`); whole-project cap 200,000 chars (`config.ts:171`) |
| F-0482 | [stage-12.md:167](stage-12.md#L167) | number | N-05 | DIFF | whole-file 30k tokens, Deep 100k test arm (l.10) — 200,000 chars total for all project files (`config.ts:171`) |
| F-0483 | [stage-12.md:168](stage-12.md#L168) | number | N-07 | DIFF | file_search per turn 1-3-6 (l.12) — per-call limit ≤10, no per-turn cap (`tools/executor.ts:31-34`) |
| F-0484 | [stage-12.md:169](stage-12.md#L169) | number | N-14 | DIFF | ~800 tokens / ~15 % overlap (l.19) — 1,400 chars / 180 chars (12.9 %), max 400 chunks (`retrieval.ts:20-22`) |
| F-0485 | [stage-12.md:170](stage-12.md#L170) | number | N-15 | DIFF | 1,536 dims (l.20) — no vector column (`schema.ts:183-184`) |
| F-0486 | [stage-12.md:171](stage-12.md#L171) | number | N-26 | DIFF | Ranking API `-004`, top 30, p95 ≤ 600 ms (l.31) — none |
| F-0487 | [stage-12.md:172](stage-12.md#L172) | number | N-27 | DIFF | planner 300 / embed 250 / search 100 / rerank 600 / assemble 50 → p95 ≤ 1,200 ms (l.32) — none |
| F-0488 | [stage-12.md:173](stage-12.md#L173) | number | N-28 | DIFF | planner timeout ~300 ms (l.33; re-decided in Phase 2 per doc-sync 2026-10-08) — none |

## Stage 13 (36)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0489 | [stage-13.md:84](stage-13.md#L84) | bucket | V-01 | NEW-BUILD | validator contract with release points and latency per check |
| F-0490 | [stage-13.md:85](stage-13.md#L85) | bucket | V-02 | REWRITE | no Gemini finish-code map, no `message_delta`/empty-`end_turn` rule |
| F-0491 | [stage-13.md:86](stage-13.md#L86) | bucket | V-03 | NEW-BUILD | async claim judge; model question Q1 |
| F-0492 | [stage-13.md:87](stage-13.md#L87) | bucket | V-04 | NEW-BUILD | annotate note + weak-citation marks; Deep regenerate |
| F-0493 | [stage-13.md:88](stage-13.md#L88) | bucket | V-05 | REWRITE | note + manual Continue exist; auto-continue and profile split missing |
| F-0494 | [stage-13.md:89](stage-13.md#L89) | bucket | V-06 | REWRITE | schema checks exist for UI blocks/compaction; no reask, no enum/refusal/max_tokens rules |
| F-0495 | [stage-13.md:90](stage-13.md#L90) | bucket | V-07 | NEW-BUILD | `retract` event, withdrawn card, fixed trigger list |
| F-0496 | [stage-13.md:91](stage-13.md#L91) | bucket | V-08 | NEW-BUILD | deterministic + Flash-Lite completion check (with AO-10) |
| F-0497 | [stage-13.md:92](stage-13.md#L92) | bucket | V-09 | REWRITE | structural gate exists (codeExecutionExecutor.ts:401-417); render/recalc/strict/allowlist/ECharts missing |
| F-0498 | [stage-13.md:93](stage-13.md#L93) | bucket | V-10 | NEW-BUILD | typed-values envelope + reconciliation |
| F-0499 | [stage-13.md:94](stage-13.md#L94) | bucket | V-11 | NEW-BUILD | log-only language check (answerLang.ts is display only) |
| F-0500 | [stage-13.md:95](stage-13.md#L95) | bucket | V-12 | NEW-BUILD | canary + secret + tag scan on every final answer |
| F-0501 | [stage-13.md:96](stage-13.md#L96) | bucket | V-13 | NEW-BUILD | ~10 % sampled judge |
| F-0502 | [stage-13.md:97](stage-13.md#L97) | bucket | V-14 | NEW-BUILD | profile budgets (needs profiles, Stage 10 O-2) |
| F-0503 | [stage-13.md:98](stage-13.md#L98) | bucket | V-15 | REWRITE | gate exists in parts; add idempotency and malformed-call retry |
| F-0504 | [stage-13.md:99](stage-13.md#L99) | bucket | V-16 | NEW-BUILD | depends on Stage 12 registry |
| F-0505 | [stage-13.md:100](stage-13.md#L100) | bucket | V-17 | NEW-BUILD | depends on Stage 10 research |
| F-0506 | [stage-13.md:101](stage-13.md#L101) | bucket | V-18 | NEW-BUILD | recitation notice + regenerate offer |
| F-0507 | [stage-13.md:102](stage-13.md#L102) | bucket | V-19 | NEW-BUILD | `validation_result` table (shape: deferred file D-G3-01) |
| F-0508 | [stage-13.md:103](stage-13.md#L103) | bucket | V-20 | NEW-BUILD | server table cell-count log; client part under Stage 14 |
| F-0509 | [stage-13.md:104](stage-13.md#L104) | bucket | V-21 | REWRITE | one `en-IN` formatter for app-generated numbers/dates |
| F-0510 | [stage-13.md:105](stage-13.md#L105) | bucket | V-22 | KEEP | thinking not validated (generation.ts:910-924) |
| F-0511 | [stage-13.md:106](stage-13.md#L106) | bucket | V-23 | KEEP | no prefill (anthropic.ts:340-345) |
| F-0512 | [stage-13.md:107](stage-13.md#L107) | bucket | V-24 | REWRITE | retract + context reset; partial today stays visible |
| F-0513 | [stage-13.md:108](stage-13.md#L108) | bucket | V-25 | KEEP | no judge/structured call carries citations (none exist yet; keep the rule when built) |
| F-0514 | [stage-13.md:109](stage-13.md#L109) | bucket | V-26 | KEEP | `AnswerProtocolGuard` (answerProtocolGuard.ts:4-39) |
| F-0515 | [stage-13.md:155](stage-13.md#L155) | question |  |  | Q1. The VD-1 judge and VD-6 completion check run on Gemini 3.1 Flash-Lite; ADR-0055 / B-4 allow three models only (Gemini 3.8 Flash, Sonnet 5.5, Opus 5.5). Allow Flash-Lite for helper jobs (judge, completion, planner), or run them on Gemini 3.8 Flash (≈5× cost per check) until the policy is amended? |
| F-0516 | [stage-13.md:156](stage-13.md#L156) | question |  |  | Q2. Stage 8 TD-8 (ECharts JSON) versus the repo's Recharts-based display blocks: V-09's chart gate and Stage 14 RD-3 both assume ECharts JSON. Decide in the Stage 8 audit whether charts move to ECharts or the deviation is recorded. |
| F-0517 | [stage-13.md:157](stage-13.md#L157) | question |  |  | Q3. Retract keeps no text but the original must remain auditable: keep the withdrawn text server-side (hash + encrypted copy for support) or drop it entirely (ids/hashes only, as Stage 17 NO_CONTENT)? |
| F-0518 | [stage-13.md:163](stage-13.md#L163) | keep-check | V-22 |  | `generation.ts:910-916` (delta → guard), `:919-924` (thinking forwarded unguarded) — confirmed |
| F-0519 | [stage-13.md:164](stage-13.md#L164) | keep-check | V-23 |  | `anthropic.ts:340-345` (final message always `user`), `generation.ts:1113-1118` (retry as user text) — confirmed |
| F-0520 | [stage-13.md:165](stage-13.md#L165) | keep-check | V-25 |  | no judge/structured call exists (searched `output_config`, `responseSchema`, `json_schema` in `providers/*.ts` non-test: only `output_config.effort`) — confirmed — rule must be re-checked when the judge is built |
| F-0521 | [stage-13.md:166](stage-13.md#L166) | keep-check | V-26 |  | `answerProtocolGuard.ts:4-39`, `generation.ts:872, 910-916, 1027-1034` — confirmed |
| F-0522 | [stage-13.md:160](stage-13.md#L160) | keep-check | prose |  | (4 KEEP rows; all 4 re-opened = 100 %.) |
| F-0523 | [stage-13.md:171](stage-13.md#L171) | number | N-40 | DIFF | claim-judge share on Normal, structured reask 1 (Fast 0), auto-continue 1 (Normal/Deep), completion extra step 1, sampling ~10 %, judge latency ~2 s after done, Check Grounding 300 rpm (register l.45) — none of these exist in the repo |
| F-0524 | [stage-13.md:172](stage-13.md#L172) | number | N-74 | DIFF | max output tokens incl. thinking Fast 8,192 / Normal 16,384 / Deep 32,768 (register l.81) — `DEFAULT_MAX_OUTPUT_TOKENS` 64,000 (`config/numbers.ts:41`); `preferences.max_output_tokens` default 64000 (`schema.ts:100`) — Stage 7 owns the number; it determines how often `max_tokens` truncation (V-05) happens |

## Stage 14 (42)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0525 | [stage-14.md:83](stage-14.md#L83) | bucket | D-01 | DIFF-STACK | react-markdown/remark stack renders the same GFM on web; markdown-it is chosen for Android parity (Phase 6) |
| F-0526 | [stage-14.md:84](stage-14.md#L84) | bucket | D-02 | NEW-BUILD | termination of unfinished constructs while streaming |
| F-0527 | [stage-14.md:85](stage-14.md#L85) | bucket | D-03 | REWRITE | coalesce deltas (server flush 100 ms + client rAF) |
| F-0528 | [stage-14.md:86](stage-14.md#L86) | bucket | D-04 | KEEP | KaTeX with `throwOnError:false` (markdownPlugins.ts:41-44) |
| F-0529 | [stage-14.md:87](stage-14.md#L87) | bucket | D-05 | DIFF-STACK | Recharts vs ECharts JSON: library choice, but TD-8 is Stage 8's decision (owner question Q1 below; cross-reference corrected by the main session, AUDIT-LOG C-2) |
| F-0530 | [stage-14.md:88](stage-14.md#L88) | bucket | D-06 | NEW-BUILD | pdf.js + registry-driven highlight; depends on Stage 12 L-16 |
| F-0531 | [stage-14.md:89](stage-14.md#L89) | bucket | D-07 | REWRITE | `[web:n]` token and producer; card exists |
| F-0532 | [stage-14.md:90](stage-14.md#L90) | bucket | D-08 | KEEP | server-rendered rows (sheetPreview.ts:8-9) |
| F-0533 | [stage-14.md:91](stage-14.md#L91) | bucket | D-09 | REWRITE | audio+transcript, image zoom missing; DOCX/PPTX client renderers differ from LibreOffice→PDF but meet the outcome |
| F-0534 | [stage-14.md:92](stage-14.md#L92) | bucket | D-10 | NEW-BUILD | header CSP/COOP route + Report button; separate origin host is DIFF-INFRA |
| F-0535 | [stage-14.md:93](stage-14.md#L93) | bucket | D-11 | NEW-BUILD | render `renderedContent` (compliance) |
| F-0536 | [stage-14.md:94](stage-14.md#L94) | bucket | D-12 | NEW-BUILD | in-app notice for other-chat completion (with Stage 10 AO-7) |
| F-0537 | [stage-14.md:95](stage-14.md#L95) | bucket | D-13 | NEW-BUILD | virtualized transcript + cursor paging |
| F-0538 | [stage-14.md:96](stage-14.md#L96) | bucket | D-14 | REWRITE | self-host Devanagari, `word-break: normal` |
| F-0539 | [stage-14.md:97](stage-14.md#L97) | bucket | D-15 | DEFERRED | admin/ops consoles |
| F-0540 | [stage-14.md:98](stage-14.md#L98) | bucket | D-16 | DEFERRED | admin destructive actions |
| F-0541 | [stage-14.md:99](stage-14.md#L99) | bucket | D-17 | NEW-BUILD | with research mode |
| F-0542 | [stage-14.md:100](stage-14.md#L100) | bucket | D-18 | REWRITE | add copy-as-Markdown and CSV download |
| F-0543 | [stage-14.md:101](stage-14.md#L101) | bucket | D-19 | REWRITE | add wrap toggle and line numbers |
| F-0544 | [stage-14.md:102](stage-14.md#L102) | bucket | D-20 | KEEP | ToolActivity.tsx:278-300, App.tsx:1021-1051, share.ts:7 |
| F-0545 | [stage-14.md:103](stage-14.md#L103) | bucket | D-21 | KEEP | ToolActivity.tsx:55-82, workspace.tsx:529-566 |
| F-0546 | [stage-14.md:104](stage-14.md#L104) | bucket | D-22 | REWRITE | transcript `role=log`, announce-on-done, per-message lang |
| F-0547 | [stage-14.md:105](stage-14.md#L105) | bucket | D-23 | REWRITE | X-Robots-Tag on the HTML, drop `/s/` from robots.txt, generic OG, print CSS, hide grounded answers, Report link |
| F-0548 | [stage-14.md:106](stage-14.md#L106) | bucket | D-24 | NEW-BUILD | verify note, weak marks, retract card, recitation notice (cut-short already exists) |
| F-0549 | [stage-14.md:107](stage-14.md#L107) | bucket | D-25 | KEEP | Panels.tsx:446-483, artifacts.ts:2-9 |
| F-0550 | [stage-14.md:108](stage-14.md#L108) | bucket | D-26 | REWRITE | event contract on the durable store (`ping`, `snapshot`, `Last-Event-ID`, send timeout); store itself = Stage 10 AO-4b |
| F-0551 | [stage-14.md:109](stage-14.md#L109) | bucket | D-27 | KEEP | 15 s keep-alive frame in every stream (chats.ts:813-815) |
| F-0552 | [stage-14.md:110](stage-14.md#L110) | bucket | D-28 | KEEP | chats.ts:802-809 |
| F-0553 | [stage-14.md:111](stage-14.md#L111) | bucket | D-29 | NEW-BUILD | 60 s session re-check inside the stream |
| F-0554 | [stage-14.md:112](stage-14.md#L112) | bucket | D-30 | DIFF-INFRA | domains/hosting (ADR-0060) |
| F-0555 | [stage-14.md:113](stage-14.md#L113) | bucket | D-31 | NEW-BUILD | Android client, Phase 6 |
| F-0556 | [stage-14.md:162](stage-14.md#L162) | question |  |  | Q1. Charts: Stage 14 RD-3 / Stage 8 TD-8 lock ECharts JSON; the repo draws Recharts blocks with its own zod schema. Rewrite to ECharts JSON now (needed for the Android adapter and the VD-7 chart gate) or record Recharts as an owner deviation until Phase 6? |
| F-0557 | [stage-14.md:163](stage-14.md#L163) | question |  |  | Q2. Markdown parser: switch the web to markdown-it now (shared with the future Android renderer) or keep react-markdown until Phase 6? (Both meet the web outcome; only parity with Android differs.) |
| F-0558 | [stage-14.md:164](stage-14.md#L164) | question |  |  | Q3. The user-content origin is `usercontent.arcnave.tech` (a different registrable domain from `arcnave.in`, by owner decision 2026-10-06). Confirm this stays when the frontend hosting question (ADR-0060, Cloudflare vs Google-only) is decided, because the CSP `frame-ancestors` value depends on it. |
| F-0559 | [stage-14.md:165](stage-14.md#L165) | question |  |  | Q4. Stage 14's SSE contract names `POST /v1/turns` + `GET /v1/turns/{id}/events`; the repo exposes `POST /chats/:id/generate` + `GET /chats/:id/stream`. Keep the chat-scoped URLs (outcome identical) or rename with the Stage 5 audit? |
| F-0560 | [stage-14.md:171](stage-14.md#L171) | keep-check | D-27 |  | `chats.ts:813-815` interval 15,000 ms writes `: heartbeat`; `adapter.ts:272-290` ignores it — confirmed (keep-alive bytes present; not a named `ping` event — carried in D-26) |
| F-0561 | [stage-14.md:172](stage-14.md#L172) | keep-check | D-08 |  | `services/documents/sheetPreview.ts:8-9` (200 rows × 50 cols), `FilePreviews.tsx:75-99` — confirmed; N-41 row limit has no register value |
| F-0562 | [stage-14.md:173](stage-14.md#L173) | keep-check | D-20 |  | `ToolActivity.tsx:281-300`, `App.tsx:1051` (`m.thinking &&` hides empty), `share.ts:7` — confirmed |
| F-0563 | [stage-14.md:168](stage-14.md#L168) | keep-check | prose |  | (7 KEEP rows; 3 re-opened = 43 %.) |
| F-0564 | [stage-14.md:178](stage-14.md#L178) | number | N-24 | DIFF | SSE ping 15 s; Redis stream retention ~15 min after done (l.29) — ping 15,000 ms (`chats.ts:815`) = same; finished run replayable 5 min (`runHub.ts:20`) vs 15 min |
| F-0565 | [stage-14.md:179](stage-14.md#L179) | number | N-41 | DIFF | delta coalesce ~50–100 ms; spreadsheet preview rows; artifact preview URL TTL; chat page size; max formulas per message (l.46) — no coalescing (`workspace.tsx:498-506`); preview 200 rows × 50 cols (`sheetPreview.ts:8-9`); preview URL TTL none; conversation list page via `limit` (default not read), transcript not paged |
| F-0566 | [stage-14.md:180](stage-14.md#L180) | number | N-73 | DIFF | runner delta flush 100 ms; relay poll 250 ms; stream events kept 15 min; Redis `MAXLEN ~` 10,000; session re-check 60 s; turn lease 30 s / heartbeat 10 s (l.80) — buffer 50,000 events in memory (`runHub.ts:17`); no flush interval; no relay poll; retention 5 min; no re-check; no lease |

## Stage 15 (61)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0567 | [stage-15.md:133](stage-15.md#L133) | bucket | ER-1a | KEEP | `maxRetries: 0` plus test |
| F-0568 | [stage-15.md:134](stage-15.md#L134) | bucket | ER-1b | REWRITE | no explicit retry-off, own client or guard test on the Gemini client |
| F-0569 | [stage-15.md:135](stage-15.md#L135) | bucket | ER-2a | KEEP | cap of 2 from register, tested |
| F-0570 | [stage-15.md:136](stage-15.md#L136) | bucket | ER-2b | REWRITE | gate ignores thinking/tool events; a failure in tool round 2 re-runs round 1 tools |
| F-0571 | [stage-15.md:137](stage-15.md#L137) | bucket | ER-2c | KEEP | formula and caps match N-42 |
| F-0572 | [stage-15.md:138](stage-15.md#L138) | bucket | ER-2d | KEEP | honoured <= 10 s, longer fails the turn (fallback is its own row) |
| F-0573 | [stage-15.md:139](stage-15.md#L139) | bucket | ER-2e | REWRITE | Gemini transient set by text match; misses 502/408/409 |
| F-0574 | [stage-15.md:140](stage-15.md#L140) | bucket | ER-2f | REWRITE | no `blocked`; Gemini safety finishes not classified |
| F-0575 | [stage-15.md:141](stage-15.md#L141) | bucket | ER-2g | REWRITE | no quota-0, credentials/config split, `claude_limit` skip semantics |
| F-0576 | [stage-15.md:142](stage-15.md#L142) | bucket | ER-2h | REWRITE | Claude mid-stream error events unclassified |
| F-0577 | [stage-15.md:143](stage-15.md#L143) | bucket | ER-3a | KEEP | no retry after a text delta |
| F-0578 | [stage-15.md:144](stage-15.md#L144) | bucket | ER-3b | NEW-BUILD | no continuation attempt exists |
| F-0579 | [stage-15.md:145](stage-15.md#L145) | bucket | ER-3c | REWRITE | partial kept but state `error`, no `interrupted`, no Continue for failures |
| F-0580 | [stage-15.md:146](stage-15.md#L146) | bucket | ER-3d | REWRITE | no `blocked`/`max_tokens`/`other` mapping, no no-finish-reason rule |
| F-0581 | [stage-15.md:147](stage-15.md#L147) | bucket | ER-3e | DEFERRED | needs Executor checkpoints |
| F-0582 | [stage-15.md:148](stage-15.md#L148) | bucket | ER-4a | REWRITE | no first-token timer (ADR-0024 conflict) |
| F-0583 | [stage-15.md:149](stage-15.md#L149) | bucket | ER-4b | REWRITE | no stall timer |
| F-0584 | [stage-15.md:150](stage-15.md#L150) | bucket | ER-4c | REWRITE | only fetch_url and sandbox have timers; values not from config |
| F-0585 | [stage-15.md:151](stage-15.md#L151) | bucket | ER-4d | REWRITE | 59 min vs 10 min (owner question Q3) |
| F-0586 | [stage-15.md:152](stage-15.md#L152) | bucket | ER-4e | DIFF-INFRA | Cloud Run/Executor deadline mechanics |
| F-0587 | [stage-15.md:153](stage-15.md#L153) | bucket | ER-4f | NEW-BUILD | needs fallback chain |
| F-0588 | [stage-15.md:154](stage-15.md#L154) | bucket | ER-5 | DEFERRED | Redis |
| F-0589 | [stage-15.md:155](stage-15.md#L155) | bucket | ER-6a | REWRITE | no timeouts, retry or 53300 mapping |
| F-0590 | [stage-15.md:156](stage-15.md#L156) | bucket | ER-6b | DEFERRED | per-role pools |
| F-0591 | [stage-15.md:157](stage-15.md#L157) | bucket | ER-7 | DEFERRED | Cloud Tasks |
| F-0592 | [stage-15.md:158](stage-15.md#L158) | bucket | ER-8a | REWRITE | dispatcher does not convert throws into `is_error` |
| F-0593 | [stage-15.md:159](stage-15.md#L159) | bucket | ER-8b | REWRITE | no read-tool retry |
| F-0594 | [stage-15.md:160](stage-15.md#L160) | bucket | ER-8c | REWRITE | sandbox timeout throws instead of returning `TOOL_FAILED` + partial stdout (to verify at build) |
| F-0595 | [stage-15.md:161](stage-15.md#L161) | bucket | ER-9 | REWRITE | free-text upload error, no taxonomy codes or Retry/Remove |
| F-0596 | [stage-15.md:162](stage-15.md#L162) | bucket | ER-10a | REWRITE | 8 attempts, no jitter, no banner, no foreground refetch |
| F-0597 | [stage-15.md:163](stage-15.md#L163) | bucket | ER-10b | KEEP | replay by sequence id in server and client |
| F-0598 | [stage-15.md:164](stage-15.md#L164) | bucket | ER-10c | REWRITE | client never sends Idempotency-Key on generate |
| F-0599 | [stage-15.md:165](stage-15.md#L165) | bucket | ER-10d | DIFF-INFRA | storage-side resumable uploads; not verified here |
| F-0600 | [stage-15.md:166](stage-15.md#L166) | bucket | ER-11 | REWRITE | wire shape differs (options in section 4) |
| F-0601 | [stage-15.md:167](stage-15.md#L167) | bucket | ER-12a | REWRITE | copy exists; support code, reset time, labelled switch missing |
| F-0602 | [stage-15.md:168](stage-15.md#L168) | bucket | ER-12b | NEW-BUILD | no banner flag or status page |
| F-0603 | [stage-15.md:169](stage-15.md#L169) | bucket | ER-13 | NEW-BUILD | no breaker, kill switch or retry budget |
| F-0604 | [stage-15.md:170](stage-15.md#L170) | bucket | ER-14a | NEW-BUILD | no fallback chain |
| F-0605 | [stage-15.md:171](stage-15.md#L171) | bucket | ER-14b | NEW-BUILD | capability stripping on switch does not exist |
| F-0606 | [stage-15.md:172](stage-15.md#L172) | bucket | ER-14c | DEFERRED | Later (not built anywhere) - counted under DEFERRED |
| F-0607 | [stage-15.md:173](stage-15.md#L173) | bucket | ER-15 | DEFERRED | chaos tests need LV-1 / infra |
| F-0608 | [stage-15.md:174](stage-15.md#L174) | bucket | AL-1 | REWRITE | partial usage lost on failure |
| F-0609 | [stage-15.md:175](stage-15.md#L175) | bucket | AL-2 | REWRITE | refusal category not in ledger |
| F-0610 | [stage-15.md:176](stage-15.md#L176) | bucket | AL-3 | KEEP | reservation before the call, release after |
| F-0611 | [stage-15.md:177](stage-15.md#L177) | bucket | AL-4 | REWRITE | covered in the ER-3d change (`other` + warn) |
| F-0612 | [stage-15.md:178](stage-15.md#L178) | bucket | AL-5 | NEW-BUILD | no thinking-400 repair |
| F-0613 | [stage-15.md:179](stage-15.md#L179) | bucket | AL-6 | DEFERRED | Executor |
| F-0614 | [stage-15.md:180](stage-15.md#L180) | bucket | DS-1 | DIFF-STACK | Python GAPIC clients only; Node storage client defaults not audited |
| F-0615 | [stage-15.md:181](stage-15.md#L181) | bucket | DS-2 | n/a | Document AI is not used in the repo; Stage 9 audit decides |
| F-0616 | [stage-15.md:182](stage-15.md#L182) | bucket | DS-3 | NEW-BUILD | arrives with the Gemini explicit cache (Stage 18) |
| F-0617 | [stage-15.md:183](stage-15.md#L183) | bucket | DS-4 | KEEP | Stop aborts the controller; adapters stop the stream |
| F-0618 | [stage-15.md:297](stage-15.md#L297) | question |  |  | Q1. ADR-0024 / ADR-0054 keep "no first-token cutoff" and "no stall timer"; ER-4a/4b lock 20/45/90 s and 30 s. Build the timers (Option A) or approve a deviation ADR? Fact for the decision: Gemini now streams thought summaries, so the 2026-09 failure (silence while thinking) no longer applies the same way. |
| F-0619 | [stage-15.md:298](stage-15.md#L298) | question |  |  | Q2. Fallback chain: which model follows which (Stage 7 7.12), and does the owner accept a labelled switch under Invariant 1? B-4 / ADR-0055 ("three models only") conflicts with the Haiku 5.5 router (ADR-0013, N-69) and Haiku worker jobs (ADR-0014); not resolved here. |
| F-0620 | [stage-15.md:299](stage-15.md#L299) | question |  |  | Q3. Turn deadline 10 min (N-43/N-06) vs 59 min kept for scanned-PDF extraction turns (ADR-0054 matrix): which wins until a long-task path exists? |
| F-0621 | [stage-15.md:300](stage-15.md#L300) | question |  |  | Q4. run_code time: N-08 60 s (Deep 120 s) vs repo 300 s on the warm sandbox (ADR-0010: OCR and renders take minutes). |
| F-0622 | [stage-15.md:301](stage-15.md#L301) | question |  |  | Q5. CLAUDE.md Invariant 3 ("no estimator") vs OD-13 `usage_source='estimated'` with a tokenizer estimate: accept `partial` (provider-reported only) as the locked outcome, or amend the invariant? |
| F-0623 | [stage-15.md:302](stage-15.md#L302) | question |  |  | Q6. ADR-0056 keeps passwords beside Google sign-in; SD-1 revised (2026-10-09) removes passwords and makes sign-in invite-only. Affects ER-12 copy and `weak_password`, `invalid_credentials` codes (see stage-16.md Q-S1). |
| F-0624 | [stage-15.md:307](stage-15.md#L307) | keep-check |  |  | ER-1a: `providers/anthropic.ts:48-54` shows `maxRetries: 0` and the timeout from config; test `anthropic.firstParty.test.ts:19-21` asserts `client.maxRetries` is 0 - confirmed. |
| F-0625 | [stage-15.md:308](stage-15.md#L308) | keep-check |  |  | ER-2c: `services/generation.ts:2343-2353` computes `ceiling = min(8000, 1000 * 2^(attempt-1))`, `backoff = random * ceiling`, and `max(backoff, retryAfter)`; a Retry-After above 10,000 ms returns null (:2349) - confirmed. Note: the locked text says Retry-After above the cap goes "straight to fallback"; with no fallback the turn fails (fallback is ER-14a). |
| F-0626 | [stage-15.md:309](stage-15.md#L309) | keep-check |  |  | Not re-opened: ER-2a, ER-2d, ER-3a, ER-10b, AL-3, DS-4 (read once during the audit). |
| F-0627 | [stage-15.md:306](stage-15.md#L306) | keep-check | prose |  | 8 KEEP rows, 2 re-opened (>= 10 %): |

## Stage 16 (58)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0628 | [stage-16.md:107](stage-16.md#L107) | bucket | SD-1a | NEW-BUILD | e-mail code/link sign-in absent; provisional until owner Q-S1 |
| F-0629 | [stage-16.md:108](stage-16.md#L108) | bucket | SD-1b | REWRITE | no idle expiry, rotation or replay detection |
| F-0630 | [stage-16.md:109](stage-16.md#L109) | bucket | SD-1c | DEFERRED | roles/TOTP |
| F-0631 | [stage-16.md:110](stage-16.md#L110) | bucket | SD-1d | REWRITE | service method exists, no route |
| F-0632 | [stage-16.md:111](stage-16.md#L111) | bucket | SD-1e1 | KEEP | httpOnly + secure + signed |
| F-0633 | [stage-16.md:112](stage-16.md#L112) | bucket | SD-1e2 | DIFF-INFRA | Lax needs web and API on one site |
| F-0634 | [stage-16.md:113](stage-16.md#L113) | bucket | SD-1f | REWRITE | no CSRF/Origin check; two body-less POSTs exposed |
| F-0635 | [stage-16.md:114](stage-16.md#L114) | bucket | SD-1g | REWRITE | no per-account throttle |
| F-0636 | [stage-16.md:115](stage-16.md#L115) | bucket | SD-1h | KEEP | 256-bit token, hash at rest |
| F-0637 | [stage-16.md:116](stage-16.md#L116) | bucket | SD-2a | KEEP | library verification with audience |
| F-0638 | [stage-16.md:117](stage-16.md#L117) | bucket | SD-2b | REWRITE | `sub` not stored or used |
| F-0639 | [stage-16.md:118](stage-16.md#L118) | bucket | SD-2c | DEFERRED | company |
| F-0640 | [stage-16.md:119](stage-16.md#L119) | bucket | SD-3 | DEFERRED | Phase 5 per ADR-0056 |
| F-0641 | [stage-16.md:120](stage-16.md#L120) | bucket | SD-4 | DEFERRED | RLS |
| F-0642 | [stage-16.md:121](stage-16.md#L121) | bucket | SD-5 | DEFERRED | Later |
| F-0643 | [stage-16.md:122](stage-16.md#L122) | bucket | SD-6a | DIFF-INFRA | Artifact Analysis / Binary Authorization |
| F-0644 | [stage-16.md:123](stage-16.md#L123) | bucket | SD-6b | NEW-BUILD | CI has no security gates |
| F-0645 | [stage-16.md:124](stage-16.md#L124) | bucket | SD-6c | REWRITE | sandbox pip installs unpinned |
| F-0646 | [stage-16.md:125](stage-16.md#L125) | bucket | PH-1 | DIFF-INFRA | Terraform-managed controls |
| F-0647 | [stage-16.md:126](stage-16.md#L126) | bucket | PH-2 | REWRITE | headers incomplete on web and API |
| F-0648 | [stage-16.md:127](stage-16.md#L127) | bucket | PH-3 | KEEP | redaction list + no secrets in image |
| F-0649 | [stage-16.md:128](stage-16.md#L128) | bucket | PH-4 | REWRITE | credential default and project-bearing URL in code; no guard test |
| F-0650 | [stage-16.md:129](stage-16.md#L129) | bucket | PH-5 | DEFERRED | owner ADR-0054 #6 moves WIF to Phase 5 |
| F-0651 | [stage-16.md:130](stage-16.md#L130) | bucket | FL-1 | NEW-BUILD | no scanner or quarantine |
| F-0652 | [stage-16.md:131](stage-16.md#L131) | bucket | FL-2 | NEW-BUILD | no ZIP containment |
| F-0653 | [stage-16.md:132](stage-16.md#L132) | bucket | FL-3 | NEW-BUILD | no PDF/image sanitising |
| F-0654 | [stage-16.md:133](stage-16.md#L133) | bucket | FL-4 | REWRITE | LibreOffice macro level not configured |
| F-0655 | [stage-16.md:134](stage-16.md#L134) | bucket | FL-5 | REWRITE | legacy formats accepted |
| F-0656 | [stage-16.md:135](stage-16.md#L135) | bucket | SD-7 | NEW-BUILD | no M9 (conflicts with "three models only": Q-S3) |
| F-0657 | [stage-16.md:136](stage-16.md#L136) | bucket | SD-8 | DEFERRED | shadow trial |
| F-0658 | [stage-16.md:137](stage-16.md#L137) | bucket | SD-9a | REWRITE | explicit Gemini thresholds absent |
| F-0659 | [stage-16.md:138](stage-16.md#L138) | bucket | SD-9b | NEW-BUILD | needs fallback chain + M9 |
| F-0660 | [stage-16.md:139](stage-16.md#L139) | bucket | SD-10 | REWRITE | prompt-only; categories/actions table and rules layer missing |
| F-0661 | [stage-16.md:140](stage-16.md#L140) | bucket | INJ-1 | KEEP | `<trust_boundaries>` + tests |
| F-0662 | [stage-16.md:141](stage-16.md#L141) | bucket | INJ-2 | REWRITE | no app CSP; third-party image cards |
| F-0663 | [stage-16.md:142](stage-16.md#L142) | bucket | INJ-3 | NEW-BUILD | no memory provenance/tombstones |
| F-0664 | [stage-16.md:143](stage-16.md#L143) | bucket | INJ-4 | NEW-BUILD | no per-tool caps / approval slot |
| F-0665 | [stage-16.md:144](stage-16.md#L144) | bucket | INJ-5 | KEEP | retrieval scoped to the owner's project (single-user) |
| F-0666 | [stage-16.md:145](stage-16.md#L145) | bucket | INJ-6 | NEW-BUILD | no canary |
| F-0667 | [stage-16.md:146](stage-16.md#L146) | bucket | INJ-7 | REWRITE | SSRF filter bypasses (IPv6, DNS, redirects) |
| F-0668 | [stage-16.md:147](stage-16.md#L147) | bucket | SD-11 | NEW-BUILD | only two ad-hoc scenarios |
| F-0669 | [stage-16.md:148](stage-16.md#L148) | bucket | AB-1 | NEW-BUILD | no crisis detector or India helplines |
| F-0670 | [stage-16.md:149](stage-16.md#L149) | bucket | AB-2 | DEFERRED | admin/company |
| F-0671 | [stage-16.md:150](stage-16.md#L150) | bucket | SD-12 | DEFERRED | ops runbooks |
| F-0672 | [stage-16.md:151](stage-16.md#L151) | bucket | SD-13 | DEFERRED | legal hold |
| F-0673 | [stage-16.md:152](stage-16.md#L152) | bucket | SD-14 | DEFERRED | legal/text |
| F-0674 | [stage-16.md:153](stage-16.md#L153) | bucket | SD-15 | DEFERRED | Later |
| F-0675 | [stage-16.md:154](stage-16.md#L154) | bucket | SB-1 | KEEP | ADR-0007 implemented (verified live per ADR) |
| F-0676 | [stage-16.md:217](stage-16.md#L217) | question |  |  | Q-S1. ADR-0056 keeps e-mail/password beside Google sign-in; SD-1 (revised 2026-10-09, ADR-0010) removes passwords and makes sign-in invite-only. Which governs? Decides SD-1a, SD-1g, the `weak_password` / `password_incorrect` / `invalid_credentials` codes, account deletion by password (ADR-0040) and the Google-only deletion gap named in ADR-0056. |
| F-0677 | [stage-16.md:218](stage-16.md#L218) | question |  |  | Q-S2. Claude identity: ADR-0054 #6 uses an API key for the prototype (WIF in Phase 5); ADR-0012 (locked) has no key anywhere. Treated as DEFERRED (owner decision); confirm it stays out of the plan. |
| F-0678 | [stage-16.md:219](stage-16.md#L219) | question |  |  | Q-S3. M9 (SD-7) is a Gemini Flash-Lite call; ADR-0055 / B-4 say three models only. Same conflict class as the Haiku 5.5 router. Not resolved here. |
| F-0679 | [stage-16.md:220](stage-16.md#L220) | question |  |  | Q-S4. SameSite=None is a hosting consequence (web on Cloudflare, API on Cloud Run). Until web and API share a site, CSRF rests on the Origin check (SD-1f). Move to one site (DIFF-INFRA) before Phase 5? |
| F-0680 | [stage-16.md:221](stage-16.md#L221) | question |  |  | Q-S5. Session length: register N-49 user idle 24 h / absolute 28 d; repo 14 d absolute. Adopt N-49 as written? |
| F-0681 | [stage-16.md:222](stage-16.md#L222) | question |  |  | Q-S6. New dependencies: image re-encode (FL-3), ClamAV client, CSRF/helmet helpers need owner approval against the pinned-stack list (checkpoint 00-checkpoint-stage20.md, not re-read here). |
| F-0682 | [stage-16.md:227](stage-16.md#L227) | keep-check |  |  | SD-1e1: `routes/auth.ts:36-43` sets `httpOnly: true`, `secure: cfg.SESSION_COOKIE_SECURE`, `signed: true`; `config.ts:431-433` refuses production boot without Secure - confirmed. |
| F-0683 | [stage-16.md:228](stage-16.md#L228) | keep-check |  |  | SB-1: `docs/decisions/0007-sandbox-no-general-egress.md:52-68` states the deployed warm service has no NAT and a deny-all egress firewall and was probed live on 2026-09-25; the Cloud Run Job engine still has open egress and `SANDBOX_ENGINE=auto` could select it (`config.ts:242`) - confirmed as KEEP for the production engine, with that caveat (a deployment must set `SANDBOX_ENGINE=warm`). |
| F-0684 | [stage-16.md:229](stage-16.md#L229) | keep-check |  |  | Not re-opened: SD-1h, SD-2a, PH-3, INJ-1, INJ-5. |
| F-0685 | [stage-16.md:226](stage-16.md#L226) | keep-check | prose |  | 7 KEEP rows, 1 re-opened (>= 10 %), plus one extra: |

## Stage 17 (39)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0686 | [stage-17.md:78](stage-17.md#L78) | bucket | OD-1a | DIFF-STACK | pino JSON replaces Python JSON logging; outcome met |
| F-0687 | [stage-17.md:79](stage-17.md#L79) | bucket | OD-1b | DEFERRED | OTel |
| F-0688 | [stage-17.md:80](stage-17.md#L80) | bucket | OD-2a | DEFERRED | NO_CONTENT enforce |
| F-0689 | [stage-17.md:81](stage-17.md#L81) | bucket | OD-2b | REWRITE | three GET routes put search text in the URL |
| F-0690 | [stage-17.md:82](stage-17.md#L82) | bucket | OD-2c | KEEP | shadow test exists and passes the happy path |
| F-0691 | [stage-17.md:83](stage-17.md#L83) | bucket | OD-3 | DEFERRED | pseudonymisation |
| F-0692 | [stage-17.md:84](stage-17.md#L84) | bucket | OD-4 | DEFERRED | sampling |
| F-0693 | [stage-17.md:85](stage-17.md#L85) | bucket | OD-5 | DEFERRED | log buckets/retention |
| F-0694 | [stage-17.md:86](stage-17.md#L86) | bucket | OD-6 | DEFERRED | audit_event |
| F-0695 | [stage-17.md:87](stage-17.md#L87) | bucket | OD-7 | DEFERRED | metrics |
| F-0696 | [stage-17.md:88](stage-17.md#L88) | bucket | OD-8 | REWRITE | name and store the four clocks; two exist as log fields |
| F-0697 | [stage-17.md:89](stage-17.md#L89) | bucket | OD-9 | DEFERRED | SLO/alerts |
| F-0698 | [stage-17.md:90](stage-17.md#L90) | bucket | OD-10 | DEFERRED | notifications |
| F-0699 | [stage-17.md:91](stage-17.md#L91) | bucket | OD-11 | DEFERRED | status page |
| F-0700 | [stage-17.md:92](stage-17.md#L92) | bucket | OD-12a | DEFERRED | billing export reconciliation |
| F-0701 | [stage-17.md:93](stage-17.md#L93) | bucket | OD-12b | SUPERSEDED (no bucket) | Claude left Vertex |
| F-0702 | [stage-17.md:94](stage-17.md#L94) | bucket | OD-13 | REWRITE | per-call usage capture and ledger columns missing |
| F-0703 | [stage-17.md:95](stage-17.md#L95) | bucket | OD-14 | KEEP | no managed online eval used |
| F-0704 | [stage-17.md:96](stage-17.md#L96) | bucket | OD-15a | KEEP | no third-party client telemetry |
| F-0705 | [stage-17.md:97](stage-17.md#L97) | bucket | OD-15b | NEW-BUILD | no `/telemetry` endpoint |
| F-0706 | [stage-17.md:98](stage-17.md#L98) | bucket | OD-16 | DEFERRED | dashboards |
| F-0707 | [stage-17.md:99](stage-17.md#L99) | bucket | OD-17 | DEFERRED | load tools |
| F-0708 | [stage-17.md:100](stage-17.md#L100) | bucket | OD-18 | DEFERRED | lawyer position |
| F-0709 | [stage-17.md:101](stage-17.md#L101) | bucket | AL-1 | DEFERRED | DB/Redis flags |
| F-0710 | [stage-17.md:102](stage-17.md#L102) | bucket | AL-2 | KEEP | central handler logs class + code + request id only |
| F-0711 | [stage-17.md:103](stage-17.md#L103) | bucket | AL-3 | DEFERRED | audit failure behaviour |
| F-0712 | [stage-17.md:104](stage-17.md#L104) | bucket | LG-1 | NEW-BUILD | no per-attempt `model_call` line |
| F-0713 | [stage-17.md:105](stage-17.md#L105) | bucket | LG-2 | NEW-BUILD | no gateway event lines |
| F-0714 | [stage-17.md:106](stage-17.md#L106) | bucket | LG-3 | REWRITE | `turn timing` replaced by coded, allowlisted turn lines |
| F-0715 | [stage-17.md:107](stage-17.md#L107) | bucket | LG-4 | DIFF-STACK | Python SDK loggers; Node SDK log level to confirm |
| F-0716 | [stage-17.md:108](stage-17.md#L108) | bucket | TL-1 | DEFERRED | `turn_logs` stays until Phase 5 (owner ADR-0053 #7) |
| F-0717 | [stage-17.md:109](stage-17.md#L109) | bucket | DS-C1 | DEFERRED | telemetry fields |
| F-0718 | [stage-17.md:140](stage-17.md#L140) | question |  |  | Q-O1. OD-13 says on error/timeout `usage_source='estimated'` with a tokenizer estimate; CLAUDE.md Invariant 3 says there is no estimator in this codebase. Proposal: record provider-reported partial usage as `partial` and never estimate. Accept? |
| F-0719 | [stage-17.md:141](stage-17.md#L141) | question |  |  | Q-O2. `turn_logs` (ADR-0050) keeps the full user message, reply, tool inputs/results and an error stack; the owner wants it kept until Phase 5 (ADR-0053 #7). Confirm that this holds for any account that is not the owner's own test account once a second user exists. |
| F-0720 | [stage-17.md:142](stage-17.md#L142) | question |  |  | Q-O3. OD-2b changes three list-route shapes now (DF-2). Do now or at the Phase 5 enforce task? |
| F-0721 | [stage-17.md:147](stage-17.md#L147) | keep-check |  |  | OD-2c: `test/contentLeak.test.ts:155-166` runs a whole turn, asserts the sentinels reached the provider (:159-161), that lines were captured (:163), and that no line contains one (:165) - confirmed; limits stated :12-23. |
| F-0722 | [stage-17.md:148](stage-17.md#L148) | keep-check |  |  | AL-2: `app.ts:172-186` logs `...errorLogFields(error)` and request id, method, route, status, never `err`; `errorLog.ts:47-65` reads only class names and identifier-shaped codes - confirmed. Other `{ err }` sites remain (evidence-g4.md (c)); they belong to DF-1, not to this row. |
| F-0723 | [stage-17.md:149](stage-17.md#L149) | keep-check |  |  | Not re-opened: OD-14, OD-15a (absence checks by search). |
| F-0724 | [stage-17.md:146](stage-17.md#L146) | keep-check | prose |  | 4 KEEP rows, 2 re-opened (> 10 %): |

## Stage 18 (48)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0725 | [stage-18.md:56](stage-18.md#L56) | bucket | PB-1 | n/a | planning basis, no repo surface |
| F-0726 | [stage-18.md:57](stage-18.md#L57) | bucket | PB-2 | n/a | parked by FD-21 |
| F-0727 | [stage-18.md:58](stage-18.md#L58) | bucket | PB-3 | DIFF-INFRA | cloud cost decisions, Terraform side |
| F-0728 | [stage-18.md:59](stage-18.md#L59) | bucket | FD-35 | KEEP | first-party client in place |
| F-0729 | [stage-18.md:60](stage-18.md#L60) | bucket | FD-08 / FD-10-L1 | REWRITE | reserve in rupees per turn using the price book; add the daily ceiling |
| F-0730 | [stage-18.md:61](stage-18.md#L61) | bucket | FD-09-L7 | REWRITE | Auto routes attachment, research and long-project turns to Opus |
| F-0731 | [stage-18.md:62](stage-18.md#L62) | bucket | POOL | DEFERRED | company pools and quotas (per-user token budgets remain, owner ADR-0053 #6) |
| F-0732 | [stage-18.md:63](stage-18.md#L63) | bucket | FD-10-L23 | DEFERRED | Terraform budgets and caps |
| F-0733 | [stage-18.md:64](stage-18.md#L64) | bucket | FD-10-L4 | NEW-BUILD | no kill switch |
| F-0734 | [stage-18.md:65](stage-18.md#L65) | bucket | CD-1 | NEW-BUILD | price book as dated code rows; env JSON stays until the switch |
| F-0735 | [stage-18.md:66](stage-18.md#L66) | bucket | LED-1 | REWRITE | money in doubles |
| F-0736 | [stage-18.md:67](stage-18.md#L67) | bucket | N-37 | KEEP | planning 88 constant matches |
| F-0737 | [stage-18.md:68](stage-18.md#L68) | bucket | CD-5 / FD-25 | KEEP | no padding; cache not assumed in cost |
| F-0738 | [stage-18.md:69](stage-18.md#L69) | bucket | FD-26 | NEW-BUILD | Gemini explicit cache absent |
| F-0739 | [stage-18.md:70](stage-18.md#L70) | bucket | N-74c | REWRITE | two breakpoints instead of system-prompt only |
| F-0740 | [stage-18.md:71](stage-18.md#L71) | bucket | OPS | DEFERRED | targets, review job, drift |
| F-0741 | [stage-18.md:72](stage-18.md#L72) | bucket | ROUTER | OWNER-Q (no bucket) | conflicts with three-models decision |
| F-0742 | [stage-18.md:73](stage-18.md#L73) | bucket | WORK | DEFERRED | company attribution in block 7 |
| F-0743 | [stage-18.md:81](stage-18.md#L81) | number | N-01 | DIFF | register: user 20 / company 300 / edge 600 req/min (:6, :71) — repo: generate 20 (`config/numbers.ts:65`); every other route 120 per user or IP per minute (`numbers.ts:67`, `app.ts:93-101`); company and edge limits absent |
| F-0744 | [stage-18.md:82](stage-18.md#L82) | number | N-02 | DIFF | register: message 32k chars (:71) — repo: prompt max 100,000 (`routes/chats.ts:543`) |
| F-0745 | [stage-18.md:83](stage-18.md#L83) | number | N-06 | DIFF | register: tool steps Fast 1-2 / Normal 5 / Deep 15; turn deadline 10 min (:11) — repo: 16 rounds (`numbers.ts:43`); 59 min (`numbers.ts:39`) |
| F-0746 | [stage-18.md:84](stage-18.md#L84) | number | N-07 | DIFF | register: per-turn tool caps 1-3-8 / 1-3-8 / 2-5-10 / 3-5-10 / 1-3-6 (:12) — repo: none; rounds only |
| F-0747 | [stage-18.md:85](stage-18.md#L85) | number | N-08 | DIFF | register: sandbox time 60 s (Deep 120) (:13, N-68 :75) — repo: 10 s on the Job path (`numbers.ts:51`), 300 s on the warm service (`:53`) |
| F-0748 | [stage-18.md:86](stage-18.md#L86) | number | N-09 | DIFF | register: tool result cap ~8k tokens + pagination (:14) — repo: 6,000 chars read file (`numbers.ts:45`), 30,000 chars run_python (`:47`) |
| F-0749 | [stage-18.md:87](stage-18.md#L87) | number | N-10 | DIFF | register: docs 100 MB, XLSX 50, images 20, audio 500 MB/3 h, ZIP 100 MB/20 files (:15) — repo: project files 30 MB (`numbers.ts:57`), chat attachment 500 MB for every type (`:59`), image 10 MB and 8000 px (`services/attachments/processUpload.ts:35-36`) |
| F-0750 | [stage-18.md:88](stage-18.md#L88) | number | N-24 | DIFF | register: SSE ping 15 s (:29) — repo: 15,000 ms literal without an N-id comment (`routes/chats.ts:814`) - same value |
| F-0751 | [stage-18.md:89](stage-18.md#L89) | number | N-33 | DIFF | register: soft delete 7 d, total <= 30 d (:38) — repo: purge 30 days after deletion (`numbers.ts:61`) |
| F-0752 | [stage-18.md:90](stage-18.md#L90) | number | N-36 | DIFF | register: dated price table (:41) — repo: env JSON, no rows committed (`config.ts:384`) |
| F-0753 | [stage-18.md:91](stage-18.md#L91) | number | N-37 | DIFF | register: Google monthly rate + FBIL; planning 88 (:42, :71) — repo: constant 88 (`numbers.ts:83`) - value same, source rule not built |
| F-0754 | [stage-18.md:92](stage-18.md#L92) | number | N-42 | DIFF | register: <= 2 retries, 1 s -> 2 s full jitter cap 8 s, Retry-After 10 s (:47) — repo: same (`numbers.ts:23-29`) - no difference |
| F-0755 | [stage-18.md:93](stage-18.md#L93) | number | N-43 | DIFF | register: first-token 20/45/90 s, stall 30 s, tools (2/2/20/10/60-120/1 s), turn 10 min (:48) — repo: none, none, only fetch 10 s, turn 59 min, request 600 s (`numbers.ts:35-39`, `webFetch.ts:41`) |
| F-0756 | [stage-18.md:94](stage-18.md#L94) | number | N-45 | DIFF | register: statement 5 s / lock 2 s / idle-in-tx 30 s / recycle 1,800 s / tx retry <= 2 (:50) — repo: none (`db/client.ts:36,52`) |
| F-0757 | [stage-18.md:95](stage-18.md#L95) | number | N-46 | DIFF | register: reconnect 1/2/4/8/16 s + jitter, 5 attempts (:51) — repo: 0/1/2/4/8/15/30/60 s, 8 attempts, no jitter (`arcnave-frontend/src/adapter.ts:163`) |
| F-0758 | [stage-18.md:96](stage-18.md#L96) | number | N-47 | DIFF | register: breaker 5 in 30 s or 50 % of 20 (:52) — repo: none |
| F-0759 | [stage-18.md:97](stage-18.md#L97) | number | N-49 | DIFF | register: access token 15 min, refresh rotation, user idle 24 h / absolute 28 d, owner/admin 24 h, re-auth 10 min (:54) — repo: absolute 336 h (`numbers.ts:73`), no idle, no rotation |
| F-0760 | [stage-18.md:98](stage-18.md#L98) | number | N-66 | DIFF | register: API pool 5 + overflow 5 (:73) — repo: `DB_POOL_MAX=10` (`numbers.ts:71`) |
| F-0761 | [stage-18.md:99](stage-18.md#L99) | number | N-72 | DIFF | register: e-mail code 6 digits / 10 min / 5 tries; limits 1 per 60 s, 5/h, 20/h per IP (:79) — repo: none; auth routes 10 per minute (`config.ts:369`) |
| F-0762 | [stage-18.md:100](stage-18.md#L100) | number | N-74 | DIFF | register: max output Fast 8,192 / Normal 16,384 / Deep 32,768; Claude cache system-prompt breakpoint only (:81) — repo: default 64,000, ceiling 128,000 (`numbers.ts:41`, `config.ts:157`); two cache breakpoints (`anthropic.ts:372,454`) |
| F-0763 | [stage-18.md:101](stage-18.md#L101) | number | N-18, N-11, N-19, N-20, N-29, N-30, N-57, N-61, N-63, N-64 | DIFF | register: company quotas, pool, drift, caps, ceiling — repo: not built (deferred or no code) |
| F-0764 | [stage-18.md:141](stage-18.md#L141) | question |  |  | Q-C1. FD-31/FD-36 put a Haiku 5.5 router call on every turn and ADR-0014 runs worker jobs on Haiku; ADR-0055 / B-4 say three models only. Not resolved here; blocks the Haiku price rows being active. |
| F-0765 | [stage-18.md:142](stage-18.md#L142) | question |  |  | Q-C2. N-74 "system-prompt breakpoint only" vs the repo's second (history) breakpoint (ADR-0054 Decision 1): accept the locked value, or approve a measured deviation? |
| F-0766 | [stage-18.md:143](stage-18.md#L143) | question |  |  | Q-C3. Per-user token budgets are the only cap (owner ADR-0053 #6); N-30 has a per-user 600-turn soft cap (warn 80 %) inside a pool, N-63 Rs 350/user/day ceiling. Keep token budgets, or add a rupee ceiling per user now (FD-08 option A)? |
| F-0767 | [stage-18.md:144](stage-18.md#L144) | question |  |  | Q-C4. Auto routing sends attachment and research turns to Opus 5.5 today (FD-09-L7 asks for the opposite). Change now, or wait for the Stage 7 profile router? |
| F-0768 | [stage-18.md:145](stage-18.md#L145) | question |  |  | Q-C5. Money columns: switch `cost_usd` / `cost_inr` from doubles to exact decimals now (existing rows convert), or only for new per-call rows? |
| F-0769 | [stage-18.md:150](stage-18.md#L150) | keep-check |  |  | FD-35: `providers/anthropic.ts:44-55` builds the first-party client from `ANTHROPIC_API_KEY`, `maxRetries: 0`, timeout from config; `config.ts:116-131` model ids default to the 5.5 names - confirmed. |
| F-0770 | [stage-18.md:151](stage-18.md#L151) | keep-check |  |  | CD-5 / FD-25: `providers/anthropic.ts:441-464` builds system blocks from the stable prefix with no padding; `ENABLE_PROMPT_CACHE` (`config.ts:300`); no cost figure assumes a cache share because there is no cost model with a cached-share parameter yet (that belongs to CD-1) - confirmed, with that caveat. |
| F-0771 | [stage-18.md:152](stage-18.md#L152) | keep-check |  |  | Not re-opened: N-37 (constant 88 read from `config/numbers.ts:83`). |
| F-0772 | [stage-18.md:149](stage-18.md#L149) | keep-check | prose |  | 3 KEEP rows, 2 re-opened (> 10 %): |

## Stage 19 (28)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0773 | [stage-19.md:68](stage-19.md#L68) | bucket | S19-01 (ID-1 / R11 region defaults) | REWRITE | Code defaults a sandbox location to `us-central1`; every service/bucket must be asia-south1 |
| F-0774 | [stage-19.md:69](stage-19.md#L69) | bucket | S19-02 (ID-2) | DIFF-INFRA | Nothing to build; policy decision only |
| F-0775 | [stage-19.md:70](stage-19.md#L70) | bucket | S19-03 (ID-4, DS19-J) | DIFF-STACK | postgres.js + URL/socket instead of Python connector + IAM login; IAM login deferred, pool total matches N-66 |
| F-0776 | [stage-19.md:71](stage-19.md#L71) | bucket | S19-04 (ID-6, DS19-I) | DIFF-INFRA | Cloud Run sizing / service layout |
| F-0777 | [stage-19.md:72](stage-19.md#L72) | bucket | S19-05 (ID-7, DS19-F) | NEW-BUILD | Job-per-run exists as an engine but the product path is the warm shared service |
| F-0778 | [stage-19.md:73](stage-19.md#L73) | bucket | S19-06 (ID-8 ALB, TLS, DNS, certs, DS19-A) | DIFF-INFRA | Edge is infra |
| F-0779 | [stage-19.md:74](stage-19.md#L74) | bucket | S19-07 (ID-8 no-CDN, hosting) | REWRITE | Frontend on Cloudflare (worldwide CDN) vs Google-only Mumbai hosting, no CDN |
| F-0780 | [stage-19.md:75](stage-19.md#L75) | bucket | S19-08 (ID-8 same-site hosts, cookie) | REWRITE | Bundle calls a public `run.app` URL; cookie forced to `SameSite=None` |
| F-0781 | [stage-19.md:76](stage-19.md#L76) | bucket | S19-09 (DS19-B usercontent domain) | NEW-BUILD | Previews are same-origin iframes; locked design is a separate registrable domain |
| F-0782 | [stage-19.md:77](stage-19.md#L77) | bucket | S19-10 (ID-9) | DIFF-INFRA | Cloud Armor is infra |
| F-0783 | [stage-19.md:78](stage-19.md#L78) | bucket | S19-11 (ID-11) | DIFF-INFRA | Secret Manager mounts are infra; key-vs-WIF is an owner question |
| F-0784 | [stage-19.md:79](stage-19.md#L79) | bucket | S19-12 (ID-12 pipeline, ID-15) | DIFF-INFRA | WIF, Cloud Deploy, attestation, Binary Authorization are pipeline infra |
| F-0785 | [stage-19.md:80](stage-19.md#L80) | bucket | S19-13 (ID-12 images) | REWRITE | `:latest` tag, no digest pins, unpinned apt/pip in images |
| F-0786 | [stage-19.md:81](stage-19.md#L81) | bucket | S19-14 (ID-13 fail-closed) | REWRITE | A failed migration is swallowed and the server starts anyway |
| F-0787 | [stage-19.md:82](stage-19.md#L82) | bucket | S19-15 (ID-16) | KEEP | No Eventarc / Pub/Sub dependency (`backend/package.json:23-51`) |
| F-0788 | [stage-19.md:83](stage-19.md#L83) | bucket | S19-16 (ID-18 outcome) | KEEP | Claude via first-party SDK with retries 0 (`providers/anthropic.ts:44-55`) |
| F-0789 | [stage-19.md:84](stage-19.md#L84) | bucket | S19-17 (DS19-D health path) | REWRITE | `/healthz` is a Cloud Run reserved-style path; locked path is `/health` |
| F-0790 | [stage-19.md:85](stage-19.md#L85) | bucket | S19-18 (SIGTERM deadline) | REWRITE | Shutdown has no deadline against Cloud Run's 10 s SIGKILL |
| F-0791 | [stage-19.md:86](stage-19.md#L86) | bucket | S19-19 (DS19-C R-8 egress) | DIFF-INFRA | Deny-all VPC egress documented; restricted-VIP rule is a firewall detail |
| F-0792 | [stage-19.md:87](stage-19.md#L87) | bucket | S19-20 (Postgres version) | DIFF-INFRA | Cloud SQL / CI run PG16, locked is PG18 Enterprise |
| F-0793 | [stage-19.md:88](stage-19.md#L88) | bucket | S19-21 (LV runner, dev tools) | DIFF-STACK | Python `lvrunner` replaced by TypeScript scripts in `backend/src/scripts` |
| F-0794 | [stage-19.md:151](stage-19.md#L151) | question |  |  | Q1. Warm per-chat sandbox workspace (repo ADR-0010/0014/0015) vs fresh Job execution per run (locked ID-7 + TD-4b). Locked outcome wins under ADR-0061; the file-persistence behaviour users have today changes. |
| F-0795 | [stage-19.md:152](stage-19.md#L152) | question |  |  | Q2. Frontend on Cloudflare (ADR-0060 never written) vs Google-only Mumbai hosting with no CDN. Which, and until when? |
| F-0796 | [stage-19.md:153](stage-19.md#L153) | question |  |  | Q3. Claude credential: ADR-0054 decision 6 (API key in env) vs the locked doc-sync 2026-10-10 / ADR-0012 (WIF, no key anywhere). Not resolved here. |
| F-0797 | [stage-19.md:154](stage-19.md#L154) | question |  |  | Q4. Router/worker jobs on Haiku 5.5 (Py ADR-0013/0014, numbers N-69, N-77) vs build-plan B-4 / ADR-0055 "three models only". Recorded, not resolved. |
| F-0798 | [stage-19.md:155](stage-19.md#L155) | question |  |  | Q5. Production Cloud SQL is PostgreSQL 16 (`docs/checkpoints/CURRENT.md:1766`); locked is PG18 Enterprise. Upgrade before Stage 12 retrieval work or run both? |
| F-0799 | [stage-19.md:156](stage-19.md#L156) | question |  |  | Could not check: real bucket / service regions (no live access), the Cloud Build trigger contents, `.env.example`. |
| F-0800 | [stage-19.md:159](stage-19.md#L159) | keep-check | prose |  | Both KEEP rows re-opened: S19-15 - `backend/package.json:23-51` lists no eventarc/pubsub/scheduler/tasks package, confirmed. S19-16 - `backend/src/providers/anthropic.ts:44-55` `maxRetries: 0`, explicit timeout, confirmed; the Gemini client (`providers/gemini.ts:349-353`) sets only per-request timeout (`:327,447`) and no `retryOptions`, so "google-genai retries off" is **not** shown in code - the default in `@google/genai` 2.22 is unverified; flagged under Stage 20 (CLAUDE.md forbidden pattern), so S19-16 remains KEEP for the Claude path only. |

## Stage 20 (41)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0801 | [stage-20.md:84](stage-20.md#L84) | bucket | VS-1 | REWRITE | Digest-pin base images, move sandbox to 3.13 (same work as stage-19 S19-13) |
| F-0802 | [stage-20.md:85](stage-20.md#L85) | bucket | VS-2 | DIFF-STACK | Fastify 5 instead of FastAPI / Uvicorn |
| F-0803 | [stage-20.md:86](stage-20.md#L86) | bucket | VS-2b | REWRITE | Docs UI public in production; per-request access logging on; frontend image root; `/health` path |
| F-0804 | [stage-20.md:87](stage-20.md#L87) | bucket | VS-3 | DIFF-STACK | npm lock + `npm ci` instead of uv |
| F-0805 | [stage-20.md:88](stage-20.md#L88) | bucket | VS-6 | DIFF-STACK | vitest + real Postgres service instead of pytest + Testcontainers |
| F-0806 | [stage-20.md:89](stage-20.md#L89) | bucket | VS-6b | NEW-BUILD | No load / failure-injection harness (Phase 5 gate) |
| F-0807 | [stage-20.md:90](stage-20.md#L90) | bucket | VS-7 | DIFF-STACK | Drizzle + postgres.js instead of SQLAlchemy / asyncpg / Alembic |
| F-0808 | [stage-20.md:91](stage-20.md#L91) | bucket | VS-7b | NEW-BUILD | pgvector + pg_textsearch per-company partitions on PG18 absent (Stage 12 owner) |
| F-0809 | [stage-20.md:92](stage-20.md#L92) | bucket | VS-8 | NEW-BUILD | No NFC normalisation, no pg_trgm |
| F-0810 | [stage-20.md:93](stage-20.md#L93) | bucket | VS-9 | NEW-BUILD | Vertex Ranking API reranker absent (ADR-0007; Phase 2) |
| F-0811 | [stage-20.md:94](stage-20.md#L94) | bucket | VS-10 | NEW-BUILD | No pre-send provider token counting (usage only after the call) |
| F-0812 | [stage-20.md:95](stage-20.md#L95) | bucket | VS-12a | DIFF-STACK | pdf-lib / pdf-parse / officeparser / exceljs are the Node equivalents |
| F-0813 | [stage-20.md:96](stage-20.md#L96) | bucket | VS-12b | REWRITE | `pymupdf` is AGPL; licence rule forbids it |
| F-0814 | [stage-20.md:97](stage-20.md#L97) | bucket | VS-12c | NEW-BUILD | No ClamAV quarantine, no FFmpeg, no ZIP intake |
| F-0815 | [stage-20.md:98](stage-20.md#L98) | bucket | VS-13 | NEW-BUILD | No isolated, pinned LibreOffice parser image |
| F-0816 | [stage-20.md:99](stage-20.md#L99) | bucket | VS-14 | NEW-BUILD | No Playwright/Chromium render image |
| F-0817 | [stage-20.md:100](stage-20.md#L100) | bucket | VS-15 | DIFF-STACK | Outcome (no raw HTML, strict Mermaid, CSP iframe) met by different libraries |
| F-0818 | [stage-20.md:101](stage-20.md#L101) | bucket | VS-16 | REWRITE | Stale SheetJS `xlsx` in the retrieval path (ExcelJS kept as stack equivalent, see Q) |
| F-0819 | [stage-20.md:102](stage-20.md#L102) | bucket | VS-17 | NEW-BUILD | Browser dictation only; no engine bake-off, audio leaves via browser vendor |
| F-0820 | [stage-20.md:103](stage-20.md#L103) | bucket | VS-18 | DIFF-STACK | Vite SPA instead of Next.js 16, Node 22 instead of 24 (hosting is stage-19 S19-07) |
| F-0821 | [stage-20.md:104](stage-20.md#L104) | bucket | VS-19 | NEW-BUILD | Expo app absent (Phase 6) |
| F-0822 | [stage-20.md:105](stage-20.md#L105) | bucket | VS-20a | DIFF-STACK | react-markdown / rehype-highlight / recharts instead of markdown-it / Shiki / ECharts |
| F-0823 | [stage-20.md:106](stage-20.md#L106) | bucket | VS-20b | NEW-BUILD | pdf.js / react-pdf citation viewer, virtualised lists absent |
| F-0824 | [stage-20.md:107](stage-20.md#L107) | bucket | VS-21 | DIFF-STACK | google-auth-library = google-auth equivalent (rest is Stage 16) |
| F-0825 | [stage-20.md:108](stage-20.md#L108) | bucket | VS-22 | NEW-BUILD | No SES mailer (conditional on the Stage 16 passwordless decision) |
| F-0826 | [stage-20.md:109](stage-20.md#L109) | bucket | VS-23 | KEEP | No push dependency anywhere (`backend/package.json:23-51`) |
| F-0827 | [stage-20.md:110](stage-20.md#L110) | bucket | VS-26 | NEW-BUILD | No secret / dependency / image scan, Dependabot, SBOM, notices register |
| F-0828 | [stage-20.md:111](stage-20.md#L111) | bucket | VS-29a | DIFF-STACK | `@anthropic-ai/sdk`, `@google/genai`, `@google-cloud/storage`, `google-auth-library` |
| F-0829 | [stage-20.md:112](stage-20.md#L112) | bucket | VS-29b | REWRITE | google-genai retries not explicitly off |
| F-0830 | [stage-20.md:113](stage-20.md#L113) | bucket | VS-31 | DIFF-STACK | Own harness exists (scripts + prompt kit) |
| F-0831 | [stage-20.md:114](stage-20.md#L114) | bucket | VS-32 | REWRITE | Cloudflare hosting and CDN-loaded scripts sit outside the stated SaaS boundary |
| F-0832 | [stage-20.md:115](stage-20.md#L115) | bucket | VS-33 | REWRITE | ESLint declared but not configured or run |
| F-0833 | [stage-20.md:116](stage-20.md#L116) | bucket | CVS1 | KEEP | `maxRetries: 0`, explicit timeout (`anthropic.ts:44-55`) |
| F-0834 | [stage-20.md:117](stage-20.md#L117) | bucket | CVS6 | KEEP | Exact model ids pinned in config |
| F-0835 | [stage-20.md:118](stage-20.md#L118) | bucket | CVS7 | KEEP | Agent SDK not used |
| F-0836 | [stage-20.md:202](stage-20.md#L202) | question |  |  | Q6. VS-16 literal "no ExcelJS": accept ExcelJS as the Node equivalent of openpyxl (stack), or read spreadsheets only in the sandbox/parser? |
| F-0837 | [stage-20.md:203](stage-20.md#L203) | question |  |  | Q7. Py ADR-0010 / VS-21 (no passwords, no argon2) vs repo password + Google (ADR-0056). Handled by the Stage 16 audit; repo still hashes passwords with `@node-rs/argon2` (`services/auth.ts:10`). |
| F-0838 | [stage-20.md:204](stage-20.md#L204) | question |  |  | Q8. Py ADR-0009/0013/0014 (Haiku 5.5 router and worker jobs; N-69, N-76, N-77) vs build-plan B-4 / ADR-0055. Recorded, not resolved. |
| F-0839 | [stage-20.md:205](stage-20.md#L205) | question |  |  | Q2 (Cloudflare) and Q3 (API key vs WIF) as in stage-19. |
| F-0840 | [stage-20.md:206](stage-20.md#L206) | question |  |  | Could not check: `@google/genai` 2.22 default retry behaviour; exact resolved dependency versions; pip package versions inside built images. |
| F-0841 | [stage-20.md:209](stage-20.md#L209) | keep-check | prose |  | 4 KEEP rows, 2 re-opened (50 %). CVS6: `backend/src/config.ts:130-131` default ids `claude-sonnet-5-5` / `claude-opus-5-5`, confirmed. CVS7: `backend/package.json:23-51` no Claude Agent SDK, confirmed. VS-23 and CVS1 were checked in the same pass (no push packages in either `package.json`; `anthropic.ts:51` `maxRetries: 0`), confirmed. |

## Stage 21 (17)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0842 | [stage-21.md:50](stage-21.md#L50) | bucket | S21-01 (IP-3 layout) | DIFF-STACK | `backend/` + `arcnave-frontend/` replace the Python apps/packages layout |
| F-0843 | [stage-21.md:51](stage-21.md#L51) | bucket | S21-02 (CLAUDE.md content, per-app files) | REWRITE | Locked forbidden list and A1 rule missing from `CLAUDE.md`; no per-app files |
| F-0844 | [stage-21.md:52](stage-21.md#L52) | bucket | S21-03 (IP-4 `lv1/` pack) | NEW-BUILD | No LV register results folder or per-id scripts; live scripts are ad hoc |
| F-0845 | [stage-21.md:53](stage-21.md#L53) | bucket | S21-04 (IP-4 deviation-as-ADR) | KEEP | ADRs 0053, 0054, 0055, 0061 record deviations with status |
| F-0846 | [stage-21.md:54](stage-21.md#L54) | bucket | S21-05 (IP-5 prompt kit) | NEW-BUILD | 0 of 68 locked kit cases ported (file not in the mirror); derived cases gate CI |
| F-0847 | [stage-21.md:55](stage-21.md#L55) | bucket | S21-06 (IP-5 skill evals 99 %) | NEW-BUILD | No skill eval cases or nightly job |
| F-0848 | [stage-21.md:56](stage-21.md#L56) | bucket | S21-07 (IP-5 content-leak test) | KEEP | Sentinel test runs in CI as part of vitest |
| F-0849 | [stage-21.md:57](stage-21.md#L57) | bucket | S21-08 (IP-5 licence / SBOM / scans) | NEW-BUILD | Same work as stage-20 VS-26 |
| F-0850 | [stage-21.md:58](stage-21.md#L58) | bucket | S21-09 (IP-10 docs structure) | NEW-BUILD | `product`, `api`, `ops`, `legal-trust`, `changelog`, `startup-pack` absent |
| F-0851 | [stage-21.md:59](stage-21.md#L59) | bucket | S21-10 (P-5 numbers) | REWRITE | Many literals without N-id; no settings / price_book; five repo values differ from the register |
| F-0852 | [stage-21.md:60](stage-21.md#L60) | bucket | S21-11 (A1 identifiers) | REWRITE | Project id, service-account e-mail and project number in code, scripts and the production API URL |
| F-0853 | [stage-21.md:103](stage-21.md#L103) | question |  |  | Q9. Register-conflicting repo values: which win? Turn deadline 59 min vs 10 min; tool rounds 16 vs 1-2 / 5 / 15 per profile; max output 64,000 vs 8,192 / 16,384 / 32,768; message 100,000 chars vs 32,000; upload caps; purge 30 d vs soft delete 7 d; session 14 d vs idle 24 h / absolute 28 d. (Detail: `numbers-diff.md` section 2.) Fast / Normal / Deep profiles do not exist in the repo at all (Stage 6). |
| F-0854 | [stage-21.md:104](stage-21.md#L104) | question |  |  | Q10. `docs/checkpoints/CURRENT.md`, `docs/deploy`, `docs/superpowers` hold identifiers outside `docs/ops`: relocate, or accept as ops docs? |
| F-0855 | [stage-21.md:105](stage-21.md#L105) | question |  |  | Q11. The 68-case prompt kit file: where is it? (`test-kit/arcnave-test-kit.zip` unreadable here.) |
| F-0856 | [stage-21.md:106](stage-21.md#L106) | question |  |  | Carried: Q1 (sandbox), Q2 (Cloudflare), Q3 (API key vs WIF), Q4 / Q8 (Haiku router / worker vs three models), Q7 (passwordless). |
| F-0857 | [stage-21.md:107](stage-21.md#L107) | question |  |  | Could not check: LV-1 batch outcomes of the Python build (not mirrored), live infra state. |
| F-0858 | [stage-21.md:110](stage-21.md#L110) | keep-check | prose |  | 2 KEEP rows, both re-opened. S21-04: `docs/decisions/0053-prototype-base-and-target-spec.md:3-5` and `0061-locked-decisions-win-outside-stack-and-infra.md:3-6` carry Status lines and supersession - confirmed. S21-07: `backend/src/test/contentLeak.test.ts:61-65` sentinels and `backend/vitest.config.ts:5` includes `src/**/*.test.ts`, run by `ci.yml:56` - confirmed; downgrade note: it covers one fake turn and is shadow-mode, enforce is deferred. |

## D1 files (83)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0859 | [D1-file-handling.md:57](D1-file-handling.md#L57) | number | N-10 docs |  | ≤100 MB / ≤1,000 pp (`:15`) — 500 MB flat for every type; 1,000 pp ✓ — `config/numbers.ts:59`, `config.ts:355`; `processUpload.ts:31` |
| F-0860 | [D1-file-handling.md:58](D1-file-handling.md#L58) | number | N-10 XLSX |  | ≤50 MB — 500 MB accepted; text extracted only ≤ ~45 MB — `processUpload.test.ts:116` (derived) |
| F-0861 | [D1-file-handling.md:59](D1-file-handling.md#L59) | number | N-10 images |  | ≤20 MB — 10 MB (+ 8000 px) — `processUpload.ts:34-36`; frontend `storage.ts:52` |
| F-0862 | [D1-file-handling.md:60](D1-file-handling.md#L60) | number | N-10 audio |  | ≤500 MB / ≤3 h — 500 MB ✓, no duration check — `numbers.ts:59` |
| F-0863 | [D1-file-handling.md:61](D1-file-handling.md#L61) | number | N-10 ZIP |  | ≤100 MB / ≤20 files / ≤500 MB unpacked — none (type absent) — — |
| F-0864 | [D1-file-handling.md:62](D1-file-handling.md#L62) | number | N-10 counts |  | ≤10/msg, ≤20/chat — ✓ ✓ — `chats.ts:546`, `processUpload.ts:30` |
| F-0865 | [D1-file-handling.md:63](D1-file-handling.md#L63) | number | N-11 |  | per-user rate, project file limits, company OCR pages (5,000/month after review R-6), audio minutes — none; project files 30 MB each (`numbers.ts:57`), no count cap — `projects.ts:374-425` |
| F-0866 | [D1-file-handling.md:64](D1-file-handling.md#L64) | number | N-13 |  | page images Fast 3 / Normal 8 / Deep 20 (`:18`) — all pages ≤100 — `processUpload.ts:33`, `pdfPages.ts:124-149` |
| F-0867 | [D1-file-handling.md:65](D1-file-handling.md#L65) | number | N-14 |  | ~800 tokens / ~15 % (`:19`) — 1,400 chars (≈350 tokens) / 180 chars (12.9 %) — `retrieval.ts:20-21` |
| F-0868 | [D1-file-handling.md:66](D1-file-handling.md#L66) | number | N-15 |  | 1,536-dim embeddings (`:20`) — no embeddings; schema comment says so — `db/schema.ts:183` |
| F-0869 | [D1-file-handling.md:67](D1-file-handling.md#L67) | number | N-08 |  | sandbox ≤30 MB ×10, workspace ~500 MB (`:13`) — workspace 2 GiB, no per-file/-run cap — `sandbox/server.py:63` |
| F-0870 | [D1-file-handling.md:68](D1-file-handling.md#L68) | number | N-09 |  | tool result ~8k tokens — `read_project_file` 6,000 chars — `numbers.ts:45` |
| F-0871 | [D1-file-handling.md:221](D1-file-handling.md#L221) | gap | #1 R5, UD-2, G5, N-10 ZIP, build plan P2-A | P1 NEW-BUILD | ZIP absent (3.8) — Pick: **A** (smaller, testable; move to #7 worker later) |
| F-0872 | [D1-file-handling.md:222](D1-file-handling.md#L222) | gap | #2 D1, FG3, AS-D6, AS21 | P1 REWRITE | Failed/unsupported files are sent; no Retry; server blocks only `uploading`; failed chips dropped silently (4.2, 4.3) — Pick: **A** now; UI states extend with #3 |
| F-0873 | [D1-file-handling.md:223](D1-file-handling.md#L223) | gap | #3 G22, AS21, G21, G30, D9-9 (Cloud Tasks itself is DIFF-INFRA) | P1 NEW-BUILD | Sync extraction in the request, 3 statuses, serial process-wide queue, no progress (4.2) — Pick: **A** (additive; old synchronous path stays behind a flag until parity) |
| F-0874 | [D1-file-handling.md:224](D1-file-handling.md#L224) | gap | #4 G1, D9-12, Stage 1 doc-sync | P1 REWRITE | No byte sniff; legacy `.doc/.xls/.ppt` and macro files not rejected with "save as" copy; `.xls` accepted and test-pinned (`storage.ts:347-354`, `storage.test.ts:109-120`) — Pick: **A** (no new dependency) |
| F-0875 | [D1-file-handling.md:225](D1-file-handling.md#L225) | gap | #5 G2, DB-6, SE14 (daemon = DIFF-INFRA) | P1 NEW-BUILD | No malware scan; build plan defers to Phase 5 (line 72) — Pick: **A** (hook now; owner Q4) |
| F-0876 | [D1-file-handling.md:226](D1-file-handling.md#L226) | gap | #6 G3, ER-9 `encrypted` | P1 REWRITE | No encrypted detection (PDF/OOXML/ZIP/xlsx); password xlsx says "no cells" (`retrieval.ts:357`) — Pick: **A** |
| F-0877 | [D1-file-handling.md:227](D1-file-handling.md#L227) | gap | #7 G4, G5, G6, G34, SE14 | **P0** (availability/security) NEW-BUILD | Untrusted files parsed in the API process; memory-by-file-size formula; no decompressed-size/ratio/DTD guard; `xlsx@0.18.5` from npm (my knowledge: known CVEs, unverified here) used on untrusted bytes (`retrieval.ts:270-286`, `package.json:49`) — Pick: **A** now, B when #29 needs LibreOffice |
| F-0878 | [D1-file-handling.md:228](D1-file-handling.md#L228) | gap | #8 G7, G8, M11, ADR-0006, G35, G25, ER-9 `ocr_*` | **P0** NEW-BUILD | No OCR at upload (3.2); project OCR = one call, no truncation check, mixed PDFs lose scanned pages; Doc AI absent (build plan: keep Gemini OCR until Phase 5) — Pick: **A** (matches the plan's interim) |
| F-0879 | [D1-file-handling.md:229](D1-file-handling.md#L229) | gap | #9 G9-G12, G25, G37, G40, G44, G47, V-5, Stage 12 (sheets, furniture) | P1 NEW-BUILD | No normalised Markdown + JSON sidecar; no slide/sheet/cell/page ids, warnings, extractor versions; XLSX/PPTX/DOCX gaps in 3.3-3.5 — Pick: **A**, staged per type |
| F-0880 | [D1-file-handling.md:230](D1-file-handling.md#L230) | gap | #10 G18, G46, D1 (S12), CXD-4, D9-8 | **P0** NEW-BUILD | No token count; no per-file whole (≤30k) vs retrieve; chat files never retrieved (3.7, 4.2) — Pick: **A** (needs owner Q1) |
| F-0881 | [D1-file-handling.md:231](D1-file-handling.md#L231) | gap | #11 N-13, V-3, D9-3, G19, G20 | P1 REWRITE | All ≤100 pages as images every turn; Claude 32 MB hard error; Gemini cost — Pick: **A** now, final with #12c |
| F-0882 | [D1-file-handling.md:232](D1-file-handling.md#L232) | gap | #12a LANG-1, Stage 12 | **P0** REWRITE | `tokenize` ASCII-only → Tamil/Hindi chunks unsearchable (`retrieval.ts:415-419,524`); test covers ASCII only (`retrieval.test.ts:93-101`) — Pick: **A** now, B in #12c |
| F-0883 | [D1-file-handling.md:233](D1-file-handling.md#L233) | gap | #12b E1, E4, N-14 | **P0** (silent cut) REWRITE | 400-chunk silent cap (`retrieval.ts:22,686`); chunk size 1,400 chars vs ~800 tokens; no overlap % per N-14 — Pick: **A** |
| F-0884 | [D1-file-handling.md:234](D1-file-handling.md#L234) | gap | #12c Stage 12 D3-D5, N-15 | P1 NEW-BUILD | No hybrid retrieval, vectors, planner, RRF, rerank, coverage flags, per-turn `file_search` caps (N-07) — Pick: **A**, but sequencing is owner Q3 |
| F-0885 | [D1-file-handling.md:235](D1-file-handling.md#L235) | gap | #13 Stage 12 citation registry, RD-4, P2-E | P1 NEW-BUILD | No `[file:n]`/registry/viewer (4.4) — Pick: **A** |
| F-0886 | [D1-file-handling.md:236](D1-file-handling.md#L236) | gap | #14 N-10, P2-B | P1 REWRITE | Flat limits; image 10 vs 20 MB; extraction limits by memory (4.1) — Pick: **A** |
| F-0887 | [D1-file-handling.md:237](D1-file-handling.md#L237) | gap | #15 G14, G15, G36, SE14 | P1 NEW-BUILD | No EXIF strip/rotate, resize, HEIC, image OCR (3.6) — Pick: **B long-term; A interim for JPEG/PNG/WebP** |
| F-0888 | [D1-file-handling.md:238](D1-file-handling.md#L238) | gap | #16 G16, SPD, G41, N-10 audio, Stage 12 audio segments | **P0** NEW-BUILD | Audio >~20 MB cannot be transcribed; no segments/timestamps/duration (3.9) — Pick: **A interim then final** |
| F-0889 | [D1-file-handling.md:239](D1-file-handling.md#L239) | gap | #17 G23, G29, G45 | **P0** REWRITE | Project-file delete removes shared bytes (4.6); derived page images outlive the file — Pick: **A** |
| F-0890 | [D1-file-handling.md:240](D1-file-handling.md#L240) | gap | #18 D1 integrity | P1 REWRITE | Claim UPDATE lacks `message_id IS NULL` (`chats.ts:1158-1165`) — Pick: **A** |
| F-0891 | [D1-file-handling.md:241](D1-file-handling.md#L241) | gap | #19 Stage 12 RT-1, G42 | **P0** (no-sandbox Office) REWRITE | Picked project file: `extractedText` null, status not checked, pageCount null (`files.ts:294-307`) — Pick: **A** now, B after #9 |
| F-0892 | [D1-file-handling.md:242](D1-file-handling.md#L242) | gap | #20 V-5, RT-1 | P1 REWRITE | Two ingest paths (poppler vs pdf-parse; chunks vs text) (4.6) — Pick: Keep both. **0**. |
| F-0893 | [D1-file-handling.md:243](D1-file-handling.md#L243) | gap | #21 G48, G14, CF6 | P1 REWRITE | Claude rejects images >5 MB base64; no >20-images ≤2,000 px rule — Pick: **A** |
| F-0894 | [D1-file-handling.md:244](D1-file-handling.md#L244) | gap | #22 SE14 | P1 NEW-BUILD | No PDF JavaScript/OpenAction strip, LibreOffice hardening, Pillow bomb limits — Pick: **A** |
| F-0895 | [D1-file-handling.md:245](D1-file-handling.md#L245) | gap | #23 ER-9, Stage 15 | P1 REWRITE | No taxonomy; raw `String(err)` in messages (4.3) — Pick: **A** |
| F-0896 | [D1-file-handling.md:246](D1-file-handling.md#L246) | gap | #24 N-11, G31, G33, G43 | P1 NEW-BUILD | No per-user upload rate, project file count/size caps, OCR-page or audio-minute quota — Pick: **A** |
| F-0897 | [D1-file-handling.md:247](D1-file-handling.md#L247) | gap | #25 TD-4c, Stage 20 AGPL, scope doc | P1 REWRITE | pymupdf/pytesseract in the warm image; pdf-reading skill depends on them (4.5) — Pick: **A** |
| F-0898 | [D1-file-handling.md:248](D1-file-handling.md#L248) | gap | #26 TD-5c, N-08 | P1 REWRITE | No per-file/per-run caps; one missing file aborts all code calls; all files copied each run (4.5) — Pick: **A** |
| F-0899 | [D1-file-handling.md:249](D1-file-handling.md#L249) | gap | #27 Stage 14 upload states, G25 | P2 REWRITE | Chip shows no stage/warnings list; no "N files indexing" — Pick: **A** |
| F-0900 | [D1-file-handling.md:250](D1-file-handling.md#L250) | gap | #28 Stage 9 CF4, D9-8 vs ADR-0045 | P1 REWRITE | Pointer-only on sandbox turns — Pick: **A** (owner Q2) |
| F-0901 | [D1-file-handling.md:251](D1-file-handling.md#L251) | gap | #29 V-4, G10 | P1 NEW-BUILD | No DOCX/PPTX → PDF page images — Pick: **A** after #7 |
| F-0902 | [D1-file-handling.md:252](D1-file-handling.md#L252) | gap | #30 G38, G39 | P2 NEW-BUILD | PDF form fields/comments, embedded-file warning — Pick: **A** |
| F-0903 | [D1-file-handling.md:253](D1-file-handling.md#L253) | gap | #31 G32, G46, G44 | P1 REWRITE | CSV/TXT/MD: no encoding detection, binary check, cap, sidecar (3.7) — Pick: **A** |
| F-0904 | [D1-file-handling.md:254](D1-file-handling.md#L254) | gap | #32 G20, G14, ADR-0016 | P1 REWRITE | Gemini inline image/audio; 7 vs 20 MB conflict — Pick: **A** |
| F-0905 | [D1-file-handling.md:255](D1-file-handling.md#L255) | gap | #33 RD-4/RD-5 | P2 REWRITE | Preview downloads whole file (500 MB) for all types (4.4) — Pick: **A** |
| F-0906 | [D1-file-handling.md:256](D1-file-handling.md#L256) | gap | #34 ER-9 `corrupt` | P2 REWRITE | `pdftotext` unguarded and reported as "storage unavailable" (`pdfPages.ts:109`, `generation.ts:1749-1756`) — Pick: **A** |
| F-0907 | [D1-file-handling.md:257](D1-file-handling.md#L257) | gap | #35 G21, UD security | P1 REWRITE | Post-validation overwrite via session URI; no checksum/generation on attachments — Pick: **A** |
| F-0908 | [D1-file-handling.md:258](D1-file-handling.md#L258) | gap | #36 UD-1..4 | P1 REWRITE | Single-PUT "resumable" upload (`api.ts:681`) — Pick: **A** |
| F-0909 | [D1-file-handling.md:259](D1-file-handling.md#L259) | gap | #37 G29/G45 | P2 REWRITE | Derived page images not removed with file — Pick: **either; document** |
| F-0910 | [D1-file-handling.md:260](D1-file-handling.md#L260) | gap | #38 G42 | P2 NEW-BUILD | No project file replace (= re-process + delete old data) — Pick: **A** |
| F-0911 | [D1-file-handling.md:261](D1-file-handling.md#L261) | gap | #D1 — | — DISCARD | `EXTRACTION_MEMORY_PER_BYTE` table + `oneAtATime` — Pick: — |
| F-0912 | [D1-file-handling.md:262](D1-file-handling.md#L262) | gap | #D2 — | — DISCARD | pdf-parse OCR single-call path (`retrieval.ts:165-180`) — Pick: — |
| F-0913 | [D1-file-handling.md:263](D1-file-handling.md#L263) | gap | #D3 — | — DISCARD | "Files marked with a warning are sent without their text" (`Composer.tsx:836-837`) — Pick: — |
| F-0914 | [D1-file-handling.md:264](D1-file-handling.md#L264) | gap | #D4 — | — DISCARD | `pymupdf`/`pytesseract` in the sandbox image (`Dockerfile.service:28,30`) — Pick: — |
| F-0915 | [D1-file-handling.md:265](D1-file-handling.md#L265) | gap | #K1-K14 KEEP (file:line above) | KEEP | storage key shape + traversal guard `storage.ts:20-28,56-58`; ownership scoping `files.ts:470-483`; nosniff attachment download `files.ts:348-359`; sent-file delete guard `files.ts:404-409`; project-key guard in delete/cleanup `files.ts:412,456`; 10/message `chats.ts:546`; 20/chat `chats.ts:1114`; PDF 1,000-page reject `processUpload.ts:185-191`; page render on demand, no stored pages (G49) `pdfPages.ts:78-153`; Gemini `gs://` pages `generation.ts:229-249`; manifest in-context note `manifest.ts:28-42`; hash-chunked sandbox input transfer `warmSandboxClient.ts:6-8`; `.xls`-as-HTML tolerance `retrieval.ts:336-345`; CSV/TXT/MD accepted `storage.ts:366-368`; xlsx server preview `files.ts:363-384` — Pick: |
| F-0916 | [D1-file-handling.md:266](D1-file-handling.md#L266) | gap | #S1 Poppler instead of pypdfium2 (D9-4) | — DIFF-STACK | outcome (text + page render) met — Pick: |
| F-0917 | [D1-file-handling.md:278](D1-file-handling.md#L278) | test-gap | Text PDF |  | `pdfWithPages` Latin-only (`test/fixtures/files.ts:10-19`); `processUpload.test.ts:34-68`; `files.integration.test.ts:454-481,549-590` — Tamil/Hindi text layer, legacy-font PDF, multi-column, encrypted, corrupt-but-valid-header, 100-page byte-size vs Claude 32 MB, printed page labels |
| F-0918 | [D1-file-handling.md:279](D1-file-handling.md#L279) | test-gap | Scanned PDF |  | `buildScannedPdf` exists (`test/fixtures/scannedPdf.ts`) but **is imported nowhere**; blank-page stub + mocked vision (`retrieval.test.ts:49-69`); >100-page blank (`processUpload.test.ts:50-55`) — real image-only PDF through upload → page images → provider wire; mixed text+scanned PDF; OCR truncation; Hindi/Tamil scan; large project scan |
| F-0919 | [D1-file-handling.md:280](D1-file-handling.md#L280) | test-gap | DOCX |  | none (size-gate only, `processUpload.test.ts:100-110`) — any real DOCX incl. Tamil, tables, images, comments, encrypted; `a4_tamil_test.docx` (older snapshot) unused |
| F-0920 | [D1-file-handling.md:281](D1-file-handling.md#L281) | test-gap | XLSX |  | in-test workbooks, BIFF8, HTML-disguised (`retrieval.test.ts:201-282`), octet-stream upload (`files.integration.test.ts:77`) — hidden sheets, formulas without cached values, merged cells, multi-table, password, 50 MB, lakh formats (`lakh_format_test.xlsx` unused) |
| F-0921 | [D1-file-handling.md:282](D1-file-handling.md#L282) | test-gap | PPTX |  | none — everything (slide markers, notes, tables, charts) |
| F-0922 | [D1-file-handling.md:283](D1-file-handling.md#L283) | test-gap | Image |  | grayscale PNG (`files.ts:43-57`); size/dimension tests (`processUpload.test.ts:70-86`) — JPEG with EXIF/GPS, WebP, GIF, CMYK, HEIC, >5 MB on Claude through the route, >20 images |
| F-0923 | [D1-file-handling.md:284](D1-file-handling.md#L284) | test-gap | CSV/TXT/MD |  | plain ASCII string (`files.integration.test.ts:53,103`) — UTF-8 BOM, UTF-16, Windows-1252, Tamil legacy encoding, binary-as-.txt, 100 MB CSV |
| F-0924 | [D1-file-handling.md:285](D1-file-handling.md#L285) | test-gap | ZIP |  | none (feature absent) — UD-2 cases: nested, zip-slip, bomb ratio, >20 members, encrypted, disallowed member type |
| F-0925 | [D1-file-handling.md:286](D1-file-handling.md#L286) | test-gap | Audio |  | mocked provider (`retrieval.test.ts:71-91`) — real size, over inline limit, segments/timestamps |
| F-0926 | [D1-file-handling.md:287](D1-file-handling.md#L287) | test-gap | Send-block / UX |  | `files.integration.test.ts:502` (uploading) — server rejection of unsupported/failed; frontend chip states, Retry/Remove, sequential upload — `Composer.test.ts` has none (only `validateFile`, `types.test.ts:274-306`; `AttachmentChip` is mocked, `Surfaces.test.tsx:33`) |
| F-0927 | [D1-file-handling.md:288](D1-file-handling.md#L288) | test-gap | Lifecycle |  | `retention.integration.test.ts`, `files.integration.test.ts:380-408` — project-file delete with attached chat rows; claim of an already-claimed file; sandbox with a missing object |
| F-0928 | [D1-file-handling.md:289](D1-file-handling.md#L289) | test-gap | Citations / viewer |  | none — registry, `[file:n]`, page jump |
| F-0929 | [D1-file-handling.md:290](D1-file-handling.md#L290) | test-gap | Retrieval |  | `retrieval.test.ts:93-200` ASCII only — Tamil/Hindi tokens, 400-chunk cap, hybrid/RRF |
| F-0930 | [D1-file-handling.md:291](D1-file-handling.md#L291) | test-gap | Environment |  | tests call real `pdfinfo/pdftotext/pdftoppm` — local Windows runs fail 25 tests without poppler (`docs/checkpoints/CURRENT.md:118-120`); CI must carry poppler |
| F-0931 | [D1-file-handling.md:297](D1-file-handling.md#L297) | question |  |  | **Token counting.** Stage 9 G18/G46 and Stage 12 D1 need exact token counts per model family; the repo rule "ArcNave counts no tokens (Invariant 3)" (cited `ADR-0020` §4, `generation.ts:331`) blocks it. Lift it for files (provider count APIs, free)? Cost of "no": #10 stays a character heuristic that mis-sizes Tamil. |
| F-0932 | [D1-file-handling.md:298](D1-file-handling.md#L298) | question |  |  | **ADR-0045 vs Stage 9 CF4 / D9-8.** Keep "pointer only when a sandbox exists" or inline normalised text when ≤30k tokens (locked outcome)? Not resolved here. |
| F-0933 | [D1-file-handling.md:299](D1-file-handling.md#L299) | question |  |  | **Build-plan deferral line (`00-build-plan-arcnave-tech.md:72`)** defers ClamAV, Document AI OCR, the Cloud Tasks file queue and embeddings/reranker to Phase 5, while the 2026-10-15 owner rule asks for locked-decision parity except stack/infra. ClamAV *states*, OCR quality and embeddings are app behaviour, not infra. Confirm which of #5, #8 (Document AI engine), #12c are in this pass. (Recorded, not resolved; also P2-D/ADR-0059 sequencing.) |
| F-0934 | [D1-file-handling.md:300](D1-file-handling.md#L300) | question |  |  | **ClamAV in dev.** May the scan step ship with a no-op dev scanner behind a flag, with prod required? (Avoids blocking uploads locally.) |
| F-0935 | [D1-file-handling.md:301](D1-file-handling.md#L301) | question |  |  | **company_id now?** `attachments`, `project_files`, `file_chunks` carry only `user_id` (`schema.ts:151-207,401-435`); Stage 12 wants chunk tables list-partitioned per company with their own BM25/HNSW indexes. If the new tables built here (`file_jobs`, `file_derivatives`, `chat_citation`, chunks) omit `company_id`, tenancy later forces a rewrite of all of them. Cost of asking now: one nullable column + index per new table. |
| F-0936 | [D1-file-handling.md:302](D1-file-handling.md#L302) | question |  |  | **New dependencies:** `sharp` (+ a HEIC decoder) or Pillow/pillow-heif in a parser service (#15); `@google-cloud/documentai` (#8); `pdfjs-dist`/react-pdf (#13); ffmpeg binary (#16). Repo has no Stage 20 Node BOM; approve each? |
| F-0937 | [D1-file-handling.md:303](D1-file-handling.md#L303) | question |  |  | **Sandbox tesseract.** Scope doc says no pytesseract; the sandbox image installs tesseract + Tamil pack and the skill uses it as a cross-check. Remove or keep as the only OCR for >100-page scans until #8 lands? |
| F-0938 | [D1-file-handling.md:304](D1-file-handling.md#L304) | question |  |  | **Legacy `.xls`.** D9-12 says reject; real AICTE/portal exports are HTML or XML tables named `.xls` (the repo handles them, `retrieval.test.ts:243-282`). Reject only true OLE2 BIFF and accept table exports? |
| F-0939 | [D1-file-handling.md:305](D1-file-handling.md#L305) | question |  |  | **Extra types accepted today** beyond the locked list: video (`mp4/webm/mov`), RTF/ODT/EPUB, and many code/text extensions (`storage.ts:341-390`; ADR-0011 Claude parity). Keep (no regression for users) or restrict to Stage 1 + CSV/TXT/MD? |
| F-0940 | [D1-file-handling.md:306](D1-file-handling.md#L306) | question |  |  | **Numbers to settle by LV-1 / owner:** Gemini inline image limit 7 MB (Stage 9 vendor fact) vs 20 MB (repo); Claude request limit 30 MB (Stage 9) vs 32 MB (first-party API, ADR-0054); image max 10 vs 20 MB; project-file max 30 MB (N-11 has no value, "–"). |
| F-0941 | [D1-file-handling.md:307](D1-file-handling.md#L307) | question |  |  | **B-4 "three models only" vs Stage 12 D3 query planner (M3, `gemini-3.5-flash-lite`) and M5 reranker.** The planner/reranker are separate model calls; B-4 lists three chat models. Recorded as a conflict, not resolved (affects #12c only). |

## D2 AI output (75)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-0942 | [D2-ai-output.md:112](D2-ai-output.md#L112) | finding | CXD-3b | H N/Q | One policy spec → Claude and Gemini renderings (`06-context-assembly.md:59`) — one builder for all providers: `systemPrompt.ts:24-166`, `promptAssembly.ts:26-55`; both adapters take the same string (`gemini.ts:420`, `anthropic.ts:449`); no `prompts/system/v3` — No per-model rendering; port source has the text and sha256 version stamp (`arcnave.in:prompts/system/v3/{gemini,claude}.md`, doc-sync 2026-10-10) |
| F-0943 | [D2-ai-output.md:113](D2-ai-output.md#L113) | finding | GEM-1 | H R | Gemini: 12 critical rules first (`06-system-prompt-v3-gemini.md:23-44`; Google guidance, CG2) — opens with identity + `core_behavior` (`systemPrompt.ts:32-48`); the first prohibitions (`truthfulness`) start after ≈ 3 k chars, `safety` after ≈ 11 k — Critical rules not first; none of the 12 rule texts (AI disclosure, precedence, capabilities-on-only, ask-for-essentials, decline list) as a block |
| F-0944 | [D2-ai-output.md:114](D2-ai-output.md#L114) | finding | ST-2 / S18 | H R | "Give complete, well-explained answers… not terse notes" (v3-gemini:73-75; also v1:317, v2:352, v2.1:390); eval S18 "Gemini terse check", fail_if "only 2-3 terse lines" — opposite wording: "Be concise by default", "give a high-level explanation unless the user asks for depth", "A simple question can take a few sentences" (`systemPrompt.ts:66`); "answer in prose… casual reply a few sentences" (69); "After your last tool call, give the answer… in one or two sentences" (111) — Line removed in every version since v2.1; reverse directive for a model the lock calls terse by default |
| F-0945 | [D2-ai-output.md:115](D2-ai-output.md#L115) | finding | ST-7 (C) | H R | Ask only for missing essentials, bundled; never assume facts/names/amounts/recipients (spec:48; evals Y3, S10) — "Make routine judgment calls yourself, and check in only when different readings… materially different work" (`systemPrompt.ts:44`); "address the most likely reading first, then ask" (42); `ask_user_input_v0` says "proceed and state any assumption inline" (`definitions.ts:529`) — A critical rule contradicted for facts, names, amounts |
| F-0946 | [D2-ai-output.md:116](D2-ai-output.md#L116) | finding | ST-3 | L R | Flat lists only; many items with attributes → table (spec:44; evals S15, Y2) — "Use a table when a comparison reads better as one" (`systemPrompt.ts:69`); no flat-list rule — Nested bullets not forbidden |
| F-0947 | [D2-ai-output.md:117](D2-ai-output.md#L117) | finding | ST-4 | L Q | Math as `\( \)` / `\[ \]`; `$` fails eval S16 — prompt tells the model the chat renders `$$…$$` (`systemPrompt.ts:391`); frontend uses remark-math (CURRENT.md:449) — Delimiter differs from the lock; frontend and lock disagree |
| F-0948 | [D2-ai-output.md:118](D2-ai-output.md#L118) | finding | ID-1/ID-2 | M N | AI disclosure; model name only from `<model_info>` (spec:28-29; eval S4) — none: the identity line says "AI workspace assistant" (`systemPrompt.ts:32`) but there is no rule to say so when asked or to avoid implying human authorship, and no model_info; cutoff deliberately unstated (`systemPrompt.ts:142-145`, PK-HON-09) — Stage 7 §7.9 has cutoffs (Gemini Mar 2026, Claude Jun 2026) and TI-2 wants them |
| F-0949 | [D2-ai-output.md:119](D2-ai-output.md#L119) | finding | CXD-1 | M Q | Language section removed (user, 2 Oct) — language paragraph + "restate at end of thinking" (`systemPrompt.ts:63-65`), tests PK-LANG-01..03; mistakes.md:1228-1236 records add/remove/re-add — Locked removal vs live fix for Tanglish→Tamil (ADR-0043/0049) |
| F-0950 | [D2-ai-output.md:120](D2-ai-output.md#L120) | finding | AU-1…4, UC-1 | M R | Precedence ArcNave > company > project > user; user text escaped; untrusted text never on the system side (spec:31-38; CG11) — `wrapTag` escapes the wrapper's own close tag (`promptAssembly.ts:63-66`, K); precedence prose vague (`systemPrompt.ts:75`); **project files and the mode text are appended raw** (`promptAssembly.ts:109-111,117-119`; `retrieval.ts:638-643` no tag, no escape); project instructions cap 20 000 vs ≤ 5 000; style instructions no cap — Untrusted document text sits on the system layer with no wrapper |
| F-0951 | [D2-ai-output.md:121](D2-ai-output.md#L121) | finding | LAY-1 | M R/D | Documents → memory → question last; per-turn blocks outside the cached base (spec:151; CG3) — documents, memory, summary all in the system string (`promptAssembly.ts:101-111`); user turn = manifest + prompt (`generation.ts:829-832`); Gemini explicit-cache layout (doc-sync 2026-10-05) not built (implicit, `gemini.ts:156`) — Placement differs; explicit-cache part is DIFF-INFRA (Python gateway turned it off, checkpoint:64,68) |
| F-0952 | [D2-ai-output.md:122](D2-ai-output.md#L122) | finding | CXD-4 | L K/R | Whole file ≤ ~30 k tokens, else retrieval; D1 tunes — whole while total ≤ 200 000 chars (`config.ts:171`, ≈ 50 k tok), BM25 search above (`definitions.ts:11-34`) — Different threshold; BM25-only (Stage 12 hybrid not built) |
| F-0953 | [D2-ai-output.md:123](D2-ai-output.md#L123) | finding | CXD-5 / N-16 | H Q | Summary at > 60 % of the profile history budget; last 6 turns verbatim — compaction at window − 33 k (≈ 967 k, `autoCompact.ts:41-51`), last 2 turns kept (36) — Effectively never compacts below 900 k tokens; build plan lists "0058 compaction kept" |
| F-0954 | [D2-ai-output.md:124](D2-ai-output.md#L124) | finding | CXD-6 / N-03 | H R | Input budget Fast 16 k / Normal 48 k / Deep 200 k (register:8) — none; history budget = window − 12 288 tokens, ×4 chars (`generation.ts:1560-1566`), **window = 128 000 fallback under `Auto`** (`capabilitiesTable.ts:128-144`) — Oldest turns dropped silently at ≈ 463 k chars with no summary (`generation.ts:1570-1577`) |
| F-0955 | [D2-ai-output.md:125](D2-ai-output.md#L125) | finding | CXD-9/10, CI-1…6 | M N | Typed citations `[file:n]`/`[web:n]`; native search citations attached by the app — no typed ids; Gemini sources panel (`grounding.ts:137-144`); Claude: result list only (`anthropic.ts:556`) — No inline citation, no id check (Stage 13 RP-3 depends) |
| F-0956 | [D2-ai-output.md:126](D2-ai-output.md#L126) | finding | FI-1/5/6 | M N | `coverage`, `<retrieval_status>`, "already provided", "[source deleted]" — not found (searched `retrieval_status — coverage` in `backend/src`, non-test) — Stage 12 flags absent |
| F-0957 | [D2-ai-output.md:127](D2-ai-output.md#L127) | finding | TI-1 | L R | `<current_time>` IST ISO per turn — date only in the user's zone (`systemPrompt.ts:277-295`); zone defaults to UTC (`schema.ts:105`, `Settings.tsx:855`) — No time of day; IST users see UTC date until Settings is set |
| F-0958 | [D2-ai-output.md:128](D2-ai-output.md#L128) | finding | PR-1 / RT-4 | M N | Fast/Normal/Deep: brief ≤ 1 tool / balanced / split+check; effort low/medium/high — no profile; one effort (medium), 16 rounds, 64 000 tokens for everyone (`numbers.ts:41,43`, `config.ts:166`) — Register N-06 Normal 5 / Deep 15 (register:11), N-74 per-profile ceilings (register, quoted at `numbers.ts:41`) |
| F-0959 | [D2-ai-output.md:129](D2-ai-output.md#L129) | finding | HO-4 / FI-2 | M Q | Data via code, not by eye (S) — "A fact you read, count or transcribe there needs no tool to confirm it" (`systemPrompt.ts:53`), uploaded-files guidance (176); PK-USE-04 asserts the absence — ADR-0049 chose by-eye for pages in view (live: 48/277/325 right) |
| F-0960 | [D2-ai-output.md:130](D2-ai-output.md#L130) | finding | SA-2, PT-3, PT-4, WB-1 | M R | India set: Tele-MANAS 14416, 112, SEBI adviser, ECI AI-label, private-individual profiling, fake records, phishing — `grep` for `Tele-MANAS — 14416 — SEBI — Election Commission — phishing` in `backend/src/services`: none (only Aadhaar in `memory/privacy.ts`) — Safety text is the Claude-app set (`systemPrompt.ts:81-100`), not the locked India rules |
| F-0961 | [D2-ai-output.md:131](D2-ai-output.md#L131) | finding | ME-* | L K | Memory rules ME-1…10 — far larger policy (`memory/policy.ts`), saved in-turn; listing on system side (K) — Covered by the memory deep-dive; here only its cost: ≈ 15 k chars every memory turn |
| F-0962 | [D2-ai-output.md:137](D2-ai-output.md#L137) | finding | RT-1 / MR1 | M R | Auto = rules → Gemini 3.8 Flash; Opus never default (Stage 18, §7.10 M1) — `routing.ts:47-77`: attachments → quality tier = Opus 5.5 (67-69); project instructions > 8 000 chars → Opus (70-72); the `research_mode` rule is unreachable (grounding rule first, 61-66); default Gemini (76) — Opus is chosen by rule; one dead rule |
| F-0963 | [D2-ai-output.md:138](D2-ai-output.md#L138) | finding | RT-3 / MR16 | H N | Complex work (coding, artifact building, multi-file analysis) → Sonnet when allowed; Deep → Opus — not found (searched `routeAuto` callers: `generation.ts:1320` only; no complexity input) — Sonnet only via manual pick or a prompt > 2 000 chars; ADR-0032 forbids prompt keywords, so a mechanism is needed (profile or Haiku router) |
| F-0964 | [D2-ai-output.md:139](D2-ai-output.md#L139) | finding | RT-4 / CR1 | — K | Effort per profile, always explicit — explicit and clamped (K): `anthropic.ts:490`, `gemini.ts:442`, `capabilitiesTable.ts:151-157` — no profile (see PR-1) |
| F-0965 | [D2-ai-output.md:140](D2-ai-output.md#L140) | finding | §7.9 params | — K | Thinking: Gemini LOW/MEDIUM/HIGH; Claude adaptive + effort; no sampling params — K: `gemini.ts:255-259`, `anthropic.ts:488-490`; no temperature/top_p/top_k in `backend/src` — none |
| F-0966 | [D2-ai-output.md:141](D2-ai-output.md#L141) | finding | Doc-sync 2026-10-10 | L D | Claude `display` stays default (omitted), Gemini `include_thoughts` off until Stage 14 — `display: summarized`, `includeThoughts: true` (`anthropic.ts:488`, `gemini.ts:441`) — Product choice, no quality effect; ADR-0030 |
| F-0967 | [D2-ai-output.md:142](D2-ai-output.md#L142) | finding | RT-6 / §7.12 | M N | ≤ 2 retries then fallback: Gemini → Sonnet, Sonnet → Gemini, Opus → Sonnet → Gemini; label every fallback — retries K (`generation.ts:1367-1453`); "there is no other model to fall back to" (1358) — No fallback hop; the Claude-switch/limit parts are owner-deferred |
| F-0968 | [D2-ai-output.md:143](D2-ai-output.md#L143) | finding | RT-9 / §7.10 | M Q | Role registry M1-M11 with version stamped per turn (L4-G48) — aliases only (`registry.ts:54-91`); no helper roles; compaction uses the turn's own model (`generation.ts:1691`) — Haiku 5.5 router/jobs (ADR-0013/0014) absent; build-plan B-4 says three models |
| F-0969 | [D2-ai-output.md:144](D2-ai-output.md#L144) | finding | Numbers | L R | N-06 Normal 5 / Deep 15 steps; N-09 ~8 k tokens; N-74 per-profile output — repo 16 rounds (`numbers.ts:43`), 6 000 chars (45), 64 000 tokens (41) — read cap ≈ 1.5 k tokens vs ≈ 8 k; flat limits |
| F-0970 | [D2-ai-output.md:145](D2-ai-output.md#L145) | finding | CC4 / MR10 | L R | Claude history byte-identical, thinking kept unless an earlier part is edited — thinking not stored with signatures (`schema` `messages.thinking` text only); not replayed (`anthropic.ts:313-338`) — Reasoning continuity across turns lost |
| F-0971 | [D2-ai-output.md:151](D2-ai-output.md#L151) | finding | RP-1 / VD-10 | L R | Live cheap checks: provider signals, canary/secret/internal-tag scan — `AnswerProtocolGuard` blocks `[Tool call]`, `[Result]`, `[Error]` outside code with a hard `tool_protocol_in_text` error (`answerProtocolGuard.ts:22-27`) — No canary/secret scan; a legitimate "[Error]" in prose fails the turn |
| F-0972 | [D2-ai-output.md:152](D2-ai-output.md#L152) | finding | VD-3 | M N | Truncation: one auto-continue (Normal/Deep) else notice + Continue — `finishReason` stored (`generation.ts:2152`); UI shows a cut-off notice (mistakes.md:554); no server continue — Auto-continue absent |
| F-0973 | [D2-ai-output.md:153](D2-ai-output.md#L153) | finding | VD-1/2, CI-2 | M N | Async claim-support judge; annotate low support — not found (searched `claim — judge — groundedness` in `backend/src`, non-test) — Absent |
| F-0974 | [D2-ai-output.md:154](D2-ai-output.md#L154) | finding | VD-6 | M N | Deterministic completion check; one more step if missing — only the empty-reply fallback (`generation.ts:1102-1165`) — Promised-vs-delivered check absent |
| F-0975 | [D2-ai-output.md:155](D2-ai-output.md#L155) | finding | VD-7 | M R | Artifact gate: reopen + render + recalc scan — structural reopen of pdf/xlsx/docx/pptx in `present_files` (`codeExecutionExecutor.ts:521-535`) — No render test or recalc/error scan |
| F-0976 | [D2-ai-output.md:156](D2-ai-output.md#L156) | finding | VD-8/9/11/12 | L N | Number reconciliation, language log, 10 % sampling, per-profile budgets — not found — Absent |
| F-0977 | [D2-ai-output.md:162](D2-ai-output.md#L162) | finding | X-1 | H R | ADR-0023 "No context editing… `CONTEXT_EDIT_*` removed" vs ADR-0031 §5 + `gemini.ts:382-408`, `config.ts:158-160`; the toolHistory integration test uses a FakeProvider, not the Gemini loop (`toolHistory.integration.test.ts:142`) — The rule from mistakes.md:621-636 is broken on the default model |
| F-0978 | [D2-ai-output.md:163](D2-ai-output.md#L163) | finding | X-2 | H R | `loadHistory(…, input.modelAlias)` before model resolution (`generation.ts:445-450`; again 556) — `Auto` → 128 000 window → ≈ 463 k char backstop on a 1 M model |
| F-0979 | [D2-ai-output.md:164](D2-ai-output.md#L164) | finding | X-3 | M R | Failed/blocked exchanges stay in history: no status filter (`generation.ts:1524-1552`); an empty answer becomes the literal turn "[Response stopped]" — Stage 6 doc-sync 2026-10-11 R-3 drops blocked exchanges; here a refusal or error becomes few-shot context |
| F-0980 | [D2-ai-output.md:165](D2-ai-output.md#L165) | finding | X-4 | M R | Non-native tool history is written as prose in the assistant turn (`types.ts:132-147`, `gemini.ts:206`, `anthropic.ts:328-329`); ADR-0043:26-30 says leaked protocol text was seen live, cause "plausible" only — Contaminates the model's own voice; the guard turns a leak into a failed turn |
| F-0981 | [D2-ai-output.md:166](D2-ai-output.md#L166) | finding | X-5 | M R | Prompt budget test raised to ≤ 10 000 est. tokens / 7 500 words (`behaviorEvaluation.test.ts:32-47`); ADR-0031 cut to 23 500 chars, ADR-0052 grew it back — The guard no longer guards |
| F-0982 | [D2-ai-output.md:167](D2-ai-output.md#L167) | finding | X-6 | M R | Live scripts target `claude-sonnet-5` and the old builder (`runBehaviorEvaluation.ts:3-20,256-268`, `measureStablePrefixTokens.ts:104`; the latter also holds a hard-coded project-id fallback, not reproduced here) and list removed tools (`read_uploaded_file`) — No working live eval |
| F-0983 | [D2-ai-output.md:168](D2-ai-output.md#L168) | finding | X-7 | L R | `describeMedia` sets no output cap and ignores the finish reason (`gemini.ts:314-329`); scanned PDFs are OCR'd in one call (`retrieval.ts:165-180`) — Silent truncation of OCR text feeding project search |
| F-0984 | [D2-ai-output.md:169](D2-ai-output.md#L169) | finding | X-8 | L R | Research directive demands a report with citations in chat (`generation.ts:2016`) vs "answers in chat… do not use report-style headers" (`systemPrompt.ts:69`; CURRENT.md:65-66 records the conflict) — Two instructions for one turn; Research runs on the cheap tier (`routing.ts:61-63`) |
| F-0985 | [D2-ai-output.md:170](D2-ai-output.md#L170) | finding | X-9 | L R | Gemini `<document filename="${a.filename}">` not escaped (`gemini.ts:74`) — Filename text enters the prompt as markup |
| F-0986 | [D2-ai-output.md:171](D2-ai-output.md#L171) | finding | X-10 | L R | Duplicate failed-call guard only in the Claude adapter (`anthropic.ts:595`) — Gemini can loop on the same failing call until round 16 |
| F-0987 | [D2-ai-output.md:178](D2-ai-output.md#L178) | hypothesis | H1 | Hypothesis | H1 — Hypothesis: the universal Claude-app-shaped prompt and 35-tool surface fit Gemini 3.8 Flash badly (default model) |
| F-0988 | [D2-ai-output.md:184](D2-ai-output.md#L184) | hypothesis | H2 | Hypothesis | H2 — Hypothesis: concision and minimal-format directives plus a terse-by-default model produce thin answers |
| F-0989 | [D2-ai-output.md:190](D2-ai-output.md#L190) | hypothesis | H3 | Hypothesis | H3 — Hypothesis: Auto keeps nearly all work on Gemini 3.8 Flash and then pins the chat to it |
| F-0990 | [D2-ai-output.md:196](D2-ai-output.md#L196) | hypothesis | H4 | Hypothesis | H4 — Hypothesis: long-chat context is dropped or cleared, so follow-ups forget results |
| F-0991 | [D2-ai-output.md:202](D2-ai-output.md#L202) | hypothesis | H5 | Hypothesis | H5 — Hypothesis: tool-first procedure and files-not-in-context add rounds, latency and failure points |
| F-0992 | [D2-ai-output.md:208](D2-ai-output.md#L208) | hypothesis | H6 | Hypothesis | H6 — Hypothesis: history is polluted (error rows, "[Response stopped]", tool history as prose) |
| F-0993 | [D2-ai-output.md:214](D2-ai-output.md#L214) | hypothesis | H7 | Hypothesis | H7 — Hypothesis: nobody can see quality, so regressions persisted |
| F-0994 | [D2-ai-output.md:220](D2-ai-output.md#L220) | hypothesis | H8 | Hypothesis | H8 — Hypothesis: locale defaults and unlocked safety text degrade fit for Indian users |
| F-0995 | [D2-ai-output.md:260](D2-ai-output.md#L260) | test-gap | S1-S18: CI-1/FI-1 citations + partial coverage, HO-1, HO-3, ID-1/2, CP-1/AR-3, TI-3/WS-2, ME-7, AR-1, ST-6, SA-4/ST-7, UC-1/2, AU-4/CF-1, HO-7, PT-3, ST-3, ST-4/HO-4, ST-9/HO-5, ST-2 (Gemini terse) |  | no: the repo's `PK-*` assert strings of its own prompt; the 19 live-only cases are generic (`PK-FMT-05`, `PK-USE-08`…) and skipped |
| F-0996 | [D2-ai-output.md:261](D2-ai-output.md#L261) | test-gap | T1-T16: fetch/TO-5, TO-7 queries, ME-4/6, SK-1/3, AR-4, TO-4 retries, UC via tool, PR-1 fast/deep, CI-6 |  | no |
| F-0997 | [D2-ai-output.md:262](D2-ai-output.md#L262) | test-gap | A1-A4, C1-C2, Y1-Y3, H1-H2, CT1-2, TM1, P1-P5, W1, K1-K3, CR1-2, L1-L3, M1-M3, LC1, LG1-2 |  | no (PK-SAFE-01..04 are `liveOnly`) |
| F-0998 | [D2-ai-output.md:266](D2-ai-output.md#L266) | test-gap |  |  | 0 of 68 behavioural cases executable; "kit critical gates 100 %" (build plan P1-D, exit line 61) is satisfied by string presence, so the gate is vacuous for behaviour. |
| F-0999 | [D2-ai-output.md:267](D2-ai-output.md#L267) | test-gap |  |  | 70 offline cases assert the repo's own wording (`toContain`), so they fail on any prompt change and pass on any poor answer. PK-LANG-01..03 assert the language rule that CXD-1 removed. |
| F-1000 | [D2-ai-output.md:268](D2-ai-output.md#L268) | test-gap |  |  | The prompt-size bound exists but was raised to 10 000 est. tokens (X-5); no per-section or per-tool budget; no tool-declaration size test. |
| F-1001 | [D2-ai-output.md:269](D2-ai-output.md#L269) | test-gap |  |  | No provider-request snapshot tests: nothing pins system block order, tool list, thinking/effort params or cache breakpoints per provider (ours: golden JSON per provider for five canonical turns). |
| F-1002 | [D2-ai-output.md:270](D2-ai-output.md#L270) | test-gap |  |  | `loadHistory` has no test with the `Auto` alias or with a chat over the backstop; Gemini result clearing has no integration test against ADR-0023; blocked-exchange omission untested. |
| F-1003 | [D2-ai-output.md:271](D2-ai-output.md#L271) | test-gap |  |  | No test that `temperature\|top_p\|top_k` never appear (grep guard, ours) although the rule is in CLAUDE.md of the Python repo and Stage 6. |
| F-1004 | [D2-ai-output.md:272](D2-ai-output.md#L272) | test-gap |  |  | No Stage 13 tests (truncation continue, claim support, completion, canary); no routing test for RT-3 or the §7.12 fallback matrix. |
| F-1005 | [D2-ai-output.md:273](D2-ai-output.md#L273) | test-gap |  |  | Live scripts stale (X-6); none is wired to CI or to a documented owner run. |
| F-1006 | [D2-ai-output.md:274](D2-ai-output.md#L274) | test-gap |  |  | Retrieved project text injection: no case that puts `</memory>`-style or instruction text in a project file and checks placement (PK-PREC-04 covers only the five wrapped blocks). |
| F-1007 | [D2-ai-output.md:278](D2-ai-output.md#L278) | question |  |  | Which governs the system prompt: the build-plan row "0057 repo prompt kept (ADR-0049/0052 lineage) instead of policy-spec v3" (`00-build-plan-arcnave-tech.md:33`) or Stage 6 CXD-3b with the 2026-10-15 rule? Not resolved here. |
| F-1008 | [D2-ai-output.md:279](D2-ai-output.md#L279) | question |  |  | Tool vocabulary: v3 names the Stage 8 set (`file_search`, `fetch_url`, `run_code`, `load_skill`, `memory_save`…), the repo declares 35 other tools (ADR-0047/0048). Which set does a v3 rendering describe? |
| F-1009 | [D2-ai-output.md:280](D2-ai-output.md#L280) | question |  |  | Compaction: planned "0058 compaction kept for the prototype" vs CXD-5/6 and N-03/N-16 (profile budgets, summary at 60 %, last 6 turns). |
| F-1010 | [D2-ai-output.md:281](D2-ai-output.md#L281) | question |  |  | Build-plan B-4 "three models only" vs Haiku 5.5 as router and worker-job model (ADR-0013/0014, Stage 7 doc-syncs 2026-10-12/14). Needed before any router or summariser role. |
| F-1011 | [D2-ai-output.md:282](D2-ai-output.md#L282) | question |  |  | Language: keep the Tanglish/Latin-script rule (ADR-0043/0049) or restore CXD-1 removal. |
| F-1012 | [D2-ai-output.md:283](D2-ai-output.md#L283) | question |  |  | Math delimiter: `\( \)` per ST-4/S16 or the frontend's `$$` KaTeX. |
| F-1013 | [D2-ai-output.md:284](D2-ai-output.md#L284) | question |  |  | Reinstate or formally supersede ADR-0023 for Gemini (X-1) — the repo currently does both. |
| F-1014 | [D2-ai-output.md:285](D2-ai-output.md#L285) | question |  |  | Which turns were "very poor"? Send message ids (turn logs) and the model alias shown in the UI; and the live values of `ENABLE_TOOL_USE`, `ENABLE_WEB`, grounding flags, `TOOL_MAX_ROUNDS`, `PRICING_TABLE` (unreadable to this audit). |
| F-1015 | [D2-ai-output.md:286](D2-ai-output.md#L286) | question |  |  | Knowledge-cutoff line: Stage 7 §7.9 lists cutoffs, `systemPrompt.ts:142` refuses to state any. Which wins? |
| F-1016 | [D2-ai-output.md:287](D2-ai-output.md#L287) | question |  |  | Owner-deferred items touched but not bucketed: company/project/user precedence levels (company tenancy), Claude per-company switch and limit (RT-7/RT-8, dropped by ADR-0053 #6), NO_CONTENT, OTel. |

## D3 architecture (44)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1017 | [D3-architecture.md:113](D3-architecture.md#L113) | flaw | A-01 | P1 | A-01 — Run control state is a per-process Map and an in-memory buffer |
| F-1018 | [D3-architecture.md:148](D3-architecture.md#L148) | flaw | A-02 | P1 | A-02 — Runs are not durable: text saved only at the end, no reaper, no drain on SIGTERM |
| F-1019 | [D3-architecture.md:176](D3-architecture.md#L176) | flaw | A-03 | P1 | A-03 — Concurrent send: check-then-set gap and unlocked `max(seq)` |
| F-1020 | [D3-architecture.md:200](D3-architecture.md#L200) | flaw | A-04 | P1 | A-04 — Retry (regenerate) is unguarded writes and keeps stale tool calls |
| F-1021 | [D3-architecture.md:221](D3-architecture.md#L221) | flaw | A-05 | P1 | A-05 — A turn is settled by independent commits, in two different orders |
| F-1022 | [D3-architecture.md:247](D3-architecture.md#L247) | flaw | A-06 | P1 | A-06 — Budget: two sources of truth, reservations with no owner or expiry |
| F-1023 | [D3-architecture.md:269](D3-architecture.md#L269) | flaw | A-07 | P1 | A-07 — Retries, timeouts and ER-1 live outside the provider boundary; no breaker |
| F-1024 | [D3-architecture.md:296](D3-architecture.md#L296) | flaw | A-08 | P1 | A-08 — The SSRF guard is a hostname regex |
| F-1025 | [D3-architecture.md:318](D3-architecture.md#L318) | flaw | A-09 | P1 | A-09 — Rate-limit key is the proxy address and is computed before the session exists |
| F-1026 | [D3-architecture.md:341](D3-architecture.md#L341) | flaw | A-10 | P1 | A-10 — Migrations run at container boot and failures are ignored |
| F-1027 | [D3-architecture.md:359](D3-architecture.md#L359) | flaw | A-11 | P1 | A-11 — Retrieval loads every chunk of the project into Node memory per query |
| F-1028 | [D3-architecture.md:376](D3-architecture.md#L376) | flaw | A-12 | P1 | A-12 — Warm sandbox keeps per-chat state in one long-lived process (against TD-4b), capacity 5 |
| F-1029 | [D3-architecture.md:400](D3-architecture.md#L400) | flaw | A-13 | P2 | A-13 — `services/generation.ts` (2,381 lines) is one class, one 830-line generator |
| F-1030 | [D3-architecture.md:414](D3-architecture.md#L414) | flaw | A-14 | P2 | A-14 — `routes/chats.ts` (1,215 lines) holds DTOs, SQL, version logic and run orchestration |
| F-1031 | [D3-architecture.md:431](D3-architecture.md#L431) | flaw | A-15 | P2 | A-15 — Frontend: nine monoliths, hand-written API types, hard-coded production URL |
| F-1032 | [D3-architecture.md:449](D3-architecture.md#L449) | flaw | A-16 | P2 | A-16 — Container is bypassed: global `getDb()` singletons and a 12-field `Services` bag |
| F-1033 | [D3-architecture.md:468](D3-architecture.md#L468) | flaw | A-17 | P2 | A-17 — Config sprawl |
| F-1034 | [D3-architecture.md:490](D3-architecture.md#L490) | flaw | A-18 | P2 | A-18 — Duplicated paths for the same job |
| F-1035 | [D3-architecture.md:514](D3-architecture.md#L514) | flaw | A-19 | P2 | A-19 — Dead code, default-off feature flags, scripts in the shipped tree |
| F-1036 | [D3-architecture.md:537](D3-architecture.md#L537) | flaw | A-20 | P2 | A-20 — Uploads and indexing run inside the request; the queue is per-process |
| F-1037 | [D3-architecture.md:556](D3-architecture.md#L556) | flaw | A-21 | P2 | A-21 — Network I/O inside database transactions |
| F-1038 | [D3-architecture.md:572](D3-architecture.md#L572) | flaw | A-22 | P2 | A-22 — Lost updates and multi-statement writes without a transaction |
| F-1039 | [D3-architecture.md:589](D3-architecture.md#L589) | flaw | A-23 | P2 | A-23 — Error handling: untyped throws and about 65 silent catch sites |
| F-1040 | [D3-architecture.md:610](D3-architecture.md#L610) | flaw | A-24 | P2 | A-24 — Four code-execution paths and a shell string |
| F-1041 | [D3-architecture.md:625](D3-architecture.md#L625) | flaw | A-25 | P2 | A-25 — Auth read path writes on every request |
| F-1042 | [D3-architecture.md:636](D3-architecture.md#L636) | flaw | A-26 | P2 | A-26 — SSE transport bypasses Fastify and buffers by event count |
| F-1043 | [D3-architecture.md:647](D3-architecture.md#L647) | flaw | A-27 | P2 | A-27 — Test gaps (details in `_parts/evidence-d3.md`) |
| F-1044 | [D3-architecture.md:672](D3-architecture.md#L672) | deferred | Redis stream relay (Stage 4 L-3, Stage 5 F2, ER-5) |  | Reattach across instances (A-01) — **No**, if `RunHub` stays the only publish and replay seam and event ids stay monotonic integers (they are: `runHub.ts:44-53`, SSE `id` at `chats.ts:828`). **Yes**, if more code reads `activeRuns` (readers today: `chats.ts:430,446,565,568,656,707,709`, `account.ts:97,104`, `index.ts:71`). — Fold `activeRuns` into the DB lease (A-01 pick A); add no new `activeRuns` reader. |
| F-1045 | [D3-architecture.md:673](D3-architecture.md#L673) | deferred | Redis locks (R13 lease plus fencing) |  | One run per chat across instances — **No**: ER-5 says DB fencing decides commits even with Redis. The DB lease in A-01 is that layer. — Build the lease row and the conditional claim now. |
| F-1046 | [D3-architecture.md:674](D3-architecture.md#L674) | deferred | Redis rate-limit store |  | Per-user limits across instances — **No**: `@fastify/rate-limit` takes a `redis` option. — Fix the key and `trustProxy` now (A-09). |
| F-1047 | [D3-architecture.md:675](D3-architecture.md#L675) | deferred | Cloud Tasks Turn Executor (O-3, AO-4, ER-4, ER-7) |  | Turn runs outside the API request — **Yes, partly**: the run's inputs exist only in the request (`chats.ts:570-626`: `codeExecution`, `effort`, `styleId`, `modelAlias`, attachment refs) and in memory; a delivery on another instance could not rebuild them. **No** once the turn parameters are stored. — Persist the turn parameters (a JSON column on the assistant row or `turns`) in `appendTurn`; make `GenerationService.run` loadable from a message id. Both sit inside A-01 and A-13. |
| F-1048 | [D3-architecture.md:676](D3-architecture.md#L676) | deferred | Checkpoint resume (AS-D3, ER-3 continuation) |  | Resume after SIGTERM or crash — **No** if A-02 flushes text and tool calls stay persisted per call (`generation.ts:992`). — Throttled text flush (A-02). |
| F-1049 | [D3-architecture.md:677](D3-architecture.md#L677) | deferred | Cloud Tasks for file and OCR jobs, worker, DB-polling dispatch (ER-7, Stage 19 ID-15/16) |  | Upload and index outside the request — **Yes, mildly**: `finishUpload` takes a Fastify `request` (`files.ts:501-506`) and `runIndex` is also request-bound, so neither can be called from a worker. — Make both pure functions of (stored object, row) now; add the jobs table with a polling loop (A-20 option B), which is the Delhi fallback and not throwaway. |
| F-1050 | [D3-architecture.md:678](D3-architecture.md#L678) | deferred | Company and tenancy, RLS context (owner-deferred, not infra) |  | `SET LOCAL` company on every query — **Yes**: the schema has no `company_id` (`schema.ts`, 0 matches); `uq_usage_period`, `uq_memory_user_scope_key` and `uq_idempotency` start with `user_id` where D15 wants `company_id` first; and every query runs on the shared pool or on a `getDb()` singleton (A-16). — Stop adding `getDb()` call sites; inject `DbLike` (as `copyMessages` already does, `chats.ts:1031`); add no new unique key without room for a leading column. |
| F-1051 | [D3-architecture.md:679](D3-architecture.md#L679) | deferred | NO_CONTENT enforce, OTel, Terraform |  | Phase 5 — Not forced by anything found. Note for the owner: 35 `{ err }` log calls (A-23) and `String(err)` logging of provider errors (A-07) are the enforce-time work. — Nothing now. |
| F-1052 | [D3-architecture.md:683](D3-architecture.md#L683) | question |  |  | **Q1 (B-4 versus the fallback chain).** Stage 15 ER-2 and ER-13 and Stage 4 L4-G18 describe a fallback chain and a breaker that routes to a second model; B-4 says three models only and Invariant 1 forbids silent substitution. A-07 builds retry and breaker only. Does the owner want a labelled fallback to a second model, and between which two? Not resolved here. |
| F-1053 | [D3-architecture.md:687](D3-architecture.md#L687) | question |  |  | **Q2 (TD-4b versus the warm sandbox).** Keep ADR-0010 / ADR-0015 as an accepted DIFF-INFRA, or make the fresh-per-run engine the default (A-12 pick A)? Cost: 20-40 s per call on cold Jobs versus a five-chat site-wide workspace cap. |
| F-1054 | [D3-architecture.md:690](D3-architecture.md#L690) | question |  |  | **Q3 (durability level before Cloud Tasks).** Is "sweeper plus text flush plus drain" (A-02 pick A) the agreed interim, so a deploy mid-turn costs at most a few seconds of text? |
| F-1055 | [D3-architecture.md:692](D3-architecture.md#L692) | question |  |  | **Q4 (edge and cookies).** The frontend calls a literal Cloud Run URL cross-origin with `SameSite=None` (`api.ts:19-33`); Stage 2 / L2 name `app.` and `api.arcnave.in`. Is the same-site hostname move part of the infra work, and may the project number come out of source? |
| F-1056 | [D3-architecture.md:695](D3-architecture.md#L695) | question |  |  | **Q5 (two paths each).** For file reading and for Office creation (A-18 a and b), which side is the product path: upload-time text with code on demand, or code-first; TypeScript renderers or Python skills? |
| F-1057 | [D3-architecture.md:698](D3-architecture.md#L698) | question |  |  | **Q6 (new dependencies).** `CLAUDE.md` in this repo has no "stop and ask" rule, but Stage 20 pins the stack. May a dev dependency for OpenAPI types (A-15) or an SSE helper (A-26) be added? |
| F-1058 | [D3-architecture.md:700](D3-architecture.md#L700) | question |  |  | **Q7 (database version).** CI runs PG16 (`ci.yml:24`); the locked L7 expects PG18 with `pg_textsearch` (PG17+). Which version is the build target for A-11? |
| F-1059 | [D3-architecture.md:702](D3-architecture.md#L702) | question |  |  | **Q8 (fetch service).** Is the hardened in-process fetch of A-08 acceptable until a zero-permission fetch service (TD-3) exists? |
| F-1060 | [D3-architecture.md:704](D3-architecture.md#L704) | question |  |  | **Q9 (tenancy order).** Section 4 shows `getDb()` singletons and `user_id`-first unique keys will cost a rewrite if the company work starts first. Confirm that A-16 option A may land before Phase 5. |

## Numbers (100)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1061 | [numbers-diff.md:10](numbers-diff.md#L10) | number | N-01 | DIFF (write 120 vs 20); ABSENT (company, edge); auth 10 and share 60 are NOT-WIRED (no N-id) | Rate limits req/min — register: user 20 / company 300 / edge 600 (Stage 18) — repo: generate 20; write 120; auth 10; public share 60; company, edge: none — numbers.ts:65,67; config:366-371; `app.ts:93-101` |
| F-1062 | [numbers-diff.md:11](numbers-diff.md#L11) | number | N-02 | DIFF + NOT-WIRED | Message size — register: 32k chars — repo: prompt max 100,000 chars — `routes/chats.ts:543` |
| F-1063 | [numbers-diff.md:12](numbers-diff.md#L12) | number | N-03 | ABSENT | Input token budget per profile — register: Fast 16k / Normal 48k / Deep 200k — repo: none; no Fast/Normal/Deep profiles (effort levels instead); compaction trigger fallback 150,000 tokens — config:313 |
| F-1064 | [numbers-diff.md:13](numbers-diff.md#L13) | number | N-04 | ABSENT | Retrieval share in budget — register: Fast 6k / Normal 20k / Deep 80k — repo: none — - |
| F-1065 | [numbers-diff.md:14](numbers-diff.md#L14) | number | N-05 | DIFF + NOT-WIRED | Whole-file limit — register: 30k tokens (Deep 100k test arm) — repo: 200,000 characters (~50k tokens) — config:171 (`PROJECT_FULL_CONTEXT_MAX_CHARS`) |
| F-1066 | [numbers-diff.md:15](numbers-diff.md#L15) | number | N-06 | DIFF | Tool steps; turn deadline — register: Fast 1-2 / Normal 5 / Deep 15; turn 10 min — repo: 16 rounds; turn deadline 3,540,000 ms (59 min) — numbers.ts:39,43; config:150,206 |
| F-1067 | [numbers-diff.md:16](numbers-diff.md#L16) | number | N-07 | DIFF (search) + NOT-WIRED; ABSENT (others) | Per-turn caps search / run_code / fetch_url / artifacts / file_search — register: 1-3-8 / 1-3-8 / 2-5-10 / 3-5-10 / 1-3-6 — repo: Anthropic web_search `max_uses: 5`; other caps none — `providers/anthropic.ts:38` |
| F-1068 | [numbers-diff.md:17](numbers-diff.md#L17) | number | N-08 | DIFF; NOT-WIRED (20 concurrent, MAX_CODE_BYTES) | Sandbox time / RAM / files — register: 60 s (Deep 120 s) / 4 GiB / <=30 MB x10, ~5 parallel per company, workspace ~500 MB — repo: code timeout 10 s (Job), 300 s (warm); 8 GiB service; global concurrency 20; code 20 KiB — numbers.ts:51,53; config:262,266,285; `docs/deploy/warm-sandbox.md:44` |
| F-1069 | [numbers-diff.md:18](numbers-diff.md#L18) | number | N-09 | DIFF (unit and size); fetch 1 MB NOT-WIRED | Tool result cap — register: ~8k tokens + pagination — repo: 6,000 chars (read_project_file); 30,000 chars (run_python); preview 300 chars; web fetch 1 MB — numbers.ts:45,47; config:214; `services/webFetch.ts:42` |
| F-1070 | [numbers-diff.md:19](numbers-diff.md#L19) | number | N-10 | MATCH (1,000 pp; 20/chat; 10/msg); DIFF (image 10 MB vs 20, XLSX 50 MB not per type, ZIP none, audio 3 h none); NOT-WIRED (FILE_LIMITS, chats.ts:546) | Upload limits — register: docs 100 MB/1,000 pp, XLSX 50 MB, images 20 MB, audio 500 MB/3 h, ZIP 100 MB/20 files/500 MB, <=10 files/msg, <=20/chat — repo: project files 30 MB; chat attachment cap 500 MB (single cap); PDF 1,000 pages; image 10 MB / 8,000 px; 20 files per chat; 10 attachments per message — numbers.ts:57,59; `services/attachments/processUpload.ts:29-37`; `routes/chats.ts:546` |
| F-1071 | [numbers-diff.md:20](numbers-diff.md#L20) | number | N-11 | ABSENT | Upload quotas (per-user rate, OCR pages, audio minutes) — register: 50/user/day, OCR 5,000 pp/company/month (+5,000), audio 120 min/user/month — repo: none — - |
| F-1072 | [numbers-diff.md:21](numbers-diff.md#L21) | number | N-12 | ABSENT | Mic max length — register: 2 min — repo: browser recognition, no cap found — `arcnave-frontend/src/Dictation.tsx:44` |
| F-1073 | [numbers-diff.md:22](numbers-diff.md#L22) | number | N-13 | DIFF + NOT-WIRED | Page images to model — register: Fast 3 / Normal 8 / Deep 20 — repo: PDF read visually up to 100 pages — `processUpload.ts:33` |
| F-1074 | [numbers-diff.md:23](numbers-diff.md#L23) | number | N-14 | DIFF + NOT-WIRED | Chunk size / overlap — register: ~800 tokens / ~15 % — repo: 1,400 chars target / 180 chars overlap (~350 tokens / ~13 %); 400 chunks per file — `services/retrieval.ts:20-22` |
| F-1075 | [numbers-diff.md:24](numbers-diff.md#L24) | number | N-15 | ABSENT | Embedding dims — register: 1,536 — repo: no embeddings (invariant 4) — `CLAUDE.md:25-26` |
| F-1076 | [numbers-diff.md:25](numbers-diff.md#L25) | number | N-16 | DIFF + NOT-WIRED | History summary trigger — register: >~60 % of history budget; keep last 6 turns — repo: compaction when headroom < 10,000 tokens or < 15 % of window; fallback 150,000 tokens; no "last 6 turns" rule found — config:313-317 |
| F-1077 | [numbers-diff.md:26](numbers-diff.md#L26) | number | N-17 | DIFF; NOT-WIRED (16 KiB, 100, 500) | Memory caps — register: <=40 docs/user, <=3k tokens/doc, profile <=300 words, snapshot <=1.5k, prefetch <=3k — repo: file 16 KiB; context memory 8,000 chars; list 100; import 500 items — `services/memory/memoryService.ts:23,25`; config:307; `memoryTransfer.ts:13` |
| F-1078 | [numbers-diff.md:27](numbers-diff.md#L27) | number | N-18 | MATCH (default off); ABSENT (quota) | Search quota per company (monthly) + web search default OFF — register: 1,000 searches/company/month; default OFF — repo: web search flags default false; no quota — config:179-181 |
| F-1079 | [numbers-diff.md:28](numbers-diff.md#L28) | number | N-19 | ABSENT | Research mode caps — register: per run 30 min / 50 searches / 5 helpers; 5 runs/company/month — repo: no Research run caps found (a `research_events` table is referenced at `services/generation.ts:2063`) — - |
| F-1080 | [numbers-diff.md:29](numbers-diff.md#L29) | number | N-20 | ABSENT | Long-task quota; 2 concurrent research runs/user — register: 20 per company/month; 2 — repo: none — - |
| F-1081 | [numbers-diff.md:30](numbers-diff.md#L30) | number | N-21 | see rows | Timeouts and retries matrix — register: Stage 15 — repo: see N-42, N-43, N-31 — - |
| F-1082 | [numbers-diff.md:31](numbers-diff.md#L31) | number | N-22 | N/A-deferred | Turn task: dispatch deadline / executor timeout / retries — register: 15 min / >=15 min / 1 from checkpoint (Cloud Tasks) — repo: no executor — - |
| F-1083 | [numbers-diff.md:32](numbers-diff.md#L32) | number | N-23 | N/A-deferred | API request timeout / concurrency — register: >=20 min / 80 — repo: request timeout 3,600 s referenced only in a comment; concurrency set by deployment — config:147-150 |
| F-1084 | [numbers-diff.md:33](numbers-diff.md#L33) | number | N-24 | MATCH (ping, NOT-WIRED); DIFF (retention 5 min vs 15) | SSE ping interval; Redis stream retention — register: 15 s; ~15 min after done — repo: ping 15,000 ms; in-process buffer kept 5 min after finish, 50,000 events — `routes/chats.ts:813-815`; `services/runHub.ts:17,20` |
| F-1085 | [numbers-diff.md:34](numbers-diff.md#L34) | number | N-25 | N/A-deferred | Executor min instances / memory — register: min 0 dev; memory by measurement — repo: no executor — - |
| F-1086 | [numbers-diff.md:35](numbers-diff.md#L35) | number | N-26 | ABSENT | Reranker model / candidates / latency — register: Vertex Ranking API, top 30, p95 <= 600 ms — repo: none — - |
| F-1087 | [numbers-diff.md:36](numbers-diff.md#L36) | number | N-27 | ABSENT | Retrieval latency budget — register: p95 <= 1,200 ms — repo: none measured — - |
| F-1088 | [numbers-diff.md:37](numbers-diff.md#L37) | number | N-28 | ABSENT | Planner timeout — register: ~300 ms — repo: none — - |
| F-1089 | [numbers-diff.md:38](numbers-diff.md#L38) | number | N-29 | ABSENT (company); see deferred file | Claude per-company monthly limit INR + 80 % alert — register: set per plan — repo: per-user `monthly_token_budget` only; company switch dropped (ADR-0053 #6) — `db/schema.ts:102` |
| F-1090 | [numbers-diff.md:39](numbers-diff.md#L39) | number | N-30 | ABSENT (tenancy deferred) | Company plan limits — register: college pool 5,000 turns, 600 soft cap per user, 50 accounts, 50 GB — repo: none — - |
| F-1091 | [numbers-diff.md:40](numbers-diff.md#L40) | number | N-31 | ABSENT (conflict flagged in stage notes) | Fallback retries before switching model — register: <=2 retries, backoff >=1 s — repo: no cross-model fallback; invariant 1 "never substitute silently" — `CLAUDE.md:18-20` |
| F-1092 | [numbers-diff.md:41](numbers-diff.md#L41) | number | N-32 | N/A-deferred | DB HA switch; backups / PITR; connection budget — register: before first paying customer; 7 d + 7 d — repo: managed by Cloud SQL, not in repo — - |
| F-1093 | [numbers-diff.md:42](numbers-diff.md#L42) | number | N-33 | DIFF | Deletion SLA / cascade — register: <=30 d total; cascade <=23 d; soft delete 7 d — repo: purge 30 days after delete (no 7 d soft delete / 23 d cascade split) — numbers.ts:61; config:336 |
| F-1094 | [numbers-diff.md:43](numbers-diff.md#L43) | number | N-34 | ABSENT | Retention: jobs 30 d, audit >=1 yr, safety content 30 d, deletion ledger 1 yr, idempotency keys 24 h — register: as listed — repo: no jobs / audit / safety / ledger tables; no idempotency store (header allowed in CORS only) — `app.ts:88` |
| F-1095 | [numbers-diff.md:44](numbers-diff.md#L44) | number | N-35 | DIFF + NOT-WIRED | Company / project instructions / user memory line — register: <=3,000 / <=5,000 / <=300 chars — repo: user instructions 20,000; project instructions 20,000 — `routes/preferences.ts:87`; `routes/projects.ts:181,266` |
| F-1096 | [numbers-diff.md:45](numbers-diff.md#L45) | number | N-36 | NOT-WIRED | Price table (effective-dated) — register: Gemini 3.8 $0.75/$3.75 -> $1.50/$7.50 on 2027-01-01; Sonnet $2/$10; Opus $4/$20; ... — repo: env JSON `PRICING_TABLE`, no rows in code, no effective date — config:384-398; `services/usage.ts:121` |
| F-1097 | [numbers-diff.md:46](numbers-diff.md#L46) | number | N-37 | MATCH (value); ABSENT (source / cadence update) | FX source and cadence — register: planning INR 88/USD; Google monthly + FBIL — repo: 88 — numbers.ts:83; config:378 |
| F-1098 | [numbers-diff.md:47](numbers-diff.md#L47) | number | N-38 | N/A-deferred | Priority PayGo / PT decision point — register: at Claude spend > 1 GSU-month x3 — repo: decision only — - |
| F-1099 | [numbers-diff.md:48](numbers-diff.md#L48) | number | N-39 | DIFF + NOT-WIRED | Artifact caps — register: 5 MB / 20 versions / 50 per chat — repo: content 400,000 chars; versions append-only, no cap; no per-chat cap — `routes/artifacts.ts:38` |
| F-1100 | [numbers-diff.md:49](numbers-diff.md#L49) | number | N-40 | ABSENT | Validation (Stage 13) judge share, reask, auto-continue, sampling 10 % — register: as listed — repo: no judge / sampling — - |
| F-1101 | [numbers-diff.md:50](numbers-diff.md#L50) | number | N-41 | NOT-WIRED; coalesce interval not found | Rendering: coalesce interval, preview rows, preview TTL, chat page size, formulas — register: provisional (no number for rows) — repo: sheet preview 200 rows x 50 cols, 25 MB; list page default 30 (max 100) — `services/documents/sheetPreview.ts:8-9`; `routes/sheetPreview.ts:10`; `routes/helpers.ts:21` |
| F-1102 | [numbers-diff.md:51](numbers-diff.md#L51) | number | N-42 | MATCH | Model retries — register: <=2 before first token; 1 s -> 2 s + full jitter, cap 8 s; Retry-After cap 10 s — repo: 2; 1,000 ms; 8,000 ms; 10,000 ms — numbers.ts:23-29; config:140-146; `services/generation.ts:1355-1445,2346-2350` |
| F-1103 | [numbers-diff.md:52](numbers-diff.md#L52) | number | N-43 | DIFF; fetch_url MATCH (NOT-WIRED) | Timeouts — register: first-token Fast 20 / Normal 45 / Deep 90 s; stall 30 s; file_search 2, memory 2, web_search 20, fetch_url 10, run_code 60/120, load_skill 1 s; turn 10 min; executor 15 min; API SSE >=20 min — repo: no first-token / stall cutoff (ADR-0024); request 600,000 ms; fetch_url 10,000 ms; turn 3,540,000 ms; connect 10,000 ms — numbers.ts:35,39; config:137-138,150; `services/webFetch.ts:41` |
| F-1104 | [numbers-diff.md:53](numbers-diff.md#L53) | number | N-44 | N/A-deferred | Cloud Tasks queues — register: turns 2 attempts / 20 min ... — repo: no queue — - |
| F-1105 | [numbers-diff.md:54](numbers-diff.md#L54) | number | N-45 | ABSENT | DB timeouts — register: statement API 5 s / retrieval 2 s / executor 30 s; lock 2 s; idle-in-tx 30 s; pool_recycle 1,800 s; shutdown 2 s — repo: none set; pool without max lifetime — `db/client.ts:35-52` |
| F-1106 | [numbers-diff.md:55](numbers-diff.md#L55) | number | N-46 | DIFF + NOT-WIRED | Client reconnect — register: backoff 1/2/4/8/16 s + jitter, 5 attempts — repo: delays 0, 1, 2, 4, 8, 15, 30, 60 s (8 attempts, no jitter seen) — `arcnave-frontend/src/adapter.ts:162-163,192` |
| F-1107 | [numbers-diff.md:56](numbers-diff.md#L56) | number | N-47 | ABSENT | Circuit breaker — register: open after 5 failures/30 s or >=50 % of 20; half-open 30 s; retry budget <=10 % — repo: none (searched `circuit`, `breaker`) — - |
| F-1108 | [numbers-diff.md:57](numbers-diff.md#L57) | number | N-48 | N/A-deferred | Redis degraded trigger — register: unreachable > 5 s — repo: no Redis — - |
| F-1109 | [numbers-diff.md:58](numbers-diff.md#L58) | number | N-49 | DIFF (14 d vs 28 d; no idle, no access / refresh); ABSENT (re-auth window, reCAPTCHA) | Auth TTLs — register: access 15 min; refresh rotation; user idle 24 h / absolute 28 d; owner/admin absolute 24 h; re-auth 10 min; reCAPTCHA 0.5 — repo: one server session, absolute 14 days (336 h), `last_seen_at` touched, no idle limit, no refresh, no reCAPTCHA — numbers.ts:73; config:84; `services/auth.ts:278,309` |
| F-1110 | [numbers-diff.md:59](numbers-diff.md#L59) | number | N-50 | N/A-deferred | Trace head sampling — register: 10 % normal, 100 % errors — repo: no tracing — - |
| F-1111 | [numbers-diff.md:60](numbers-diff.md#L60) | number | N-51 | N/A-deferred | Audit bucket 400 d; Bucket Lock 1 y; `audit_event` 1 y — register: as listed — repo: none — - |
| F-1112 | [numbers-diff.md:61](numbers-diff.md#L61) | number | N-52 | N/A-deferred | App logs 30 d; traces 30 d; client telemetry 90 d — register: as listed — repo: log sinks outside repo — - |
| F-1113 | [numbers-diff.md:62](numbers-diff.md#L62) | number | N-53 | N/A-deferred | SLOs — register: 99.5 % / 99 % / 97 % / p90 3 s, 8 s — repo: none — - |
| F-1114 | [numbers-diff.md:63](numbers-diff.md#L63) | number | N-54 | N/A-deferred | Burn-rate windows — register: 1 h/5 m 14.4x; 6 h/30 m 6x — repo: none — - |
| F-1115 | [numbers-diff.md:64](numbers-diff.md#L64) | number | N-55 | N/A-deferred | Alert thresholds — register: as listed — repo: none — - |
| F-1116 | [numbers-diff.md:65](numbers-diff.md#L65) | number | N-56 | N/A-deferred | Custom metric cardinality — register: <=20k series — repo: no metrics — - |
| F-1117 | [numbers-diff.md:66](numbers-diff.md#L66) | number | N-57 | ABSENT | Ledger vs billing drift tolerance — register: 2 % — repo: usage ledger exists, no billing-export reconciliation — `services/usage.ts` |
| F-1118 | [numbers-diff.md:67](numbers-diff.md#L67) | number | N-58 | N/A-deferred | Observability vendor prices — register: vendor price — repo: n/a — - |
| F-1119 | [numbers-diff.md:68](numbers-diff.md#L68) | number | N-59 | N/A-deferred | Cost assumptions X1-X13, FD-01/03/04 — register: Stage 18 — repo: planning inputs — - |
| F-1120 | [numbers-diff.md:69](numbers-diff.md#L69) | number | N-60 | N/A-deferred | Infra phases A/B/C sizing — register: Stage 18 — repo: n/a — - |
| F-1121 | [numbers-diff.md:70](numbers-diff.md#L70) | number | N-61 | N/A-deferred | Spend-cap and alert budgets — register: 150 % forecast; 50/80/90/100 % — repo: none in repo — - |
| F-1122 | [numbers-diff.md:71](numbers-diff.md#L71) | number | N-62 | N/A-deferred | Capacity (Gemini 2M TPM, Claude 2,500 QPM / 25M TPM, Doc AI 60/min, Tasks 500/s, Cloud Run 1,000 conc.) — register: Stage 18 — repo: n/a — - |
| F-1123 | [numbers-diff.md:72](numbers-diff.md#L72) | number | N-63 | N/A-deferred | Peak-day cost ceiling — register: INR 350/user/day (GST incl.) — repo: n/a — - |
| F-1124 | [numbers-diff.md:73](numbers-diff.md#L73) | number | N-64 | N/A-deferred | College plan — register: INR 50,000/month, pool 5,000 turns, 50 accounts — repo: n/a — - |
| F-1125 | [numbers-diff.md:74](numbers-diff.md#L74) | number | N-65 | N/A-deferred | Cloud Run sizing per service — register: API 1 vCPU/1 GiB conc 80 timeout 3,600 s min 1->3 max 50; Executor 2/4 GiB; Worker 1/2 GiB; Parser; Fetcher; Web — repo: only the sandbox service is documented (2 vCPU / 8 GiB, conc 16, timeout 900) — `docs/deploy/warm-sandbox.md:43-44` |
| F-1126 | [numbers-diff.md:75](numbers-diff.md#L75) | number | N-66 | MATCH (total 10); rest N/A-deferred | DB pool budget per instance — register: API 5+5; Executor 4+2; worker 3+2; sum <= max_connections - 50; Cloud Run 100 conn; backups asia-south2 x14, PITR 7 d — repo: pool max 10 (= 5+5 total) — numbers.ts:71; config:99; `db/client.ts:36` |
| F-1127 | [numbers-diff.md:76](numbers-diff.md#L76) | number | N-67 | N/A-deferred (DIFF-STACK) | Version pins = package register — register: Python packages — repo: Node packages with ranges and lock files (see evidence pack) — `backend/package.json`, `arcnave-frontend/package.json` |
| F-1128 | [numbers-diff.md:77](numbers-diff.md#L77) | number | N-68 | DIFF + NOT-WIRED (orchestration 45 s) | Sandbox dispatch deadline; execution timeout — register: 20 s start->first heartbeat; 60 s Normal / 120 s Deep inside job — repo: orchestration timeout 45,000 ms; in-container 10,000 ms (Job) / 300,000 ms (warm); no heartbeat deadline — config:270,266,251 |
| F-1129 | [numbers-diff.md:78](numbers-diff.md#L78) | number | N-69 | ABSENT (owner question: three models only) | Router M2 — register: Haiku 5.5, thinking off, 1.5 s timeout, shadow mode — repo: no model router; TurnRouter is policy-only (ADR-0006) — - |
| F-1130 | [numbers-diff.md:79](numbers-diff.md#L79) | number | N-70 | ABSENT | Migration DB timeouts — register: lock_timeout 5 s, statement_timeout 300 s, job 600 s — repo: none set; dedicated connection with advisory lock — `db/migrate.ts:17-27` |
| F-1131 | [numbers-diff.md:80](numbers-diff.md#L80) | number | N-71 | ABSENT | `audit_event` partition horizon — register: current IST month + 3 — repo: no `audit_event` — - |
| F-1132 | [numbers-diff.md:81](numbers-diff.md#L81) | number | N-72 | ABSENT (owner question Q7) | Passwordless sign-in and invitations — register: code 10 min, 5 tries, link 10 min, 1 code/60 s, 5/h, invitation 7 d, bulk 200, TOTP, 10 recovery codes — repo: password + Google sign-in; no code / invite / TOTP — `routes/auth.ts`, `services/auth.ts:10` |
| F-1133 | [numbers-diff.md:82](numbers-diff.md#L82) | number | N-73 | MATCH (list 30, title 200); DIFF (retention 5 min vs 15); rest N/A-deferred or not found | Chat + stream — register: list page 30, message page 50, siblings <=20, depth cap 5,000, title <=200, flush 100 ms, relay poll 250 ms, lease 30 s / heartbeat 10 s, Redis MAXLEN 10,000, events kept 15 min, sweep batch 1,000, dispatch grace 60 s, SIGTERM 5 s, ... — repo: list default 30 (max 100); title max 200; stream buffer 5 min; no lease / heartbeat / flush constant found — `routes/helpers.ts:21`; `routes/chats.ts:262,369`; `services/runHub.ts:20` |
| F-1134 | [numbers-diff.md:83](numbers-diff.md#L83) | number | N-74 | DIFF (output); MATCH (Claude TTL, NOT-WIRED); ABSENT (Gemini explicit cache, router, WIF) | Model Gateway — register: max output Fast 8,192 / Normal 16,384 / Deep 32,768; router 1,024; Gemini cache TTL 60 min refreshed < 10 min; Claude cache TTL 5 min; WIF timeouts 10 s; cache admin timeout 10 s, list page 100 — repo: max output 64,000 default, ceiling 128,000; Claude cache default 5 min (ephemeral, no explicit TTL); no explicit Gemini cache; no WIF — numbers.ts:41; config:156-157; `providers/anthropic.ts:305,372,454` |
| F-1135 | [numbers-diff.md:84](numbers-diff.md#L84) | number | N-75 | ABSENT (owner question: register vs invariant 3) | Context v1a estimator constants — register: BYTES_PER_TOKEN 2.0, FIXED 3.0, count trigger 0.8, floor 2 turns — repo: none; invariant 3 says no estimator may exist — `CLAUDE.md:24-26` |
| F-1136 | [numbers-diff.md:85](numbers-diff.md#L85) | number | N-76 | N/A-deferred | Worker, outbox, title job — register: lease 60 s, 5 attempts, queue `background-low`, Cloud Run worker, Scheduler — repo: no worker — - |
| F-1137 | [numbers-diff.md:86](numbers-diff.md#L86) | number | N-77 | DIFF + ABSENT (model) | Rolling history summary — register: trigger 0.6 x budget; last 6 turns kept; input max 30,000 tokens; output 1,200; timeout 60 s; Haiku 5.5, no fallback — repo: compaction exists (different trigger, config:313-317), no Haiku, no "last 6 turns" constant — `services/compaction/*`; config:313-317 |
| F-1138 | [numbers-diff.md:121](numbers-diff.md#L121) | literal | `15_000` SSE heartbeat | no N-id | `routes/chats.ts:815` — N-24 |
| F-1139 | [numbers-diff.md:122](numbers-diff.md#L122) | literal | `.max(100_000)` prompt | no N-id | `routes/chats.ts:543` — N-02 |
| F-1140 | [numbers-diff.md:123](numbers-diff.md#L123) | literal | `attachmentIds ... .max(10)`; multipart `files: 10` | no N-id | `routes/chats.ts:546`; `app.ts:104` — N-10 (<=10 files/msg) |
| F-1141 | [numbers-diff.md:124](numbers-diff.md#L124) | literal | `FILE_LIMITS` (20 files, 1000 pages, 100 visual pages, 8000 px, 10 MB) | no N-id | `services/attachments/processUpload.ts:29-37` — N-10, N-13 |
| F-1142 | [numbers-diff.md:125](numbers-diff.md#L125) | literal | `max_uses: 5` | no N-id | `providers/anthropic.ts:38` — N-07 |
| F-1143 | [numbers-diff.md:126](numbers-diff.md#L126) | literal | `CHUNK_TARGET_CHARS 1400`, `CHUNK_OVERLAP_CHARS 180`, `MAX_CHUNKS_PER_FILE 400` | no N-id | `services/retrieval.ts:20-22` — N-14 |
| F-1144 | [numbers-diff.md:127](numbers-diff.md#L127) | literal | `PROJECT_FULL_CONTEXT_MAX_CHARS 200_000`, `HISTORY_MAX_ATTACHMENT_BYTES 12_000_000`, `MEMORY_CONTEXT_MAX_CHARS 8000` | no N-id | `config.ts:171,176,307` — N-05, N-13, N-17 |
| F-1145 | [numbers-diff.md:128](numbers-diff.md#L128) | literal | `COMPACTION_TRIGGER_TOKENS 150_000`, `..._HEADROOM_TOKENS 10_000`, `..._HEADROOM_RATIO 0.15` | no N-id | `config.ts:313-317` — N-16 / N-77 |
| F-1146 | [numbers-diff.md:129](numbers-diff.md#L129) | literal | `RATE_LIMIT_AUTH_PER_MINUTE 10`, `RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE 60` | no N-id | `config.ts:369,371` — N-01 |
| F-1147 | [numbers-diff.md:130](numbers-diff.md#L130) | literal | `PROVIDER_CONNECT_TIMEOUT_MS 10_000`, `MODEL_PROBE_TTL_SECONDS 300` | no N-id | `config.ts:135,138` — N-43 / N-74 (WIF 10 s) |
| F-1148 | [numbers-diff.md:131](numbers-diff.md#L131) | literal | `MAX_CONCURRENT_RUN_PYTHON 20`, `RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS 45_000`, `MAX_CODE_BYTES 20 KiB`, `SANDBOX_CLAIM_LEASE_BUFFER_MS 30_000` | no N-id | `config.ts:262,270,285,290` — N-08, N-68 |
| F-1149 | [numbers-diff.md:132](numbers-diff.md#L132) | literal | `fetch_url` timeout 10_000 and 1 MB | no N-id | `services/webFetch.ts:41-42` — N-43, N-09 |
| F-1150 | [numbers-diff.md:133](numbers-diff.md#L133) | literal | `UNSENT_UPLOAD_TTL_HOURS 24`, `SANDBOX_STATE_RETENTION_DAYS 30`, `SANDBOX_CHECKPOINT_IDLE_SECONDS 300` | no N-id | `config.ts:338-342` — N-34 / N-33 family |
| F-1151 | [numbers-diff.md:134](numbers-diff.md#L134) | literal | Instructions `.max(20_000)` | no N-id | `routes/preferences.ts:87`; `routes/projects.ts:181,266` — N-35 |
| F-1152 | [numbers-diff.md:135](numbers-diff.md#L135) | literal | Memory `16 * 1024`, list 100, import 500 | no N-id | `services/memory/memoryService.ts:23,25`; `memoryTransfer.ts:13` — N-17 |
| F-1153 | [numbers-diff.md:136](numbers-diff.md#L136) | literal | Artifact `400_000` | no N-id | `routes/artifacts.ts:38` — N-39 |
| F-1154 | [numbers-diff.md:137](numbers-diff.md#L137) | literal | Run hub `50_000` events, `5 * 60_000` retention | no N-id | `services/runHub.ts:17,20` — N-24 / N-73 |
| F-1155 | [numbers-diff.md:138](numbers-diff.md#L138) | literal | Sheet preview `200` rows, `50` columns, `25 MB` | no N-id | `services/documents/sheetPreview.ts:8-9`; `routes/sheetPreview.ts:10` — N-41 |
| F-1156 | [numbers-diff.md:139](numbers-diff.md#L139) | literal | Reconnect delays `[0,1000,...,60000]` | no N-id | `arcnave-frontend/src/adapter.ts:163` — N-46 |
| F-1157 | [numbers-diff.md:140](numbers-diff.md#L140) | literal | Title cut `.slice(0, 200)`, `max(200)` | no N-id | `routes/chats.ts:262,369,517` — N-73 (title <=200) |
| F-1158 | [numbers-diff.md:141](numbers-diff.md#L141) | literal | Session sweep `60 * 60 * 1000`, checkpoint sweep `60_000` | no N-id | `index.ts:15,57` — none yet in the register |
| F-1159 | [numbers-diff.md:142](numbers-diff.md#L142) | literal | Export link `24 * 3_600_000` | no N-id | `routes/account.ts:18` — none in register |
| F-1160 | [numbers-diff.md:143](numbers-diff.md#L143) | literal | Warm sandbox `CHUNK_BYTES`, `TRANSFER_FLOOR_MS 60_000` | no N-id | `tools/sandbox/warmSandboxClient.ts:24,30` — N-08 / N-68 |

## Deferred G1 (11)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1161 | [_parts/deferred-g1.md:6](_parts/deferred-g1.md#L6) | deferred | DF-01 |  | Company / tenant model: R1, R2 (scale), A1, A2, A4, R12/RT-7 company Claude limit (DS-B, DS-3 of Stage 3), C1 + UI-5 + B-6 per-company Claude switch, `companies`, `company_settings`, `memberships`, `invitations`, `company_plan`, `usage_counter`, G-1 `company_id` on every table, DM-9 roles, DM-10 retention setting, DM-12 admin export, `project_members` (DM-8), L1-M13 / UI-2 admin panel, L3-G7 per-company quotas, L3 pipeline 9 audit, L4-G42 fairness, L4 comp 2 / P1–P8 / PE-1…3 policy parts, L5-G4 per-company cache marker, D12 tenant storage prefix, RV-1 / R11 DPDP roles, XG9–XG11 / XD-3 admin-run delete + offboarding + auto-retention, B1 audit rows on offboarding — B-3, ADR-0053 #3, build plan Phase 5 item 1 — **No.** Evidence: none of the 28 tables has `company_id` (`backend/src/db/schema.ts`, read in full); every route filters by `user_id` (`routes/chats.ts:869-882`, `projects.ts` `loadProject`); storage keys use the owner id (`services/storage.ts:22-28`). Retrofit later = add nullable `company_id`, backfill one default company, set NOT NULL, rebuild unique indexes with company first, add the filter beside the existing `user_id` filter; cost M per table group, mechanical, already planned. New tables built now (turns, message_contents, feedback, file_versions, price_table, deletion_ledger) hang off chat/message ids and need no `company_id` column now. Old objects under `<ownerId>/` need a copy job in Phase 5 (cost = size of stored files; acceptable). |
| F-1162 | [_parts/deferred-g1.md:7](_parts/deferred-g1.md#L7) | deferred | DF-02 |  | RLS: G-1 policies (text of 2026-10-05), FORCE RLS, app role not owner, D13–D15, DB-7, tenant context `SET LOCAL ROLE` + `set_config` per transaction (2026-10-08), per-company partitions of chunks — B-3, build plan Phase 5 item 1 (pgTAP suite) — **No.** Evidence: single DB role (`db/client.ts:36`), no `SET LOCAL` anywhere (searched `backend/src/db`, `services`). New services receive the database through the container (`generation.ts` `this.db`, `request.services.db`), so a per-transaction tenant wrapper can be inserted at that one seam. Rule for the turn-service refactor (stage-02 S2-4): keep passing the handle, do not import a global `db`. |
| F-1163 | [_parts/deferred-g1.md:8](_parts/deferred-g1.md#L8) | deferred | DF-03 |  | Redis: L-3, DF-7 / DFR4 / SG12 / SD-3 stream buffer (Redis or Postgres `turn_stream_events`, ADR-0011), P2 policy cache, L3 rate-limit counters, query-embedding cache, R5 degraded mode, D20, `StreamStore` interface — B-7 (Redis at Phase 5) — **No.** Evidence: the replay buffer, the run map and the rate limiter are in process (`services/runHub.ts:1-127`, `container.ts:71-74,251-252`, `app.ts:93-101`); only `routes/chats.ts` calls the hub (4 sites: `:565,583,658,685`). Swapping the buffer later = one class + those call sites (cost M). Name the interface when the turn service is extracted; no table needed now. |
| F-1164 | [_parts/deferred-g1.md:9](_parts/deferred-g1.md#L9) | deferred | DF-04 |  | Cloud Tasks / Turn Executor / worker: O-3, Stage 2 DS-1/DS-2/A8, Stage 3 DS-1/DS-2 (cancel via DB flag), AS1–AS19, AS25–AS28, AS-D1–AS-D3, AS-D5, CA1–CA5, AS5–AS9/AS14/AS18/AS23 job system, FG8 sweeper, GG1/GG3/GG5, GD-1, R10, R13, R14, L4-G5/G6/G8 (checkpoint, drain, trace), L4 comps 11–12, Cloud Run jobs for work > 10 min — B-7; build plan Phase 5 item 2; Phase 2 "Cloud Tasks file queue" — **No.** Evidence: `GenerationService.run` is an async generator independent of HTTP (`generation.ts:370-385`), so an executor can call it unchanged; file status is already pollable (`routes/files.ts:315`) so async processing needs no new client contract. Lease/fencing/checkpoint columns are ADD COLUMN later (expand-only). Note for stage-03/05: the DB-level one-running-turn index is NOT deferred (stage-05 TB3). |
| F-1165 | [_parts/deferred-g1.md:10](_parts/deferred-g1.md#L10) | deferred | DF-05 |  | NO_CONTENT enforcement (Stage 17): `turn_logs` content (`schema.ts:516-525`, ADR-0050), logs/traces carrying ids only, D19, XG7, DFR3 (no search text in URL query strings: `GET /chats?q=` `chats.ts:202`, `GET /projects/:id/search?q=` `projects.ts:543`), F8-CX stateless-provider disclosure, G-3 content vs metadata split — B-7; ADR-0053 #7 (shadow in Phase 1, enforce Phase 5) — **Yes, for G-3 only (sequencing).** Evidence: message text and provider fields sit in `messages` (`schema.ts:271-308`) and are read at about 49 query sites in 13 files, 8 of them app code (`chats.ts` 10, `generation.ts` 6, `share.ts` 2, `usage.ts`, `models.ts`, `accountExport.ts`, `autoCompact.ts` 2, `chatSearch.ts`). Every task that adds a reader makes the later split more expensive. Cost now: L (expand/contract on one table, 8 files, tests) done once together with `turns` and the version model (stage-05 P3 / TB3 / F4b); cost if left to Phase 5: the same plus every new reader. The log/URL parts of NO_CONTENT stay deferred. |
| F-1166 | [_parts/deferred-g1.md:11](_parts/deferred-g1.md#L11) | deferred | DF-06 |  | Terraform / platform / infra: L2 components 1–9 and 13 (DNS, TLS, global LB, ingress lock, Cloud Armor, CDN rule, edge logging), E-2, E-4, L2-G6/G7, L8 P1–P30 and PL-1…PL-7, DB-1 HA / Cloud SQL tier / PG 17–18, DB-3, DB-4 residency guard, DB-5, D1–D4, D9, D17–D25, D28, R11 / C3 bucket region (`SANDBOX_LOCATION` default `us-central1` `config.ts:254`), Stage 2 DS-3a sandbox as per-run job, SG9, SG11, security headers at the LB (C3) — B-7; build plan Phase 5 item 4; region re-point is Phase 2 P2-C — **No.** The only code coupling is region/bucket configuration (config, not schema). Postgres 16 -> 17/18 is a dump/restore at the infra phase. |
| F-1167 | [_parts/deferred-g1.md:12](_parts/deferred-g1.md#L12) | deferred | DF-07 |  | OpenTelemetry / tracing / client telemetry: L4 comp 12 tracer, L4-G8, L1-M12 client telemetry endpoint, L8 observability — B-7; build plan Phase 5 item 3 — **No.** Request id already doubles as trace id (`app.ts:60-64`); spans are additive. |
| F-1168 | [_parts/deferred-g1.md:13](_parts/deferred-g1.md#L13) | deferred | DF-08 |  | Items the build plan Phase 2 defers to Phase 5 although outside the owner's short list: ClamAV quarantine (DB-6, D11, UG8), Document AI OCR, embeddings + reranker + pgvector hybrid (RT-2, D5–D7, `chunks.embedding`), Cloud Tasks file queue — build plan Phase 2 "Deferred to Phase 5" — **No**, but see owner question Q-V in stage-02.md (Invariant 4 forbids the embedding column the locked chunk table has). Adding a column and the extension later is cheap; `attachments.scan_status` is added with the file-columns work (stage-05 TC1) so the pipeline order is reserved. |
| F-1169 | [_parts/deferred-g1.md:14](_parts/deferred-g1.md#L14) | deferred | DF-09 |  | Auth items Stage 4 L3 doc-sync points at (Stage 16 SD-1…SD-3): MFA/TOTP, recovery codes, refresh rotation + replay detection, re-auth, logout-all, reCAPTCHA, CSRF on the Google POST, same-origin API / SameSite fix, E-4 bot protection — build plan Phase 5 item 5; ADR-0056 table "Differences from Stage 16" — **No.** The method itself (passwordless vs password) is owner question Q1 in stage-01.md, not a deferral. |
| F-1170 | [_parts/deferred-g1.md:15](_parts/deferred-g1.md#L15) | deferred | DF-10 |  | Lawyer / DPDP items: DF-6 / XG12 legal-hold switch, XD-4 billing-record retention, LD-1…LD-3 retention numbers as policy, XG6 provider-copy disclosure, LW-* — build plan Phase 5 item 6 — **No.** |
| F-1171 | [_parts/deferred-g1.md:16](_parts/deferred-g1.md#L16) | deferred | DF-11 |  | Multi-instance behaviours that follow from the above: run hub and stop in process (`chats.ts:696-712` returns `stopped:false` on another instance), in-memory rate-limit store, reattach 404 `no_active_run` on another instance (`chats.ts:686`), E-1 Next.js/Cloud Run hosting (ADR-0060 pending) — single instance by build plan section 1 — **No.** Documented limits of the prototype. |

## Deferred G2 (21)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1172 | [_parts/deferred-g2.md:8](_parts/deferred-g2.md#L8) | deferred | D6-1 |  | `Stage-06-Context-Prompt-Assembly/06-context-assembly.md:64` (CXD-8), `:29` (CG7) — Admin instruction change applies from the next turn of every chat — company / roles — no — Repo has no company or admin role; only project + user instruction fields (`backend/src/services/generation.ts:1936,2035`) — Adding the company block later is one more entry in `promptAssembly.ts:79-125`; no rewrite |
| F-1173 | [_parts/deferred-g2.md:9](_parts/deferred-g2.md#L9) | deferred | D6-2 |  | `06-context-assembly.md:58` (CXD-2), `06-policy-spec-v3.md:148,35` (AU-3) — Company instructions (<= 3,000 chars), `<company_instructions version>` block, replace-older-version rule for the company level — company — no — Project + user levels are built in G2 with the same versioned-block code (Stage 6 CXD-2 / SR-SESSION), so the company level is an extra block — S when companies exist |
| F-1174 | [_parts/deferred-g2.md:10](_parts/deferred-g2.md#L10) | deferred | D6-3 |  | `06-policy-spec-v3.md:89-90` (CF-3, CF-4), `:178` (implementation contract L3 / L7 tenant + permission filters) — Rules that depend on tenants: workplace data limited to the user's access scope, never reveal other tenants' non-public data — company / RLS — no — Single user per account today; every retrieval query is already scoped by user / project (`services/retrieval.ts`, `tools/executor.ts:104-111`) — Prompt text ships in v3 now; the filter half arrives with RLS |
| F-1175 | [_parts/deferred-g2.md:11](_parts/deferred-g2.md#L11) | deferred | D6-4 |  | `Stage-06.../00-checkpoint-stage6.md:73` (table `summaries` per conversation), `Stage-09.../00-checkpoint-stage9.md:32` (file pipeline), `00-Handoff/00-numbers-register.md:83` (N-76 jobs) — `company_id` on tables created by this group's builds: `summaries`, `file_pages` / sidecar index, `operations` / `jobs`, new file columns — company / RLS — **yes (advisory, one decision for all new tables)** — Every existing table is keyed by `user_id` / `chat_id` only, e.g. `conversation_compactions` (`backend/src/db/schema.ts:806-828`); the spec's job and summary tables are per company — If new tables are created without a nullable `company_id`, adding it later is a migration + backfill + query rewrite per table (M each, risk of missed filters); with a nullable column now it is S. The decision is the owner's; the auditor does not add columns |
| F-1176 | [_parts/deferred-g2.md:12](_parts/deferred-g2.md#L12) | deferred | D6-5 |  | `00-checkpoint-stage6.md:73` (Task 1.14: job on the worker), `00-numbers-register.md:83` (queue `background-low`, lease, attempts, Scheduler) — Summary and title jobs dispatched by a Cloud Tasks queue to a worker service — Cloud Tasks / Terraform — no — The repo has no worker (`backend/src` has no job runner; `routes/chats.ts:1167-1173` sets the title inline). Build the jobs with a DB lease row (as `arcnave.in:backend/apps/worker` does) and an in-process runner — Swapping the dispatcher is S if the job body is idempotent and takes only ids; if the job reads request-scoped state it becomes M. Rule for the builders: job input = ids |
| F-1177 | [_parts/deferred-g2.md:13](_parts/deferred-g2.md#L13) | deferred | D6-6 |  | `Stage-17-Observability` NO_CONTENT (cited by `00-checkpoint-stage6.md:63`; repo `CLAUDE.md:119-121`) — No user text, file text, model output, prompts or memory in logs, metrics, traces — NO_CONTENT enforce — no — `turn_logs` (ADR-0050) stores content and stays until Phase 5; new G2 code should log ids, codes, sizes, durations only — Enforce switch is Phase 5; code that logs content now must be edited later (S per site). Known site: `routes/files.ts:511` logs `{ err }` of an extraction failure |
| F-1178 | [_parts/deferred-g2.md:14](_parts/deferred-g2.md#L14) | deferred | D7-1 |  | `Stage-07-Model-Routing/07-model-routing.md:85` (RT-7), `:124-133` (7.11), `00-numbers-register.md:34` (N-29) — Per-company monthly Claude limit set by the ArcNave team, reserve-then-settle counter, 80 % admin alert, 100 % refuse with message, monthly reset on the 1st (IST) — company — no — Per-user daily / monthly budgets and reservation exist (`generation.ts:694`; `services/usage.ts`); ADR-0053 #6 keeps them as the only cap — The counter keys on user today; a company counter is a second key on the same reservation code (M) |
| F-1179 | [_parts/deferred-g2.md:15](_parts/deferred-g2.md#L15) | deferred | D7-2 |  | `00-checkpoint-stage7.md:50` (RT-8 switch `company_settings.claude_enabled`, ops command `set-claude`), `07-model-routing.md:87` — Per-company Claude ON / OFF switch — company — no — Owner dropped it for the prototype (ADR-0053 #6, `docs/decisions/0053-prototype-base-and-target-spec.md:23`); the fallback rule that reads it is OQ7-2 in `stage-07.md` — None for code: the fallback chain takes an `allowClaude` boolean from config now and from the company later |
| F-1180 | [_parts/deferred-g2.md:16](_parts/deferred-g2.md#L16) | deferred | D7-3 |  | `07-model-routing.md:89` (RT-10), `00-numbers-register.md:43,60` (N-38, N-55) — Gemini 429 / TPM monitoring, Priority PayGo decision, Claude 429-rate alert — OTel / Terraform — no — No metrics stack in repo — Alerts are config on top of existing typed errors (`provider_limit`, 429 counters) |
| F-1181 | [_parts/deferred-g2.md:17](_parts/deferred-g2.md#L17) | deferred | D8-1 |  | `Stage-08.../08-tool-execution.md:94` (TD-9), `08c-skill-framework.md:97` (SF-5 gating) — Company admin switches: web search; code execution + file creation together; skill catalog gating by that switch — company / roles — no — Gating today is deployment flags (`ENABLE_WEB`, `ENABLE_RUN_PYTHON`, `config.ts:181,221`) read in `tools/registry.ts:50-63` — The registry already takes flags; a company setting replaces the flag source (S) |
| F-1182 | [_parts/deferred-g2.md:18](_parts/deferred-g2.md#L18) | deferred | D8-2 |  | `00-checkpoint-stage8.md:34` (TD-14), `00-numbers-register.md:23,71,86` (N-18: 1,000 searches / company / month) — Per-company monthly search quota — company — no — No search counters in repo — New counter table keyed by company (S), after TS-12 caps exist |
| F-1183 | [_parts/deferred-g2.md:19](_parts/deferred-g2.md#L19) | deferred | D8-3 |  | `00-checkpoint-stage8.md:44-49` (TD-5c+: ~5 parallel runs per company), `00-numbers-register.md:13` (N-08) — Parallel run cap per company and fairness — company — no — Global cap 20 in Postgres (`config.ts:285`; `tools/sandbox/semaphore.ts`) — The semaphore already lives in Postgres; adding a company key is S |
| F-1184 | [_parts/deferred-g2.md:20](_parts/deferred-g2.md#L20) | deferred | D8-4 |  | `00-checkpoint-stage8.md:10-11` (TD-4b realised as a Cloud Run Job per run, signed GCS URLs, job SA, result bucket, timeout 120 s), `:39-40` (TD-4b), `:13-14` (dispatch deadline 20 s) — Per-run Job topology, service accounts, buckets — Terraform / Cloud Run layout — no, with one rule — Repo has both engines (`config.ts:239-258`; `tools/sandbox/cloudRunSandboxClient.ts`). Rule: build the new `run_code` tool to the spec's stateless contract ("each run starts fresh, re-load from /input or /output", `08d-tool-definitions.md:197`) so the Job swap changes only the client — If `run_code` is built to the warm service's persistent-files semantics, the later swap changes tool behaviour the model has learned (M) |
| F-1185 | [_parts/deferred-g2.md:21](_parts/deferred-g2.md#L21) | deferred | D8-5 |  | `00-checkpoint-stage8.md:35-38` (TD-3 own fetcher service, zero-permission SA), `00-numbers-register.md:72` (N-65 Fetcher 0.5 vCPU / 512 MiB) — Separate fetcher service — Terraform / Cloud Run layout — no — SSRF-safe fetch code is rebuilt in-process now (`stage-08.md` T-fetch_url) — Moving the module into its own service is a packaging change (S) |
| F-1186 | [_parts/deferred-g2.md:22](_parts/deferred-g2.md#L22) | deferred | D8-6 |  | `00-checkpoint-stage8.md:39-40` (no-egress sandbox), repo ADR-0007 — VPC / network rules that make "no egress" true — Terraform — no — Repo enforces by design + ADR-0007; network deny rules are infra — n/a |
| F-1187 | [_parts/deferred-g2.md:23](_parts/deferred-g2.md#L23) | deferred | D9-1 |  | `00-checkpoint-stage9.md:32` (Cloud Task between upload and check), `00-numbers-register.md:49` (N-44 `file-blocking` queue: 3 attempts, 10 s-5 min backoff, 30 min deadline), `09-file-processing.md:112` (G21) — Cloud Tasks queue for file processing, at-least-once delivery — Cloud Tasks — no, with one rule — Repo processes inline (`routes/files.ts:233-265`). Rule: every pipeline step idempotent per (file id, version), job input = ids — If steps are not idempotent, a later at-least-once queue duplicates OCR cost and rows (M) |
| F-1188 | [_parts/deferred-g2.md:24](_parts/deferred-g2.md#L24) | deferred | D9-2 |  | `00-checkpoint-stage9.md:38` (company OCR-page + audio-minute quotas), `:14-15` and `:21` (quota values), `00-numbers-register.md:16,86` (N-11: OCR 5,000 pages / company / month, audio 120 min / user / month) — Company OCR-page and audio-minute quotas — company — no — No quota tables — New counters (S); per-user upload rate stays in `stage-09.md` LIMITS |
| F-1189 | [_parts/deferred-g2.md:25](_parts/deferred-g2.md#L25) | deferred | D9-3 |  | `00-checkpoint-stage9.md:56` (G30: company fairness under saturation, alert when queue wait > 5 s) — Fairness and queue-wait alert — company / OTel — no — No queue yet — n/a |
| F-1190 | [_parts/deferred-g2.md:26](_parts/deferred-g2.md#L26) | deferred | D9-4 |  | `00-checkpoint-stage9.md:95-108` (Document AI quota 6 -> 60 requests / min, increase through support) — Quota increase for Document AI — ops / Terraform — no — Not code — n/a |
| F-1191 | [_parts/deferred-g2.md:27](_parts/deferred-g2.md#L27) | deferred | D9-5 |  | `00-checkpoint-stage9.md:44` (G34 isolated parser service), `00-numbers-register.md:72` (N-65 Parser 2 vCPU / 4 GiB conc 2), ClamAV container (Stage 19 doc-sync `00-checkpoint-stage9.md:17-18`) — Deployment of the parser service and ClamAV (infra half of ISOLATION / SCAN) — Terraform / Cloud Run layout — no — Code half is bucketed NEW-BUILD in `stage-09.md`; build the service as a container with a Dockerfile and a health check so Terraform only deploys it — None for code |
| F-1192 | [_parts/deferred-g2.md:28](_parts/deferred-g2.md#L28) | deferred | D9-6 |  | `00-checkpoint-stage9.md:59` (G23: 23 d app delete + 7 d bucket soft delete), `00-numbers-register.md:38` — Bucket soft-delete 7 d and lifecycle rules — Terraform — no — App sweep removes at 30 d (`services/retention.ts`; `config/numbers.ts:61`) — None |

## Deferred G3 (11)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1193 | [_parts/deferred-g3.md:9](_parts/deferred-g3.md#L9) | deferred | D-G3-01 |  | Chunk tables list-partitioned per company, BM25 + HNSW index per partition (Stage 12 L-26 / VS-7 / ADR-0005; L-06 `company_id` on every row) — Stage 12 checkpoint doc-syncs 2026-10-03 (review), 2026-10-05 — company/tenancy, RLS — **YES** — `file_chunks` today is one unpartitioned table keyed by project (`db/schema.ts:186-207`, unique `uq_chunk_ordinal` on `project_file_id, ordinal`). Stage 12 rows L-03/L-10/L-06 rebuild this table now (new chunker, tsvector, chat-file scope). A PostgreSQL table cannot be converted to a partitioned table in place: later it means create partitioned table, copy, re-index, swap, and the new unique/primary keys must then include the partition key. — If the rebuilt table is created now as `LIST (company_id)` with a single seeded partition and `company_id NOT NULL` (default one dev company row): S (one migration, one `companies` stub). If skipped: M–L later (table rewrite + reindex of every chunk, key changes in `retrieval.ts` queries). Also decide the same for the vector column if Q1 (stage-12) goes Option A. |
| F-1194 | [_parts/deferred-g3.md:10](_parts/deferred-g3.md#L10) | deferred | D-G3-02 |  | Runner callable without an HTTP request: turn executor via Cloud Tasks and research as Cloud Run jobs (Stage 10 AO-4, RS-5; N-43/N-44/N-73; Stage 18 doc-sync: Cloud Tasks HTTP max 30 min) — Stage 10 checkpoint AO-4, RS-5; Stage 18 doc-sync — Cloud Tasks / Cloud Run job layout is infra — **YES (design constraint on AO-4b / research, not the infra)** — A turn is a closure inside the route handler: the run starts at `routes/chats.ts:585-659` with the Fastify `request`, `reply` and an in-process `AbortController`/`RunHub` (`runHub.ts:89-126`). `generation.run` itself takes only data (`GenerateInput`, `generation.ts:270-291, 370`) — a good seam, but the lifecycle (lease, resume, cancel flag, event store) lives only in the route. Stage 10 AO-4b and the research build (stage-10 §4) will add exactly that lifecycle now. — If the new run store is keyed by `turn_id`/`message_id`, the runner is a function `runTurn(turnId)` readable from the DB, and cancel is a DB flag (plus the in-process abort as fast path): S extra now. If built request-bound: M later to lift it out for Cloud Tasks / jobs. |
| F-1195 | [_parts/deferred-g3.md:11](_parts/deferred-g3.md#L11) | deferred | D-G3-03 |  | Redis: SSE relay pub/sub, stream retention ~15 min (N-24), Redis `MAXLEN ~10,000` (N-73), query-embedding cache 1 h (Stage 12 L-12 / RE35 / RD-16), rate limits — Stage 14 doc-syncs 2026-10-07/10; Stage 12 Step 3 — Redis deferred — No — The Postgres-backed event store (stage-10 AO-4b) with 250 ms polling is the locked fallback (Stage 14 doc-sync 2026-10-10: "Postgres buffer, poll 250 ms"); the in-process cache is a drop-in until Redis exists. In-process today: `runHub.ts:1-12`, rate limits in memory (`config/numbers.ts:64-67`). — n/a (Postgres first, Redis swap is DIFF-INFRA later) |
| F-1196 | [_parts/deferred-g3.md:12](_parts/deferred-g3.md#L12) | deferred | D-G3-04 |  | Company-level memory default/OFF-deletes-all, admin cannot view/export memories, legal request via ops (Stage 11 M-05 company layer, M-18 MEM-ADMIN) — Stage 11 checkpoint MEM-DEFAULT = A, MEM-ADMIN — company/tenancy, roles — No — No company/roles exist (see header fact); user-level switch exists `db/schema.ts:95`. — Later: S per table (ALTER + backfill) because memory rows are already per user. |
| F-1197 | [_parts/deferred-g3.md:13](_parts/deferred-g3.md#L13) | deferred | D-G3-05 |  | RLS on `memory_doc`, `memory_line`, `memory_line_source`, `memory_tombstone`, `memory_settings` (Stage 11 M-03); on `validation_result` (Stage 13 V-19); on citation registry / retrieval record (Stage 12 L-16/L-18); on research tables (Stage 10) — Stage 11 "RLS on everything"; Stage 13 OV21; Stage 12 RE46 — RLS — No (except D-G3-01) — None of these tables exists yet; they are new tables, so adding `company_id` + policy later is `ALTER … ADD COLUMN` with a one-company backfill — cheap, unlike a partitioned table. — S per table later; if the owner prefers zero rework, add nullable `company_id` to each new table now (XS per table). |
| F-1198 | [_parts/deferred-g3.md:14](_parts/deferred-g3.md#L14) | deferred | D-G3-06 |  | Per-company long-task and research quotas, "remaining" counter, research ON/OFF switch (Stage 10 AO-11, RS-4, RS-7; N-19 5 runs/company/month, N-20) — Stage 10 checkpoint AO-11, RS-4, RS-7, N-19/N-20 — company/tenancy, roles — No — Per-user budgets only: `usage.ts`, `preferences.dailyTokenBudget` (`schema.ts:101-102`). Research mode is also not built yet (stage-10 §4); the per-run caps (30 min / 50 searches / 5 helpers, RS-3) are **not** deferred and are in the Stage 10 file. — S–M later (counter table + admin switch); no rework of the research build if the run row stores its owner and cost. |
| F-1199 | [_parts/deferred-g3.md:15](_parts/deferred-g3.md#L15) | deferred | D-G3-07 |  | NO_CONTENT enforce: ids-only logs/metrics/traces; `turn_logs` reduced (ADR-0050 superseded); memory text never in logs (DPDP Rule 8(3)); validation records ids/hashes only (Stage 11 M-24; Stage 13 V-19) — Stage 11 checkpoint Storage; Stage 13 doc-sync Stage 17 — NO_CONTENT enforce — No — Today `turn_logs.markdown` stores prompts, tool inputs and results, memory tool inputs included (`generation.ts:1237-1243`, `turnLog.ts`). New Stage 13 tables are specified ids/hashes only (judge explanations not stored), so they are built correctly from day one; nothing built now depends on the old turn log. — n/a (new tables follow the spec; the old log is removed at Phase 5). |
| F-1200 | [_parts/deferred-g3.md:16](_parts/deferred-g3.md#L16) | deferred | D-G3-08 |  | OTel: `gen_ai.evaluation.result` names, India-hosted traces per step/helper (Stage 10 deferred list, Stage 17), validation actions exported as metrics without content, retrieval alerts (degraded mode, L-21) — Stage 13 checkpoint doc-sync Stage 17; Stage 12 L-21 — OTel — No — No telemetry package (`backend/package.json`: no OpenTelemetry); `logger.ts` only. — n/a |
| F-1201 | [_parts/deferred-g3.md:17](_parts/deferred-g3.md#L17) | deferred | D-G3-09 |  | Terraform / hosting for items built in these stages: pgvector / pg_textsearch extension flags on Cloud SQL (Stage 12 L-04/L-10), Vertex Ranking API IAM + `global` access (L-14), usercontent origin host + DNS + COOP/headers (Stage 14 D-10, D-30), ALB idle timeout / SSE settings (D-26, LV-25/111), Cloud Run `--no-cpu-throttling` (ADR-0009) — Stage 12 doc-syncs 2026-10-05/06; Stage 14 doc-syncs 2026-10-06/07 — Terraform — No — Local dev uses `docker compose` Postgres 16 (`CLAUDE.md` commands); extension availability in the compose and CI Postgres image is an app-side prerequisite for stage-12 Option A and is noted there, not deferred. — n/a |
| F-1202 | [_parts/deferred-g3.md:18](_parts/deferred-g3.md#L18) | deferred | D-G3-10 |  | Per-company search caps, timeouts, separate retrieval DB pool (`statement_timeout` retrieval 2 s, N-45), upload-embedding low-priority lane via Cloud Tasks, off-peak CONCURRENTLY index builds (Stage 12 L-23, L-04 lane) — Stage 12 Step 9 — company/tenancy, Cloud Tasks — No — Single pool (`config/numbers.ts:69-71` `DB_POOL_MAX` 10); embeddings do not exist yet (stage-12 L-04). An in-process queue is enough until Cloud Tasks exists. — n/a |
| F-1203 | [_parts/deferred-g3.md:19](_parts/deferred-g3.md#L19) | deferred | D-G3-11 |  | Admin and ops consoles, destructive admin UX (Stage 14 D-15/D-16: RN21, RN22, RN23), company-only share default, Report moderation queue (RN19/SHG11 target) — Stage 14 checkpoint RD-11, RD-12 — company/tenancy, roles — No — No company/roles (header fact); the user-facing Report link on shares is app-side and is in `stage-14.md` D-23, not deferred. — n/a |

## Deferred G4 (17)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1204 | [_parts/deferred-g4.md:9](_parts/deferred-g4.md#L9) | deferred | DF-1 |  | NO_CONTENT enforce: OD-2 attribute allowlist, CI field-name test, log field allowlist, Error Reporting with sanitised exceptions (Stage 17 OD-2, doc-syncs 2026-10-04, -08, -10) — ADR-0053 #7: enforce in Phase 5; CLAUDE.md "Logging target" keeps it shadow-only — Partly yes: (a) the gateway/ledger code that Stage 15 forces us to write now must log through one content-free helper from its first line; (b) see DF-2 — about 39 of 65 logger call sites (counted per line) are flagged C in `evidence-g4.md` (c); only `app.ts:175` uses `errorLogFields` (`errorLog.ts:47-65`); shadow test `test/contentLeak.test.ts` covers the happy path only (header :10-23) — (a) S now vs M later, because new retry/fallback/breaker code would carry its own `{err}` sites; the rest of the enforce work stays Phase 5 (M) |
| F-1205 | [_parts/deferred-g4.md:10](_parts/deferred-g4.md#L10) | deferred | DF-2 | RAISE NOW | OD-2 URL rule: no user content in a URL path or query string (Stage 17 doc-sync 2026-10-04) — Part of NO_CONTENT — Yes — `GET /v1/chats?q=` (`routes/chats.ts:202`), `GET /v1/artifacts?q=` (`routes/artifacts.ts:82`), `GET /v1/projects?q=` (`routes/projects.ts:109`) put search text in the query string; Cloud Run writes request URLs to its own logs — S-M now (3 routes, their frontend callers, tests, `docs/openapi.json`); the cost grows with every new client (Android app) that calls them |
| F-1206 | [_parts/deferred-g4.md:11](_parts/deferred-g4.md#L11) | deferred | DF-3 |  | OTel SDK + Collector sidecar, traces, custom metrics, sampling, latency clocks as spans/metrics (OD-1, OD-4, OD-7, OD-8 as metrics, OD-16 dashboards) — Owner list: OTel — No — no OpenTelemetry dependency in `backend/package.json`; no `/telemetry` handler — M later; nothing built now depends on it |
| F-1207 | [_parts/deferred-g4.md:12](_parts/deferred-g4.md#L12) | deferred | DF-4 |  | OD-3 HMAC-SHA256 pseudonymous user/company ids in telemetry — Tied to OTel/NO_CONTENT — No — raw `userId` is logged at `services/generation.ts:701` — S later |
| F-1208 | [_parts/deferred-g4.md:13](_parts/deferred-g4.md#L13) | deferred | DF-5 |  | OD-5 log buckets/retention (security-audit 400 d + Bucket Lock, Data Access logs, folder log location), OD-9 SLOs and burn-rate alerts, OD-10 PagerDuty/Slack, OD-11 uptime checks + status page, N-51..N-56 — Terraform / ops — No — no Terraform in repo; `/healthz` and `/readyz` exist (`routes/health.ts:20,43`) — M later, ops-side |
| F-1209 | [_parts/deferred-g4.md:14](_parts/deferred-g4.md#L14) | deferred | DF-6 |  | OD-6 `audit_event` table (RLS, append-only role, daily hash chain, `security-audit` mirror), "audit write failure -> serve turn + `audit_pending`" — company/tenancy + roles — No — no audit table in `db/schema.ts`; users keyed by e-mail (`schema.ts:39-52`) — M later (port `arcnave.in:backend/packages/db/src/arcnave_db/audit.py`); a nullable `company_hash` column avoids a retrofit of the table shape but the table does not exist yet |
| F-1210 | [_parts/deferred-g4.md:15](_parts/deferred-g4.md#L15) | deferred | DF-7 |  | SD-4 / SE7 tenant isolation: FORCE RLS, `SET LOCAL` tenant per transaction, composite keys company_id-first, pgTAP suite; ER-6 per-role pools/timeouts (retrieval 2 s, executor 30 s) — company/tenancy, RLS, roles — No (see note) — every table keys on `user_id` (`schema.ts`, e.g. `usage_records` :596, `usage_counters` :654, `turn_logs` :520); no role column — M-L later. Note for the new tables of Stages 15-18 (per-call ledger rows, price book, audit): key them by `user_id` like today so `company_id` can be added with a default; no `company_id` needed now |
| F-1211 | [_parts/deferred-g4.md:16](_parts/deferred-g4.md#L16) | deferred | DF-8 |  | Roles owner/admin/user, TOTP required for owner + admin, absolute 24 h admin session, re-authentication window (SD-1, SE3, N-49 owner/admin parts) — roles — No — no role column (`schema.ts:39-52`); no TOTP — M later |
| F-1212 | [_parts/deferred-g4.md:17](_parts/deferred-g4.md#L17) | deferred | DF-9 |  | Company pools and quotas: N-30 pool 5,000 turns (+5,000 boost), Deep <= 10 %/user, N-18 search 1,000/company/month, N-11 OCR 5,000 pages, N-19 Research 5 runs, N-20 20 long tasks, N-29 Claude add-on pool (ADR-0053 #6 drops the per-company Claude switch), N-64 — company pools — No — budgets are per user and in tokens (`usage_counters` `schema.ts:650-664`, `services/usage.ts:258-291`) — M later; per-user budgets stay the only cap now (owner decision, ADR-0053 #6) |
| F-1213 | [_parts/deferred-g4.md:18](_parts/deferred-g4.md#L18) | deferred | DF-10 |  | Redis: ER-5 degraded mode, N-46/N-48 Redis numbers, distributed rate limits, `limits` library, stream relay (N-24 Redis retention) — Redis — No — rate limit is `@fastify/rate-limit` in memory (`app.ts:93-101`); run state is in process (`activeRuns`, `runHub`, `routes/chats.ts:565-583`) — M later; correct while there is one instance |
| F-1214 | [_parts/deferred-g4.md:19](_parts/deferred-g4.md#L19) | deferred | DF-11 |  | Cloud Tasks / Executor: ER-7, N-44, AS-D3 (one retry from checkpoint), ER-3 "partial tool_use/thinking -> restart that step from the checkpoint", ER-4 SIGTERM flush + resume, Research job retry from checkpoint (EH25), turn 15 min Executor request — Cloud Tasks — No — the turn runs in the API process inside the request that created it (`routes/chats.ts:585-659`) — L later. In-process equivalent for now: the tool-loop rounds are the only restart points; see stage-15.md ER-2b/ER-3 |
| F-1215 | [_parts/deferred-g4.md:20](_parts/deferred-g4.md#L20) | deferred | DF-12 |  | Terraform-side controls: FD-10 layers 2-3 (alert budgets, spend-cap budgets), FD-29 budgets, FD-28 Data Access logs, FD-30/FD-35 NAT, Cloud Armor CRS, ingress internal + LB, Binary Authorization, SCC, pgAudit `ddl,role`, Cloud SQL flags (`log_error_verbosity=terse`, `log_parameter_max_length=0`), Memorystore slowlog, DR to Delhi (SD-12), `ENCRYPTED_ONLY` — Terraform — No — none in repo — not a rewrite; new infra |
| F-1216 | [_parts/deferred-g4.md:21](_parts/deferred-g4.md#L21) | deferred | DF-13 |  | SD-3 reCAPTCHA Enterprise on e-mail code and Google sign-in; Cloud Armor edge limits (N-01 edge 600/IP) — Phase 5 per ADR-0056 table — No — none — S later |
| F-1217 | [_parts/deferred-g4.md:22](_parts/deferred-g4.md#L22) | deferred | DF-14 |  | SD-5 per-company encryption, SD-15 DLP, SE21 sector addenda, SD-13 `legal_hold`, SD-14 grievance/ToS text, SD-12 runbooks and drills (N-49 drills 2/year), LW-22..LW-38 lawyer items — Later / legal / ops — No — none — not code |
| F-1218 | [_parts/deferred-g4.md:23](_parts/deferred-g4.md#L23) | deferred | DF-15 |  | `turn_logs` (ADR-0050) holds user message, reply, thought summary, tool inputs/results and error text (`services/turnLog.ts:168-233`); stays until Phase 5 (ADR-0053 #7) — NO_CONTENT enforce — No — `db/schema.ts:516-525`; owner-only download route `routes/chats.ts:743-771`; deleted with the message (cascade :517-519); no separate retention — S to drop later (table, route, button, test); no rewrite risk |
| F-1219 | [_parts/deferred-g4.md:24](_parts/deferred-g4.md#L24) | deferred | DF-16 |  | Model Armor shadow trial (SD-8), billing-export reconciliation job and drift alert N-57 2 % (OD-12), monthly price-book review job (CD-15), Locust load tests (OD-17), chaos tests ER-15 — infra / ops — No — none — not code |
| F-1220 | [_parts/deferred-g4.md:25](_parts/deferred-g4.md#L25) | deferred | DF-17 |  | ER-12 incident banner fed by Service Health API poll; free public status page (OD-11) — infra / ops — No (the in-app banner flag itself is NEW-BUILD in stage-15.md ER-12) — none — S |

## Deferred G5 (27)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1221 | [_parts/deferred-g5.md:7](_parts/deferred-g5.md#L7) | deferred | ID-1, ID-3 |  | Folder org policies, VPC, subnets, PGA, firewall tags — Terraform — No — Repo has no `infra/` (searched `**/*.tf`, none; only `docs/deploy/*.md` gcloud notes) — Skipping costs nothing in code. |
| F-1222 | [_parts/deferred-g5.md:8](_parts/deferred-g5.md#L8) | deferred | ID-5 / VS-11 / N-48 |  | Memorystore Redis, redis-py — Redis — **Yes, interface only** — Run hub, rate limits and stream buffer are in-process: `backend/src/services/runHub.ts:17-20`, `backend/src/app.ts:93-101`, `backend/src/container.ts:68` — Put the run hub behind a small store interface (Py ADR-0011 `StreamStore`) when the executor is touched: M. Later rewrite of `runHub` + `chats.ts` SSE route if not: M-L. No Redis client needed now. |
| F-1223 | [_parts/deferred-g5.md:9](_parts/deferred-g5.md#L9) | deferred | ID-4 (IAM DB login, connector), N-66 pools |  | Cloud SQL IAM auth, per-role logins — Roles / Terraform — No — `DATABASE_URL` carries a password (`backend/src/config.ts:97`); socket host option `:107` — Config-only change later. |
| F-1224 | [_parts/deferred-g5.md:10](_parts/deferred-g5.md#L10) | deferred | ID-6 / N-65 / N-25 / N-23 |  | Per-service Cloud Run sizing, min instances — Cloud Run layout — No — Only sandbox sizing in `docs/deploy/warm-sandbox.md:43-44` — None in code. |
| F-1225 | [_parts/deferred-g5.md:11](_parts/deferred-g5.md#L11) | deferred | ID-8 (ALB, DNS, certs, DNSSEC) |  | Global external ALB, hosts, CAA — Terraform — No (code parts bucketed in stage-19) — - — - |
| F-1226 | [_parts/deferred-g5.md:12](_parts/deferred-g5.md#L12) | deferred | ID-9, N-01 edge 600/min |  | Cloud Armor CRS, rate limits per IP / user — Terraform — No — App-level limiter exists (`app.ts:93-101`, `config.ts:366-371`) — - |
| F-1227 | [_parts/deferred-g5.md:13](_parts/deferred-g5.md#L13) | deferred | ID-10 |  | One runtime SA per service, custom Vertex role — Terraform / roles — No — - — - |
| F-1228 | [_parts/deferred-g5.md:14](_parts/deferred-g5.md#L14) | deferred | ID-11 |  | Global secrets, volume mounts, rotation — Terraform — No (key vs WIF is an owner question, see stage-19 section 5) — `ANTHROPIC_API_KEY` env `config.ts:122`; `COOKIE_SECRET` `:88` — - |
| F-1229 | [_parts/deferred-g5.md:15](_parts/deferred-g5.md#L15) | deferred | ID-12 (Cloud Deploy canary, WIF, attestation, Binary Authorization) |  | Deploy pipeline — Terraform / CI infra — No — Deploy is a Cloud Build trigger outside the repo (`.github/workflows/ci.yml:2-3`) — - |
| F-1230 | [_parts/deferred-g5.md:16](_parts/deferred-g5.md#L16) | deferred | ID-13 (migrator SA, DDL role, advisory lock, migration job) |  | DDL role split — Roles / RLS — No for the role split; **the fail-closed part is bucketed** (stage-19 S19-13) — `backend/Dockerfile:69` swallows failure; `backend/src/db/migrate.ts:17-27` uses a dedicated connection — Role split later: S-M. |
| F-1231 | [_parts/deferred-g5.md:17](_parts/deferred-g5.md#L17) | deferred | ID-14 |  | Terraform modules, state, drift plan — Terraform — No — - — - |
| F-1232 | [_parts/deferred-g5.md:18](_parts/deferred-g5.md#L18) | deferred | ID-15 |  | Backups asia-south2, PITR, Delhi DR runbook, Gemini OCR fallback, DB-polling dispatch — Terraform / Cloud Tasks — No — - — - |
| F-1233 | [_parts/deferred-g5.md:19](_parts/deferred-g5.md#L19) | deferred | ID-16 (Cloud Scheduler, Cloud Tasks, Pub/Sub for rotation and budgets) |  | Scheduler `Asia/Kolkata`, queues — Cloud Tasks — No — In-process timers `backend/src/index.ts:15-58` — When a worker exists: M. |
| F-1234 | [_parts/deferred-g5.md:20](_parts/deferred-g5.md#L20) | deferred | ID-17 |  | Quota raises before launch — Ops / Terraform — No — - — - |
| F-1235 | [_parts/deferred-g5.md:21](_parts/deferred-g5.md#L21) | deferred | R-4 (ops console on IAP), R-8 VPC-SC for isolated project |  | Ops host, perimeter — Company / roles, Terraform — No — - — - |
| F-1236 | [_parts/deferred-g5.md:22](_parts/deferred-g5.md#L22) | deferred | Doc-sync 2026-10-03 ... 2026-10-13 dev-infra lines (ADR-0008 NAT, Direct VPC sizing, CIDR plan, LV resources, mailer/SES egress, executor service, queue `turns`, Cloud SQL stop rule, FD-22/23/30) |  | Python-build dev environment state — Terraform / Cloud Tasks / Redis — No — - — - |
| F-1237 | [_parts/deferred-g5.md:23](_parts/deferred-g5.md#L23) | deferred | VS-4 (`limits` + Redis token budget), VS-5 (Cloud Tasks handlers, Postgres flag table), VS-27 (Terraform, tflint, checkov), VS-28 (OTel SDK, collector), VS-31 (SBOM export of images) |  | Tooling that belongs to deferred infra — Redis / Cloud Tasks / Terraform / OTel — No — `@fastify/rate-limit` in-process `backend/package.json:28` — - |
| F-1238 | [_parts/deferred-g5.md:24](_parts/deferred-g5.md#L24) | deferred | IP-7 (prod project, HA before first paying customer), IP-8 (lawyer track), IP-9 (academics later), IP-2/IP-6 (timeline, pilot) |  | Plan / business — Phase 5-6 — No — - — - |
| F-1239 | [_parts/deferred-g5.md:25](_parts/deferred-g5.md#L25) | deferred | Stage 21 C1 (project id allowed in telemetry fields) |  | OTel resource attribute — OTel — No — No OTel in repo — - |
| F-1240 | [_parts/deferred-g5.md:26](_parts/deferred-g5.md#L26) | deferred | N-22, N-44, N-70 (job timeout part), N-71, N-73 (Redis / lease rows), N-76 (worker, outbox, queue `background-low`) |  | Cloud Tasks / Postgres stream store / worker — Cloud Tasks / Redis — No — - — - |
| F-1241 | [_parts/deferred-g5.md:27](_parts/deferred-g5.md#L27) | deferred | N-50, N-51 (partly), N-52, N-53, N-54, N-55, N-56, N-57 |  | Sampling, retention of log buckets, SLOs, alerts — OTel / Terraform — No — - — - |
| F-1242 | [_parts/deferred-g5.md:28](_parts/deferred-g5.md#L28) | deferred | N-32, N-60, N-61, N-62, N-63, N-64, N-58, N-38 |  | HA switch, infra phases, spend caps, capacity, cost ceilings, vendor prices — Cost / Terraform — No — - — - |
| F-1243 | [_parts/deferred-g5.md:29](_parts/deferred-g5.md#L29) | deferred | N-29, N-30 (company Claude pool, company plan), N-11 / N-18 / N-19 / N-20 per-company quotas |  | Company / tenancy — Tenancy — **Yes, shape only** — Usage is per user: `backend/src/db/schema.ts:102` (`monthly_token_budget`); no `company` anywhere (searched `company` in `schema.ts`: not a table) — Any new table written now (settings, price_book, quota counters) should carry a nullable `company_id` / scope column: S per table. Retrofitting every existing table later: L. Owner decided "single user first" (ADR-0053 #3); this is only a flag. |
| F-1244 | [_parts/deferred-g5.md:30](_parts/deferred-g5.md#L30) | deferred | RLS / pgTAP suite (IP-5 gate) |  | Postgres RLS — RLS — No — - — - |
| F-1245 | [_parts/deferred-g5.md:31](_parts/deferred-g5.md#L31) | deferred | NO_CONTENT enforce (Stage 17), N-52 |  | Enforce in Phase 5 — NO_CONTENT enforce — **Partly done**: the shadow test exists (`backend/src/test/contentLeak.test.ts`, per `docs/architecture/Build-arcnave-tech/tech-p1.md` result row E); request logging is still on (see stage-20 VS-2 row) — - — - |
| F-1246 | [_parts/deferred-g5.md:34](_parts/deferred-g5.md#L34) | deferred-note |  |  | Run-hub store interface (ID-5 row) - only if the turn runner / `generation.ts` is refactored in the same window. |
| F-1247 | [_parts/deferred-g5.md:35](_parts/deferred-g5.md#L35) | deferred-note |  |  | `company_id` / scope column on any new settings, price_book or counter table (N-29 / N-30 row). |

## Logs (G4) (29)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1248 | [_parts/evidence-g4.md:115](_parts/evidence-g4.md#L115) | log-content | container.ts:163 | I | info — run_python uses the warm sandbox service — url — I (service URL from config) |
| F-1249 | [_parts/evidence-g4.md:117](_parts/evidence-g4.md#L117) | log-content | index.ts:27,43,56,79,88,91,117 | C | error/fatal — session sweep / retention sweep / checkpoint sweep / shutdown / unhandled / uncaught / failed to start — err — C (pino err = message + stack; a DB error can carry query parameters) |
| F-1250 | [_parts/evidence-g4.md:124](_parts/evidence-g4.md#L124) | log-content | db/migrate.ts:39,43 | C | info/fatal — migrations applied / migration failed — err (fatal) — C |
| F-1251 | [_parts/evidence-g4.md:125](_parts/evidence-g4.md#L125) | log-content | services/generation.ts:701 | C | error — failed to release budget reservation — err, userId — C (err), user id raw |
| F-1252 | [_parts/evidence-g4.md:126](_parts/evidence-g4.md#L126) | log-content | services/generation.ts:1055 | C | error — generation failed — err, chatId, requestId — C (provider message text is embedded: `providers/anthropic.ts:142`, `gemini.ts:587`) |
| F-1253 | [_parts/evidence-g4.md:127](_parts/evidence-g4.md#L127) | log-content | services/generation.ts:1144 | C | warn — Forced synthesis round failed — err — C |
| F-1254 | [_parts/evidence-g4.md:130](_parts/evidence-g4.md#L130) | log-content | services/generation.ts:1243 | C | warn — turn log not saved — err, messageId — C |
| F-1255 | [_parts/evidence-g4.md:133](_parts/evidence-g4.md#L133) | log-content | services/generation.ts:1413 | C | warn — provider context overflow detected — err (String) — C (provider error text) |
| F-1256 | [_parts/evidence-g4.md:134](_parts/evidence-g4.md#L134) | log-content | services/generation.ts:1449 | C | warn — retrying provider call — attempt, delay, err (String) — C (provider error text) |
| F-1257 | [_parts/evidence-g4.md:135](_parts/evidence-g4.md#L135) | log-content | services/generation.ts:1710 | C | warn — compaction failed — err, chatId — C |
| F-1258 | [_parts/evidence-g4.md:136](_parts/evidence-g4.md#L136) | log-content | services/generation.ts:1754 | C | warn — failed to load attachment bytes for wire payload — err, storageKey — C (err) |
| F-1259 | [_parts/evidence-g4.md:137](_parts/evidence-g4.md#L137) | log-content | providers/gemini.ts:462,464 | C | warn — streamed function-call arguments rejected / final round rejected — err (String), model — C |
| F-1260 | [_parts/evidence-g4.md:138](_parts/evidence-g4.md#L138) | log-content | providers/gemini.ts:648 | C | debug — gemini probe failed — err, providerModelId — C (debug) |
| F-1261 | [_parts/evidence-g4.md:140](_parts/evidence-g4.md#L140) | log-content | routes/chats.ts:637 | C | error — generation failed — err — C |
| F-1262 | [_parts/evidence-g4.md:141](_parts/evidence-g4.md#L141) | log-content | routes/chats.ts:652 | C | error — failed to mark run as errored — err — C |
| F-1263 | [_parts/evidence-g4.md:142](_parts/evidence-g4.md#L142) | log-content | routes/files.ts:416,460 | C | warn — orphaned object after delete / cleanup — err, storageKey — C (err; key holds user id) |
| F-1264 | [_parts/evidence-g4.md:143](_parts/evidence-g4.md#L143) | log-content | routes/files.ts:524 | C | error — attachment extraction failed — err — C (parser errors can quote file text) |
| F-1265 | [_parts/evidence-g4.md:144](_parts/evidence-g4.md#L144) | log-content | routes/projects.ts:534 | C | warn — orphaned object after delete — err, storageKey — C |
| F-1266 | [_parts/evidence-g4.md:145](_parts/evidence-g4.md#L145) | log-content | routes/projects.ts:798 | C | error — indexing failed — err, fileId — C |
| F-1267 | [_parts/evidence-g4.md:146](_parts/evidence-g4.md#L146) | log-content | services/retention.ts:141 | C | warn — stored object could not be deleted — err, storageKey — C |
| F-1268 | [_parts/evidence-g4.md:148](_parts/evidence-g4.md#L148) | log-content | services/skills.ts:434,459 | C | warn — path traversal attempt detected — skillName, resourcePath — C (model-supplied strings) |
| F-1269 | [_parts/evidence-g4.md:149](_parts/evidence-g4.md#L149) | log-content | tools/codeExecutionExecutor.ts:429,507 | C | warn — failed to store presented files / place a conversation file in the sandbox — err, fileId — C |
| F-1270 | [_parts/evidence-g4.md:150](_parts/evidence-g4.md#L150) | log-content | tools/execution/executionRuntime.ts:298 | C | warn — failed to collect output files — err, outputDir — C |
| F-1271 | [_parts/evidence-g4.md:151](_parts/evidence-g4.md#L151) | log-content | tools/execution/executionRuntime.ts:320 | C | warn — Output file failed OOXML structural validation — filename, errors — C (user-visible file name, validator strings) |
| F-1272 | [_parts/evidence-g4.md:152](_parts/evidence-g4.md#L152) | log-content | tools/execution/executionRuntime.ts:364 | C | warn — failed to clean up workspace — err, workspaceDir — C |
| F-1273 | [_parts/evidence-g4.md:153](_parts/evidence-g4.md#L153) | log-content | tools/execution/executionRuntime.ts:511 | C | warn — Failed to parse CLI container execution output — err, result — C (sandbox stdout/stderr = file or model text) |
| F-1274 | [_parts/evidence-g4.md:154](_parts/evidence-g4.md#L154) | log-content | tools/sandbox/processSandboxClient.ts:212 | C | error — ProcessSandboxClient execution error — err, cwd — C |
| F-1275 | [_parts/evidence-g4.md:155](_parts/evidence-g4.md#L155) | log-content | tools/sandbox/workspaceState.ts:112 | C | warn — sandbox checkpoint could not be deleted — err, manifestKey — C |
| F-1276 | [_parts/evidence-g4.md:156](_parts/evidence-g4.md#L156) | log-content | tools/sandbox/warmSandboxClient.ts:285 | C | warn — sandbox checkpoint failed — err, workspace — C |

## Licences (G5) (5)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1277 | [_parts/evidence-g5.md:27](_parts/evidence-g5.md#L27) | licence | `pymupdf` (PyMuPDF/MuPDF) |  | `backend/sandbox/Dockerfile.service:28`; used by `backend/skills/pdf-reading/SKILL.md:32-67` — AGPL-3.0 (or commercial) - from general knowledge, not re-read — VIOLATES Stage 20 licence rule "AGPL excluded from runtime" (VS-12 names pypdfium2 / pypdf). |
| F-1278 | [_parts/evidence-g5.md:28](_parts/evidence-g5.md#L28) | licence | `xlsx` (SheetJS CE 0.18.x) and `exceljs` |  | `backend/package.json:37,49`; used `backend/src/services/retrieval.ts:13-14`, `services/documents/sheetPreview.ts:6`, `xlsxRenderer.ts:8`, `verify/xlsxVerify.ts:7` — Apache-2.0 / MIT (npm metadata, not re-read) — VS-16 says "no SheetJS/ExcelJS" (npm `xlsx` stale). Not a licence issue, a locked-vendor issue. |
| F-1279 | [_parts/evidence-g5.md:29](_parts/evidence-g5.md#L29) | licence | `jszip` |  | backend lock line 6072; frontend lock line 5249 — `(MIT OR GPL-3.0-or-later)` — Dual; choose MIT. Record in a notices register (none exists). |
| F-1280 | [_parts/evidence-g5.md:30](_parts/evidence-g5.md#L30) | licence | `@img/sharp-libvips-*`, `@img/sharp-*` |  | arcnave-frontend/package-lock.json lines 1396-1835 — LGPL-3.0-or-later (dev, transitive) — Build-time only; confirm it never ships. |
| F-1281 | [_parts/evidence-g5.md:31](_parts/evidence-g5.md#L31) | licence | pandoc, poppler-utils, tesseract, LibreOffice |  | sandbox Dockerfiles; poppler also `backend/Dockerfile:35` — GPL-2 / GPL / Apache / MPL via process boundary — Allowed by Stage 20 rule (process boundary) only with a `THIRD_PARTY_NOTICES` register - none exists in the repo. |

## D1 files — trace and prose (105)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1282 | [D1-file-handling.md:17](D1-file-handling.md#L17) | trace |  |  | **ZIP not supported at all**, and legacy `.xls` *is* accepted while Stage 9 says reject (`storage.ts:347-354`; frontend `storage.ts:46-47` has no `zip`). Locked R5 / UD-2 unmet. (P1, feature absent but loud.) |
| F-1283 | [D1-file-handling.md:18](D1-file-handling.md#L18) | trace |  |  | **Scanned PDFs have no OCR at upload.** Chat: ≤100 pages the model re-reads page images itself every turn; >100 pages "nothing in it can be read" (`processUpload.ts:224-226`). Project files: one Gemini call for *all* pages, no output-truncation check, page-less result, and mixed text+scanned PDFs silently drop the scanned pages (`retrieval.ts:155-180`). |
| F-1284 | [D1-file-handling.md:19](D1-file-handling.md#L19) | trace |  |  | **No token count and no whole-vs-retrieve decision for chat files** (Stage 9 G18/G46, Stage 12 D1 30k). A 1,000-page text PDF or a 300 MB CSV is sent whole every turn; the failure is a provider `context_overflow` after the chip said "ready". |
| F-1285 | [D1-file-handling.md:20](D1-file-handling.md#L20) | trace |  |  | **Indic text is invisible to project search**: `tokenize` is ASCII-only (`retrieval.ts:415-419`), so a Tamil/Hindi chunk has zero tokens and is skipped (`retrieval.ts:524`). Chunks are silently capped at 400 per file (`retrieval.ts:22,686`). |
| F-1286 | [D1-file-handling.md:21](D1-file-handling.md#L21) | trace |  |  | **Deleting a project file destroys the bytes of chat attachments that were picked from it** (`projects.ts:530-535`, no reference check; `schema.ts:415-417` `ON DELETE SET NULL`), after which every later sandbox call in that chat fails with "was not found" (`codeExecutionExecutor.ts:508-513`). |
| F-1287 | [D1-file-handling.md:22](D1-file-handling.md#L22) | trace |  |  | **Audio over roughly 20 MB cannot be transcribed** (whole file as one inline base64 call, `retrieval.ts:200-207`) although the UI advertises 500 MB; no segments, no timestamps, no 3 h check. |
| F-1288 | [D1-file-handling.md:23](D1-file-handling.md#L23) | trace |  |  | **Untrusted files are parsed inside the API process** with no sniff, no bomb guard, no ClamAV (`EXTRACTION_MEMORY_PER_BYTE` is by *file* size only, `processUpload.ts:107-118`); `xlsx` 0.18.5 from npm (`backend/package.json:49`) is, from my knowledge and unverified here, a version with published CVEs. |
| F-1289 | [D1-file-handling.md:12](D1-file-handling.md#L12) | trace | prose |  | **The owner is right: file handling is poor against the locked design.** It is a *working* happy path for a few types (PDF ≤100 pages as page images + text, images, plain text, XLSX/Office text), built on a **synchronous, in-request, in-process extractor** (`routes/files.ts:233-266` → `services/attachments/processUpload.ts:148-164`). Stage 9's pipeline (intake sniff → ClamAV → ZIP → LibreOffice → Docling → OCR → audio → sheets → image normalise → Markdown+JSON sidecar → token count → chunks → embeddings → ready/failed) is, in the repo, three statuses (`uploading \| ready \| unsupported`, `db/schema.ts:422`), one `pdfinfo/pdftotext` call, one `officeParser`/`ExcelJS`/`SheetJS` call, and a text blob stored in a Postgres column (`attachments.extracted_text`). |
| F-1290 | [D1-file-handling.md:14](D1-file-handling.md#L14) | trace | prose |  | What is **right and worth keeping**: server-generated storage keys + traversal guard (`services/storage.ts:20-28,56-58`), ownership scoping on every file route (`routes/files.ts:470-483`), `nosniff` + attachment disposition (`files.ts:348-359`), the 10/message and 20/chat counts (`chats.ts:546`, `1114`), PDF page count cap 1,000 (`processUpload.ts:185-191`), poppler-rendered page images on demand with no stored copy (`services/attachments/pdfPages.ts:78-153`, matches G49), Gemini page images by `gs://` URI (`generation.ts:229-249`, `modelInputStore.ts:43-57`), the manifest "is it in your context" note (`manifest.ts:28-42`), hash-based chunked sandbox input transfer (`tools/sandbox/warmSandboxClient.ts:6-8`), tolerance for HTML tables disguised as `.xls` (`retrieval.ts:336-345`). |
| F-1291 | [D1-file-handling.md:16](D1-file-handling.md#L16) | trace | prose | P0 | **Worst problems (P0 = content wrong or lost):** |
| F-1292 | [D1-file-handling.md:25](D1-file-handling.md#L25) | trace | prose |  | UX against locked D1 / AS-D6: Send is blocked only while a file is *uploading* (`Composer.tsx:445,451`, `chats.ts:1103`). A failed/unsupported file is **sent along** with the message ("Files marked with a warning are sent without their text.", `Composer.tsx:836-837`), there is **no Retry** on chat files (`Composer.tsx:232-237` Remove only), and there is no ER-9 error taxonomy. |
| F-1293 | [D1-file-handling.md:27](D1-file-handling.md#L27) | trace | prose | P0 | Counts (Section 5): NEW-BUILD 16 · REWRITE 24 · DISCARD 4 · KEEP 14 (evidenced, 3 re-opened) · DIFF-STACK 1 · DIFF-INFRA/deferred 4 (listed, not bucketed). Severity of the 40 gap rows: P0 × 8, P1 × 26, P2 × 6 (rows can overlap; see table). |
| F-1294 | [D1-file-handling.md:79](D1-file-handling.md#L79) | trace |  |  | `processPdf` (`processUpload.ts:170`): `pdfinfo` page count `:173`; reject >1,000 pp `:185`; `pdftotext` split on form feed, `--- Page N ---` blocks `:209-218`; row ready with `extractedText`, `pageCount`. |
| F-1295 | [D1-file-handling.md:80](D1-file-handling.md#L80) | trace |  |  | Chip shows "12 pages" (`Composer.tsx:222`). `readingFor` = `text+visual` (`processUpload.ts:52`). |
| F-1296 | [D1-file-handling.md:81](D1-file-handling.md#L81) | trace |  |  | Send → `asPdfForModel` (`generation.ts:255`) → `pdfForModel` re-runs `pdfinfo`+`pdftotext`+`pdftoppm` (`pdfPages.ts:99-149`); the upload-time `extractedText` is **not used** for ≤100 pages (double extraction). Cache is per instance, in memory (`pdfPages.ts:41-61`). |
| F-1297 | [D1-file-handling.md:82](D1-file-handling.md#L82) | trace |  |  | **Gemini receives**, per page: a text label `["name" page N of M, fileId: …]`, the page image (`fileData` gs:// URI when `MODEL_INPUT_BUCKET` is set, else `inlineData`), then `Text of page N:` (`gemini.ts:42-51`). **Claude receives** the same as text/base64 image/text blocks (`anthropic.ts:237-251`). Manifest line: "in your context: N page images, a text layer on k of N" (`manifest.ts:31-36`). |
| F-1298 | [D1-file-handling.md:83](D1-file-handling.md#L83) | trace |  |  | Failure: `pdfinfo` fails (corrupt/encrypted) → status `unsupported`, message with first stderr line (`processUpload.ts:177-183`); chip warning + **Remove only**; the file can still be sent and the model gets "could not be opened as a PDF" (`attachmentContent.ts:101-105`). |
| F-1299 | [D1-file-handling.md:84](D1-file-handling.md#L84) | trace |  |  | Weak vs locked: no ClamAV, no encrypted-PDF error (G3), no JS strip (SE14); no token count / whole-vs-retrieve (G18, D1); N-13 not applied — all ≤100 pages go as images each turn; ~30 MB of JPEG for 100 pages (ADR-0013 measured 29.8 MB) exceeds Claude's 32 MB once base64 (hard `provider_payload_limit`, `modelLimits.ts:89-91`); no printed page label / furniture removal (Stage 12); no citation ids; legacy Tamil-font text layers (G35) unchecked; `pdftotext` at `pdfPages.ts:109` is unguarded, its failure surfaces as the misleading "could not be loaded from storage" (`generation.ts:1749-1756`). **Severity: P1** (works for small PDFs; cost, Claude failure on ~60+ page documents, no citations). |
| F-1300 | [D1-file-handling.md:87](D1-file-handling.md#L87) | trace |  |  | Upload: `pdftotext` returns nothing → `text=''`, status `ready`, `extractedText=null`, no note when ≤100 pages (`processUpload.ts:224-233`). The chip looks like a normal PDF; nothing says "scanned/OCR" (G25). |
| F-1301 | [D1-file-handling.md:88](D1-file-handling.md#L88) | trace |  |  | Send: ≤100 pages → same page images; Gemini/Claude get "Page N has no text layer; read it from the image." (`gemini.ts:50`, `anthropic.ts:249`). OCR happens inside the answering model **every turn**; no stored OCR text, no search, no confidence, no `ocr_engine/ocr_version` stamp (ADR-0006). |
| F-1302 | [D1-file-handling.md:89](D1-file-handling.md#L89) | trace |  |  | >100 pages (up to 1,000): `ready`, note "no text layer, so nothing in it can be read" (`processUpload.ts:224-226`); model gets only a note (`attachmentContent.ts:108-112`). The `pdf-reading` skill then tells the model to render pages and use pytesseract (`skills/pdf-reading/SKILL.md:60-61`) — an escape hatch, not OCR at upload. **Content lost for the model: P0.** |
| F-1303 | [D1-file-handling.md:90](D1-file-handling.md#L90) | trace |  |  | As a **project file**: `extractPdfPages` (`retrieval.ts:144-187`): if *any* page has a text layer, only text pages are indexed and scanned pages are dropped silently (`:155-162`); if none, `getScreenshot()` of **all pages** → one Gemini `describeMedia` call (`:174-179`; `gemini.ts:303-340`), no page cap, no `finishReason` check (output truncated at max tokens comes back as `ready`), result is one page-less block (`num: null`), so no page citations. Engine is Gemini Flash (global), not Document AI Mumbai (ADR-0006); no Document AI code or dependency exists (searched `backend/` for documentai/docai: none). |
| F-1304 | [D1-file-handling.md:91](D1-file-handling.md#L91) | trace |  |  | Failure UX: Gemini errors become `ExtractionUnsupported("…could not be read: ${String(err)}")` (`retrieval.ts:183`) → project file `unsupported` with raw error text. |
| F-1305 | [D1-file-handling.md:92](D1-file-handling.md#L92) | trace |  |  | Fixtures: `test/fixtures/scannedPdf.ts` builds a real image-only PDF but **nothing imports it** (searched `src`); the scanned path is tested only with a blank-page stub and a mocked provider (`retrieval.test.ts:49-69`). |
| F-1306 | [D1-file-handling.md:96](D1-file-handling.md#L96) | trace |  |  | `checkUpload` accepts by MIME or extension (`storage.ts:347-348`, fallback `:474-477`). Size gate: memory formula 370 B/B → ~11 MB at the 4 GiB budget (`processUpload.ts:107-118,152-162`); larger → `ready`, **no text**, note "Text is extracted from files of this type up to 11 MB". |
| F-1307 | [D1-file-handling.md:97](D1-file-handling.md#L97) | trace |  |  | `processDocument` → `extractWithOfficeParser` (`retrieval.ts:222-242`): `parseOffice(data, {ocr:false, fileType:'docx'})` → Markdown; tables become pipe rows; embedded images dropped **without a warning** (G10/G25); comments/tracked changes/headers/footers: **unverified** (no fixture, no node_modules). No page numbers, no heading/page sidecar (Stage 12), no LibreOffice→PDF visuals (V-4). |
| F-1308 | [D1-file-handling.md:98](D1-file-handling.md#L98) | trace |  |  | **Model on a sandbox turn** (warm service or process engine): a **pointer only** — "not in your context: read it from its file" (`manifest.ts:29`); the model must run pandoc/python-docx (`skills/file-reading/SKILL.md:30`) (ADR-0045; `generation.ts:813-817`). **Without sandbox**: Gemini `<document filename="…">text</document>` (`gemini.ts:71-76`), Claude a `document` block with `text/plain` source (`anthropic.ts:284-292`). No 30k-token rule, no retrieval. |
| F-1309 | [D1-file-handling.md:99](D1-file-handling.md#L99) | trace |  |  | Failure: encrypted/corrupt → `"This Word file could not be read: ${String(err)}"` (`retrieval.ts:236`) = raw library error to the user, status `unsupported`, no Retry; `.doc` / `.docm` → generic 415 "This file format is not supported…" (`storage.ts:479-484`), not the locked "save as DOCX" message (D9-12). |
| F-1310 | [D1-file-handling.md:100](D1-file-handling.md#L100) | trace |  |  | Tests: **none** read a real DOCX (only `Buffer.alloc(1000)` for the size gate, `processUpload.test.ts:100-110`); Stage 8 `a4_tamil_test.docx` exists in the older snapshot but is not in the repo. |
| F-1311 | [D1-file-handling.md:104](D1-file-handling.md#L104) | trace |  |  | Accepted as `.xlsx` and also `.xls` (`storage.ts:347-354`, pinned by `storage.test.ts:109-120`). Size gate 90 B/B → ~45 MB (`processUpload.test.ts:116`); register says ≤50 MB. |
| F-1312 | [D1-file-handling.md:105](D1-file-handling.md#L105) | trace |  |  | `extractSpreadsheet` (`retrieval.ts:289-358`): ExcelJS first for ZIP magic (`:298-326`), then SheetJS (`:270-286, 330`), then HTML-table (`:337-345`, India portal exports), then raw CSV (`:348-355`). Output: `--- sheet ---` + pipe grid. **Missing**: cell addresses (G47), formulas/"no cached value" warning (G12), hidden-sheet label (G37), multi-table split (Stage 12), per-sheet summary/samples, CSV/Parquet sidecar for code (G44/D9-8), any row/token cap (a million-row sheet becomes one text value). |
| F-1313 | [D1-file-handling.md:106](D1-file-handling.md#L106) | trace |  |  | Model: sandbox on → pointer (+ xlsx skill: pandas/openpyxl); sandbox off → full text inline on both providers. |
| F-1314 | [D1-file-handling.md:107](D1-file-handling.md#L107) | trace |  |  | Failure: password-protected workbook falls through every branch and ends in the misleading "has no cells with data on any sheet" (`retrieval.ts:357`), not `encrypted`. |
| F-1315 | [D1-file-handling.md:108](D1-file-handling.md#L108) | trace |  |  | Preview: server-typed first rows works for `.xlsx` only (`files.ts:363-384`, `FilePreviews.tsx:99-186`, 25 MB cap `sheetPreview.ts:10`) — meets RD-5 for xlsx; CSV has no grid preview. |
| F-1316 | [D1-file-handling.md:109](D1-file-handling.md#L109) | trace |  |  | Tests: real in-test workbooks, BIFF8 `.xls` and HTML-disguised (`retrieval.test.ts:201-282`), octet-stream upload (`files.integration.test.ts:77`); none for hidden sheets, formulas, merged cells, multi-table, password, 50 MB. `skill-tests/lakh_format_test.xlsx` unused. |
| F-1317 | [D1-file-handling.md:113](D1-file-handling.md#L113) | trace |  |  | Same path as DOCX with `fileType:'pptx'` (`retrieval.ts:54-56,233`); 16 B/B → ~256 MB. Comment at `retrieval.ts:230-232` records a past misdetection of a 30 MB pptx as zip. |
| F-1318 | [D1-file-handling.md:114](D1-file-handling.md#L114) | trace |  |  | Text via officeParser Markdown. **Unverified / not built**: slide markers, speaker notes (G11), table fidelity, chart data, image warnings (G10), slide→PDF visuals (V-4). `parseOffice(…, {ocr:false})` explicitly skips OCR of embedded images. |
| F-1319 | [D1-file-handling.md:115](D1-file-handling.md#L115) | trace |  |  | Model: sandbox on → pointer (python-pptx via skill); off → inline text. No per-slide locator for citations. |
| F-1320 | [D1-file-handling.md:116](D1-file-handling.md#L116) | trace |  |  | Failure/limits: same raw-error and legacy (`.ppt`, `.pptm` → generic 415) behaviour as DOCX. |
| F-1321 | [D1-file-handling.md:117](D1-file-handling.md#L117) | trace |  |  | Tests: **none** (no fixture, no extraction test). `skill-tests/deck_16x9_test.pptx` unused. |
| F-1322 | [D1-file-handling.md:121](D1-file-handling.md#L121) | trace |  |  | `checkUpload` allows only those four (`storage.ts:376-379`); **HEIC/HEIF (Android camera) → 415** (`storage.ts:479-484`). Frontend caps 10 MB (`storage.ts:65`); `processImage` caps 10 MB and 8000 px via `image-size` header read (`processUpload.ts:236-266`). No EXIF rotate/strip, no re-encode, no resize, no OCR (G14, G15, G36, SE14). |
| F-1323 | [D1-file-handling.md:122](D1-file-handling.md#L122) | trace |  |  | Model: bytes read from storage and base64'd unchanged (`generation.ts:1752`). **Gemini**: `inlineData` always — single images never use `gs://` (ADR-0016 line 57; `gemini.ts:66-68`). **Claude**: `image` base64 block (`anthropic.ts:273-282`); `enforceModelLimits` throws `provider_payload_limit` for any image whose base64 exceeds 5,242,880 bytes (≈3.9 MB raw) (`modelLimits.ts:81-83`) — a normal 4–10 MB phone photo cannot be sent to Claude at all; the user must switch model (`generation.ts:2296-2310` text). No >20-images ≤2,000 px rule (G48), no 28×28 token accounting. |
| F-1324 | [D1-file-handling.md:123](D1-file-handling.md#L123) | trace |  |  | Project image files are stored but unindexed: `ExtractionUnsupported("Images are stored…")` (`retrieval.ts:80-84`). |
| F-1325 | [D1-file-handling.md:124](D1-file-handling.md#L124) | trace |  |  | Tests: synthetic grayscale PNG only (`test/fixtures/files.ts:43-57`); no JPEG with EXIF, WebP, GIF, CMYK, HEIC. |
| F-1326 | [D1-file-handling.md:128](D1-file-handling.md#L128) | trace |  |  | Accepted (`storage.ts:366-368`; extension fallback `:464-469` for empty/octet-stream/`text/*` claims — **any bytes** under a `.txt` name are accepted, no sniff). |
| F-1327 | [D1-file-handling.md:129](D1-file-handling.md#L129) | trace |  |  | `extractText` → `data.toString('utf8')` (`retrieval.ts:74-76`): no BOM/UTF-16/Windows-1252/Indic legacy encoding handling (the file-reading skill itself warns Tamil text "is often not UTF-8", `SKILL.md:40-43`), no binary check (a renamed ZIP/PNG becomes mojibake in the prompt, against the "binary is never decoded as text" invariant stated at `attachmentContent.ts:5-7`), no size/token cap (500 MB limit `numbers.ts:59`; stored whole in `attachments.extracted_text` and re-read for **every** history load, `generation.ts:1582-1592`). |
| F-1328 | [D1-file-handling.md:130](D1-file-handling.md#L130) | trace |  |  | Model: both providers get the whole text inline on every turn (CSV/MD/TXT are excluded from read-with-code, `attachmentContent.ts:66-67`). A big CSV ends in `context_overflow` (`generation.ts:2285-2294`) *after* the chip said ready. No CSV/Parquet sidecar, no per-column summary (G44). |
| F-1329 | [D1-file-handling.md:131](D1-file-handling.md#L131) | trace |  |  | Pasted text >4,000 chars becomes `pasted-text.txt` (`Composer.tsx:158-164`) — fine. |
| F-1330 | [D1-file-handling.md:132](D1-file-handling.md#L132) | trace |  |  | Tests: `files.integration.test.ts:53,103` (250 kB `x…` string); none for encodings, BOM, big CSV. |
| F-1331 | [D1-file-handling.md:136](D1-file-handling.md#L136) | trace |  |  | Frontend `allowed` regex has no `zip` (`storage.ts:46-47`); backend `ALLOWED` has no `application/zip` (`storage.ts:341-390`). The upload is refused with the generic 415 text. No unpack, no inspection, no nested-ZIP rule, no members-as-files, no caps (UD-2, G5; N-10 ZIP 100 MB / 20 files / 500 MB unpacked). |
| F-1332 | [D1-file-handling.md:137](D1-file-handling.md#L137) | trace |  |  | Only workaround: none for the user (the sandbox `file-reading` skill lists `.zip` at `SKILL.md:36`, but an upload can never reach `input/`). |
| F-1333 | [D1-file-handling.md:138](D1-file-handling.md#L138) | trace |  |  | Tests: none (feature absent). `jszip` (`backend/package.json:56`) and `fflate` (`accountExport.ts:8`) are present for other uses. |
| F-1334 | [D1-file-handling.md:93](D1-file-handling.md#L93) | trace | severity | P0 | **Severity: P0** (lost/partial content for >100-page scans, mixed PDFs and large project scans; no OCR text for search). |
| F-1335 | [D1-file-handling.md:101](D1-file-handling.md#L101) | trace | severity | P1 | **Severity: P1** (text mostly works; images/visuals lost silently; >11 MB without text; raw errors; legacy/macro message). With sandbox off and file >11 MB it is P0 for that file. |
| F-1336 | [D1-file-handling.md:110](D1-file-handling.md#L110) | trace | severity | P1 | **Severity: P1** (readable, but lossy and unbounded; `.xls` contradicts D9-12; vulnerable parser risk in 4). |
| F-1337 | [D1-file-handling.md:118](D1-file-handling.md#L118) | trace | severity | P1 | **Severity: P1** (P0 if notes/slide structure are in fact dropped — unverified). |
| F-1338 | [D1-file-handling.md:125](D1-file-handling.md#L125) | trace | severity | P1 | **Severity: P1** (EXIF/GPS retained and served back — privacy; Claude hard-fails on big photos; HEIC rejected). |
| F-1339 | [D1-file-handling.md:133](D1-file-handling.md#L133) | trace | severity | P1 | **Severity: P1.** |
| F-1340 | [D1-file-handling.md:139](D1-file-handling.md#L139) | trace | severity | P1 | **Severity: P1** (locked MVP type; build plan P2-A lists it). |
| F-1341 | [D1-file-handling.md:76](D1-file-handling.md#L76) | trace | prose |  | Common entry for every type: `Composer.addFiles` (`Composer.tsx:388`) → `validateFile` (`storage.ts:56`) → `api.files.upload` (`api.ts:1045`) → `POST /files/uploads` (`files.ts:137`) → `checkUpload` (`storage.ts:428`) → PUT bytes (`api.ts:656`) → `POST /files/:id/complete` (`files.ts:233`) → `finishUpload` (`files.ts:501`) → `processUpload` (`processUpload.ts:148`). On send: `Composer.submit` (`:450`) → `POST /chats/:id/generate` (`chats.ts:563`) → `appendTurn` (`:1085`) → `generation.run` → `hydrateAttachmentBytes` (`generation.ts:1738`) → `limitToModel` (`:1773`) → provider adapter. |
| F-1342 | [D1-file-handling.md:142](D1-file-handling.md#L142) | trace | prose | P0 | `audio/*`/`video/*` are accepted (`storage.ts:381-389`; video is not in Stage 1 R5 / N-10). Upload-time: `processDocument` → `extractAudioVideo` sends the **whole file as one inline base64 `generateContent` call** (`retrieval.ts:200-207`, `gemini.ts:314-324`). Anything above the provider's inline limit fails → status `unsupported` with `String(err)` (`retrieval.ts:209`). When it works the transcript is plain text, no `t_start–t_end` segments, no speaker/timestamp locators (G16, Stage 12 60–120 s segments, G41). **Gemini** is then also sent the raw audio inline each turn (`gemini.ts:59-68`); **Claude** gets only the stored transcript (`anthropic.ts:285-292`) and, if transcription failed, "no readable text". **Severity: P0** above ~20 MB. |
| F-1343 | [D1-file-handling.md:149](D1-file-handling.md#L149) | trace |  |  | Per-type N-10 limits are not implemented; one flat 500 MB attachment ceiling and one 30 MB project ceiling (`numbers.ts:57-59`). The *effective* text-extraction limits are an unrelated memory formula (docx ~11 MB, xlsx ~45 MB, pptx ~256 MB): a 15 MB DOCX uploads "ready" with **no text** (`processUpload.ts:152-162`). (The memory ratios were measured, `mistakes.md` "2026-09-25 (memory)"; they are an artefact of parsing in the API process, G6.) |
| F-1344 | [D1-file-handling.md:150](D1-file-handling.md#L150) | trace |  |  | Page limits: 1,000 ✓. Image: 10 MB (register 20 MB) and a 8000 px cap that no locked doc requires (Claude parity from ADR-0011). |
| F-1345 | [D1-file-handling.md:151](D1-file-handling.md#L151) | trace |  |  | Files per message/chat ✓ (counts include picked project files). Count and rate quotas (N-11/G33), project file count: none. |
| F-1346 | [D1-file-handling.md:152](D1-file-handling.md#L152) | trace |  |  | `HISTORY_MAX_ATTACHMENT_BYTES` 12 MB (`config.ts:176`) has no N-id; it only governs Gemini-without-bucket and non-PDF bytes. |
| F-1347 | [D1-file-handling.md:153](D1-file-handling.md#L153) | trace |  |  | Gemini inline limit conflict (7 MB vs 20 MB) and Claude 30 vs 32 MB are open (see Section 7). |
| F-1348 | [D1-file-handling.md:156](D1-file-handling.md#L156) | trace |  |  | Server: only `uploading` blocks, with code `upload_incomplete` 409 (`chats.ts:1103-1107`); Stage 5 FG3 wants 409 "file not ready" and "failed file must be removed first". `unsupported` and failed files pass. |
| F-1349 | [D1-file-handling.md:157](D1-file-handling.md#L157) | trace |  |  | The generate route loads attachments **without a status filter** (`chats.ts:589-609`) while history loads `ready` only (`generation.ts:1601`, `1649`) — an `unsupported` file is sent on its own turn and silently vanishes from later turns. |
| F-1350 | [D1-file-handling.md:158](D1-file-handling.md#L158) | trace |  |  | Client: `pending` blocks Send (`Composer.tsx:445,808`); `unusable` only changes the disclaimer (`:446-448,833-838`); `submit` sends `ready\|unsupported` and drops `failed` chips without telling the user (`:452-458`). |
| F-1351 | [D1-file-handling.md:159](D1-file-handling.md#L159) | trace |  |  | States: `uploading\|ready\|unsupported` only (`schema.ts:422`); no queued/scanning/extracting/ocr/transcribing/indexing (G22), no progress other than upload bytes, no "N files indexing" (Stage 12), no `error_code`. |
| F-1352 | [D1-file-handling.md:160](D1-file-handling.md#L160) | trace |  |  | Extraction runs inside the HTTP request and behind a **process-wide serial queue** (`processUpload.ts:141-146`): one slow PDF holds every other user's `complete` call on that instance (G30 "fast lane ≤10 s" unmet). A crash mid-extraction leaves the row `uploading` for 24 h (`config.ts:338`). |
| F-1353 | [D1-file-handling.md:163](D1-file-handling.md#L163) | trace |  |  | Chat files: Remove (X) only; the failed row is already deleted server-side by `api.files.upload` (`api.ts:1054-1057`) so "retry" means re-pick the file. No retry endpoint. Project files have `POST …/reindex` (`projects.ts:484-508`) and a Re-index button (`Pages.tsx:393`) — chat files have nothing comparable. |
| F-1354 | [D1-file-handling.md:164](D1-file-handling.md#L164) | trace |  |  | ER-9 codes: unsupported_type ≈ `unsupported_media_type` (415, generic text); too_large/too_many_pages ≈ `payload_too_large` (413); encrypted, corrupt, malware, ocr_failed, ocr_blocked, timeout, quota: **none** (free-text `error` column; raw `String(err)` in `retrieval.ts:183,209,236`). "Save as" copy for legacy/macro: absent. |
| F-1355 | [D1-file-handling.md:167](D1-file-handling.md#L167) | trace |  |  | No `[file:n]`, no `chat_citation` registry, no cite ids (searched `backend/src`, skills, frontend: only docs). `message_sources` is web-only (`url NOT NULL`, `domain`, `schema.ts:327-345`). Retrieval chunks carry `page` (`retrieval.ts:423-432`) and `formatContext` prints "(p. N)" (`:560`), and the `file-reading` skill tells the model to "say which sheet, rows or pages" in prose (`SKILL.md:47-48`). That is all. |
| F-1356 | [D1-file-handling.md:168](D1-file-handling.md#L168) | trace |  |  | Viewer: PDF = blob in an `<iframe>` (`Panels.tsx:950-951`); no pdf.js/react-pdf dependency (`arcnave-frontend/package.json`: only `docx-preview`, `katex`, `react-markdown`, `recharts` among relevant); no page jump or highlight; the panel fetches the **whole file as a blob** (up to 500 MB) for every type (`Panels.tsx:848-857`). |
| F-1357 | [D1-file-handling.md:169](D1-file-handling.md#L169) | trace |  |  | Build plan P2-E "citation viewer check (pdf.js highlight)" is the matching task. |
| F-1358 | [D1-file-handling.md:172](D1-file-handling.md#L172) | trace |  |  | Every chat file is downloaded in full and placed in `input/` on the first code call of each turn (`codeExecutionExecutor.ts:440-445,497-518`; `executionRuntime.ts:203-255`); no per-file cap (N-08: ≤30 MB × 10), workspace limit 2 GiB (`server.py:63`). |
| F-1359 | [D1-file-handling.md:173](D1-file-handling.md#L173) | trace |  |  | **One** missing/unreadable file makes **every** code call in the chat fail (`codeExecutionExecutor.ts:508-513`) — the "attachments Not found" class from `mistakes.md` (2026-09-18/-24) still exists for deleted bytes. |
| F-1360 | [D1-file-handling.md:174](D1-file-handling.md#L174) | trace |  |  | Project files never reach `input/` (`chatFilesOf` reads only `attachments`, `generation.ts:393-412`): a workbook in a project is available only as 1,400-char text chunks, never as data for pandas/DuckDB (Stage 8 TD-4c adds DuckDB; G44). |
| F-1361 | [D1-file-handling.md:175](D1-file-handling.md#L175) | trace |  |  | `input/` is not OS-read-only: the workspace uid owns it (`server.py:166-170`); read-only is enforced only in the tool wrapper (`codeExecutionExecutor.ts:113-117,175-204`). Inputs are re-verified by sha256 on each run, which limits the damage. |
| F-1362 | [D1-file-handling.md:176](D1-file-handling.md#L176) | trace |  |  | Image content: `Dockerfile.service:28,30` installs **pymupdf** and **pytesseract**; Stage 8 checkpoint excludes PyMuPDF (AGPL) (`00-checkpoint-stage8.md:43`), Stage 20 excludes AGPL from customer-serving runtime (`20-vendor-tool-selection.md:5,72`), and the Stage 9 scope doc lists "no PyMuPDF/pytesseract" as decided (`09-file-processing-scope.md:21`). The `pdf-reading` skill is written around `pymupdf` (`SKILL.md:32-35,56-57,65-67`). The Cloud Run Job image has no readers at all (`Dockerfile:12-15`), hence the inline-text fallback (`catalog.ts:13-15`). |
| F-1363 | [D1-file-handling.md:177](D1-file-handling.md#L177) | trace |  |  | ADR-0045 (pointer only on sandbox turns) differs from Stage 9 CF4/D9-8 (always send our extracted text; whole when ≤30k tokens). Live evidence for the cost: 26-call OCR loop and re-reading loops in `mistakes.md` / ADR-0052. |
| F-1364 | [D1-file-handling.md:178](D1-file-handling.md#L178) | trace |  |  | `RUN_PYTHON_CODE_TIMEOUT_MS` 10 s and warm 300 s (`numbers.ts:51-53`) vs N-08 60 s (Deep 120 s) — different, documented in the file. |
| F-1365 | [D1-file-handling.md:206](D1-file-handling.md#L206) | trace |  |  | Bucket/region: the attachments bucket's location is not documented in the repo (searched `docs/deploy`, `docs/runbooks`); model-inputs is `asia-south1`; `SANDBOX_LOCATION` defaults to `us-central1` (`config.ts:254`). Build plan P2-C covers verification. Residency is B-7 (deferred, not bucketed). |
| F-1366 | [D1-file-handling.md:207](D1-file-handling.md#L207) | trace |  |  | "Resumable" is the session URI only; the browser sends a single PUT (`api.ts:681`), so a dropped connection on a 500 MB file restarts from zero (UD-1..4 session intent). |
| F-1367 | [D1-file-handling.md:208](D1-file-handling.md#L208) | trace |  |  | After `complete` validated the bytes, the resumable session URI stays valid for its own lifetime (GCS default ~1 week) and "can write that one object" (ADR-0011): bytes can be replaced after validation; nothing records the object generation or a checksum for chat attachments (project files store `checksum_sha256`, attachments do not, `schema.ts:166` vs `401-435`). |
| F-1368 | [D1-file-handling.md:209](D1-file-handling.md#L209) | trace |  |  | Derived Gemini page images (7-day bucket, hash-named) are not deleted with the file or chat (`modelInputStore.ts:22`, ADR-0016); G29/G45 want derived data removed with the file. |
| F-1369 | [D1-file-handling.md:210](D1-file-handling.md#L210) | trace |  |  | File claim: `appendTurn` updates `message_id` without `IS NULL` (`chats.ts:1158-1165`), so a file already sent in message A can be re-attached to a new message; the row moves, A loses its file, and the "refuse deleting a sent file" invariant (`files.ts:404-409`) is bypassed. |
| F-1370 | [D1-file-handling.md:211](D1-file-handling.md#L211) | trace |  |  | Memory (Stage 11): "never save file/tool content" is a prompt policy line (`services/memory/policy.ts:59,63`, long lines, not re-read in full); no code path stores file text in memory. Treated as KEEP-unverified. |
| F-1371 | [D1-file-handling.md:183](D1-file-handling.md#L183) | trace | Extractor |  | poppler + officeParser/ExcelJS — **pdf-parse (pdf.js)** + officeParser/ExcelJS (`retrieval.ts:144-187`) — different text for the same PDF |
| F-1372 | [D1-file-handling.md:184](D1-file-handling.md#L184) | trace | When |  | in `/complete` request — in the upload request (`projects.ts:422`), "nothing to poll" |
| F-1373 | [D1-file-handling.md:185](D1-file-handling.md#L185) | trace | Storage of text |  | `attachments.extracted_text` — chunks 1,400 chars, ≤400 per file (`retrieval.ts:20-22,686`) — silent truncation, `whole=false` only affects the whole-file switch |
| F-1374 | [D1-file-handling.md:186](D1-file-handling.md#L186) | trace | To the model |  | whole, every turn — all files whole if ≤200,000 characters total (`config.ts:171`, `generation.ts:1957-1966`), else search tools (ADR-0029); the whole-file query reloads **all** chunks of the project each turn (`retrieval.ts:605-617`) |
| F-1375 | [D1-file-handling.md:187](D1-file-handling.md#L187) | trace | Page images |  | yes (≤100 pp) — never |
| F-1376 | [D1-file-handling.md:188](D1-file-handling.md#L188) | trace | Citations |  | none — page in tool results only |
| F-1377 | [D1-file-handling.md:189](D1-file-handling.md#L189) | trace | Sandbox |  | yes (`input/`) — no |
| F-1378 | [D1-file-handling.md:196](D1-file-handling.md#L196) | trace | PDF ≤100 pp |  | page image (`gs://` URI if bucket set, else inline) + page text — base64 image + page text; request cap 32 MB → hard error near 60–100 image pages; 600-page cap (`capabilitiesTable.ts:52`) |
| F-1379 | [D1-file-handling.md:197](D1-file-handling.md#L197) | trace | PDF >100 pp |  | text only — text only |
| F-1380 | [D1-file-handling.md:198](D1-file-handling.md#L198) | trace | Image |  | inline, ≤20 MB (repo) — base64, hard error >5 MB base64 |
| F-1381 | [D1-file-handling.md:199](D1-file-handling.md#L199) | trace | Audio/video |  | inline raw (`gemini.ts:59-68`) — transcript made at upload by Gemini; none if that failed |
| F-1382 | [D1-file-handling.md:200](D1-file-handling.md#L200) | trace | Office/text |  | `<document>` text, or pointer — `document` text block, or pointer |
| F-1383 | [D1-file-handling.md:201](D1-file-handling.md#L201) | trace | History |  | 12 MB inline budget unless PDF+bucket (`generation.ts:1811-1816`) — newest-first fit under 32 MB / 600 pp (`modelLimits.ts:94-112`) |
| F-1384 | [D1-file-handling.md:202](D1-file-handling.md#L202) | trace | Context overflow |  | detected only from the provider error (`generation.ts:2244-2255`) — same |
| F-1385 | [D1-file-handling.md:191](D1-file-handling.md#L191) | trace | prose |  | Picking a project file into a chat (`files.ts:270-311`): the new row has `extractedText: null`, `pageCount: null`, `status: 'ready'` regardless of the project file's status (`:297-306`). For DOCX/XLSX/PPTX with no sandbox the model receives "no readable text" (`attachmentContent.ts:108-112`); for PDFs `readingFor` says `text`/`none` because `pageCount` is null (`processUpload.ts:50-58`) although the PDF is rendered anyway. Deleting a project file deletes the shared object (`projects.ts:530-535`) while chat rows keep pointing at it; `retention.ts:74-77` has a reference check for chats but project deletion does not. Search is BM25 over ASCII tokens only (see 5, row 12a). |
| F-1386 | [D1-file-handling.md:203](D1-file-handling.md#L203) | trace | prose |  | The transport differences are intentional; the **outcome** difference that matters is that the same photo or the same 80-page scan works on Gemini and errors on Claude. |

## D2 AI output — anatomy and prose (43)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1387 | [D2-ai-output.md:29](D2-ai-output.md#L29) | trace |  |  | **One oversized, Claude-app-shaped prompt is sent to every model, including the default Gemini 3.8 Flash.** Approx 85 k chars of system text plus ~45 k chars of 35 tool declarations (≈ 30 k tokens before the first user word, full config) against a locked Stage 6 budget of ≈ 6.5 k + 2.2 k tokens (`00-checkpoint-stage6.md:51`). Stage 6 CXD-3b locked two per-model renderings; the Gemini one puts 12 critical rules first and says "give complete, well-explained answers… not terse notes" (`06-system-prompt-v3-gemini.md:23-44,73-75`). The repo has neither, and says the opposite: "Be concise by default", "give a high-level explanation", "answer in prose" (`systemPrompt.ts:66,69`). That line was in every earlier prompt version (v1:317, v2:352, v2.1:390) and is the target of locked eval case S18 ("Gemini terse check"). |
| F-1388 | [D2-ai-output.md:35](D2-ai-output.md#L35) | trace |  |  | **Auto sends nearly everything to Gemini 3.8 Flash and then pins the chat there** (`routing.ts:76`, `generation.ts:1306-1319`). Code, document and agentic work is where Stage 7 §7.9 shows the largest gap to Sonnet (Terminal-Bench 19.1 % vs 70.6 %). Stage 7 RT-3/MR16 (complex work to Sonnet) and the Fast/Normal/Deep profiles (PR-1, RT-4) are not built. |
| F-1389 | [D2-ai-output.md:38](D2-ai-output.md#L38) | trace |  |  | **Context handling has two live defects.** (a) ADR-0023 says tool results are never cleared; ADR-0031 §5 re-added clearing for Gemini and it is live (`gemini.ts:382-408`, `config.ts:158-160`) — the exact failure in mistakes.md 2026-09-25. (b) `loadHistory` is called with the *requested* alias, which is `Auto` by default, so the window falls back to 128 000 and the history budget is ≈ 463 k chars, silently dropping the oldest turns with no summary (`generation.ts:445-450,1562-1577`, `capabilitiesTable.ts:128-144`), while compaction waits for 967 k tokens (`autoCompact.ts:41-51`). |
| F-1390 | [D2-ai-output.md:42](D2-ai-output.md#L42) | trace |  |  | **Nothing measures answer quality.** The repo's prompt kit is 89 derived cases: 70 are `toContain` string checks on the repo's own text and 19 are skipped as "live only" (`test/promptKit/cases.ts:1-20`); the 68 behavioural Stage 6 cases (readable in `D:\Architecture`, not in the mirror) run nowhere, and the prompt-size test bound was raised twice to ≈ 10 000 tokens (`behaviorEvaluation.test.ts:32-47`). Stage 13 validators are mostly absent. |
| F-1391 | [D2-ai-output.md:24](D2-ai-output.md#L24) | trace | prose |  | The plumbing around the model is mostly sound: no `temperature`/`top_p`/`top_k` anywhere (grep, `backend/src` non-test), SDK retries off |
| F-1392 | [D2-ai-output.md:25](D2-ai-output.md#L25) | trace | prose |  | (`anthropic.ts:51`), explicit effort on every request (`anthropic.ts:490`, `gemini.ts:440-443`), thought signatures handled, usage summed per |
| F-1393 | [D2-ai-output.md:26](D2-ai-output.md#L26) | trace | prose |  | round, forced final answer carries the tool steps (`generation.ts:1108-1118`). The weak points are in what the model is told and |
| F-1394 | [D2-ai-output.md:27](D2-ai-output.md#L27) | trace | prose |  | what it is given: |
| F-1395 | [D2-ai-output.md:46](D2-ai-output.md#L46) | trace | prose |  | Counts (§3, 45 rows): 9 High, 20 Medium, 14 Low, 2 KEEP with no gap. Primary buckets: REWRITE 24, NEW-BUILD 11, owner question 5, KEEP 4, DIFF 1. |
| F-1396 | [D2-ai-output.md:47](D2-ai-output.md#L47) | trace | prose |  | Eight ranked hypotheses are in §4; the first three explain most of "very poor" if the poor turns ran on Gemini Flash through Auto. The cheapest first step |
| F-1397 | [D2-ai-output.md:48](D2-ai-output.md#L48) | trace | prose |  | is not code: read the turn logs of five poor answers (`GET /v1/chats/:id/messages/:messageId/log`) and pin one chat to Sonnet 5.5 for a day (§4). |
| F-1398 | [D2-ai-output.md:72](D2-ai-output.md#L72) | trace |  |  | `systemInstruction` = S1+S2 as **one string** (`gemini.ts:420`); on the last allowed round `FINAL_ROUND_NOTE` is appended (`405-407`). |
| F-1399 | [D2-ai-output.md:73](D2-ai-output.md#L73) | trace |  |  | `tools` = `[googleSearch]` (if grounded) + `[codeExecution]` (if enabled) + `[{functionDeclarations: 35}]` built from `parametersJsonSchema` clones (`422-432`, `89-95`). |
| F-1400 | [D2-ai-output.md:74](D2-ai-output.md#L74) | trace |  |  | `toolConfig`: `mode NONE` on the forced-answer round, else `streamFunctionCallArguments: true` (`433-437`). |
| F-1401 | [D2-ai-output.md:75](D2-ai-output.md#L75) | trace |  |  | `thinkingConfig {includeThoughts: true, thinkingLevel: LOW\|MEDIUM\|HIGH}`; `maxOutputTokens` 64 000; timeout 600 s (`438-447`). |
| F-1402 | [D2-ai-output.md:76](D2-ai-output.md#L76) | trace |  |  | `contents`: history → each earlier assistant turn's calls as **signed** `functionCall` + `functionResponse` groups when the first call carries a signature, else the whole turn's calls as prose text inside the assistant message (`182-209`, `types.ts:132-147`); PDF pages as label + `fileData gs://` (bucket set) or `inlineData` + page text (`38-55`); text documents as `<document filename="…">` (`74`, filename unescaped). |
| F-1403 | [D2-ai-output.md:77](D2-ai-output.md#L77) | trace |  |  | In-turn loop adds `{model: text+calls}` / `{user: responses}` per round; thought text and non-call signatures are not replayed (`537-566`). **Function results older than the last 3 are replaced by a placeholder once the previous request was ≥ 100 000 tokens** (`381-408`, `contextEditing.ts:11-36`). |
| F-1404 | [D2-ai-output.md:78](D2-ai-output.md#L78) | trace |  |  | Cache: implicit only (`156-160`). |
| F-1405 | [D2-ai-output.md:82](D2-ai-output.md#L82) | trace |  |  | `system` = two blocks: stable prefix with `cache_control: ephemeral`, then the dynamic suffix uncached (`441-464`); one string if caching is off. |
| F-1406 | [D2-ai-output.md:83](D2-ai-output.md#L83) | trace |  |  | `tools` = `web_search_20260209` (`max_uses 5`, only when grounded) + 35 custom tools (`473-476`, `38`); `tool_choice` `auto`, or `none` on the last round with tools still declared (`478-479`). |
| F-1407 | [D2-ai-output.md:84](D2-ai-output.md#L84) | trace |  |  | `thinking {type: adaptive, display: summarized}`, `output_config {effort}`, `max_tokens` 64 000 (`484-490`). |
| F-1408 | [D2-ai-output.md:85](D2-ai-output.md#L85) | trace |  |  | `messages`: history with `tool_use`/`tool_result` pairs, ids renamed `hist_t_i` (`318-327`); PDF pages as text label + image + page text (`237-251`); text docs as `document` blocks (`284-293`); current turn = media blocks then text; a second cache breakpoint on the message before the newest (`369-376`); consecutive same-role messages merged (`347-364`). |
| F-1409 | [D2-ai-output.md:86](D2-ai-output.md#L86) | trace |  |  | In-turn loop returns `final.content` (thinking blocks included) unchanged (`583`); parallel results in one user message (`585-620`); a duplicate failed call is refused with a canned note (`595-609`, **Gemini has no equivalent**). No context-editing, no compaction beta (consistent with the forbidden-pattern list). |
| F-1410 | [D2-ai-output.md:87](D2-ai-output.md#L87) | trace |  |  | Not replayed across turns: thinking blocks (only `messages.thinking` text is stored, no signature). |
| F-1411 | [D2-ai-output.md:59](D2-ai-output.md#L59) | trace | S1 |  | **Stable prefix**, in this order: static base (17 blocks) → `memory_policy` (only if `memory_read` allowed) → `past_chats_policy` (if `conversation_search`) → `compaction_policy` (always) → `visuals` (if `show_widget`) — `promptAssembly.ts:26-55` (31-41); base `systemPrompt.ts:24-166` — base ≈ 36 k chars (≈ 9 k tok): identity 32-34, core_behavior 36-48, truthfulness 50-57, communication 59-72 (≈ 6 k), trust_boundaries 74-79, safety 81-92 (≈ 6 k), wellbeing 94-100 (≈ 4.5 k), evenhandedness 102-104, tool_use 106-114, professional_deliverables 116-125, source_transformation 127-130, agent_behavior 132-135, mistakes 137-139, knowledge 141-145, user_preferences 147-156, permissions 158-160, final_response 162-164. Memory policy ≈ 15 k (`memory/policy.ts:11-70`), past-chats ≈ 5 k (73-81), compaction 0.6 k, visuals ≈ 3 k. Stable total ≈ 60 k chars (≈ 15 k tok) full set, ≈ 37 k (≈ 9 k tok) for a turn with only `ask_user_input_v0` |
| F-1412 | [D2-ai-output.md:60](D2-ai-output.md#L60) | trace | S2 |  | **Dynamic suffix**, in this order: date line (+ mobile line) → `<arcNave_capabilities>` (+ `<computer_use>` with Skills/The computer/Creating files/Artifacts, + `<files>`, + `<research>` + `<web>`) → `<standing_preferences>` → `<project_instructions>` → `<style_instructions>` → `<memory>` (listing, profile, preferences) → `<conversation_compaction>` → project files (whole, **unwrapped**) or `<project_knowledge>` stub → mode directive (**unwrapped**) → `<skills_guidance>` (`<available_skills>` + re-injected skills) — `promptAssembly.ts:71-132` (81-123); runtime text `systemPrompt.ts:368-450`; project files `generation.ts:1954-2011`; mode `2013-2021` — capabilities ≈ 1 k; computer_use ≈ 14 k (guidance ≈ 8 k + artifacts ≈ 6 k, 180-243); files ≈ 2.5 k; research+web ≈ 9 k with search on (258-361); skills list ≈ 3 k (8 skills). User-controlled: standing prefs ≤ 20 000 chars (`preferences.ts:87`), project instructions ≤ 20 000 (`projects.ts:181`), style instructions no max (`styles.ts:109`), memory listing/profile/preferences ≤ 8 000 each (`config.ts:307`, `memoryService.ts:459-464`), project files whole up to 200 000 chars (`config.ts:171`), summary up to the 64 000-token output |
| F-1413 | [D2-ai-output.md:61](D2-ai-output.md#L61) | trace | S3 |  | **Tools**: the registry declares every allowed tool every turn, no discovery: `ask_user_input_v0`, 6 memory, 3 past-chat, `read_me` + `show_widget` + 13 display cards, 3 web, 5 computer, 2 project = 35 — `tools/registry.ts:50-63`, `turnRouter.ts:39-67`, `generation.ts:569-602` — ≈ 45 k chars (≈ 11 k tok); display cards alone ≈ 22 k (`displayDefinitions.ts`) |
| F-1414 | [D2-ai-output.md:62](D2-ai-output.md#L62) | trace | S4 |  | **History**: every message since the last compaction, oldest first, assistant tool calls with full results, PDF page images/text, Office text or "read from file" pointer; no turn cap, character backstop only — `generation.ts:1511-1656`; tool calls `history/toolHistory.ts:20-49`; backstop `1560-1577` — unbounded below ≈ 463 k chars under `Auto`, ≈ 4.1 M chars when the alias is pinned |
| F-1415 | [D2-ai-output.md:63](D2-ai-output.md#L63) | trace | S5 |  | **Current user turn**: this turn's attachments (pages as label + image + page text; text docs; Office pointers), then `<available_attachments>` manifest, then the user's prompt last — `generation.ts:829-832`; manifest `attachments/manifest.ts:68-85` — prompt ≤ 100 000 chars (`chats.ts:543`) |
| F-1416 | [D2-ai-output.md:64](D2-ai-output.md#L64) | trace | S6 |  | **Params**: `maxOutputTokens` = min(pref 64 000, 128 000, model cap); effort = request > pref > `REASONING_EFFORT` medium, clamped per model; no sampling parameters — `generation.ts:679-689`; `capabilitiesTable.ts:151-157` — — |
| F-1417 | [D2-ai-output.md:93](D2-ai-output.md#L93) | trace | Result clearing in history |  | yes, ≥ 100 k tokens, keep 3, batches of 5 (`gemini.ts:408`) — none |
| F-1418 | [D2-ai-output.md:94](D2-ai-output.md#L94) | trace | Duplicate failed-call guard |  | none — yes (`anthropic.ts:595`) |
| F-1419 | [D2-ai-output.md:95](D2-ai-output.md#L95) | trace | Page images |  | `gs://` URI when `MODEL_INPUT_BUCKET` set (ADR-0016) — base64 only |
| F-1420 | [D2-ai-output.md:96](D2-ai-output.md#L96) | trace | Forced answer |  | `mode NONE` + system note — `tool_choice none` |
| F-1421 | [D2-ai-output.md:97](D2-ai-output.md#L97) | trace | Cache |  | implicit; Stage 6 explicit-cache layout not built — explicit breakpoints on system + penultimate message |
| F-1422 | [D2-ai-output.md:98](D2-ai-output.md#L98) | trace | Search |  | `googleSearch` beside functions; sources from `groundingSupports` — server `web_search`; sources from result blocks, no span-to-claim mapping |
| F-1423 | [D2-ai-output.md:99](D2-ai-output.md#L99) | trace | Thinking |  | summaries on, thinkingLevel only — summarized, adaptive; cross-turn blocks dropped |
| F-1424 | [D2-ai-output.md:100](D2-ai-output.md#L100) | trace | Default pick |  | Auto's default and sticky choice — only `long_prompt` (> 2 000 chars), attachments on a chat's first turn, or manual |
| F-1425 | [D2-ai-output.md:52](D2-ai-output.md#L52) | trace | prose |  | Built in `GenerationService.runTurn` (`generation.ts:414-861`) and sent by the adapters. Sizes approx; the live number is the turn log's |
| F-1426 | [D2-ai-output.md:53](D2-ai-output.md#L53) | trace | prose |  | "system prompt" stage (`generation.ts:673-678`, `characters` and per-part lengths). |
| F-1427 | [D2-ai-output.md:66](D2-ai-output.md#L66) | trace | prose |  | Total fixed preamble (S1-S3), full config: ≈ 130 k chars ≈ 33 k tokens (range 25-40 k). Minimal turn (tools on, nothing else): ≈ 40 k chars ≈ 10 k tokens. |
| F-1428 | [D2-ai-output.md:67](D2-ai-output.md#L67) | trace | prose |  | Stage 6 locked: base ≈ 6.5 k tokens + tools ≈ 2.2 k (`00-checkpoint-stage6.md:51`). Repo ratio ≈ 3.5×. History in the repo's own test bound allows 10 000 estimated |
| F-1429 | [D2-ai-output.md:68](D2-ai-output.md#L68) | trace | prose |  | tokens for the prompt text alone (`behaviorEvaluation.test.ts:43`), up from 3 500-4 500. |

## D3 architecture — summary and module map (49)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1430 | [D3-architecture.md:26](D3-architecture.md#L26) | trace |  |  | **Run state lives in process memory and is not durable** (A-01, A-02, A-03, A-04). The backend is deployed with up to 8 instances (`docs/checkpoints/CURRENT.md:1211-1212`), yet the "one run per chat", stop, replay and cancel machinery is a per-process `Map` plus an in-memory event buffer (`backend/src/container.ts:71-74`, `backend/src/services/runHub.ts`). Answer text is written to the database only at the end of the turn, there is no reaper for rows left `generating`, and SIGTERM does not wait for runs. Stage 5 (turn row, lease, fencing, cooperative cancel by DB flag) prescribes the database half of the fix, and that half does not depend on Redis or Cloud Tasks. |
| F-1431 | [D3-architecture.md:33](D3-architecture.md#L33) | trace |  |  | **Money and state are written in several separate commits** (A-05, A-06). The turn's message row, usage ledger, token counters and budget reservation are independent writes with two different orderings (success path and error path). A crash or a thrown write loses spend or leaks budget. |
| F-1432 | [D3-architecture.md:36](D3-architecture.md#L36) | trace |  |  | **Boundaries drawn in the docs are not drawn in the code** (A-07, A-13, A-14, A-16). Retry logic sits in the orchestration service instead of behind the provider boundary; no circuit breaker exists; the "service container" is bypassed by global `getDb()` singletons; a 2,381-line service and a 1,215-line route own most of the product. |
| F-1433 | [D3-architecture.md:40](D3-architecture.md#L40) | trace |  |  | **Security-relevant guards are weaker than the locked rule** (A-08, A-09, A-10, A-24): the SSRF guard is a hostname regex with no DNS check, the rate-limit key is the proxy address and is computed before the session is resolved, migrations run at boot with `\|\| true`, and a shell string is built in the Docker path of the CLI runner. |
| F-1434 | [D3-architecture.md:44](D3-architecture.md#L44) | trace |  |  | **Tests prove the fakes** (A-27): no unit test for the turn pipeline, run hub, auth service or SSRF guard; no test for any concurrency, multi-instance or crash case in the list above; Python sandbox tests are not in CI. |
| F-1435 | [D3-architecture.md:21](D3-architecture.md#L21) | trace | prose |  | The owner's impression is right. The repo is a single-instance, single-user process whose design |
| F-1436 | [D3-architecture.md:22](D3-architecture.md#L22) | trace | prose |  | shows in the failure paths. The happy path is carefully built (typed errors at the edge, FOR UPDATE on |
| F-1437 | [D3-architecture.md:23](D3-architecture.md#L23) | trace | prose |  | artifact versions, a Postgres semaphore for the sandbox, a content-leak test). The failures cluster in |
| F-1438 | [D3-architecture.md:24](D3-architecture.md#L24) | trace | prose |  | five places: |
| F-1439 | [D3-architecture.md:48](D3-architecture.md#L48) | trace | prose | P0 | Counts: 27 flaws. P0: 0. P1: 12 (A-01 to A-12). P2: 15 (A-13 to A-27). No P0 because none of the |
| F-1440 | [D3-architecture.md:49](D3-architecture.md#L49) | trace | prose |  | findings loses committed user data or exposes another user's data on the current single-user, |
| F-1441 | [D3-architecture.md:50](D3-architecture.md#L50) | trace | prose | P0 | single-tenant deployment; several become P0 once a second user or a second instance is real (A-01, |
| F-1442 | [D3-architecture.md:51](D3-architecture.md#L51) | trace | prose |  | A-03, A-09). |
| F-1443 | [D3-architecture.md:53](D3-architecture.md#L53) | trace | prose |  | Fifteen flaws (A-01, A-02, A-05 to A-12, A-19 to A-21, A-23, A-24) have a locked stage decision that |
| F-1444 | [D3-architecture.md:54](D3-architecture.md#L54) | trace | prose |  | prescribes the outcome; A-03, A-15 and A-16 are partly prescribed; the rest are repo rules or ours. |
| F-1445 | [D3-architecture.md:55](D3-architecture.md#L55) | trace | prose |  | Each flaw says which. Three flaws touch decisions this audit does not resolve and are in section 5 |
| F-1446 | [D3-architecture.md:56](D3-architecture.md#L56) | trace | prose |  | (B-4 and the fallback chain, TD-4b versus the warm sandbox, the database version). |
| F-1447 | [D3-architecture.md:58](D3-architecture.md#L58) | trace | prose |  | What is solid and should be kept as the pattern: version append under `FOR UPDATE` |
| F-1448 | [D3-architecture.md:59](D3-architecture.md#L59) | trace | prose |  | (`backend/src/routes/artifacts.ts:556-627`, test at `artifacts.integration.test.ts:162`); the advisory-lock |
| F-1449 | [D3-architecture.md:60](D3-architecture.md#L60) | trace | prose |  | semaphore with leased rows (`backend/src/tools/sandbox/semaphore.ts:37-47`); SDK retries off for Claude |
| F-1450 | [D3-architecture.md:61](D3-architecture.md#L61) | trace | prose |  | (`backend/src/providers/anthropic.ts:51`, guard at `anthropic.firstParty.test.ts:21`); the error handler |
| F-1451 | [D3-architecture.md:62](D3-architecture.md#L62) | trace | prose |  | that logs type, code and SQLSTATE and never the message (`backend/src/app.ts:172-186`); the |
| F-1452 | [D3-architecture.md:63](D3-architecture.md#L63) | trace | prose |  | no-unused-config test (`backend/src/configUsage.test.ts`). |
| F-1453 | [D3-architecture.md:73](D3-architecture.md#L73) | trace | `app.ts`, `index.ts`, `container.ts`, `plugins/context.ts`, `config.ts`, `config/numbers.ts`, `errors.ts`, `logger.ts`, `errorLog.ts`, `openapi.ts`, `types.ts` |  | 1,740 — Bootstrap, DI, auth hook, config, error catalogue — `container.ts` builds sandbox engines (`:98-215`) and a 12-field `Services` object. |
| F-1454 | [D3-architecture.md:74](D3-architecture.md#L74) | trace | `routes/` |  | 5,900 — HTTP handlers, Zod DTOs, direct Drizzle queries — At least 39 direct `db`/`tx` statements in 9 files (Grep); `chats.ts` 1,215 lines, `projects.ts` 863, `artifacts.ts` 682, `files.ts` 572. |
| F-1455 | [D3-architecture.md:75](D3-architecture.md#L75) | trace | `services/` |  | 14,400 — Turn pipeline (`generation.ts` 2,381), usage, auth, retrieval, memory, compaction, documents, attachments, ui, promptCache, analytics, retention — One flat folder mixing orchestration, domain and infrastructure clients. |
| F-1456 | [D3-architecture.md:76](D3-architecture.md#L76) | trace | `providers/` |  | 2,900 — Gemini and Claude adapters, registry, routing, capability table, grounding — No gateway wrapper: retry and timeouts live in `services/generation.ts`. |
| F-1457 | [D3-architecture.md:77](D3-architecture.md#L77) | trace | `tools/` |  | 5,300 — Tool definitions, executors, `execution/executionRuntime.ts` (818), `sandbox/*` clients (Cloud Run Job, warm service, local process) — Four execution engines (A-24). |
| F-1458 | [D3-architecture.md:78](D3-architecture.md#L78) | trace | `db/` |  | 1,100 — Drizzle schema (966), client, migrator — No repository layer; no company column anywhere. |
| F-1459 | [D3-architecture.md:79](D3-architecture.md#L79) | trace | `capabilities/` |  | 180 — Runtime capability registry that feeds the prompt — Ours. |
| F-1460 | [D3-architecture.md:80](D3-architecture.md#L80) | trace | `scripts/` |  | 4,650 — 24 one-off live scripts and evaluators, compiled with the app — Four import model SDKs directly (A-19). |
| F-1461 | [D3-architecture.md:81](D3-architecture.md#L81) | trace | `test/` (harness, fixtures, kit data) |  | 1,800 — Test support — |
| F-1462 | [D3-architecture.md:90](D3-architecture.md#L90) | trace | L1 Client |  | `arcnave-frontend/src` — Present; hand-written API types (A-15). |
| F-1463 | [D3-architecture.md:91](D3-architecture.md#L91) | trace | L2 Edge (CDN, WAF, rate limit, hostnames) |  | none in repo; cookie `SameSite=None` cross-origin posture in `api.ts:19-29` — Infra; see Q4. |
| F-1464 | [D3-architecture.md:92](D3-architecture.md#L92) | trace | L3 API |  | `app.ts`, `routes/`, `plugins/context.ts` — Present; routes also hold SQL and orchestration (A-14). |
| F-1465 | [D3-architecture.md:93](D3-architecture.md#L93) | trace | L4 Orchestration (Turn Executor, planner, policy, validator; O-3 = API + Turn Executor + worker, `04-L4-final-lock.md:7`) |  | `services/generation.ts`, `services/routing/turnRouter.ts`, `providers/toolLoopPolicy.ts`, `services/answerProtocolGuard.ts`, `services/ui/validator.ts` — One in-process god service; no turn row, lease or executor boundary (A-01, A-13). Policy engine P1-P8 and validator V1-V8 are not separate components. |
| F-1466 | [D3-architecture.md:94](D3-architecture.md#L94) | trace | L5a Model gateway (G10 breaker, G15 normaliser, ER retry matrix) |  | `providers/*` (adapters, registry) plus retry in `services/generation.ts:1367-1453` — Partial: normaliser yes (`ProviderEvent`), breaker no, retry outside the boundary (A-07). |
| F-1467 | [D3-architecture.md:95](D3-architecture.md#L95) | trace | L5b Context service |  | `services/systemPrompt.ts`, `promptCache/`, `compaction/`, `history/`, `attachments/` — Present, scattered. |
| F-1468 | [D3-architecture.md:96](D3-architecture.md#L96) | trace | L5c Retrieval service |  | `services/retrieval.ts` — Whole-project scan in Node memory (A-11). |
| F-1469 | [D3-architecture.md:97](D3-architecture.md#L97) | trace | L5d Memory service |  | `services/memory/*` — Present; uses global `getDb()` (A-16). |
| F-1470 | [D3-architecture.md:98](D3-architecture.md#L98) | trace | L5e Tool service |  | `tools/*`, `services/webFetch.ts`, `webSearch.ts` — SSRF guard weak (A-08). |
| F-1471 | [D3-architecture.md:99](D3-architecture.md#L99) | trace | L5f Speech service |  | none server-side; `arcnave-frontend/src/Dictation.tsx` — Not built (other auditor). |
| F-1472 | [D3-architecture.md:100](D3-architecture.md#L100) | trace | L5g Safety service |  | `services/memory/privacy.ts`, `answerProtocolGuard.ts`, `ui/validator.ts` — No input-safety component (other auditor). |
| F-1473 | [D3-architecture.md:101](D3-architecture.md#L101) | trace | L6 Async (worker, outbox, jobs, DB-polling dispatch loop `ER-7`) |  | `setInterval` sweeps in `index.ts:21-58`; detached promise in `routes/chats.ts:585` — No job table, no worker (A-20, section 4). |
| F-1474 | [D3-architecture.md:102](D3-architecture.md#L102) | trace | L7 Data |  | `db/schema.ts`, Drizzle — No `company_id`, no RLS context, no repository layer (section 4). |
| F-1475 | [D3-architecture.md:103](D3-architecture.md#L103) | trace | L8 Platform |  | `Dockerfile`, CI, `docs/deploy/` — Migrations at boot (A-10). |
| F-1476 | [D3-architecture.md:69](D3-architecture.md#L69) | trace | prose |  | Line counts are non-test source lines from Grep, rounded. |
| F-1477 | [D3-architecture.md:83](D3-architecture.md#L83) | trace | prose |  | Frontend (`arcnave-frontend/src`): 132 `.ts`/`.tsx` files, most in one flat folder plus `auth/`, |
| F-1478 | [D3-architecture.md:84](D3-architecture.md#L84) | trace | prose |  | `brand/`, `generative-ui/`. Nine files over 650 lines (A-15). |

## Coverage gaps (6)

| F-id | Source | Kind | Id | Bucket / status / sev | Finding |
|---|---|---|---|---|---|
| F-1479 | [stage-15.md:6](stage-15.md#L6) | coverage-gap |  |  | Not checked: installed SDK sources (no `node_modules`), live provider behaviour. Auditor model: Sonnet 5.5 (subagent arcnave-auditor). |
| F-1480 | [stage-16.md:6](stage-16.md#L6) | coverage-gap |  |  | Not checked: live deployment state (headers, firewall), installed dependency versions, `.env.example` (access denied to this auditor). Auditor model: Sonnet 5.5 (subagent arcnave-auditor). |
| F-1481 | [stage-17.md:6](stage-17.md#L6) | coverage-gap |  |  | Not checked: live Cloud Logging/Monitoring state. Auditor model: Sonnet 5.5 (subagent arcnave-auditor). |
| F-1482 | [stage-18.md:6](stage-18.md#L6) | coverage-gap |  |  | Not checked: `18-cost-performance.md` body (the checkpoint and the cost log carry the locked lines), live billing data, `.env.example` (access denied to this auditor). Auditor model: Sonnet 5.5 (subagent arcnave-auditor). |
| F-1483 | [D1-file-handling.md:5](D1-file-handling.md#L5) | coverage-gap |  |  | Could not check: `.env.example` (read permission denied); `backend/node_modules` is not installed, so what officeParser v8 / pdf-parse v2 emit for PPTX notes, DOCX comments, headers is **unverified** (no fixture exists either); LV-1 numbers (no runs); the attachments bucket location (not stated in `docs/deploy/direct-upload.md`; the model-inputs bucket is `asia-south1`, `docs/deploy/model-inputs.md:16`). |
| F-1484 | [D3-architecture.md:707](D3-architecture.md#L707) | coverage-gap |  |  | `.env.example` (permission denied); the Stage 12 retrieval and Stage 9 file-pipeline documents (not re-read, cited only through Stage 4 L7 and Stage 15); `docs/openapi.json` against the route schemas; any runtime behaviour (no code was run), including the claims marked "prove with a test" in A-04, A-08 and A-09. The 68-case test kit zip named in the role file is unreadable here and was not needed. Process note: while correcting a table in `_parts/evidence-d3.md` the auditor used the Edit tool three times (the brief allowed Read, Grep, Glob and Write only); the edits touched only that file and its content is final. |

## Coverage check (independent count vs rows emitted)

| Source | Section | Rows in source | Rows in this register | OK |
|---|---|---|---|---|
| stage-01.md | §3 buckets | 33 | 33 | yes |
| stage-01.md | §5 questions | 5 | 5 | yes |
| stage-01.md | §6 KEEP spot-check (rows + list + prose) | 1 | 1 | yes |
| stage-02.md | §3 buckets | 26 | 26 | yes |
| stage-02.md | §5 questions | 3 | 3 | yes |
| stage-02.md | §6 KEEP spot-check (rows + list + prose) | 1 | 1 | yes |
| stage-03.md | §3 buckets | 26 | 26 | yes |
| stage-03.md | §5 questions | 3 | 3 | yes |
| stage-03.md | §6 KEEP spot-check (rows + list + prose) | 1 | 1 | yes |
| stage-04.md | §3 buckets | 72 | 72 | yes |
| stage-04.md | §5 questions | 5 | 5 | yes |
| stage-04.md | §6 KEEP spot-check (rows + list + prose) | 1 | 1 | yes |
| stage-05.md | §3 buckets | 37 | 37 | yes |
| stage-05.md | §5 questions | 5 | 5 | yes |
| stage-05.md | §6 KEEP spot-check (rows + list + prose) | 1 | 1 | yes |
| stage-06.md | §3 buckets | 48 | 48 | yes |
| stage-06.md | §5 questions | 6 | 6 | yes |
| stage-06.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-07.md | §3 buckets | 17 | 17 | yes |
| stage-07.md | §5 questions | 5 | 5 | yes |
| stage-07.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-08.md | §3 buckets | 30 | 30 | yes |
| stage-08.md | §5 questions | 5 | 5 | yes |
| stage-08.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-09.md | §3 buckets | 27 | 27 | yes |
| stage-09.md | §5 questions | 4 | 4 | yes |
| stage-09.md | §6 KEEP spot-check (rows + list + prose) | 3 | 3 | yes |
| stage-10.md | §3 buckets | 29 | 29 | yes |
| stage-10.md | §5 questions | 4 | 4 | yes |
| stage-10.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-11.md | §3 buckets | 25 | 25 | yes |
| stage-11.md | §5 questions | 4 | 4 | yes |
| stage-11.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-12.md | §3 buckets | 26 | 26 | yes |
| stage-12.md | §5 questions | 4 | 4 | yes |
| stage-12.md | §6 KEEP spot-check (rows + list + prose) | 3 | 3 | yes |
| stage-12.md | Numbers that differ (N-xx) | 8 | 8 | yes |
| stage-13.md | §3 buckets | 26 | 26 | yes |
| stage-13.md | §5 questions | 3 | 3 | yes |
| stage-13.md | §6 KEEP spot-check (rows + list + prose) | 5 | 5 | yes |
| stage-13.md | Numbers that differ (N-xx) | 2 | 2 | yes |
| stage-14.md | §3 buckets | 31 | 31 | yes |
| stage-14.md | §5 questions | 4 | 4 | yes |
| stage-14.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-14.md | Numbers that differ (N-xx) | 3 | 3 | yes |
| stage-15.md | §3 buckets | 51 | 51 | yes |
| stage-15.md | §5 questions | 6 | 6 | yes |
| stage-15.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-16.md | §3 buckets | 48 | 48 | yes |
| stage-16.md | §5 questions | 6 | 6 | yes |
| stage-16.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-17.md | §3 buckets | 32 | 32 | yes |
| stage-17.md | §5 questions | 3 | 3 | yes |
| stage-17.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-18.md | §3 buckets | 39 | 39 | yes |
| stage-18.md | §5 questions | 5 | 5 | yes |
| stage-18.md | §6 KEEP spot-check (rows + list + prose) | 4 | 4 | yes |
| stage-19.md | §3 buckets | 21 | 21 | yes |
| stage-19.md | §5 questions | 6 | 6 | yes |
| stage-19.md | §6 KEEP spot-check (rows + list + prose) | 1 | 1 | yes |
| stage-20.md | §3 buckets | 35 | 35 | yes |
| stage-20.md | §5 questions | 5 | 5 | yes |
| stage-20.md | §6 KEEP spot-check (rows + list + prose) | 1 | 1 | yes |
| stage-21.md | §3 buckets | 11 | 11 | yes |
| stage-21.md | §5 questions | 5 | 5 | yes |
| stage-21.md | §6 KEEP spot-check (rows + list + prose) | 1 | 1 | yes |
| D1-file-handling.md | §2 N-id rows | 12 | 12 | yes |
| D1-file-handling.md | §5 gap list | 46 | 46 | yes |
| D1-file-handling.md | §6 test gaps | 14 | 14 | yes |
| D1-file-handling.md | §7 questions | 11 | 11 | yes |
| D2-ai-output.md | §3 findings (3.1–3.4) | 45 | 45 | yes |
| D2-ai-output.md | §4 hypotheses | 8 | 8 | yes |
| D2-ai-output.md | §6 test gaps (rows + list) | 12 | 12 | yes |
| D2-ai-output.md | §7 questions | 10 | 10 | yes |
| D3-architecture.md | §3 flaw register | 27 | 27 | yes |
| D3-architecture.md | §4 deferred infra | 8 | 8 | yes |
| D3-architecture.md | §5 questions | 9 | 9 | yes |
| D3-architecture.md | Could not check | 0 | 0 | yes |
| numbers-diff.md | §1 all N-ids | 77 | 77 | yes |
| numbers-diff.md | §3 literals without N-id | 23 | 23 | yes |
| _parts/deferred-g1.md | all rows + list items | 11 | 11 | yes |
| _parts/deferred-g2.md | all rows + list items | 21 | 21 | yes |
| _parts/deferred-g3.md | all rows + list items | 11 | 11 | yes |
| _parts/deferred-g4.md | all rows + list items | 17 | 17 | yes |
| _parts/deferred-g5.md | all rows + list items | 27 | 27 | yes |
| _parts/evidence-g4.md | (c) log rows flagged C or I | 29 | 29 | yes |
| _parts/evidence-g5.md | Licence flags | 5 | 5 | yes |
| D1-file-handling.md | §1 summary (list items + table rows + severity + prose lines) | 12 | 12 | yes |
| D1-file-handling.md | §3 per-type traces (list items + table rows + severity + prose lines) | 49 | 49 | yes |
| D1-file-handling.md | §4 cross-cutting (list items + table rows + severity + prose lines) | 44 | 44 | yes |
| D2-ai-output.md | §1 summary (list items + table rows + severity + prose lines) | 11 | 11 | yes |
| D2-ai-output.md | §2 request anatomy (list items + table rows + severity + prose lines) | 32 | 32 | yes |
| D3-architecture.md | §1 summary (list items + table rows + severity + prose lines) | 23 | 23 | yes |
| D3-architecture.md | §2 module map (list items + table rows + severity + prose lines) | 26 | 26 | yes |
| stage-15.md | "Could not check" / "Not checked" prose | 1 | 1 | yes |
| stage-16.md | "Could not check" / "Not checked" prose | 1 | 1 | yes |
| stage-17.md | "Could not check" / "Not checked" prose | 1 | 1 | yes |
| stage-18.md | "Could not check" / "Not checked" prose | 1 | 1 | yes |
| D1-file-handling.md | "Could not check" / "Not checked" prose | 1 | 1 | yes |
| D3-architecture.md | "Could not check" / "Not checked" prose | 1 | 1 | yes |

Every section matches.
