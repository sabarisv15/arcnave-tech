# Intelligence and latency audit (2026-09-26)

The user's report: ArcNave handles requests with less intelligence than Claude, and turns lag.
This audit reads the turn from request to answer: architecture, pipeline and "brain" (prompt,
tools, model choice). Claude's behaviour is cited from Claude's docs and Help Center.

## Evidence

- **Live logs** (revision 00141, two turns in one chat):

  | Turn | Pre-provider work | Model's first event | Stream | Total | Tool calls |
  |---|---|---|---|---|---|
  | Tally XML | ~0.2 s | 74 s | 655 s | 729 s | 15 |
  | "federal enga?" | ~0.13 s | 10.4 s | 462 s | 472 s | 2 |

  Everything before the model call is under 0.2 s. The time is in the model and tool loop.
- **Measured request** (test harness, flags as production: tools, skills, web, memory,
  run_python):
  - A "hi" turn sends a 30,500-character system prompt (about 7,600 tokens).
  - It declares seven tools: search_tools, load_skill, generate_deliverable, save_memory,
    search_chats, forget_memory and run_python.
- **Screens:**
  - Follow-ups sat on "Sending request" while the server had already sent `start` within
    0.13 s. That is a transport hold, tracked separately (DevTools check requested).
  - One turn billed 2.24M input tokens over about 10 rounds.

## Findings

| # | Level | Finding | Claude | Effect |
|---|---|---|---|---|
| I1 | Brain | In Chat mode the model cannot search the web. Gemini's Google Search grounding is on only in Search/Research mode (`requiresGrounding = mode !== 'chat'`). `web_search` needs `SERPAPI_API_KEY` or `GOOGLE_SEARCH_API_KEY`+`ENGINE_ID`; without them `web.search` is unavailable. Even with a key, it is discoverable only: the model must first call search_tools. | "There's no web search toggle. Claude searches the web when it helps" (Help Center, new experience). | "Check this on AICTE" is answered from memory or not at all. Each discovery round adds a full model round-trip. |
| I2 | Brain | Auto routes by the current turn only: an upload turn goes to the quality tier; a follow-up about the same file goes to economy (Gemini 3.8 Flash). One chat can switch models mid-task. | One model per conversation, chosen by the user. | Follow-ups about a file get the weakest model, and cross-provider replay loses thinking context. |
| I3 | Pipeline | Every tool round resends the whole chat: all PDF page images and every earlier tool result, uncleared. | Context editing clears old tool results past 100k input tokens and keeps the last 3 (API docs). The app compacts. | 74 s to the first event on a long chat; about 10 rounds × about 220k tokens; slow and costly. |
| I4 | Brain | The skills rule says "load every skill whose description fits before doing the work (for example, before working on an uploaded PDF…)". A question about a PDF already in context costs a load_skill round first. | Skills load when a task needs their procedure. | One extra full-context round (tens of seconds) on file questions. |
| I5 | Brain | The prompt describes `render_ui` ("You have access to the render_ui tool") and create_artifact, but they are not declared that turn. Gemini can only call declared functions. The guard test misses it because render_ui is "allowed". | Tools named in the prompt are callable. | The model plans a call it cannot make, then recovers or gives up. |
| I6 | Brain | The prompt is about 7,600 tokens of generic rules, partly duplicated (completion, verification, file rule), and written in capitals ("NEVER", "TRANSFORM. DO NOT SILENTLY REWRITE."). | Claude's prompting guide: current models follow instructions precisely; aggressive emphasis causes over-triggering. | The model spends attention on rules, not the user; it is rigid on simple asks. |
| I7 | Pipeline | The model writes no text between tool steps. | Brief progress text. | Fixed in PR #21 (prompt line). |
| I8 | Transport | Frames did not reach the browser during a run. The request was logged as HTTP/1.1. | Streams. | Pending the DevTools timing check; not a code change yet. |

## Proposed fixes, in order of effect

1. **I1: web search in every mode, decided by the model.**
   - Declare Gemini's Google Search grounding on every Gemini turn with tools. Vertex accepts
     `googleSearch` alongside function declarations on gemini-3.8-flash (mistakes.md, 2026-09-19).
   - Declare Claude's `web_search` server tool on Claude turns.
   - Grounding is billed per search the model runs; check the Vertex price before turning it on.
2. **I2: keep a chat on one model under Auto.**
   - Route on "the conversation has files", not "this turn has files".
   - Keep the model already used in the chat unless the user changes it.
3. **I3: clear old tool results as Claude's context editing does.**
   - Past 100k input tokens, keep the last 3 tool results and replace the rest with a placeholder.
   - Clear at least a set amount at a time, so the cached prefix is not broken every round.
4. **I4: load a skill when its procedure is needed** (producing or converting a file, exact
   extraction), not to answer a question about a file already in context.
5. **I5: name only declared tools in policy text,** and extend the guard test from "allowed" to
   "declared or discoverable and described as such".
6. **I6: prompt diet.** Remove duplicates and capitals; keep the rules that change behaviour. Target
   about half the size, and measure it with the existing budget test.

## Fix status (2026-09-26, ADR-0031)

| # | Status |
|---|---|
| I1 | Fixed: search declared on Chat turns when the web is on; the model decides. |
| I2 | Fixed: Auto keeps the chat's model. |
| I3 | Fixed for Gemini (adapter clears past 100k, keeps 3, batches of 5). Claude: use its server-side context editing when Claude is turned on. |
| I4 | Fixed: skills load for procedure; descriptions updated. |
| I5 | Fixed: "You have access" policies only for declared tools; guard test extended. |
| I6 | Done: prompt rewritten calm and without duplicates (30,500 → 23,500 characters). |
| I7 | Fixed in PR #21. |
| I8 | Open: waiting on the DevTools timing check. |
| Added | Reasoning effort (`REASONING_EFFORT`, default high) and 64K output. |
