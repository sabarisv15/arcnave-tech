# ADR-0026: Every tool call of a response runs, as Claude's parallel tool use

- Status: accepted. Tested locally; not live.
- Date: 2026-09-26
- Replaces: the one-call-per-round policy (`deferredCallResult`, `disable_parallel_tool_use:
  true`) from item 9 phase 1.
- Amended by [ADR-0051](0051-tool-limit-shown-and-in-view-pdfs-read-by-eye.md): a turn that reaches its last allowed round is reported as `tool_limit` whether or not that round answered (an output cut-off or a refusal excepted).

## Context

Both adapters ran the first call of a response and answered the rest with "Only one tool call
is processed per round", while the system prompt told the model to perform independent
retrievals together (audit B3, D3). Every extra call cost a model round trip.

- Claude docs, Parallel tool use: "By default, Claude may call multiple tools in a single
  response." All results go back in one user message.
- Gemini (Google's thought-signature page, as quoted in search results; the page itself is
  blocked from this session): for parallel function calls "the thought_signature is attached
  only to the first functionCall part".

## Decision

1. Both adapters run every call of a response, in order, and return all results in one turn.
   Sequential, not concurrent: two `run_python` calls share one workspace.
2. Gemini history replays the calls of one response as one model turn and their responses as
   one user turn. A signed call starts a response; the unsigned calls after it belong to it. A
   turn whose first call is unsigned is replayed as text, as before.

## Verify

`providers/*.adapter-loop.test.ts` (all calls run, one results message),
`providers/gemini.test.ts` (grouped replay).
