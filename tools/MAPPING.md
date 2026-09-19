# System prompt ↔ tools ↔ skills — the three reference architectures

Reference material only. Nothing here is wired into `backend/src/`. Written 2026-09-19 as the
input to ArcNave items 9–12; read alongside `docs/checkpoints/CURRENT.md` §"Tool-use/agent
framework research".

Sources are verbatim captures under this directory:
`Anthropic/claude-fable-5.1.md` (8,742 lines), `OpenAI/Codex/gpt-6-astra.md` (8,872 lines),
`Google/gemini-3.8-flash.md` (792 lines).

---

## 1. The shape all three share

Every one of the three splits the same job across three layers. The layers are what to copy;
the specific tools are mostly product surface that ArcNave does not have.

| Layer | What it holds | Loaded when |
| --- | --- | --- |
| **System prompt** | *Policy* — when to call, when **not** to, how to phrase the result, refusal rules | Always, every request |
| **Tool schemas** | *Mechanism* — name, description, parameter schema, return shape | Always (Anthropic, OpenAI) or on demand (Google) |
| **Skills** | *Procedure* — hard-won, environment-specific how-to for one task family | `name` + `description` always; body only when the model decides it is relevant |

The split exists for one reason: token cost. Policy is short and unconditional. Schemas are
medium and mostly unconditional. Procedures are long and almost always irrelevant, so they are
addressed by a one-line description and fetched by a file read.

Where they diverge is **how much of the policy lives in the prompt versus in the skill**, and
**whether there is a loop at all**.

---

## 2. Anthropic — Claude Fable 5.1

**Prompt → tool binding: policy is inline, in the prompt, next to nothing in the schema.**

The prompt carries long named policy blocks that govern tools defined 4,000 lines later:
`search_instructions`, `<using_image_search_tool>`, `critical_reminders`,
`artifact_usage_criteria`, `file_handling_rules`, `publishing_artifacts`,
`request_evaluation_checklist`. The `# Tools` block itself is plain JSON Schema with short
descriptions. So the *decision* of whether to call `image_search` is made from prompt text; the
*call* is made from the schema.

**Skills: a directory of `SKILL.md`, read with the ordinary file tool.**

- Mount points: `/mnt/skills/public/<name>/SKILL.md`, `/mnt/skills/user/...`, `private`,
  `examples`. All read-only.
- Discovery: an `<available_skills>` list injected into the prompt; `search_skills` and
  `suggest_skills` tools for the wider catalog.
- Read: the *generic* `view` tool. There is **no dedicated skills API**. A skill is just a file.
- The rule is stated as mandatory: *"Reading the relevant SKILL.md is a required first step
  before writing any code, creating any file, or running any other computer tool."*
  Justification given is that skills encode environment constraints absent from training data.

**Agent loop: none, deliberately.** The closest things are:
- `reply_after_tool_calls` — a behavioural rule, not a mechanism.
- `suggest_research` — explicitly *does not* start anything. It renders a button; the user's
  press is the consent. Long autonomous work is pushed out of the turn entirely.
- No spawn, no fork, no sub-agents, no goal object, no context-budget tool.

**Distinctive assets:** a 6-tool memory family (`memory_read/write/append/str_replace/delete/list`)
over a file layout; 23 render tools (`chart_display_v0`, `places_map_display_v0`,
`recipe_display_v0`, …) that return structured cards instead of prose.

### Tool inventory — 105 total

**Native, 46:**
`Artifact`, `bash_tool`, `create_file`, `str_replace`, `view`, `present_files`,
`memory_append`, `memory_delete`, `memory_list`, `memory_read`, `memory_str_replace`,
`memory_write`, `web_search`, `web_search_fast`, `web_fetch`, `image_search`, `places_search`,
`weather_fetch`, `fetch_sports_data`, `conversation_search`, `read_conversation`,
`recent_chats`, `end_conversation`, `ask_user_input_v0`, `message_compose_v1`,
`search_mcp_registry`, `search_plugins`, `search_skills`, `suggest_connectors`,
`suggest_plugin_install`, `suggest_research`, `suggest_skills`, `show_recommendation_cards`,
`chart_display_v0`, `comparison_card_display_v0`, `featured_card_display_v0`,
`itinerary_display_v0`, `link_preview_display_v0`, `options_card_display_v0`,
`places_list_display_v0`, `places_map_display_v0`, `product_carousel_display_v0`,
`quiz_display_v0`, `recipe_display_v0`, `step_card_display_v0`, `translation_display_v0`

**MCP, 59:** Gmail 29 · Google Drive 11 · Google Calendar 9 · Claude Docs 8 · visualize 2

### Skill inventory — 4 (bodies present in this repo)

| Skill | Trigger | Licence |
| --- | --- | --- |
| `docx` | Word docs/templates, tracked changes, find-replace, TOC/letterhead | **Proprietary, source-available** |
| `pptx` | any `.pptx`/`.potx` as input or output, decks, layouts, speaker notes | **Proprietary, source-available** |
| `xlsx` | any spreadsheet as primary input/output, `.xlsx`/`.xlsm`/`.csv`/`.tsv` | **Proprietary, source-available** |
| `pdf` | read/extract/merge/split/rotate/watermark/fill-forms/OCR | **Proprietary, source-available** |

Each carries `license: Proprietary. LICENSE.txt has complete terms`. These four are **not** OSS.
Copy the *pattern* (front-matter `name` + long trigger-shaped `description`, then prose body);
do not paste the bodies into ArcNave.

---

## 3. OpenAI — GPT-6-Astra (Codex)

**Prompt → tool binding: policy is pushed out of the prompt and into skills.**

The prompt is mostly meta: when to ask permission, autonomy, personality, formatting, *how to
use a skill*, *how to use a plugin*, thread coordination, context-window survival. Per-tool
policy — how to do a spreadsheet, how to drive a browser — lives in the skill file, not the
prompt. This is the opposite of Fable 5.1's arrangement, and it is why Astra can carry 273
tools without a 270-section prompt.

**The single best idea in the file: `functions.exec`.**

A JS sandbox where *every other tool* is a method on a global `tools` object:
`await tools.exec_command(...)`, `await tools.mcp__ologs__get_profile(...)`. Tool composition
happens in one call instead of N round trips. It ships with `store`/`load` for cross-call state,
`yield_control()` to stream partial output, a `// @exec:` pragma for `yield_time_ms` and
`max_output_tokens`, and a companion `wait` tool to resume a yielded cell by `cell_id`.
Collaboration tools are *deliberately excluded* from the `tools.*` namespace.

**Skills: a versioned root table plus three authorities.**

```
r0 = ~/.codex/skills/.system
r1 = ~/.codex/plugins/cache/openai-bundled
r2..r6 = ~/.codex/plugins/cache/openai-curated-remote/<plugin>/<semver>/skills
r7, r8 = ~/.codex/plugins/cache/openai-primary-runtime[/spreadsheets/<semver>/skills]
```

Each skill lists as `name: description (file: rN/path/SKILL.md)`. Three read paths by
authority: filesystem skills off disk, environment-owned skills via that environment,
orchestrator skills via `skills.list {"authority":{"kind":"orchestrator"}}` → `skills.read` on
`main_resource`. Relative references inside a `SKILL.md` resolve against its own directory;
`skill://` identifiers are **not** filesystem paths. Invocation is `$SkillName` or implicit;
explicit rule against triggering on "keywords, superficial relevance, or the availability of a
potentially applicable skill".

A **plugin** is a bundle of skills + MCP servers + apps. Plugin skills are namespaced
`plugin_name:skill_name`. `request_plugin_install` suggests one, gated on tool search having
already failed.

**Agent loop: the only real one of the three.**

- `spawn_agent`, `followup_task`, `send_message`, `wait_agent`, `interrupt_agent`, `list_agents`.
- `fork_turns` controls how much parent context a child inherits (`"all"` / `"none"` / a count).
  Full-history forks inherit parent model and reasoning effort and **cannot** override them.
- 4 concurrency slots. All agents share one container, filesystem and cwd, so edits are
  immediately visible across agents. Messages arrive on an analysis channel with a
  `MESSAGE | FINAL_ANSWER` type header.
- Advice: prefer minute-scale `wait_agent` over busy polling.

**Context-window survival, as an explicit contract:** `notes` (checkpoint of goal, decisions,
progress, learnings, next steps), `history` (`read_item` / `list_items` / `search_contents`),
`get_context_remaining`, and a goal object (`create_goal` with optional `token_budget`,
`get_goal`, `update_goal` → `complete` | `blocked`, with `blocked` requiring the *same*
blocking condition three consecutive turns).

### Tool inventory — 273 total

| Namespace | n | Notable |
| --- | --- | --- |
| `functions` | 4 | `exec`, `wait`, `request_user_input`, `request_user_input_async` |
| `collaboration` | 6 | `spawn_agent`, `followup_task`, `send_message`, `wait_agent`, `interrupt_agent`, `list_agents` |
| `tools` | 12 | `apply_patch`, `exec_command`, `write_stdin`, `view_image`, `get_context_remaining`, `create_goal`, `get_goal`, `update_goal`, `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`, `request_plugin_install` |
| `clock` | 2 | `sleep`, `curr_time` |
| `image_gen` | 1 | `imagegen` |
| `web` | 1 | `run` |
| `mcp__node_repl` | 3 | `js`, `js_add_node_module_dir`, `js_reset` |
| `mcp__codex_app` | 31 | threads (`create/fork/read/wait/handoff/archive/title/share`), sidebar sections, automations, usage limits, screen capture |
| `mcp__codex_apps` | 210 | GitHub 89 · Google Drive/Docs/Sheets/Slides 60 · Sites 24 · Gmail 21 · Calendar (within Google) · plugin mgmt 4 · safety 5 · OpenAI platform 3 · doc-control 3 · hotline 1 |
| `mcp__openai_artifact_template_picker` | 2 | `choose_artifact_template`, `list_artifact_templates` |
| `mcp__openai_api_key_local_confirmation` | 1 | |

### Skill inventory — 44 declared in the prompt; 7 bodies present in this repo

Declared (name → root): `imagegen`, `openai-docs`, `plugin-creator`, `skill-creator`,
`skill-installer` (r0) · `browser:control-in-app-browser`, `chrome:control-chrome`,
`computer-use:computer-use`, `visualize:visualize` (r1) · `data-analytics:` ×13 —
`index`, `analyze-data-quality`, `build-dashboard`, `build-report`, `create-data-context`,
`design-kpis`, `gather-business-context`, `jupyter-notebooks`, `kpi-reporting`,
`market-sizing`, `metric-diagnostics`, `product-business-analysis`,
`publish-artifact-to-sites`, `validate-data`, `visualize-data` (r2) ·
`deep-research-work:deep-research`, `plugin-management:plugin-management` (r3) ·
`google-drive:` ×5 — `google-drive`, `google-docs`, `google-sheets`, `google-slides`,
`google-drive-comments` (r4) · `openai-developers:` ×5 — `agents-sdk`, `build-chatgpt-app`,
`chatgpt-app-submission`, `openai-api-troubleshooting`, `openai-platform-api-key` (r5) ·
`sites:` ×3 — `sites-building`, `sites-hosting`, `sites-preview-troubleshooting` (r6) ·
`documents`, `pdf`, `presentations`, `template-creator` (r7) ·
`spreadsheets:Spreadsheets`, `spreadsheets:excel-live-control` (r8)

Bodies captured here (`OpenAI/skills/`, public repo `openai/skills`): `imagegen`,
`jupyter-notebook`, `openai-docs`, `pdf`, `plugin-creator`, `skill-creator`, `skill-installer`.

---

## 4. Google — Gemini 3.8 Flash

**Prompt → tool binding: the prompt is mostly output-format spec, not tool policy.**

The bulk of the file is render-widget grammar the model emits *in its answer*:
`<Image>`, `<Carousel>`, `<Sequence>`, `<Timeline>`, `<ElicitationsGroup>`, `<FollowUp>`,
`<GenerateWidget>`. Those are not tools — they are typed output. The `# Tools` section is 380
lines and three quarters of it is `image_generation_tool` prose.

**No skills system. No agent loop. No sub-agents. No memory tools. No file tools.**

**The one idea worth taking: `retriever:expand_tools`.**

Tools are presented as *capability summaries* only. Full function declarations are loaded on
demand by name. The rules attached to it are the interesting part, because they are the only
explicit cost-control discipline in any of the three prompts:

- Prefer `expand_tools` over `retrieve_tools` when both exist.
- Decide from the summary's *When to use* / *When NOT to use*. **"DO NOT load an API just to
  check what it does."**
- Never expand something already in context.
- **"STOP CALLING this function if your desired functions are still not available after 2
  consecutive attempts. Complete the task using only the currently available functions
  instead."** — a hard iteration cap with a defined degraded path.

### Tool inventory — 3 always-on + 3 expandable

| Tool | Status |
| --- | --- |
| `google:search` | always on — `queries: string[]` |
| `image_agent:fetch_images` | always on — `queries: string[]` |
| `retriever:expand_tools` | always on — `api_names: string[]` |
| `image_generation_tool:generate_image` | expandable — `query`, `aspect_ratio`, `image_references`, `orchestration_mode: SINGLE_STEP \| MULTI_STEP` |
| `file_gen` + `google:ds_python_interpreter` | expandable — docx/xlsx/csv/pdf/md/tex/zip/txt out; preinstalled data-science Python, no library installs |
| `web_code_canvas` | expandable — interactive HTML/CSS/JS/React preview |

### Skill inventory — none. Gemini has no skills mechanism.

---

## 5. Side by side

| | Fable 5.1 | GPT-6-Astra | Gemini 3.8 Flash |
| --- | --- | --- | --- |
| Tools | 105 (46 native + 59 MCP) | 273 across 11 namespaces | 3 + 3 expandable |
| Where tool policy lives | **system prompt** | **skill files** | neither (thin) |
| Schema format | JSON Schema | TS `declare const` | JSON Schema (Google flavour) |
| Tool composition | one call per tool | **`exec` — all tools inside a JS sandbox** | one call per tool |
| Lazy tool loading | `search_skills` / `search_plugins` only | `tool_search`, `request_plugin_install` | **`retriever:expand_tools`, with a 2-attempt cap** |
| Skills | 4 files, `/mnt/skills/...`, read via generic `view` | 44 entries, versioned roots, 3 authorities, plugin bundles | **none** |
| Multi-step loop | no mechanism | **6 collaboration tools, `fork_turns`, 4 slots, shared fs** | none |
| Context survival | none | **`notes` + `history` + `get_context_remaining` + goals with token budgets** | none |
| Memory | **6 dedicated tools over a file layout** | `notes` (per-thread) | `# Saved Information` prompt block |
| Long work | deferred to the user via `suggest_research` button | run it, in-loop | not addressed |
| Licence on the skill bodies here | **proprietary / source-available** | public (`openai/skills`) | n/a |

---

## 6. Which is best

Not one answer — the winner differs per item, and "best design" is not the same as "best fit
for ArcNave".

**Best reference architecture overall: GPT-6-Astra.** It is the only one of the three that is
a complete agent system rather than a chat product with tools bolted on. It is the only one
that answers *what happens when the work does not fit in one context window*, and the only one
with a real fan-out mechanism.

**Best fit for ArcNave's actual shape: Fable 5.1.** ArcNave is a Fastify API with a Postgres
`projectFiles` table, an `ObjectStorage` abstraction, and BM25 retrieval. Fable's model —
skills are files in a read-only directory, discovered by a `name`+`description` pair, read
with the same tool that reads any other file — drops onto that with almost nothing new. Astra's
versioned-root/three-authority design needs a plugin cache, a semver layout, and an
orchestrator that ArcNave has no equivalent of.

**Per item:**

| Item | Pick | Why |
| --- | --- | --- |
| **9 — tool framework** | **Blend: Anthropic schema + Google's lazy loading** | Vertex takes JSON Schema tool declarations for both Claude and Gemini, so Anthropic's shape is the one that crosses both adapters unchanged. Layer Gemini's `expand_tools` summary-then-load on top — it is the only documented cost control in any of the three, and ArcNave bills per token with `exact` accounting. Astra's `exec` is the better design but presupposes a sandbox ArcNave does not have yet. |
| **10 — agent loop** | **GPT-6-Astra, uncontested** | The only real mechanism. But take it in two halves and ship the second half first: the **bookkeeping** half (`get_context_remaining`, goal object with a token budget, `notes`/`history` checkpointing, and `update_goal`'s three-consecutive-turns rule for `blocked`) needs no new infrastructure and directly serves ArcNave's budget reservation code. The **spawning** half (`spawn_agent`, `fork_turns`, 4 slots, shared filesystem) needs a shared container and cross-instance signalling — and `services.activeRuns` is still an in-process `Map`, so a fan-out loop would not survive the second Cloud Run instance. Defer it. |
| **11 — skills** | **Anthropic's mechanism, Astra's metadata discipline** | Anthropic's: a directory of `SKILL.md`, front-matter `name` + trigger-shaped `description`, body read on demand by the ordinary file tool. That is `projectFiles` + `ObjectStorage` + one new route. Borrow from Astra the rule against keyword-triggering, the `plugin:skill` namespacing, and the explicit "if the named skill is missing, stop the turn and say why" — which is exactly Invariant 1 (never substitute silently) applied to skills. **Do not copy the four Anthropic skill bodies in** — they are proprietary/source-available. The OpenAI seven are public and are the ones to read for structure. |
| **12 — browser / computer use** | **No pick. Out of scope.** | Standing user decision, reconfirmed by the token-cost finding in `CURRENT.md`: a computer-use loop re-sends a fresh screenshot every step and image tokens do not cache across turns — one Opus-tier screenshot ≈ $0.0135, over 4× the whole cached toolset definition it travels with. Astra has the fullest material (`control-in-app-browser`, `control-chrome`, `computer-use`) if this is ever revisited; Fable has one paragraph; Gemini has nothing. |

**Gemini's net contribution is one idea** — `retriever:expand_tools` and its 2-attempt stop
rule. It has no skills system, no loop, and no sub-agents. Do not treat it as a third design to
choose between; treat it as one borrowed control on top of whichever design wins.

---

## 7. What ArcNave has today

Verified against `backend/src/` on 2026-09-19:

- **No tool-calling loop of any kind.** `GenerationRequest` (`src/providers/types.ts`) has
  `prompt`, `history`, `attachments`, `systemInstruction`, `mode`, `maxOutputTokens`,
  `providerModelId`, `grounded`, `codeExecution`, `signal` — **no `tools` array**.
  `ProviderEvent` is `delta | sources | progress | code | completed` — **no `tool_use`, no
  `tool_result`**. There is no round trip back into the provider after a tool runs.
- **Capabilities are booleans, not tools.** `grounded` and `codeExecution` are the two
  hardcoded stand-ins for what should be entries in a tool array. Adding a third capability
  today means adding a third boolean to the request type and a branch in each adapter.
- **`buildSystemInstruction` assembles static text only** (`src/services/generation.ts:637`):
  user standing instructions, project instructions, BM25-retrieved context, mode hint. Nothing
  is deferred, nothing is fetched on demand. Retrieval is always-injected context, never a tool
  the model chooses to call.
- **No skills registry, no skill storage, no `SKILL.md` convention** anywhere in the backend.
- Relevant blockers already on record in `CURRENT.md`: `services.activeRuns` is in-process only
  (so `/stop` and any multi-agent coordination break across instances), and project-file
  indexing is synchronous inside the upload request.

**The build order that follows from the above** (unchanged from `CURRENT.md`, now with the
source for each decision):

1. A code-execution sandbox tool usable by **both** Claude (via the Bash *client* tool — its
   schema is published and it works on Vertex, unlike Anthropic's server-side `code_execution`)
   and Gemini (native `code_execution`). Closes item 9's largest gap and ADR-0004 item 7's
   Claude/Vertex asymmetry at once. Sandbox runs on our infrastructure, reachable via ADC —
   no Anthropic API key, so Invariant 6 holds.
2. Wire the existing BM25 retrieval as a **formal tool** rather than always-injected context.
   Smallest possible first instance of the general contract, and it makes the token saving
   measurable against the current behaviour.
3. Item 10's bookkeeping half (goal + token budget + `get_context_remaining`), then item 11's
   skills registry — once there is a tool to loop over and a reason to describe one.

---

## 8. The pick list — what to take from each, and what to leave

### From Anthropic / Fable 5.1

| # | Pick | Why it wins | Where it lands |
| --- | --- | --- | --- |
| A1 | **JSON Schema tool declaration** — `{name, description, input_schema}` | The only shape that crosses **both** adapters unchanged: Vertex takes it as Anthropic `tools[]` and as Gemini `functionDeclarations`. One internal type, two serialisers. | new `ToolDefinition` in `providers/types.ts`; `tools?: ToolDefinition[]` on `GenerationRequest` |
| A2 | **Skill = a file.** `SKILL.md`, front-matter `name` + `description`, body read on demand by the *ordinary* file tool. No dedicated skills API. | Least machinery of the three. Maps onto `projectFiles` + `ObjectStorage` + one route; no plugin cache, no semver, no orchestrator. | item 11 |
| A3 | **The `description` is a trigger spec, not a summary** — includes an explicit *"Do NOT trigger when…"* clause (see `xlsx`, `pptx` front-matter). | The negative clause is what stops false firing. A description that only says what the skill *is* fires on every adjacent task. | item 11 |
| A4 | **Mandatory-read framing with a stated reason**: skills encode environment constraints "that aren't in Claude's training data", so skipping the read lowers quality *even on formats the model knows*. | Without the reason the model rationalises past the read. This is the sentence that makes A2 actually work. | item 11 system prompt |
| A5 | **Memory as six small file-shaped tools** (`read/write/append/str_replace/delete/list`) rather than one blob tool. | Good template for any file-ish tool family. Each call is small, diffable, and independently failable. | later; not items 9–12 |

**Leave:**
- The 23 `*_display_v0` render tools — product surface. ArcNave streams Markdown over SSE.
- `suggest_research`'s button model. It is a UX punt, not a loop — it *explicitly does not start
  anything*. Item 10 needs an actual loop.
- **All tool policy in the system prompt.** This is what makes their prompt 8,700 lines, and
  ArcNave would pay for every one of those tokens on every request, against `exact` accounting.
  Astra's arrangement (B4) is the right one here.

### From OpenAI / GPT-6-Astra

| # | Pick | Why it wins | Where it lands |
| --- | --- | --- | --- |
| **B1** | **The goal object** — `create_goal` (optional `token_budget`), `get_goal`, `update_goal` | **Highest-value pick, lands on code that already exists.** `usage.reserve()` / `usage.release()` in `generation.ts` already reserves a worst-case budget for one request. A goal is that same idea spanning turns. `status: complete \| blocked` is a typed enum, not prose — Invariant 5. | item 10 |
| **B2** | **The `blocked` discipline** — `blocked` only after the *same* condition recurs 3 consecutive turns; never for "hard, slow, uncertain, incomplete"; never `complete` because the budget ran out; a resumed goal restarts the audit | This is a **loop-termination spec**, and it is precisely the rule that prevents the stuck-`generating` class of bug already logged in `mistakes.md` (2026-09-16). | item 10 |
| **B3** | **`get_context_remaining` + `notes`/`history` checkpointing** | Gives the loop a stopping condition grounded in real budget rather than "N iterations". The notes/history half is what lets a long run survive a reset at all. | item 10 |
| **B4** | **Per-capability policy lives in the skill, not the prompt** | The architectural reason 273 tools fit. For ArcNave: `buildSystemInstruction` stays short; per-tool guidance becomes loadable. Directly contradicts A-reject above — take this side. | items 9 + 11 |
| **B5** | **Namespacing + provenance** — `server__tool`, `plugin:skill` | Costs nothing now, impossible to retrofit once two sources ship a tool named `search`. | item 9, day one |

**Leave (for now):**
- **`functions.exec`.** The best single idea in any of the three, and the wrong one to build
  third. It needs a JS isolate with every tool bound into it — a subsystem *and* a security
  boundary ArcNave would own. Revisit **after** item 9's sandbox exists; it is then a small
  addition rather than the whole project.
- **The six collaboration tools.** Need a shared container, shared cwd, and cross-instance
  signalling. `services.activeRuns` is an in-process `Map` — `/stop` already fails across
  instances, and fan-out would fail the same way, silently.
- **The `r0`–`r8` versioned root table and three skill authorities.** Needs a plugin cache and
  semver layout. Overkill for one namespace of skills.
- The 210 `codex_apps` MCP tools — product surface.

### From Google / Gemini 3.8 Flash

| # | Pick | Why it wins | Where it lands |
| --- | --- | --- | --- |
| ~~**G1**~~ | ~~`expand_tools`: capability summary in context, full declaration fetched by name~~ | **Withdrawn after verification — see §10-C2.** This is an *in-product* mechanism inside the Gemini app, not a Gemini API feature; there is no `defer_loading` or tool search on Vertex, only an open feature request against the Google SDK. The real version of this idea is **Anthropic's** `tool_search` server tool, which *is* supported on Vertex. Deferred regardless: ArcNave's 6–8 tools are nowhere near the limits that make it pay. | — |
| **G2** | **The hard stop rule** — *"STOP CALLING this function if your desired functions are still not available after 2 consecutive attempts. Complete the task using only the currently available functions instead."* | A bounded retry **with a defined degraded path** — not a failure, not a hang. The shape every loop bound in ArcNave should have, and the direct answer to item 10's "when does it stop". | items 9 + 10 |
| G3 | **`orchestration_mode: SINGLE_STEP \| MULTI_STEP`** declared upfront by the model | Cheap signal that lets the service skip loop machinery entirely on one-shot turns. Worth a look; not load-bearing. | item 10, optional |

**Leave:** the render-widget grammar (`<Carousel>`, `<Timeline>`, `<GenerateWidget>`) — typed
output, not tools; ArcNave streams Markdown. There is nothing else in the file to take.

---

### The composite

| Item | = | Assembled from |
| --- | --- | --- |
| **9 — tool framework** | Anthropic's schema, Gemini's loading, Astra's naming | **A1** + **G1** + **G2** + **B5** + **B4** |
| **10 — agent loop** | Astra's bookkeeping, Gemini's bound. **No spawning.** | **B1** + **B2** + **B3** + **G2** (+ G3) |
| **11 — skills** | Anthropic's mechanism, Astra's discipline | **A2** + **A3** + **A4** + **B4** + Astra's *no keyword-triggering* rule and *named-skill-missing → stop the turn and say why* (which is Invariant 1 applied to skills) |
| **12 — browser/computer use** | — | nothing; out of scope |

**Three picks are load-bearing and cheap. The rest is optional:**

1. **A1** — one `ToolDefinition` type, two adapter serialisers. Everything in item 9 hangs off it.
2. **B1** — the goal object, built on `usage.reserve()`/`release()`, which already exists.
3. **G2** — a bounded retry with a defined degraded path. Two lines of policy; it is the
   difference between a loop that terminates and one that shows up in `mistakes.md`.

---

## 9. Name registry — what ArcNave actually adopts

Proposed, not built. Every name below is checked against a convention already in the codebase;
the source column says which. **Two entries marked ⚠ are open decisions** — see the end.

### 9.1 Naming constraints that are not style preferences

A tool name must satisfy **every** provider grammar simultaneously, because one
`ToolDefinition` serialises to all of them. **Verified against primary docs — see §10.**

| Provider | Name rule | Max |
| --- | --- | --- |
| Anthropic | `^[a-zA-Z0-9_-]{1,128}$` | **128** |
| Gemini / Vertex `FunctionDeclaration` | start with a letter or `_`, then letters/digits/`_`/`.`/`-` (Node SDK omits `.`) | **64** |
| OpenAI | `^[a-zA-Z0-9_-]{1,64}$` | **64** |

**Safe intersection → `^[a-z][a-z0-9_]{0,63}$`: lowercase `snake_case`, starts with a letter,
≤64, no dots, no colons, no dashes.** Gemini is the binding constraint on both length *and* the
leading character — Anthropic allows 128 and a leading digit; Gemini does not. Gemini's
**parameter** names are stricter still (no dots or dashes at all), so underscores only.

Gemini's own `google:search` and Astra's `mcp__server__tool` are *internal* forms no provider
accepts from us over the wire. `__` as a namespace separator is the documented community
workaround for the missing `.`/`/` — but it burns four characters against a 64 ceiling, so
prefix carefully. Astra's `plugin:skill` colon form is fine for **skill** names (never sent to a
provider) but not for tools.

### 9.2 Tool names — item 9

| Tool | Phase | What it is | Adapted from |
| --- | --- | --- | --- |
| `search_project_files` | 1 | The existing `Retriever.search` BM25 call, exposed as a tool instead of always-injected context. Returns chunks with `page` where known. **Description must say "lexical keyword search"** — Invariant 4 forbids calling it semantic, and the description is what the model reasons from. | A1 (schema), B4 (policy in the skill) |
| `read_project_file` | 1 | Full indexed file by id, for when a chunk is not enough. | A1 |
| `run_python` ⚠ | 2 | Code execution in the sandbox. Closes item 9's largest gap and ADR-0004 item 7's Claude/Vertex asymmetry. | — |
| `list_skills` | 3 | Returns `name` + `description` pairs only, never bodies. | Astra `skills.list`, flattened |
| `read_skill` | 3 | Returns one `SKILL.md` body by name. | Astra `skills.read` |
| ~~`expand_tools`~~ | — | **Dropped. See §10-C2/C3.** Gemini has no `defer_loading`/tool-search at the API level at all (it is an in-product mechanism, not something we can call); Anthropic's equivalent is the real server tool `tool_search_tool_bm25_20251119` and *is* supported on Vertex. And with 6–8 tools ArcNave is far under Vertex's 64-declaration cap and the ~30–50-tool accuracy cliff, so neither is needed yet. | ~~G1~~ |
| `get_context_remaining` | 4 | Remaining tokens in the window, or `null` when unknown — never a guess. Invariant 3's shape. | **B3**, name kept verbatim |
| `get_goal` / `update_goal` | 4 | Model reads and closes the goal. | **B1**, names kept verbatim |

`create_goal` is deliberately **not** in the list: the service creates the goal from the
request, because `usage.reserve()` already runs service-side and the goal's `tokenBudget` is
that same reservation widened across turns. Astra exposes it as a tool because its goals are
user-initiated; ArcNave's are not.

### 9.3 Skill names — item 11

Directory `skills/<name>/SKILL.md`; lowercase kebab-case, matching both Anthropic (`docx`) and
OpenAI (`skill-creator`).

| Skill | Triggers on | Backed by code that already ships |
| --- | --- | --- |
| `xlsx` | spreadsheet as primary input or output | `extractXlsx()` + `exceljs` export path |
| `docx` | Word document as input or output | `officeparser` extract + `docx` export |
| `pptx` | slides as input or output | `officeparser` extract + `pptxgenjs` export |
| `pdf` | PDF read, page-level citation, scanned/OCR | `pdf-parse` + `describeMedia` OCR branch |
| `project-research` | answering from indexed project files | `search_project_files`; how to phrase a **lexical** query, how to cite `(p. 4)` |
| `data-analysis` | computation over an uploaded table | `run_python` |

**Licence note, repeated because it is easy to lose:** the four bodies under
`tools/Anthropic/skills/` carry `license: Proprietary. LICENSE.txt has complete terms`. Format
names like `xlsx` are generic and free to use; **the bodies must be written fresh.** The seven
under `tools/OpenAI/skills/` are public (`openai/skills`) and are the ones to read for shape.

Each front matter follows **A3** — a trigger spec with an explicit negative clause:

```yaml
---
name: xlsx
description: >
  Use when a spreadsheet is the primary input or output … 
  Do NOT use when the deliverable is a Word document, a chart image, or prose about data.
---
```

### 9.4 Agent names — item 10

**None. There are no sub-agents, so there is nothing to name.**

This is the deliberate outcome of the B-reject: `spawn_agent`/`followup_task`/`wait_agent` need
a shared container and cross-instance signalling, and `services.activeRuns` is an in-process
`Map` — `/stop` already fails across instances and fan-out would fail the same way, silently.
Inventing agent names now would be naming a thing we decided not to build.

What item 10 *does* need named is the loop's vocabulary:

| Name | Values / shape | Source |
| --- | --- | --- |
| `GoalStatus` | `'active' \| 'complete' \| 'blocked'` | **B1** — Astra's `complete \| blocked`, plus the implicit initial state |
| `finishReason: 'tool_limit'` | new value alongside the existing `'stop'` | **G2** — the loop hit its bound and **answered with what it had**. A stop reason, *not* an error: G2's whole point is a defined degraded path. |
| `Stage: 'running'` | new member of the existing `planning \| searching \| reading \| synthesizing \| complete \| partial \| error` | fills the gap for sandbox execution |

The `blocked` rule from **B2** is policy, not a name — same condition three consecutive turns;
never `blocked` for merely hard/slow/uncertain; never `complete` because the budget ran out.

### 9.5 Event type names

Existing `ProviderEvent` is `delta \| sources \| progress \| code \| completed`; existing
client-facing `StreamEvent` is `start \| research \| delta \| sources \| code \| done \| error`.
Both are lowercase, one concept per type. Two new members each, same style:

| Layer | New members |
| --- | --- |
| `ProviderEvent` | `{ type: 'tool_use'; toolCallId; name; input }` · `{ type: 'tool_result'; toolCallId; name; ok; output }` |
| `StreamEvent` (SSE) | `{ type: 'tool_use'; toolCallId; name; input }` · `{ type: 'tool_result'; toolCallId; name; ok; summary }` |

Two events, not one combined `tool` event: the call is known and worth rendering before the
result exists. The existing `code` event bundles both only because code execution is
synchronous inside the provider.

### 9.6 Error codes — `errors.ts` catalogue

`snake_case`, each with `status` / `title` / `detail`, per Invariant 5.

| Code | Status | Why it exists |
| --- | --- | --- |
| `tool_unavailable` | 400 | A named tool is not configured. Parallel to the existing `model_unavailable`. **Invariant 1** — say so with a machine-readable reason, never silently run a different tool. |
| `tool_execution_failed` | 502 | The tool ran and failed. Distinct from `tool_unavailable`, which means it never ran. |
| `sandbox_unavailable` | 400 | `run_python` requested with no sandbox configured. Mirrors the existing `capability_unavailable` pattern used for grounding and code execution. |
| `skill_not_found` | 404 | A named skill does not exist. Astra's rule — stop the turn and say why — which is **Invariant 1** applied to skills. |

There is deliberately **no** `tool_loop_limit` error. Hitting the bound is
`finishReason: 'tool_limit'` on a **successful** response (§9.4).

### 9.7 Type and module names

Matching existing `ProviderSource` / `ProviderUsage` / `AttachmentBlock` / `ModelRegistry`,
and the container-injection rule (*tests must never reach a provider*).

| Name | Kind | Note |
| --- | --- | --- |
| `ToolDefinition` | interface, `providers/types.ts` | **A1.** `{ name, description, inputSchema }`. The load-bearing type — everything in item 9 hangs off it. |
| `GenerationRequest.tools?: ToolDefinition[]` | field | replaces adding a third boolean beside `grounded` / `codeExecution` |
| `ToolCall`, `ToolResult` | interfaces | |
| `ToolRegistry` | class, `src/tools/registry.ts` | parallel to the existing `ModelRegistry` |
| `ToolExecutor` | **interface** | the injection seam. Must be a seam, not a concrete class — `src/test/harness.ts` supplies a fake, exactly as `FakeProvider` does today. |
| `SkillRegistry` | class, `src/services/skills.ts` | |
| `Goal`, `GoalStatus` | types | |
| `toolCalls` | new table, `db/schema.ts` | camelCase, matching `fileChunks` / `artifactVersions` |

### 9.8 Environment variables

`SCREAMING_SNAKE`; `ENABLE_*` for feature gates, `*_MAX_*` for limits — both conventions
already in `config.ts`.

| Variable | Default | Note |
| --- | --- | --- |
| `ENABLE_TOOL_USE` | `false` | master gate, same shape as `ENABLE_GEMINI_CODE_EXECUTION` |
| `ENABLE_SKILLS` | `false` | |
| `ENABLE_CODE_SANDBOX` | `false` | **distinct from** the existing `ENABLE_GEMINI_CODE_EXECUTION`, which gates Gemini's *server-side* tool. This one gates *our* sandbox, reachable by both providers. |
| `TOOL_LOOP_MAX_STEPS` | `8` | **G2's** bound. Hitting it yields `finishReason: 'tool_limit'`, not an error. |
| `TOOL_EXPAND_MAX_ATTEMPTS` | `2` | **G2 verbatim** — "STOP … after 2 consecutive attempts" |
| `SANDBOX_TIMEOUT_MS` | — | |
| `SKILLS_DIR` ⚠ | — | only if skills are disk-backed; see below |

### 9.9 The two open decisions

**⚠ `run_python` — custom tool, or Claude's built-in `bash`?**
Anthropic publishes a Bash *client* tool that works on Vertex (unlike their server-side
`code_execution`), but using it means the tool must be named `bash` and carry a versioned
`type` for Claude, while Gemini gets a differently-named custom declaration. That breaks the
one-definition-two-serialisers property **A1** is chosen for. Declaring a plain custom
`run_python` for both keeps A1 intact at the cost of not using Anthropic's tuned schema.
Recommendation: **custom `run_python` for both.** Symmetry is worth more here than the tuned
schema, and it removes a dependency on Anthropic's tool-type versioning.

**⚠ Skills on disk or in Postgres?**
Disk (`SKILLS_DIR`, baked into the image) is Anthropic's model and needs no migration — but a
user cannot add one, and it re-deploys to change. Postgres reuses `projectFiles` +
`ObjectStorage` and makes user-authored skills possible later. Recommendation: **disk for the
six built-ins**, with `SkillRegistry` as the seam so a database-backed source can be added
without touching callers.

---

## 10. Verified against primary sources — 2026-09-19

§§1–9 above were written from the captured system prompts in this directory. A captured prompt
shows what a *product* does internally; it is not evidence about what an *API* offers us. This
section is the result of checking every load-bearing claim against vendor documentation before
any code is written. **Four claims were wrong.** Sources at the end.

### Confirmed

| Claim | Verdict | Source |
| --- | --- | --- |
| Tool definition is `{name, description, input_schema}` (JSON Schema) | ✅ | Anthropic *Define tools* |
| Tool use itself works on Vertex | ✅ GA | Anthropic platform-availability table |
| Anthropic's **Bash client tool** works on Vertex | ✅ GA ("Bash, text editor, memory — Vertex: Yes") | same |
| Anthropic's **server-side code execution** does **not** work on Vertex | ✅ confirmed "No" | same |
| A custom tool is the right call over Anthropic's `bash` | ✅ **stronger than assumed** — the docs forbid the hybrid outright: *"do not define a custom tool that happens to be named `bash` — that creates a user-defined tool without the built-in behavior"* | Anthropic *Tool use concepts* |
| Namespacing tool names (**B5**) | ✅ now sourced, not inferred — *"Use meaningful namespacing in tool names… especially important when using tool search"* | Anthropic *Define tools* |
| Skills = a folder + `SKILL.md`, `name`+`description` in context, body on demand (**A2/A3**) | ✅ and now precisely specified — see C4 | agentskills.io |
| Strict tool use (`strict: true`) available on Vertex | ✅ GA | platform-availability |

### Corrections

**C1 — Tool name length. My §9.1 was wrong.**
I wrote that both providers cap at 64 and the intersection is therefore 64. Actual: **Anthropic
allows 128** (`^[a-zA-Z0-9_-]{1,128}$`); **Gemini and OpenAI cap at 64**. The ≤64 conclusion
survives, but Gemini/OpenAI are the binding constraint, not Anthropic — and Gemini additionally
requires a **leading letter or underscore**, which Anthropic and OpenAI do not. Gemini
*parameter* names forbid dots and dashes entirely. §9.1 corrected.

**C2 — `expand_tools` does not exist as an API feature. This was the biggest error.**
I recommended adopting Gemini's `retriever:expand_tools`. That is an **in-product mechanism
inside the Gemini app**, visible in the captured prompt but not callable by us. The Gemini API
and Vertex have **no `defer_loading` and no tool search** — there is an open feature request
against the Google Gen AI SDK asking for "parity with Anthropic & OpenAI" (googleapis/python-genai
#2185). The genuine version of this idea belongs to **Anthropic**: `tool_search_tool_bm25_20251119`
/ `tool_search_tool_regex_20251119`, with `defer_loading: true` on the other tools — and
platform-availability lists tool search as **supported on Vertex**. Two details my design missed:
discovered schemas are **appended, not swapped, so the prompt cache survives**; and *"at least one
tool must be non-deferred, or the API returns 400 `All tools have defer_loading set`."*

**C3 — …and ArcNave does not need any of it yet.**
Vertex caps a request at **64 function declarations**, and reported accuracy degrades past
**30–50 tools**. ArcNave's plan has **6–8**. Lazy tool loading is premature optimisation; the
fixed overhead of enabling tools at all is only **286 tokens** on Opus 5 / 354 on Sonnet 5
(`tool_choice: auto`). Dropped from the phase list.

**C4 — Agent Skills is a published open standard, not an Anthropic format.**
Item 11 is **implementing a spec, not designing one**. Anthropic released it as an open
specification on 2025-12-18; OpenAI shipped support in ChatGPT and Codex within 48 hours — the
same spec, not a competing one — and it is now governed under the Linux Foundation's Agentic AI
Foundation (Anthropic, OpenAI and Block founding members). Gemini CLI, VS Code, Cursor and
~30 other tools read the same files. The real rules, stricter than what I wrote in §9.3:

- `name` — **required**, ≤64 chars, `^[a-z0-9]+(-[a-z0-9]+)*$`: lowercase alphanumerics and
  single hyphens, no leading/trailing hyphen, no `--`, and **must match the parent directory name**
- `description` — **required**, 1–1024 chars, must say *what it does and when to use it*
- optional: `license`, `compatibility` (≤500), `metadata` (string→string), `allowed-tools` (experimental)
- layout: `skill-name/SKILL.md` plus optional `scripts/`, `references/`, `assets/`
- progressive disclosure budget: metadata **~100 tokens** always loaded · body **<5000 tokens**
  on activation · resources on demand. Keep `SKILL.md` **under 500 lines**.
- there is a validator: `skills-ref validate ./my-skill`

All six proposed names (`xlsx`, `docx`, `pptx`, `pdf`, `project-research`, `data-analysis`)
are valid under that regex. The `license: Proprietary. LICENSE.txt has complete terms` line on
Anthropic's four skills is the spec's own `license` field — it is a real licence assertion, so
the earlier warning stands: **use the names, write the bodies fresh.**

**C5 — Anthropic's native Agent Skills cannot be used on Vertex.**
`container={"skills": [...]}` requires the code-execution tool, and platform-availability lists
**Agent Skills (Messages API) — Vertex: No**, as are programmatic tool calling, the MCP
connector, the Files API and Message Batches. §9.3's "our own skills system" was right, but as a
**hard platform constraint**, not the design preference I presented it as.

**C6 — Anthropic's `task_budget` is also unavailable on Vertex.**
Listed beta on first-party and Claude-Platform-on-AWS only, with *"3P availability not
documented — assume unsupported."* So **B1's** budget must be ours, built on the existing
`usage.reserve()` — which is what §9.2 proposed, now for a verified reason rather than a guess.

### New, and worth acting on

**N1 — RESOLVED by live test, 2026-09-19. Vertex accepts the combination.**
The concern: Vertex historically **rejected** mixing `google_search` with custom
`function_declarations` — 400, *"multiple tools are supported only when they are all search
tools."* Since ArcNave already ships `googleSearch` grounding and `code_execution` on Gemini,
item 9 lands exactly on that combination. Tested live against the real project
(`project-8bcf740a-a7bd-4aea-974`, `location=global`) with one candidate
`search_project_files` tool. **All six cases passed, and the model called the tool in every
one:**

| # | Request | Result | Input tokens |
| --- | --- | --- | --- |
| 1 | Gemini — custom tool only | PASS, called it | 131 |
| 2 | Gemini — **`googleSearch` + custom** | **PASS**, called it | 155 |
| 3 | Gemini — `codeExecution` + custom | PASS, called it | 131 |
| 4 | Gemini — **`googleSearch` + `codeExecution` + custom** | **PASS**, called it | 155 |
| 5 | Claude — custom tool only | PASS, `stop_reason: tool_use` | 596 |
| 6 | Claude — `web_search_20250305` + custom | PASS, `stop_reason: tool_use` | **3,036** |

So the Gemini-3 "tool context circulation" behaviour is live on `gemini-3.8-flash` on Vertex.
Nothing about item 9 is blocked. Three things worth carrying forward:

- **Grounding is nearly free to add; Anthropic's `web_search` is not.** Enabling `googleSearch`
  alongside a custom tool cost **+24 input tokens** on Gemini. Declaring
  `web_search_20250305` alongside a custom tool cost **+2,440** on Claude (596 → 3,036) — before
  a single search runs. That is a real per-request cost to gate, not a flag to leave on.
- **Claude emitted the same tool call twice** in case 5 (parallel tool use is on by default).
  The loop must handle N `tool_use` blocks per turn and return **all** `tool_result` blocks in
  one user message, or set `disable_parallel_tool_use`.
- **A1 holds, with one caveat — see N6.** One neutral definition did serialise to both
  providers, but only once each adapter built its wire object from its own deep clone.

**N6 — `@google/genai` mutates the schema object you give it. Found the hard way.**
The first run of the probe failed on Claude with
`tools.0.custom.input_schema.type: Input should be 'object'`. Cause: the Gemini SDK rewrites the
JSON Schema **in place**, replacing every `type` with Vertex's uppercase proto enum
(`"object"` → `"OBJECT"`, `"string"` → `"STRING"`). Sharing one schema object between the two
adapters therefore corrupts whichever provider is called second. This does not weaken **A1** —
it sharpens it: `ToolDefinition` must be a *neutral internal type*, and each adapter must build
its own wire object from a clone, never pass the shared object through.

**N2 — Anthropic's guidance contradicts part of my tool list.**
*"Consolidate related operations into fewer tools… rather than `create_pr`, `review_pr`,
`merge_pr`, group them into a single tool with an `action` parameter. Fewer, more capable tools
reduce selection ambiguity."* That argues against the `list_skills`/`read_skill` pair; weaker
against `search_project_files`/`read_project_file`, which return different shapes. Revisit when
specifying item 9.

**N3 — `input_examples`** is a real optional field on a tool definition: schema-validated example
inputs, ~20–50 tokens simple / 100–200 complex. Cheap accuracy for `search_project_files`.

**N4 — Description quality is the single biggest lever.** *"Aim for at least 3–4 sentences for
each tool description."* Trigger conditions in the description measurably raise should-call rate
on recent Opus models. This is the same discipline as **A3** for skills.

**N5 — Other limits worth knowing.** OpenAI: description ≤1024 chars, ≤128 tools per request.
`tool_choice` changes invalidate cached *message* blocks (tool definitions and system prompt stay
cached). Anthropic now also ships a **Browser use** client toolset — noted for item 12, still out
of scope.

### Sources

- [Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) — name regex, namespacing, consolidation, `input_examples`
- [Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- Anthropic `claude-api` skill, `shared/platform-availability.md` — the per-feature Vertex table
- [Agent Skills specification](https://agentskills.io/specification) — frontmatter, naming, progressive disclosure
- [anthropics/skills](https://github.com/anthropics/skills) · [openai/skills](https://github.com/openai/skills)
- [Build skills (Codex)](https://developers.openai.com/codex/skills) · [Skills (OpenAI API)](https://developers.openai.com/api/docs/guides/tools-skills)
- [Vertex AI FunctionDeclaration reference](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1beta1/FunctionDeclaration) — name rules, 64-declaration cap
- [googleapis/python-genai#2185](https://github.com/googleapis/python-genai/issues/2185) — open request for `defer_loading`/tool search parity
- [Combine built-in tools and function calling](https://ai.google.dev/gemini-api/docs/tool-combination) — Gemini 3 tool context circulation
