# ADR-0006: TurnRouter is a policy boundary only

- Status: accepted. Decision 2 amended by [ADR-0022](0022-requests-carry-what-the-conversation-did.md): run_python, read_uploaded_file and generate_deliverable are declared too when allowed.
  Decision 3 superseded by [ADR-0032](0032-one-loop-model-reads-the-request.md): intent detection is removed; the router no longer receives the prompt.
- Date: 2026-09-24
- Changes: the gating role `backend/src/services/routing/turnRouter.ts` plays today. Its header
  already says "the AI model evaluates the task first", but the code does not do that. No earlier
  ADR recorded the router's role, so none is superseded.

## Context

The locked ArcNave architecture (Batches 1–6) puts the model first:

> MODEL decides WHAT to do. SKILL teaches HOW. TOOL performs the action. EXECUTION RUNTIME runs
> it safely. QA checks the result. MODEL evaluates QA and decides to repair or finish.

The router's job in that architecture is one question: is this capability *allowed* for this
turn? That means feature flags, user permission, safety, and whether the infrastructure exists.
Claude's own tool-use pipeline works the same way. Skill descriptions are always in context,
tool search is always available, and the model decides which tools it needs
([`docs/tools-skills-architecture.md`](../tools-skills-architecture.md)).

The code does more than that. `routeTurn()` classifies the prompt with regular expressions and
acts on the result:

- On `EXPLANATION` and `ORDINARY_CHAT` it returns `exposedTools: []`. The model then receives no
  tools at all, not even `search_tools` or `load_skill`.
- `run_python` enters the catalog only if `evaluateRunPythonPolicy` likes the prompt's wording.
  A non-tabular PDF never qualifies.

Traced on 2026-09-24 with a PDF attached and `runPythonEnabled: true`, "Count every transaction
exactly and classify them" came out as `ORDINARY_CHAT`, exposed `[]`, python `false`. For an
exact, exhaustive task the model cannot load the `pdf` skill, cannot discover an extraction
tool, and cannot run Python. It is left guessing from native vision. The system prompt still
tells it to call `load_skill`, which is a promise the request does not keep (Invariant 1).

## Decision

1. **The router returns what is allowed, never what is needed.** `allowedTools` comes only from
   flags, permissions, and infrastructure present (sandbox client, project, attachments in the
   chat). The prompt's wording never adds or removes a tool.
2. **Core discovery is always exposed.** Every turn with tool use enabled gets `search_tools`,
   plus `load_skill` whenever at least one skill exists. No intent class removes them.
3. **Intent detection stays, as telemetry only.** `detectedIntent` and
   `evaluateRunPythonPolicy`'s reason go into the debug trace. They do not gate anything.
4. **The model decides.** A direct answer, loading a skill, discovering a tool, running Python:
   each is the model's choice within the allowed catalog. To keep simple turns fast, the base
   system prompt tells the model to answer directly when that is enough. It does not do this by
   hiding tools.

## Consequences

- Every tool-enabled turn sends two more tool schemas. That is a small token cost and a possible
  extra round when the model chooses to use them. Phase 1 of the fix plan measures this before
  and after with `runBehaviorEvaluation.ts`.
- Tests that assert "ordinary chat gets no tools" or "Python hidden for this prompt" encode the
  old behaviour. They are rewritten in Phase 1, not deleted, so the old contract is visible in
  history.
- Permission still blocks. With `ENABLE_RUN_PYTHON` off or no sandbox client, `run_python` stays
  out of the catalog whatever the prompt says.
- `backend/src/services/routing/turnRouter.locked.test.ts` encodes this ADR. Its cases are
  `it.fails` until Phase 1 lands, then become plain `it`.

Implementation: [`docs/superpowers/plans/2026-09-24-tools-pipeline-gap-fixes.md`](../superpowers/plans/2026-09-24-tools-pipeline-gap-fixes.md),
Phase 1 (gaps G1, G2, G3, G7).
