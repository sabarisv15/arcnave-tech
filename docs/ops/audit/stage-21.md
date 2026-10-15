# Stage 21 - Implementation plan: conformance audit
Sources read: `docs/architecture/Stage-21-Implementation-Plan/00-checkpoint-stage21.md` (all doc-sync blocks to 2026-10-13) and `21-implementation-plan.md`; `00-Handoff/00-build-plan-arcnave-tech.md`, `00-numbers-register.md` (Stage 21 column), `Build-arcnave-tech/tech-p0.md`, `tech-p1.md`; repo `CLAUDE.md`, `.github/workflows/ci.yml`, `docs/` tree, `backend/src/test/{contentLeak,promptKit/*}`, A1 grep of `backend/src` and `arcnave-frontend/src`. Port source: `arcnave.in:CLAUDE.md` rules (quoted in the task context), `arcnave.in:.github/workflows/ci.yml`, `arcnave.in:lv1/`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

## 1. Locked decisions
| Id | Decision (one line) | Status |
|---|---|---|
| IP-1 | Build order Phases 0-6, verification first | SUPERSEDED by build plan B-10 (owner 2026-10-14: phase order, per phase compare-build-exit); not an outcome to bucket |
| IP-2 | 24 weeks to first paying company, gates do not slip | LOCKED (process / business) |
| IP-3 | Monorepo layout section 1 (infra, backend apps/packages, parser, sandbox, browser, web, mobile, prompts, docs, .github) with root + per-app `CLAUDE.md`; doc-sync adds `backend/packages/chat` | LOCKED; Python layout |
| IP-4 | LV-1 127 tests in batches B1-B7, `lv1/` folder, FAIL on a design-changing test = ADR + doc-sync before dependent code; ADRs in `docs/architecture/adr/` | LOCKED; Claude-test refinement 2026-10-06 SUPERSEDED for Claude by 2026-10-10 |
| IP-5 | CI gates: prompt kit critical cases, skill evals 99 %, pgTAP RLS, content-leak test, licence/SBOM, security scans | LOCKED |
| IP-6 | Pilot 5-10 companies in Phase 6, price from FD-15 floors | LOCKED (business) |
| IP-7 | Prod project in Phase 5, HA before first paying customer | LOCKED (deferred infra) |
| IP-8 | Lawyer track from week 1, sign-off at Phase 5 exit | LOCKED (business) |
| IP-9 | Academics vertical Later | LOCKED |
| IP-10 | Documentation is a phase-exit gate: `docs/product`, `api`, `architecture`, `ops`, `legal-trust`, `changelog`, `startup-pack` | LOCKED |
| P-5 | Principle 5: no literals for register numbers; `settings` table + `price_book` | LOCKED |
| A1 | Identifiers (project id / number, instance connection name, SA / owner e-mail) not in code, tests, workflows, CI logs or app logs; allowed in ops docs, `lv1/results`, Terraform backend config; passwords, keys, tokens forbidden everywhere. Amended by C1 (telemetry fields may carry the project id from the runtime environment) | LOCKED 2026-10-08 |
| C1 | Google-required telemetry fields may carry the project id, from the environment only | LOCKED (OTel: deferred) |
| DS21-a | Hosts: previews on `usercontent.arcnave.tech`, everything else `arcnave.in`, ops console `ops.arcnave.in` | LOCKED 2026-10-08 (stage-19 S19-09) |
| DS21-b | Phase 2 exit: retrieval p95 <= 1,200 ms (N-27) replaces 800 ms; reranker per ADR-0007; OCR = pinned RC + Gemini fallback | LOCKED |
| DS21-c | Phase 1 build line: passwordless invite-only auth (ADR-0010), Task 1.9 chat core, Gateway = Gemini + first-party Claude (ADR-0012), Task 1.10-1.11 | LOCKED (auth / executor: other stage audits) |
| DS21-d | Brief checklist: every new API error path follows Stage 15 ER-11 (RFC 9457 + code, request_id, retryable, retry_after_s) | LOCKED (Stage 15 audit) |
| DS21-e | Independent fresh-context audit before each phase exit | LOCKED (process) |
| REG | Registers: "Stage 21" column numbers N-05, N-25, N-27, N-36, N-53, N-59, N-63/64, N-65/66; LV batch tags; lawyer groups; task log | LOCKED (see `numbers-diff.md`) |
| CLAUDE | Root `CLAUDE.md` lists checkpoint docs, numbers register, forbidden patterns (content in logs, literals for N-xx, SDK retries, temperature params), commands | LOCKED |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched ...)" |
|---|---|
| IP-1/2/6/7/8/9 | Plan in `docs/architecture/00-Handoff/00-build-plan-arcnave-tech.md:38-109`; phases 0-1 executed (`Build-arcnave-tech/tech-p0.md`, `tech-p1.md`). |
| IP-3 | Layout: `backend/`, `arcnave-frontend/`, `docs/`, `tools/`, `compose.yaml`, `.github/workflows/ci.yml`, `.claude/`. No `infra/`, `parser/`, `browser/`, `prompts/`, `lv1/` (searched `**/*.tf`, `{lv1,infra,prompts,evals}/**`: none). One `CLAUDE.md` at root only (searched `**/CLAUDE.md`). Skills live in `backend/skills/*` (8 packs). |
| IP-4 | `lv1/`: not found. Live scripts instead: `backend/src/scripts/verifyBatch*Live.ts`, `test*.ts`; ADRs in `docs/decisions` (0053 lists deviations, 0054/0055/0061 follow). Deviation-as-ADR practice exists; ADRs 0058-0060 promised but absent. |
| IP-5 | `ci.yml:41-78` runs typecheck + vitest only. Prompt kit: `backend/src/test/promptKit/{cases,scenarios,promptKit.test.ts}`, critical cases are plain `it` (`promptKit.test.ts:8`), 89 derived cases, 0 of the 68 mirrored kit cases ported (tech-p1 result row D). Content-leak: `backend/src/test/contentLeak.test.ts:61-65` sentinel test of a full fake turn. Skill evals: not found (searched `docs/evals` = `scope-cases.json` only). pgTAP, RLS: not found. Licence/SBOM, scans: not found (see stage-20 VS-26). |
| IP-10 | `docs/` holds `decisions/`, `deploy/`, `checkpoints/`, `audits/`, `evals/`, `handover/`, `superpowers/`, `support/`, `walkthroughs/`, `architecture/` (mirror), `openapi.json`, `backend-research.md`, `tools-skills-architecture.md`. Not found: `docs/product`, `docs/api` (only `openapi.json`), `docs/ops` (this audit creates the first file), `docs/legal-trust`, `docs/changelog`, `docs/startup-pack` (searched `docs/*`). |
| P-5 | Typed constants `backend/src/config/numbers.ts:20-84` (20 entries, each with N-id) read by `config.ts`; many other literals without N-id (see `numbers-diff.md` section 3). No `settings` table, no `price_book` (searched `db/schema.ts`: tables hold users, chats, usage etc.; price is env JSON `config.ts:384-398`). |
| A1 | Project id in code: 20 files under `backend/src/scripts/` (36 occurrences, e.g. `verifyBatch24Live.ts`, `testNetworkEgress.ts`) and in production code `backend/src/tools/sandbox/cloudRunSandboxClient.ts:215` (default signing service-account e-mail containing the project id; env read outside config at `:214`). Service-account e-mail form in 8 files (the 7 scripts above + `cloudRunSandboxClient.ts`). Project number inside the production API URL `arcnave-frontend/src/api.ts:33`. Also present in docs outside `docs/ops`: `docs/checkpoints/CURRENT.md` (7 hits), `docs/deploy/*.md`, `docs/superpowers/*` (allowed only for ops docs by A1). Values are not reproduced here. |
| C1 | No OTel / trace-field code (deferred). |
| DS21-a | See stage-19 S19-09. |
| DS21-b | No retrieval p95 measurement; no reranker; OCR: Gemini only (`CURRENT.md` / ADR-0044). |
| DS21-c | Auth is password + Google (`backend/src/services/auth.ts:10`, `googleSignIn.ts:9`); no executor, no invites. Gateway: Gemini + first-party Claude (`providers/anthropic.ts`, `gemini.ts`). |
| DS21-d | Typed `ApiError` with stable `code` (`backend/src/errors.ts`, CLAUDE.md invariant 5); RFC 9457 shape not assessed here (Stage 15 audit). |
| CLAUDE | Repo `CLAUDE.md:102-125` "Build rules on this base": branch rule, model policy, numbers rule, forbidden = SDK retries, `temperature`/`top_p`/`top_k`, model SDK calls outside `backend/src/providers/`, logging target. Missing versus the locked list: identifier rule A1, language-detection rule (LANG-1), "DB query without company context" (deferred), context-editing betas, Eventarc / Cloud CDN / Vertex RAG Engine / Model Armor enforce / AGPL dependencies, "new dependency outside the Stage 20 BOM -> ask". |

Checks run for the Claude-facing forbidden patterns (all clean): `temperature|top_p|topP|topK|top_k` in `backend/src` non-test: no hits; `maxRetries|max_retries` only `providers/anthropic.ts:51`; model SDK imports only in `backend/src/providers/{anthropic,gemini}.ts` plus dev scripts in `backend/src/scripts/*` (the lvrunner-style exception is not written down for them); `anthropic-beta`/context-management betas: no hits; Eventarc, Cloud CDN, RAG Engine, Model Armor: no hits in code or config.

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| S21-01 (IP-3 layout) | DIFF-STACK | `backend/` + `arcnave-frontend/` replace the Python apps/packages layout |
| S21-02 (CLAUDE.md content, per-app files) | REWRITE | Locked forbidden list and A1 rule missing from `CLAUDE.md`; no per-app files |
| S21-03 (IP-4 `lv1/` pack) | NEW-BUILD | No LV register results folder or per-id scripts; live scripts are ad hoc |
| S21-04 (IP-4 deviation-as-ADR) | KEEP | ADRs 0053, 0054, 0055, 0061 record deviations with status |
| S21-05 (IP-5 prompt kit) | NEW-BUILD | 0 of 68 locked kit cases ported (file not in the mirror); derived cases gate CI |
| S21-06 (IP-5 skill evals 99 %) | NEW-BUILD | No skill eval cases or nightly job |
| S21-07 (IP-5 content-leak test) | KEEP | Sentinel test runs in CI as part of vitest |
| S21-08 (IP-5 licence / SBOM / scans) | NEW-BUILD | Same work as stage-20 VS-26 |
| S21-09 (IP-10 docs structure) | NEW-BUILD | `product`, `api`, `ops`, `legal-trust`, `changelog`, `startup-pack` absent |
| S21-10 (P-5 numbers) | REWRITE | Many literals without N-id; no settings / price_book; five repo values differ from the register |
| S21-11 (A1 identifiers) | REWRITE | Project id, service-account e-mail and project number in code, scripts and the production API URL |
Not bucketed: IP-1, IP-2, IP-6, IP-7, IP-8, IP-9, DS21-e (process / business / deferred), IP-5 pgTAP + RLS (deferred), C1 (OTel, deferred), DS21-a (stage-19 S19-09), DS21-c (Stage 15, 16 audits), DS21-d (Stage 15 audit), REG (numbers-diff).

Counts: KEEP 2 - REWRITE 3 - NEW-BUILD 5 - DISCARD 0 - DIFF-STACK 1 - DIFF-INFRA 0 (11 rows).

## 4. Non-KEEP items
### S21-02 - CLAUDE.md alignment
- Exact change: add to the "Build rules" forbidden list: identifiers rule (A1/C1 wording), no hard-coded language detection / transliteration (LANG-1), no Claude context-editing/compaction betas, no Eventarc / Cloud CDN / Vertex RAG Engine / Model Armor enforce / AGPL dependency, "dependency outside the Stage 20 BOM -> stop and ask", exception line for dev scripts under `backend/src/scripts`; per-app `CLAUDE.md` for `backend/` and `arcnave-frontend/` with contracts. Files: `CLAUDE.md`, new `backend/CLAUDE.md`, `arcnave-frontend/CLAUDE.md`. Port source: `arcnave.in:CLAUDE.md` (text quoted in the task context).
- Option A (REWRITE): edit now. Time S. Risk none. Breaks nothing (the repo rule "a decision is not changed until the document is changed" is satisfied).
- Option B: wait for the Phase 5 hardening. Risk: new code lands against an incomplete rule set.
- Pick: A.

### S21-03 - LV-1 pack
- Exact change: create `lv1/` with one script per LV id the repo can run (TypeScript, JSON result line, no content) and a results folder; map ids to the build plan's phases; start with the batch the repo's live scripts already cover. Files: new `lv1/`, adapt `backend/src/scripts/verifyBatch*Live.ts`. Port source: `arcnave.in:lv1/` and `backend/apps/lvrunner`.
- Option A (NEW-BUILD): port the register structure, rewrite the probes in Node. Time L overall, S to start. Risk: many LV tests need the Python infra (deferred).
- Option B: keep ad hoc scripts and record results in `docs/checkpoints/CURRENT.md`. Time 0; leaves IP-4 unmet.
- Pick: A, incremental per phase.

### S21-05 / S21-06 - Prompt kit and skill evals
- Exact change: obtain the 68-case kit (it is not in the mirror and the zip inside `test-kit` was unreadable to the auditors) and port it onto the repo prompt; critical cases stay plain `it`. Skill packs: >= 30 eval cases each, 99 % gate, nightly job. Files: `backend/src/test/promptKit/*`, `backend/skills/*`, new `evals/`. Port source: Stage 6 / Stage 8 audits own the case content.
- Option A (NEW-BUILD): as stated. Time M (kit) + L (skill evals). Option B: keep derived cases, defer skill evals to Phase 3 of the build plan (P3-C already says so). Pick: A for the kit as soon as the file is available; B for skill evals by plan.

### S21-08 - Security gates in CI
Same change as stage-20 VS-26; pick A in two commits.

### S21-09 - Documentation structure
- Exact change: create `docs/product`, `docs/api` (generated from `docs/openapi.json`), `docs/ops`, `docs/legal-trust`, `docs/changelog/CHANGELOG.md` (the Python CLAUDE.md asks for an "Unreleased" line per behaviour change), `docs/startup-pack`. Files: new folders only. Port source: `arcnave.in:docs/` structure.
- Option A (NEW-BUILD): skeleton now, content per phase exit (IP-10). Time S for skeleton. Option B: wait for Phase 5. Risk: the changelog is lost for work already done.
- Pick: A (skeleton + changelog first).

### S21-10 - Numbers discipline
- Exact change: (1) a `settings` store (scope-aware) and effective-dated `price_book` replacing the env JSON; (2) move every literal listed in `numbers-diff.md` section 3 into `config/numbers.ts` with its N-id; (3) where the repo value differs from the register, either change the value to the register or write an owner-approved ADR (ADR-0061 withdrew "repo wins"). Files: `backend/src/config/numbers.ts`, `config.ts`, listed call sites, `db/schema.ts` + migration for settings / price_book. Port source: `arcnave.in:backend/packages/db` (settings, price_book) and `packages/ledger`.
- Option A (REWRITE): steps 2 and 3 first (S-M), steps 1 with tenancy shape (M). Risk: changing `TURN_DEADLINE_MS`, `TOOL_MAX_ROUNDS`, upload caps alters behaviour and breaks tests that pin the repo values. 
- Option B: only add N-id comments to the existing literals. Time S; keeps DIFFs.
- Pick: A for the register-conflicting values (decide each with the owner, see Q9), B-style tagging immediately for the rest.

### S21-11 - A1 identifiers
- Exact change: remove hard-coded project id, service-account e-mail and project number from `backend/src/tools/sandbox/cloudRunSandboxClient.ts:212-215` (default must be absent: require config, read through `config.ts`, not `process.env`), the 20 scripts under `backend/src/scripts/` (read from env or flags), and `arcnave-frontend/src/api.ts:33` (see stage-19 S19-08). Consider whether `docs/checkpoints/CURRENT.md`, `docs/deploy/*`, `docs/superpowers/*` should move under `docs/ops/` (A1 allows identifiers only there). Add a grep CI check. Port source: none.
- Option A (REWRITE): fix code and scripts now, add a CI guard like the Python A1 guard. Time S-M. Risk: the live scripts stop working until their env is set. Breaks no unit tests (`cloudRunSandboxClient.test.ts` passes its own e-mail).
- Option B: leave scripts (dev tools) and fix only production code and the frontend URL. Time S. Risk: identifiers stay in git history either way.
- Pick: A; do the production code and frontend URL first.

## 5. Open questions for the owner
- Q9. Register-conflicting repo values: which win? Turn deadline 59 min vs 10 min; tool rounds 16 vs 1-2 / 5 / 15 per profile; max output 64,000 vs 8,192 / 16,384 / 32,768; message 100,000 chars vs 32,000; upload caps; purge 30 d vs soft delete 7 d; session 14 d vs idle 24 h / absolute 28 d. (Detail: `numbers-diff.md` section 2.) Fast / Normal / Deep profiles do not exist in the repo at all (Stage 6).
- Q10. `docs/checkpoints/CURRENT.md`, `docs/deploy`, `docs/superpowers` hold identifiers outside `docs/ops`: relocate, or accept as ops docs?
- Q11. The 68-case prompt kit file: where is it? (`test-kit/arcnave-test-kit.zip` unreadable here.)
- Carried: Q1 (sandbox), Q2 (Cloudflare), Q3 (API key vs WIF), Q4 / Q8 (Haiku router / worker vs three models), Q7 (passwordless).
- Could not check: LV-1 batch outcomes of the Python build (not mirrored), live infra state.

## 6. KEEP spot-check
2 KEEP rows, both re-opened. S21-04: `docs/decisions/0053-prototype-base-and-target-spec.md:3-5` and `0061-locked-decisions-win-outside-stack-and-infra.md:3-6` carry Status lines and supersession - confirmed. S21-07: `backend/src/test/contentLeak.test.ts:61-65` sentinels and `backend/vitest.config.ts:5` includes `src/**/*.test.ts`, run by `ci.yml:56` - confirmed; downgrade note: it covers one fake turn and is shadow-mode, enforce is deferred.
