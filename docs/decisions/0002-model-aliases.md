# ADR-0002: UI model aliases resolve through a configured registry

- Status: accepted
- Date: 2026-09-16

## Context

The composer shows five product labels: `Auto`, `Gemini 3.8 Flash`, `Sonnet 5`, `Opus 5`,
`GPT 5 Terra`. These are marketing labels, not Vertex publisher model IDs. Research
(`docs/backend-research.md` §3) established:

| UI label | Real Vertex model | Verified |
| --- | --- | --- |
| Gemini 3.8 Flash | `gemini-3.8-flash` (publisher `google`) | yes |
| Sonnet 5 | `claude-sonnet-5` (publisher `anthropic`) | yes |
| Opus 5 | `claude-opus-5` (publisher `anthropic`) | yes |
| GPT 5 Terra | **none** | — |

"GPT 5 Terra" does not exist on Vertex. The real GPT-5.6 Terra is proprietary OpenAI, served
by the OpenAI API / Bedrock / OpenRouter. Vertex Model Garden carries only open-weight
`openai/gpt-oss-*`.

## Decision

1. Aliases live in a **server-side registry** built from environment configuration. No model
   ID is ever hardcoded in a code path or inferred from a label.
2. An alias with no configured model ID is reported `unavailable` with a machine-readable
   `reason`, and the composer disables it with an explanation. We never substitute.
3. `Auto` is not a model. It is a documented, tested routing rule that returns the model it
   selected in response metadata.
4. **The `GPT 5 Terra` alias is remapped to `openai/gpt-oss-120b-maas` and the UI label is
   changed to `GPT-OSS 120B`.** The remap was the product owner's call (2026-09-16). The
   relabel is not optional: presenting gpt-oss-120b under a "GPT 5 Terra" badge would be the
   silent substitution this ADR exists to prevent.

## Auto routing rules

Deterministic, ordered, and unit-tested in `backend/tests/test_routing.py`. First match wins;
any rule whose target alias is unavailable falls through to the next.

| # | Condition | Target |
| --- | --- | --- |
| 1 | mode is `research` | quality tier |
| 2 | attachments present, or project context exceeds the long-context threshold | quality tier |
| 3 | prompt length over the long-prompt threshold | balanced tier |
| 4 | otherwise | economy tier |

Tiers are resolved from the user's routing preference (`quality` / `balanced` / `economy`),
which biases which alias each tier maps to. If every candidate is unavailable, the request
fails with a typed `no_model_available` error rather than a guess.

## Consequences

- A new model is added by setting env vars and restarting. No code change.
- `GET /v1/models` is the single source of truth for the composer; the frontend ships no
  model table of its own.
- The frontend's `Model` union type is generated from the API, so removing "GPT 5 Terra"
  from the backend removes it from the UI's type space too.
