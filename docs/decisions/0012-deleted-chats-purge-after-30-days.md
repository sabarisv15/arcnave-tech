# ADR-0012: Deleted chats leave the back end within 30 days

- Status: accepted. A purged chat also takes its sandbox checkpoint:
  [ADR-0015](0015-sandbox-workspaces-outlive-the-instance.md).
- Date: 2026-09-25

## Context

`DELETE /chats/:id` only set `deletedAt`. The chat, its messages, its attachment rows and the
uploaded files stayed in Postgres and in the bucket for good. Unsent uploads were removed only
when a user pressed "Discard unsent uploads" in Settings. That button always reported zero:
the API returns `deleted`, and the page read `removed`.

What the references do:

- **Claude** (Anthropic Privacy Center): deleted conversations are "immediately deleted from
  your conversation history and automatically deleted from the back-end within 30 days".
- **ChatGPT** (OpenAI Help Center): a deleted chat's data is scheduled for permanent deletion
  within 30 days. Files saved to the Library are kept separately until they are deleted there.

Both keep the original file, not only extracted text, for as long as the chat exists. So does
ArcNave. Code and page images need the original.

## Decision

1. A deleted chat is hidden at once (unchanged), and `sweepRetention` removes it after
   `CHAT_PURGE_AFTER_DAYS` (30). The chat row goes, and with it, by cascade, its messages,
   attachment rows, tool calls and the rest. The stored bytes of files uploaded into the chat
   are deleted first. If an object delete fails, the chat is kept and the next sweep retries it.
2. What the purge leaves alone:
   - An attachment picked from a project shares the project file's stored object, so those
     bytes stay.
   - Artifacts are the user's library and outlive the chat (`chat_id` is set null), like
     ChatGPT's Library.
3. An upload never sent with a message is removed after `UNSENT_UPLOAD_TTL_HOURS` (24). Claude
   publishes no figure for this. 24 hours is ArcNave's own choice, and it matches the
   manual cleanup's default.
4. The sweep runs hourly on every backend instance. `pg_try_advisory_xact_lock` lets one
   instance at a time do the work; the others skip that round. A sweep purges at most 50 chats.
5. The same sharing rule now applies to manual cleanup. Before, cleaning up an unsent pick from
   a project deleted the project file's bytes.

## Consequences

- Restoring a deleted chat is possible for 30 days, by clearing `deletedAt`. After that it is
  gone, as in Claude.
- The warm sandbox's copy of a chat's files is not touched here. It expires on its own after
  `WORKSPACE_TTL_S` (2 hours live).
- A deleted user's rows cascade as before. Their bucket objects are not swept by this ADR.
