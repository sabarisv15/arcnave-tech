# ADR-0028: A turn never waits on a model probe

- Status: accepted. Tested locally; not live.
- Date: 2026-09-26

## Context

`resolveModel` asked the registry for the model's status, and a status older than
`MODEL_PROBE_TTL_SECONDS` (300 s) or missing (every cold instance) meant a real one-token
provider call before the turn's own request. With Auto, every alias was probed. It is the
likely cause of the ~5 s "Sending request" (audit B2; `turn timing` logs `probed` to confirm).

Claude's SDK has no pre-flight call: the request itself returns the error (docs: timeouts,
retries, errors). This is the absence of a feature, not a stated rule.

## Decision

1. A turn resolves models with `probe: 'never'`: a recent status is used; otherwise a
   configured model is tried.
2. What the turn's request shows is recorded: a model-not-found marks the alias unavailable
   until the probe TTL passes; a completed request marks it available. Settings' model list
   still probes, off the turn's path.

## Verify

`routes/chats.integration.test.ts`, "model availability (ADR-0028)".
