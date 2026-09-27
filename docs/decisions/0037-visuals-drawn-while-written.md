# ADR-0037: A visual is drawn while the model writes it

- Status: accepted. Tested locally with a scripted provider; not live, and not yet run against
  a real Vertex model.
- Date: 2026-09-27
- Builds on: [ADR-0035](0035-sandboxed-visuals-and-interactive-artifacts.md),
  [ADR-0036](0036-sandboxed-visuals-inherit-arcnave-theme.md).
- Amended by [ADR-0048](0048-artifacts-questions-visuals-and-cards-as-the-reference.md): drafts come from show_widget's widget_code, titled by its first loading message.

## Context

Claude's app draws a custom visual as it arrives: the markup fills in piece by piece and the
scripts run once it is complete. In ArcNave, a `render_ui` visual appeared only after the
whole call had been generated, so a large visual meant a long pause with nothing on screen.

What the providers offer (read 2026-09-27):
- Vertex Gemini: `toolConfig.functionCallingConfig.streamFunctionCallArguments`. The call then
  arrives over several parts. The first names it; later parts carry `partialArgs`, each an
  RFC 9535 JSON path with a value, where a string with `willContinue` goes on in the next piece.
  The call ends with a part whose `willContinue` is not true. Documented for Gemini 3 Pro and
  later, not for 3.1 Flash-Lite, and not on the Gemini Developer API. Sources: the
  `@google/genai` 2.22 type docs (`FunctionCallingConfig`, `FunctionCall`, `PartialArg`), the
  Vertex function-calling guide as summarised by search, and google/adk-go PR #1630 for how
  paths and strings are assembled.
- Claude on Vertex: fine-grained tool streaming. `input_json_delta` events, and the SDK's
  `MessageStream.currentMessage` keeps a tool call's input parsed from the partial JSON.

## Decision

1. **A provider-neutral event, `tool_input_partial`** (`providers/types.ts`): a call's
   arguments so far, its index in the response, and its name. It is only reported. The call
   still runs from its `tool_use`, once complete, with the same checks as before.
2. **Gemini** asks for streamed arguments when `render_ui` is declared and
   `GEMINI_STREAM_TOOL_ARGS` is on (the default). `StreamedCallAssembler` rebuilds calls from
   the parts, and takes a call sent whole unchanged. A path it cannot read is dropped, never
   stored under a made-up key. If Vertex rejects the option with `INVALID_ARGUMENT`, the round
   is re-sent without it and that model gets whole calls from then on, with a warning in the
   log. This is not a silent substitution: the model, the tools and the result are the same;
   only the timing of the drawing changes.
3. **Claude** reports `render_ui` from the SDK's snapshot, at most every 120 ms, because each
   read re-parses the partial JSON. `eager_input_streaming` is **not** set. Without it, Vertex
   may buffer the `html` parameter until it is complete, so a Claude visual may still arrive
   at once. Turning it on changes the validation guarantee and needs a live check first.
4. **`ui_draft` SSE events carry only what is new**: `{draftId, title, from, text}`. Resending
   the whole HTML on every piece would cost O(n²) bytes for a 200 KB visual. A draft is capped
   at the visual size limit. The client appends a piece only where the draft ends, and a piece
   starting at 0 starts it again.
5. **The frame is never rebuilt while a draft grows.** `SandboxFrame draft` loads one empty
   document and posts the markup to it at most every 100 ms. The bridge sets it as
   `innerHTML`, so `<script>` elements do not run until the finished block replaces the draft.
   The bridge takes a draft only from `window.parent`.
6. **A draft is never kept.** It is dropped when the `render_ui` result arrives (the checked
   `ui_block` follows), when the turn ends, or on error. It is not stored and not replayed on
   reload.

## Consequences

- Markup in a draft is the model's unvalidated HTML, drawn in the same sandbox as the finished
  visual. Inline event handlers, such as `onerror`, can run there. The frame's isolation
  (ADR-0035) is what protects ArcNave, as it is for the finished visual. A call that later
  fails validation has already been drawn as a draft, and the draft then disappears.
- Streaming applies to every call of a response in which `render_ui` is declared, so the
  assembler is on the path of every Gemini tool call in chat. Tests cover whole calls, streamed
  calls, the closing part repeating the name, and the fallback.
- Live risk: the exact shape of Vertex's streamed parts is documented only in part. If
  production shows a problem, `GEMINI_STREAM_TOOL_ARGS=false` (set with `--update-env-vars`)
  returns to whole calls with no deploy.

## Verification (local)

- Backend unit tests: path parsing, piece assembly, whole calls, the closing part with
  complete `args`, the fallback on `INVALID_ARGUMENT`, the config switch, and Claude snapshot
  reporting limited to `render_ui`. The integration test `visualDraft.integration.test.ts` checks
  that only new characters are sent.
- Frontend tests: draft pieces in order, restart at 0, a mismatched piece dropped; the frame
  keeps one document and redraws at most every 100 ms.
- Real Chromium, against the real app with a scripted provider writing a 3 KB visual in 60
  pieces: the draft grew from 118 to 2,960 characters over 7 s and the frame grew from 240 to
  571 px. The finished block then replaced it, ran Chart.js, and left no draft behind. No page
  errors.
