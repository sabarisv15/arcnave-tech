# Backend research

Primary-source research backing the ArcNave backend. Every material decision below cites
the document it came from and the date it was read. Re-verify anything older than a few
months: model catalogues and SDK surfaces move quickly.

All sources accessed **2026-09-16**.

---

## 1. Google generative SDK: which one

**Decision: `google-genai` (Google Gen AI SDK), pinned `>=2.0,<3.0`.**

The generative modules of the older Vertex AI SDK — `vertexai.generative_models`,
`vertexai.language_models`, `vertexai.vision_models`, `vertexai.tuning`,
`vertexai.caching` — were deprecated 2025-06-24 and **removed 2026-06-24**. Code importing
`from vertexai.generative_models import GenerativeModel` no longer works on current
`google-cloud-aiplatform` releases. The prompt's instruction to avoid
`vertexai.generative_models` is not merely stylistic; the module is gone.

- Migration guide: <https://cloud.google.com/vertex-ai/generative-ai/docs/deprecations/genai-vertexai-sdk>
- SDK repo: <https://github.com/googleapis/python-genai>
- PyPI: <https://pypi.org/project/google-genai/> — 2.23.0 published 2026-09-10, requires Python >= 3.10

Client construction for Vertex-backed usage:

```python
from google import genai
client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
```

Newer docs also show `genai.Client(enterprise=True, project=..., location=...)` following the
"Gemini Enterprise Agent Platform (formerly Vertex AI)" rebrand. Both forms appear in the wild.
We use `vertexai=True` because it is the form the migration guide and the currently published
SDK reference agree on, and we isolate it in one adapter so a rename is a one-line change.

Pin `<3.0.0`: the `agent_engines` module is being renamed to `runtimes` in an upcoming major,
and sandboxes/sessions/memory_banks move under the top-level client. We use none of those,
but an unpinned major bump is avoidable risk.

The API endpoint host is unchanged (`aiplatform.googleapis.com`) despite the rebrand.

## 2. Anthropic models on Vertex

**Decision: `anthropic[vertex]` with `AnthropicVertex`, region `global`.**

Source: <https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai>

Two request-format differences from the direct Messages API:

1. `model` is **not** in the request body — it goes in the Google Cloud endpoint URL.
2. `anthropic_version` **is** in the request body (not a header) and must be `vertex-2023-10-16`.

Both are handled by the SDK; we do not hand-roll the HTTP call.

```python
from anthropic import AnthropicVertex
client = AnthropicVertex(project_id=PROJECT, region="global")
```

### Endpoint types

| Type | Region value | Pricing | Notes |
| --- | --- | --- | --- |
| Global | `global` | baseline | Recommended. Dynamic routing, max availability. Pay-as-you-go only. |
| Multi-region | `us` / `eu` | +10% | Data residency within a geography. Pay-as-you-go only. |
| Regional | e.g. `us-east5` | +10% | Required for provisioned throughput / strict residency. |

Critically: **regional endpoints support Claude Sonnet 4.6 and earlier only.** Newer models
(Opus 5, Sonnet 5, Fable 5.1) require the global or multi-region endpoints. Our default is
`global`, which is both the cheapest and the only one that serves the models we alias.

### Context windows

Opus 5, Sonnet 5, Opus 4.6/4.7/4.8, Sonnet 4.6, Fable 5/5.1 have a **1M-token** context window
on Agent Platform. Sonnet 4.5 and older are 200k. Request payloads are capped at **30 MB**
regardless of token count — relevant to our project-file injection, which is another reason
we chunk rather than inject whole files.

### Feature support relevant to us

Supported: Messages API, prompt caching, thinking, tool use, **web search tool**, citations,
structured outputs.

**Not** supported on Vertex: Files API / URL input sources, server-side tools (code execution,
web fetch), Agent Skills, MCP connector, Message Batches, the Models endpoint, Usage and Cost
endpoints, and server-side `fallbacks`.

The missing **Models endpoint** is why our model-availability check is a cheap probe request
rather than a catalogue listing — see §5.

## 3. Verified model IDs

### Anthropic on Vertex

Verbatim from the Anthropic docs table (2026-09-16), abridged to current models:

| Model | Agent Platform API model ID |
| --- | --- |
| Claude Fable 5.1 | `claude-fable-5-1` |
| Claude Opus 5 | `claude-opus-5` |
| Claude Sonnet 5 | `claude-sonnet-5` |
| Claude Opus 4.8 | `claude-opus-4-8` |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` |
| Claude Haiku 4.5 | `claude-haiku-4-5@20251001` |

Note the format split: current models use plain hyphenated IDs; older ones carry an
`@YYYYMMDD` suffix. Both forms are valid model IDs — our registry stores the string verbatim
and never constructs one.

### Gemini on Vertex

`gemini-3.8-flash` — GA 2026-09-02, knowledge cutoff March 2026, introductory pricing
$0.75/1M input through 2026-12-31.

Source: <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/release-notes> and the
model card at <https://deepmind.google/models/model-cards/gemini-3-8-flash/>

**Residency caveat:** Gemini 3.8, 3.7 and 3.6 Flash run in the `global` region only, with no
data residency. `gemini-3.5-flash` is the newest Gemini offering EU data residency. If
residency is ever a requirement, the registry alias must move to 3.5.

### OpenAI on Vertex — the "GPT 5 Terra" problem

**There is no `GPT 5 Terra` on Vertex AI.** Two separate facts:

1. The real model is **GPT-5.6 Terra**, the mid tier of the GPT-5.6 family released
   2026-07-09 (tiers: Luna < Terra < Sol). It is proprietary OpenAI, available through the
   OpenAI API, Amazon Bedrock, and OpenRouter.
   Source: <https://developers.openai.com/api/docs/models/gpt-5.6-terra>
2. Vertex AI Model Garden carries only OpenAI's **open-weight** `gpt-oss` family as
   Model-as-a-Service: `openai/gpt-oss-120b-maas` and `openai/gpt-oss-20b-maas`. Google's
   Model Garden third-party proprietary catalogue is Anthropic Claude; the rest are open
   models (Llama, Mistral, Gemma, DeepSeek, Qwen, gpt-oss).
   Source: <https://docs.litellm.ai/docs/providers/vertex_partner> and the Vertex release notes.

`gpt-oss` is served over an **OpenAI-compatible chat-completions path**, not the Gemini
`generateContent` path — so it needs its own adapter, not a branch inside the Gemini one.
It supports a `reasoning_effort` parameter (minimal → high).

**Product decision (owner: user, 2026-09-16):** remap the alias to `openai/gpt-oss-120b-maas`
and **relabel the UI** from "GPT 5 Terra" to "GPT-OSS 120B". Keeping the old label over a
different model would be exactly the silent substitution the brief forbids. Recorded as
[ADR-0002](decisions/0002-model-aliases.md).

## 4. Grounded search — real citations only

**Decision: Gemini Grounding with Google Search, with redirect resolution.**

Source: <https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1beta1/GroundingMetadata>

`groundingMetadata` carries:

- `webSearchQueries` — the queries actually issued. These back our research progress events,
  so the events describe work the server really performed.
- `groundingChunks[].web` — `{uri, title, domain}` per source.
- `groundingSupports[]` — maps response text spans (`startIndex`/`endIndex`) to
  `groundingChunkIndices`, which is what lets us attach citations to specific claims instead
  of dumping a bibliography.

Two traps, both handled in `providers/grounding.py`:

1. **`chunk.web.uri` is a redirect**, of the form
   `https://vertexaisearch.cloud.google.com/grounding-api-redirect/…`, and `chunk.web.title`
   is often just a bare domain. The canonical URL requires following the redirect. We resolve
   them concurrently with a HEAD request and fall back to the redirect URL, flagging the
   source as unresolved rather than inventing a URL.
2. **`groundingSupports` offsets are byte offsets into UTF-8**, not character indices.
   Slicing in Python requires `text.encode("utf-8")[start:end].decode("utf-8", "ignore")`.

Also: `groundingSupports[].confidenceScores` is empty for Gemini 2.5 and later. Ignore it;
do not surface a confidence number we did not receive.

Display obligation: Google's Service Specific Terms require rendering the `searchEntryPoint`
widget and showing sources when using Grounding with Google Search. We pass
`search_entry_point` through to the client for this reason.

Anthropic's own **web search tool** is supported on Vertex and returns citations; it is
implemented as the grounding path for Claude aliases.

If neither is configured, `/v1/models` reports `search: false` and research/search modes
return a typed `capability_unavailable` error. We never synthesise a source.

## 5. Model availability probing

Anthropic's Models endpoint is unavailable on Vertex (§2), and Gemini's model list does not
prove a given project is entitled to a given publisher model. The failure mode for an
unentitled or wrong-region model is a **404 "Publisher Model not found"**, not a 403 — easy to
misread as a routing bug.

So availability is determined by a real 1-token probe per configured alias, cached with a TTL,
surfaced at `GET /v1/models`. An alias with no configured model ID is reported
`unavailable` with `reason: "not_configured"` and never probed.

## 6. Streaming transport

**Decision: `sse-starlette`'s `EventSourceResponse`.**

Source: <https://github.com/sysid/sse-starlette> and FastAPI discussion #7572.

Plain `StreamingResponse` is not SSE-aware: it does not set `Cache-Control: no-cache`, has no
disconnect detection, and can buffer under some ASGI configurations. `EventSourceResponse`
runs a background task on the ASGI receive channel; on `http.disconnect` it cancels the
generator task, surfacing `asyncio.CancelledError` at the `yield`.

That cancellation is what we propagate into provider work — caught in the generator, used to
close the provider stream and write a `cancelled` usage record retaining whatever token counts
the provider already reported. We re-raise `CancelledError` after cleanup, as the library
requires.

Heartbeats are bare comments (`: heartbeat\n\n`), no `data:` prefix. Default ping is 15s.

Operational note for any future proxy: nginx/CloudFront drop idle SSE connections after
30–60s regardless of heartbeats; `proxy_read_timeout` must be raised.

## 7. Claude Code configuration

### Status line

Source: <https://code.claude.com/docs/en/statusline>

`statusLine: {type: "command", command: "...", padding, refreshInterval}` in settings.
The command receives session JSON on stdin. Fields we use, verbatim from the documented
example:

```json
{
  "model": { "id": "claude-opus-5", "display_name": "Opus" },
  "cost": { "total_cost_usd": 0.01234, "total_duration_ms": 45000 },
  "context_window": {
    "total_input_tokens": 15500,
    "total_output_tokens": 1200,
    "context_window_size": 200000,
    "used_percentage": 8,
    "current_usage": {
      "input_tokens": 8500, "output_tokens": 1200,
      "cache_creation_input_tokens": 5000, "cache_read_input_tokens": 2000
    }
  },
  "exceeds_200k_tokens": false
}
```

Fields are `null` before the first API response — the script must use `// 0` fallbacks.
`used_percentage` is the documented field for context state; we do not compute our own.

Windows note from the troubleshooting section: with Git Bash installed, **backslashes in the
`command` path are consumed as escape characters**. Use forward slashes. Our config does.

### Hooks

Source: <https://code.claude.com/docs/en/hooks-guide>

- `SessionStart` fires on session begin/resume with `source` ∈ `startup | resume | clear |
  compact | fork`. **stdout is added to Claude's context as plain text** for this event —
  which is how we surface `CURRENT.md`. Exit code 2 does not block `SessionStart`; stderr is
  shown and execution continues.
- `SessionEnd` fires on termination with `reason` ∈ `clear | resume | logout |
  prompt_input_exit | other`. All `SessionEnd` hooks **share a 1.5-second budget** unless a
  longer per-hook `timeout` raises it (max 60s). Our checkpoint reminder is a fast local
  write, well inside it.
- `Stop` hooks support `type: "prompt"` and experimental `type: "agent"`. We use neither —
  a command hook that cannot block normal work is what the brief asked for.

We deliberately do **not** use a blocking `Stop` hook: it risks trapping the model in a loop
(the docs describe a block cap for exactly this reason) and the brief requires hooks that do
not obstruct normal work.

## 8. Rejected alternatives

| Option | Why not |
| --- | --- |
| `vertexai.generative_models` | Removed 2026-06-24. Not a style preference. |
| Direct OpenAI API for the Terra alias | Out of the Vertex-only boundary; user chose the Vertex remap. |
| LiteLLM / LangChain as the provider layer | Adds an abstraction whose model catalogue also goes stale, and hides the exact usage metadata we are required to record verbatim. Two thin adapters are less code than configuring one framework. |
| Raw `StreamingResponse` | No disconnect detection; cancellation propagation is the requirement. |
| pgvector + embeddings for project retrieval | Would be the honest semantic story, but it is not implemented, so we must not claim it. Local retrieval is lexical (BM25-style) and labelled as such; the interface admits an embedding implementation without touching callers. |
| JWT for the dev session | A revocable server-side session row is simpler to reason about and to invalidate than short-lived tokens plus a refresh dance, at this scale. |
