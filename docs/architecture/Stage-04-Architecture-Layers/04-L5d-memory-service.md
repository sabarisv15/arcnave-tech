# ArcNave – Stage 4 · L5.4 Memory Service – full audit
_2026-10-01 · Status: **LOCKED** (user OK 2026-10-01) · Labels: Vendor / Partial / ArcNave rec · Implementation ("how") → Stage 11_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - **Implementation locked in Stage 11** (Stage-11-Memory/00-checkpoint-stage11.md): document memory in own Postgres (Mumbai); M15 → own store (Memory Bank = fallback; Claude memory tool not used as user store).
> - M11 refined: assistant text may be context only; files/web/tools never. Writing happens in-turn by the model (MEM-WRITE=1); background extractor (MD-3/MD-4) retired, kept as fallback design.
> - Never-saved list extended (criminal history, immigration status, caste, …); people docs = work context only; admins cannot view or export.


## Claude-only
- CM1: Claude memory tool is client-side → data in our storage; we handle path-traversal, size caps, expiry; Vertex availability → verify (Stage 11).
- CM2: Memory in system prompt breaks cache → place memory late (L5b rule).

## Stage 11 will decide (not here)
Store (own DB / Memory Bank / Claude memory tool) · extractor model (M8) · pipeline extract→dedupe→merge→save · record schema · read ranking/limits · chat-delete → derived-memory delete · memory evals.

## Contract
read(user, company, query) → relevant memories · write(candidates) async (L6) · explicit remember/forget · list / edit / delete / pause / reset / export (user) · admin enable/disable · TTL.

## Real-product evidence (official help docs)
- Claude: two features — past-chat search (RAG, shows as tool call) and memory from chat history; memory saved as individual topics during chat (legacy: every 24 h); each Project has separate memory; incognito chats not used/searched; user can view/edit, pause, reset; per-chat memory off before first message; Team/Enterprise owners enable org-wide; sensitive topics need separate user opt-in; org off deletes all memory; owners can't view users' memories.
- ChatGPT: saved memories vs reference chat history; turn off, delete item, temporary chat (unpersonalized), "don't mention again"; deleted memory logs kept up to 30 days; workspace admin controls.
- Gemini: saved info (personal context) vs past-chat reference; add/view/edit/delete; responses show "Your saved info" when used; won't save policy-violating content. Gemini Enterprise: admin can disable memory for all users (default ON); "after you delete a saved memory, the information … might still be retained as long as the original conversation is saved".
- Perplexity: remembers preferences + history across threads and across models; incognito disables memory; user can turn off.
- APIs: Vertex Memory Bank (extraction + consolidation, per-user scope, similarity search, TTL); Claude memory tool (client-side, our storage, path-traversal care, size caps, expiry).

## Items
| # | Item | Source | Rec |
|---|---|---|---|
| M1 | Two separate kinds: saved memory vs past-chat search | Vendor (Claude, OpenAI, Gemini) | MEM-1 |
| M2 | User controls: view/edit/delete item, pause, reset all, per-chat off, temporary/incognito | Vendor (all 4) | MVP (MEM-3 for temporary chat) |
| M3 | Company admin: enable/disable org-wide; org-off deletes all; admins can't read users' memories | Vendor (Claude, Gemini Enterprise) | MVP |
| M4 | Scope per user inside company; project memory separate (later) | Vendor (Claude, Memory Bank) | MVP |
| M5 | Extraction as topics during chat + consolidation (update, not duplicate) + TTL | Vendor (Claude, Memory Bank) | MVP (worker) |
| M6 | Size caps; strip sensitive data; sensitive categories only with user opt-in; never save policy-violating content | Vendor (Anthropic, Claude Enterprise, Gemini) | MVP (MEM-5) |
| M7 | **Deletion semantics**: delete memory vs delete chat (derived memories); log retention stated (OpenAI ≤30 days; Gemini Enterprise caveat) | Vendor + ArcNave | MVP (DPDP) |
| M8 | Show when memory was used in an answer ("Your saved info") | Vendor (Gemini) | MVP |
| M9 | Memories shown as editable topics | Vendor (Claude) | MVP UI |
| M10 | Provider-neutral memory (works for Gemini and Claude) | Vendor (Perplexity across models) + ArcNave | MVP |
| M11 | **Memory poisoning guard**: extract only from user-written messages, never from file/web/tool content | ArcNave rec (security) | MVP |
| M12 | Explicit "remember this" / "forget this" in chat | Vendor (OpenAI) | MVP |
| M13 | Read budget + relevance (few items, labeled) | ArcNave (CX15) | Covered |
| M14 | Memory quality evals (wrong/stale memories) + user feedback | ArcNave rec | MVP offline |
| M15 | Implementation: own store vs Vertex Memory Bank vs Claude memory tool | Vendor | Stage 11 |

## Decisions
| ID | Question | Rec |
|---|---|---|
| MEM-1 | MVP memory kinds | Saved memory in MVP; past-chat reference later |
| MEM-2 | Auto-extract or only explicit | Both (auto + "remember this"), always visible & editable |
| MEM-3 | Per-chat "no memory" toggle / temporary chat | Per-chat toggle MVP; full temporary chat later (G4) |
| MEM-4 | Company default | ON with admin switch; turning off deletes all (warn first) |
| MEM-5 | Sensitive categories (health, finance, etc.) | Not saved unless the user explicitly opts in |
