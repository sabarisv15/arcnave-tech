# Claude vs ArcNave audit: upload to answer, 2026-09-28

Triggered by turn log `8931cd51` (scanned 12-page KVB + Federal statement, "Total the kvb and
federal entries", Auto → Gemini 3.8 Flash, 15 tool calls, 292 s, wrong answer). The model itself
is out of scope, because ArcNave runs Gemini only. Everything else was checked: infrastructure,
pipeline, prompt, tools, skills, loop, lifecycle and output.

**How each claim was confirmed.** ArcNave claims come from the code at the given file:line, or
from the turn log. Docs and ADRs were not taken as evidence. Claude claims come from Anthropic's
published docs, the help centre, the published app prompt (`tools/Anthropic/claude-fable-5.1.md`)
and github.com/anthropics/skills at `3337550`. **Not confirmable here:** production environment
variables (they are set in GCP, not in the repo). Where it matters, the turn log shows what was
on for that turn.

Sources:
- [PDF support](https://platform.claude.com/docs/en/build-with-claude/pdf-support)
- [Vision](https://platform.claude.com/docs/en/build-with-claude/vision)
- [Upload files](https://support.claude.com/en/articles/8241126-upload-files-to-claude)
- [Create and edit files](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude)
- [Usage and length limits](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)
- [Gemini media resolution](https://ai.google.dev/gemini-api/docs/media-resolution) (from its search snippet; the page itself is blocked from this sandbox)
- github.com/anthropics/skills

---

## 1. Stage by stage

### S1. Upload and limits: matches

| | Claude | ArcNave |
|---|---|---|
| Per file | 500 MB in chat, 30 MB project | 500 MB attachment, 30 MB multipart (`config.ts:305,310`) |
| Files per chat | 20 | 20 (`processUpload.ts:31`) |
| PDF | ≤100 pages visual, 101–1000 text only | same (`processUpload.ts:32-34`, `readingFor`) |
| Image | 8000×8000, 10 MB | same (`processUpload.ts:35-37`) |
| DOCX/XLSX/PPTX | not in context when code runs; read on the computer (reference prompt `notes_on_user_uploaded_files`) | read with code (`attachmentContent.ts:66-78`) |

No gap.

### S2. How a PDF reaches the model: same shape, lower detail

- **Claude:** "converts each page into an image; text of each page extracted and provided
  alongside." On Claude 4.7+ a page image is used up to a **2576 px** long edge and **4784**
  visual tokens (Vision docs). An A4 page at 2000 px long edge costs ⌈1414/28⌉×⌈2000/28⌉ ≈
  **3,650 tokens**.
- **ArcNave:** pages are rendered locally to JPEG at q90 with a 2000 px long edge
  (`pdfPages.ts:27-28`) and sent to Gemini as `fileData` with **no `mediaResolution`**
  (`gemini.ts:46-50`; there is no `mediaResolution` anywhere in `src/`). Gemini 3's default for
  an image is **1,120 tokens**. `ULTRA_HIGH` (2,240) can only be set per part.
- **G1. Gap:** each page reaches the model at about **one third of Claude's visual detail**. On a
  dense scanned statement with a stamp over the totals, this is the most likely reason the model
  did not trust its own reading and turned to OCR. The SDK supports a per-part `mediaResolution`
  (`@google/genai` `Part.mediaResolution`, `MEDIA_RESOLUTION_ULTRA_HIGH`).
- Also ours: a note after every page, "Page N has no text layer; read it from the image"
  (`gemini.ts:50`). Claude sends no such note. The model's first call checked each page for a
  text layer. The note may have prompted that; low confidence.

### S3. The file on the computer and the sandbox

| | Claude | ArcNave |
|---|---|---|
| Uploads on disk | `/mnt/user-data/uploads` | `input/` read-only (`definitions.ts:88-89`) |
| Outputs | `/mnt/user-data/outputs` + `present_files` | `output/` + `present_files` |
| File system | "resets between tasks" (reference prompt `high_level_computer_use_explanation`) | per-chat workspace checkpointed to storage (`SANDBOX_CHECKPOINT_IDLE_SECONDS`, `config.ts`) — ours |
| Network / installs | package managers by default for Team/Enterprise; `pip install --break-system-packages` (help centre, reference prompt `package_management`) | "No network access, and nothing can be installed" (`definitions.ts:86`) |
| `bash_tool` description | one line: "Bash command to run in container" | lists pdfplumber, pymupdf, **opencv and pytesseract** (`definitions.ts:84-91`) |

- **G2. Gap (a direct cause of this turn):** Claude's tool description names no libraries. The
  reference keeps that knowledge in skills ("skills encode environment-specific constraints
  (available libraries…)"), which the model reads when a task needs them. ArcNave advertises OCR
  inside the tool the model is looking at on every turn. Flash used exactly the two libraries it
  names.
- **G3. Infrastructure gap, by choice:** no network and no package install. It is safer. It
  should stay a recorded decision, not an accident.

### S4. Model selection: an unwanted hard-code

- `registry.ts:133-141` disables every Anthropic and OpenAI-OSS model whenever
  `NODE_ENV !== 'test'`, whatever `MODEL_SONNET` or `MODEL_OPUS` say. The disable is in code, not
  in configuration. Settings then reports "disabled", and Auto's quality tier falls back to Flash
  (`attachments_present+fallback_to_economy` in the log).
- **U1. Unwanted:** a deployment switch lives in code. If Gemini-only is the decision, it belongs
  in config (an env allow-list) with an ADR. A code hard-code also breaks the adapter's own live
  checks.

### S5. System prompt

- ArcNave's static prompt (`systemPrompt.ts:18-108`) is mostly our own sections (core_behavior,
  truthfulness, professional_deliverables, source_transformation, agent_behavior). Claude's app
  prompt has no counterpart for most of them.
- **G4. Ours, and it pulls the wrong way:** `systemPrompt.ts:67` says to use a tool whenever it
  "materially improves correctness … computation, verification". Claude's prompt has no such
  line. Its rule is the reverse for in-context files ("an image of text … don't [use the
  computer]"). This sentence licenses exactly the verification loop in the log.
- **G5. Order and repetition:** Claude states the skill-first rule twice (`## skills` near the top
  of computer_use and `additional_skills_reminder` at the end). It also carries an examples block
  ("Summarize this attached file → in-conversation → do NOT use view"). ArcNave states the rule
  once (`systemPrompt.ts:123`), puts `<files>` after it, and has no examples block.
- Matches: "address the most likely reading first" (`systemPrompt.ts:34`), no narrating tool
  calls, reply after the last tool call.

### S6. Skills

| Claude (app) | ArcNave |
|---|---|
| docx, pdf, pptx, xlsx, frontend-design, file-reading, pdf-reading, product-self-knowledge, skill-creator, docs, import-memory, morning | docx, pdf, pptx, xlsx, frontend-design, file-reading, pdf-reading, skill-creator |

- **Scope of `pdf`:** Claude's `pdf` covers "anything with PDF files … reading … OCR on scanned
  PDFs; if the user mentions a .pdf file … use this skill". ArcNave's `pdf` is producing or
  changing only (`skills/pdf/SKILL.md` frontmatter). Under Claude's rule the model views `pdf`
  before any command on a PDF. Under ArcNave's, no skill description matches an in-context PDF,
  so nothing is read.
- **Depth:** Claude's pdf/docx/pptx/xlsx ship scripts (xlsx `recalc.py`; pptx `thumbnail.py`,
  `add_slide.py`; OOXML validators; PDF form tools) and reference files. ArcNave's are a single
  SKILL.md of 48–81 lines each, with no scripts.
- **L1. Cannot be copied:** Anthropic's docx/pdf/pptx/xlsx skills are proprietary. Their licence
  forbids copying, derivative works and "retain[ing] copies outside the Services"
  (`skills/xlsx/LICENSE.txt`). ArcNave has to write its own equivalents. `file-reading` and
  `pdf-reading` are not published at all; ArcNave's versions are written from their one-line
  descriptions.
- **U2. Legal risk to decide:** `tools/Anthropic/skills/{docx,pdf,pptx,xlsx}/SKILL.md` are
  verbatim copies of those proprietary files, committed in `1b8635b`. The owner should decide
  whether they stay (this is not legal advice).

### S7. Tool loop

| | Claude | ArcNave |
|---|---|---|
| Per-turn limit | exists; number not published; shows "reached its tool-use limit" + **Continue**, context intact | 16 rounds (`config.ts:168`) |
| At the limit | stops; user continues | last round sent with function calling OFF and "answer now" (`gemini.ts:30-32,404-406`); then, if still empty, **a second request without the loop's history** (`generation.ts:1066-1119`) |
| Parallel calls | yes | yes (all calls of a response run) |

- **G6. Bug (the lie in this turn):** the synthesis request is built from `request`. The loop's
  tool results live only in the adapter's local `contents` (`gemini.ts:381`), so they are gone.
  The prompt still says "based on the previous tool results above". Its `finishReason`
  overwrites `tool_limit` with `STOP`, so the UI's "Answer cut off … Continue"
  (`App.tsx:1006-1016`) never shows. The block came in `2842d15` with no ADR and no test. This
  violates Invariant 1.
- **G7. Limit hidden in the other path too:** if the model answers on the final round, the loop
  ends with the candidate's `STOP` (`gemini.ts:528`), not `tool_limit`. The user again gets no
  cut-off notice. Claude always shows the limit.
- **G8. Observability:** the turn log does not record what the final round did (function
  calling off accepted or rejected, a call attempted, text length). From `gemini.ts:528-531`, in
  this turn round 16 returned a function call. Whether Vertex rejected `NONE` (retry at
  `gemini.ts:451-463`) or ignored it cannot be told from the log.

### S8. Output and lifecycle

- `present_files`, side panel, Stop, Regenerate, Continue, edit-versions, compaction, memory,
  share: all present. Continue works only when `finishReason` survives, which G6 and G7 break.
- **G9. Web search off in this deployment** (log: `web: false; searchProviderLive: false`).
  Claude always has web search. This is configuration or infrastructure, not code.

---

## 2. Why this turn went wrong, in order

1. The page images reached Flash at about one third of Claude's detail (G1). The Federal
   withdrawal total sat under a blue stamp.
2. The prompt says tools are for "verification" (G4). The bash_tool description offers
   pytesseract and opencv (G2).
3. No skill description matched an in-context PDF. ArcNave's `pdf` is build-only. The
   skill-first rule was stated once and skipped (G5, S6). Flash ran code without reading a skill.
4. OCR could not see through the stamp either. Flash spent 15 rounds on crops and hit the limit.
5. Round 16 still made a call (G8). The loop ended `tool_limit` with no text.
6. `generation.ts` sent a history-less "synthesise from the tool results above" request. Flash
   wrote figures from the images alone, including one that was never read. `STOP` replaced
   `tool_limit`, so no Continue appeared (G6).
7. "Entries" was read as amounts, not counts (expected 48 / 277 / 325). That is the model's
   reading. The prompt already has Claude's "most likely reading first" rule.

## 3. What cannot match Claude, and why

- **The model** (out of scope). The Claude models are hard-disabled (U1). Opus-class instruction
  following on "skill first" and "don't compute what you can see" is a model property.
- **Anthropic's skill content** (L1): licence. Ours must be written independently.
- **Claude's internal numbers:** the tool-use limit count and the container spec are not
  published. Match the behaviour, not a number.
- **Sandbox network** (G3): a choice we can keep. It means no `pip install` recovery.

## 4. Our own additions to challenge

| Item | Where | Verdict |
|---|---|---|
| History-less synthesis ("Guaranteed Final Outcome") | `generation.ts:1066-1119` | remove (G6) |
| Final-round forced answer that drops `tool_limit` | `gemini.ts:30-32,528` | keep the answer if useful, but report `tool_limit` (G7) |
| Library list in `bash_tool` | `definitions.ts:86-91` | move to skills (G2) |
| "…computation, verification" tool rule | `systemPrompt.ts:67` | drop the verification clause (G4) |
| "no text layer" note per page | `gemini.ts:50`, `anthropicVertex.ts:176` | candidate to drop; eval first |
| Hard-coded Gemini-only registry | `registry.ts:133-141` | move to config (U1) |
| Proprietary skill copies | `tools/Anthropic/skills/` | owner decision (U2) |
| Persistent sandbox workspace | sandbox checkpoints | keep; it is a deliberate improvement; record it as ours |

## 5. Proposed fix order (nothing applied; each needs the owner's OK)

1. **G6 + G7 (Claude-aligned, code).** Remove the synthesis. When the round budget runs out,
   report `tool_limit` whether or not the final round wrote text, so Continue shows. An
   integration test with the FakeProvider covers both paths.
2. **G2 (Claude-aligned, prompt/tool).** `bash_tool` gets the reference's one-line description.
   The environment facts move into the skills that use them.
3. **S6 scope (Claude-aligned, skill).** `pdf`'s description covers reading, as Claude's does, so
   the skill-first rule has something to match. Its body says in-context pages are read by eye,
   and OCR is only for pages not in context.
4. **G5 (Claude-aligned, prompt).** The skill reminder is repeated at the end of computer_use,
   and the reference's examples block is added.
5. **G4 (removal of ours).** Drop "verification" from the tool rule.
6. **G1 (ours, provider limit).** PDF page parts go to Gemini with `mediaResolution` HIGH or
   ULTRA_HIGH. This roughly doubles image tokens. Record it in an ADR as a Gemini-specific
   difference. Needs a live eval.
7. **G8 (ours, observability).** The turn log records the final round's outcome.
8. **U1, U2, G3, G9:** owner decisions (config, legal, infrastructure).

Items 2 to 6 change model behaviour, and only a live eval proves them. **G10. That eval does
not exist.** ADR-0044 names `verifyPhase3KvbFederalLive.ts`, but no such file is in the repo
(`find . -name 'verifyPhase3*'` is empty). It has to be written before items 2 to 6 can be
claimed. Expected result: 48 / 277 / 325, no OCR loop. It needs Vertex, so it cannot run from
this sandbox.
