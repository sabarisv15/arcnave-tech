# ADR-0031: The model's full capability is set up by ArcNave, for any model

- Status: accepted. Tested locally; not live. §5 superseded by [ADR-0064](0064-gateway-history-and-retry-defects.md).
- Date: 2026-09-26
- Amends: ADR-0002 (Auto keeps one model per chat), ADR-0027 (old tool results are cleared
  before compaction is needed).

## Context

The user reported that ArcNave answers less intelligently than Claude and lags. The
[intelligence and latency audit](../audits/2026-09-26-intelligence-latency-audit.md) found
that the losses come from how ArcNave sets the model up, not from the model:

- effort was never sent;
- output was capped at 32,000 tokens;
- Chat mode had no web search;
- Auto switched models mid-chat;
- every tool round resent every earlier tool result;
- file questions paid for a skill load;
- the prompt was long, repetitive and emphatic, and promised an undeclared `render_ui`.

The user asked for the fixes at ArcNave's level, so that whichever model runs gets them.
Today that model is Gemini 3.8 Flash.

## Decision

1. **Reasoning effort.**
   - One setting on Claude's ladder: `REASONING_EFFORT`, default `high`.
   - Each model's capability row lists the levels it accepts (`reasoningEfforts`). The
     service clamps to the highest accepted level at or below the request.
   - Mapping per adapter:
     - Claude: `output_config.effort` (the models doc: Opus 5 and Sonnet 5 accept
       low…max; Opus 5.5's default is medium).
     - Gemini 3.8 Flash: `thinkingLevel` LOW/MEDIUM/HIGH. The default is MEDIUM and MINIMAL is
       refused (Google's 3.8 Flash guide).
     - GPT-OSS: nothing is sent.
2. **Output room.**
   - The default is 64,000 and the ceiling 128,000. Claude's docs: "Set it to 64,000 for
     agentic work (128,000 at xhigh or max effort)".
   - A turn never asks for more than its model's maximum (Gemini 3.8 Flash: 65,536).
   - Migration 0015 moves preferences still on the old 32,000 default to 64,000.
3. **Web search in every mode, decided by the model.**
   - Claude "searches the web when it helps" (Help Center, web search).
   - When the web is on (`ENABLE_WEB`) and the model's provider has search, the search tool is
     declared on Chat turns too: Gemini's Google Search grounding alongside the function
     declarations, and Claude's `web_search` server tool.
   - Search and Research modes still require it.
   - In Chat, progress and sources are reported only for searches that ran.
   - Cost (Vertex pricing, read 2026-09-26): Gemini 3 models include 5,000 grounding queries
     a month, then $14 per 1,000 queries. That charge is not yet in `costUsd`.
4. **One model per chat under Auto.** Auto picks on the first turn. Later turns keep the model
   that answered the chat's last completed turn while it is available and can do what the turn
   needs. A pinned model is unchanged.
5. **Old tool results cleared, as Claude's context editing does.**
   - The trigger is 100,000 prompt tokens: the exact size of the last request, or the previous
     turn's for the first request.
   - The 3 most recent results are kept; older ones are replaced with a placeholder.
   - Results are cleared 5 at a time, so the cached prefix holds between batches.
   - `load_skill` results are kept.
   - This is applied in the Gemini adapter. For Claude, use its server-side context editing
     (beta on Vertex) when Claude is turned on: editing earlier turns client-side would
     invalidate its preserved thinking.
6. **Skills load for procedure, not for reading.**
   - The prompt says to load a skill when the task needs its procedure (producing or
     converting a file, exact extraction, computing over a file).
   - A question answerable from the conversation needs none.
   - The pdf, docx, pptx and xlsx descriptions say the same.
7. **Prompt.**
   - The static prompt was rewritten in plain, calm wording, without duplicated rules.
     Claude's prompting guidance: emphatic wording makes current models over-apply a rule.
   - It fell from 30,500 to 23,500 characters on a measured Chat turn.
   - A policy that says "You have access to the X tool" goes in only when X is declared. The
     guard test fails on the old `render_ui` case.

## Consequences

- Higher effort and web search make turns slower or costlier when the model uses them.
  `turn timing` logs the effort, and `streamMs` splits model time from tool time.
- Gemini 3.8 Flash's price rises to $1.5 / $7.5 per 1M tokens on 2027-01-01 (Vertex pricing).
  `PRICING_TABLE` must be updated then.
- Tests:
  - `capabilitiesTable.test.ts`: the effort clamp.
  - The adapter loop tests: effort, search offered in Chat, clearing.
  - `contextEditing.test.ts`.
  - `stickyModel.integration.test.ts`.
  - `promptToolParity.integration.test.ts`: search in Chat and declared-only promises.
