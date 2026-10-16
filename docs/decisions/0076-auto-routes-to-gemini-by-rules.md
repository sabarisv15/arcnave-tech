# ADR-0076: Auto routes every turn to Gemini 3.8 Flash by rules; the routing preference is retired

- Status: accepted (task tech-p07 = P10, owner decisions 2026-10-16). Tested offline; not
  merged, not deployed.
- Date: 2026-10-16
- Task: tech-p07, Part B. Evidence: [`docs/ops/p07-result.md`](../ops/p07-result.md) (routing table).
- Supersedes in part: [ADR-0002](0002-model-aliases.md), section "Auto routing rules" (the tier
  table and the user's routing preference). ADR-0002's registry decisions and
  [ADR-0031](0031-model-capability-at-arcnave-level.md) decision 4 (one model per chat under Auto)
  stand.
- Models used: Opus 5.5.

## Stage decision applied

Stage 7, locked 2026-10-02: RT-1 "MVP Auto = rules only … → Gemini 3.8 Flash", 7.9 capability
matrix ("Rules derived: audio/video → Gemini only · PDF > 600 pages or request > 30 MB → Gemini ·
Claude switch off / limit reached → Gemini"), 7.10 M1 (Sonnet and Opus on manual pick), Stage 18
doc-sync ("Opus never default"), and the 2026-10-10 registry doc-sync (`auto` → Gemini). Owner
decisions 2026-10-16: Auto = Gemini default, Opus manual only, an attachment does not force a
Claude model, `routingPreference` removed.

## Claude

Claude's apps have no task-based Auto: the user picks the model, and a fallback answer is
labelled (Stage 7 evidence table). Stage 7 decided an Auto of its own (rules only); the stage wins
(ADR-0071).

## Decision

1. `routeAuto` (`backend/src/providers/routing.ts`) returns Gemini 3.8 Flash for every turn, with
   rule `auto_gemini`. Nothing promotes a turn to Sonnet or Opus: not an attachment, research mode,
   a long prompt or project context. Every 7.9 rule ends at Gemini, which Auto already is.
2. When Gemini is not available, or cannot do what the turn needs, Auto refuses with
   `no_model_available` (`meta.reason: auto_model_unavailable`); it never substitutes a Claude
   model the user did not choose (Invariant 1).
3. Unchanged, the stage being silent: Auto keeps the model the chat last answered with
   (ADR-0031 decision 4), a manual pick is used as asked, effort per profile (RT-4). **Except Opus**
   (review round 1): Auto never keeps Opus, since Opus is manual only — otherwise every chat the old
   Auto promoted to Opus (`attachments_present`) would stay on Opus under Auto after deploy.
4. `routingPreference`: the Settings control is removed; routing reads nothing from it; the
   `PATCH /v1/usage/limits` field is accepted and ignored (described "Deprecated, no effect"), so an
   older client's save does not fail; it is no longer in any response. The database column stays
   (no migration); dropping the column and the field is DEFERRED.
5. `AUTO_ROUTE_LONG_PROMPT_CHARS` and `AUTO_ROUTE_LONG_CONTEXT_CHARS` are removed from the config.

## Gap

- A manually picked model that is unavailable still falls back to Auto with only a log line
  (`backend/src/services/turn/modelRouting.ts:56`); the answer carries the Auto rule, not a
  machine-readable fallback reason and label (RT-5, 7.12). Behaviour design, so not changed here:
  DEFERRED to P11 (Prompt 5).
- The keep-the-chat's-model rule can keep Sonnet (picked by name, or chosen by the old Auto's
  `long_prompt` rule) for later Auto turns. Stage 7 is silent; for the owner.
- The Claude switch and the per-company Claude budget (RT-7, RT-8) are not built (single user;
  company features are Phase 5).

## Fix

P11 adds the fallback reason and label; Phase 5 adds the switch and budget.
