---
description: Implement one Claude UI parity work package (WP) from docs/handover/2026-09-26-claude-ui-parity-plan.md
---

Run this with the work package ID, for example `/ui-parity WP-01`.

1. Read `AGENTS.md`, `mistakes.md` and `docs/checkpoints/CURRENT.md`.
2. Open `docs/handover/2026-09-26-claude-ui-parity-plan.md`. Read "How every work package is
   done", then only the section for the given WP. Do not start any other WP.
3. Check the WP's "Depends on" line. If a dependency is not ticked as done in the plan, stop and
   tell the user.
4. Create the branch named in the WP from the latest `main`.
5. Read every file listed under "Files". Confirm that the "Current state" statements are still
   true. If one is not, say so in your plan.
6. Write the implementation plan and task list. If the WP says "ADR required", write the ADR
   first and wait for the user's review before any code.
7. Implement the steps in order. Write the tests the WP lists.
8. Run:
   - `cd backend && npx tsc --noEmit && npx vitest run`
   - `cd arcnave-frontend && npm run build && npm test`
   Fix every failure, then run them again.
9. Start the stack locally and do every browser acceptance check in the WP. Take a screenshot
   of each one for the walkthrough.
10. Update `mistakes.md`, `docs/checkpoints/CURRENT.md`, and tick the WP's checklist in the plan.
11. Commit with a message that says what changed and why. Push the branch. Do not merge and do
    not deploy.
12. Reply to the user in Tanglish: what was done, test results, screenshots, anything left open.
