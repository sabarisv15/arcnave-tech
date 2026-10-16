# D2 — AI output quality: why the owner sees "very poor" answers

Sources read: `backend/src/services/{systemPrompt,styles,generation,answerProtocolGuard}.ts` (generation.ts all 2 381
lines), `services/promptCache/*`, `services/memory/policy.ts`, `services/compaction/*`, `services/ui/policy.ts`,
`services/history/toolHistory.ts`, `services/routing/turnRouter.ts`, `services/attachments/{manifest,modelLimits}.ts`,
`services/{skills,retrieval}.ts` (parts), `providers/{anthropic,gemini,types,capabilitiesTable,registry,routing,toolLoopPolicy,contextEditing,attachmentContent,grounding}.ts`,
`tools/{definitions,displayDefinitions,registry,catalog}.ts`, `config.ts`, `config/numbers.ts`, `test/promptKit/*`,
`test/behaviorEvaluation.test.ts`, `mistakes.md` (all), `docs/checkpoints/CURRENT.md` (lines 1-930 in full, rest by heading),
ADR 0019, 0022, 0023, 0027, 0031, 0032, 0043, 0049, 0052, 0053, `docs/audits/2026-09-26-intelligence-latency-audit.md`,
Stage 6 (checkpoint with all doc-syncs, `06-context-assembly`, `06-policy-spec-v3`, `06-system-prompt-v3-gemini`, v3-claude by
grep), Stage 7 (checkpoint with all doc-syncs, `07-model-routing`), Stage 13 checkpoint, build plan `00-build-plan-arcnave-tech.md`,
`D:\Architecture\...\06-eval-cases-v1.json` and `history\` (v0, v1, v2, v2.1), port source `arcnave.in:backend/packages/gateway`
(gemini.py, claude.py, by grep). Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Paths are relative to `D:\arcnave-tech`.

Method and limits: static trace only, no provider call, no test run (the auditor tools are Read/Grep/Glob/Write).
`.env.example` and `backend/.env.example` were permission-denied, so the live values of `ENABLE_*`, `PRICING_TABLE`, `TOOL_MAX_ROUNDS`
are unconfirmed. Sizes below are my estimates from reading the text (±25 %), marked "approx". No turn log or database was available,
so every "Hypothesis" in §4 is unproven until its confirm step is run. The reference handbook
(`claude-managed-agents-handbook.pdf`) is absent; nothing here uses or proposes its patterns. Patterns that are my own are marked "ours".
No hosted agent service is proposed.

## 1. Summary verdict

The plumbing around the model is mostly sound: no `temperature`/`top_p`/`top_k` anywhere (grep, `backend/src` non-test), SDK retries off
(`anthropic.ts:51`), explicit effort on every request (`anthropic.ts:490`, `gemini.ts:440-443`), thought signatures handled, usage summed per
round, forced final answer carries the tool steps (`generation.ts:1108-1118`). The weak points are in what the model is told and
what it is given:

1. **One oversized, Claude-app-shaped prompt is sent to every model, including the default Gemini 3.8 Flash.** Approx 85 k chars of system
   text plus ~45 k chars of 35 tool declarations (≈ 30 k tokens before the first user word, full config) against a locked Stage 6
   budget of ≈ 6.5 k + 2.2 k tokens (`00-checkpoint-stage6.md:51`). Stage 6 CXD-3b locked two per-model renderings; the Gemini one puts 12
   critical rules first and says "give complete, well-explained answers… not terse notes" (`06-system-prompt-v3-gemini.md:23-44,73-75`).
   The repo has neither, and says the opposite: "Be concise by default", "give a high-level explanation", "answer in prose" (`systemPrompt.ts:66,69`).
   That line was in every earlier prompt version (v1:317, v2:352, v2.1:390) and is the target of locked eval case S18 ("Gemini terse check").
2. **Auto sends nearly everything to Gemini 3.8 Flash and then pins the chat there** (`routing.ts:76`, `generation.ts:1306-1319`). Code, document
   and agentic work is where Stage 7 §7.9 shows the largest gap to Sonnet (Terminal-Bench 19.1 % vs 70.6 %). Stage 7 RT-3/MR16 (complex work to
   Sonnet) and the Fast/Normal/Deep profiles (PR-1, RT-4) are not built.
3. **Context handling has two live defects.** (a) ADR-0023 says tool results are never cleared; ADR-0031 §5 re-added clearing for Gemini and it is
   live (`gemini.ts:382-408`, `config.ts:158-160`) — the exact failure in mistakes.md 2026-09-25. (b) `loadHistory` is called with the *requested*
   alias, which is `Auto` by default, so the window falls back to 128 000 and the history budget is ≈ 463 k chars, silently dropping the oldest turns with no
   summary (`generation.ts:445-450,1562-1577`, `capabilitiesTable.ts:128-144`), while compaction waits for 967 k tokens (`autoCompact.ts:41-51`).
4. **Nothing measures answer quality.** The repo's prompt kit is 89 derived cases: 70 are `toContain` string checks on the repo's own text and 19 are
   skipped as "live only" (`test/promptKit/cases.ts:1-20`); the 68 behavioural Stage 6 cases (readable in `D:\Architecture`, not in the mirror) run nowhere, and
   the prompt-size test bound was raised twice to ≈ 10 000 tokens (`behaviorEvaluation.test.ts:32-47`). Stage 13 validators are mostly absent.

Counts (§3, 45 rows): 9 High, 20 Medium, 14 Low, 2 KEEP with no gap. Primary buckets: REWRITE 24, NEW-BUILD 11, owner question 5, KEEP 4, DIFF 1.
Eight ranked hypotheses are in §4; the first three explain most of "very poor" if the poor turns ran on Gemini Flash through Auto. The cheapest first step
is not code: read the turn logs of five poor answers (`GET /v1/chats/:id/messages/:messageId/log`) and pin one chat to Sonnet 5.5 for a day (§4).

## 2. Request anatomy per provider (one turn)

Built in `GenerationService.runTurn` (`generation.ts:414-861`) and sent by the adapters. Sizes approx; the live number is the turn log's
"system prompt" stage (`generation.ts:673-678`, `characters` and per-part lengths).

### 2.1 Common to both providers (the same strings go to both)

| # | What | Where built | Approx size |
|---|---|---|---|
| S1 | **Stable prefix**, in this order: static base (17 blocks) → `memory_policy` (only if `memory_read` allowed) → `past_chats_policy` (if `conversation_search`) → `compaction_policy` (always) → `visuals` (if `show_widget`) | `promptAssembly.ts:26-55` (31-41); base `systemPrompt.ts:24-166` | base ≈ 36 k chars (≈ 9 k tok): identity 32-34, core_behavior 36-48, truthfulness 50-57, communication 59-72 (≈ 6 k), trust_boundaries 74-79, safety 81-92 (≈ 6 k), wellbeing 94-100 (≈ 4.5 k), evenhandedness 102-104, tool_use 106-114, professional_deliverables 116-125, source_transformation 127-130, agent_behavior 132-135, mistakes 137-139, knowledge 141-145, user_preferences 147-156, permissions 158-160, final_response 162-164. Memory policy ≈ 15 k (`memory/policy.ts:11-70`), past-chats ≈ 5 k (73-81), compaction 0.6 k, visuals ≈ 3 k. Stable total ≈ 60 k chars (≈ 15 k tok) full set, ≈ 37 k (≈ 9 k tok) for a turn with only `ask_user_input_v0` |
| S2 | **Dynamic suffix**, in this order: date line (+ mobile line) → `<arcNave_capabilities>` (+ `<computer_use>` with Skills/The computer/Creating files/Artifacts, + `<files>`, + `<research>` + `<web>`) → `<standing_preferences>` → `<project_instructions>` → `<style_instructions>` → `<memory>` (listing, profile, preferences) → `<conversation_compaction>` → project files (whole, **unwrapped**) or `<project_knowledge>` stub → mode directive (**unwrapped**) → `<skills_guidance>` (`<available_skills>` + re-injected skills) | `promptAssembly.ts:71-132` (81-123); runtime text `systemPrompt.ts:368-450`; project files `generation.ts:1954-2011`; mode `2013-2021` | capabilities ≈ 1 k; computer_use ≈ 14 k (guidance ≈ 8 k + artifacts ≈ 6 k, 180-243); files ≈ 2.5 k; research+web ≈ 9 k with search on (258-361); skills list ≈ 3 k (8 skills). User-controlled: standing prefs ≤ 20 000 chars (`preferences.ts:87`), project instructions ≤ 20 000 (`projects.ts:181`), style instructions no max (`styles.ts:109`), memory listing/profile/preferences ≤ 8 000 each (`config.ts:307`, `memoryService.ts:459-464`), project files whole up to 200 000 chars (`config.ts:171`), summary up to the 64 000-token output |
| S3 | **Tools**: the registry declares every allowed tool every turn, no discovery: `ask_user_input_v0`, 6 memory, 3 past-chat, `read_me` + `show_widget` + 13 display cards, 3 web, 5 computer, 2 project = 35 | `tools/registry.ts:50-63`, `turnRouter.ts:39-67`, `generation.ts:569-602` | ≈ 45 k chars (≈ 11 k tok); display cards alone ≈ 22 k (`displayDefinitions.ts`) |
| S4 | **History**: every message since the last compaction, oldest first, assistant tool calls with full results, PDF page images/text, Office text or "read from file" pointer; no turn cap, character backstop only | `generation.ts:1511-1656`; tool calls `history/toolHistory.ts:20-49`; backstop `1560-1577` | unbounded below ≈ 463 k chars under `Auto`, ≈ 4.1 M chars when the alias is pinned |
| S5 | **Current user turn**: this turn's attachments (pages as label + image + page text; text docs; Office pointers), then `<available_attachments>` manifest, then the user's prompt last | `generation.ts:829-832`; manifest `attachments/manifest.ts:68-85` | prompt ≤ 100 000 chars (`chats.ts:543`) |
| S6 | **Params**: `maxOutputTokens` = min(pref 64 000, 128 000, model cap); effort = request > pref > `REASONING_EFFORT` medium, clamped per model; no sampling parameters | `generation.ts:679-689`; `capabilitiesTable.ts:151-157` | — |

Total fixed preamble (S1-S3), full config: ≈ 130 k chars ≈ 33 k tokens (range 25-40 k). Minimal turn (tools on, nothing else): ≈ 40 k chars ≈ 10 k tokens.
Stage 6 locked: base ≈ 6.5 k tokens + tools ≈ 2.2 k (`00-checkpoint-stage6.md:51`). Repo ratio ≈ 3.5×. History in the repo's own test bound allows 10 000 estimated
tokens for the prompt text alone (`behaviorEvaluation.test.ts:43`), up from 3 500-4 500.

### 2.2 Gemini 3.8 Flash (`providers/gemini.ts`)

1. `systemInstruction` = S1+S2 as **one string** (`gemini.ts:420`); on the last allowed round `FINAL_ROUND_NOTE` is appended (`405-407`).
2. `tools` = `[googleSearch]` (if grounded) + `[codeExecution]` (if enabled) + `[{functionDeclarations: 35}]` built from `parametersJsonSchema` clones (`422-432`, `89-95`).
3. `toolConfig`: `mode NONE` on the forced-answer round, else `streamFunctionCallArguments: true` (`433-437`).
4. `thinkingConfig {includeThoughts: true, thinkingLevel: LOW|MEDIUM|HIGH}`; `maxOutputTokens` 64 000; timeout 600 s (`438-447`).
5. `contents`: history → each earlier assistant turn's calls as **signed** `functionCall` + `functionResponse` groups when the first call carries a signature, else the whole turn's calls as prose text inside the assistant message (`182-209`, `types.ts:132-147`); PDF pages as label + `fileData gs://` (bucket set) or `inlineData` + page text (`38-55`); text documents as `<document filename="…">` (`74`, filename unescaped).
6. In-turn loop adds `{model: text+calls}` / `{user: responses}` per round; thought text and non-call signatures are not replayed (`537-566`). **Function results older than the last 3 are replaced by a placeholder once the previous request was ≥ 100 000 tokens** (`381-408`, `contextEditing.ts:11-36`).
7. Cache: implicit only (`156-160`).

### 2.3 Claude Sonnet 5.5 / Opus 5.5 (`providers/anthropic.ts`)

1. `system` = two blocks: stable prefix with `cache_control: ephemeral`, then the dynamic suffix uncached (`441-464`); one string if caching is off.
2. `tools` = `web_search_20260209` (`max_uses 5`, only when grounded) + 35 custom tools (`473-476`, `38`); `tool_choice` `auto`, or `none` on the last round with tools still declared (`478-479`).
3. `thinking {type: adaptive, display: summarized}`, `output_config {effort}`, `max_tokens` 64 000 (`484-490`).
4. `messages`: history with `tool_use`/`tool_result` pairs, ids renamed `hist_t_i` (`318-327`); PDF pages as text label + image + page text (`237-251`); text docs as `document` blocks (`284-293`); current turn = media blocks then text; a second cache breakpoint on the message before the newest (`369-376`); consecutive same-role messages merged (`347-364`).
5. In-turn loop returns `final.content` (thinking blocks included) unchanged (`583`); parallel results in one user message (`585-620`); a duplicate failed call is refused with a canned note (`595-609`, **Gemini has no equivalent**). No context-editing, no compaction beta (consistent with the forbidden-pattern list).
6. Not replayed across turns: thinking blocks (only `messages.thinking` text is stored, no signature).

### 2.4 Differences that matter for quality

| Topic | Gemini | Claude |
|---|---|---|
| Result clearing in history | yes, ≥ 100 k tokens, keep 3, batches of 5 (`gemini.ts:408`) | none |
| Duplicate failed-call guard | none | yes (`anthropic.ts:595`) |
| Page images | `gs://` URI when `MODEL_INPUT_BUCKET` set (ADR-0016) | base64 only |
| Forced answer | `mode NONE` + system note | `tool_choice none` |
| Cache | implicit; Stage 6 explicit-cache layout not built | explicit breakpoints on system + penultimate message |
| Search | `googleSearch` beside functions; sources from `groundingSupports` | server `web_search`; sources from result blocks, no span-to-claim mapping |
| Thinking | summaries on, thinkingLevel only | summarized, adaptive; cross-turn blocks dropped |
| Default pick | Auto's default and sticky choice | only `long_prompt` (> 2 000 chars), attachments on a chat's first turn, or manual |

## 3. Findings vs Stage 6 / 7 / 13 locked ids

Severity H = plausibly explains poor output or breaks a C-priority rule; M = real conformance or quality gap; L = minor or cosmetic.
Bucket: R = REWRITE, N = NEW-BUILD, K = KEEP, D = DIFF-STACK/INFRA, Q = owner question (do not resolve).
Doc-sync check: where a later block replaces an older line it is named; superseded lines are marked.

### 3.1 Stage 6 (context + prompt)

| Id | Locked decision | Repo evidence | Gap | Bkt | Sev |
|---|---|---|---|---|---|
| CXD-3b | One policy spec → Claude and Gemini renderings (`06-context-assembly.md:59`) | one builder for all providers: `systemPrompt.ts:24-166`, `promptAssembly.ts:26-55`; both adapters take the same string (`gemini.ts:420`, `anthropic.ts:449`); no `prompts/system/v3` | No per-model rendering; port source has the text and sha256 version stamp (`arcnave.in:prompts/system/v3/{gemini,claude}.md`, doc-sync 2026-10-10) | N/Q | H |
| GEM-1 | Gemini: 12 critical rules first (`06-system-prompt-v3-gemini.md:23-44`; Google guidance, CG2) | opens with identity + `core_behavior` (`systemPrompt.ts:32-48`); the first prohibitions (`truthfulness`) start after ≈ 3 k chars, `safety` after ≈ 11 k | Critical rules not first; none of the 12 rule texts (AI disclosure, precedence, capabilities-on-only, ask-for-essentials, decline list) as a block | R | H |
| ST-2 / S18 | "Give complete, well-explained answers… not terse notes" (v3-gemini:73-75; also v1:317, v2:352, v2.1:390); eval S18 "Gemini terse check", fail_if "only 2-3 terse lines" | opposite wording: "Be concise by default", "give a high-level explanation unless the user asks for depth", "A simple question can take a few sentences" (`systemPrompt.ts:66`); "answer in prose… casual reply a few sentences" (69); "After your last tool call, give the answer… in one or two sentences" (111) | Line removed in every version since v2.1; reverse directive for a model the lock calls terse by default | R | H |
| ST-7 (C) | Ask only for missing essentials, bundled; never assume facts/names/amounts/recipients (spec:48; evals Y3, S10) | "Make routine judgment calls yourself, and check in only when different readings… materially different work" (`systemPrompt.ts:44`); "address the most likely reading first, then ask" (42); `ask_user_input_v0` says "proceed and state any assumption inline" (`definitions.ts:529`) | A critical rule contradicted for facts, names, amounts | R | H |
| ST-3 | Flat lists only; many items with attributes → table (spec:44; evals S15, Y2) | "Use a table when a comparison reads better as one" (`systemPrompt.ts:69`); no flat-list rule | Nested bullets not forbidden | R | L |
| ST-4 | Math as `\( \)` / `\[ \]`; `$` fails eval S16 | prompt tells the model the chat renders `$$…$$` (`systemPrompt.ts:391`); frontend uses remark-math (CURRENT.md:449) | Delimiter differs from the lock; frontend and lock disagree | Q | L |
| ID-1/ID-2 | AI disclosure; model name only from `<model_info>` (spec:28-29; eval S4) | none: the identity line says "AI workspace assistant" (`systemPrompt.ts:32`) but there is no rule to say so when asked or to avoid implying human authorship, and no model_info; cutoff deliberately unstated (`systemPrompt.ts:142-145`, PK-HON-09) | Stage 7 §7.9 has cutoffs (Gemini Mar 2026, Claude Jun 2026) and TI-2 wants them | N | M |
| CXD-1 | Language section removed (user, 2 Oct) | language paragraph + "restate at end of thinking" (`systemPrompt.ts:63-65`), tests PK-LANG-01..03; mistakes.md:1228-1236 records add/remove/re-add | Locked removal vs live fix for Tanglish→Tamil (ADR-0043/0049) | Q | M |
| AU-1…4, UC-1 | Precedence ArcNave > company > project > user; user text escaped; untrusted text never on the system side (spec:31-38; CG11) | `wrapTag` escapes the wrapper's own close tag (`promptAssembly.ts:63-66`, K); precedence prose vague (`systemPrompt.ts:75`); **project files and the mode text are appended raw** (`promptAssembly.ts:109-111,117-119`; `retrieval.ts:638-643` no tag, no escape); project instructions cap 20 000 vs ≤ 5 000; style instructions no cap | Untrusted document text sits on the system layer with no wrapper | R | M |
| LAY-1 | Documents → memory → question last; per-turn blocks outside the cached base (spec:151; CG3) | documents, memory, summary all in the system string (`promptAssembly.ts:101-111`); user turn = manifest + prompt (`generation.ts:829-832`); Gemini explicit-cache layout (doc-sync 2026-10-05) not built (implicit, `gemini.ts:156`) | Placement differs; explicit-cache part is DIFF-INFRA (Python gateway turned it off, checkpoint:64,68) | R/D | M |
| CXD-4 | Whole file ≤ ~30 k tokens, else retrieval; D1 tunes | whole while total ≤ 200 000 chars (`config.ts:171`, ≈ 50 k tok), BM25 search above (`definitions.ts:11-34`) | Different threshold; BM25-only (Stage 12 hybrid not built) | K/R | L |
| CXD-5 / N-16 | Summary at > 60 % of the profile history budget; last 6 turns verbatim | compaction at window − 33 k (≈ 967 k, `autoCompact.ts:41-51`), last 2 turns kept (36) | Effectively never compacts below 900 k tokens; build plan lists "0058 compaction kept" | Q | H |
| CXD-6 / N-03 | Input budget Fast 16 k / Normal 48 k / Deep 200 k (register:8) | none; history budget = window − 12 288 tokens, ×4 chars (`generation.ts:1560-1566`), **window = 128 000 fallback under `Auto`** (`capabilitiesTable.ts:128-144`) | Oldest turns dropped silently at ≈ 463 k chars with no summary (`generation.ts:1570-1577`) | R | H |
| CXD-9/10, CI-1…6 | Typed citations `[file:n]`/`[web:n]`; native search citations attached by the app | no typed ids; Gemini sources panel (`grounding.ts:137-144`); Claude: result list only (`anthropic.ts:556`) | No inline citation, no id check (Stage 13 RP-3 depends) | N | M |
| FI-1/5/6 | `coverage`, `<retrieval_status>`, "already provided", "[source deleted]" | not found (searched `retrieval_status|coverage` in `backend/src`, non-test) | Stage 12 flags absent | N | M |
| TI-1 | `<current_time>` IST ISO per turn | date only in the user's zone (`systemPrompt.ts:277-295`); zone defaults to UTC (`schema.ts:105`, `Settings.tsx:855`) | No time of day; IST users see UTC date until Settings is set | R | L |
| PR-1 / RT-4 | Fast/Normal/Deep: brief ≤ 1 tool / balanced / split+check; effort low/medium/high | no profile; one effort (medium), 16 rounds, 64 000 tokens for everyone (`numbers.ts:41,43`, `config.ts:166`) | Register N-06 Normal 5 / Deep 15 (register:11), N-74 per-profile ceilings (register, quoted at `numbers.ts:41`) | N | M |
| HO-4 / FI-2 | Data via code, not by eye (S) | "A fact you read, count or transcribe there needs no tool to confirm it" (`systemPrompt.ts:53`), uploaded-files guidance (176); PK-USE-04 asserts the absence | ADR-0049 chose by-eye for pages in view (live: 48/277/325 right) | Q | M |
| SA-2, PT-3, PT-4, WB-1 | India set: Tele-MANAS 14416, 112, SEBI adviser, ECI AI-label, private-individual profiling, fake records, phishing | `grep` for `Tele-MANAS|14416|SEBI|Election Commission|phishing` in `backend/src/services`: none (only Aadhaar in `memory/privacy.ts`) | Safety text is the Claude-app set (`systemPrompt.ts:81-100`), not the locked India rules | R | M |
| ME-* | Memory rules ME-1…10 | far larger policy (`memory/policy.ts`), saved in-turn; listing on system side (K) | Covered by the memory deep-dive; here only its cost: ≈ 15 k chars every memory turn | K | L |

### 3.2 Stage 7 (routing, roles, parameters)

| Id | Locked decision | Repo evidence | Gap | Bkt | Sev |
|---|---|---|---|---|---|
| RT-1 / MR1 | Auto = rules → Gemini 3.8 Flash; Opus never default (Stage 18, §7.10 M1) | `routing.ts:47-77`: attachments → quality tier = Opus 5.5 (67-69); project instructions > 8 000 chars → Opus (70-72); the `research_mode` rule is unreachable (grounding rule first, 61-66); default Gemini (76) | Opus is chosen by rule; one dead rule | R | M |
| RT-3 / MR16 | Complex work (coding, artifact building, multi-file analysis) → Sonnet when allowed; Deep → Opus | not found (searched `routeAuto` callers: `generation.ts:1320` only; no complexity input) | Sonnet only via manual pick or a prompt > 2 000 chars; ADR-0032 forbids prompt keywords, so a mechanism is needed (profile or Haiku router) | N | H |
| RT-4 / CR1 | Effort per profile, always explicit | explicit and clamped (K): `anthropic.ts:490`, `gemini.ts:442`, `capabilitiesTable.ts:151-157` | no profile (see PR-1) | K | — |
| §7.9 params | Thinking: Gemini LOW/MEDIUM/HIGH; Claude adaptive + effort; no sampling params | K: `gemini.ts:255-259`, `anthropic.ts:488-490`; no temperature/top_p/top_k in `backend/src` | none | K | — |
| Doc-sync 2026-10-10 | Claude `display` stays default (omitted), Gemini `include_thoughts` off until Stage 14 | `display: summarized`, `includeThoughts: true` (`anthropic.ts:488`, `gemini.ts:441`) | Product choice, no quality effect; ADR-0030 | D | L |
| RT-6 / §7.12 | ≤ 2 retries then fallback: Gemini → Sonnet, Sonnet → Gemini, Opus → Sonnet → Gemini; label every fallback | retries K (`generation.ts:1367-1453`); "there is no other model to fall back to" (1358) | No fallback hop; the Claude-switch/limit parts are owner-deferred | N | M |
| RT-9 / §7.10 | Role registry M1-M11 with version stamped per turn (L4-G48) | aliases only (`registry.ts:54-91`); no helper roles; compaction uses the turn's own model (`generation.ts:1691`) | Haiku 5.5 router/jobs (ADR-0013/0014) absent; build-plan B-4 says three models | Q | M |
| Numbers | N-06 Normal 5 / Deep 15 steps; N-09 ~8 k tokens; N-74 per-profile output | repo 16 rounds (`numbers.ts:43`), 6 000 chars (45), 64 000 tokens (41) | read cap ≈ 1.5 k tokens vs ≈ 8 k; flat limits | R | L |
| CC4 / MR10 | Claude history byte-identical, thinking kept unless an earlier part is edited | thinking not stored with signatures (`schema` `messages.thinking` text only); not replayed (`anthropic.ts:313-338`) | Reasoning continuity across turns lost | R | L |

### 3.3 Stage 13 (output validation)

| Id | Locked decision | Repo evidence | Gap | Bkt | Sev |
|---|---|---|---|---|---|
| RP-1 / VD-10 | Live cheap checks: provider signals, canary/secret/internal-tag scan | `AnswerProtocolGuard` blocks `[Tool call]`, `[Result]`, `[Error]` outside code with a hard `tool_protocol_in_text` error (`answerProtocolGuard.ts:22-27`) | No canary/secret scan; a legitimate "[Error]" in prose fails the turn | R | L |
| VD-3 | Truncation: one auto-continue (Normal/Deep) else notice + Continue | `finishReason` stored (`generation.ts:2152`); UI shows a cut-off notice (mistakes.md:554); no server continue | Auto-continue absent | N | M |
| VD-1/2, CI-2 | Async claim-support judge; annotate low support | not found (searched `claim|judge|groundedness` in `backend/src`, non-test) | Absent | N | M |
| VD-6 | Deterministic completion check; one more step if missing | only the empty-reply fallback (`generation.ts:1102-1165`) | Promised-vs-delivered check absent | N | M |
| VD-7 | Artifact gate: reopen + render + recalc scan | structural reopen of pdf/xlsx/docx/pptx in `present_files` (`codeExecutionExecutor.ts:521-535`) | No render test or recalc/error scan | R | M |
| VD-8/9/11/12 | Number reconciliation, language log, 10 % sampling, per-profile budgets | not found | Absent | N | L |

### 3.4 Repo-internal contradictions found on the way

| Id | Evidence | Gap | Bkt | Sev |
|---|---|---|---|---|
| X-1 | ADR-0023 "No context editing… `CONTEXT_EDIT_*` removed" vs ADR-0031 §5 + `gemini.ts:382-408`, `config.ts:158-160`; the toolHistory integration test uses a FakeProvider, not the Gemini loop (`toolHistory.integration.test.ts:142`) | The rule from mistakes.md:621-636 is broken on the default model | R | H |
| X-2 | `loadHistory(…, input.modelAlias)` before model resolution (`generation.ts:445-450`; again 556) | `Auto` → 128 000 window → ≈ 463 k char backstop on a 1 M model | R | H |
| X-3 | Failed/blocked exchanges stay in history: no status filter (`generation.ts:1524-1552`); an empty answer becomes the literal turn "[Response stopped]" | Stage 6 doc-sync 2026-10-11 R-3 drops blocked exchanges; here a refusal or error becomes few-shot context | R | M |
| X-4 | Non-native tool history is written as prose in the assistant turn (`types.ts:132-147`, `gemini.ts:206`, `anthropic.ts:328-329`); ADR-0043:26-30 says leaked protocol text was seen live, cause "plausible" only | Contaminates the model's own voice; the guard turns a leak into a failed turn | R | M |
| X-5 | Prompt budget test raised to ≤ 10 000 est. tokens / 7 500 words (`behaviorEvaluation.test.ts:32-47`); ADR-0031 cut to 23 500 chars, ADR-0052 grew it back | The guard no longer guards | R | M |
| X-6 | Live scripts target `claude-sonnet-5` and the old builder (`runBehaviorEvaluation.ts:3-20,256-268`, `measureStablePrefixTokens.ts:104`; the latter also holds a hard-coded project-id fallback, not reproduced here) and list removed tools (`read_uploaded_file`) | No working live eval | R | M |
| X-7 | `describeMedia` sets no output cap and ignores the finish reason (`gemini.ts:314-329`); scanned PDFs are OCR'd in one call (`retrieval.ts:165-180`) | Silent truncation of OCR text feeding project search | R | L |
| X-8 | Research directive demands a report with citations in chat (`generation.ts:2016`) vs "answers in chat… do not use report-style headers" (`systemPrompt.ts:69`; CURRENT.md:65-66 records the conflict) | Two instructions for one turn; Research runs on the cheap tier (`routing.ts:61-63`) | R | L |
| X-9 | Gemini `<document filename="${a.filename}">` not escaped (`gemini.ts:74`) | Filename text enters the prompt as markup | R | L |
| X-10 | Duplicate failed-call guard only in the Claude adapter (`anthropic.ts:595`) | Gemini can loop on the same failing call until round 16 | R | L |

## 4. Ranked root-cause hypotheses

All are Hypotheses: no turn log was available. Ranking = my estimate of likelihood × breadth. "Confirm" is cheap and either offline or a read of
existing records.

### H1 — Hypothesis: the universal Claude-app-shaped prompt and 35-tool surface fit Gemini 3.8 Flash badly (default model)

- For: ≈ 30 k tokens of fixed preamble vs 8.7 k locked (§2.1); ADR-0031 §7 had cut the prompt to 23 500 chars, and ADR-0032 cites Gemini 3 guidance that it "may over-analyze verbose or overly complex prompt engineering" (§What the references say); ADR-0052 then added, by my estimate, ≈ 15 k chars of safety/wellbeing/tone, ≈ 8 k of memory and ≈ 6 k of search rules; the size test was loosened rather than the prompt cut (X-5); mistakes.md 2026-09-26 "Scaffolding built for a weaker model made a strong one over-work"; two live turns showed 26-call OCR loops from tool/prompt text (mistakes.md:788-801). Locked Gemini rendering has 12 critical rules first; the repo has none (GEM-1).
- Against: Stage 6 sets the quality bar at "Claude level (claude.ai)" (`00-checkpoint-stage6.md:17`), and the repo prompt is the closest text to that; live replies were right on the KVB/Federal counts (CURRENT.md:138-151); prompt diet already worked once (ADR-0032 live: 3 commands, figures match, CURRENT.md:444-446).
- Confirm: (a) read the "system prompt" stage of five poor turns (characters and `parts`) and the "model" stage; (b) offline vitest that builds the `full` scenario (`test/promptKit/scenarios.ts`) and fails above a char budget (ours: per-section budget test); (c) owner-run, provider calls: the 68 JSON cases once with the repo prompt, once with `arcnave.in:prompts/system/v3/gemini.md`, same tools, same judge.

### H2 — Hypothesis: concision and minimal-format directives plus a terse-by-default model produce thin answers

- For: the exact Stage 6 failure mode and its eval (S18, Y2, Y3, S10); directives at `systemPrompt.ts:44,66,69,111,163`; v3-gemini note "Gemini 3 is terse by default" (`06-system-prompt-v3-gemini.md:291`); ST-7 contradiction makes the model guess missing facts rather than ask.
- Against: the directives came from live fixes to over-formatting (headers, rules and bold runs on a count, ADR-0052:30; ADR-0049 context); ADR-0032 recorded the opposite complaint (over-working and a 7-sheet file nobody asked for).
- Confirm: turn logs `saved` stage `textCharacters` for explanatory prompts; owner-run S18, Y2, Y3, S10, S15 from the JSON on Flash with and without the completeness line.

### H3 — Hypothesis: Auto keeps nearly all work on Gemini 3.8 Flash and then pins the chat to it

- For: `routing.ts:76` default; `generation.ts:1306-1319` sticky; no complexity route (RT-3/MR16); Stage 7 §7.9 benchmark rows (Terminal-Bench 19.1 % vs 70.6 %, SWE-bench Pro 61.6 % vs 81.3 %); all file/code work in this app runs through bash_tool/create_file; default preference `Auto` (`schema.ts:86`).
- Against: Stage 7 RT-1 locks "Auto → Gemini" for the MVP, so this is by design; Flash got the statement counts right; Opus is chosen on any first turn with attachments, so file turns do reach a strong model on turn one.
- Confirm: `select model_alias, count(*) from messages where role='assistant' group by 1` and the turn log "model" stage `autoRule`; no-code A/B: pin Sonnet 5.5 in the model menu for the same ten prompts for a day.

### H4 — Hypothesis: long-chat context is dropped or cleared, so follow-ups forget results

- For: X-1 and X-2 (§3.4), both verified in code; 100-220 k-token requests are normal in this app (audit: "about 10 rounds × about 220 k tokens", `2026-09-26-intelligence-latency-audit.md:33`; mistakes.md:623); no summary until 967 k; every tool result replayed in full (`toolHistory.ts:8-12`).
- Against: the Claude path is unaffected by X-1; a chat under ≈ 100 k tokens is unaffected by both; X-2 is a no-op if the UI pins an alias (it then gets 4.1 M chars).
- Confirm: offline test — `loadHistory` with alias `Auto` and 600 k chars of stored tool results expects the earliest turn kept (fails today); offline test — Gemini `stream` with `previousContextTokens: 120000` and six history function responses, assert the request `contents` (fake Gemini client, as the `*.adapter-loop.test.ts` files do); read `usage_records.context_tokens` for the poor chats.

### H5 — Hypothesis: tool-first procedure and files-not-in-context add rounds, latency and failure points

- For: skills mandate "Before creating any file, writing any code or running any command, scan <available_skills> and view the SKILL.md of every skill that plausibly applies" (`systemPrompt.ts:187`); Office files become a pointer when a sandbox exists, so a Word/Excel question needs a computer round (`attachmentContent.ts:66-78`, ADR-0045); 16 rounds vs N-06 Normal 5; cold sandbox history (mistakes.md:525-542); live 26-call loop (ADR-0052 context; CURRENT.md:97-99).
- Against: it is the reference behaviour (ADR-0047) and the manifest now tells the model what is already in context (ADR-0052 §2).
- Confirm: turn log "provider completed" `toolCalls`, `finishReason tool_limit` share, `turn timing streamMs`.

### H6 — Hypothesis: history is polluted (error rows, "[Response stopped]", tool history as prose)

- For: X-3, X-4; a refused or failed question stays as an unanswered few-shot turn for the whole chat.
- Against: needs an error or a model switch first; guard exists.
- Confirm: offline test — seed a chat with a `blocked` exchange and assert the next request omits it; read the turn log "history" stage.

### H7 — Hypothesis: nobody can see quality, so regressions persisted

- For: 70 of 89 kit cases are string checks; 19 skipped; 0 of the 68 locked cases executable (§6); X-5, X-6; Stage 13 validators absent; CURRENT.md:28 "the 68-case kit file is not in the mirror" while the JSON is in `D:\Architecture`.
- Against: this explains non-detection, not the quality itself.
- Confirm: `vitest` skip count (19); `ls D:\Architecture\Stage-06…\06-eval-cases-v1.json`.

### H8 — Hypothesis: locale defaults and unlocked safety text degrade fit for Indian users

- For: UTC default zone and no time (`schema.ts:105`); Tanglish rule fights CXD-1 (mistakes.md:1228-1236); India rules missing (§3.1).
- Against: affects correctness of dates and tone more than general quality.
- Confirm: `select timezone, count(*) from preferences group by 1`; a live Tanglish turn.

## 5. Fix options per hypothesis

Size: S ≤ 0.5 day, M 1-3 days, L > 3 days. "Breaks" = tests and ADRs that must change. Every pick keeps the app runnable at each commit.

| Hyp | Option | Size | Risk | Breaks | Pick |
|---|---|---|---|---|---|
| H1 | **A (N)** Port the locked v3 renderings (`arcnave.in:prompts/system/v3/{gemini,claude}.md`, sha256 version stamp) into `backend/prompts/system/v3/`; select by provider; append only the repo-only modules the spec lacks (computer, artifacts, visuals, memory detail) gated by declared tools, each with a char budget (ours: per-module budget test); old builder stays behind a switch until a live A/B passes | L (3-5 d; the v3 text names Stage 8 tools such as `file_search`, `run_code`, `load_skill`, so a tool vocabulary must be agreed) | M: behaviour changes everywhere | ≈ 50 of 70 PK cases quoting repo text (my count), `behaviorEvaluation.test.ts`, `systemPrompt.test.ts`; ADR-0049/0052 lineage superseded in part (new ADR); CHANGELOG | **A**, conditional on owner Q1/Q2: it is the only path that meets CXD-3b and keeps the old path alive for the A/B. If Q1 returns "repo prompt kept", take B |
| H1 | **B (R)** Keep the repo text; make `buildStaticBasePrompt(provider)`; put the 12 critical rules first for Gemini; cut the static base to ≤ ≈ 6.5 k tokens by moving safety/wellbeing detail and memory minutiae behind gates and shortening display-card descriptions | M | L-M | PK-FMT/LANG/USE strings, behaviour bounds; ADR-0052 amended | fallback |
| H2 | **A (R)** Restore the locked lines: "Give complete, well-explained answers…" for Gemini; replace "Be concise by default / high-level explanation" with ST-2 wording; add ST-7 and S18/Y3 as live cases | S | L | PK-FMT-01, PK-USE strings | **A**: smallest change, first commit of H1-A; measurable with S18 |
| H2 | **B (R)** Provider style block (Gemini gets completeness, Claude none) inside the dynamic suffix | M | L | same | — |
| H3 | **A (R)** Fix Auto rules: drop attachments→Opus, delete or reorder the unreachable `research_mode`, keep sticky | S | L | `routing.test.ts`, `stickyModel.integration.test.ts` | step 1 |
| H3 | **B (N)** Build the profiles of PR-1/RT-4 (Fast/Normal/Deep → effort, tool steps, output ceiling; Deep → Sonnet/Opus), the locked mechanism for escalation; Haiku router (ADR-0013) stays a shadow later | M-L (UI + API + numbers) | M | routing, usage, preferences tests; N-06/N-74 become per-profile | **B** (with A as its first commit): it is the locked way to reach Sonnet without prompt keywords (ADR-0032). Owner Q4 on the Haiku router |
| H4 | **A (R)** Delete Gemini result clearing (or default `CONTEXT_EDIT_TRIGGER_TOKENS` off) and write the ADR-0031 §5 supersession; resolve the history window from the resolved entry (second `loadHistory` after `resolveModel`, or Gemini spec when `Auto` is unresolved) | S | L (bigger Gemini requests, cached) | `contextEditing.test.ts`, Gemini adapter clearing tests; ADR-0031 §5 amended | **A**: breaks a written rule and a mistakes.md entry today |
| H4 | **B (N)** Stage 6 CXD-5/6: profile input budgets, summary job at 60 %, last 6 turns, helper summariser role | L | M-H (summary loss) | `compaction.test.ts`, `longChat.integration.test.ts`; conflicts with planned "0058 compaction kept" | after Q3 |
| H5 | **A (R)** Skills mandate → "view the one skill that applies, once, only before producing or changing a file"; allow a small Office file's text inline (amend ADR-0045) so a docx Q&A needs 0 rounds | S | L-M | `officeReadWithCode.integration.test.ts`, PK-FILE-03 | **A** |
| H5 | **B (N)** Fold the 13 display cards into one dispatcher tool (enum of card kinds) to cut ≈ 20 k chars | L | M | ADR-0048, `displayCards` tests, frontend | — |
| H6 | **A (R)** Omit blocked/error exchanges and empty "[Response stopped]" turns from `loadHistory` (Stage 6 doc-sync 2026-10-11 R-3) | S | L | `toolHistory`, `files` integration tests expecting the stub | **A** |
| H6 | **B (R)** Replay non-native tool history as a tool-role/user-side structured note, not assistant prose | S-M | M (provider shape; mistakes.md:499 "never change a Gemini contents shape without a live probe") | adapter tests | optional |
| H7 | **A (N)** Data-driven runner for the 68 JSON cases (offline wiring now, `LIVE=1` against the three models, cross-vendor judge per CXD-7), report-only until the judge is calibrated | M | L | none | **A** |
| H7 | **B (R)** (ours) Golden request snapshots per provider for five canonical turns + per-section char budgets + repair the stale scripts (`claude-sonnet-5`, removed tools) | S | L | none | do first, then A |
| H8 | **A (R)** Default zone `Asia/Kolkata` at sign-up and add time of day to the date line; decide CXD-1 (Q5) | S | L | PK-CTX-01/02 | **A** |

Other fixes not tied to a hypothesis (all S): wrap and escape project-file text and the mode directive in `assemblePrompt` (UC-1, X-9 filename); cap style instructions;
port the duplicate failed-call guard to the Gemini loop (X-10); give `describeMedia` an explicit output cap and finish-reason check (X-7); reconcile the Research directive with the
no-headers rule (X-8); make `AnswerProtocolGuard` mark, not fail, a bracketed word in prose.

## 6. Test gaps — prompt kit vs the Stage 6 kit and eval cases

Locked kit: 68 cases (checkpoint:11), critical gates (C) block lock, run deferred to Stage 21 with mock tools and a cross-vendor judge (≈ ₹200 per Gemini+Sonnet pass). Correction to the brief: `06-eval-cases-v1.json` holds 68 cases;
the 87 `"id"` keys include 19 nested document ids. The JSON is readable in `D:\Architecture\Stage-06-Context-Prompt-Assembly\`; the 68-case zip (`test-kit\arcnave-test-kit.zip`) is not readable here.
The mirror in `docs/architecture/Stage-06…` has neither (CURRENT.md:28 says so), but the owner folder does, so a faithful port is possible.

| Locked cases (rule ids) | In the repo kit? |
|---|---|
| S1-S18: CI-1/FI-1 citations + partial coverage, HO-1, HO-3, ID-1/2, CP-1/AR-3, TI-3/WS-2, ME-7, AR-1, ST-6, SA-4/ST-7, UC-1/2, AU-4/CF-1, HO-7, PT-3, ST-3, ST-4/HO-4, ST-9/HO-5, ST-2 (Gemini terse) | no: the repo's `PK-*` assert strings of its own prompt; the 19 live-only cases are generic (`PK-FMT-05`, `PK-USE-08`…) and skipped |
| T1-T16: fetch/TO-5, TO-7 queries, ME-4/6, SK-1/3, AR-4, TO-4 retries, UC via tool, PR-1 fast/deep, CI-6 | no |
| A1-A4, C1-C2, Y1-Y3, H1-H2, CT1-2, TM1, P1-P5, W1, K1-K3, CR1-2, L1-L3, M1-M3, LC1, LG1-2 | no (PK-SAFE-01..04 are `liveOnly`) |

Gaps and what would catch them:

1. 0 of 68 behavioural cases executable; "kit critical gates 100 %" (build plan P1-D, exit line 61) is satisfied by string presence, so the gate is vacuous for behaviour.
2. 70 offline cases assert the repo's own wording (`toContain`), so they fail on any prompt change and pass on any poor answer. PK-LANG-01..03 assert the language rule that CXD-1 removed.
3. The prompt-size bound exists but was raised to 10 000 est. tokens (X-5); no per-section or per-tool budget; no tool-declaration size test.
4. No provider-request snapshot tests: nothing pins system block order, tool list, thinking/effort params or cache breakpoints per provider (ours: golden JSON per provider for five canonical turns).
5. `loadHistory` has no test with the `Auto` alias or with a chat over the backstop; Gemini result clearing has no integration test against ADR-0023; blocked-exchange omission untested.
6. No test that `temperature|top_p|top_k` never appear (grep guard, ours) although the rule is in CLAUDE.md of the Python repo and Stage 6.
7. No Stage 13 tests (truncation continue, claim support, completion, canary); no routing test for RT-3 or the §7.12 fallback matrix.
8. Live scripts stale (X-6); none is wired to CI or to a documented owner run.
9. Retrieved project text injection: no case that puts `</memory>`-style or instruction text in a project file and checks placement (PK-PREC-04 covers only the five wrapped blocks).

## 7. Open owner questions

1. Which governs the system prompt: the build-plan row "0057 repo prompt kept (ADR-0049/0052 lineage) instead of policy-spec v3" (`00-build-plan-arcnave-tech.md:33`) or Stage 6 CXD-3b with the 2026-10-15 rule? Not resolved here.
2. Tool vocabulary: v3 names the Stage 8 set (`file_search`, `fetch_url`, `run_code`, `load_skill`, `memory_save`…), the repo declares 35 other tools (ADR-0047/0048). Which set does a v3 rendering describe?
3. Compaction: planned "0058 compaction kept for the prototype" vs CXD-5/6 and N-03/N-16 (profile budgets, summary at 60 %, last 6 turns).
4. Build-plan B-4 "three models only" vs Haiku 5.5 as router and worker-job model (ADR-0013/0014, Stage 7 doc-syncs 2026-10-12/14). Needed before any router or summariser role.
5. Language: keep the Tanglish/Latin-script rule (ADR-0043/0049) or restore CXD-1 removal.
6. Math delimiter: `\( \)` per ST-4/S16 or the frontend's `$$` KaTeX.
7. Reinstate or formally supersede ADR-0023 for Gemini (X-1) — the repo currently does both.
8. Which turns were "very poor"? Send message ids (turn logs) and the model alias shown in the UI; and the live values of `ENABLE_TOOL_USE`, `ENABLE_WEB`, grounding flags, `TOOL_MAX_ROUNDS`, `PRICING_TABLE` (unreadable to this audit).
9. Knowledge-cutoff line: Stage 7 §7.9 lists cutoffs, `systemPrompt.ts:142` refuses to state any. Which wins?
10. Owner-deferred items touched but not bucketed: company/project/user precedence levels (company tenancy), Claude per-company switch and limit (RT-7/RT-8, dropped by ADR-0053 #6), NO_CONTENT, OTel.
