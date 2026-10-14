# ArcNave – Stage 8 · Tool execution – LOCKED
_2026-10-02 · Source: GPT Astra (official URLs + quotes, checked 2 Oct 2026) + saved facts · Status: LOCKED 2026-10-02 (see 00-checkpoint-stage8.md; detail docs 08b skill learnings, 08c skill framework, 08d tool definitions)_

> **Doc-sync 2026-10-03 (Stage 12) – Stage 12 Retrieval (see Stage-12-Retrieval/00-checkpoint-stage12.md):**
> - TD-4c: **DuckDB (MIT, locked down: allowed_paths, no external access/extension install)** added to sandbox image for SQL over CSV/Parquet (Stage 12 RE17/RE39).


> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - **Tools = 12** (Stage 11): memory_save → memory_write, memory_read added (section I "10 tools" and TD-1c "11 tools" are superseded).
> - TD-13 folders = `references/`, `assets/templates/`, `scripts/`, `evals/` (08c SF-2).
> - TD-14 exception (Stage 10 RG4): a research run enables search for that run only, cap 50 searches.
> - Sandbox input for large Excel = per-sheet CSV/Parquet (Stage 9 G44); parser sandbox service (Stage 9 G34) reuses the runner design (no egress, no secrets).


> **Doc-sync 2026-10-03 (Stage 14) – see Stage-14-Streaming-Rendering/00-checkpoint-stage14.md:**
> - TD-8 charts: web ECharts JSON unchanged; Android renderer @wuba/react-native-echarts provisional (licence conflict Apache vs MIT → lawyer LW-20); static SVG via ECharts SSR Later.

## Corrections to earlier facts
- Agent Platform (Agent Engine) code sandboxes are now listed in **asia-south1 Mumbai** (was "us-central1 only").
- DPDP Act §16 has no blanket India-only storage rule; India-only storage stays an **ArcNave product requirement**. Google's data-residency terms **exclude Grounding with Google Search and Web Grounding for Enterprise**.

## Real-product evidence
| | ChatGPT Business/Ent | Claude Team/Ent | Gemini app/Workspace | Perplexity Ent |
|---|---|---|---|---|
| Sandbox | Stateful Python/Jupyter; **internet blocked**; upload 512 MB/file | File creation 30 MB in/out; network configurable (off = preinstalled packages only) | Not documented | Not documented |
| Activity shown | User can review generated code, outputs, assumptions | Action summaries + "searching the web" indicator | Code view + console (Canvas) | Background tasks |
| Admin switches | Web search on/off; Canvas Python off (Ent) | Code execution + file creation one org switch; web search org switch ✅ | Gemini app on/off only | Computer master switch |

## Key facts
| ID | Fact | Status |
|---|---|---|
| B1 | Gemini 3.8 Google Search grounding on global: 5,000 free/month (all Gemini 3), then $14/1k queries; Search Suggestions may be omitted below 1M grounded prompts/day; terms forbid caching/analysing/reselling/training; passing grounded results to Claude not permitted by any doc | Partial |
| **B2** | **Vertex: Google Search grounding cannot be combined with custom function declarations in the same request** ("Multiple tools are supported only when they are all search tools") | Confirmed |
| B3 | Web Grounding for Enterprise: curated index, **doesn't log customer data**, VPC-SC, same $14/1k for Gemini 3, works on 3.8 global | Confirmed |
| B4 | Claude web_search on Vertex: max_uses, allowed **or** blocked domains, user_location; org policy `vertexai.allowedPartnerModelFeatures` must allow `…claude-sonnet-5-5:web_search` (+ Opus); blocked by VPC-SC; citations must be shown | Confirmed |
| B5 | Perplexity Search API $5/1k (fast $1/1k); **terms let Perplexity retain and use search data; personal data needs written permission** | Partial |
| B6 | Custom Search JSON API closed to new customers, ends 1 Jan 2027; Vertex AI Search only for ≤50 configured domains | Confirmed |
| C1 | Gemini URL context: 3.8 supported, 20 URLs/request, content billed as input | Partial |
| C2 | OWASP SSRF: block private/loopback/link-local/metadata IPs (IPv4+IPv6), check all DNS answers, no auto-redirect (or re-check each hop), http/https only | Confirmed |
| C3/D2 | Cloud Run parent container can't be blocked from the metadata server (no documented switch); all-traffic Direct VPC egress without NAT blocks internet but not internal/Google paths | Partial |
| D1/D3 | **Cloud Run sandboxes (Preview)**: child sandbox for untrusted code inside Gen2 service/job; outbound traffic + metadata blocked by default; `sandbox do` = fresh sandbox destroyed after exit; control rootfs/mounts. Cloud Run instances are reused between requests | Confirmed (Preview) |
| D4 | Cloud Run max 32 GiB / 8 vCPU; filesystem uses RAM; service timeout 60 min (504 doesn't kill code → own deadline); jobs 168 h | Confirmed |
| E1 | Tool results: paginate/filter/truncate; 25k tokens is Claude Code's default example, not a rule | Partial |
| E2 | Gemini parallel calls: return all results, calls first then responses; max per turn not documented | Partial |
| E3 | Own loop must enforce max steps (SDK's 10-call default doesn't apply when auto calling is off) | Confirmed |
| F1 | python-docx, openpyxl, python-pptx MIT; ReportLab BSD; WeasyPrint BSD; LibreOffice MPL-2.0; pandoc GPL (server-only use OK) | Confirmed |
| F2 | LibreOffice headless converts DOCX/XLSX/PPTX → PDF (separate profile per worker); Office layout parity not guaranteed | Confirmed |
| F3 | ECharts Apache-2.0, JSON option spec; React Native via third-party `@wuba/react-native-echarts`; Vega-Lite no RN; Recharts not a JSON spec | Partial |

## Gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| TX1 | **Gemini can't use Google grounding + our tools in one call** → web_search must be our own function; for Gemini it runs a separate grounding-only sub-call and returns sources | ✅ Vendor (B2) | MVP (TD-2) |
| TX2 | Grounded results must not be passed to Claude → Claude uses its own web_search | ✅ Vendor terms (B1) | MVP |
| TX3 | B2B privacy: prefer Web Grounding for Enterprise (no logging) over standard Search | ✅ Vendor (B3) | MVP |
| TX4 | Perplexity Search API terms (retain/use data, personal-data permission) unfit for company data | ✅ Vendor (B5) | Not MVP |
| TX5 | Grounding excluded from India residency → disclose in privacy docs; company admin web-search switch (TL-2) | ✅ Vendor | MVP |
| TX6 | Own fetch_url (Claude has no fetch on Vertex; Gemini URL context can't mix with our tools) with OWASP SSRF rules | ✅ Vendor | MVP |
| TX7 | Fetcher + sandbox run as separate services with a **zero-permission service account** (metadata token useless) and no VPC access | ✅ Vendor (C3) + 🔧 | MVP |
| TX8 | Sandbox = Cloud Run sandboxes (Preview): fresh sandbox per run, egress + metadata blocked, own image with python-docx/openpyxl/python-pptx/WeasyPrint/pandas/matplotlib | ✅ Vendor (D1/D3) | MVP + LV-1 (Preview risk) |
| TX9 | Stateless code runs: chat files mounted read-only, outputs saved to GCS; no variables kept between runs | 🔧 ArcNave | MVP |
| TX10 | Own deadlines (504 doesn't stop code); memory cap counts filesystem | ✅ Vendor (D4) | MVP |
| TX11 | Tool result cap + pagination ("more results available") | ✅ Vendor (E1) | MVP |
| TX12 | Parallel calls: execute read-only in parallel, writes in order; return all results together | ✅ Vendor (E2) + locked L4 | MVP |
| TX13 | Step limits from profiles (Fast 1–2 / Normal 5 / Deep 15) enforced by orchestrator | ✅ Vendor (E3) + locked O-2 | MVP |
| TX14 | Activity display: "Searching the web…", "Running code…" + expandable code/results | ✅ Vendor (ChatGPT, Claude) | MVP |
| TX15 | Company admin switches: web search (TL-2) + code execution & file creation together (like Claude) | ✅ Vendor | MVP |
| TX16 | File build: python-docx / openpyxl / python-pptx; PDF via WeasyPrint; previews: LibreOffice → PDF, shown with a PDF viewer | ✅ Vendor licences (F1/F2) | MVP |
| TX17 | Charts: ECharts JSON option, **no JavaScript functions allowed in options** (pure JSON) | ✅ Vendor (F3) | MVP |
| TX18 | Agent Engine code execution (Mumbai) = alternative sandbox; check libraries, pricing, status | ⚠️ Partial | LV-1 |
| TX19 | Clarify locked TL-3 "read-only tools": means **no external actions** (email, payments); internal writes (memory, artifacts) allowed | 🔧 ArcNave | MVP |

## Claude-only
| # | Fact | Rec |
|---|---|---|
| CX1 | Claude web_search (server tool) works together with our client tools | Claude: native web_search + our tools in one call |
| CX2 | Org policy must allow web_search per model; blocked by VPC-SC | Allow Sonnet + Opus; note before any VPC-SC plan |
| CX3 | Citations must be shown; $10/1k searches; max_uses; allowed **or** blocked domains | max_uses per profile (Fast 1, Normal 3, Deep 8) |
| CX4 | No web fetch / code execution / Skills on Vertex | Our fetch_url, run_code, load_skill |
| CX5 | Encrypted search content must be replayed exactly (L5i) | Gateway rule |
| CX6 | No forced tool use on 5.5 | Orchestrator decides flow |

## Decisions (recommendations – need OK)
| ID | Question | Rec |
|---|---|---|
| TD-1 | MVP tool list | file_search, web_search, fetch_url, run_code, memory_save, memory_delete, create_artifact, update_artifact, load_skill, get_operation_status (10 tools) |
| TD-2 | Web search | Gemini main → our web_search tool runs a **grounding-only Gemini sub-call with Web Grounding for Enterprise**, returns answer snippets + sources as [web:n]; Claude main → Claude native web_search. Perplexity Search API not used. Grounding use stays inside Gemini (never fed to Claude). Vendor/legal check: sub-call pattern vs grounding terms |
| TD-3 | Fetch | Own fetch_url service (OWASP SSRF rules, max size, timeout, text extraction), zero-permission service account |
| TD-4 | Sandbox | Cloud Run sandboxes (Preview) in a separate runner service, fresh per run, no egress, zero-permission SA, own image; Agent Engine (Mumbai) as backup option after LV-1 |
| TD-5 | Sandbox limits | Per run: 60 s (Deep 120 s), 2 GiB RAM, inputs read-only, outputs ≤30 MB, no packages install |
| TD-6 | Tool result size | Default cap ~8k tokens per result with "more available" + pagination |
| TD-7 | Files & previews | python-docx / openpyxl / python-pptx; PDF via WeasyPrint; previews via LibreOffice → PDF viewer |
| TD-8 | Charts | ECharts JSON options (no functions), web + React Native adapter |
| TD-9 | Admin switches | Web search (TL-2) + code execution/file creation (one switch) per company |
| TD-10 | Activity display | Short live status per tool + expandable code and sources |

---
## Round 2 research (Astra, 2 Oct 2026) – search APIs, repos, tool definitions, sandboxes, file libraries

### G. Cheaper raw web-search APIs
| | Brave | Exa | Tavily | You.com | Mojeek |
|---|---|---|---|---|---|
| Price /1k | $5 ($5 free credit/month) | $4–7 | $8 (basic) / $16 (advanced) | $5 (+$1/1k pages for live full text) | £2–3 |
| Full text | LLM Context chunks | text/highlights up to 10 results | optional raw content | optional Markdown/HTML | snippets only |
| Query data | kept ≤90 days; DPA **excludes search queries**; Enterprise ZDR | privacy policy allows **training on queries**; Enterprise ZDR | used to improve; sensitive inputs forbidden | **no training on prompts** unless opted in; Enterprise ZDR (Search); **DPA published** | API terms not found |
| Storing / LLM use | transient storage only (unless plan grants); LLM grounding OK | LLM grounding OK; storage unclear | "internal business purposes" wording – legal review | LLM grounding OK; "internal business purpose" MSA – legal review | LLM use + display OK; Business plan may store |
| Location | US | not stated | US | US | UK |
Effective cost note: Gemini grounding includes page content tokens free; a raw API's snippets/pages are billed as model input tokens, so real saving vs $14/1k is ~2×, not 10×.

### H. Official GitHub repos – reuse rules
| Repo | Useful for | Licence → ArcNave use |
|---|---|---|
| anthropics/skills – docx, xlsx, pptx, pdf | Doc skill packs | **Restrictive licence – do NOT copy or adapt** (even reading-to-learn: legal review) |
| anthropics/skills – skill-creator, mcp-builder, web-artifacts-builder | Skill authoring, web artifacts | Apache-2.0 – adapt with notice |
| anthropics/claude-cookbooks, claude-quickstarts | Tool use, custom skills, self-hosted sandbox, python-docx generator | MIT – adapt with notice |
| openai/openai-cookbook, openai-agents-python | Sandbox examples, tool schemas, skill loading | MIT – adapt with notice |
| openai/skills (deprecated) – pdf, skill-creator | PDF skill, authoring | Apache-2.0 folders only |
| openai/plugins – report/chart folders | Reports, charts | **No licence found – do NOT copy** |
| google/adk-python | SkillToolset, container code executor | Apache-2.0 – adapt with notice |
| google-gemini/cookbook | Function calling, code execution notebooks | Apache-2.0 |
| GoogleCloudPlatform/generative-ai | Skill registry; demo skills: professional-document (python-docx/reportlab), presentation, web-report | Apache-2.0 – **best adaptable base for our skill packs** |
| perplexityai/perplexity-py, modelcontextprotocol, api-cookbook | API clients, MCP search server | MIT/Apache – clients only |

### I. Tool definitions
- Claude: name `^[a-zA-Z0-9_-]{1,128}$`; description ≥3–4 sentences (purpose, when / when not, params, output, limits); enums; `input_examples`; `strict: true` with `additionalProperties: false`; 5.5 = `auto` only. Errors: `tool_result` with `is_error: true` + instructive message (what failed, what to try).
- Gemini/Vertex: name ≤64 chars, starts with letter/underscore, letters/digits/`_ . -`; precise descriptions; enums; Gemini 3 needs required params declared; `VALIDATED` mode enforces schema; `allowed_function_names`. Errors: FunctionResponse `{"error": …}` vs `{"output": …}`.
- Tool count: Google 10–20 max, OpenAI < 20, Anthropic suggests tool search from 10+ → our 10 tools OK, all loaded.

### J. Sandboxes
| | Cloud Run sandboxes | Agent Platform Code Execution (ex Agent Engine) |
|---|---|---|
| Status | Preview | Preview (custom container mode also Preview) |
| Mumbai | Cloud Run yes; feature-specific statement not found → LV-1 | **asia-south1 listed** |
| Start | ~500 ms average (demo) | not stated |
| Isolation | fresh per `sandbox do`; egress, metadata, env vars, secrets blocked by default | managed sandbox |
| Libraries | **our own image** (any library, fonts, LibreOffice) | preinstalled python-docx 1.1.2, openpyxl 3.1.5, python-pptx 1.0.2, reportlab, matplotlib, pandas; **can't add libraries** |
| Limits | shares parent CPU/RAM (max 8 vCPU / 32 GiB) | 100 MB in/out, 2 vCPU/1.5 GB (opt 4/4), state TTL ≤14 days |
| Price | normal Cloud Run billing, no premium | $0.085/vCPU-h + $0.009/GiB-h |
→ Cloud Run sandboxes win for quality: we need LibreOffice (formula recalculation, previews), WeasyPrint, Indian-script fonts, newer python-docx.

### K. File libraries – facts for skill packs
- openpyxl **never calculates formulas** → recalc step: LibreOffice headless (`calculateAll`) → save → re-read values → scan for #REF!/#DIV/0!/#VALUE!.
- python-pptx: no combo or 3D charts; reuse template masters/layouts; set one image dimension to keep ratio; tables don't auto-split across slides.
- python-docx: comments only from 1.2.0; no TOC generation API (update fields via LibreOffice); headers/footers per section.
- WeasyPrint: page sizes/margins, running headers/footers, page counters, page breaks; Tamil/Devanagari need installed fonts (e.g. Noto) + render check.

## Round 2 gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| TX20 | Anthropic docx/xlsx/pptx/pdf skills restricted → ArcNave skill packs written in-house; adapt only Apache/MIT sources; keep THIRD_PARTY_NOTICES | ✅ Licences | MVP |
| TX21 | Unified tool spec in registry → rendered per provider (Claude strict + input_examples; Gemini FunctionDeclaration + VALIDATED) | ✅ Vendor | MVP |
| TX22 | Error format per provider (Claude is_error + instructive text; Gemini response.error) | ✅ Vendor | MVP |
| TX23 | Sandbox image: python-docx ≥1.2, openpyxl, python-pptx, WeasyPrint, matplotlib, pandas, LibreOffice headless, Noto fonts (Tamil, Devanagari, other Indic) | ✅ Vendor facts (K) | MVP |
| TX24 | xlsx quality: formulas + LibreOffice recalculation + error scan before delivering | ✅ Vendor (K1) | MVP |
| TX25 | Cheaper search at scale: You.com or Brave with Enterprise ZDR + DPA (also usable for Claude) | ⚠️ Partial (legal) | Stage 18/20 |

## Decisions round 2 (recommendations – need OK)
| ID | Rec |
|---|---|
| TD-2b | MVP: Gemini → Web Grounding for Enterprise (no logging; 5k free/month covers MVP); Claude → native web_search. Before scale: legal + price check of You.com / Brave Enterprise ZDR as one provider for both models |
| TD-4b | Sandbox = Cloud Run sandboxes with our own image (TX23); Agent Platform Code Execution kept as backup only (no LibreOffice/WeasyPrint/Indic fonts in preconfigured mode) |
| TD-11 | Licence rule: never copy anthropics/skills doc packs or openai/plugins; Apache/MIT sources only, with notices |
| TD-12 | One tool spec format in registry; provider adapters; Gemini mode VALIDATED |
| TD-13 | Skill packs: ArcNave-written, structure + key rules decided now (8.6), full text written and evaluated in Stage 21 |

## Decisions locked (user OK 2026-10-02)
TD-1c (11 tools: + read_file, run_code python/bash, update_artifact full/replace) · TL-3 clarified (no external actions; internal writes OK) · TD-2b · TD-14 search cost controls (default OFF per chat, per-turn caps Fast 1/Normal 3/Deep 8, per-company monthly search quota, prefer Gemini for search turns, fetch trim) · TD-3 · TD-4b · TD-4c (full image list; no pdfkit, tabula, unrar, PyMuPDF [AGPL], pip/curl) · TD-5c (60/120 s, 4 GiB, /input read-only, /output → per-chat workspace ~500 MB, ≤30 MB/file, ≤10 files/run, runs/turn 1/3/8, ~5 parallel per company) · TD-5d (stateless MVP; per-turn sandbox LV-1 → Phase 2; no 30-day containers) · TD-6 (truncate ~8k + full output saved + pagination + instructions) · TD-7 (default builder from model content; custom layouts via run_code; xlsx recalc + error scan; previews LibreOffice → PDF) · TD-8 · TD-9 · TD-10 · TD-11 · TD-12 · TD-13.

## Skill-pack learning checklist (concept level; user decision 2026-10-02)
User chose to let Claude read anthropics/skills docx/xlsx/pptx/pdf for learning only (viewing not prohibited by licence; copying, derivative works and retaining copies are). Rule: concept-level ideas only; ArcNave skills written in original words from library docs + own requirements; no text, code or structure copied. (Lawyer list: confirm this approach.)
Coverage ideas added to ArcNave skill plans (general practices):
- docx: explicit page size (A4); real paragraphs/tab stops instead of spaces/newlines; table column widths consistent; editing uploaded files: merge split text runs before find/replace, keep original styles, optional tracked changes; verify via LibreOffice → PDF → page images + structure validation.
- xlsx: test a few formulas before filling grids; clean recalculation ≠ correct numbers; avoid functions LibreOffice can't evaluate (dynamic-array e.g. XLOOKUP/FILTER → INDEX/MATCH); input/formula/link colour convention; document assumptions; when editing, keep existing conventions and formulas; quote sheet names with spaces; merged cells write top-left only; two-pass read (formulas vs cached values).
- pptx: structure (add/remove/reorder slides) before content; analyse template layouts first; build → check → fix → rebuild loop; one visual element per slide, limited palette with one accent, consistent motif, layout variety, left-aligned body, consistent margins; per-slide visual check for overflow/overlap/contrast; avoid decorative filler.
- pdf: pick the specialised library per task (create, extract text/tables, merge/split, forms, watermark/encrypt, metadata); avoid Unicode sub/superscript characters (missing glyphs) – use markup; scanned → OCR (Stage 9).
