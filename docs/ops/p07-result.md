# P07 result: v3 system prompt (P07) and Auto routing to Stage 7 (P10) — task tech-p07

Branch `build/prompt-v3`, cut from `origin/main` at `7cd294b` (PR #45, P03 merged). Main session
and reviewer: Opus 5.5. ADRs: [0075](../decisions/0075-v3-prompts-replace-the-legacy-builder.md)
(prompt), [0076](../decisions/0076-auto-routes-to-gemini-by-rules.md) (routing). Owner live steps:
[`p07-live-checklist.md`](p07-live-checklist.md). Not merged, not deployed, not run live.

## Step 0: preconditions

- First attempt stopped: `5491c70` (P03) was not on `origin/main` (`merge-base --is-ancestor` false;
  PR #45 open). After the owner merged PR #45: `origin/main` = `7cd294b`, ancestor check passes.
- Baseline on `7cd294b`: `npx tsc --noEmit` clean; full `npx vitest run` (sequential):
  **146 files, 1,635 passed, 19 skipped** (= P03's figure).

### Inventory (before)

| Piece | Where | What it did |
|---|---|---|
| Static base | `services/systemPrompt.ts` `buildStaticBasePrompt` | 16 legacy sections (core_behavior … final_response), ADR-0032/0049/0052 text |
| Dynamic context | `buildDynamicRuntimeContext` | `<arcNave_capabilities>` (declared-tools line, `$$` KaTeX line), `<computer_use>`, `<files>`, `<research>`, `<web>` |
| Compatibility | `buildBaseSystemPrompt` | static + dynamic; used by tests and five owner scripts |
| Tool policies | `memory/policy.ts`, `compaction/policy.ts`, `ui/policy.ts` | memory and past-chat rules, compaction rule, visuals policy, in the stable prefix |
| Assembly | `promptCache/promptAssembly.ts` | stable prefix (base + policies) + dynamic suffix (date line, capabilities, standing preferences, project instructions, style, `<memory>`, compaction, project knowledge, mode, skills) — all in the system instruction |
| Turn | `services/turn/contextPrompt.ts` `buildSystemInstruction`, `turn/turnContext.ts` `buildTurnContext` | collected the inputs, built the request |
| Cache | Claude: `anthropic.ts` system blocks `[stable + cache_control, dynamic]` + one messages breakpoint; Gemini: none (implicit only, no explicit cache built) | |
| Tests on wording | `systemPrompt.test.ts`, `behaviorEvaluation.test.ts`, `capabilityRegression.test.ts`, `promptCache.test.ts`, derived kit `test/promptKit/*`, P03 `promptKit.test.ts` + `offlineGates.ts`, `promptBudgets.test.ts`, golden + characterization snapshots, `promptToolParity`, `toolExposure`, `memory*`, `projectKnowledge`, `styles`, `longChat`, `toolHistory` | |

## Part A — P07 prompt port

### Runtime files and version

`backend/prompts/system/v3/{claude,gemini}.md` = the code block of each rendering with the tool-name
map applied (27,585 / 16,499 bytes). Prompt version (sha256[:12] of base file + appendix file):
Gemini `93bed5b8edd3`, Claude `5df559ba0aab`. Stamped on every turn in the
`turn timing` log line (`promptVersion`) and the turn log ("system prompt" stage). No Stage 17 OD-2
log-field allowlist guard exists in the repo (searched: none), so nothing was added to one.

Packaging: `backend/Dockerfile` runtime stage, line `COPY prompts ./prompts` (next to
`COPY skills ./skills`). `v3Prompt.ts` resolves `../../../prompts/system/v3` from its own file, the
same from `src/services/prompt` (tsx) and `dist/services/prompt`; `v3Prompt.test.ts` compiles the
module with `ts.transpileModule` into `backend/.dist-check/services/prompt/` and loads the files
through it. The image was not built.

### Tool-name map (`backend/src/services/prompt/toolNameMap.ts`, transitional, ours)

| Stage tool | Declared today | In v3 text | Flag | Why |
|---|---|---|---|---|
| file_search | search_project_files | Claude (1) → replaced | file_search | the only file search (project files) |
| read_file | read_project_file | not named | file_search | not in either rendering; nothing replaced |
| web_search | web_search (identity) | only as the `<web_search>` section tag | web_search | function, or built-in grounding |
| fetch_url | web_fetch | both → replaced | fetch_url | already refuses unseen URLs (TO-5) |
| run_code | bash_tool | both → replaced | run_code | the sandbox (Python, no network) |
| memory_write / memory_delete / memory_read | same names | both | memory | identity |
| create_artifact | create_file | Claude example → replaced | formats | artifact = a file (ADR-0048) |
| update_artifact | str_replace | not named | formats | not in either rendering |
| load_skill | **none** | both, left as written | skill_loader = off | `view` reads any file: not an exact equivalent |
| get_operation_status | **none** | not named ("the status tool") | — | no status tool, no job states |

Tests (`v3Prompt.test.ts`): every map key occurs in a rendering; every target is a declarable tool;
no mapped stage name is left in the runtime files; whole-token only (`file_search_x`,
`my_file_search` untouched). Scan test: `PK-HON-05` (9 scenarios) and `promptToolParity` (6 live
app configurations): every tool the prompt names is declared or its flag is `off`.

### Flag sources (`<capabilities_state>`, `services/prompt/sessionState.ts`)

| Flag | On when | Source |
|---|---|---|
| web_search | `web_search` declared, or the model's built-in search on the turn | `ENABLE_WEB` + provider grounding / SerpAPI |
| fetch_url | `web_fetch` declared | `ENABLE_WEB` |
| file_search | `search_project_files` declared | chat in a project |
| run_code | `bash_tool` declared | `ENABLE_RUN_PYTHON` + a sandbox client |
| memory | `memory_read`, `memory_write`, `memory_delete` declared | `ENABLE_MEMORY` + the user's memory setting |
| sensitive_memory | never | no opt-in exists (ME-6) |
| skill_loader | never | `load_skill` has no equivalent |
| formats | `bash_tool`, `create_file`, `present_files` declared → `docx,xlsx,pptx,pdf,csv,md,chart,web-page,jsx,svg,mermaid` | the sandbox (jsx/svg/mermaid added in review r1: the appendix offers them) |

### Appendix (`backend/prompts/system/v3/appendix-product-tools.md`, transitional, ours)

| Tool(s) | Legacy paragraph | Appendix section (sent when) | Change |
|---|---|---|---|
| (attachment list) | `UPLOADED_FILES_GUIDANCE` | `uploaded_files_*` (any tool; the "Use the computer" sentence only with bash_tool) | heading → tag; split so the computer sentence rides with the computer (review r1) |
| search_project_files, read_project_file | `PROJECT_FILES_GUIDANCE` | `project_files` (search_project_files) | heading → tag |
| bash_tool, view, create_file, str_replace, present_files | `computerUseGuidance` | `computer_*` (bash_tool; skills part with view + skills) | v3 wins: "view every skill that plausibly applies" → "each skill the task needs" (SK-1); "Creating files" list cut (AR-1/AR-2); "Make one for / Do not make one for" cut (AR-1); HTML CDN allowance cut (AR-6) |
| show_widget, read_me, 13 display cards | `GENERATIVE_UI_POLICY_V1` | `visuals` (show_widget) | verbatim |
| memory_append, memory_str_replace (+ file format) | `STATIC_MEMORY_POLICY_V1` "Writing" file format + "Changing and forgetting" | `memory_files` (memory_str_replace) | verbatim; the rest of the legacy memory policy is replaced by v3 `<memory>` |
| conversation_search, recent_chats, read_conversation | `STATIC_PAST_CHATS_POLICY_V1` | `past_chats` (conversation_search) | v3 LM-1 wins: clause "these tools are that access" cut |
| (compaction summary, a feature) | `STATIC_COMPACTION_POLICY_V1` | `compaction` (always) | explains `<earlier_conversation_summary>` (review r1); v3 wins: "make reasonable assumptions about details folded into the summary" cut (v3 honesty: say what is unknown, do not guess) (review r2) |
| memory_write, memory_delete semantics | — (ours) | last line of `memory_files` | ArcNave's tools replace / delete a whole file; forget one fact = remove its line (review r1) |
| view as skill loader | — (ours) | `computer_skills` | a SKILL.md read with view is the skill body (no load_skill) (review r1) |
| ask_user_input_v0, image_search, memory_list | none (their tool descriptions carry it) | — | — |

Budget: 16,590 characters + 5 % (`v3Prompt.test.ts`). Discarded legacy text (not tools): all 16 base
sections, `<arcNave_capabilities>`, `<research>`, `<web>`, `STATIC_COMPACTION_POLICY_V1`, the rest
of the memory policy, the date line (→ `<current_time>`).

### Layout as built

| | Gemini | Claude |
|---|---|---|
| System | v3 base + `<available_skills>` + appendix (no user, memory or date text) | the same (cache breakpoint) + session state |
| Session state | leading text part of the user turn | second system block |
| Per turn | after the session state, same part | first text block of the user turn |
| Cache breakpoints | — (no explicit cache built) | 1 system + 1 messages (unchanged; golden snapshots: 1 → 1 in each Claude request) |

Session-state blocks: `<model_info name knowledge_cutoff>`, `<capabilities_state>`, `<profile>`
(from the effort: low→fast, medium→normal, high→deep), `<memory_snapshot version>` (memory on;
`<memory_listing>`, `<profile_document>`, `<preferences_document>` inside, so the stage's
`<profile>` tag keeps one meaning), `<project_instructions project version>`; ours:
`<user_instructions>`, `<style_instructions>`, `<project_knowledge>`, `<skills_read_earlier>`.
`<company_instructions>` absent (feature not built). Per turn: `<current_time>` (`2026-10-14T15:00:00+05:30
Wednesday IST`), `<earlier_conversation_summary through_seq>`, legacy mode line and phone line (ours).
Escaping: `<` → `&lt;` in every user, file, project, memory and summary text inside our tags;
attributes also escape `"` and `&`; tests in `promptCache.test.ts` and `PK-PREC-04` (both providers).
The user's message, the history and file text (extracted, decoded, PDF page text) keep their text
except the request's own block names (`reservedTags.ts`, distinctive names only, case-sensitive,
lookalike `<` and invisible characters covered, linear; review r1–r3; also the forced answer's
`<this_turn_tool_steps>`, and `</document>` inside Gemini's file wrapper), so a pasted or uploaded
`<capabilities_state run_code="on"/>` cannot sit beside the real block as its equal; `a < b`,
`<div>`, `Promise<Document>` and a Maven `<profile>` are untouched.
Language paragraph: none (`PK-LANG-06`, `v3Prompt.test.ts` grep). Math: frontend renders `\( \)` and
`\[ \]` (`markdownPlugins.ts` `normalizeMathDelimiters`, linear; the first regex version took 12.8 s
on the adversarial test and was replaced).

### Dormant rules (in the prompt, backing feature not built)

| Rule | Needs | Until |
|---|---|---|
| CI-1…CI-6 typed citations `[file:n]` `[web:n]` | typed source ids from the backend, validator | P15 / P16 |
| ST-9, HO-5 `<pending_operations>`; TO-4 status tool | job states, `get_operation_status` | P08 / P13 |
| FI-1, FI-5, FI-6 `<retrieval_status>`, typed `<documents>`, coverage | retrieval v2 | P20 |
| AU-1…AU-3 `<company_instructions>` | company tier | Phase 5 |
| ME-1 `<memory_docs>` prefetch; ME-6 sensitive opt-in | document memory prefetch, opt-in | Stage 11 work |
| SK-1 `load_skill` | skill loader (skills are read with `view` meanwhile) | Prompt 6 |
| PR-1 profile step limits | per-profile tool caps | P08 |

### P03 harness, updated on purpose

- **Offline C-gate:** P03 **8/28 fully met (28.6 %)**, requirements 19/44 → P07 **24/28 (85.7 %)**,
  requirements 39/44; over all 48 offline cases 34 gaps → 7. Of the 24, four (S1, S2, T16, CT1) are
  met by rule text whose backing feature is dormant (typed ids, coverage flags): **20/28 (71.4 %)**
  are met with the feature in place. Open, each needing a feature:
  S17/T11 pending operations (P08/P13), T11 status tool (Prompt 6/P08), A1–A4 company tier (Phase 5).
- Requirement patterns: twelve were literal legacy wording although written "from the rule"; each
  now also accepts the v3 wording, and three that matched a tag *named* in v3 prose
  (`<company_instructions`, `<pending_operations`, `<available_skills>`) now need the rendered block.
  New negative tests: every requirement fails on a blank prompt except the three absence checks;
  the tag checks ignore prose.
- **Race fixed** in `evals/prompt-kit/kit.ts`: the skill service was cached before it loaded, so
  cases built at once (the live runner's pool) could be sent without a skills list.
- Budgets (`promptBudgets.test.ts`, characters): Gemini stable 32,066 (was 42,503 legacy), Claude
  stable 43,070, Claude system 44,171, tools off 17,228 (was 24,874), tools 45,642 (unchanged).
  Stage target Gemini base ≈ 6.5k tokens + tools ≈ 2.2k: the base is 16,449 characters; its token
  count needs the provider (owner-run `measureTokens.ts`); the tool declarations (35 tools,
  45,642 characters) are well over ≈ 2.2k tokens whatever the count — Prompt 6.
- Live runner: builds each case on the model's own rendering (`buildCaseRun(c, now, provider)`),
  sends `turnPreamble` and the profile's effort, stamps each rendering's `promptVersion`
  (wiring tests in `promptKit.test.ts`; not run).
- Derived kit (`src/test/promptKit/cases.ts`): moved to v3. Live-only now (rule text gone with the
  legacy prompt, behaviour still wanted): PK-CTX-04, PK-USE-06, PK-FILE-05, PK-WEB-04. Removed:
  PK-LANG-01…03 (CXD-1). Added: PK-LANG-06.

### Snapshot diffs (one line each)

| Snapshot | Reason |
|---|---|
| golden 1–5 · gemini | system instruction = v3 stable text; session + per-turn state as the turn's first text part |
| golden 1–5 · claude | system = v3 stable + session state (second block); per-turn text block first in the user turn |
| golden long texts | the legacy prompt texts replaced by the v3 ones |
| characterization: Claude / Gemini adapter wire | same layout change on the wire |
| characterization: fake provider (11 scenarios) | `systemInstruction`, new `turnPreamble`, `promptAssembly` shape; Auto rule `default` → `auto_gemini`, considered list `[Gemini]` |
| characterization: chat with files | additionally: Auto no longer promotes an attachment to Opus (`attachments_present` → `auto_gemini`, Gemini) |
| characterization: turn-start refusals | Auto rule and resolved model (Opus → Gemini) |
| paths (1)–(14), (P), (R), (2) | layout; `(14)` `<profile>deep</profile>` from effort high; turn log line "system prompt" now `promptVersion` + block sizes |
| paths (15), (16) | turn log: `autoRule: auto_gemini; considered: ["Gemini 3.8 Flash"]` |
| paths (L) | turn log "system prompt" line and timing note `promptVersion` |
| long texts (both files) | v3 texts in, legacy texts out |

`turnSnapshot.ts` now normalises `<current_time>`; all three files pass three runs in a row.

## Part B — P10 Auto routing

| Rule (in order) | Stage source | Result |
|---|---|---|
| audio or video input | 7.9 / MR3 | Gemini |
| PDF > 600 pages or request > 30 MB | 7.9 Rules derived | Gemini |
| Claude switch off / limit reached | 7.9, RT-6, RT-8 (not built: single user) | Gemini |
| every other turn (chat, attachments, search, research, long prompt) | RT-1 | Gemini, rule `auto_gemini` |
| Gemini not available / cannot do the turn | Invariant 1 | `no_model_available`, `meta.reason: auto_model_unavailable`; never a Claude model |
| Manual Sonnet / Opus | 7.10 M1, Stage 18 | as picked (Opus manual only) |
| Effort per profile | RT-4 | unchanged (`effortFor`) |
| Chat keeps its model under Auto | stage silent | unchanged (ADR-0031 d4), **except Opus**: never kept by Auto (manual only; review r1) |

Removed: `chooseTier`, the tier shift, `grounded_economy`, `research_mode`, `attachments_present`,
`long_project_context`, `long_prompt`, and the config `AUTO_ROUTE_LONG_PROMPT_CHARS` /
`AUTO_ROUTE_LONG_CONTEXT_CHARS`. `routing.test.ts` rewritten (every need combination, list order,
no Claude fallback); `stickyModel.integration.test.ts` now picks Sonnet by name to show the keep rule.

`routingPreference`: Settings control removed (`Settings.tsx`, `api.ts`, three test fixtures; a test
asserts it is gone and failed on the old Settings); routing no longer reads it; `PATCH
/v1/usage/limits` accepts any string ≤ 32 and ignores it ("Deprecated, no effect", OpenAPI); removed
from the `/usage/limits` and `/preferences` responses; the column stays (DEFERRED: drop column + field).

**Silent substitution (Invariant 1) — gap, not changed:** `backend/src/services/turn/modelRouting.ts:56`
— a manually picked model that is disabled or unavailable is replaced by Auto (Gemini) with a log
line only; the answer's routing says `auto_gemini`, with no machine-readable fallback reason or
"Answered by X because Y was unavailable" label. DEFERRED to P11 (Prompt 5).

## Items for the owner

1. **Past chats vs LM-1.** v3 says "You can't see the user's other chats"; ArcNave has past-chat
   tools (user setting, ADR-0052). The appendix keeps their usage rules but lost the sentence that
   overrode LM-1. Decide: keep the tools (and accept the contradiction until a stage doc-sync), or
   turn them off.
2. **Provider name in the Gemini rendering** ("Google Search grounding results are linked by the
   app"): text sent only to Gemini, about Gemini's own tool — read as allowed by Invariant 7; the
   brand guard passes. Flagged only.
3. **`<model_info name>`** names the serving model (ID-2) in every request; the brand check of the
   derived kit exempts that one tag.
4. **Gemini knowledge cutoff** unverified (Google pages unreachable from the sandbox); Stage 7.9 says
   Mar 2026. Confirm from the Vertex model page and set `knowledgeCutoff` in `capabilitiesTable.ts`.
5. **skill_loader** is `off` (no `load_skill`); the appendix tells the model to view a skill's
   SKILL.md and says that file is the skill body. If the live run shows skills skipped, mapping
   `load_skill → view` (and the flag on) is a one-line change.
6. Sticky Auto can keep Sonnet (picked by name, or by the old Auto's `long_prompt` rule); Opus is no
   longer kept (stage silent on the rest).
7. **Time zone:** `<current_time>` is IST for everyone (stage TI-1); the old date line used the
   user's Settings zone.
8. **Gemini cost:** project files and memory now ride in the turn, not the cacheable system
   instruction (stage layout, doc-sync 2026-10-05), so a large project chat pays them uncached each
   turn. Measure in the live run.

## Review (ADR-0068)

Reviewers: a fresh **Opus 5.5** read-only reviewer (the ten questions of the brief: v3 drift, tool
map, undeclared tools, cache layout, Stage 7, lost behaviour, escaping, invariants, tests, math),
`/code-review` (high) and `/security-review`. Round 1 on `d7b5797`.

- **Opus reviewer:** 0 BLOCKER, 5 MAJOR, 12 MINOR. v3 drift clean (only the four map lines), cache
  layout correct, no new silent substitution. Fixed: M1 `memory_delete` deletes a whole file here
  (a "forget" would have lost /profile.md) → appendix line; M2 skills read with `view` were untrusted
  data under v3's load_skill rule → appendix line; M4 Auto kept Opus for chats the old Auto had
  promoted → Opus never kept (test, mutation-proved); M5 escaped brackets `\[1\]`, `- \[ \]` and a
  pair across paragraphs became display math → paragraph limit, math signal, inline form inside a
  line (tests, linear). Not changed: M3 past chats vs LM-1 (owner item 1; v3 wins per the brief).
  Minors fixed: formats list (+jsx, svg, mermaid), flag ↔ tool line, misleading routing log and
  error text (no env-var names), double JSDoc blocks, CRLF restored on five files, IST time zone and
  version scope recorded in ADR-0075, C-gate figure split (20/28 feature-backed). Minors left, with
  reason (DEFERRED): `$5 … \(x\)` pairing, `\\)` before a closer, indented code, Gemini project
  files uncached (stage layout), the runner-source grep test (the runner cannot run in tests).
- **`/code-review`:** 10 findings, overlapping the above; also fixed: the user's message could forge
  a session block in the same Gemini turn → reserved tags neutralised in the message and history;
  the compaction summary had no explanation → legacy compaction policy carried; the "Use the
  computer" sentence went out without the computer → split; offline gates could pass on the case's
  own text → rules read from the stable text only, state checks from rendered blocks only (negative
  test). Left: time zone (stage), Gemini cache cost (stage), past chats (owner).
- **`/security-review`:** no finding at confidence ≥ 8 (prompt-file path fixed, no cross-user data
  path, no new log of user text, KaTeX `trust` off, `routingPreference` ignored and not stored).
- **Round 2** (a fresh Opus 5.5 reviewer on the round-1 fixes): 0 BLOCKER, 3 MAJOR, 4 MINOR, all
  fixed. M1 the inline display-math join (`/\s*\n\s*/g`) was quadratic on a long run of spaces →
  split and trim (adversarial test; the old line took 5.5 s, mutation-proved). M2 the reserved-tag
  neutraliser matched any case and generic names, changing pasted code (`Promise<Document>`, a Maven
  `<profile>`) → distinctive names only, case-sensitive (`reservedTags.ts`). M3 file text (extracted,
  decoded, PDF page text) reached the turn un-neutralised → neutralised in `attachmentText` and both
  adapters' page text (tests on both providers, mutation-proved); fullwidth / small-form `<` and
  invisible characters are covered. Also: the `capability_tools` appendix line was sent on every
  turn and named undeclared tools (a real `projectKnowledge` test failure) → removed; the compaction
  clause "make reasonable assumptions" cut (v3 honesty). Minors: a bare-minus body (`\[ x - y \]`)
  is math (plain-bracket test inverted), line start carried after a code span and a hard line break,
  CRLF paragraph breaks. Limits accepted (DEFERRED): uppercase variants and `<profile>` not
  neutralised.
- **Round 3** (a fresh Opus 5.5 reviewer on the round-2 fixes): 0 BLOCKER, 2 MAJOR, 4 MINOR, 1 NIT,
  all fixed. M1 the neutraliser was quadratic on `<` + a run of U+FEFF (two overlapping classes in
  a row; 3 s at 40k) → one gap class on each side of `/` (linear test over every gap character,
  120 s on the old pattern, mutation-proved). M2 file text could close Gemini's `<document>`
  wrapper (round 2 had dropped `document` from the list) → `neutraliseDocumentText` in the wrapper,
  any case (test, mutation-proved). Minors: the forced answer's `<this_turn_tool_steps>` carried
  tool output un-neutralised → neutralised (test, mutation-proved); `</` + zero-width, soft hyphen
  and `‹` now covered; a hard line break before `\[ … \]` keeps it inline (the round-2 change
  showed a stray `\`); bracketed prose in any script (`\[Recipient's Name\]`, `\[குறிப்பு\]`,
  `\[see: docs\](url)`) stays text (Unicode letters, prose punctuation, in-word hyphen).
- Rounds: 3 of 3 (open BLOCKER / MAJOR: 0 fixable here; round-1 M3 past chats with the owner).

## Gates

Final sequential run on the committed code (round-3 tree; only this section was written after it),
one gate at a time, nothing edited while a gate ran:

| Gate | Result |
|---|---|
| backend `npx tsc --noEmit` | clean |
| backend `npx vitest run` | 146 files passed; 1,643 passed, 23 skipped (P03 baseline on `7cd294b`: 1,635 passed, 19 skipped; the difference is the deleted legacy-builder tests and the new v3, routing, neutraliser and math tests, per file in the commit) |
| frontend `npx tsc -b` | clean |
| frontend `npx vite build` | built (chunk-size warning only, as before) |
| frontend `npx vitest run` | 44 files, 420 passed |
| `npm run openapi` | regenerated; no diff after rounds 2 and 3 (`routingPreference` described "Deprecated, no effect"; gone from responses) |
| `npm run eval:prompt` without `LIVE` | refuses ("Refusing to run: … only when LIVE=1") |
| snapshots | golden + characterization (48 tests) pass on three consecutive runs |
| mutation proofs | drift byte change, map target change, `fetch_url` always on, old Settings, Opus keep rule, old quadratic math join (5.5 s), file text not neutralised (3 tests), the round-2 reserved-tag pattern (FEFF, 120 s), `</document>` in Gemini file text, forced-answer tool steps — each fails, then passes restored |

Not run: the live eval and the live checklist (owner-run, they spend provider quota), CI (runs on
the push).
