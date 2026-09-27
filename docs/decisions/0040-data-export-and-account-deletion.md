# ADR-0040: Memory import and export, data export, account deletion

- Status: accepted. Tested locally; not live.
- Date: 2026-09-27

## Context

Claude's app (Claude Help Center, read 2026-09-27):
- **Memory:** Settings > Memory > "Start import": the user asks the other assistant to list
  what it remembers, pastes the answer, and clicks "Add to memory"; entries arrive as
  "[date] - memory" lines. Memory can be viewed and copied out ("Import and export your memory").
- **Data export:** Settings > Privacy > "Export data" gives a download link that expires 24
  hours after delivery and needs the user to be signed in ("Export your Claude data").
- **Deletion:** Settings > Account > "Delete account", then confirm; it is permanent
  ("Delete your Claude account").

ArcNave could list, edit and delete memory and export usage as CSV, but had no memory transfer,
no full export and no way to delete an account.

## Decision

1. **Memory.**
   - `GET /memory/export` returns `{ version: 1, exportedAt, items }`.
   - `POST /memory/import` takes that JSON, or `text` with one memory per line. List markers
     and a leading `[date] -` are stripped; nothing is inferred by a model.
   - A memory already held (same topic, or same wording ignoring case and spacing) is skipped,
     never replaced. A line the privacy check refuses (a credential) is counted as skipped.
   - A project memory is placed only in a project the user owns. At most 500 per import.
   - Settings > Personalization has Import (with the request to paste into the other
     assistant, and a file option) and Export.
2. **Data export.**
   - `POST /account/export` builds a zip in the request and stores it under the owner's
     storage keys. A row in `account_exports` (migration 0020) records it, with `expires_at`
     24 hours on.
   - `GET /account/exports/{id}/download` serves it to the signed-in owner until then, then
     410 `export_expired`. Retention deletes expired zips.
   - The zip holds: README, account (email, name, created), preferences, memory (the import
     format), styles, projects with their file names, and every conversation with messages,
     citations and tool steps. Attached files are listed by name only, as in Claude's export.
     It also holds every artifact version: text as `.md`, `.html` or `.svg`, and binary
     exports as the file itself.
   - The export is limited to 3 a minute.
3. **Deletion.** `DELETE /account` needs the current password (403 `password_incorrect`).
   - It stops the account's running replies.
   - It deletes every stored object under the owner's keys. `ObjectStorage.deleteOwned` walks
     the owner's shard and keeps only keys whose owner component is this user, so it also
     finds objects no row names: checkpoint files, table extractions and exports.
   - Then it deletes the user row. Every table with a `user_id` cascades from `users`
     (sessions, preferences, projects and their files and chunks, saved sources, chats and all
     message data, attachments, sandbox workspaces, artifacts and versions, usage records and
     counters, idempotency keys, sandbox claims, goals, memory, compactions, styles, share
     links, exports). The session goes with it, and the cookie is cleared.
   - A test finds the tables from `information_schema` rather than a list, and asserts no row
     and no stored file of the user remains.
   - Settings > Account > "Delete account" needs the phrase typed and the password.

## Consequences

- Gemini page images in the model-input bucket (ADR-0016) are content-addressed and shared,
  not owned; the bucket's 7-day lifecycle deletes them.
- A sandbox instance's in-memory workspace for a deleted chat is not reached. It is dropped
  when the instance recycles, and its checkpoint is already gone.
- A large account's export is built in memory in one request. If that becomes too slow, the
  build moves to a background job with the same routes.
