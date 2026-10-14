# ArcNave – Stage 4 · L5.5 Tool Service – full audit
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01) · Labels: Vendor / Partial / ArcNave rec · Which exact tools + sandbox → Stage 8_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - Real tool list (Stage 8 + 11) replaces the mock list: **12 tools** – see 08d-tool-definitions.md. memory_save → memory_write; memory_read added.
> - Idempotency keys for write tools (memory_write/delete, create/update_artifact); one result envelope + 11 error codes (TD-18).


## Contract (from contracts round, kept)
Registry entry: name (namespaced) · kind (builtin | custom) · description (incl. when NOT to use) · strict input schema · input_examples · permissions (company/role) · side_effect + needs_approval · timeout · max_uses per turn · result size cap · concise/detailed · cost per call · version.
Execute: validate → permission → run (sandbox if risky) → wrap output as untrusted (JSON, source label) → optional injection screen → {content, is_error, instructive message} → audit log + cost meter.

## Real-product evidence
- Claude.ai: per-chat toggle of connectors/tools; Team/Enterprise owners enable org-wide, can allow read but block write actions; user still needs source-system permission. (support.claude.com connectors)
- ChatGPT Enterprise: admins enable/disable web search, code execution (+ network default), connectors; Compliance API audit log. (OpenAI Academy admin controls)
- Perplexity Agent API: web_search tool with domain/date/location filters, max_results 1–50, token caps; $2.50/1k (fast $1/1k); asks for inline citations.
- Gemini: built-ins Google Search, Maps, URL context, File Search, Code execution (30 s); Gemini 3 can mix built-ins + custom functions (id + signature passback, VALIDATED mode) – Vertex support not stated.

## Items (T1–T8 from contracts round + new)
| # | Item | Source | Rec |
|---|---|---|---|
| T1 | Registry fields | Vendor (Anthropic, Google) | MVP |
| T2 | Active tools per request ≤10–20 (OpenAI <20) | Vendor (Google, OpenAI) | MVP |
| T3 | Detailed descriptions + input_examples | Vendor (Anthropic) | MVP |
| T4 | Instructive error messages | Vendor (Anthropic) | MVP |
| T5 | Tool output untrusted: JSON, source label | Vendor (Anthropic) | MVP security |
| T6 | Injection screen for web/file tool output | Vendor (Anthropic) | MVP |
| T7 | Least privilege + sandbox for risky tools | Vendor (Anthropic) | MVP |
| T8 | Tool versioning in config registry | ArcNave rec | MVP |
| T9 | Two tool kinds: provider built-in vs ArcNave custom, one registry | Vendor (Google, Anthropic) | MVP |
| T10 | Claude on Vertex: only web search server tool; no code execution, web fetch, MCP connector, programmatic tool calling, Files API → own tools | Vendor (Anthropic) | MVP |
| T11 | Gemini built-in + custom function same request (Gemini 3, id+signature, VALIDATED) | Partial (Vertex not stated) | Verify Stage 8 |
| T12 | Citation display duty: Claude web search citations must be shown; Google Search Suggestions display rule | Vendor (Claude) / Partial (Google terms) | MVP |
| T13 | Per-search cost into cost meter: Claude $10/1k; Gemini 3 grounding per query (~$14/1k, 5k free/month – 3rd-party source, verify); Perplexity $2.50/1k | Vendor / Partial | MVP |
| T14 | Company admin switch per tool; read vs write restriction | Vendor (Claude, ChatGPT) | MVP (TL-2) |
| T15 | User per-chat tool toggle (web search) | Vendor (Claude) | MVP (L1 G11) |
| T16 | Per-tool limits: max_uses/turn, timeout, size cap, domain allow/block | Vendor (Anthropic, Perplexity) | MVP |
| T17 | Tool errors arrive inside HTTP 200 (Claude web search codes) → normalize; no charge on error | Vendor (Anthropic) | MVP |
| T18 | Search results count as input tokens on later turns → context budget | Vendor (Anthropic) | MVP |
| T19 | Own URL-fetch tool needs SSRF guard (block internal IPs / metadata server, size/time/type limits) | ArcNave rec (security) | MVP if fetch tool |
| T20 | Cross-layer: Retrieval rule "XLSX numbers → code" needs a code tool in MVP | ArcNave rec (consistency) | MVP (TL-4) |
| T21 | Tool-call audit log (name, args hash, time, cost, size, error) | Vendor (ChatGPT Compliance API) + ArcNave | MVP |
| T22 | Disclosure: search queries go to Google/Anthropic search → privacy policy; send only query text | ArcNave rec (DPDP) | MVP |
| T23 | MCP connectors to company apps | Vendor (Claude, ChatGPT) | Later |
| T24 | Tool-selection evals | Vendor (Anthropic) | MVP offline |
| T25 | Tool search / deferred loading for big tool sets | Vendor (OpenAI) | Later |

## Claude-only
| # | Fact | Rec |
|---|---|---|
| CT1 | Vertex = web_search_20250305 only; dynamic filtering not available | MVP fact |
| CT2 | Params: max_uses, allowed_domains OR blocked_domains, user_location (set IN, Asia/Kolkata) | MVP |
| CT3 | $10 / 1,000 searches + tokens; no charge on error | MVP cost |
| CT4 | Citations always on; must be shown to end users | MVP |
| CT5 | Error codes in 200 body: too_many_requests, invalid_tool_input, max_uses_exceeded, query_too_long, request_too_large, unavailable | MVP |
| CT6 | Not on Vertex: code execution, web fetch, MCP connector, programmatic tool calling, Files API, Agent Skills | MVP fact |
| CT7 | Client tools on Vertex: memory, bash, text editor, computer use, browser use (not needed MVP) | Later |
| CT8 | GCP org policy allowedPartnerModelFeatures: web_search denied by default → allow explicitly if used | MVP config |
| CT9 | Tool list / web-search toggle change breaks prompt cache (CL3) → keep fixed within chat | MVP |
(+ C1–C7 tool-loop rules locked in L4)

## Decisions
| ID | Question | Rec |
|---|---|---|
| TL-1 | Web search: model built-ins vs one ArcNave tool | Registry supports both; provider pick in Stage 8 |
| TL-2 | Who switches tools per company | Company admin ON/OFF for web search; user per-chat toggle |
| TL-3 | Write/side-effect tools in MVP | None; read-only only; approval flow later (L4 G20) |
| TL-4 | Code tool in MVP | Yes (XLSX math); sandbox type in Stage 8 |
| TL-5 | Source display | Always show sources; Google Search Suggestions rendered as required (verify terms) |
| TL-6 | Tool availability | Enabled tools always sent each request, model decides (auto); list fixed within a chat; admin/user OFF removes tool (cache miss acceptable) |

Exact MVP tool list, providers, sandbox → Stage 8.
