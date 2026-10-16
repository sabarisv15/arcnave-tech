# ADR-0064: Claude via Claude Platform (first party), Gemini via Vertex

- Status: accepted
- Date: 2026-10-16
- Owner decision: 2026-10-16 (confirms [ADR-0054](0054-claude-first-party-api.md); no new direction).
- Relates to: [ADR-0055](0055-three-models.md), [ADR-0063](0063-files-ingest-and-automated-gates.md).

## Context

ADR-0054 moved Claude from `@anthropic-ai/vertex-sdk` to the first-party API in code. What
remained was readiness reporting that still looked only at Vertex, and no written deploy step for
the key. gpt-oss is not one of ArcNave's three models (ADR-0055); only Gemini stays on Vertex.

## Decision

1. **Claude (Sonnet 5.5, Opus 5.5) is called through Claude Platform** with `ANTHROPIC_API_KEY`
   (`createAnthropicClient`, `maxRetries: 0`; retries stay in the app gateway). **Gemini stays on
   Vertex** with `GOOGLE_CLOUD_PROJECT` and Application Default Credentials.
2. **Readiness is per provider.** A Claude alias without the key reports
   `anthropic_not_configured`; a Gemini alias without a project reports `vertex_not_configured`.
   `/readyz` returns `anthropicConfigured` next to `vertexConfigured`, and its status is `ready`
   only when every provider in use (a model id is set for it) is configured, else `degraded`
   (`providerReadiness` in `config.ts`). The startup warning names the missing variable.
3. **Deploy.** `ANTHROPIC_API_KEY` is a Secret Manager secret mounted into the Cloud Run service
   as an env var, like `COOKIE_SECRET`; steps are in
   [`docs/ops/claude-platform-live-checklist.md`](../ops/claude-platform-live-checklist.md). No
   Terraform here; no key is written to a repo file.

## Consequences

- Claude traffic now leaves GCP and is governed by Anthropic's terms, not Vertex's. Data
  residency for Claude is deferred to Phase 5 (with workload-identity federation, ADR-0054 item 6).
- The no-content logging policy (Stage 17) is unchanged: the key is never logged, and no prompt
  or answer text is logged on either provider.
- A Gemini-only deployment still boots without a key. `/readyz` is `ready` for it only when
  `MODEL_SONNET` and `MODEL_OPUS` are set empty; otherwise the Claude aliases are listed
  (defaults) but unavailable, and `degraded` says so.
