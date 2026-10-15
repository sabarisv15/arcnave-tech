# ArcNave – Stage 11 · Memory implementation – SUPERSEDED IN PART
_2026-10-02 · Source: GPT Astra (official URLs + quotes, checked 2 Oct 2026; full answers pasted in chat) · Status: evidence + gaps valid; design §4/§4a and decisions §5 superseded by 11b + 00-checkpoint-stage11.md_
_Builds on: Stage 4 L5d (M1–M15, MEM-1…MEM-5, CM1–CM2), Stage 5 F7 (MD-1…MD-4), F8, Stage 6 prompt memory rules + MEM-6 extractor prompt, Stage 8 tools memory_save / memory_delete._

## 1. Evidence (what changed since Stage 4)
| | Claude | ChatGPT | Gemini | Perplexity |
|---|---|---|---|---|
| Created | During chat, auto + explicit (daily summary = legacy) ✅ | Auto + explicit; schedule not documented ⚠️ | App: past chats + instructions; Enterprise: auto + "remember" ⚠️ | Search memory; **Brain** writes in background (e.g. overnight) ⚠️ |
| Shape | Individual **categorised topics**, editable ✅ | Improved Memory = one correctable **summary** + legacy items ✅ | Instructions list; Enterprise saved items ⚠️ | Brain = editable wiki: Concepts / Entities / Workstreams ⚠️ |
| Use in answer | Not documented ❌ | Relevant context selected; "Sources may appear" ✅ | Ask "did you use…"; toggle ⚠️ | Brain loaded into agent sandbox, linked to sources ⚠️ |
| Limits | Not documented ❌ | No separate limit for chat-history context ⚠️ | ❌ | ❌ |
| Updates / stale | Corrections apply next chat ⚠️ | User corrects ⚠️ | Enterprise updates an existing memory ⚠️ | Brain **marks stale**, reinforces current ⚠️ |
| Chat delete → memory | **Not removed** (current) ✅ | Must delete the memory **and its sources** ✅ | Delete source chats ⚠️ | Not documented ❌ |
| Deleted logs | — | Deleted-memory logs ≤30 days ✅ | Human-reviewed copies up to 3 years (App) ✅ | Account data 30 days ⚠️ |
| Admin | Org OFF deletes all; admins **can't view but can export**; toggles audited ✅ | Business org OFF deletes saved memories ✅ | Enterprise default ON ✅ | Admin can disable Memory / Brain ✅ |
| Project | Separate project memory ✅ | Project-only memory ✅ | Not for Gems ⚠️ | Personal memory account-scoped ✅ |
| Sensitive | Opt-in for health, beliefs, etc.; **never saved: government IDs, criminal history, financial account numbers, immigration status** ✅ | Not documented by category ⚠️ | ❌ | AI filtering for credentials ⚠️ |

**APIs and open source:**
- **Vertex Memory Bank:**
  - **GA**; **asia-south1 supported** (data-at-rest residency).
  - Managed extraction (default Gemini 3.5 Flash) plus consolidation (create / update / delete).
  - Custom topics and few-shot examples; TTL with no default expiry; scope is a key/value map; similarity retrieve, top-k default 3.
  - Revisions kept 365 days by default and still readable **48 h after a delete**.
  - Default embedding `text-embedding-005` (Embedding 2 is global / us / eu only).
  - Usable from our own FastAPI; `CreateMemory` bypasses extraction.
  - Price is tiny: $0.30/GiB-month; reads/writes per million.
- **Claude memory tool:** GA, no beta header, **supported on Vertex Sonnet/Opus 5.5**. A 6-command file protocol (view / create / str_replace / insert / delete / rename); storage is ours.
- **Mem0:** the paper uses **ADD / UPDATE / DELETE / NOOP** against related existing memories; the current OSS v3 moved to ADD-only. Apache-2.0, pgvector supported.
- **Zep / Graphiti:** facts carry `valid_at` / `invalid_at`; changed facts are invalidated, not erased (history is kept). Apache-2.0.
- **LangMem:** memory types are semantic / episodic / procedural; a background memory manager; MIT.
- **Benchmarks:** LongMemEval (extraction, multi-session, temporal, **knowledge updates**, **abstention**); LoCoMo.
- **DPDP Rules 2025:**
  - The core consent and erasure duties **start May 2027**.
  - Erasure "within a reasonable time"; no fixed number of days.
  - **Rule 8(3): processing logs must be kept ≥1 year**; backups are addressed in Rule 6.
  - No AI-memory-specific rule.

## 2. Gaps (numbered)
| # | Gap | Source | MVP/Later |
|---|---|---|---|
| MG1 | Store choice: own Postgres vs Memory Bank vs Claude memory tool | ✅ Vendor | MVP → MEM-ST |
| MG2 | Record keeps **source links** (chat ids, message ids) so deletion can cascade | 🔧 ArcNave (ChatGPT "memory and its sources") | MVP |
| MG3 | Auto pipeline compares new facts with related existing memories and decides **add / update / no-op** (Mem0 paper) | ✅ Vendor (Mem0, Memory Bank consolidation) | MVP |
| MG4 | Changed facts are **superseded, not erased** (valid_from / invalid_at); superseded memories are never sent to the model | ✅ Vendor (Zep) | MVP |
| MG5 | Auto pipeline never deletes on its own; only the user deletes (safety against bad extraction) | 🔧 ArcNave | MVP |
| MG6 | User-edited or explicitly saved memories are **locked** from auto-update | 🔧 ArcNave | MVP |
| MG7 | Categorised topics in the settings UI (work, preferences, projects…) | ✅ Vendor (Claude) | MVP UI |
| MG8 | Read strategy: preferences always loaded; facts loaded in full under a budget, else top-k | ⚠️ Partial (ChatGPT "relevant", Memory Bank top-k) | MVP → MEM-READ |
| MG9 | Memory cap + "memory full" behaviour (nobody documents numbers) | ❌ Not found → 🔧 ArcNave | MVP → MEM-CAP |
| MG10 | Staleness: optional `expires_at` for temporary facts; no default TTL | ✅ Vendor (Memory Bank TTL, Perplexity stale) | MVP |
| MG11 | Extraction timing: background, debounced per chat, skipping trivial turns | ✅ Vendor (LangMem background, Perplexity) | MVP → MEM-TIME |
| MG12 | **Forbidden list expanded**: add criminal history and immigration status (Claude's never-saved list) to passwords, card/bank numbers and government IDs | ✅ Vendor (Claude) | MVP |
| MG13 | "Memory used" indicator: what exactly to show | ⚠️ Partial (ChatGPT sources) | MVP → MEM-USED |
| MG14 | Chat-delete cascade: learned only, or explicit too | 🔧 ArcNave (Claude: none; ChatGPT: delete sources too) | MVP → MEM-DEL |
| MG15 | Admin export of memories (Claude allows it) | ✅ Vendor | MVP → MEM-ADMIN |
| MG16 | Logs: DPDP Rule 8(3) keeps processing logs ≥1 year → **logs hold ids only, never memory text** | ✅ Vendor (DPDP) + 🔧 | MVP |
| MG17 | Deleted memory: hard delete of row + vector at once; backups age out (7-day PITR); the deletion ledger is re-applied after any restore (R-fix) | 🔧 ArcNave | MVP |
| MG18 | User export of their memories (JSON / Markdown) | ✅ Vendor (Claude export pattern) | MVP |
| MG19 | Memory eval set modelled on LongMemEval categories (extraction, update, abstention, deletion, sensitive, injection) | ✅ Vendor (benchmarks) | MVP offline (Stage 21) |
| MG20 | User feedback: "this memory is wrong" → delete / edit; counts tracked | 🔧 ArcNave | MVP |
| MG21 | Extractor sees **related existing memories** (top-k) as context → needs the same tenant/user scope filter | 🔧 ArcNave (security) | MVP |
| MG22 | Memory language: stored in English (MEM-6); quoted names kept in original script | 🔧 ArcNave | MVP |
| MG23 | Past-chat search (later): built as a tool call with citations, reusing Stage 12 retrieval; chats with memory OFF are excluded | ✅ Vendor (Claude tool calls) | Later |
| MG24 | Project memory (later, MD-1) | ✅ Vendor | Later |
| MG25 | Perplexity-style "Brain" (entities / workstreams graph) | ⚠️ Partial | Later (no) |

## 3. Claude-only list
| # | Item | Effect |
|---|---|---|
| CLM1 | Memory tool is GA on Vertex Sonnet/Opus 5.5 | Not our user-memory store: it is Claude-only and conflicts with M10 provider-neutral. Note for Stage 10: it could later serve as a long-task scratchpad |
| CLM2 | Compaction (`compact-2026-01-12`, on-demand `compact-2026-09-04`) is **Beta on Google Cloud** for 5.5; context-editing availability on Vertex not found | Stage 10 / Stage 6 note; not used in MVP |
| CLM3 | Cache prefix is tools → system → messages; memory goes after the breakpoint | Already the Stage 6 layout (memory in the latest user turn) ✅ |
| CLM4 | claude.ai current behaviour: chat delete does NOT remove memory | Our cascade rule is stronger; keep it |
| CLM5 | Never-saved categories | → MG12 |
| CLM6 | Categorised topics UI | → MG7 |
| CLM7 | Admins can export memories | → MEM-ADMIN |
| CLM8 | Memory OFF in a chat also blocks past-chat search of that chat | For MG23 (Later) |

## 3b. How Claude manages memory
**Documented (official):**
- claude.ai:
  - memory is written as categorised topics during chats;
  - past-chat search runs as a RAG tool call and shows citations;
  - project memory is separate; incognito is excluded;
  - pause / reset / edit; sensitive topics are opt-in; there is a never-saved list;
  - org OFF deletes all.
- API: the memory tool, a client-side file directory (`/memories`) with 6 commands. Anthropic's context-engineering post recommends compact, high-signal "structured notes".

**Observed in this Claude session's own instructions** (not public documentation; may differ by surface):
1. Store = one file per subject:
   - `profile` (who the user is, <300 words);
   - `preferences` (how the user wants Claude to work);
   - `topics/<domain>`, `areas/<ongoing work>`, `people/<person>`;
   - each file has a one-line description.
2. **Read:** a snapshot (profile + preferences + file list) is loaded at session start. Other files are read **on demand** through a tool, only when the reply needs them. This is progressive disclosure, as with skills.
3. **Write:**
   - an explicit "remember / forget" is written immediately in the turn;
   - otherwise a **background pass after the turn** reads the whole exchange and files durable facts;
   - that pass skips turns where an explicit write already happened.
4. **Only facts the user stated** get saved: no inferences, nothing from tool, file or web output, and no Claude advice.
5. **Skipped:**
   - facts that expire on their own (where someone is right now, temporary ids);
   - never saved: ID and account numbers, criminal and abuse history, immigration status, and similar;
   - sensitive categories (health, finance, religion…) pass through a **server-side consent check**.
6. **Preference poisoning guard:** it never stores instructions that make the assistant less honest or less safe ("always agree", "ignore rules").
7. **Use:**
   - memory only where it changes the answer;
   - never narrate it ("based on your memory");
   - never bring up sensitive memories unprompted.
8. **Forget:** the line is removed completely, with no "used to like X" trace.

**Lessons for ArcNave:**
- MG26: compact profile summary always loaded + detail on demand.
- MG27: no inferred facts.
- MG28: preference poisoning guard.
- MG29: skip auto-extraction when an explicit save happened in the turn.
- MG30: don't save self-expiring facts.
- MG31: don't narrate memory use (already in the Stage 6 prompt ✅).

| # | Gap | Source | MVP/Later |
|---|---|---|---|
| MG26 | **Compact profile** (≤~250 tokens, regenerated from memories after changes) always loaded, plus relevant detail memories | ⚠️ Observed (Claude) + ✅ Anthropic "high-signal notes" | MVP (changes MEM-READ) |
| MG27 | Extractor saves only what the user **stated**; no inferences (e.g. no diagnosis from symptoms) | ⚠️ Observed (Claude) | MVP (extractor prompt) |
| MG28 | **Preference poisoning guard**: reject memories that lower safety/honesty ("always agree", "skip warnings", "I'm admin") | ⚠️ Observed (Claude) + 🔧 | MVP (validator) |
| MG29 | Auto pass skips a chat window where an explicit save/forget already happened (avoids double or re-saving forgotten facts) | ⚠️ Observed (Claude) | MVP |
| MG30 | Don't save self-expiring facts at all (current location, today's task); `expires_at` only for medium-term ones | ⚠️ Observed (Claude) | MVP |
| MG31 | A "forget" also removes any memory derived only from it; the auto pass never re-saves a forgotten fact (forgotten-text tombstone hash, no text kept) | ⚠️ Observed + 🔧 | MVP |

## 4a. Memory architecture (ArcNave)
```
 ┌──────────────── READ PATH (every turn, inside Turn Executor) ─────────────────┐
 │ L5b Context service → Memory Reader                                          │
 │   1 gates: company ON? user not paused? chat toggle ON?                      │
 │   2 load profile summary (≤250 tok) + all active preferences                 │
 │   3 facts: all if ≤1.5k tok else top-12 (query embedding + recency)          │
 │   4 drop superseded/expired · escape text · place in latest user turn        │
 │   5 record memory ids in turn record → "Personalised with N memories" (L1)   │
 └──────────────────────────────────────────────────────────────────────────────┘
 ┌──────────────── WRITE PATH A – explicit (same turn) ─────────────────────────┐
 │ model → memory_save / memory_delete → Memory Validator                       │
 │   (forbidden list · sensitive consent · poisoning guard · ≤300 chars · dedupe)│
 │   → Memory Store (locked=true) → reply to model → flag chat window "explicit"│
 └──────────────────────────────────────────────────────────────────────────────┘
 ┌──────────────── WRITE PATH B – auto (background) ────────────────────────────┐
 │ turn done → outbox → Cloud Tasks (background-low) → debounce ~2 min/chat     │
 │ → Extraction job: user-written msgs only (skip trivial / explicit windows)    │
 │   + top-10 related memories (same company+user scope)                         │
 │ → M8 extractor (Gemini Flash, JSON ops ADD/UPDATE/NOOP)                       │
 │ → Memory Validator → apply (UPDATE = supersede) → embed (M4) → store          │
 │ → regenerate profile summary if changed                                       │
 └──────────────────────────────────────────────────────────────────────────────┘
 ┌──────────────── CONTROL + DELETE PATHS ──────────────────────────────────────┐
 │ Settings UI → Memory API: list (by category) · edit (→locked) · delete ·      │
 │   pause · reset · export · sensitive opt-in                                   │
 │ Admin switch OFF → delete-all job (warn first)                                │
 │ Chat delete → cascade job (MEM-DEL) · account delete → delete all             │
 │ All deletes: hard delete row+vector+sources · deletion ledger · ids-only audit│
 └──────────────────────────────────────────────────────────────────────────────┘
 Memory Store = Cloud SQL Postgres (Mumbai): memory + memory_source + pgvector, RLS
 Observability (Stage 17): extraction counts, rejections by rule, "wrong memory" feedback
```

## 4. Recommended design (for decisions)

**Store (MEM-ST): own Postgres + pgvector, in the same Mumbai DB.** Why not Memory Bank:
- (a) a second store outside RLS, the deletion ledger and backups;
- (b) revisions still readable 48 h after a delete, and 365 days by default;
- (c) its default embedding is English-only, while Embedding 2 is global-only;
- (d) our rules (user-text only, consent, forbidden list, source links, cascade) must be ours anyway.

At our scale (tens to hundreds of memories per user) the work is small. Memory Bank stays the documented fallback.

**Record:**

```
memory(id, company_id, user_id, scope='personal', kind fact|preference, category, text ≤300,
       origin explicit|learned, locked bool (explicit or user-edited), sensitive_category null|health|finance|…,
       status active|superseded|archived, valid_from, invalid_at, superseded_by, expires_at null,
       created_at, updated_at, last_used_at, use_count, embedding halfvec(1536), embed_model, extractor_version)
memory_source(memory_id, chat_id, message_id)      -- many sources per memory
```

RLS covers both tables. Audit rows hold ids only.

**Write paths:**
1. **Explicit** (`memory_save` in the turn, MD-2):
   - validate: forbidden list, sensitive consent, ≤300 chars, near-duplicate check;
   - save with `locked=true`;
   - reply to the model with the id.
2. **Auto** (background, MEM-TIME):
   - gather this chat's new user-written messages, skipping trivial turns;
   - run the extractor (Gemini Flash, MEM-6 prompt v2), given the top-10 related existing memories;
   - it returns operations `ADD{text,kind,category,sensitive,expires_at?}` / `UPDATE{id,new_text}` / `NOOP`;
   - a validator checks the same rules;
   - `UPDATE` supersedes: the old row gets `invalid_at`, the new row links back. Locked memories are never updated, only offered as a suggestion later.
3. No automatic deletes.

**Read path (MEM-READ):** every turn, when memory is on for the user and chat:
- all active **preferences**;
- **facts**: all of them if the total is ≤ ~1,500 tokens; otherwise top-12 by similarity to the turn's query, plus recency;
- skip expired and superseded memories;
- update `last_used_at` async.

Placement stays as in Stage 6 (latest user turn). Memory text is escaped.

**Delete:**
- A single delete or reset is a hard delete of row + vector + sources, done immediately.
- **Chat delete:** for each memory sourced from that chat, remove the source; if no sources remain **and** `origin=learned`, delete the memory. Explicit/locked memories stay (MEM-DEL option A).
- Org OFF deletes all.
- Account delete deletes all.
- Backups age out; the ledger is re-applied after any restore.

**Limits (MEM-CAP, provisional; numbers final in Stage 18):**
- 200 active memories per user.
- At the cap, auto-ADD archives the least-used learned memory, and settings shows "memory full".
- Explicit saves are blocked with a message.

## 5. Decisions needed
| ID | Question | Recommendation |
|---|---|---|
| MEM-ST | Where memories live | **Own Postgres + pgvector (Mumbai)**; Memory Bank as fallback |
| MEM-OPS | Auto pipeline operations | **ADD / UPDATE (supersede, history kept) / NOOP**; no auto-delete; locked memories never auto-changed |
| MEM-READ | What goes into each turn | **Compact profile summary + all preferences** always; facts: all if ≤ ~1.5k tokens, else top-12 relevant (MG26) |
| MEM-TIME | When extraction runs | Background, **debounced per chat (~2 min after the last user message, or at chat close)**, skip trivial |
| MEM-DEL | Chat delete cascade | **A:** delete only *learned* memories whose only source was that chat; explicit/edited ones stay (shown in the delete dialog). B: delete all derived, including explicit |
| MEM-ADMIN | Admin access | No admin viewing or export in the UI; export only through an ops process on legal request, logged |
| MEM-CAP | Cap | 200 active per user, ≤300 chars; archive least-used learned at the cap (numbers final in Stage 18) |
| MEM-USED | "Memory used" indicator | MVP: "Personalised with N memories" when memories were included, with tap-to-see list; exact attribution Later |
| MEM-SENS | Forbidden list | Add criminal history + immigration status to passwords, card/bank numbers, government IDs (never saved, even with consent) |
| MEM-STALE | Expiry | No default TTL; the extractor may set `expires_at` for clearly temporary facts |

**Doc-sync:**
- Stage 6 policy spec + prompts: forbidden list (MEM-SENS); MEM-6 extractor prompt v2 (operations + related memories + expires_at).
- Stage 8 `memory_save` description: it already says ≤300 chars ✅.
- Stage 5 F8 wording, if MEM-DEL A is chosen.

**LV-1 / Stage 21:**
- Extractor precision on Tanglish chats.
- Update correctness.
- Memory eval set (MG19).

**Confidence:**
- Store and pipeline design: high. Every piece has an official or open-source precedent, and DPDP fits.
- Numbers (cap, budget, debounce): provisional; Stage 18 sets them.

## 6. Sources
- support.claude.com/en/articles/11817273 · /12138966 (release notes) · /9028421
- help.openai.com/en/articles/8590148 · /9295112 · /10169521 · /6378407
- support.google.com/gemini/answer/16598469 · /16598625 · /13594961 · docs.cloud.google.com/gemini/enterprise/docs/configure-personalization
- perplexity.ai/help-center/en/articles/19700001 · perplexity.ai/changelog (Dec 5; Feb 20 2026) · perplexity.ai/hub/blog/self-improving-memory-for-agents
- platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool · …/build-with-claude/prompt-caching · …/compaction-threshold · …/compaction-on-demand · anthropic.com/engineering/effective-context-engineering-for-ai-agents
- docs.cloud.google.com/gemini-enterprise-agent-platform/scale/memory-bank (setup, generate-memories, fetch-memories, revisions, api-quickstart) · …/resources/agent-locations · cloud.google.com/products/gemini-enterprise-agent-platform/pricing
- arxiv.org/abs/2504.19413 (Mem0) · docs.mem0.ai/migration/oss-v2-to-v3 · langchain-ai.github.io/langmem · docs.letta.com · github.com/getzep/graphiti · help.getzep.com/facts · arxiv.org/abs/2410.10813 (LongMemEval) · github.com/snap-research/locomo
- meity.gov.in DPDP Act 2023 + DPDP Rules 2025 (Nov 2025) + corrigendum (Dec 2025)
