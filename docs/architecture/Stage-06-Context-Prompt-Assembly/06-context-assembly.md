# ArcNave – Stage 6 · Context / prompt assembly – LOCKED (2026-10-02)
_2026-10-01 · Sources: GPT Astra P1–P12 (official quotes) + published Claude system prompts (structure) + GPT-6 Astra guide + locked L5 Context rules (CX1–CX21, N10/N11, N13, A7, R1)_

> **Doc-sync 2026-10-03 (Stage 12) – Stage 12 Retrieval (see Stage-12-Retrieval/00-checkpoint-stage12.md):**
> - **CXD-4:** whole vs retrieve decided **per file** by budget; whole-sent files excluded from search; 30k vs 100k limit decided by Stage 21 regression test (D1).
> - **CXD-5:** at compaction, old retrieved passages and page images become stubs (id, file, page); deleted-file text replaced by "[source deleted]" (D6).
> - **CXD-6:** retrieval share inside profile budget Fast 6k / Normal 20k / Deep 80k (D2, provisional).
> - Claude: `search_result` blocks with citations OFF + separate image blocks (≤2,000 px from first turn); `<retrieval_status>` block added to user turn.


> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - **CXD-11 (Stage 8):** loaded skill content is never trimmed within the current task.
> - **CXD-4 note (Stage 9):** page images are not stored – rendered on demand from the stored PDF; large PDFs → text + images of retrieved pages (Fast 3 / Normal 8 / Deep 20).
> - **Memory (Stage 11):** memory snapshot moves to the session block (system side); prefetched memory docs in the user turn replace `<user_memory>` records.


## Packet layout (per call)
**Superseded by `06-policy-spec-v3.md` → "Shared runtime layout"** (session state on system side, per-turn app state, user turn = documents → memory → question last; Claude append-only mid-chat updates). Order: static prompt → skills list → session state → history → per-turn state → documents → memory → user question.

## Gaps
| # | Gap | Source | Rec |
|---|---|---|---|
| CG1 | Role + explicit rules + XML sections + 3–5 examples for hard rules; positive formatting instructions | ✅ Vendor (Anthropic P1) | MVP |
| CG2 | Gemini 3: concise direct instructions, critical rules first; it is terse by default → ask for detail/conversational style explicitly | ✅ Vendor (Google P4) | MVP |
| CG3 | Long content first, question LAST (both vendors); quote-first for >20k-token docs | ✅ Vendor (Anthropic P3, Google P6) | MVP |
| CG4 | **Reply language must be stated explicitly**; native script beats transliteration; Tanglish/Hinglish policy not documented | ⚠️ Partial (Anthropic P2) | CXD-1 + eval |
| CG5 | No app-level authority guarantee on Vertex → precedence must be written in prompt: ArcNave > company admin > project > user; tagged provenance | ✅ Vendor (OpenAI Model Spec, Anthropic, Claude org instructions) | MVP (CXD-2) |
| CG6 | Instruction limits (others: Claude org 3,000 chars; ChatGPT custom 5,000) | ✅ Vendor (P8) | CXD-2 |
| CG7 | Admin instruction change timing (Claude org: up to 1 h; ChatGPT docs conflict) | ✅ Vendor (P8) | CXD-8 |
| CG8 | Whole file vs retrieval: no official number; Anthropic: whole KB if <200k tokens (with caching); Google: more context = slower first token | ⚠️ Partial (P3, P6) | CXD-4 |
| CG9 | Compaction: keep decisions, unresolved items, specifics; recall first; no official threshold | ⚠️ Partial (Anthropic P9) | CXD-5 |
| CG10 | Current date/time + cutoff note recommended (Gemini 3 Flash guide); Gemini 3.8 cutoff not documented | ⚠️ Partial (Google P5) | MVP + LV-1 |
| CG11 | Untrusted content: tool_result only (Anthropic), labelled + JSON-encoded, never in system/developer layer (OpenAI) | ✅ Vendor (P12) | MVP (CX/T5) |
| CG12 | System prompt cannot fully stop leaks → no secrets in prompt; output screen | ✅ Vendor (Google, Anthropic P12) | MVP (CX21) |
| CG13 | Token counting free: Gemini countTokens (3,000 RPM), Claude count-tokens (2,000 RPM) → local estimate first, API only near limits | ✅ Vendor (P10) | MVP |
| CG14 | Vertex prompt management = single-turn only, no India region; Vertex eval service not in asia-south1 → own prompt registry + own eval harness | ✅ Vendor (P11) | MVP (CXD-7) |
| CG15 | Evals on every prompt change (OpenAI); measurable success criteria (Anthropic); OpenAI Evals platform shutting down 30 Nov 2026 | ✅ Vendor (P11) | MVP |
| CG16 | Formatting style: prose first, lists only when useful, no bullets in refusals, no filler ("Bottom line:"), no unsolicited disclaimers | ✅ Vendor (published Claude prompts, GPT-6 Astra guide) | MVP |
| CG17 | Refusal style: one-line principle + alternative; wellbeing helpline accurate | ✅ Vendor (published Claude prompts) | MVP |
| CG18 | Caution with tag-wrapped text in user turn claiming system/admin authority | ✅ Vendor (published Claude prompts) | MVP |
| CG19 | One prompt for both models vs separate | ArcNave rec | CXD-3 |
| CG20 | Input token budget per profile (cost + first-token speed) | ArcNave rec (Google P6 latency note) | CXD-6 |

## Claude-only
| # | Fact | Rec |
|---|---|---|
| CC1 | No blanket ban on thinking instructions; Opus 5.5: remove "think carefully" for chat latency; Sonnet 5.5: brief "think it through" helps some JSON tasks | Profile-specific lines, tested by evals |
| CC2 | Prefill → error (C23) | Format via system prompt / structured outputs |
| CC3 | Don't ask Claude to include its reasoning in the answer (reasoning_extraction refusals, A7) | Thinking panel instead |
| CC4 | History must be byte-identical; system/admin change → strip earlier thinking (R1, A1) | Gateway rule |
| CC5 | Mid-conversation system messages for changes; turn-scoped (clear_at) for date (N10/N11, TH-2) | MVP |
| CC6 | Claude count-tokens on Vertex free, 2,000 RPM, global supported | Use sparingly |

## Decisions (LOCKED 2026-10-02, user OK)
| ID | Question | Decision |
|---|---|---|
| CXD-1 | Reply language | **Removed by user (2 Oct)** – no language section; Tanglish/Hinglish behaviour observed in eval only |
| CXD-2 | Instruction precedence + size | ArcNave rules > company admin (≤3,000 chars) > project (≤5,000 chars) > user; updated blocks replace older versions, stay below base |
| CXD-3b | One prompt or per model | One policy spec (rule IDs) → Claude rendering + Gemini rendering (replaces "base + overlay") |
| CXD-4 | Whole file vs retrieval | Full content if all attached files ≤ ~30k tokens **after processing** (scanned PDFs counted after OCR, incl. page-image tokens); above → retrieval; whole-document tasks (summarise all, list all) → background batch (map-reduce) job; tune by eval |
| CXD-5 | Summary | When history > ~60% of the profile's history budget; keep last 6 turns verbatim; summary keeps active constraints, ids, pending ops; ids also stored structurally |
| CXD-6 | Input budget per profile | Fast ~16k · Normal ~48k · Deep ~200k tokens (Stage 18 tune) |
| CXD-7 | Prompt registry + evals | Own registry + own eval harness; v1 = test kit (68 cases, critical gates); run deferred to Stage 21 (no budget now) |
| CXD-8 | Admin instruction change | Applies from the next turn of every chat |
| CXD-9 | Citations source | App-provided sources cited by model; built-in web search citations from native metadata (Gemini groundingSupports, Claude citations) |
| CXD-10 | Citation format | Typed ids `[file:n]`, `[web:n]`, adjacent, no space before, ≤3/sentence |

New for Stage 9 (from CXD-4 discussion): scanned PDF = OCR at upload + page text + page images stored; specific questions → retrieval + images of retrieved pages; whole-document questions → batch job; OCR engine choice (Document AI asia-south1 OCR preview vs Gemini OCR) to research. Claude: never send raw large PDFs (30 MB request limit, ≤600 pages) – send OCR text + selected page images.
