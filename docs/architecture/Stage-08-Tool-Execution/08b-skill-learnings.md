# 08b — Skill learnings (read-once record)

Status: REFERENCE (Stage 8). Date: 2026-10-02.
Purpose: this file is the single saved record of everything learned. Do not re-read the sources; use this file.

## 0. Sources read (once, fully)

| Source | Licence | How used |
|---|---|---|
| Anthropic docx / xlsx / pptx / pdf skills (SKILL.md, REFERENCE.md, FORMS.md, all scripts, validators; ~8,000 lines) | Proprietary (Anthropic Materials Use License) | Concept-level learning only. No text, code or structure copied. On lawyer list. |
| Anthropic skill-creator (all 18 files) | Apache-2.0 | Method learning. Reuse is allowed with attribution, but we are writing our own. |
| Official docs: platform.claude.com Agent Skills (overview, best practices, skills guide, Claude on Vertex), code.claude.com skills, agentskills.io spec + guides, OpenAI skills (Codex / Responses API), Gemini CLI skills, Google ADK skills, Gemini 3 prompting guides, Perplexity Agent API skills | Public docs | Facts with URLs (section 3) |
| Hands-on tests in container (section 6) | Our own code | Evidence in `skill-tests/` |

Rule: when we write skills, we write from public library docs (python-docx, openpyxl, XlsxWriter, python-pptx, pypdf, pdfplumber, pypdfium2, reportlab, LibreOffice), ECMA-376 / ISO 29500, and our own tests. The lists below are learning leads only.

## 1. Big findings (affect decisions)

1. **Claude on Vertex does NOT support native Agent Skills.** platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai lists "Agent infrastructure (Agent Skills, MCP connector, programmatic tool calling)" as unsupported. Code execution and the Files API are also unsupported. So our own `load_skill` plus our sandbox is the only route. TD-13 is confirmed.
2. **SKILL.md is an open standard** (agentskills.io), used by Claude, OpenAI Codex/ChatGPT, Gemini CLI, Google ADK and Perplexity Agent API. Our skills are therefore portable.
3. **Google ADK already has `load_skill` + `load_skill_resource`** (adk.dev/skills, experimental). Our design matches Google's own reference.
4. **Gemini placement risk.** Google says to put critical constraints at the END, and not to use overly persuasive language. A skill loaded mid-chat is "early context". Plan: put critical rules at the TOP of SKILL.md, add a short closing "Before you answer" checklist, and use no ALL-CAPS.
5. **LibreOffice: 3 parallel jobs on one shared profile → 1 fails silently** (reproduced 3/3). With separate profiles all succeed. Always use one profile per run, and check that the output file exists.
6. **LO 24.2 lacks the dynamic-array functions**, LET and LAMBDA. A plain convert does NOT recalculate; only UNO `calculateAll()` does.
7. **Indic shaping:** plain reportlab breaks Tamil and Hindi. reportlab Platypus with `shaping=1` + HarfBuzz works. python-docx → LO works only when the complex-script font slot is set (`w:cs`, `w:hint="cs"`, `w:szCs`, `w:lang w:bidi`).
8. **₹ glyph missing** in Liberation Sans/Serif/Mono and Caladea. Present in Carlito, DejaVu and Noto.
9. **Library defaults are wrong for India:** python-docx defaults to US Letter; python-pptx defaults to 4:3.

## 2. Skill format rules (union of all vendors — validate against this)

Frontmatter
- Required: `name`, `description`. Optional: `license`, `compatibility` (≤500 chars), `metadata` (string map), `allowed-tools` (experimental; not used by us). No other keys.
- `name`:
  - kebab-case `[a-z0-9-]`, ≤64 characters.
  - No leading or trailing hyphen, no `--`.
  - Must match the folder name.
  - Must not contain "claude" or "anthropic".
- `description`:
  - 1–1024 **bytes** (Perplexity counts bytes; Anthropic counts characters, so bytes is the safer limit).
  - No `<` or `>` and no XML.
  - Quote it if it contains a colon.
- Exactly one SKILL.md, at the root of the skill folder.
- ArcNave extras go under `metadata`: version, models tested, sandbox libraries.

Size and loading
- Level 1: name + description, ~100 tokens per skill, always visible.
- Level 2: SKILL.md body, under 500 lines and under ~5k tokens.
- Level 3: references, templates and scripts, loaded only when needed. Scripts run without their code entering context.
- References stay one level deep from SKILL.md.
- Any reference file over 100 lines gets a table of contents.
- SKILL.md must say WHEN to read each reference ("read references/x.md if …").
- Split by variant: workflow and choice logic stay in SKILL.md, with one reference file per variant.

Writing
- Description:
  - Phrase it as a third-person "what" plus "Use when …" (this combines the Anthropic and agentskills.io styles).
  - Say what it does + when to use it + when NOT to use it.
  - Put key use cases first; make it slightly "pushy" (Claude tends to under-trigger).
  - Generalise to intent categories rather than listing queries.
- Body:
  - Imperative voice; explain why for each rule; no ALL-CAPS MUST.
  - Assume the model is smart: add only what it lacks.
  - Offer defaults, not menus, with an escape hatch.
  - A Gotchas section is the highest-value content; keep it in SKILL.md.
- Match freedom to fragility: prose for flexible tasks, a parameterised script for medium, an exact script for fragile ones.
- Patterns:
  - Copyable checklist for multi-step work.
  - Validate → fix → repeat loop.
  - Plan → validate → execute for destructive or batch work.
  - Exact templates and input/output example pairs.
- Use one term per concept, forward-slash paths and no time-sensitive information.
- If every test run writes the same helper, bundle it into `scripts/`.
- Say clearly whether each script is to be RUN or READ (prefer run).

Scripts (agent-friendly)
- No interactive prompts; support `--help`.
- JSON to stdout, diagnostics to stderr.
- Idempotent; `--dry-run` where useful.
- Distinct exit codes; predictable output size (harnesses truncate at ~10–30k characters).
- Handle errors inside the script ("solve, don't punt"); no unexplained magic constants.
- Use only libraries in our image (no pip, no network). Pin versions.

Security
- Treat skills as privileged code: our team writes them; no user-uploaded skills in MVP.
- Skills must not fetch URLs.
- No user-facing open skill repository.

## 3. Loader design for ArcNave (load_skill)

1. The catalog (name + description of the enabled skills) goes in the `load_skill` tool description or the system prompt, in a stable order (stable order keeps the Claude prompt cache valid).
2. `load_skill(name)` takes `name` as an **enum** of the enabled skills only. If no skills are enabled, the tool is not registered.
3. The return value:
   - Frontmatter is stripped.
   - The body is wrapped in `<skill_content name="…">`.
   - A `<skill_resources>` list names the files without reading them.
4. Resources are read through an optional `resource` parameter on load_skill. **Proposed TD-15**: no 12th tool. (Google ADK uses a separate `load_skill_resource` tool.)
5. A skill already loaded in this chat is not injected again. Skill content is protected from context trimming.
6. The system prompt states that skill text is subordinate to system policy. (OpenAI treats skill text as user input; Anthropic and Google say nothing on this.)
7. Gemini: keep temperature at 1.0, and pass thought signatures back across load_skill round-trips. The SDK does this; a custom REST layer must.
8. Gemini function-name limits: NOT FOUND in official docs. Using an enum value inside a single tool avoids the issue.

## 4. Eval method (from skill-creator + agentskills.io)

- Output evals:
  - Start with 2–3 realistic prompts with input files, then grow the set.
  - Run each with the skill and without it (or with the old version), 3 runs each.
  - Report pass rate, time and tokens as mean ± stddev.
- Assertions are checked by code: open the file and check its content, not just that it exists. Grader rule: substantive evidence only, no partial credit, and the grader also critiques the evals.
- Analyst patterns to report:
  - assertions that always pass (they don't discriminate)
  - assertions that always fail
  - assertions that pass only with the skill (real value) or only without it (the skill hurts)
  - flaky cases
  - token and time cost
- Trigger evals per skill:
  - 20 queries: 8–10 should trigger, 8–10 are near-miss negatives (xlsx vs chart vs web_page; pdf-read vs pdf-create; docx vs pdf).
  - 3 runs each; pass if the trigger rate is ≥0.5.
  - 60/40 train/test split, ≤5 iterations; the improver never sees test scores; pick the best description by test score.
- **Model matrix:** Sonnet, Opus and Gemini Flash, each with and without the skill. Pick the description by its lowest held-out score across the three models, so one description works for both vendors.
- Blind A/B comparison for judgement-heavy outputs (pptx design, web_page).
- Known bugs in skill-creator's tools: the aggregator path layout differs from what SKILL.md says, the delta sign flips alphabetically, and runs are hardcoded to 3. Build our own runner (Stage 21).

## 5. Per-format learnings (concept level)

### 5.1 Common to all Office formats
- Office files are ZIPs of XML parts. Two paths: create with a library; edit the raw XML for surgical changes.
- Safe unzip: reject symlinks and paths that escape the folder. Use a hardened parser (defusedxml, or lxml with entity resolution and network access off).
- Rezip: `[Content_Types].xml` first and stored uncompressed; sorted order; temp file then atomic rename; keep permissions.
- One correct relationship-target resolver everywhere: skip external targets, percent-decode, absolute vs relative paths, block root escape.
- Validation:
  - Run every check in one pass and report all problems.
  - **Baseline**: subtract errors already in the user's original file.
  - Orphan parts are errors.
  - Every `mc:Ignorable` prefix must be declared.
  - Strip Microsoft extensions on a copy before schema-checking against the public ISO/ECMA schemas (bundled in the image).
- Refuse rather than destroy: if the reference graph looks unparsed, abort deletions.
- LibreOffice:
  - Headless, one fresh profile per run.
  - Exit 0 does not mean success: compare the output file's modification time and size before and after.
  - Never report a timeout as success.
  - Use layered timeouts: an inner limit plus an outer backstop.
- Visual QA:
  - Render to PDF → images (pypdfium2) → look.
  - Delete old renders first; give each document a unique output name.
  - QA is bounded: one fix round, re-render only what changed, stop.
  - Review with "fresh eyes" (a separate reviewer).
- Vision images: long side ≤1000 px; record the final size.

### 5.2 docx
- Trigger only when the user names Word/.docx or gives a docx to change. A docx used only as source material does not count.
- **Set A4 explicitly** (11906×16838 twips), plus margins. Landscape: python-docx does not swap width and height, so swap them yourself.
- **Indic text:** set the complex-script font slot (Noto Sans Tamil/Devanagari), `w:hint="cs"`, **`w:szCs` (python-docx `font.size` writes only `w:sz`)**, `bCs` for bold, and the bidi language. Also override the template's theme fonts and its ar-SA bidi default.
- Tables: width set on the table grid AND on every cell, in absolute units, never percent. Columns must sum to the table width. Turn autofit off.
- Shading uses the "clear" pattern plus a fill colour (the "solid" pattern renders black).
- Lists: use a numbering definition, never typed bullet characters. A TOC needs heading styles or an outline level.
- Separate paragraphs, not newline characters. A page break goes inside a paragraph.
- A horizontal rule is a paragraph bottom border. Use right tab stops with dot leaders.
- Images declare their type.
- No python-docx API for shading, TOC, page fields or borders: use raw XML helpers.
- `.dotx` will not open in python-docx without patching its content type first.
- Editing:
  - Small edits go directly on the XML, not through a python-docx round-trip (python-docx re-serialises everything).
  - .doc → .docx first.
  - Merge fragmented runs. Never merge across tracked-change or link wrappers or across anchors. Merge only when formatting is identical. Cover headers, footers and footnotes too.
  - Paragraph count before vs after, as a cheap content-loss check.
- Word ID limits: paraId < 0x80000000, durableId < 0x7FFFFFFF. durableId is decimal in numbering.xml and hex elsewhere.
- Later (Phase 2):
  - Tracked changes (ins/del with id, author and date; delText; paragraph-mark deletion; schema order).
  - Comments (4 extra parts, each with a relationship and a content-type override; anchors as paragraph-level siblings; replies thread by paraId).
  - Redline check (undo only the new tracked changes, then diff the text).
  - Accept-all (beware phantom empty bullets).

### 5.3 xlsx
- Libraries:
  - New file: **XlsxWriter** (cached values, automatic `_xlfn.` prefix).
  - Edit an existing file: **openpyxl**.
  - Bulk data: pandas.
  - Quick read: python-calamine.
- Read formulas and values with two separate loads.
- Never save a file loaded values-only: it destroys the formulas.
- Write merged cells at the top-left only. `.xlsm` needs keep-VBA. Quote sheet names containing spaces.
- Ship with zero formula errors. Use live formulas, not values computed in Python. Follow the user's names and headers literally.
- Document every assumption and hardcoded number with its source; never invent a URL.
- A new template gets a legend + one example row. An edited file follows its own conventions and touches input cells only.
- Recalculation tool:
  - Must call UNO `calculateAll()`.
  - Fresh profile; check the file stamp afterwards.
  - Result has 2 shapes: "tool failed" vs "content errors".
  - Error list capped, but always give the true total.
  - Scan formula cells only, and include #SPILL!, #CALC! and LibreOffice "Err:" codes.
- Refuse when external links would lose their cached data.
- A clean recalc does not mean correct numbers: pilot 2–3 formulas first. Auto-checks:
  - formula consistent along each row
  - no constants inside formulas
  - lowercase formula text (a parse-failure sign)
  - every formula cell has a cached value after recalc
- Functions on **LO 24.2**:
  - Work: INDEX/MATCH, SUMIFS.
  - Work only with `_xlfn.`: TEXTJOIN, CONCAT, IFS, SWITCH, MAXIFS, MINIFS.
  - Fail: XLOOKUP, XMATCH, FILTER, UNIQUE, SORT, SEQUENCE, LET, LAMBDA.
  - No dynamic spill: only the top-left cell fills.
  - Action: pin the LO version in the image and re-probe; avoid spill functions by default.
- Finance conventions:
  - Colours: blue inputs, black formulas, green cross-sheet links, red cross-file links, yellow key assumptions.
  - Negatives in brackets, zero as a dash, units in the header, percentages stored as fractions, years as text.
  - One assumption per cell; consistent formulas; guard zero denominators.
- **Lakh/crore** (tested in LO):
  - A 3-tier conditional format breaks at ≥100 crore and loses the minus sign.
  - Combining brackets + dash with conditions collides.
  - `[$-4009]#,##0.00;(#,##0.00);"-"` gave correct en-IN grouping in LO, but `[$₹-4009]` gave Western grouping.
  - **Recommended:** the generator picks a per-cell tier format from the value (<1e5, <1e7, <1e9 …), with brackets for negatives and a dash for zero. Downside: the format is static if the user later edits the value.
  - Excel and Google Sheets behaviour: UNTESTED (user test file sent).
- Indian dates: parse day-first, flag ambiguous dates, display dd-mmm-yyyy. FY "FY2024-25" stored as text; quarters start in April.
- Set column widths before PDF export (otherwise `###`).

### 5.4 pptx
- **Set 16:9 exactly**: Emu(12192000)×Emu(6858000) (python-pptx defaults to 4:3).
- Structured deck:
  - Theme first (12 colour slots + heading/body fonts), then layouts with named placeholders.
  - Fill placeholders by name. A misspelt name fails silently.
  - Footer, logo and slide number live on the layout.
  - Chart text points at theme fonts (it otherwise defaults to Arial).
- Patch theme colours into the theme XML: all-or-nothing, hex only, escape the name.
- python-pptx limits:
  - Cannot duplicate slides.
  - Assigning text at text-frame level drops formatting; set run text instead.
  - No SVG/EMF: convert to PNG first.
  - Autofit is not computed: find overflow by rendering.
  - Gradients are supported; shadows, combo axes and trendlines need XML.
- Charts:
  - Native charts.
  - Stacked bars must not use the "outside end" label position.
  - Every chart group references at least 2 declared axes.
  - Default styling looks dated: add a title, data labels, palette and muted axes; no legend for a single series.
- Colours are 6 hex digits only.
- Text boxes carry the text-box flag (for accessibility). Speaker notes go in the notes area.
- Edit order: structure (add/delete/reorder) first, then content.
  - Duplicates share chart parts.
  - New IDs must be unique everywhere; strip the notes link on duplicates.
  - Orphan cleanup loops until nothing changes; content types are updated last.
- Template filling:
  - Delete whole groups when there are fewer items than slots.
  - One paragraph per item; copy the sibling paragraph properties; bullets inherit.
  - `xml:space="preserve"` for text with edge whitespace.
- Validator: a denylist of the errors PowerPoint really rejects (no false alarms), plus targeted chart checks.
- Thumbnails must be honest: hidden slides labelled; abort if the page count doesn't match.
- Design:
  - Topic-specific palette (1 dominant colour at 60–70%, 1–2 supporting tones, 1 accent).
  - Dark/light "sandwich" (dark title and closing slides, light content slides); one motif.
  - A visual on every slide; vary the layouts; big-number stat callouts.
  - Sizes: title 36–44 pt, headers 20–24 pt, body 14–16 pt.
  - Margins ≥0.5"; gaps 0.3–0.5".
  - Avoid:
    - centred body text
    - lines under titles
    - stripes or bars
    - beige backgrounds
    - low contrast
    - overflow
    - repeating the same layout
- **Fonts for QA trust:** use metric twins so LibreOffice renders match Office. Calibri→Carlito, Cambria→Caladea, Arial→Liberation Sans, Times→Liberation Serif. Aptos has no twin, so never use it.
- QA:
  - Grep for placeholder text.
  - Run the validator.
  - Render every slide and check overflow, overlap, footers, gaps, margins, alignment, contrast and leftovers.

### 5.5 pdf
- Libraries:
  - Create: reportlab (Platypus).
  - Merge, split, rotate, encrypt: pypdf.
  - Text and tables: pdfplumber.
  - Render: pypdfium2.
  - HTML → PDF: WeasyPrint (UNTESTED).
- **Indic text: reportlab needs `shaping=1` + uharfbuzz**, plus rlbidi for canvas-level text. Plain reportlab is broken for Indic.
- Merge with whole-document append: page-by-page copying loses bookmarks and forms.
- Check the decrypt result.
- Respect crop box, page origin and rotation.
- Use markup tags for sub/superscript (Unicode super/subscript characters show as black boxes in the base fonts).
- Linearise: not available in pypdf; report it as unsupported.
- "(cid:N)" text or empty text means the page needs OCR → route to the Stage 9 OCR service.
- Batch jobs: log each failure and continue; process large files page by page.
- Forms (Phase 2):
  - Steps run in order: detect → field JSON → value JSON → validate all → fill → render check.
  - Use full dotted field names; checkbox on/off values exact; radio values read from the appearances.
  - Collect every validation error before writing, and list the allowed values in each message.
  - If the "viewer must redraw" flag leaves fields blank, fall back to a flattened overlay.
  - Non-fillable forms: structure detection or zoom-crop on the image; one coordinate system per file; check box overlap and height.

## 6. Test evidence (container, LO 24.2.7, 2026-10-02)

| Test | Result |
|---|---|
| python-docx default | US Letter 12240×15840 twips; theme fonts Cambria/Calibri; Tamil defaults to Latha |
| python-pptx default | 4:3, 10×7.5 in |
| soffice convert | Works; cold run 1.85 s, warm ~1.25 s |
| Shared-profile concurrency | 1 of 3 jobs fails silently (3/3 trials); separate profiles 3/3 OK |
| AF_UNIX socket | Works in this container (Cloud Run sandbox: LV-1) |
| fc-match | Calibri→Carlito, Cambria→Caladea, Arial→Liberation Sans, Aptos→DejaVu (no twin) |
| Calibri width vs Carlito | UNTESTED (no Calibri available) |
| Excel functions | See 5.3 |
| XlsxWriter cached 0s | LO keeps the 0s on convert; only `calculateAll()` fixes them |
| Lakh formats | See 5.3 |
| reportlab plain Indic | FAIL |
| reportlab shaping=1 + HarfBuzz | PASS (used a ctypes shim; re-verify with the real uharfbuzz wheel) |
| python-docx → LO, cs slot set | PASS with Noto embedded; without it falls back to FreeSerif with no ligature |
| WeasyPrint | UNTESTED (PyPI blocked here) |
| ₹ glyph | Yes: Carlito, DejaVu, Noto, Free*. No: Liberation*, Caladea |
| User test files | `skill-tests/for-user/`: lakh_format_test.xlsx, a4_tamil_test.docx, deck_16x9_test.pptx. Real Excel / Sheets / Word / PowerPoint: pending (user) |

## 7. Proposed changes to Stage 8 decisions (need user OK)

| ID | Change |
|---|---|
| TD-4c+ | Image adds:<br>• defusedxml<br>• uharfbuzz + rlbidi<br>• python3-uno<br>• Carlito + Caladea<br>• confirm Noto Sans Tamil/Devanagari static fonts<br>• public ECMA-376 / ISO 29500 XSD schemas<br>• pin a LibreOffice version (prefer a newer one that supports the dynamic-array functions; re-probe) |
| TD-7+ | Builder defaults:<br>• A4 + Indic cs/szCs (docx)<br>• 16:9 EMU (pptx)<br>• XlsxWriter for new files, openpyxl for edits<br>• recalc via UNO `calculateAll()`<br>• per-cell lakh tier format<br>• amounts in Carlito/Noto (₹ glyph) |
| TD-5c+ | One LibreOffice profile per run; output stamp check; layered timeouts |
| TD-6+ | Tool results have two shapes, "tool failed" vs "content has errors"; capped lists always carry the true total |
| TD-13+ | Skills follow the agentskills.io format with the union rules (section 2); critical rules on top + closing checklist; evals use the model matrix |
| TD-15 (new) | `load_skill(name enum, resource?)`. No 12th tool. Already-loaded skills are not re-injected; loaded skills are protected from trimming; stable catalog order |
| LV-1+ | Cloud Run sandbox:<br>• AF_UNIX socket<br>• LibreOffice cold start<br>• real uharfbuzz<br>• WeasyPrint Tamil<br>• LO function probe on the pinned version<br>• Gemini skill-following behaviour |

## 8. Confidence

- Learnings coverage: 99% (all sources read fully once).
- Works in our stack: ~95%. Remaining items:
  - LV-1 (Cloud Run sandbox)
  - user tests in real Excel, Google Sheets, Word and PowerPoint
  - WeasyPrint
  - real uharfbuzz wheel
  - Gemini trigger and following evals (Stage 21)
  - legal review of the learning approach
