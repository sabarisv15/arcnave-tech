# ADR-0039: Public share links for chats and artifacts

- Status: accepted. Tested locally; not live.
- Date: 2026-09-27

## Context

Claude's app shares a chat by public link (Claude Help Center, "Public links for shared chats"
and "Share and unshare chats", read 2026-09-27):
- the link shows a snapshot as of sharing; later messages stay private until the snapshot is
  updated;
- anyone with the link can view it without an account; it is view only;
- files attached to the chat are not included;
- the page carries `noindex`, and the link is a long random string that cannot be guessed;
- sharing can be turned off from the Share menu or Settings > Privacy, which lists shared chats.

Artifacts are published by link too ("Share artifacts"). ArcNave's Share button only copied or
downloaded the conversation, and nothing could be read without signing in.

## Decision

1. **`share_links` table** (migration 0019): `user_id`, `token`, `target_type`
   (`chat` | `artifact`), `target_id`, `snapshot_seq`, `snapshot_at`, `created_at`,
   `revoked_at`. The token is 32 random bytes in base64url, unique, and never derived from an
   id. `target_id` is not a foreign key: the public read checks the target still exists, so
   deleting a chat or an artifact stops its link at once.
2. **Snapshot.** For a chat, `snapshot_seq` is the seq of its last finished reply; for an
   artifact, the latest Markdown version. Sharing again keeps the same token and moves the
   snapshot to now ("Update to now"), so a link already sent keeps working. Turning a link off
   sets `revoked_at`; sharing after that makes a new token.
3. **Routes.** Owner, signed in: `POST /chats/{id}/share`, `POST /artifacts/{id}/share`,
   `GET /share-links` (live links only, filterable by target), `DELETE /share-links/{id}`.
   Public: `GET /public/share/{token}`, no session, 60 requests a minute per IP
   (`RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE`), `X-Robots-Tag: noindex, nofollow`,
   `Cache-Control: no-store`. An unknown or revoked token is 404 `share_not_found`; a chat with
   no finished reply is 422 `share_empty`.
4. **What a stranger can read** is built from an allow-list, not by filtering a full record:
   the chat's title; each prompt's text; each finished reply's text, its web citations (title,
   URL, domain), the visuals and blocks it rendered (`render_ui`), and the artifact it made, as
   of the snapshot. Never read into the payload: attachments or their names, tool inputs and
   results other than the rendered blocks, thinking, memory, usage, model, and anything about
   the owner. A test asserts the full set of keys.
5. **Frontend.** `/s/{token}` renders before the session gate, read only: a banner saying it is
   a snapshot and that files are not included, and a robots `noindex` meta tag.
   `public/_headers` adds `X-Robots-Tag` to the page itself on Cloudflare. Visuals render
   through a read-only workspace that offers no save or follow-up. The Share dialog creates,
   copies, updates and stops the link; the artifact panel has the same control; Settings >
   Data & privacy lists every live link with "Stop sharing".

## Consequences

- An artifact published by link shows its Markdown version; a binary export version is not
  shared.
- Incognito chats (WP-08) do not exist yet. When they do, their share route must refuse them.
- Turning a link off cannot remove copies someone already made; the Settings text says so.
