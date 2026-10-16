# ADR-0071: Stage decisions win over the Claude-reference rule

- Status: accepted (owner decision, 2026-10-16)
- Date: 2026-10-16
- Task: tech-build.3-docs (docs only); header completed by tech-build.3-docs2
- Supersedes in part (neither file is edited):
  - [ADR-0061](0061-locked-decisions-win-outside-stack-and-infra.md), Consequences, the last
    bullet only ("The invariants in `CLAUDE.md`, the Tanglish rule and the "Claude is the
    reference" rule are unchanged. Where the reference rule and a locked decision disagree, stop
    and ask the owner (as ADR-0053 already says)."). The invariants and the Tanglish rule stay
    unchanged (Decision 4 below); the reference rule now yields to a locked stage decision.
    ADR-0061's Decision section and its other Consequences stand.
  - [ADR-0053](0053-prototype-base-and-target-spec.md), Consequences, last bullet, its last
    sentence only: "Where the two disagree, stop and ask the owner." The rest of that bullet and
    every other ADR-0053 decision stand.
- Relates to: `CLAUDE.md` "Rules for changing this codebase";
  [`.claude/rules/claude-reference.md`](../../.claude/rules/claude-reference.md) "Precedence".

## Context

Two rules can point different ways. "Claude is the reference for every change" (`CLAUDE.md`,
`.claude/rules/claude-reference.md`) says each change starts from how Claude does it. ADR-0061
says the repo must meet every locked stage decision outside tech stack and infra. ADR-0061 kept
both and sent every disagreement between them to the owner. Those disagreements are frequent
(the stage checkpoints add ArcNave-specific decisions on top of Claude's behaviour: tenancy,
budgets, India, numbers, the system prompt), and each one stopped a task for an owner answer the
owner has now given once, for the whole class.

## Decision

1. **The 21 stage checkpoints are the truth.** A stage decision is its latest doc-sync line in the
   mirror under `docs/architecture/` (as ADR-0061 Decision 3), the system prompt included (Stage 6:
   `06-policy-spec-v3.md`, `06-system-prompt-v3-gemini.md`, `06-system-prompt-v3-claude.md`).
2. **Where "Claude is the reference" and a locked stage decision disagree, the stage decision
   wins.** The reference rule applies only where the stages are silent.
3. **Rewriting or building new is allowed to meet a locked outcome**, tech stack and infra
   excepted, as ADR-0061 Decision 1–2.
4. **Above both:** the `CLAUDE.md` invariants (Invariant 7, the brand rule, included) and the
   Tanglish rule. Neither a stage decision nor the reference rule overrides them.
5. **Conflicts of this class no longer go to the owner.** The task's ADR records which stage
   decision was applied (its id and doc-sync line) and what Claude does differently.
6. **Still sent to the owner:** a conflict between two stage decisions, and a conflict between a
   stage decision and an invariant (or the Tanglish rule). ADR-0061 Decision 4 (an ADR-0053 owner
   decision against a locked stage decision goes to the owner) is unchanged.

## Consequences

- `CLAUDE.md` "Rules for changing this codebase", first bullet, and
  `.claude/rules/claude-reference.md` "Precedence" each gain one sentence pointing here. Nothing
  else in them changes.
- Order of precedence, highest first: `CLAUDE.md` invariants and the Tanglish rule → locked stage
  decisions (outside tech stack and infra) → "Claude is the reference" → our own ideas (labelled
  as ours).
- A task brief no longer needs an owner answer to choose between Claude's behaviour and a stage
  decision; it cites the stage decision id and its ADR records the difference from Claude.
- ADR-0053's last Consequences bullet carried the same "stop and ask the owner" sentence that
  ADR-0061 restated; both are superseded here (header), so no ADR still sends this class of
  conflict to the owner. ADR-0053 and ADR-0061 are left unedited as the record of what was decided.
