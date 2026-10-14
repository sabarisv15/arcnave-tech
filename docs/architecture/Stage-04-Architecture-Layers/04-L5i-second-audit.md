# ArcNave – Stage 4 · L5 second full audit (independent)
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01: A1–A17, B1–B16, SL-1, G45-R, LV-1) · L5 FINAL · Method: 2 independent auditors (Claude docs ~40 pages via llms.txt; Gemini API docs ~25 topics) + my own re-verification of critical items._
_Legend: ✔ = re-verified by me from the doc page · A = auditor-reported (doc quoted, not re-fetched by me) · ⚠ = docs conflict / Vertex page unreadable → live test._

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - B6 updated (Stage 9): Gemini 3.8 Flash on Vertex – PDF ≤50 MB / **3,000 pages** (1,000 = Developer API), ~560 tokens/page; images ≤**3,000** per prompt incl. **HEIC/HEIF**; inline 7 MB / GCS 30 MB; native document types = PDF + text/plain only.


## Claude (Anthropic docs)
| # | Finding | Sev | Service | Rule | Status |
|---|---|---|---|---|---|
| A1 | Kept thinking blocks must be an unbroken run; prefix = system + tools + every earlier message; removing a middle block invalidates later ones; once removed never re-add. Our summarize/trim changes prefix → 400 | Critical | Context/Gateway | On any history edit (summary, trim, edit-message): strip all thinking blocks from first edited position onward (or drop_block) | ✔ |
| A2 | Sonnet 5.5 cannot read Opus 5.5 thinking blocks (silently dropped); Sonnet 5.5 blocks bound to producing account (dropped elsewhere) | Important | Gateway | Strip thinking on Claude↔Claude switch; one GCP project identity per conversation | ✔ |
| A3 | Web search result blocks: encrypted_content / encrypted_index must be replayed unmodified, else 400 | Critical | Tools/history store | Store raw provider assistant blocks per turn (not only normalized text) | A |
| A4 | Server tool + custom tool in same turn: next user message must contain only tool_result blocks; tools array unchanged; resend same tools after pause_turn | Critical | Tool loop | No text / system message injected into that message | A |
| A5 | between_tools (Sonnet 5.5 only): 400 at xhigh/max effort; 400 if per-message effort differs; 400 on other models | Critical | Gateway capability matrix | Fallback Sonnet→Opus rewrites thinking field; between_tools never with xhigh/max | ✔ (field-exclusivity A) |
| A6 | After refusal: reset context (remove/rephrase refused turn) else continued refusals; keep fallback model for later turns; refusals billed in some categories, count to rate limits; category/explanation may be null, explanation unstable | Important | Safety/L4 | Exclude refused turn from Claude history; fallback sticky per chat; meter + track refusals | A |
| A7 | Prompts asking model to show reasoning in answer → reasoning_extraction refusals | Important | Context (Stage 6) | No "show your reasoning" wording; Thinking panel (TH-1) instead | A |
| A8 | Fallback credit (beta, Google Cloud listed): avoids paying cache twice; 5-min token; same body/headers | Important | Cost/L4 | Use SDK refusal-fallback middleware / credit for Claude→Claude fallback | ✔ (listed) |
| A9 | Usage: input_tokens = only after last breakpoint; total = input + cache_read + cache_creation; cache writes split 5m/1h; message_delta usage cumulative; thinking_tokens only in final delta; searches in usage.server_tool_use | Important | Usage normalizer | Implement exactly | A |
| A10 | Caching edge cases: 20-block lookback; 1h entries before 5m; auto-caching uses 1 of 4 slots; TTL from request start; cache usable only after first response begins (parallel calls miss); disable_parallel_tool_use change breaks cache | Important | Context/Gateway | Add to cache plan + conformance tests | A |
| A11 | Google Cloud availability per features overview: tool search, context editing, threshold compaction, fine-grained tool streaming, fallback credit, memory tool, web fetch listed ✓; code execution, Files API, Anthropic Batch ✗. Conflicts with claude-on-vertex page (web fetch ✗) and tool-search page (no Google Cloud) | Important | Tools/Context | Treat as "maybe"; verify by live test; C25/TL-6 stay until proven | ✔ ⚠ |
| A12 | Structured outputs: use output_config.format (old output_format → 400/TypeError); minItems only 0/1; no regex backrefs/lookarounds; enums primitive only; no external $ref; required fields first; low/medium effort may run to max_tokens → treat max_tokens as failure | Important | Schema translator | Add to translator rules | A |
| A13 | Claude 5.5 on Vertex: global or US/EU multi-region (+10%) only; regional endpoints only ≤Sonnet 4.6; provisioned throughput needs regional → none for 5.5; anthropic_version "vertex-2023-10-16" in body; Models/Batches API not on Vertex | Important | Gateway/infra | Matches C3 (global); static capability matrix | A |
| A14 | Non-streaming requests >10 min blocked by SDK | Important | Executor/worker | Always stream, even background jobs | ✔ |
| A15 | Invalid/unavailable beta header → 400 | Important | Gateway | Per-provider beta allow-list, tested in G35 | ✔ (block_binding example) |
| A16 | Never put user text inside tool_result; send after last tool_result | Minor | L4/Context | Rule | A |
| A17 | Minor: dateless 5.5 IDs are pinned; same ID behaviour can shift → continuous G35; domain filter format rules; user_location.country ISO alpha-2 else 400; tool-name miscasing; unknown SSE event types tolerated; strip web_search before count_tokens; ignore temperature advice (400 on 5.5) | Minor | Gateway/Tools | Rules | A |

## Gemini (Google docs)
| # | Finding | Sev | Service | Rule | Status |
|---|---|---|---|---|---|
| B1 | Gemini 3.x: strip temperature/top_p/top_k; candidate_count unsupported; temperature <1.0 can loop | Critical | Gateway | **Revise L4-G45: no sampling params to ANY model** | ✔ |
| B2 | 3.8 Flash: minimal thinking → error; thinking cannot be fully off; thinking_level + thinking_budget together → error | Critical | Gateway effort map | Lowest effort = low; always some thinking cost | ✔ |
| B3 | Final user turn must contain non-empty text; no prefilled model turns; FunctionResponse needs call_id + name | Critical | Context/Gateway | Attachment-only/voice-only messages get placeholder text | ✔ |
| B4 | Thought signature can arrive on final text part / empty-text stream part; never merge signed + unsigned parts; parallel calls: all calls first then all responses (interleaved → 400) | Important | Event normalizer/history | Keep empty parts; store signatures on text parts | A |
| B5 | Python SDK auto function calling ON by default (up to 10 calls) | Important | Gateway | Always disable (our L4 runs the loop) | A |
| B6 | Gemini file limits: PDF ≤50 MB / 1000 pages, ~560 tokens/page (native PDF text not charged); only PDF gets vision, other docs text-only; images ≤3,600/request, HEIC/HEIF native, default ~1,120 tokens; media_resolution medium recommended for docs; Files API not on Vertex (inline or GCS URI); inline limit pages disagree (20 vs 100 MB) | Important | Gateway pre-flight/Stage 9 | Add to capability matrix; Vertex limits page → verify | A ⚠ |
| B7 | Grounding with Google Search terms: show grounded results + Search Suggestions only to the user who asked; no modify/intersperse; no cache/syndicate/analyze/train; keep text ≤2 years for chat history; Google keeps prompts 30 days for grounding | Important | Tools/L1 share/memory/evals | Shared links hide Google-grounded answers; never memory/evals from them; DPDP disclosure of 30-day retention | ✔ (Gemini API terms; Vertex terms ⚠) |
| B8 | Standard PayGo baseline throughput set by org historical spend tier (new org = low) | Important | Gateway/launch | Plan Priority PayGo or quota request before launch (Stage 19) | A |
| B9 | Priority PayGo 3.8 Flash $1.35/$6.75 vs standard $0.75/$3.75; Flex/Batch half; overflow downgrade; record actual traffic type | Important | Cost/usage | Price table per tier | A (prices) ⚠ (header) |
| B10 | gemini-embedding-001 batch size: our R2 says 250/request; third-party says 1 → verify | Important | Retrieval | Verify Stage 12 | ⚠ |
| B11 | gemini-embedding-2: Preview on Vertex, no task_type (conflicts R9), 8,192 tokens, vectors incompatible with 001; 001 shutdown 14 May 2028 (Gemini API) | Important | Retrieval | Stage 12 decision; add to lifecycle registry | A |
| B12 | Ranking API: semantic-ranker-default-005/fast-005; up to 1000 records/request (R4 said 200); over-limit text silently truncated | Minor | Retrieval | Update R4 | A (Vertex) |
| B13 | gemini-3.5-transcribe (GA Aug 2026, Gemini API): code-switching, ≤1 h, custom vocab 1,000, live variant; Tamil not listed; Vertex availability unknown; audio tokens/s docs disagree (25 vs 32) | Important | Speech | Add to SPD-5 options; measure tokens | A ⚠ |
| B14 | URL context: ≤20 URLs, 34 MB/URL; no paywall/YouTube/Workspace/audio/video; per-URL status incl. UNSAFE; counts as input | Important | Tools (Stage 8) | Stage 8 | A |
| B15 | Built-in + custom tools mix: Preview; include_server_side_tool_invocations; VALIDATED only; parts billed as input | Important | Tools | Extends T11 | A |
| B16 | Minor: Gemini allows structured output + tools (Claude not, N1); unsupported schema props ignored silently; code execution billed as output, up to 5 retries; google-genai ≥2.0; Google suggests instructions at end of function response (conflicts T5 → keep T5); Flex 503/429, ≥10-min timeouts; no long-context premium on 3.8 Flash; Vertex grounding 5,000 free/month then $14/1k (Web Grounding Enterprise also $14/1k) | Minor | Various | Rules; T13 now Vendor-confirmed | A |

## Still not verifiable by reading (Google pages render only navigation) → live test list before build
Vertex quotas/usage tiers table · global-endpoint feature limits (caching/batch on global) · Vertex image/PDF/inline size limits · Vertex Service Specific Terms (grounding) · "Safety classifiers for Claude in Vertex AI" · D-1 in-memory cache vs implicit cache · embedding batch size · beta headers that Anthropic lists for Google Cloud (A11) · Claude account-binding scope (project vs org).

## Decisions
| ID | Question | Rec |
|---|---|---|
| SL-1 | Public share links | Hide thinking; hide/strip Google-Search-grounded answers (terms B7) |
| G45-R | Sampling params | Never send temperature/top_p/top_k to any current model (Claude 5.5 + Gemini 3.x) |
| LV-1 | Unreadable Vertex facts | Convert list above into a "Vertex live-verification" test pack, run in GCP project before build (Stage 21 step 1) |
