# Stage 07 — Model routing: conformance audit
Sources read: `docs/architecture/Stage-07-Model-Routing/` 00-checkpoint-stage7.md (all doc-syncs, incl. 2026-10-12 x3 and 2026-10-14), 07-model-routing.md (MR1-MR19, CR1-CR8, RT-1..RT-10, 7.9-7.14); `00-Handoff/00-numbers-register.md` (N-29, N-31, N-42, N-43, N-69, N-74); repo ADRs 0053, 0055, 0061; repo code `backend/src/providers/{registry,routing,capabilitiesTable,anthropic,gemini,types,toolLoopPolicy}.ts`, `services/routing/turnRouter.ts`, `services/generation.ts` (resolveModel, streamWithRetry, mapProviderError), `config.ts`, `config/numbers.ts`, `db/schema.ts`; port source `arcnave.in:docs/architecture/adr/0013-router-claude-haiku-thinking-disabled.md`, `0014-internal-worker-jobs-claude-haiku.md`, `arcnave.in:backend/packages/gateway/src/arcnave_gateway/{registry,router,breaker,gateway,config}.py`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

## 1. Locked decisions
| Id | Decision (one line) | Status |
|---|---|---|
| RT-1 | Auto = rules only (input type, size / pages, profile, Claude switch, Claude budget) -> Gemini 3.8 Flash; router reads file metadata only; signals logged | REVISED by doc-sync 2026-10-08 (ADR-0009): rules stay the final gate, a mini-LLM router runs in shadow; ADR-0013 (2026-10-12) router = Haiku 5.5 |
| RT-2 | Classifier router (`gemini-3.5-flash-lite`, ~400 ms) Later | SUPERSEDED by ADR-0009 / ADR-0013 (2026-10-08, 2026-10-12): M2 = `claude-haiku-5-5`, thinking disabled, effort low, timeout 1.5 s (N-69), shadow mode, call switched OFF until the intent list exists |
| RT-3 | Tier map once the classifier exists (simple -> Gemini low, normal -> medium, complex -> Sonnet medium, hard Deep -> Opus medium, Claude not allowed -> Gemini high) | LOCKED (used when the router goes live; not live in Phase 1) |
| RT-4 | Effort per profile Fast low / Normal medium / Deep high, always explicit, xhigh / max off | LOCKED; mapping detail doc-sync 2026-10-10 (Gemini `thinking_level` LOW/MEDIUM/HIGH; Claude `thinking: adaptive` + `output_config.effort`; thinking display `omitted` / `include_thoughts` off until the web thinking panel) |
| RT-5 | Every answer shows the model (+ "Auto chose", + fallback note) | LOCKED |
| RT-6 | 429 / overload: <= 2 retries (backoff >= 1 s) then next allowed model with label; Claude limit reached -> Gemini + message | LOCKED; Claude failure falls back to Gemini only (ADR-0012) |
| RT-7 | Per-company monthly Claude limit (N-29) | DEFERRED (company); repo ADR-0053 #6 uses per-user budgets only |
| RT-8 | ArcNave team controls per-company Claude switch + limit | DEFERRED (company); switch is a cost switch, not read for helper roles (doc-sync 2026-10-12) |
| RT-9 | Model role registry in config, exact version pins, registry version stamped on every turn (L4-G48); public choices `auto`, `gemini-flash`, `claude-sonnet`, `claude-opus` (Opus manual only) | LOCKED; as built doc-sync 2026-10-10 |
| RT-10 | Monitor Gemini 429 / TPM, smoothing, Priority PayGo | DEFERRED (ops: OTel / infra) |
| M1 | Generation: Gemini 3.8 Flash default / Auto; Sonnet 5.5, Opus 5.5 on manual pick | LOCKED |
| M2 | Router: `claude-haiku-5-5`, thinking disabled, effort low, structured `{intent, tier}`, `max_tokens` 1,024, no sampling params, no retries, case-insensitive enum match; Gemini 3.5 Flash-Lite MINIMAL row kept as alternative | LOCKED (ADR-0013); build in Task 1.11 Part 2 item 2.6a |
| M3 / M4 / M5 / M6 | Query planner `gemini-3.5-flash-lite` (provisional); Embedding 2; Vertex Ranking API; contextualizer `gemini-3.1-flash-lite` | LOCKED; owned by the Stage 12 audit |
| M7 | Summarizer + title | SUPERSEDED by doc-sync 2026-10-14: registry role `job` (no M-number), row `title-claude-haiku` = `claude-haiku-5-5`, thinking disabled, effort low, 40 output tokens, no fallback; summary job is a second row (ADR-0014, N-76 / N-77) |
| M8 / M9 | Memory extractor (retired by Stage 11) / safety screen `gemini-3.5-flash-lite` (provisional) | Stage 11 / Stage 16 audits |
| M10 / M11 | Speech (Gemini 3.8 Flash, provisional) / OCR (Document AI Mumbai RC pinned, Gemini fallback, ADR-0006) | LOCKED; bucketed in the Stage 9 audit |
| 7.9 | Capability matrix and derived rules: audio / video -> Gemini only; PDF > 600 pages or request > 30 MB -> Gemini (or OCR text + selected pages to Claude); Claude switch off / limit reached -> Gemini | LOCKED; Claude call path moved to first-party API by ADR-0012 |
| 7.11 | Claude budget mechanics (reserve worst case, 80 % alert, 100 % refuse, monthly reset) | DEFERRED (company) |
| 7.12 | Fallback matrix + labels "Answered by X because Y was unavailable"; ER-3 continuation by the same pinned model, no hop | LOCKED; error shapes added 2026-10-10 / 2026-10-12 |
| 7.13 | Regenerate with routing: any allowed model; Auto same rules; history converted across providers | LOCKED |
| 7.14 | Upgrade: pinned ids, new row disabled, eval, canary, keep old, stamp versions | LOCKED |
| MR1-MR19 | Gaps: rules first (MR1), model and effort separate (MR2), hard rules (MR3), labels (MR4), override + mid-chat switch (MR5), limit hit message (MR6), <= 2 retries then fallback (MR7), admin allowlist Later (MR8), provider-native history + conversion (MR9), Claude<->Claude thinking (MR10), effort map (MR11), Gemini throughput (MR12), own router (MR13), role registry (MR14), router eval (MR15), coding / artifacts to Sonnet when allowed (MR16), router timeout default Gemini Normal (MR17), price doubling revisit (MR18), harmful refusal never falls back (MR19) | LOCKED (mapped into rows) |
| CR1-CR8 | Claude facts: always send effort (CR1); Opus thinking always on, default medium (CR2); Sonnet rejects thinking disabled (CR3); no forced tool use on 5.5 (CR4); Opus -> Sonnet drops thinking (CR5); effort change breaks cache (CR6); quota per lineage (CR7); no audio / video (CR8) | LOCKED |
| NO-SILENT-SUB | Never substitute a model silently; every fallback labelled | LOCKED (repo Invariant 1 too) |
| BREAKER | Circuit breaker per model (Stage 15 ER-13, N-47: open after 5 failures / 30 s or >= 50 % of 20 calls; half-open 30 s; retry budget <= 10 %); router calls do not feed it | LOCKED (Stage 15 owns; asked for here) |
| ADR-0012 | Claude through the first-party API: `inference_geo` global, WIF credentials (no API key), pinned first-party ids | LOCKED (doc-sync 2026-10-10) |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched: ...)" |
|---|---|
| RT-1 | Auto is a tier ladder, not "-> Gemini": `chooseTier` (`backend/src/providers/routing.ts:47-77`): grounded request -> economy (Gemini); research mode -> quality (Opus 5.5); **any attachment -> quality (Opus 5.5)** (`routing.ts:67-69`); project context > 8,000 chars -> quality; prompt > 2,000 chars -> balanced (Sonnet 5.5); else economy; user `routingPreference` shifts one tier (`routing.ts:33-39`); thresholds `config.ts:133-134`. After the first answer the chat stays on the same model (`generation.ts:1307-1318`). Router reads no file metadata. No profile, no Claude-switch or budget input. |
| RT-2 / M2 | Not found (searched: `haiku|claude-haiku|router|intent|ROUTER_SHADOW|tier:` in `backend/src` non-test; `routing/turnRouter.ts` is a tool-permission router, not a model router: `turnRouter.ts:1-10`). No Haiku row in `providers/registry.ts:54-91`. Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/{registry.py,router.py}`. |
| RT-3 | Not found. |
| RT-4 | Effort sent explicitly on all three models (`generation.ts:685-687`; `anthropic.ts:490`; `gemini.ts:440-443`); ladder low / medium / high / xhigh / max for Claude (`capabilitiesTable.ts:66,82`), so xhigh / max are reachable (spec: off); Gemini clamps above HIGH (`gemini.ts:255-258`). No profile -> effort mapping (user pref, default medium, `config.ts:166`). Thinking summaries on: Claude `display: summarized` (`anthropic.ts:488`), Gemini `includeThoughts: true` (`gemini.ts:441`), because the repo has a thinking panel (ADR-0030). |
| RT-5 | `start` event carries `{requested, resolved, provider, providerModelId, routing{rule, considered}}` (`generation.ts:524-543`); assistant message stores `model_alias` (`db/schema.ts:291`); frontend type has `routing` (`arcnave-frontend/src/adapter.ts:27`). Fallback note: no fallback exists. |
| RT-6 | Retry part: `streamWithRetry` (`generation.ts:1367-1453`): <= `PROVIDER_MAX_RETRIES` 2, full-jitter backoff 1 s -> 2 s cap 8 s, Retry-After <= 10 s, only before the first visible output (`numbers.ts:23-29`; `generation.ts:1444-1450`); retryable statuses incl. 529 (`anthropic.ts:31`); spend limits not retried -> `provider_limit` (`anthropic.ts:99-129`). Fallback part: not found (searched: `fallback|hop|next model` non-test; the only "fallback" in routing is the tier distance, `routing.ts:119`). |
| RT-7 / RT-8 / 7.11 | Per-user daily / monthly token budgets and reservation exist (`generation.ts:694`; `services/usage.ts`); no company, no Claude switch (ADR-0053 #6). |
| RT-9 / 7.10 | Registry = 3 rows (`registry.ts:54-91`): alias, description, provider, tier, `providerModelId` from `MODEL_*` config, location, grounding, vision, window. Not in rows: role, fallbacks, effort map, thinking mode, max output, profiles, enabled / rollout, version. Claude ids default to the first-party ids (`config.ts:130-131`); Gemini id has no default (`config.ts:129`). Public choices are display aliases `Auto`, `Gemini 3.8 Flash`, `Sonnet 5.5`, `Opus 5.5` (`registry.ts:22,57,68,80`) not slugs. No registry version stamped (searched: `REGISTRY_VERSION|registryVersion`). |
| M7 / `job` role | Not found: no title job, no summary job; compaction uses the chat's own model (`autoCompact.ts:200-215`). Port source: `arcnave.in:backend/apps/worker`. |
| 7.9 | `capabilitiesTable.ts:55-114`: Claude 5.5 = 600 pages, 32,000,000 request bytes (`:52-53`), 5 MB image, 2,576 px, window 1M, output 128K; Gemini 3.8 Flash = image 20 MB, window 1,048,576, output 65,536, **PDF pages and request bytes `null`** (`:103-104`). Audio / video: transcribed to text at upload by Gemini (`services/retrieval.ts:189-215`), so no Gemini-only routing rule exists or is needed for Claude answers; rule "PDF > 600 pages / request > 32 MB -> Gemini" is not applied by Auto: `enforceModelLimits` throws `provider_payload_limit` (`services/attachments/modelLimits.ts:70-92`). |
| 7.12 | Not found as a chain. Existing pieces: refusal -> typed `model_refused`, no fallback (`generation.ts:1022-1023`; `anthropic.ts:552-554`); spend-limit -> `provider_limit`, no fallback (`anthropic.ts:99-129`); unavailable requested alias -> silently re-resolved through Auto (`generation.ts:1300-1304`) but reported as requested vs resolved. Label text "Answered by X because Y": not found. |
| 7.13 | Regenerate paths exist (`routes/chats.ts`, `services/chatVersions.ts`); tool calls of another provider replay as text when not native (`providers/types.ts:140-147`); thinking is not replayed across models. Gemini sentinel signature: not found (searched: `skip_thought_signature|sentinel`). |
| 7.14 | Exact ids: Claude defaults pinned in config (`config.ts:130-131`), Gemini from env; an empty `MODEL_*` turns an alias off (`config.ts:55-59`). No eval gate, canary, rollout %, or per-turn config version. |
| NO-SILENT-SUB | `registry.ts:5-9` (invariant text) and `generation.ts:1287-1304,524-543`. |
| BREAKER | Not found (searched: `circuit|breaker|half.open|halfOpen` in `backend/src`, non-test). Port source `arcnave.in:backend/packages/gateway/src/arcnave_gateway/breaker.py` (149 lines). |
| ADR-0012 | API key client, no WIF: `providers/anthropic.ts:46-58` (`apiKey: cfg.ANTHROPIC_API_KEY`, `maxRetries: 0`); `inference_geo` not set (searched: `inference_geo`). Gemini client has no explicit retry-off option (`providers/gemini.ts:349-353`; forbidden pattern says "google-genai retries off") - SDK default not verified. |

N-xx differences (both values): N-69 spec Haiku 5.5, 1.5 s, `max_tokens` 1,024 (`register:76,81`) vs repo no router. N-74 spec per-profile ceilings (`register:81`) vs repo 64,000 (`numbers.ts:41`). N-43 spec first-token Fast 20 / Normal 45 / Deep 90 s, stall 30 s, turn 10 min (`register:48`) vs repo no first-token or stall timer, provider request 600,000 ms, turn 3,540,000 ms (`numbers.ts:35,39`, comments cite ADR-0024 / ADR-0054). N-31 / N-42 retries <= 2, 1 s: same (`numbers.ts:23-29`) - match. N-47 breaker: repo none. N-29 / N-30: deferred. 7.9 request limit: spec "<= 30 MB" (`07-model-routing.md:96`, Vertex-era) vs repo 32,000,000 (`capabilitiesTable.ts:53`, first-party docs read 2026-10-14); the spec text was not updated for ADR-0012.

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| RT-1 (Auto rules + 7.9 hard rules) | REWRITE | Auto must default to Gemini, never pick Opus, filter by limits |
| RT-2 / RT-3 / M2 (Haiku router) | NEW-BUILD | Router call type + shadow switch OFF; blocked on OQ7-1 |
| RT-4 | REWRITE | Profile -> effort, xhigh / max off |
| RT-5 | KEEP | Model + routing rule reported on every turn |
| RT-6 retries | KEEP | N-42 matrix implemented |
| RT-6 / 7.12 fallback chain + labels | NEW-BUILD | No model hop, no label; blocked on OQ7-2 |
| RT-9 / 7.10 registry rows | REWRITE | Add role, fallbacks, effort map, thinking mode, max output, enabled, version |
| RT-9 public choices | KEEP | Same four choices; id spelling differs only (display alias vs slug) |
| M7 / `job` role | NEW-BUILD | Title / summary job rows (Stage 6 HP-TITLE, CXD-5); blocked on OQ7-1 |
| 7.9 capability matrix | REWRITE | Gemini limits `null`; Claude 32 MB vs spec 30 MB |
| 7.13 regenerate / conversion | KEEP | Provider switch converts tool history; verified for tool calls only |
| 7.14 upgrade process | REWRITE | Needs `enabled`, rollout, version stamp, eval gate |
| NO-SILENT-SUB | KEEP | Invariant 1 enforced and reported |
| BREAKER | NEW-BUILD | Per-model breaker absent (Stage 15 audit also lists it) |
| ADR-0012 | DIFF-INFRA | API key now (owner decision ADR-0053 #5 / ADR-0054); WIF later; set `inference_geo` and Gemini retry-off now |
| CR1-CR8 / MR2, MR4, MR5, MR9-MR11, MR13, MR14, MR16-MR19 | (covered) | Mapped to the rows above; MR16 (coding to Sonnet when allowed) belongs to the router tier map RT-3 |
| RT-7 / RT-8 / 7.11 / RT-10 / MR6 (limit message) / MR8 | (deferred) | company / ops; `_parts/deferred-g2.md` |

Counts (15 bucketed rows): KEEP 5 (RT-5, RT-6 retries, RT-9 public choices, 7.13, NO-SILENT-SUB) · REWRITE 5 (RT-1, RT-4, RT-9 registry rows, 7.9, 7.14) · NEW-BUILD 4 (router, fallback chain + labels, `job` role rows, breaker) · DISCARD 0 (the tier ladder in `routing.ts` is removed inside the RT-1 REWRITE; `routingPreference` goes with it after OQ7-3) · DIFF-STACK 0 · DIFF-INFRA 1 (ADR-0012 credential path). Not bucketed: RT-7, RT-8, 7.11, RT-10 (deferred), M3-M6 / M8 / M9 / M10 / M11 (other audits).

## 4. Non-KEEP items
Order that keeps the app runnable: registry rows first (invisible), then limits filter, then Auto change, then fallback, then router (OFF).

### RT-1 — Auto routing and the hard rules (7.9)
- Exact change: Auto -> `gemini-flash` unless a hard rule forces otherwise (audio / video input and Gemini down = error; PDF > 600 pages or request over the Claude limit with a Claude model already chosen = answer on Gemini with a label); never choose Opus on Auto (FD-09); drop the tier ladder and `routingPreference` (RT-8 allowlist is Later); drop the sticky "same model as chat" for Auto only if OQ7-3 says so. Files: `providers/routing.ts` (rewrite to ~30 lines), `generation.ts:1280-1345`, `config.ts:133-134` (remove thresholds), `db/schema.ts:104` (`routing_preference`, keep column until removal), `routes/preferences.ts`, frontend setting. Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/registry.py` (`_CHOICE_KEYS`, `auto -> gemini-flash`).
- Option A (REWRITE): S-M · risk: users lose "quality" Auto for files; Gemini handles files well and is cheaper · breaks: `providers/routing.test.ts`, `routes/stickyModel.integration.test.ts`, `routes/models.integration.test.ts`.
- Option B (keep ladder, cap at Sonnet): S · outcome differs (RT-1 says Gemini).
- Pick: A. Today an attachment on Auto starts an Opus 5.5 answer ($4 / $20 per 1M) - a cost risk until fixed.

### RT-2 / RT-3 / M2 — Haiku 5.5 router (built OFF)
- Exact change: add a registry row `router-claude-haiku` (`claude-haiku-5-5`, thinking `{type: disabled}`, effort `low`, `max_tokens` 1,024, no `temperature` / `top_p` / `top_k`, no retries, `output_config.format` json_schema with the caller's enums + `additionalProperties:false`), a `classify(text, schema)` call type returning `ok | timeout | error | invalid` with a 1.5 s timeout (N-69) in HTTP and in a local timer, case-insensitive enum match returned in the schema's spelling; a per-turn shadow call (async, never awaited before generation, awaited after the turn within 1.5 s, one log line of ids / enums) behind `ROUTER_SHADOW=off`; rules remain the final gate. Intent list and router spec file do not exist yet - the call type is built, the switch stays OFF. Files: `providers/registry.ts`, new `providers/router.ts`, `generation.ts`, tests. Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/router.py` (386 lines, full call type with tests), `registry.py`.
- Option A (NEW-BUILD behind the OFF switch): M · risk: `@anthropic-ai/sdk` structured-output field names for `output_config.format` must be checked against the installed SDK · breaks: none while OFF; a fourth registry row conflicts with ADR-0055 (OQ7-1).
- Option B (skip until the intent list exists): S · RT-2 outcome not met; the spec itself says "built OFF", so B leaves the later switch-on without a tested call type.
- Pick: A **after OQ7-1**. If the owner keeps three models: A is not built and the rules gate stays the only router (record in an ADR).

### RT-4 — effort per profile
- Exact change: effort = f(profile): fast low, normal medium, deep high on every model; remove `xhigh` / `max` from `reasoningEfforts`; keep explicit sending; keep thought summaries (the repo's thinking panel is the "until the panel" condition in the doc-sync). Files: `providers/capabilitiesTable.ts:66,82,151-157`, `generation.ts:685-689`, `routes/preferences.ts` (the `effort` pref becomes profile). Depends on Stage 6 CXD-6 (profile). Option A REWRITE S; Option B keep user-chosen effort (S, outcome differs). Pick A.

### Fallback chain and labels (RT-6 / 7.12 / MR7 / MR19)
- Exact change: implement the matrix: Gemini 429 / 5xx after the retries -> Sonnet 5.5 (same profile effort) when Claude is configured and allowed; Sonnet failure -> Gemini; Opus -> Sonnet -> Gemini; Claude limit (`provider_limit`, org cap 429 `enforced_spend_limit_reached`, 400 "API usage limits") -> every Claude model skipped -> Gemini + message; Claude credential failure -> Gemini; Claude `refusal` -> `blocked`, no hop (already); Gemini SAFETY / PROHIBITED_CONTENT / SPII -> no hop; audio / video with Gemini down -> error with Retry; the hop applies to that turn only; ER-3 continuation uses the same pinned model; label "Answered by X because Y was unavailable" on the message (new column `fallback_reason`) and in the `start` event. Files: `generation.ts` (wrap `streamWithRetry`), `db/schema.ts` + migration, `providers/types.ts` (`ProviderError` kinds), frontend label. Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/{gateway.py,failures.py}`.
- Option A (NEW-BUILD in `generation.ts`): M-L · risk: mid-answer hops duplicate text - only before the first visible output (same rule as the retries) · breaks: tests assuming no hop (`providerTimeout`, `refusal` integration tests).
- Option B (single "busy, retry" error, no hop): S · outcome differs from 7.12 but cheaper and safe.
- Pick: A, **blocked on OQ7-2**.

### RT-9 / 7.10 / 7.14 — registry rows and version
- Exact change: extend `ModelEntry` with `role` (M1 / M2 / job), `fallbacks`, `effort` map, `thinking` mode, `maxOutputTokens` per profile (N-74), `profiles`, `enabled`, `knowledgeCutoff` (Gemini 2026-03, Claude 2026-06 for `<model_info>`), and a `REGISTRY_VERSION` constant bumped with every row change and stamped on each turn; pinned ids live in the registry module (config only supplies the Gemini id, which has no documented default here). Files: `providers/registry.ts`, `providers/capabilitiesTable.ts`, `generation.ts`, `db/schema.ts` (stamp, shared with Stage 6 STAMPS). Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/registry.py`. Option A REWRITE S-M; Option B leave rows and stamp only the alias (S, no version). Pick A.

### M7 / job role — title and summary rows
- See Stage 6 HP-TITLE and CXD-5. Registry rows `title-claude-haiku` and `summary-claude-haiku` (`claude-haiku-5-5`, thinking disabled, effort low, 40 / 1,200 output tokens, no fallback, no Claude-switch check). Option A NEW-BUILD S once the worker job exists; Option B run on Gemini 3.8 Flash (S, no model conflict, slightly dearer per call). Pick A **after OQ7-1**; B until then.

### 7.9 — capability matrix values
- Exact change: Gemini row: `maxPdfPagesPerRequest` 3,000, PDF 50 MB, images <= 3,000 incl. HEIC, inline 7 MB / Cloud Storage 30 MB, audio / video; Claude request limit: record 32 MB (first-party) and ask the owner to update 7.9 (the Stage 7 text still says 30 MB from the Vertex era). Auto filters candidates by these limits before choosing (RT-1). Files: `capabilitiesTable.ts:87-105`, `services/attachments/modelLimits.ts`. Option A REWRITE S; Option B leave `null` (the provider's own 413 stays the backstop; S, outcome partly). Pick A.

### BREAKER — per-model circuit breaker
- Exact change: in-process breaker per model: open after 5 failures within 30 s or >= 50 % of the last 20 calls (judged only after 20 calls), half-open after 30 s with one trial call, retry budget <= 10 % of calls (N-47); router and job calls neither admitted nor recorded; open breaker = skip that row in the fallback chain. Files: new `providers/breaker.ts`, `generation.ts`. Port source: `arcnave.in:backend/packages/gateway/src/arcnave_gateway/breaker.py`. Option A NEW-BUILD S-M (in-process is the spec's own design; Redis is not needed); Option B none (a failing model keeps being tried for every turn). Pick A together with the fallback chain.

### ADR-0012 — Claude client details
- Exact change now: pass `inference_geo: 'global'` if the SDK exposes it; set the Gemini SDK retry option off explicitly (ER-1) and test it; keep `maxRetries: 0`. WIF replaces the API key at Phase 5 (infra). Files: `providers/anthropic.ts:46-58`, `providers/gemini.ts:349-353`. Option A DIFF-INFRA for WIF (later), S for the two flags; Option B none. Pick A.

## 5. Open questions for the owner
- OQ7-1 (build-plan B-4 / ADR-0055 "three models only" vs Haiku 5.5): ADR-0013 locks the router M2 and ADR-0014 locks the title / summary jobs on `claude-haiku-5-5`. Do you allow a fourth registry row (Haiku 5.5) for helper roles, or do these roles run on one of the three models (or not at all in the prototype)? The auditor did not decide. (Same as OQ6-1.)
- OQ7-2: 7.12 lets Gemini fall back to Sonnet only "if the company Claude switch is ON and a limit is left". ADR-0053 #6 dropped the per-company switch. For the prototype, may a Gemini outage fall back to Sonnet automatically (a Claude cost the user did not choose), or should it show "busy, retry" with a button?
- OQ7-3: The repo has a user setting `routingPreference` (economy / balanced / quality) and a sticky "one model per conversation" rule for Auto. The spec has neither (RT-8 allowlist / effort cap are Later; 7.13 says Auto follows the same rules each turn). Remove both, or keep them by an owner-approved ADR?
- OQ7-4: Stage 7 text 7.9 still says Claude "whole request <= 30 MB" (Vertex). With the first-party API the documented limit is 32 MB. Confirm the repo may use 32 MB and that the Architecture folder text is updated.
- OQ7-5: RT-4 keeps thought summaries off until "the web-app thinking panel". The repo already shows them (ADR-0030). Confirm that counts as the panel condition being met.

## 6. KEEP spot-check
(5 KEEP rows; 2 re-opened = 40 %)
- RT-6 retries: re-opened `generation.ts:1444-1450` (retry only when `retryable`, attempts < `PROVIDER_MAX_RETRIES`, delay from `retryDelayMs`, not after visible output) and `config/numbers.ts:23-29` (2 / 1,000 ms / 8,000 ms / 10,000 ms): confirmed, matches N-42.
- NO-SILENT-SUB: re-opened `generation.ts:1287-1304` (requested alias unavailable -> Auto; logged) and `:524-543` (`requested` and `resolved` both in the `start` event): confirmed that the substitution is reported, but note the user-picked Sonnet silently becoming Gemini is allowed only with a label (7.12); the frontend label was not opened - downgrade risk noted, status stays KEEP for the backend.
- RT-5, RT-9 choices, 7.13 not re-opened beyond the reads above.
