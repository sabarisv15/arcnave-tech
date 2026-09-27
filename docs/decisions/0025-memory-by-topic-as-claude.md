# ADR-0025: Memory is kept by topic, saved as the user chats, and loaded whole, as Claude's is

- Status: accepted. Tested locally; not live.
- Date: 2026-09-26
- Replaces: the per-prompt "relevant memory" search into the system prompt, and the memory
  policy that told the model to "store" with tools it did not have (audit C2, C3).
- Amended by [ADR-0047](0047-tools-and-skills-match-the-reference.md): memory is Markdown files by path with six memory_* tools and version tokens; topics saved before moved to /topics/<slug>.md (migration 0022); search_chats became conversation_search, read_conversation and recent_chats.

## Context

The 2026-09-26 audit found memory off by default, no tool or route that creates a memory, a
policy promising one, and a search that ANDed every word of the prompt, so "federal la evlo
entries and kvb la evlo entries?" never matched a memory about KVB (C1–C5).

Claude, read 2026-09-26:

- Blog, "Claude's memory works everywhere, and you decide what's in it" (2026-08-25): "Claude
  now adds topics to memory as you chat, instead of summarizing conversations after they end."
  "Everything Claude remembers is in a list of files under Topics in Memory settings, where you
  can read, edit, or delete each one." Memory is "on by default". "By default, Claude does not
  store topics related to personal or sensitive subject matter, like your health, race,
  ethnicity, religious beliefs, politics, gender identity."
- Help Center, chat search and memory: "Tell Claude what you'd like it to remember, change, or
  forget, and the update applies to your next conversation." "Each project has its own separate
  memory space." Chat search covers "All chats outside of projects" or is "limited to within
  each specific project", and "When Claude searches your previous chats, you will see this
  reflected in your current chat as a tool call."

## Decision

1. `save_memory(topic, content, scope?)` creates or replaces a topic; `forget_memory` takes a
   topic name or an id. Both are declared on every turn memory is on, so the model can save
   without a discovery round. Topic names match case-insensitively.
2. Every topic the conversation may use (global, plus the project's inside a project) goes into
   the system prompt under `<memory>`, standing items first, within `MEMORY_CONTEXT_MAX_CHARS`
   (8,000). The rest stay reachable with `search_memory`, and the prompt says how many. The text
   changes only when memory does, so it no longer breaks the prompt cache every turn (audit B9).
3. The policy tells the model to save durable facts without being asked, never sensitive
   subjects or secrets unless asked for that specific thing, and to confirm only after the tool
   succeeds.
4. Search matches any word (`to_tsquery` with `|`), ranked; the ILIKE fallback tries each word.
5. Settings lists topics and lets the user add, edit (with a version check, `409 conflict` when
   stale) and delete them: `POST /memory`, `PATCH /memory/:id`.
6. `search_chats` searches earlier conversations in Claude's scopes, never the current chat.
7. `ENABLE_MEMORY` defaults to true.

## Not done

- Incognito chats (not saved to history or memory).
- Importing or exporting memory.
- A sensitive-topics toggle: the policy's default is Claude's default, with no switch.

## Verify

`routes/memory.integration.test.ts` (save/replace/forget by topic, any-word search, the cap,
add and edit with a stale version, the same `<memory>` block on two turns, chat search scopes).
