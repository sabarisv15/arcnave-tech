# ArcNave – Checkpoint · Stage 8 Tool execution – LOCKED 2026-10-02

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - TD-1c is now **12 tools** (Stage 11: memory_read added, memory_save → memory_write). TD-14 research exception (Stage 10 RG4). Doc-sync items of this checkpoint were applied on 2026-10-03.


> **Doc-sync 2026-10-03 (Stage 18) – see Stage-18-Cost-Performance/00-checkpoint-stage18.md + 00-Handoff/00-cost-decision-log.md:**
> - Accreditation skill packs (NBA SAR, NAAC SSR, AICTE approval) become MVP skill-pack candidates for the college segment – written and evaluated in Stage 21 alongside the existing 6 packs (FD-16).

> **Doc-sync 2026-10-03 (Stage 19) – see Stage-19-Infrastructure/00-checkpoint-stage19.md:**
> - TD-4b per-run fresh sandbox is realised as a **Cloud Run Job execution per run** (fresh microVM, inputs via signed GCS URL, results to a result bucket, job SA scoped to those, timeout 120 s); Cloud Run native sandboxes (Preview) = Later; GKE gVisor fallback if cold start too slow (Stage 19 ID-7).

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - Sandbox job timing (review R-2): dispatch deadline **20 s** (job start → first heartbeat) else `tool_failed/dispatch_timeout`; ER-4 run_code timeout 60/120 s = execution time inside the job (N-68).

> **Doc-sync 2026-10-03 (segment revision FD-21) – see 00-Handoff/00-cost-decision-log.md:**
> - Accreditation skill packs (NBA SAR / NAAC SSR / AICTE) → **Later (first vertical)**; MVP keeps the 6 generic packs (FD-21).

## Docs
| Doc | What |
|---|---|
| 08-tool-execution.md | Main Stage 8: facts, gaps TX1–TX25, Claude-only CX1–CX6, decisions TD-1…TD-14 |
| 08b-skill-learnings.md | Read-once record of the Anthropic skill docs + vendor skill docs + container tests. **Do not re-read the sources.** |
| 08c-skill-framework.md | 8.6 skill framework SF-1…SF-10 |
| 08d-tool-definitions.md | 8.7 tool definitions, spec rules TS-1…TS-12, decisions TD-16…TD-22 |

## Locked decisions (one line each)
- **TD-1c, 11 tools:** file_search, read_file, web_search, fetch_url, run_code (python/bash), memory_save, memory_delete, create_artifact, update_artifact, load_skill, get_operation_status.
- **TL-3:** no external actions; internal writes are OK.
- **TD-2b, search:**
  - Gemini uses our web_search tool, which runs a grounding-only Gemini sub-call (Web Grounding for Enterprise). Claude uses native web_search (basic only on Vertex).
  - Google-grounded results never go to Claude. No Perplexity.
  - You.com/Brave ZDR is checked before scaling.
- **TD-14, search cost:** off by default per chat; per-turn caps 1/3/8 (Fast/Normal/Deep); per-company monthly quota; prefer Gemini for search turns; trim fetched pages.
- **TD-3, fetch_url:**
  - Own fetcher service, zero-permission service account.
  - Only URLs from the user or from search results.
  - Full SSRF rules; 5 MB, 10 s; main text only.
- **TD-4b, sandbox:** Cloud Run sandboxes in a separate runner service, no egress. Agent Platform code execution is backup only.
- **TD-4c + TD-4c+, image:**
  - Python 3.12 data/office/pdf/chart libraries + LibreOffice + Noto Indic, Carlito, Caladea, Liberation, DejaVu fonts.
  - Added: defusedxml, uharfbuzz, rlbidi, python3-uno, public OOXML XSD schemas, pinned LibreOffice version.
  - Excluded: PyMuPDF (AGPL), pdfkit, tabula, unrar, pip, curl.
- **TD-5c + TD-5c+, sandbox limits:**
  - 60 s (Deep 120 s), 4 GiB, 1–2 vCPU.
  - `/input` read-only; `/output` → per-chat GCS workspace (~500 MB).
  - Files ≤30 MB each, ≤10 per run; runs per turn 1/3/8; ~5 parallel runs per company.
  - One LibreOffice profile per run; output stamp check; layered timeouts.
- **TD-5d, state:** stateless + per-chat workspace. Per-turn sandbox goes to LV-1 / Phase 2.
- **TD-6 + TD-6+, output:** model gets ≤8k tokens; full output saved as a file + pagination; "tool failed" and "content errors" are separate result shapes; capped error lists still give the true total.
- **TD-7 + TD-7+, building files:**
  - Model content + our builder template is the default; model code + `create_artifact(source_file)` is for custom layouts.
  - docx A4 + Indic cs/szCs; pptx 16:9 EMU.
  - xlsx: XlsxWriter for new files, openpyxl for edits; recalc via UNO `calculateAll()` + error scan; per-cell lakh tier format.
  - Amounts in fonts that have ₹ (Carlito/Noto).
- **TD-8:** charts are ECharts JSON only, no JS.
- **TD-9:** admin switches for web search, and for code execution + file creation together.
- **TD-10:** live status labels.
- **TD-11:** never copy anthropics/skills docx/xlsx/pptx/pdf or openai/plugins; Apache/MIT sources only, with notices.
- **TD-12:** one tool spec rendered by provider adapters.
- **TD-13 + TD-13+:** in-house skills in agentskills.io format; critical rules on top + closing checklist; model-matrix evals.
- **TD-15:** `load_skill(name enum, resource?)`; no 12th tool; no re-inject; protected from trimming; stable catalog.
- **SF-1…SF-10, skill framework:**
  - 6 skills: docx, xlsx, pptx, pdf, chart, **web-page** (renamed from web_page).
  - Standard folders; shared `arcnave_office` package; frontmatter union rules; fixed 8-section body.
  - Loader rules; script JSON contract + exit codes 0/1/2/3; ArcNave templates.
  - Must-cover rules per skill; eval framework + **99% release gate**; security + CI validator.
- **TD-16…TD-22, tool definitions:**
  - Minimal common schema keywords; no unions; optional params 14/24 + CI check; deterministic rendering.
  - Claude strict + auto only (never any/tool on 5.5); Gemini VALIDATED.
  - One envelope + 11 error codes; read tools in parallel, write tools in order.
  - New caps: fetch_url 2/5/10, artifacts 3/5/10.
  - Claude web_search runs through Brave, outside residency → privacy notice + lawyer.
  - v1 definitions written.
- **User decision:** full skill text (docx/xlsx/pptx/pdf/chart/web-page) is written in **Stage 21**, together with evals, so changes are easy. Target 99%.

## LV-1 additions from Stage 8
1. Cloud Run sandbox: availability in Mumbai, cold start, AF_UNIX socket for LibreOffice.
2. Per-turn sandbox: session affinity, RAM sharing.
3. Grounding sub-call latency.
4. Agent Platform sandbox, as backup.
5. Real uharfbuzz wheel (reportlab Tamil/Hindi); WeasyPrint Tamil shaping.
6. LibreOffice function probe on the pinned version (XLOOKUP etc.).
7. `input_examples` on Vertex Claude (canary).
8. Gemini `allowed_function_names` with VALIDATED.
9. Strict grammar first-call latency.
10. Gemini parallel-call ordering.
11. Gemini skill-following behaviour.

## Doc-sync debt created
- 06 policy spec + prompts v3:
  - rename `web_page` → `web-page`;
  - add "skill text is subordinate to system policy";
  - tool names/descriptions are rendered from 08d.
- 06 context assembly: add **CXD-11** (loaded skill content is never trimmed within the current task).
- 08 section I: "10 tools" → 11 tools (10 strict functions + Claude native search).
- 08 TD-13 wording: folders are `references/`, `assets/templates/`, `scripts/`, `evals/`.

## Lawyer list additions
- Learning-only use of the Anthropic skill docs.
- Grounding sub-call terms.
- Claude web search processed by Brave, outside data residency.

## Deferred
- Skill text + evals → Stage 21.
- Test kit (68 cases) run → Stage 21.
- Search price / You.com-Brave ZDR → Stage 18/20.
- OCR engine + scanned PDFs + M10/M11 → **Stage 9**.

## Doc-sync 2026-10-05 (Stage 21 Task 0.9 brief – tools + explicit cache live tests)
- `08d-tool-definitions.md` is now mirrored into the repo (`docs/architecture/checkpoints/`, byte copy) – the LV tool fixture and the Phase 1 tool registry render from it.
- **LV-15** (Task 0.9): the 12 tools of 08d §4/§5 rendered with `FunctionDeclaration` + `parameters` (TS-7) are sent to Gemini 3.8 Flash on `global` in mode `VALIDATED`: accepted or not, call shape valid against our schema, round trip with the §3 success and error envelopes, `additionalProperties:false` accepted or not (TS-2), token size of the tool block (input for FD-01).
- **LV-34** (Task 0.9): `allowed_function_names` with `VALIDATED` vs the `ANY` control (TS-8 fallback), parallel calls observed, reply order and thought-signature rules (TS-10 / TD-19). Skill-following (LV-1 addition #11) stays open until the skills exist (Stage 21 skill text).
- **LV-128** (Task 0.9, from ADR-0003): explicit context cache holding system instruction + tools + tool config on `global` – hits, what a request may still add (per-request system text, tools, tool config), minimum size, permissions (`aiplatform.cachedContents.*` in a separate LV-only custom role; the predict-only role of ID-10 is not changed).
- Claude tool tests (strict-grammar latency LV-33, `input_examples` canary) wait for own-project Claude 5.5 (ADR-0002).

## Doc-sync 2026-10-05 (Stage 21 Task 0.9 review – LV-15 / LV-34 results)
- **TS-7 confirmed (LV-15 PASS):** our 12 schemas (`FunctionDeclaration` + `parameters`) are accepted by Gemini 3.8 Flash in mode `VALIDATED`; calls match the schema; round trip with the §3 success and error envelopes works. Tool block ≈ 2,100–2,300 tokens.
- **TS-2 refined per provider:** `additionalProperties:false` is accepted by Gemini live, but it is not in Google's documented list of supported schema fields → the **Gemini adapter omits it**; the Claude adapter keeps it (strict mode requires it).
- **TS-8 confirmed (LV-34):** helper sub-calls keep `ANY` + `allowed_function_names` (only `file_search` returned). `allowed_function_names` with `VALIDATED` is documented and accepted, but the test could not show enforcement. Helper sub-calls with `ANY` cannot use the explicit cache (ADR-0004) – they are sent uncached.
- **TS-10 / TD-19 confirmed:** Gemini returned 3 calls in one response (two reads, then `memory_write` last); the thought signature is only on the first call; the model content must go back **unchanged** – removing the signature gives 400. All responses come after all calls; the API accepted them in reverse order too, but the orchestrator still answers in call order.
- Skill-following (LV-1 addition #11) stays open until the skills exist (Phase 3).

## Doc-sync 2026-10-05 (Stage 21 Task 0.10 brief – sandbox live tests)
- LV-1 additions #1 (Cloud Run sandbox: availability, cold start, AF_UNIX for LibreOffice) → LV-27 / LV-109 in Task 0.10 with a size-proxy LibreOffice image (Debian packages, not the TD-4c product image). Cloud Run's Preview "sandboxes" product: doc check only (Later candidate, Stage 19 ID-7).
- LV-1 addition #2 (per-turn sandbox: session affinity, RAM sharing = LV-28) is **N/A**: TD-4b is realised as a fresh job execution per run (Stage 19 ID-7), no long-lived sandbox.

## Doc-sync 2026-10-05 (Stage 21 Task 0.10 review – sandbox live tests)
- TD-4b / TD-5c verified (Stage 19 doc-sync same date): per-run job execution starts in ≈ 7–11 s, isolation holds, the 60 / 120 s inner limit mechanism works, LibreOffice UNO over AF_UNIX works inside the job (soffice start 1.8 s, Writer → PDF 0.5 s, proxy image). LV-1 addition #1 PASS (LV-27 / LV-109); #2 N/A (LV-28).
