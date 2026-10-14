# ArcNave – Stage 6 reference: Perplexity Agent API preset prompts (official)
_2026-10-02 · Source: https://docs.perplexity.ai/docs/agent-api/presets (official, snapshot by user 2 Oct 2026) · Scope: API presets, NOT the Perplexity consumer app · Structure/lessons only_

## What it is
| Preset | Model | Steps | Prompt size (approx) | Style |
|---|---|---|---|---|
| fast | gpt-6-luna | 1 | ~1k tokens | Full prompt: role, tool workflow, citations, response format, query types, prohibited, copyright |
| low / medium / high | gpt-6-luna / gpt-6-sol | 5 / 15 / 15 | ~400 tokens | Date, research workflow, typed citations, "always final answer", tables for lists |
| xhigh | claude-opus-5-5 | 100 | ~300 tokens | Route to specialised tool first; **mandatory load_skill** before research |

Key point: a second vendor runs production agents on **very short prompts**; behaviour lives in config (model, steps, effort, tools) + skills. Supports ArcNave's short-base + backend-enforcement design. Conf. High (official).

## Lessons → ArcNave
| # | Perplexity pattern | Adopt? | ArcNave change |
|---|---|---|---|
| PX1 | Per-preset prompt + config (model, max steps, effort, max output, tools) | ✅ | Profile overlay (Fast/Normal/Deep), 1–3 lines each; step limits enforced in L4 (CXD-6) |
| PX2 | Typed citation ids `[web:1][file:2]`, adjacent, no spaces/commas/ranges, ≤3 per sentence | ✅ partial | Exact citation format spec; typed ids for app-provided sources = decision CXD-10 |
| PX3 | After a successful search, answer must carry ≥1 valid citation | ✅ | Add to citations |
| PX4 | Ban meta-commentary ("Based on my search results…") | ✅ | Add to style |
| PX5 | Copyright: brief summaries, public domain OK, uncertain → treat as copyrighted | ✅ | Make copyright rule concrete (quote ≤25 words) |
| PX6 | Same-name people: describe separately, never mix | ✅ | Add to honesty |
| PX7 | URL in query → rely on that source | ✅ | Add to web_search |
| PX8 | Flat lists, no nesting | ✅ | Add to style (mobile rendering) |
| PX9 | Enumerations → complete table with requested columns | ✅ partial | "Many items with attributes → table" |
| PX10 | Search query rules: short keywords, no operators, decompose, non-redundant | ✅ | file_search tool description + query-rewrite helper (Stage 8 / L5c) |
| PX11 | Math in LaTeX `\( \)` / `\[ \]` | ⚠️ | Only if L1 renderer supports LaTeX (KaTeX) → decision |
| PX12 | Date at top of prompt (daily granularity) | Info | Our per-turn time is fine; date-only would be cache-safe within a day |
| PX13 | "Never refuse… never say you lack access… commit to one answer" | ❌ | Benchmark-style rule; conflicts with honesty, safety and B2B trust |
| PX14 | No first person; never URLs; always search before answering | ❌ | Chat assistant needs "I"; users may ask for links; search only when needed |
| PX15 | Mandatory load_skill + route to specialised tool first | ✅ confirms | Matches SK-1; our wording already "load before artifact" |
