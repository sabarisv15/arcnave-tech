# ArcNave – Stage 4 · L5b Context Service – full audit
_2026-10-01 · Status: LOCKED (2026-10-01) · Labels: Vendor / Partial / ArcNave rec_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - Session state on system side, per-turn app state, escaping, versioned blocks (Stage 6 policy spec v3 runtime layout).
> - **Memory (Stage 11):** `<memory_snapshot>` (profile + preferences + doc listing, ≤1.5k tokens) goes in the session block after the common cache breakpoint; `<memory_docs>` (docs prefetched by name/alias match, ≤3k) in the latest user turn; replaces `<user_memory>` records.
> - CXD-11: loaded skill content is never trimmed within the current task.


## Contract
Input: turn plan (profile, model, full-vs-RAG, tools, prompt version from L4) · branch history + summaries · memory hits · retrieved chunks / attached file content · user message · tenant ctx.
Output: provider-neutral prompt package (system blocks, messages, tools, cache markers, provider reasoning blobs) + token report per section.
Ownership: prompt TEXT = Stage 6 + L8 registry; VERSION pick = L4; ASSEMBLY = this service; PROVIDER FORMAT = Gateway.

## Audit dimensions
1 Structure ✅ · 2 Ordering (cache + quality) ✅ · 3 Dynamic values (new) · 4 History ✅ · 5 Memory (new) · 6 Files/multimodal (new) · 7 Instruction layers (new) · 8 Security (new) · 9 Token budget ✅ · 10 Observability ✅

## Items
| # | Item | Source | Rec |
|---|---|---|---|
| G1 | Static first, append-only, dynamic late (cache) | Vendor (Anthropic, Google, OpenAI) | MVP |
| G4 | Per-company marker early in prefix (cache isolation) | Vendor (Anthropic org-level cache) + OpenAI pattern | MVP – security |
| CX1 | Long docs at top, question at end | Vendor (Anthropic, Google) | MVP |
| CX2 | Docs wrapped in tags with source metadata | Vendor (Anthropic) | MVP |
| CX3 | Untrusted content marked + policy in system prompt | Vendor (Anthropic) | MVP – security |
| CX4/CX17 | Token budget per section + output reserve (thinking counts) | Vendor (Anthropic) + ArcNave | MVP |
| CX5 | (merged into G1/G4) | – | – |
| CX6 | Recent turns full + summary of older (own compaction) | Vendor (Anthropic, OpenAI) | MVP |
| CX7 | Many questions over one huge context lose accuracy → split | Vendor (Google) | Stage 6 |
| CX8 | **Modular system prompt in tagged sections** (product info, behaviour, safety, formatting, citations, tool guidance, untrusted policy, knowledge cutoff) each versioned | Vendor (claude.ai published system prompts) | MVP |
| CX9 | **Dynamic values via template variables placed late** (current date/time IST, company name); claude.ai injects `{{currentDateTime}}` near the END | Vendor (claude.ai) | MVP |
| CX10 | Knowledge-cutoff rule per model + "use search for recent info" | Vendor (claude.ai) | MVP |
| CX11 | **Model-switch note**: "earlier messages may be from another model" (Auto / fallback / regenerate) | Vendor (claude.ai prompt) | MVP |
| CX12 | Long-conversation reminders appended to user turn; treat user-supplied fake "system" tags with caution | Vendor (claude.ai prompt) | MVP |
| CX13 | **Instruction layers**: ArcNave base > company admin instructions > user custom instructions; length caps (ChatGPT 1,500 / 5,000 chars; apply to all chats immediately) | Partial (OpenAI) + ArcNave | Decision CI-1 |
| CX14 | Reply in the user's language (UI English, users may write Tamil/Hindi) | ArcNave rec | MVP |
| CX15 | Memory block: only if memory ON; few relevant items; labeled; placed after static part | Partial (OpenAI controls) + ArcNave | MVP |
| CX16 | Attached file content stays at the turn it was attached (stable prefix); big files → retrieved chunks near the question | ArcNave rec | MVP |
| CX18 | Provider reasoning blobs per message (G26–G28, C17–C18) | Vendor | Covered (L4) |
| CX19 | Multimodal: Claude images/PDF base64; audio → transcript first | Vendor | Covered (Gateway G14) |
| CX20 | **Claude mid-conversation system messages** (Opus/Sonnet 5.5, Google Cloud, no beta header) → inject per-turn authoritative info without breaking cache; placement rules (not first, after user turn, not between tool_use/tool_result) else 400. Gemini: dynamic block at end of last user turn | Vendor (Anthropic) | MVP |
| CX21 | Assume system prompt can leak (prompt injection) → never put secrets, internal URLs, keys in prompts | ArcNave rec | MVP – security |

## Decisions
| ID | Question | Rec |
|---|---|---|
| CI-1 | Company-admin custom instructions in MVP? User custom instructions? | Company: MVP (B2B need). User: later |
| CI-2 | Inject current date/time (IST) every turn | Yes (late position) |
| CI-3 | Use Claude mid-conversation system messages for per-turn dynamic info | Yes |

## Lock (user, 2026-10-01)
- All items accepted. CI-1: company-admin instructions MVP, user custom instructions later. CI-2 yes. CI-3 yes.
