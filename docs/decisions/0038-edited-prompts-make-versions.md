# ADR-0038: Editing a prompt makes another version of the same chat

- Status: accepted. Tested locally with a scripted provider; not live.
- Date: 2026-09-27
- Superseded in part by: [ADR-0079](0079-ledger-price-book-and-versions.md) (§5, and the consequence that a regenerate replaces the answer in place).
- Supersedes: the "editing a prompt branches into a new chat" convention in
  `arcnave-frontend/src/workspace.tsx` (it had no ADR of its own).

## Context

In Claude's app, editing an earlier prompt keeps the conversation as one chat. The edit starts
another version from that point, and `< 1/2 >` arrows under the prompt switch between the
versions, each with its own answers (Claude Help Center: "Prototype AI-powered apps with
artifacts", read 2026-09-27: "click Edit to create a new conversation branch … You can always
return to your original version"). Deleting the chat deletes the conversation.

ArcNave made an edit into a separate chat: `POST /chats/{id}/branch` copied the history before
the edited prompt into a new chat titled "… · branch", which appeared as a second sidebar row.
Nothing recorded where it came from, and the copy kept only each message's text: tool calls,
files, sources and visuals of the earlier turns were lost, so the model could no longer see
them in the new version.

## Decision

1. **Storage stays copy-on-branch.** It is already tested, and every generation path works on
   one chat's messages; a message tree would touch all of them. A version is a chat.
2. **Three columns on `chats`** (migration 0018):
   - `parent_chat_id`: the chat the version was made from. Foreign key, on delete set null.
   - `root_chat_id`: the family, the chat that started the conversation. Null on that chat.
     Not a foreign key, so purging one member never splits the family.
   - `fork_seq`: the seq of the edited prompt. From there on the chat's messages are its own;
     before it they are copies of its parent's.
3. **`POST /chats/{id}/branch` takes `editSeq`.** It copies the messages before that seq,
   keeping their seq numbers, and records the three columns. The new version keeps the chat's
   title, pin and project. Without `editSeq` the route behaves as before ("Branch from here"
   makes a separate chat). Either way the copy now carries each message's sources, progress
   events, tool calls, attachments, thinking, segments and artifact link, so a version shows
   and replays the same history. Usage rows are not copied: a copied turn cost nothing again.
4. **Which versions a prompt has** (`services/chatVersions.ts`). The message at a seq in a chat
   was written by one chat, its *owner*, found by walking up the parents until
   `fork_seq <= seq`. Two chats show the same prompt at a seq when they have the same owner
   there, and are versions of each other at that seq when they had the same owner at the seq
   before. `GET /chats/{id}` returns, on each user message with more than one version,
   `versions: { index, versions: [{ chatId, createdAt }] }`, oldest first; `chatId` is the chat
   to open for that version (the one used last among chats showing it).
5. **One conversation, one row.** `GET /chats` lists, per family, the member updated last. A
   switch between versions does not write, so the row keeps the version last used for a reply.
6. **Shared properties.** Renaming, pinning or moving any version applies to the whole family.
   Deleting deletes every version, as Claude's delete removes the conversation.
7. **Stored bytes.** A copied attachment row names the same storage key. Retention deletes the
   bytes of a purged chat only when no attachment row in another chat names them.
8. **UI.** An edited prompt shows `‹ i / n ›` next to its copy and edit buttons, visible without
   hovering. Switching reads the chosen version, puts it in the conversation's sidebar row,
   replaces the URL, and keeps the prompt at the same place on screen.

## Consequences

- A sandbox workspace belongs to one chat (ADR-0015): files a tool wrote in one version are
  not in another version's workspace. The uploads and tool results the model sees are.
- The "branch from here" menu action still makes a separate chat; it is ArcNave's own and has
  no Claude equivalent to follow.
- Chats made by the old edit flow stay separate chats; they are not backfilled into families.
- Regenerating an answer (retry) still replaces it in place; Claude also keeps retried answers
  as versions. That is a separate change.
