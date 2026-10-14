# ArcNave – Stage 13 · Output validation – DRAFT (needs user OK)
_2026-10-03 · Source: GPT Astra results (13-astra-results.md, official docs checked 3 Oct 2026) + locked inputs (L4 Validator V1–V8, Stage 6 rules CI/ST/HO/FI, Stage 8 TD/TS, Stage 10 AO-10/RS-1, Stage 12 registry) · Labels: ✅ Vendor documented · ⚠️ Partial · 📄 Official blog · 🔧 ArcNave design · Earlier ids are referenced with a stage prefix (e.g. L4-V3, S12-D6)._

## 0. Scope
Everything that checks a model answer, a tool call or a generated artifact **after or during generation, before it is shown, saved or acted on**. Safety categories = Stage 16 (hooks only here). Mid-stream provider failure = Stage 15. Numbers = Stage 18 (register N-40).

**Core finding (Astra, all vendors):** the real boundary is **validation before release vs after exposure**. Nothing can un-show streamed text; a post-stream check can only *retract/replace* (ArcNave mechanism – no product documents this, A2). So the pipeline has **three release points**:

| Release point | When | What can run | Cost rule |
|---|---|---|---|
| **RP-1 Live** | while streaming | provider signals (refusal, SAFETY, RECITATION), cheap deterministic chunk checks, client-side streaming-safe rendering | ≈0 latency |
| **RP-2 Before show / act** | before a structured output, tool call or artifact is used | schema + domain + permission checks, file reopen + render test, JSON repair/reask | blocks that item only |
| **RP-3 After completion** | after `done` | completeness, citation integrity, claim support, completion check, language/locale, leak scan, sampled quality judge | async; result → annotate / regenerate / retract |

## 1. Real-product evidence (official help docs; Astra Part A)
| | Claude.ai | ChatGPT | Gemini app | Perplexity |
|---|---|---|---|---|
| A1 Cut-off answer | not documented | ⚠️ "continue generating" (historical release note) | not documented | not documented |
| A2 Answer removed after streaming | not documented (all four) | | | |
| A3 Verify feature | manual ("verify sources yourself") | manual (search again) | ✅ **Double-check response**: green = similar found, orange = different/none, unhighlighted = can't assess; skips code + tables | manual |
| A4 Unresolvable citation | ⚠️ "links may not function"; no span guarantee | click/hover preview; no span guarantee | sources inline/below; double-check links ≠ generation sources | direct links |
| A5 Low-confidence note | generic "may be incorrect" help text | generic | ✅ disclaimers inside the experience (placement unspecified) | not documented |
| A6 File validation before download | ⚠️ artifact error → "Try fixing with Claude" button | ⚠️ "Download failed" errors | ⚠️ Canvas shows errors/logs | not documented |
| A7 Render error fallback | artifact error message + repair | not documented | Canvas console | not documented |
| A8 Published accuracy numbers | none (all four, help docs) | | | |
**Pattern:** products show *manual* verification aids and generic disclaimers; only Gemini documents an automatic per-answer check (Double-check), and it is user-triggered, skips code/tables, and its links are not the generation sources. Nobody documents retracting a streamed answer. → ArcNave's retract event, coverage flag and typed-citation check go beyond what is documented; keep them, and keep notes generic ("verify important facts") rather than numeric confidence.

## 2. Key vendor facts used below (official unless marked)
| ID | Fact | Status |
|---|---|---|
| F1 | Claude stop reasons (5.5): end_turn, max_tokens ("treat as truncated"), stop_sequence, tool_use, pause_turn, refusal (+stop_details), model_context_window_exceeded; incomplete tool block → retry with larger max_tokens; final stop_reason arrives in `message_delta` → completion known only at the end | ✅ |
| F2 | Claude structured outputs: constrained decoding on Sonnet/Opus 5.5 + Google Cloud; **exceptions**: refusal overrides schema, max_tokens truncates JSON, unsupported schema → 400, **enum/const casing not guaranteed** | ✅ |
| F3 | Claude native citations guarantee valid pointers + exact `cited_text` – **only when native citations are ON**; ours are OFF (S12) → model-written `[file:n]` has no vendor guarantee → own registry check | ✅ (+inference) |
| F4 | Claude fine-grained tool streaming skips JSON validation (partial/invalid JSON possible); buffered streaming validates → ArcNave uses **buffered** tool-input streaming | ✅ |
| F5 | Gemini finishReason full enum now also: FINISH_REASON_UNSPECIFIED, OTHER, MODEL_ARMOR, IMAGE_SAFETY, IMAGE_PROHIBITED_CONTENT, IMAGE_RECITATION, IMAGE_OTHER, NO_IMAGE; blocked streamed content may be empty; MALFORMED_FUNCTION_CALL = syntax, UNEXPECTED_TOOL_CALL = semantic | ✅ |
| F6 | Gemini grounding **confidence scores not available for 2.5+ (so not for 3.8)**; groundingSupports still link byte-indexed segments → chunks | ✅ (docs conflict resolved) |
| F7 | Gemini controlled generation: schema subset; unsupported fields **silently ignored**; property ordering docs contradict → always set `propertyOrdering`; `responseSchema` marked deprecated in favour of `responseFormat` in some references | ⚠️ |
| F8 | **Vertex Check Grounding API**: GA (claim-level scores GA Apr 2025); accepts our own facts; `citationThreshold` default 0.6 (controls citation assignment, not pass/fail); `locations/global`; "doesn't store content at rest"; **Tamil/Hindi support NOT documented**; SKU = "Check Grounding **Character** Count" $0.00075/1k chars; quota **300 req/min/project** (our 5,000-user average ≈174/min) | ⚠️ |
| F9 | Open checkers (MiniCheck 0.4–0.8B MIT, HHEM-2.1 0.1B Apache ~1.5 s/2k tok CPU, AlignScore 125–355M MIT ~45 ms, Bespoke-MiniCheck 7B CC-BY-NC, Lynx 8B CC-BY-NC, Granite Guardian 4.1 8B Apache "English only"): **all English-only**; LLM-AggreFact ≈75–77 | ⚠️ |
| F10 | LLM-as-judge: SAFE 72% agreement with humans on fact support; biases position / verbosity / self-preference; mitigations = swap order, rubric, reference, length control, human calibration | 📄/✅ |
| F11 | Streaming guardrail products: NeMo default 200-token chunks, `stream_first` (show then check) vs check-then-release; Azure async filter = stream now, redact later (~1,000 chars signal delay); AWS async = block later chunks, **no masking in async**; AWS contextual grounding "chatbot use cases not supported" | ✅ |
| F12 | OpenAI: output guardrails run **after** final output; moderation scores "aren't included with partial output deltas" | ✅ |
| F13 | Perplexity Agent API: `[n]` maps to search_results **id**, not array position; official prompt recipe "verify each claim against the sources… drop/soften unsupported" | ✅ |
| F14 | Format libs: GFM table = header/delimiter cell counts must match; unclosed fence is valid Markdown; KaTeX `throwOnError:false` renders source; `mermaid.parse` validates; Pydantic `from_json(allow_partial=True)`, `json_repair` (`stream_stable`); Streamdown/remend completes unfinished Markdown (React only – Expo ⚠️) | ✅ |
| F15 | Artifact checks: python-docx/pptx reopen = readability only; **openpyxl never evaluates formulas**; qpdf `--check` exit 0/2/3 = syntax only; LibreOffice headless = render test; veraPDF = PDF/A/UA only; Nu HTML Checker; Playwright screenshots | ✅ |
| F16 | Google DLP: INDIA_AADHAAR / PAN / GST / passport infoTypes; **Mumbai text processing supported**; 1 GiB/month free then $3/GiB; Presidio IN_* recognisers (MIT); PAN length descriptions conflict (10 vs 12) | ⚠️ |
| F17 | IndicLID (MIT): native 0.98, romanised 0.80 accuracy, 47 classes; fastText lid.176 model licence CC-BY-SA; CLD3 archived | ✅ |
| F18 | CLDR en_IN / hi / ta use 3-2 grouping (`#,##,##0`); Babel supports; date pattern must be **`dd-MM-yyyy`** (not `DD-MM-YYYY`) | ✅ |
| F19 | OTel `gen_ai.evaluation.result` (name, score, label, explanation, response/trace id); Google online eval samples traces ~every 10 min; LangSmith 10% sampling example | ✅ |
| F20 | Anthropic: unsupported claims "must retract"; truncated → "append a notice"; prefill not supported on 4.6+; CitationAgent (📄) post-research pass | ✅/📄 |

## 3. Gaps (numbered; what the Astra results add on top of L4-V1…V8)
| # | Gap | Label | MVP / Later |
|---|---|---|---|
| OV1 | **Three release points** (live / before show-act / after completion) as the validator contract; every check declares its point and its max latency | 🔧 (pattern ✅ NeMo, Azure, AWS) | MVP |
| OV2 | **Finish-code map v2**: add new Gemini reasons (F5) + Claude `pause_turn` continue rule + "completion known only at `message_delta`" → never mark a turn complete from text alone | ✅ | MVP (updates L4-G29) |
| OV3 | **Truncation (max_tokens)**: Normal/Deep → one automatic continue (Claude: new user "continue" message, C9/C15; Gemini: same) within budget; else notice "answer was cut short" + **Continue** button; structured output cut → treat as failure (A12) | ✅ Anthropic; ⚠️ products | MVP |
| OV4 | **Structured-output post-check always**: schema (Pydantic strict / jsonschema), enum case-insensitive match (F2), refusal/max_tokens = failure, Gemini unsupported-field silent-ignore → our own validation of every field; `propertyOrdering` set explicitly | ✅ | MVP |
| OV5 | **Repair ladder for structured output**: 1 reask with the validation error text (Instructor/Guardrails pattern); then fail with controlled message (L4-G1). Fast = 0 reasks | ⚠️ (no vendor count) | MVP |
| OV6 | **Tool-argument gate** (RP-2): wait for complete arguments (buffered streaming, F4) → schema re-check → description-limits (TS-3) → resource ownership/tenant (R12) → idempotency (G40) → run. MALFORMED_FUNCTION_CALL / UNEXPECTED_TOOL_CALL → retry once (G29) | ✅ | MVP (mostly locked; adds "complete args first") |
| OV7 | **Citation integrity = 4 separate verdicts**: (a) pointer valid (id in this chat's registry + tenant), (b) exact quote (when model quotes), (c) claim supported, (d) coverage/necessity. (a) deterministic + security → any failure = **retract + regenerate without the bad id**; (b) hash/normalised match, NFC, preserve original offsets; (c)(d) = grounding engine (VD-1) | ✅ methods; 🔧 split | (a)(b) MVP · (c) MVP async · (d) Later |
| OV8 | **Grounding / claim-support engine**: no checker documents Tamil/Hindi/code-mixed; Check Grounding language list not found; open models English-only → the only candidate with documented ta/hi is an **LLM judge on Gemini 3.1 Flash-Lite** (structured verdict per claim) | ⚠️ | MVP (VD-1) |
| OV9 | **Judge hygiene**: rubric, binary/defined scale, position swap not needed (single answer), length-controlled, human-calibrated sample in Stage 21, judge version stamped; judge never sees system prompt | ✅ Anthropic/OpenAI | MVP |
| OV10 | **Low-support action** (replaces vague V-2): per answer → `annotate` note ("Some statements could not be matched to your files – verify before use") + weak citations marked in UI; Deep → one `regenerate` with the judge findings as repair input; **never silently delete sentences** | ⚠️ (Anthropic "retract claim" is prompt-side) | MVP |
| OV11 | **Completion check (AO-10)**: deterministic part – promised artifact/tool success vs actual (HO-5), every `[file:n]` resolved, requested format present; LLM part (Flash-Lite) – "all parts of the request answered?" only for Normal/Deep turns with tools or multi-part requests; missing → one extra step inside step budget (G16), else note | 📄 Anthropic rubric, ✅ ADK | MVP |
| OV12 | **Research citation check (RS-1 step 6)**: same engine as OV7/OV8 run on the whole report; unsupported claims **removed or softened before the report is published** (pre-release, so no retract needed); source-quality grade (primary/official vs other) recorded | 📄 CitationAgent | MVP (research mode) |
| OV13 | **Numbers reconciliation (K4)**: when run_code / DuckDB ran, its result envelope carries typed values; validator checks that numbers quoted in the answer exist in those values (normalised: lakh/crore, ₹, %, rounding) → mismatch = annotate "verify numbers"; Deep = repair | 🔧 (no vendor hook) | MVP-lite |
| OV14 | **Artifact gate (RP-2)**: docx/pptx reopen; xlsx reopen + LibreOffice recalc + error-cell scan (TD-7, already); pdf `qpdf --check` + pypdf strict; **render test** = LibreOffice → PDF → page images (already needed for preview) → zero pages / exception = fail → model gets the error (1 repair); web-page: own HTML parser (allowlist tags/attrs, no external URLs, inline only) + CSP header; chart: ECharts JSON schema + no functions (TD-8) + data equals computed data when built from run_code | ✅ libs; 🔧 gate | MVP · Nu validator / Playwright render = Later (LV-1) |
| OV15 | **Markdown/math/code**: client streaming-safe renderer (remend-style termination logic implemented in the **shared TS client**, since SD-4 = one client for web + Android); KaTeX `throwOnError:false` + log; server post-stream GFM table cell-count check → log only (no repair in MVP); raw HTML stripped (ST-4) | ✅ | MVP (client); server repair Later |
| OV16 | **Retract triggers (fixed list)**: provider block/refusal mid-stream (C11, Gemini SAFETY/PROHIBITED/SPII), citation pointer from another tenant or unknown id (OV7a), **system-prompt canary** or internal tag names in output (N2), secret pattern (API keys), severe safety verdict (SAF-4). Everything else = annotate or regenerate, never retract | 🔧 (Azure/NeMo/AWS patterns) | MVP |
| OV17 | **Recitation**: Gemini RECITATION / IMAGE_RECITATION → finish code `recitation`; keep partial, notice "stopped – possible copyrighted text", offer regenerate; no cross-provider fallback (SA-6) | ⚠️ (no vendor rule) | MVP |
| OV18 | **Language/script check**: detect user script (Unicode blocks) + IndicLID for romanised; compare with answer; **MVP = measure + log only** (LANG-1 spirit: no hard-coded language action); Stage 21 decides whether to annotate/regenerate | ✅ IndicLID; ⚠️ action | MVP log · action Later |
| OV19 | **Locale**: app-generated numbers/dates via Babel `en_IN` (3-2 grouping, `dd-MM-yyyy`); model-written lakh/crore = prompt rule + eval, not a validator rule | ✅ CLDR | MVP (L1/L3) |
| OV20 | **Leak scan**: canary string (random per deploy) + internal tag/field names + secret regex on every final answer (sync, cheap) → retract; PII scan of outputs (Google DLP Mumbai, INDIA_* infoTypes, ~$3/GiB) = **Later** (SAF-7 kept); memory writes already have the never-store validator (S11) | ✅ Anthropic/OWASP; ⚠️ DLP | canary MVP · DLP Later |
| OV21 | **Validation record per turn** (V8 detail): `validation_result` rows (turn_id, check, version, score/label, action, latency_ms, sampled, hash of text revision) – ids + hashes only; OTel `gen_ai.evaluation.result` names; stored in Mumbai DB | ✅ OTel | MVP |
| OV22 | **Online quality sampling**: ~10% of completed turns (number Stage 18) → async LLM judge (helpfulness/groundedness rubric) → Stage 17 dashboards + Stage 21 human calibration set; separate from release validation | ⚠️ (10% = example only) | MVP mechanism; rate Stage 18 |
| OV23 | **Thinking is never validated as content** (Claude summarised, Gemini thought summaries, signatures encrypted) – only the user-visible answer; signatures preserved untouched | ✅ | MVP rule |
| OV24 | **Validator budget per profile**: Fast = RP-1 + deterministic RP-3 only (no LLM checks unless file/web answer); Normal = + claim judge on file/web answers + completion check if tools used; Deep = everything + 1 regenerate; numbers Stage 18 | 🔧 | MVP |
| OV25 | **Tool-output screening** (before model sees it) is Stage 16 / T6, not here – cross-reference only | ✅ OpenAI/Anthropic | — |
| OV26 | Items Astra found that we don't take: formal business-policy verification (AWS Automated Reasoning), org-specific exclusions (competitor mentions), URL reachability check → **Later** (SF20 company blocked topics covers exclusions) | ✅ | Later |

## 4. Claude-only (COV)
| # | Fact | Rule |
|---|---|---|
| COV1 | stop_reason arrives in `message_delta`; empty `end_turn` possible | completion only after final delta; empty → one "continue" (C9) |
| COV2 | Structured outputs: refusal overrides schema, max_tokens truncates, enum casing not guaranteed, unsupported schema → 400 | post-check always; case-insensitive enums; max_tokens = failure (A12) |
| COV3 | Native citations OFF (S12) → no pointer/`cited_text` guarantee for `[file:n]` | own registry check OV7a; exact-quote check OV7b |
| COV4 | Fine-grained tool streaming skips JSON validation | use buffered tool-input streaming; validate before execute (OV6) |
| COV5 | Prefill not supported on 4.6+ | repair/reask = new user message with error text, not prefill |
| COV6 | After refusal reset context (A6); refusal mid-stream → discard partial | retract (OV16) + RV-2 fallback rules; refused turn excluded from history |
| COV7 | Citations + structured outputs together → 400 (N1) | judge/structured calls never carry citations |
| COV8 | Thinking summarised/omitted, billed same | never validated (OV23); Thinking panel only |

## 5. Decisions (recommendations – need OK)
| ID | Question | Options | Recommendation |
|---|---|---|---|
| **VD-1 (= L4 V-1)** | Grounding / claim-support engine | A Vertex Check Grounding (GA, own facts, global, char-billed, 300 rpm, **ta/hi undocumented**) · B open checker (MiniCheck/HHEM/AlignScore – English only, CPU) · C **LLM judge on Gemini 3.1 Flash-Lite** (ta/hi listed, structured per-claim verdict, ≈₹0.1 per check) · D Claude native citations (OFF by S12) | **C** as MVP engine, async at RP-3, only on answers that used files/web (CI-6 turns); A = Stage 21 bake-off for English answers + fallback if C quota/latency fails; B not used (no Indic) |
| **VD-2 (= V-2)** | Low-support result | annotate · remove sentences · regenerate | Annotate (note + weak-citation marks); Deep = one regenerate with findings; never silent edit (OV10) |
| VD-3 | Truncation | notice only · auto-continue | Normal/Deep auto-continue once, else notice + Continue button; Fast notice only (OV3) |
| VD-4 | Structured-output repair count | 0 / 1 / 2 | 1 reask with error text (Fast 0); then controlled failure (OV5) |
| VD-5 | Retract list | open-ended · fixed | Fixed list OV16 (safety, tenant/citation security, leak, severe verdict); all else annotate/regenerate |
| VD-6 | Completion check | LLM always · deterministic + LLM when tools/multi-part · none | Deterministic always; Flash-Lite check on Normal/Deep turns with tools or multi-part request (OV11) |
| VD-7 | Artifact gate | reopen only · reopen + render | Reopen + LibreOffice render test + xlsx recalc + qpdf; 1 repair; Playwright/Nu = Later (OV14) |
| VD-8 | Numbers reconciliation | none · log · annotate | MVP-lite: check + annotate "verify numbers"; Deep repair (OV13) |
| VD-9 | Language check action | log · annotate · regenerate | Log only in MVP (LANG-1); decide in Stage 21 (OV18) |
| VD-10 | Output PII scan | DLP now · later | Later (SAF-7); canary/secret/tag scan now (OV20) |
| VD-11 | Online sampling | none · fixed % | ~10% async judge, number in Stage 18 (OV22) |
| VD-12 | Validator profile budgets | same for all · per profile | Per profile (OV24): Fast deterministic only; Normal + judge/completion; Deep + regenerate |

## 6. Cost note (rough; final Stage 18, register N-40)
- Flash-Lite claim judge: answer + passages ≈ 4–6k tokens in, ~300 out → ≈ $0.0015 ≈ **₹0.12 per checked answer**. If ~30% of turns use files/web: 50 users ≈ ₹2,700/month; 5,000 users ≈ ₹2.7 lakh/month → Stage 18 decides sampling for Normal (e.g. always on Deep, sampled on Normal).
- Vertex Check Grounding: character-billed; a 10k-character answer+facts ≈ 10 × $0.00075 ≈ **₹0.6 per check** → ~5× Flash-Lite; plus 300 rpm quota increase needed before 5,000 users.
- Completion check (Flash-Lite, ~2k tokens): ≈ ₹0.05 per Normal/Deep tool turn.
- Canary/secret/registry/schema checks: ≈ ₹0 (CPU in Executor).

## 7. LV-1 additions (→ 00-lv1-register.md)
1. Flash-Lite claim-judge agreement with human labels on 200 Tanglish/Tamil/Hindi/English file answers (also vs Check Grounding on the English subset).
2. Judge + completion-check latency async after `done` (target: annotate within ~2 s of done).
3. Streaming-safe Markdown termination in the shared TS client on Android (Expo).
4. LibreOffice render test time per artifact type; qpdf on generated PDFs.
5. Canary leak test with the Stage 16 red-team set.
6. Numbers-reconciliation false-positive rate on lakh/crore formats.

## 8. Doc-sync debt created by Stage 13
- L4-G29 finish-code map → v2 (new Gemini reasons, pause_turn, message_delta rule).
- L4 Validator contract: V-1 → VD-1, V-2 → VD-2; add release points + retract list.
- L1: Continue button, "cut short" notice, weak-citation marks, "verify numbers" note, generic verify note; shared client termination logic.
- L3/L5e: result envelope carries typed values for run_code/DuckDB (OV13).
- 05-1: `validation_result` table (+ data-map entry, ids/hashes only).
- Stage 6 policy spec: CI-2 "claim check later" → VD-1; HO-5 completion deterministic check noted.
- Stage 10: AO-10 detail = OV11; RS-1 step 6 = OV12.
- 00-numbers-register N-40 filled with the knobs above.

## 9. Sources
Astra result file 13-astra-results.md (all URLs with quotes): platform.claude.com handling-stop-reasons, structured-outputs, citations, fine-grained-tool-streaming, reduce-hallucinations, increase-consistency, mitigate-jailbreaks, reduce-prompt-leak, develop-tests, multilingual-support, strict-tool-use · support.claude.com 10684626, 8525154, 17153992 · anthropic.com/engineering building-effective-agents, multi-agent-research-system (📄) · docs.cloud.google.com GenerateContentResponse, check-grounding (+REST, quotas, pricing, SKU), languages-locales, cmek, control-generated-output, grounding-with-elasticsearch, thinking, eval metrics-templates, evaluate-online, sensitive-data-protection infotypes/locations/pricing · ai.google.dev generate-content, structured-output · support.google.com/gemini 14143489, 16279220, 16047321 · developers.openai.com guardrails, structured-outputs, moderation, graders, evaluation-best-practices · openai.github.io agents guardrails/streaming · help.openai.com 6825453, 9237897, 8313428, 7996703 · docs.perplexity.ai agent-api migrate-from-sonar · perplexity.ai/help-center 10352903 · NeMo output-rail-streaming, alignscore · Azure content-streaming · AWS guardrails-streaming, contextual-grounding, automated-reasoning · Guardrails AI, Instructor, Pydantic, jsonschema, json_repair, Streamdown, GFM, KaTeX, Mermaid · python-docx, python-pptx, openpyxl, pypdf, qpdf, LibreOffice, veraPDF, Nu validator, Playwright, CSP3 · arXiv FActScore 2305.14251, SAFE 2403.18802, ALCE 2305.14627, ALiiCE 2406.13375, SelfCheckGPT 2303.08896, CoVe 2309.11495, semantic entropy, self-consistency 2203.11171, MT-Bench 2306.05685 · HF MiniCheck, HHEM, Bespoke-MiniCheck, Lynx, Granite Guardian, IndicXNLI, mDeBERTa · IndicLID, fastText, CLD3, GlotLID · CLDR, Babel · OTel gen-ai-events · OWASP LLM07, prompt-injection cheat sheet · LangSmith online evaluations.
