# ADR-0055: Three models — Gemini 3.8 Flash, Claude Sonnet 5.5, Claude Opus 5.5

- Status: accepted
- Date: 2026-10-14
- Amended by [ADR-0080](0080-history-summary-and-helper-jobs.md): one helper row (Claude Haiku 5.5, `role: 'helper'`) for background jobs only; the three chat models stand.
- Task: tech-p1.C (build plan decision B-4)
- Supersedes in part: [ADR-0002](0002-model-aliases.md) (the alias table and its Decision 4, the
  `GPT 5 Terra` → `GPT-OSS 120B` remap). ADR-0002's rules 1–3 (registry, no substitution, Auto
  is a routing rule) stand.
- Relates to: [ADR-0054](0054-claude-first-party-api.md), [ADR-0031](0031-model-capability-at-arcnave-level.md).

## Decision

1. The registry has exactly three aliases plus `Auto`:

   | Alias | Provider | Tier | Model id (default) | Source |
   |---|---|---|---|---|
   | Gemini 3.8 Flash | Vertex (`google`) | economy | `MODEL_GEMINI_FLASH` (no default) | ADR-0002 |
   | Sonnet 5.5 | Claude API (`anthropic`) | balanced | `claude-sonnet-5-5` | docs.claude.com/en/docs/about-claude/models, read 2026-10-14 |
   | Opus 5.5 | Claude API (`anthropic`) | quality | `claude-opus-5-5` | same |

   The Claude ids are documented first-party ids, so `MODEL_SONNET` / `MODEL_OPUS` default to
   them (a departure from ADR-0002's "never defaulted" for these two only). An empty value turns
   the alias off, reported `not_configured`, never swapped.
2. **gpt-oss is removed everywhere:** `gptOssVertex.ts`, the `openai-oss` provider, `MODEL_GPT_OSS`,
   `GPT_OSS_LOCATION`, the capability row, routing/test fixtures, the frontend fixtures,
   `.env.example`, `compose.yaml`.
3. **Stored preferences** that name a retired alias are moved by migration 0027:
   `Sonnet 5` → `Sonnet 5.5`, `Opus 5` → `Opus 5.5` (same tier; Settings and the composer show
   the new name, so the change is visible), `GPT-OSS 120B` → `Auto`. Stored messages keep the
   alias that answered them: history is a record.
4. All three models read images, so the vision gate in `generation.ts` has no served model to
   refuse; its integration test was removed and `routing.test.ts` keeps the filter covered with a
   synthetic text-only entry.

## Consequences

- `Auto` routes economy → Gemini, balanced → Sonnet 5.5, quality → Opus 5.5 (rules unchanged).
- The `brandNeutral` guard exempts `providers/anthropic.ts`, `registry.ts` and
  `capabilitiesTable.ts`: they name the models ArcNave serves (Invariant 7 allows provider names
  where the code talks to that provider).
