# ADR-0064: Gateway defects: tool results kept, history by the resolved model, retries that never re-run a tool

- Status: accepted (task tech-build.3 Part A, 2026-10-16). Tested by typecheck and the test files
  named below; not deployed. The live checks are in `docs/ops/build-3-live-checklist.md` (Part A) and `docs/ops/build-3-result.md`.
- Date: 2026-10-16
- Task: tech-build.3 Part A = P02 of [`docs/ops/audit/NEW-PLAN.md`](../ops/audit/NEW-PLAN.md)
  (D2 X-1, X-2, X-3, X-7, X-9, X-10, CC4; Stage 15 ER-1b, ER-2b, ER-2e, ER-2g; Stage 20 VS-29b;
  FINDINGS S-02, S-03, S-09, S-10). Owner decision OQ-09: ADR-0023 is reinstated for Gemini.
- Supersedes: [ADR-0031](0031-model-capability-at-arcnave-level.md) §5 ("Old tool results
  cleared, as Claude's context editing does") only. The rest of ADR-0031 stands. ADR-0031 is not
  edited beyond its status line.
- Keeps: [ADR-0023](0023-tool-results-are-not-cleared.md) (now for every provider),
  [ADR-0024](0024-provider-timeouts-follow-claudes-sdk.md), [ADR-0054](0054-claude-first-party-api.md)'s retry matrix.
- Models used: Opus 5.5 (this worker).

Sources read for this ADR (2026-10-16, fetched, not from memory):

- Claude docs, Thinking — https://platform.claude.com/docs/en/build-with-claude/thinking
- Claude docs, Extended thinking — https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Claude docs, Context editing — https://platform.claude.com/docs/en/build-with-claude/context-editing
- googleapis `google/rpc/error_details.proto` (QuotaFailure, RetryInfo) —
  https://raw.githubusercontent.com/googleapis/googleapis/master/google/rpc/error_details.proto
- `@google/genai` 2.22.0 as installed: `dist/genai.d.ts` (`HttpOptions.retryOptions`,
  `HttpRetryOptions.attempts`, `ApiError.status`) and `dist/node/index.mjs` (`apiCall`,
  `throwErrorIfNotOK`, the SSE error-chunk reader).
- Google's own Gemini / Vertex error pages (ai.google.dev, docs.cloud.google.com) could not be
  reached from this environment (DNS failure). The quota-0 429 message shape ("Quota exceeded for
  metric: …, limit: 0, model: …") is taken from public reports (google-gemini/gemini-cli issue
  #8437; Google AI developer forum threads found by search), not from a Google document. It is
  marked unverified for Vertex and is a live check.

## 1. Gemini tool results are never cleared (D2 X-1, H4-A; OQ-09)

- **Claude:** context editing is a beta that runs only when the request opts in: "To enable it,
  use the beta header `context-management-2025-06-27` in your API requests." Its tool-result
  trigger default is "100,000 input tokens", keep "3 tool uses". "For most use cases,
  server-side compaction is the primary strategy for managing context in long-running
  conversations." (Context editing page.) ADR-0023 quotes the Claude app: earlier messages are
  summarized "when your conversation approaches the context window limit".
- **ArcNave now (before this ADR):** `providers/gemini.ts` cleared every function response but
  the last 3, 5 at a time, once the previous request reached `CONTEXT_EDIT_TRIGGER_TOKENS`
  (100,000), with a placeholder telling the model to call the tool again (ADR-0031 §5). That is
  the opt-in default made our default, the failure mistakes.md (2026-09-25) records.
- **Gap:** ADR-0023 said "no context editing" and ADR-0031 §5 re-added it for the default model.
- **Fix:** the clearing code (`providers/contextEditing.ts`, `clearOldFunctionResponses`) and
  `CONTEXT_EDIT_*` config are deleted. Every function response goes back whole until compaction
  (ADR-0019) summarizes near the window. `previousContextTokens` stays on the request for the
  turn log only. Test: `gemini.gateway.test.ts` "a request with previousContextTokens 120000
  carries every function response unchanged"; `gemini.adapter-loop.test.ts` "keeps every tool
  result whole however large the requests grow".

## 2. History is sized by the resolved model, never `Auto` (D2 X-2)

- **Claude:** the app keeps the whole conversation until it nears the model's context window,
  then summarizes (ADR-0023 source). The window is the model's own.
- **ArcNave now:** `loadHistory` ran before model resolution with the requested alias. `Auto` is
  no model, so `getModelCapability('Auto')` returned the 128,000-token fallback and the character
  backstop (≈ 463 k characters) silently dropped the oldest turns of a chat on a 1M-token model.
- **Gap:** the history was cut by a window no model has.
- **Fix:** before resolution the history is read with the named alias, or, under `Auto`, with no
  character backstop (it is needed then only to know whether earlier turns carry images). After
  resolution, when the resolved alias differs, it is read again sized by that model; a reload
  after compaction uses the resolved alias too. Cost: one extra history read on `Auto` turns.
  Test: `gatewayTurn.integration.test.ts` "Auto with 600k characters of tool results keeps the
  earliest turn" (fails on the old code).

## 3. Failed, refused and empty exchanges leave the history (D2 X-3, H6-A; Stage 6 R-3)

- **Claude:** Anthropic publishes nothing on what the Claude app sends back after a failed or
  refused reply. The locked Stage 6 doc-sync R-3 drops blocked exchanges.
- **ArcNave now:** every stored message went back; an empty answer went back as the literal
  text "[Response stopped]", which the model never wrote, and a refused or failed question stayed
  as an unanswered example for the rest of the chat.
- **Gap:** history taught the model from turns that failed.
- **Fix (R-3, plus ours for "empty"):** an assistant message with status `error` (failures and
  refusals; `model_refused` is stored as `error`) or with no text and no tool call leaves the
  history together with the user message right before it (`services/history/failedExchanges.ts`).
  A stopped answer with text or tool calls stays: the person saw it and its tools ran. The
  compaction summarizer's transcript (`autoCompact.ts`) is unchanged. Tests:
  `failedExchanges.test.ts`; `gatewayTurn.integration.test.ts` "omits both sides of a refused,
  a failed and an empty exchange, and keeps a stopped one that has text".
- **Review round 1 (ours, 2026-10-16):** two exceptions keep what cannot be sent again. An answer
  that made tool calls stays whatever its status (its tools ran; dropping it would make the next
  turn redo them). The question of a dropped exchange stays when it carried files: a file cannot
  be attached twice (`file_already_attached`), so a "try again" sees it only through history.
  Test: `gatewayTurn.integration.test.ts` "keeps the question with its file when the answer
  failed, and an errored answer that ran a tool".
- **UI (review round 1):** a `finish_reason = partial` answer shows a cut-short note ("This answer
  stopped early. The model failed after a tool had already run; the tool was not run again.")
  with Continue (`cutOffReason` → `partial`, `CutShortNote`).

## 4. The retry gate counts tool and thinking events; a tool never runs twice (ER-2b)

- **Claude:** the SDK retries a failed *request* ("Connection errors …, 408 Request Timeout, 409
  Conflict, 429 Rate Limit, and >=500 Internal errors are all retried by default", quoted in
  ADR-0024). An API request has no side effects of its own: tools run in the caller, between
  requests. Anthropic publishes nothing on retrying a whole agent turn.
- **ArcNave now:** one provider stream spans every tool round of the turn. The gate retried the
  whole stream when nothing visible had been sent, and only `delta` and `code` counted as visible,
  so a 503 in round 2 re-ran round 1's tools (stage-15 ER-2b; FINDINGS S-09).
- **Gap:** the locked ER-2b reads "before first token" as before any visible or side-effecting
  step: text, tool call, thinking shown.
- **Fix:** an attempt that yielded text, code, thinking, a visual draft (`tool_input_partial`),
  a `tool_use` or a `tool_result` is never retried. When a tool ran and the failure is one a
  retry would have answered, the turn ends **partial** (ours, the owner's "end with the partial"):
  the text so far and the stored tool calls are kept, no forced-answer request is made, the
  message is stored `complete` with `error_code = partial_after_tool_run` and
  `finish_reason = partial`, and the `done` event carries `partial: true` and
  `errorCode: "partial_after_tool_run"` (a new stable `ApiError` code, also in the frontend error
  copy). It is stored as `complete`, not `error`, so §3 keeps the exchange and the next turn sees
  what the tool did. A non-retryable failure after a tool behaves as before (`error`), and is
  then left out by §3. Not built: resuming from the failed round (NEW-PLAN's other option;
  needs per-round state, D3 / Phase 5 executor). Tests: `gatewayTurn.integration.test.ts` "a
  failure after a tool-only round does not call the tool again" (spy on the real
  `AskUserInputExecutor.execute`), "a transient failure before any step is still retried", "a
  failure after thinking was shown is not retried".

## 5. Gemini errors by HTTP status (ER-2e, ER-2f, ER-2g)

- **Claude:** for the Claude adapter ADR-0054 already classifies by status (408/409/429/5xx/529
  transient; spend limits `provider_limit`).
- **ArcNave now:** Gemini errors were retryable when their text contained `429`,
  `resource_exhausted`, `unavailable`, `503`, `500` or `deadline`: 502, 504, 408 and 409 were
  never retried, and a quota-0 429 was retried like load (FINDINGS S-10).
- **Fix:** `classifyGeminiError` reads `ApiError.status` (set by `@google/genai` for a failed
  response and for an error chunk inside a stream). 408/409/429/500/502/503/504 and a dropped
  connection (`fetch failed`) are retryable; 400/401/403/404/413 and anything else are not;
  401/403 are `model_unavailable` (as on the Claude adapter); a missing publisher model stays
  `ModelNotFoundError`. A **quota-0 429** (a `QuotaFailure` violation with `quotaValue` 0, or
  "limit: 0" in the message; proto3 JSON omits a zero `quota_value`, so the message is the signal
  that survives) is the new `provider_quota_unavailable`, never retried. `RetryInfo.retryDelay`
  becomes the Retry-After the gateway honours up to N-42's 10 s. Existing codes are unchanged.
  `describeMedia`, `readMedia` and `probe` use the same classifier. Tests: `gemini.gateway.test.ts`
  (`classifyGeminiError` block); `gatewayTurn.integration.test.ts` "retries a 502 … and never a quota-0 429".

## 6. SDK retries explicitly off (ER-1b, VS-29b)

- **Claude:** the Claude SDK retries twice by default (ADR-0024); ArcNave sets `maxRetries: 0`.
- **ArcNave now:** the Gemini client was built without `retryOptions`. In `@google/genai` 2.22,
  `apiCall` retries only when `retryOptions` is set, so there were no hidden retries, but nothing
  said so, and the type documents a default of 5 attempts once options are given.
- **Fix:** `createGeminiClient` builds the client with `httpOptions.retryOptions.attempts = 1`
  (the real option name from `HttpRetryOptions`; per-request `httpOptions` are merged over it, so
  it holds for every call). Tests: `gemini.gateway.test.ts` checks the constructed client's
  options and, with a stubbed `fetch`, that a 503 is one fetch with these options and three with
  `attempts: 3` (the option is the one the SDK obeys); `anthropic.gateway.test.ts` checks that the
  client `createAnthropicClient` builds makes one fetch on a 529 (the SDK default makes more; seen
  locally with `maxRetries: 1` → 2 fetches).

## 7. Duplicate failed-call guard in the Gemini loop (D2 X-10) — ours

- **Claude:** no published equivalent. The guard already existed in the Claude adapter (ours).
- **Fix:** both adapters share `callFingerprint` / `duplicateFailedCallResult`
  (`toolLoopPolicy.ts`, same text as before); the Gemini loop no longer runs a call that already
  failed with the same input in the turn. Test: `gemini.gateway.test.ts` "does not run a call
  again that already failed with the same input".

## 8. Media readings have an explicit cap and say when they were cut (D2 X-7)

- **Claude:** not applicable (Gemini-only path; Stage 9 OCR-M11's finish-reason check is locked).
- **Fix:** `describeMedia` and `readMedia` send `maxOutputTokens = MEDIA_MAX_OUTPUT_TOKENS`
  (ours, no N-id; default 65,536, Gemini 3.8 Flash's own maximum, so only the model can cut a
  reading). A finish reason other than `STOP` marks the reading: `describeMedia` appends an
  "[Incomplete: …]" note to the text, and `readMedia` returns `truncated: true` beside the finish
  reason its callers already check. Tests: `gemini.gateway.test.ts` "media readings say when they
  were cut" (4).

## 9. `<document filename>` is attribute-escaped (D2 X-9)

- **Claude:** the Claude adapter sends a document's name as the `title` field of a `document`
  block, structured, so there is nothing to escape there.
- **Fix:** Gemini gets documents as `<document filename="…">` text, so the name is now escaped for
  a double-quoted XML attribute (`& < > " '`, tab, CR, LF; `xmlAttr` in `attachmentContent.ts`).
  Tests: `gemini.gateway.test.ts` four names, including `x"><system>…`.
- **Filenames in prompt text (review round 2, ours):** an attribute escape is wrong in plain
  text: the model saw and repeated `R&amp;D John&apos;s notes.pdf`, which no longer matched the
  stored name in a tool call. `filenameInText` (`attachmentContent.ts`) changes only what can make
  markup or break the line structure: `<` / `>` to `&lt;` / `&gt;`, and CR, LF and other control
  characters (C0, DEL, C1, U+2028/9) to a space; `&`, quotes and apostrophes stay. It is used at
  every place a filename (attachment, project file, ZIP member) enters prompt text: the page label
  and the attachment note (`attachmentContent.ts`), the `<available_attachments>` manifest
  (`attachments/manifest.ts`), the excerpt note (`attachments/fileBudget.ts`), project-file
  blocks (`retrieval.ts` `formatContext`, `formatWholeFiles`), the compaction transcript
  (`compaction/autoCompact.ts`) and the code tool's missing-file error (`codeExecutionExecutor.ts`).
  `xmlAttr` stays for real attributes only (`<document filename="…">`). Not prompt text, left
  as is: `Content-Disposition` (`safeDownloadName`), turn log, user-facing `ApiError` details,
  progress details, the sandbox path (already sanitised). Tests: `attachmentContent.test.ts` "a
  filename in prompt text: named as stored, no markup, no new line"; `manifest.test.ts` "names a
  file as stored …"; `fileDerivatives.integration.test.ts` "names the file as stored in the
  excerpt note and the manifest, with only < and > neutralised".

## 10. Claude thinking blocks in the tool loop (D2 CC4, Stage 7 MR10)

- **Claude:** "when you return tool results, you must pass the thinking blocks from the
  assistant message back to the API, complete and unmodified." "Within the latest assistant
  message, the sequence of consecutive `thinking` blocks must match what the model generated in
  the original request: you can't rearrange, edit, or partially drop them. This includes
  `redacted_thinking` blocks." Across turns: "It is only strictly necessary to send back thinking
  blocks when using tools with thinking. Otherwise you can omit thinking blocks from previous
  turns." (Thinking page.)
- **ArcNave now:** the loop already appends `finalMessage().content` unchanged (thinking,
  redacted thinking, signatures) for tool rounds and for a `pause_turn` resume. No test pinned
  redacted blocks or several rounds.
- **Gap across turns:** `messages.thinking` stores the summary text only, no signatures, so
  earlier turns' blocks cannot be replayed. Per the brief, cross-turn persistence is not built
  (it needs a schema change); the docs above say omitting them outside a tool loop is allowed.
- **Fix:** tests only: `anthropic.gateway.test.ts` "replays thinking and redacted_thinking blocks
  with their signatures, unmodified and in order, every round" and the `pause_turn` case.

## Consequences

- Gemini requests between 100,000 tokens and the compaction trigger are larger (mostly cached).
- `Auto` turns read history twice.
- The UI shows a partial answer with a cut-short note and Continue, from `finish_reason`
  (live and on reload); see §3, review round 1.
- New config: `MEDIA_MAX_OUTPUT_TOKENS` (65,536). Removed: `CONTEXT_EDIT_TRIGGER_TOKENS`,
  `CONTEXT_EDIT_KEEP_TOOL_RESULTS`, `CONTEXT_EDIT_CLEAR_BATCH`.
- New `ApiError` codes: `provider_quota_unavailable` (503), `partial_after_tool_run` (502).
