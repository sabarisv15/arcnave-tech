# 08c — Skill framework (Stage 8.6)

Status: LOCKED 2026-10-02 (user OK). Date: 2026-10-02.
Scope: the common skeleton every ArcNave skill must follow. The full text of each skill is written in Stage 21 together with its evals (user decision 2026-10-02).
Inputs: 08b-skill-learnings.md (all facts and sources), 08-tool-execution.md (TD-1…TD-15), 06 policy spec / prompts (`<skills>` + `<available_skills>` blocks).

---

## SF-1. Skill list and names

| Skill name | Output | Needs sandbox? | MVP scope | Later |
|---|---|---|---|---|
| `docx` | Word document | Yes | Create new docs; simple edits to a user docx (text, tables, styles) | Tracked changes, comments, accept-all |
| `xlsx` | Spreadsheet | Yes | Create new workbooks (XlsxWriter); edit user workbooks (openpyxl); recalc + error scan | Pivot tables, macros (never written) |
| `pptx` | Slide deck | Yes | Create from the ArcNave brand template; simple edits to a user deck | Full template-fill from user decks, slide duplication |
| `pdf` | PDF file | Yes | Create (reportlab Platypus with shaping, or docx → PDF via LibreOffice); merge/split/rotate/extract | Form filling (fillable and overlay) |
| `chart` | ECharts JSON artifact | No | Chart choice, labels, units, accessible colours, Indian number format | Dashboards |
| `web-page` | Single-file HTML artifact | No | Self-contained page, no network, no forms that collect credentials | — |

- **Name change:** `web_page` → **`web-page`**. The spec allows only `[a-z0-9-]`; an underscore fails validation. The 06 policy spec and prompts need this change (doc-sync item).
- Names never contain "claude" or "anthropic", per the Anthropic rule.

## SF-2. Folder layout (agentskills.io standard)

```
skills/
  <name>/
    SKILL.md            # required: frontmatter + body (≤500 lines, ≤5k tokens)
    references/         # read on demand via load_skill(name, resource)
    assets/
      templates/        # brand templates (docx/pptx/xlsx base files), copied into outputs
    scripts/            # run in the sandbox via run_code; never read into context unless debugging
    evals/              # evals.json + input files; never shipped to runtime
```

- This changes the TD-13 wording. "reference/templates" becomes the standard names `references/` and `assets/templates/`, so the skills stay portable.
- Exactly one SKILL.md per skill, at its root. References sit one level deep, with no reference-to-reference chains.
- **Shared code is not a skill.** Common helpers live in an internal Python package, `arcnave_office`, baked into the sandbox image. It covers:
  - safe unzip/rezip
  - the relationship resolver
  - the LibreOffice runner (fresh profile, file stamp check, layered timeouts)
  - render-to-PNG (pypdfium2)
  - the baseline validator
  - Indian number and date formatting

  Skill scripts import it, so the same code is never copied into each skill.

## SF-3. Frontmatter (union of all vendor rules; enforced by our validator)

```yaml
---
name: docx                      # kebab-case, ≤64 chars, = folder name
description: "…"                # 1–1024 BYTES, no < >, quoted (colons)
license: Proprietary - ArcNave
compatibility: "ArcNave sandbox image vX; python-docx 1.2, LibreOffice …"   # ≤500 chars
metadata:
  version: "1.0.0"              # semver; bumped on every change
  owner: "arcnave-ai"
  models_tested: "gemini-3.8-flash, claude-sonnet-5.5, claude-opus-5.5"
  needs_sandbox: "true"
  eval_pass: "2026-xx-xx"       # date of the last full eval pass
---
```

- No other top-level keys. `allowed-tools` is not used (it is Claude Code-only).
- **The description pattern is three parts:**
  - a third-person "what" sentence;
  - "Use when …" (intent categories, key cases first);
  - "Do not use for …" (the near-miss formats).

  Final wording is chosen in Stage 21 by trigger evals.

## SF-4. SKILL.md body template (same section order in every skill)

1. **Critical rules** (5–8 lines). The rules whose violation breaks the output (for example A4 + Indic font slot for docx). They sit at the top because:
   - Gemini treats a mid-chat skill as early context, so the top survives best;
   - any truncation keeps the start.
2. **Choose the path.** Create vs edit vs read, with one default and an escape hatch rather than a menu.
3. **Workflow checklist.** Numbered, copyable steps per path, ending in the QA loop.
4. **India defaults.** Paper and slide size, fonts, ₹ and lakh/crore, dates, financial year. Shared wording comes from one snippet so all skills match.
5. **Gotchas.** The highest-value section. Each item is "do X, because Y fails".
6. **QA loop.** Validate → render → look → fix → re-render only what changed → stop after one fix round, unless a critical check fails.
7. **Resources map.** Each reference, template and script, plus WHEN to read or run it ("Read `references/tables.md` before building any table with merged cells").
8. **Before you deliver.** A 3–5 line closing checklist that repeats the hardest constraints (for Gemini's end placement).

Style rules:
- Imperative voice; explain the reason for each rule.
- No ALL-CAPS.
- One term per concept.
- Forward-slash paths.
- No dates or version-sensitive claims in the body; those go in `metadata`.

**One text for both models.** If evals show that one model needs extra guidance, add a short `references/model-notes-<vendor>.md`, which the body tells only that model to read. The loader knows the model and adds a one-line pointer. There are no forked skill bodies.

## SF-5. Loader (TD-15, accepted)

| Part | Rule |
|---|---|
| Catalog | Stays in the cached static system block `<available_skills>` (as in the 06 prompt), in a stable order, and lists only the enabled skills. Each entry is the description from SKILL.md frontmatter (single source). |
| Gating | Admin switch TD-9 off (code exec + file creation) → `docx/xlsx/pptx/pdf` are removed from the catalog and the enum. `chart` and `web-page` stay. No skills enabled → `load_skill` is not registered. |
| Call | `load_skill(name: enum, resource?: string)`. Without `resource` it returns the body; with `resource` (a path from the resource list) it returns that file. |
| Return | Frontmatter stripped; `<skill_content name="docx" version="1.0.0">body</skill_content>` + `<skill_resources>` path list. Scripts and templates are listed as "run/copy only". |
| Size | Body ≤5k tokens. Each reference ≤6k tokens, under the TD-6 8k tool-output cap, so a resource is never truncated. Our validator enforces both. |
| Dedupe | A per-chat `loaded_skills` set (skill + version). A second load returns "already loaded (v1.0.0), see earlier turn". |
| Protection | Context assembly (CXD) never trims loaded skill content inside the current task's turns. **Add to the Stage 6 CXD list as CXD-11.** |
| Version pin | The skill version is fixed per chat turn. A mid-chat deploy does not change a skill that is already loaded. |
| Priority | The system prompt states that skill text is ArcNave guidance and is subordinate to system policy and user safety rules. **Add to the policy spec.** |
| Sandbox path | Skill folders are mounted read-only in the sandbox at `/skills/<name>/`, and scripts are run from there via `run_code`. |
| Logging | Every load, resource read and script run (skill, version, model, status, tokens, ms) goes to the event log for evals and Stage 17 observability. |

Source of truth: one `skills/` repo, built into both the API image (for load_skill text) and the sandbox image (for scripts and templates), with the same version tag. A deploy fails if the two differ.

## SF-6. Script contract (every script in every skill)

- Python 3.12, image libraries plus `arcnave_office` only. No network, no pip, no interactive input.
- `--help` is supported. Inputs come as CLI arguments or a JSON file. Outputs go to `/output`; `/input` is read-only.
- **stdout carries exactly one JSON object.** Diagnostics go to stderr.

  ```json
  {"status": "ok" | "content_errors" | "tool_error",
   "summary": "one line for the model",
   "errors": [{"type": "...", "where": "Sheet1!C5", "fix": "..."}],
   "errors_total": 0,
   "outputs": ["/output/report.docx"],
   "next": "what the model should do now"}
  ```

- Exit codes:
  - 0 = ok
  - 1 = content errors (the file is built but has problems)
  - 2 = tool error (nothing built)
  - 3 = bad usage
- Error lists are capped at 20 entries, always with `errors_total`.
- Output size stays under TD-6's 8k tokens. The full log is saved as a file and offered with pagination.
- Scripts are idempotent, so a rerun gives the same result. `--dry-run` is supported for destructive edits.
- Every side effect is checked. An output stamp check catches "exit 0 but no file". A timeout is always reported as a `tool_error`.
- No unexplained constants. Every number in a script carries a comment giving its source or reason.

## SF-7. Templates and branding

- `assets/templates/` holds the ArcNave default brand bases:
  - docx: A4, styles, Noto Indic cs fonts
  - pptx: 16:9, theme with 12 colours, named layouts
  - xlsx: styles and a number-format set

  Each is built by our own script from library docs, never copied from any third party.
- **Company brand (Later):** a company admin uploads a logo and colours, and the per-company template is generated from our base. MVP uses the ArcNave default only.
- Fonts: only fonts in the image (Noto + Indic, Carlito, Caladea, Liberation, DejaVu). Amounts use fonts that have ₹ (Carlito or Noto). Never Aptos.

## SF-8. Key rules checklist per skill (input for Stage 21 writing)

Full detail is in 08b section 5. This is the must-cover list.

- **docx:**
  - A4 + margins
  - Indic cs font + szCs + bidi language; override theme fonts
  - table widths on grid + cells, no percent
  - shading uses the clear pattern
  - real numbering lists
  - TOC via heading styles
  - edits as direct XML on fragmented runs (merge rules)
  - paragraph-count check
  - LibreOffice render QA
- **xlsx:**
  - XlsxWriter for new files, openpyxl for edits
  - formulas, not values
  - recalc via UNO `calculateAll()`
  - zero errors before delivery
  - function allow/deny list from the pinned-LibreOffice probe
  - no spill functions
  - `_xlfn.` prefix
  - per-cell lakh tier format
  - Indian dates and financial year
  - assumptions documented
  - edit mode follows the file's own conventions
- **pptx:**
  - 16:9 EMU
  - theme-first structured deck
  - fill placeholders by name
  - python-pptx limits (run text, no SVG, no duplicate)
  - native charts with the stacked-label and axis checks
  - metric-twin fonts
  - design rules (palette, sandwich, motif, a visual per slide, the avoid list)
  - render QA for overflow
- **pdf:**
  - Platypus with `shaping=1` (uharfbuzz) for any Indic text, or the docx → LibreOffice route
  - whole-document merge
  - crop box and rotation
  - decrypt result checked
  - "(cid:" or empty text → OCR route (Stage 9)
  - no Unicode super/subscripts in base fonts
- **chart:**
  - ECharts option JSON only, no JS functions (TD-8)
  - type choice by data shape
  - units and labels
  - accessible palette
  - lakh/crore axis and tooltip formatting through a supported formatter-template string
  - research ECharts docs once in Stage 21
- **web-page:**
  - one file, no network or external assets
  - no credential or payment forms (06 policy)
  - data embedded in the page
  - CSP and sandboxed preview rules (Stage 6 CR-1); research once in Stage 21

## SF-9. Eval framework and the "99%" gate (Stage 21)

Per skill, `evals/evals.json`:
- **Output cases:**
  - Start with 3 realistic cases (Indian business tasks with real-looking input files), and grow to about 15.
  - Each case has code-checked assertions: the file is opened and its content checked, not just its existence. Examples: page size = A4, the Tamil run has a cs font, no formula errors, ₹ formatting.
- **Trigger cases:**
  - 20 queries: 10 should trigger and 10 are near-miss negatives (docx vs pdf, xlsx vs chart, chart vs web-page, pdf-read vs pdf-create).
  - Tanglish and English mixed, typos included.
- **Model matrix:** Gemini 3.8 Flash, Sonnet 5.5 and Opus 5.5, each with the skill and without it (or with the previous version). 3 runs each.
- **Grader:**
  - A script for objective checks.
  - A cross-vendor model judge for subjective checks (design quality, using blind A/B).
  - Evidence is required; no partial credit.

**Release gate ("99% confidence")** for a skill version:

| Gate | Threshold |
|---|---|
| Critical assertions (file opens, A4/16:9, Indic shaping, zero formula errors, ₹ glyph) | 100% pass, all 3 models, 3/3 runs |
| All assertions | ≥95% pass per model |
| With-skill vs without | Better or equal on every model; no assertion passes only *without* the skill |
| Trigger: should-trigger | ≥0.5 trigger rate per query, on held-out queries, every model |
| Trigger: near-miss negatives | <0.5 trigger rate per query, held-out, every model |
| Real-app check | Output opened OK in MS Office + Google Docs/Sheets/Slides (human, a sample) |
| Variance | No case flaky (passing in only 1 of 3 runs) on a critical assertion |
| Cost | Tokens and time recorded; there is no gate yet (the Stage 18 cost analysis sets one) |

Upgrades follow the Stage 7 rule: eval → canary → full rollout. Every change to a skill bumps its version and reruns the evals.

## SF-10. Security and governance

- Skills are written and reviewed only by the ArcNave team. There are no user or company-uploaded skills in MVP.
- Skills never fetch URLs and never call external tools on their own.
- Scripts run only inside the zero-permission, no-egress sandbox (TD-4b).
- The validator runs in CI on every skill change: frontmatter rules, size limits, link check of the resources map, script `--help` smoke test, JSON contract test.
- Licence:
  - No third-party skill text or code.
  - The Apache/MIT sources we use carry notices.
  - The learning approach is on the lawyer list.

---

## Decisions in 8.6

| ID | Decision |
|---|---|
| SF-1 | 6 skills; `web_page` renamed `web-page`; MVP/Later scope as in the table |
| SF-2 | Standard folders (`references/`, `assets/templates/`, `scripts/`, `evals/`); shared code in the `arcnave_office` package |
| SF-3 | Frontmatter: union rules, metadata fields, 3-part description |
| SF-4 | Fixed 8-section body order; critical rules first, closing checklist last; one text for both models |
| SF-5 | Loader details (TD-15): catalog in the static block, gating, dedupe, protection (new CXD-11), version pin, read-only mount, logging |
| SF-6 | Script JSON contract + exit codes |
| SF-7 | ArcNave default templates built by us; company branding Later |
| SF-8 | Must-cover rules per skill |
| SF-9 | Eval framework + 99% release gate |
| SF-10 | Security, governance, CI validator |

Doc-sync items created:
- 06 policy spec and prompts: rename `web-page`; add the skill-subordinate-to-policy rule.
- 06 context assembly: add CXD-11.
- 08 TD-13 wording: folder names.

Confidence: 97%. The remaining risk is Gemini's skill-following behaviour, which is checked by the SF-9 evals in Stage 21; SF-4 and SF-5 are designed so changes stay small.
