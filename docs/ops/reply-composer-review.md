# Review: one-row reply composer (ADR-0077)

Reviewed commit `2da165b` with `/code-review` (medium) and an independent read-only reviewer, in
parallel (ADR-0068). Fixes are in the follow-up commit.

| # | Finding | Source | Verdict | Action |
| --- | --- | --- | --- | --- |
| 1 | Follow-up ghost text 19 px from the top (9 px inset + old 10 px padding) vs the caret at 9 px | both | CONFIRMED | Fixed: inset 0, `padding-top: 9px`, line-height 22 px. Measured: suggestion top 804 = textarea 795 + 9. |
| 2 | Under-row crowding at 761–1000 px: the reminder could wrap word-by-word | /code-review | PLAUSIBLE | Fixed: reminder one line with ellipsis; hidden (kept as spacer) ≤1000 px. Measured 900 px and 320 px: row 34/40 px, no horizontal overflow. |
| 3 | Files dropped on the moved tools did nothing / the browser could open them | reviewer | CONFIRMED | Fixed: the reply's under-row accepts drops and attaches. |
| 4 | JS reply floor 34 px under the CSS 40 px min-height | /code-review | CONFIRMED (dead value) | Fixed: 40. |
| 5 | `rows={1}` comment said reply only; it applies to every composer | /code-review | CONFIRMED (comment) | Comment corrected; reviewer verified no visible change for the other composers (their min-height and JS floor decide). |
| 6 | Tab order reaches Send before +/mode/style in a reply | /code-review | Kept | Claude's reply card has the same order (send in the box, tools in the row under it). |
| 7 | Compact tool sizes duplicated; old `.composer-inline .composer-toolbar` rules now dead | /code-review | Optional | Not changed in this task. |
| 8 | Four `inlineReply` checks instead of one branch per region | /code-review | Optional | Not changed; covered by the two layout tests. |
| 9 | mistakes.md lesson logged as a changelog line, not an entry | /code-review | Kept | mistakes.md's own rule: a rule a test enforces belongs in the test (`rows="1"` asserted); file is at the 40 cap. |

Open MAJOR: 0.
