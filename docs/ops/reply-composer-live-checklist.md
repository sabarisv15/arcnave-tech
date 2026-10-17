# Live checklist: one-row reply composer (ADR-0077)

After the owner merges. Nothing to upload. Check at a desktop width and on a phone.

| # | Do | Expected | Failure looks like |
| --- | --- | --- | --- |
| 1 | Open any existing chat, type nothing. | The reply box is one line high: "Reply…" and the send arrow on the right. Under the box: +, Chat ▾, Normal ▾, mic on the left; "arcnave can make mistakes." in the middle (desktop only); model + effort on the right. | Box is two rows with an empty line, or the tools are still inside the box. |
| 2 | Compare with before: scroll a long answer. | ~50 px more of the answer is visible above the composer than before. | Same height as before. |
| 3 | Type 4 lines with Shift+Enter. | The box grows line by line; send stays at the bottom right of the box. Enter sends. | Box does not grow, or send floats at the top. |
| 4 | Click +, Chat ▾, Normal ▾, mic, model chip in the row under the box. | Each menu opens upward and works (upload, mode switch, style switch, dictation, model). | A menu opens off-screen or does nothing. |
| 5 | Attach a file in a chat. | The chip shows inside the box above the text. | Chip missing or the box layout breaks. |
| 6 | After an answer, leave the box empty. | The grey follow-up suggestion sits on the same line as "Reply…" would; Tab fills it. | The suggestion is shifted above or below the text line. |
| 7 | Open New chat (/app). | The big composer is unchanged: tools inside the box. | New chat composer lost its toolbar. |
| 8 | Phone (≤760 px): open a chat. | Under the box: +, mode icon, style icon, mic on the left, model on the right, one row; no reminder text. | Row wraps to two lines or overflows sideways. |
