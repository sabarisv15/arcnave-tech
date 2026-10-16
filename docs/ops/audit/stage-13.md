# Stage 13 — Output validation: conformance audit

Sources read: `Stage-13-Output-Validation/00-checkpoint-stage13.md` (doc-syncs 2026-10-03 Stage 17, 18, 20), `13-output-validation.md` (OV1–OV26, COV1–COV8, VD-1…VD-12, cost note); `00-numbers-register.md` (N-40, N-74); repo ADR-0061; code `backend/src/services/answerProtocolGuard.ts` (whole), `services/generation.ts:860-1250`, `providers/anthropic.ts:400-663`, `providers/gemini.ts:358-634`, `services/documents/index.ts`, `services/documents/verify/*.ts`, `tools/codeExecutionExecutor.ts:390-535`, `services/ui/validator.ts`, `services/compaction/compactionService.ts:140-155`, `services/memory/privacy.ts`, `tools/memoryExecutor.ts`, `tools/executor.ts`, `errors.ts`, frontend `ChatStates.tsx`, `types.ts:214-228`, `App.tsx:887`, `SandboxFrame.tsx`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Port source: none. The archived Python build has no validator package (packages: db, telemetry, chat, ledger, gateway). `arcnave.in:backend/packages/gateway/src/arcnave_gateway/failures.py` carries the finish-code → failure mapping for the gateway only.

## What validates output in the repo today (exact list)
Exists:
1. `AnswerProtocolGuard` — holds back `[Tool call]`, `[Result]`, `[Error]` markers (also when split across chunks, outside code fences) and throws `ApiError('tool_protocol_in_text')` (`answerProtocolGuard.ts:4-39`; wired `generation.ts:872, 910-916, 1027-1034, 1122-1133`; error copy `errors.ts:26-30`). Not a Stage 13 check; it is a repo-specific RP-1 chunk check.
2. Provider refusal (Claude `stop_reason: refusal`) becomes a typed `model_refused` error; partial text stays (`anthropic.ts:552-555`, `generation.ts:1022-1023, 2258-2264`).
3. `pause_turn` resume (`anthropic.ts:558-569`), tool-limit and empty-reply handling (`generation.ts:1102-1165`).
4. Truncation is shown, not repaired: `finishReason` `max_tokens`/`length`/`tool_limit` → "cut short" note + manual Continue (`types.ts:223-228`, `ChatStates.tsx:159-191`, `App.tsx:887`).
5. Tool-argument validation: zod `safeParse` in each executor (`memoryExecutor.ts:90-124`, `executor.ts:74-77, 98-102`); a tool runs only after the full response block is assembled (`anthropic.ts:548-612`; fine-grained streaming only previews `show_widget`, `anthropic.ts:513-526`).
6. Generated-file gate: structural check before `present_files` hands a file over (`codeExecutionExecutor.ts:401-417, 521-535` → `verifyPdf/verifyXlsx/verifyDocx/verifyPptx`); same checks plus layout heuristics on markdown exports (`documents/index.ts:80-126`); xlsx error values/formulas (`xlsxVerify.ts:68-78`).
7. UI-block validator: zod schemas, byte ceilings, HTML-tag stripping, sanitized fallback text (`services/ui/validator.ts:31-50, 173-180`) and sandboxed visuals with CSP + `sandbox="allow-scripts"` (`SandboxFrame.tsx:11,31,52,192`).
8. Compaction summary schema validation (`compactionService.ts:149-150`, throws on failure, no reask).
9. Memory writes: secret and never-stored identifier regexes (`privacy.ts:14-96`, `memoryService.ts:95-106`) — Stage 11.
Does **not** exist (searched `canary`, `retract`, `validation_result`, `claim`, `judge`, `grounding check`, `recitation`, `RECITATION`, `MALFORMED_FUNCTION_CALL`, `verify numbers`, `withdrawn`, `completion` in `backend/src` and `arcnave-frontend/src`, non-test): canary/secret/internal-tag scan of answers, retract event/card, async claim judge, completion check, numbers reconciliation, language check, online sampling, `validation_result` table, finish-code map v2, auto-continue, structured-output reask, citation registry check, LibreOffice render gate, qpdf/pypdf strict.

## 1. Locked decisions
Checkpoint locked 2026-10-03. Doc-syncs: Stage 17 (validation_result stores numeric/categorical results only, judge explanations not stored, Google managed online evaluation not used, OD-14), Stage 18 (judge sampling stays synchronous — CD-6 withdrawn; Gemini batch only for offline jobs), Stage 20/review (Claude citation-bearing and structured-output turns are separate requests, VS-30). The draft's VD-1 "(= L4 V-1)" wording is carried by the checkpoint line.

| Id | Decision (one line) | Status |
|---|---|---|
| V-01 RP-1/RP-2/RP-3 (OV1) | Three release points: live (provider signals + cheap checks), before show/act (JSON, tool args, artifacts), after done (async: citations, claim support, completion, leak, sampling) → annotate / regenerate / retract; each check declares its point and max latency | LOCKED |
| V-02 Finish-code map v2 (OV2, COV1) | New Gemini reasons (OTHER, MODEL_ARMOR, IMAGE_*, NO_IMAGE…), Claude `pause_turn` continue rule, completion known only at `message_delta`; empty `end_turn` → one "continue" | LOCKED |
| V-03 VD-1 | Grounding engine = LLM judge on Gemini 3.1 Flash-Lite, async, only on answers that used files/web; Vertex Check Grounding = bake-off + fallback | LOCKED |
| V-04 VD-2 | Low support → annotate note + weak-citation marks; Deep = one regenerate with findings; never silent edits | LOCKED |
| V-05 VD-3 | Normal/Deep one auto-continue on truncation, else "cut short" + Continue; Fast notice only; structured output cut = failure | LOCKED |
| V-06 VD-4 | Structured-output post-check always (schema, case-insensitive enums, refusal/max_tokens = failure, Gemini silent-ignore guard, `propertyOrdering`); 1 reask with error text (Fast 0) | LOCKED |
| V-07 VD-5 | Retract = fixed list only: provider block/refusal mid-stream, other-tenant/unknown citation id, system-prompt canary / internal tag / secret in output, severe safety verdict | LOCKED |
| V-08 VD-6 | Completion check: deterministic always (promised artifact vs tool success, ids resolved, format present); Flash-Lite check on Normal/Deep turns with tools or multi-part requests; missing → one more step inside budget | LOCKED (= Stage 10 AO-10) |
| V-09 VD-7 | Artifact gate: reopen docx/pptx/xlsx + LibreOffice render test + xlsx recalc/error scan + qpdf/pypdf strict; web page = own HTML allowlist + CSP; chart = ECharts JSON schema + data check; 1 repair | LOCKED |
| V-10 VD-8 (OV13) | Numbers reconciliation run_code/DuckDB typed values vs answer → annotate "verify numbers"; Deep repair | LOCKED |
| V-11 VD-9 (OV18) | Language check: log only in MVP (LANG-1) | LOCKED |
| V-12 VD-10 (OV20) | Canary + secret + internal-tag scan MVP (sync); PII/DLP scan Later (SAF-7) | LOCKED |
| V-13 VD-11 (OV22) | ~10 % online LLM-judge sampling | LOCKED (rate Stage 18) |
| V-14 VD-12 (OV24) | Per-profile budgets: Fast deterministic only; Normal + judge/completion; Deep + regenerate | LOCKED |
| V-15 OV6/F4 | Tool-argument gate: complete args first (buffered streaming) → schema → description limits → ownership/tenant → idempotency → run; MALFORMED_FUNCTION_CALL / UNEXPECTED_TOOL_CALL retry once | LOCKED |
| V-16 OV7 | Citation integrity = 4 verdicts: pointer valid (registry + tenant) → retract + regenerate; exact quote; claim support (async); coverage (Later) | LOCKED |
| V-17 OV12 | Research report: same engine on the whole report, unsupported claims removed/softened **before** publish, source-quality grade recorded | LOCKED |
| V-18 OV17 | Recitation (RECITATION / IMAGE_RECITATION): keep partial, notice, offer regenerate, no cross-provider fallback | LOCKED |
| V-19 OV21 | `validation_result` rows (turn_id, check, version, score/label, action, latency_ms, sampled, hash) ids/hashes only; OTel `gen_ai.evaluation.result` | LOCKED (RLS/OTel DEFERRED) |
| V-20 OV15 | Markdown: client streaming-safe termination (Stage 14 RD-1); server post-stream GFM table cell-count check → log only; raw HTML stripped (ST-4) | LOCKED |
| V-21 OV19 | App-generated numbers/dates in `en_IN` (3-2 grouping, `dd-MM-yyyy`); model-written lakh/crore = prompt rule | LOCKED |
| V-22 OV23 | Thinking never validated as content; signatures untouched | LOCKED |
| V-23 COV5 | Repair/reask = new user message with the error, never prefill | LOCKED |
| V-24 COV6 | After a refusal reset context; refusal mid-stream → discard partial (retract); refused turn excluded from history | LOCKED |
| V-25 COV7/COV3 | Judge/structured calls never carry citations; `[file:n]` has no vendor guarantee → own registry check | LOCKED |
| V-26 RP-1 chunk checks | Cheap deterministic checks while streaming (OV1) | LOCKED |
| OV8–OV9, OV10, OV11, OV16, OV20, OV25–OV26 | judge hygiene (rubric, calibrated, version-stamped, never sees system prompt), low-support action, completion check, fixed retract list, leak scan, tool-output screening (= Stage 16), not-taken items | carried inside V-03/V-04/V-08/V-07/V-12 above |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched: …)" |
|---|---|
| V-01 | not found as a contract. Checks that exist sit in `generation.ts` (stream guard `:910-916`), adapters and executors; none declares a release point or latency. |
| V-02 | Claude: `stop_reason` read from `message_delta` and the final message (`anthropic.ts:535, 551`), completion emitted after the loop (`:662`); `refusal` (`:552`), `pause_turn` (`:561-569`). Gemini: last `candidate.finishReason` passed through as a string (`gemini.ts:520, 633`); no map, no handling of OTHER / MODEL_ARMOR / IMAGE_* / NO_IMAGE / SAFETY / RECITATION / MALFORMED_FUNCTION_CALL (searched those names in `gemini.ts`, `generation.ts`: none). Empty reply → one extra request without tools (`generation.ts:1102-1165`) — not a "continue" message. |
| V-03 … V-04 | not found (no judge call, no note, no weak-citation mark). |
| V-05 | `max_tokens` shown as "cut short … hit the length limit" with a manual Continue (`ChatStates.tsx:159-191`, `types.ts:223-228`); Continue sends the user message "Continue exactly where you stopped." (`App.tsx:887`). No automatic continue; no Fast/Normal/Deep difference. `DEFAULT_MAX_OUTPUT_TOKENS` 64,000 (`config/numbers.ts:41`, `schema.ts:100`) makes truncation rare. |
| V-06 | Compaction summary: `compactionSummarySchema.parse` (`compactionService.ts:149-150`) — throws, no reask. UI blocks: zod + normalise (`ui/validator.ts:49-172`) with a sanitized text fallback, no reask. No enum case-insensitivity, no `max_tokens`/refusal-as-failure rule, no Gemini silent-ignore guard (structured output is not used for the model's main answer). |
| V-07 | Refusal ends the turn as an error frame after text has streamed (`generation.ts:1022-1023, 1042-1093`); no `retract` event type (`StreamEvent` union `generation.ts:122-142`), no "withdrawn" card (searched `withdrawn` in frontend: none); the partial text stays visible and is persisted (`generation.ts:1056-1068`). |
| V-08 | See Stage 10 AO-10: empty-reply fallback only. No promised-artifact check (searched `promised`, `completion` : none). `present_files` reports broken files back to the model (`codeExecutionExecutor.ts:401-436`) — an RP-2 partial. |
| V-09 | See item 6 above. Gaps: no LibreOffice render test inside the gate (`visualVerify.ts:1-12` says render checking is the model's own step, ADR-0047; skills tell the model to run `soffice`: `backend/skills/docx/SKILL.md:26,80`); xlsx check reads formula strings/cached values (`xlsxVerify.ts:68-78`), no recalculation; no qpdf/pypdf strict (`pdfVerify.ts:1-4` own structure check); "1 repair" is the model's own retry after `errors` in the result, not counted; web pages: CSP is a `<meta>` in `srcdoc` (`SandboxFrame.tsx:31,52`), no HTML allowlist parser, no header CSP, no separate origin; charts: Recharts blocks validated by zod (`ui/schemas.ts`), not ECharts JSON. |
| V-10 | not found (no typed-values envelope in `run_python`/`present_files` results; no DuckDB). |
| V-11 | Display-only: `answerLang.ts:1-12` marks a mostly-Tamil answer `lang="ta"` by script. No logging, no comparison with the user's script. |
| V-12 | not found (searched `canary`, `redactSecrets`: `privacy.ts:137-144` redacts secrets in memory text only). Output secrets/internal tags are not scanned. |
| V-13, V-14 | not found (no profiles, no sampling). |
| V-15 | zod per executor (see 5 above); ownership by construction (executors are built per user/project: `tools/executor.ts:51-57`, `memoryExecutor.ts:65-70`); duplicate failed call not re-run (`anthropic.ts:595-609`). Idempotency (G40) and MALFORMED_FUNCTION_CALL retry: not found. |
| V-16 | not found (no registry). Web citations: provider-supplied sources only (`providers/grounding.ts`, `sources` frame `generation.ts:926-936`). |
| V-17 | not found (no research report). |
| V-18 | A Gemini `RECITATION` would pass through as `finishReason` in `done` (`generation.ts:1036, 1219-1225`); `cutOffReason` ignores it (`types.ts:223-228`): no notice. |
| V-19 | not found. Closest: `turn_logs.markdown` with full content (`generation.ts:1237-1243`, ADR-0050) — the opposite of ids-only (deferred). |
| V-20 | Client: `Markdown` with `remark-gfm`, KaTeX `throwOnError:false`, error boundary showing raw source (`Content.tsx:34-67, 226-321`, `markdownPlugins.ts:36-44`); no termination logic (see Stage 14 RD-1); raw HTML is not rendered (react-markdown default). Server table check: not found. |
| V-21 | Inconsistent: `en-IN` in sheet preview cells (`FilePreviews.tsx:90`), `en-US` currency in `TableBlock.tsx:12`, default locale in `App.tsx:739`; no `dd-MM-yyyy`. |
| V-22 | Thinking bypasses the guard: only `delta` goes through `answerGuard.push` (`generation.ts:910-916`), `thinking` is forwarded as is (`:919-924`); Gemini signatures stored untouched (`:969, 992-1000`). |
| V-23 | No assistant prefill: the last message is always `user` (`anthropic.ts:340-345`); the empty-reply retry appends a bracketed system instruction to the user prompt (`generation.ts:1113-1118`). |
| V-24 | Refusal → `model_refused` (see V-07). Whether a refused turn is excluded from later history: not verified (`loadHistory` not read). |
| V-25 | No judge/structured calls exist. |
| V-26 | `AnswerProtocolGuard` (item 1). |

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| V-01 | NEW-BUILD | validator contract with release points and latency per check |
| V-02 | REWRITE | no Gemini finish-code map, no `message_delta`/empty-`end_turn` rule |
| V-03 | NEW-BUILD | async claim judge; model question Q1 |
| V-04 | NEW-BUILD | annotate note + weak-citation marks; Deep regenerate |
| V-05 | REWRITE | note + manual Continue exist; auto-continue and profile split missing |
| V-06 | REWRITE | schema checks exist for UI blocks/compaction; no reask, no enum/refusal/max_tokens rules |
| V-07 | NEW-BUILD | `retract` event, withdrawn card, fixed trigger list |
| V-08 | NEW-BUILD | deterministic + Flash-Lite completion check (with AO-10) |
| V-09 | REWRITE | structural gate exists (codeExecutionExecutor.ts:401-417); render/recalc/strict/allowlist/ECharts missing |
| V-10 | NEW-BUILD | typed-values envelope + reconciliation |
| V-11 | NEW-BUILD | log-only language check (answerLang.ts is display only) |
| V-12 | NEW-BUILD | canary + secret + tag scan on every final answer |
| V-13 | NEW-BUILD | ~10 % sampled judge |
| V-14 | NEW-BUILD | profile budgets (needs profiles, Stage 10 O-2) |
| V-15 | REWRITE | gate exists in parts; add idempotency and malformed-call retry |
| V-16 | NEW-BUILD | depends on Stage 12 registry |
| V-17 | NEW-BUILD | depends on Stage 10 research |
| V-18 | NEW-BUILD | recitation notice + regenerate offer |
| V-19 | NEW-BUILD | `validation_result` table (shape: deferred file D-G3-01) |
| V-20 | NEW-BUILD | server table cell-count log; client part under Stage 14 |
| V-21 | REWRITE | one `en-IN` formatter for app-generated numbers/dates |
| V-22 | KEEP | thinking not validated (generation.ts:910-924) |
| V-23 | KEEP | no prefill (anthropic.ts:340-345) |
| V-24 | REWRITE | retract + context reset; partial today stays visible |
| V-25 | KEEP | no judge/structured call carries citations (none exist yet; keep the rule when built) |
| V-26 | KEEP | `AnswerProtocolGuard` (answerProtocolGuard.ts:4-39) |

Counts (26 ids): KEEP 4 · REWRITE 7 · NEW-BUILD 15 · DIFF-STACK 0 · DIFF-INFRA 0 · DISCARD 0 · DEFERRED 0 (RLS/OTel parts of V-19 are in the deferred file).

## 4. Non-KEEP items

### V-01 + V-26 — validator contract (release points)
- Exact change: a `services/validation/` module: `Check {id, point: RP1|RP2|RP3, maxLatencyMs, run}`; a runner that wires RP-1 into the delta path (today `AnswerProtocolGuard`), RP-2 into tool-arg/artifact/structured paths, RP-3 after `done` (async, result → annotate / regenerate / retract). Files: new `services/validation/*`, `generation.ts:872-1235`. Port source: none.
- Option A (NEW-BUILD module, move the guard in as the first RP-1 check): Time M · risk low · breaks nothing if the guard keeps its tests (`answerProtocolGuard.test.ts`).
- Option B (add checks ad hoc in `generation.ts`): Time S · risk: no per-profile budgets (V-14) and growing god-class.
- Pick: A.

### V-07 + V-12 + V-18 + V-24 — retract, canary/secret/tag scan, recitation
- Exact change: new stream event `retract {messageId, reason}` and a persisted `withdrawn` status; trigger list fixed (VD-5); per-deploy random canary string in the system prompt (cache-safe in the stable prefix), internal tag names and secret regexes scanned over the final answer (sync, cheap, can reuse `privacy.ts` patterns); Gemini `RECITATION`/`IMAGE_RECITATION` → finish code `recitation`, notice + regenerate button, no provider fallback; refusal mid-stream → retract and exclude the refused turn from history. Files: `generation.ts` (event union `:122-142`, completed handler `:1025-1039`), `systemPrompt.ts`, `providers/gemini.ts:520`, `messages` schema (`withdrawn`), frontend `ChatStates.tsx`, `workspace.tsx:629-655`, `adapter.ts:40-87`. Port source: none.
- Option A (NEW-BUILD with a replace-content frame + persisted original kept for audit as hash only): Time M · risk medium (history rebuild after retract) · breaks `refusal.integration.test.ts` expectations (partial text kept today).
- Option B (keep partial visible, add a banner only): Time S · risk: violates the fixed retract list for canary/secret leaks.
- Pick: A.

### V-03 + V-04 + V-16 + V-17 — claim judge, annotate, citation integrity
- Exact change: async judge after `done` on turns that used files/web (structured verdict per claim; rubric; judge version stamped; never sees the system prompt; explanations not stored, Stage 17); low support → annotate note "Some statements could not be matched to your files – verify before use" + weak-citation marks (dotted chip); Deep = one regenerate with findings; pointer check against the Stage 12 registry (unknown/other-tenant id → retract + regenerate without that id); research reports run the same engine before publish (OV12). Files: new `services/validation/{judge,citations}.ts`, `providers/` (judge call), `generation.ts` after-`done` hook, messages annotation column, frontend note + weak-citation style. Port source: none.
- Option A (NEW-BUILD on Gemini 3.1 Flash-Lite as locked; Q1): Time L · risk: model-policy conflict (Q1) · cost ≈ ₹0.12 per checked answer (checkpoint cost note).
- Option B (judge on Gemini 3.8 Flash): Time M · risk: ~5× the Flash-Lite token cost, no policy conflict.
- Pick: B until Q1 is answered, behind a model setting so Option A is a one-line change.

### V-05 + V-02 + V-06 + V-15 — truncation, finish codes, structured post-check, tool gate
- Exact change: finish-code map v2 as one pure function used by both adapters (Gemini new reasons, `pause_turn`, completion only after the final `message_delta`/`finalMessage`, empty `end_turn` → one continue); Normal/Deep: one automatic continue within budget using the same user message the Continue button sends, else the note; structured outputs (compaction, UI blocks, future judge): schema check, case-insensitive enums, refusal/`max_tokens` = failure, one reask with the error text as a new user message (Fast 0); tool gate adds idempotency key check and retry-once on `MALFORMED_FUNCTION_CALL`/`UNEXPECTED_TOOL_CALL`. Files: `providers/{anthropic,gemini}.ts`, new `providers/finishCodes.ts`, `generation.ts`, `compactionService.ts:149`, `ui/validator.ts`, executors. Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/failures.py` (finish-code → failure class).
- Option A (REWRITE, one shared module, adapters call it): Time M · risk low–medium · breaks `anthropic.adapter-loop.test.ts`, `gemini.adapter-loop.test.ts`, `toolLimit.integration.test.ts` where `finishReason` strings are asserted.
- Option B (patch each adapter): Time S · risk: drift between adapters (the repo already extracted `toolLoopPolicy.ts` for this reason).
- Pick: A. Auto-continue needs the profile (VD-12).

### V-09 — artifact gate
- Exact change: add to the existing structural check (a) LibreOffice → PDF → page-image render test through the sandbox `soffice` allowlist (`config.ts:222`), failing on zero pages/exception, (b) xlsx recalculation with LibreOffice + error-cell scan (today only string/cached-value check), (c) PDF `qpdf --check` + pypdf strict (sandbox has pypdf: `Dockerfile.service:28`), (d) web page: own HTML allowlist parser + CSP as an HTTP header from a separate origin (Stage 14 RD-6), (e) chart JSON schema (ECharts, Stage 8 TD-8 — see Q2) + data check; repair counter of 1 returned to the model. Files: `codeExecutionExecutor.ts:401-436, 521-535`, `documents/verify/*`, `sandbox` image, `ui/validator.ts`. Port source: none.
- Option A (REWRITE the gate to run render/recalc/strict inside the warm sandbox before `present_files` returns): Time M–L · risk: +seconds per file, sandbox availability · breaks `documents.test.ts`, `officeReadWithCode`/`slidesArtifact.integration.test.ts` timings.
- Option B (keep structural checks, add render test only for docx/pptx/pdf): Time M · risk: xlsx recalc gap stays.
- Pick: A in order render → recalc → strict → HTML allowlist.

### V-10 / V-11 / V-13 / V-14 / V-19 / V-20 / V-21 — numbers, language log, sampling, budgets, record, table log, locale
- V-10: `run_python`/DuckDB results carry typed values; validator normalises lakh/crore/₹/%/rounding and compares to numbers in the answer → "verify numbers" note (Deep repair). Time M, depends on typed envelope in `codeExecutionExecutor.ts`.
- V-11: log (ids/codes only) user script vs answer script; no action. Time S (reuse `answerLang.ts` Unicode-block idea; IndicLID Later).
- V-13/V-14: ~10 % sampled async judge (rate from N-40), per-profile budgets (Fast deterministic only). Time M after profiles.
- V-19: `validation_result(turn_id, check, version, score|label, action, latency_ms, sampled, text_hash)` — no explanations, no text. Time S + migration; company_id question D-G3-01.
- V-20: server post-stream GFM table cell-count check → log only. Time S.
- V-21: one `formatIndian()` helper (`Intl.NumberFormat('en-IN')`, `dd-MM-yyyy`) used by `App.tsx:739`, `TableBlock.tsx:12-19`, `FilePreviews.tsx:90`. Time S. DIFF-STACK note: Babel (Python) → `Intl` is the stack equivalent.
- Pick: A for each (build in the order V-01 → V-12/V-07 → V-05/V-02 → V-09 → V-03/V-04 → the rest).

## 5. Open questions for the owner
- Q1. The VD-1 judge and VD-6 completion check run on Gemini 3.1 Flash-Lite; ADR-0055 / B-4 allow three models only (Gemini 3.8 Flash, Sonnet 5.5, Opus 5.5). Allow Flash-Lite for helper jobs (judge, completion, planner), or run them on Gemini 3.8 Flash (≈5× cost per check) until the policy is amended?
- Q2. Stage 8 TD-8 (ECharts JSON) versus the repo's Recharts-based display blocks: V-09's chart gate and Stage 14 RD-3 both assume ECharts JSON. Decide in the Stage 8 audit whether charts move to ECharts or the deviation is recorded.
- Q3. Retract keeps no text but the original must remain auditable: keep the withdrawn text server-side (hash + encrypted copy for support) or drop it entirely (ids/hashes only, as Stage 17 NO_CONTENT)?

## 6. KEEP spot-check
(4 KEEP rows; all 4 re-opened = 100 %.)
| Id | file:line | Result |
|---|---|---|
| V-22 | `generation.ts:910-916` (delta → guard), `:919-924` (thinking forwarded unguarded) | confirmed |
| V-23 | `anthropic.ts:340-345` (final message always `user`), `generation.ts:1113-1118` (retry as user text) | confirmed |
| V-25 | no judge/structured call exists (searched `output_config`, `responseSchema`, `json_schema` in `providers/*.ts` non-test: only `output_config.effort`) | confirmed — rule must be re-checked when the judge is built |
| V-26 | `answerProtocolGuard.ts:4-39`, `generation.ts:872, 910-916, 1027-1034` | confirmed |

## Numbers that differ (N-xx)
| N | Register value | Repo value |
|---|---|---|
| N-40 | claim-judge share on Normal, structured reask 1 (Fast 0), auto-continue 1 (Normal/Deep), completion extra step 1, sampling ~10 %, judge latency ~2 s after done, Check Grounding 300 rpm (register l.45) | none of these exist in the repo |
| N-74 | max output tokens incl. thinking Fast 8,192 / Normal 16,384 / Deep 32,768 (register l.81) | `DEFAULT_MAX_OUTPUT_TOKENS` 64,000 (`config/numbers.ts:41`); `preferences.max_output_tokens` default 64000 (`schema.ts:100`) — Stage 7 owns the number; it determines how often `max_tokens` truncation (V-05) happens |
