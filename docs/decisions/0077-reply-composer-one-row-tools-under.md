# ADR-0077: The reply composer is one row; its tools move to the row under the box

- Status: accepted (2026-10-16). Frontend only. Not merged, not deployed.
- Date: 2026-10-16
- Task: owner request, 2026-10-16: "AI composer and chat la room neraya iruku but arcnave la apdi
  ila, claude mari UI and UX apply panu chat pages ku", with a screenshot of each app.
- Supersedes: nothing. Refines the Fix-Composer `.under` row (`docs/brand-extra/Fix-Composer.dc.html`).
- Models used: Opus 5.5.

## Claude

- Claude desktop changelog (claude.com/docs/cowork/changelog, read 2026-10-16), v2.16120.0,
  2026-09-29: "Updated the Code tab's composer to the redesigned card, with the + menu first in the
  row under the box, ahead of permission mode and model." The v1.46388.1 entry (2026-09-04) names
  "the row under the composer (Add folder, permission mode, model)".
- Claude Help Center, "How can I change the model version that I'm chatting with?": the model
  name sits by the input and opens the picker.
- The owner's screenshot of the Claude app (2026-10-16): in a conversation the box holds only
  "Reply" and the send key; +, the microphone, the model and effort, and "Claude is AI and can
  make mistakes." are one row under the box.

## ArcNave before this change

- In a conversation the reply box was two rows: the text, then a toolbar (+, Chat, Normal,
  microphone, send) inside the box. Idle it was 101 px tall at 1440×900, and the whole composer
  area 157 px; 105 px / 151 px on a 390×844 phone.
- The textarea had the browser default `rows=2`, so even empty its `scrollHeight` was two lines.

## Gap and decision

1. **In a live conversation** (`inlineReply`) the box holds attachments, the text and send, one
   row (`.composer-reply-row`); `rows={1}` on the textarea. Idle box: 50 px; composer area 106 px
   desktop, 102 px phone. The thread gains ~51 px.
2. **The row under the box** (`.composer-under-reply`) carries, left to right: + (first, as in
   Claude), Chat/Search/Research, the style, the microphone; the reminder in the middle; the model
   and effort on the right. On a phone the reminder is hidden so the tools and model fit one row.
3. **New chat, project and artifact composers are unchanged**: tools stay inside the box (their
   room for long prompts is deliberate, `Composer.tsx` `inlineReply`).

## Where ArcNave differs, and why

- The mode (Chat/Search/Research) and style menus have no Claude counterpart in that row; they are
  ArcNave's own controls and stay, in the same row, after +.
- Send stays a button inside the box (Claude's screenshot shows a return-key glyph); same place.

## Verify

- `ChatView.test.tsx` "the row under the composer": the reply box has `rows="1"`, send in the reply
  row, no `.composer-toolbar`; +, mode and style are under the box; a new chat keeps them inside.
- Live: `docs/ops/reply-composer-live-checklist.md`.
