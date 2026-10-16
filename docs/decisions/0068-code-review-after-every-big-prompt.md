# ADR-0068: Code review after every big prompt

- Status: accepted (task tech-build.3, 2026-10-16)
- Date: 2026-10-16
- Relates to: ADR-0063 Decision 1 (automated gates before deploy; the owner verifies live).

## Claude

Anthropic's Claude Code ships review commands for exactly this step: `/code-review` (correctness
bugs in the current diff, at a chosen effort) and `/security-review` (a security pass over the
pending changes on the branch) — Claude Code docs, "Slash commands"
(code.claude.com/docs/en/slash-commands), and the commands' own descriptions in the session. Its
subagent docs (code.claude.com/docs/en/subagents) describe fresh-context subagents, which is what
makes an independent reviewer possible: a reviewer that sees only the diff, not the author's
reasoning.

## ArcNave now

Before this ADR, `CLAUDE.md` "Before you finish a task" stopped at typecheck + tests, `mistakes.md`
and `CURRENT.md`. tech-build.1 and tech-build.2 were reviewed only after they were pushed, by an
independent reviewer the owner ran; that review found real defects (the build-3 Part D findings
M1–M3, N1, N3–N5), which shows a green suite is not enough.

## Gap

Review happened after push, not before; findings came back as a follow-up task.

## Decision

A standing step in `CLAUDE.md` "Before you finish a task" (step 5):

After the work is green and committed locally, run the code-review slash command and an
independent reviewer in parallel, fix confirmed findings, and put the review report in
`docs/ops/` and in the final report to the owner.

Details (ours):

- Independent reviewers are fresh subagents given only the diff of their area, the `CLAUDE.md`
  invariants and the exit tests — not the author's wip notes or reasoning.
- Every finding is re-opened at its file:line by the main session before acting. Confirmed
  BLOCKER / MAJOR findings are fixed before push; MINOR findings not fixed go to
  `docs/ops/audit/DEFERRED.md` with the reason; rejected findings get their evidence in the report.
- One second round on the fix diff only. Then push.
- The report is `docs/ops/build-N-review.md`: the exact command names that ran, the raw finding
  list per reviewer and round, and per finding fixed / rejected / deferred with the covering test.

## Consequences

- A big task costs one more round of agent time before push; defects are found before the owner
  merges rather than after.
- If a session has no review command, the report says "no review command in this session" and the
  independent reviewers carry the step alone.
