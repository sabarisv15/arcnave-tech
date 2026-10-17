# P21 live checklist (module boundaries, numbers, lint) — ADR-0082

For the owner, after the merge deploys. P21 is behaviour-neutral: every check below should look
exactly as it did before, except the three items marked **changed**.

| # | Do | Expected | A failure looks like |
|---|---|---|---|
| 1 | Sign in, open a chat, send "hello". | The answer streams as before; the composer unlocks at the end. | The reply never starts, or the browser console shows a CORS error on `/chats/:id/generate`. |
| 2 | **changed** — DevTools → Network → the `generate` request → Response headers. | `content-type: text/event-stream`, `access-control-allow-origin` = the site, `access-control-allow-credentials: true`, `access-control-expose-headers: X-Request-ID`, `x-content-type-options: nosniff`, `x-frame-options: DENY`. | Any of these missing (SSE head no longer built from the plugins). |
| 3 | While an answer streams, reload the tab. | The answer reattaches and finishes (`GET /chats/:id/stream`), same headers as #2. | 404 / empty answer / CORS error on `stream`. |
| 4 | Turn memory on in Settings, ask "remember that I audit KVB", then in a new chat ask "what do you remember about me?". | The memory tool saves it; the new chat knows it. Settings → Memory lists it. | "Memory unavailable", a tool error, or the item missing in Settings (memory store not wired). |
| 5 | Settings → Memory → Import, paste a short list (3 lines). | "Added 3". | **changed**: a 500 here now means a database failure (it used to answer "skipped"). Report the request id. |
| 6 | In a chat with an earlier conversation about a topic, ask "what did we discuss about <topic> before?". | `conversation_search` finds the earlier chat and cites it. | Tool error, or no results where there were before (chat search not wired). |
| 7 | Upload a 5–25 MB PDF to a project, and one to a chat message. | Both upload and read as before. | 413 `payload_too_large` on an upload (route limit missing). |
| 8 | Open an artifact, paste a long document (a few hundred thousand characters, e.g. a big CSV as text), save. | Saves as a new version. | 413 on save. |
| 9 | **changed** (operator) — Cloud SQL: `select count(*) from sessions where last_seen_at > now() - interval '1 minute'` while browsing for a few minutes. | Each active session's `last_seen_at` moves at most every 15 minutes (it used to move on every request). | It moves on every request (A-25 not deployed), or never moves (write failing: look for `session last_seen write failed` in the logs). |
| 10 | Cloud Run logs for the new revision, first 10 minutes. | No `skill could not be loaded` lines; the skills list in Settings is complete. | `skill could not be loaded, skipping` with a `dir` (a skill that was silently dropped before is now named). |
| 11 | CI on the PR. | Backend and frontend jobs each show a green **Lint** step. | Lint red: read which rule; it is an error only for the rules ADR-0082 §10 lists. |

Nothing to upload beyond the files named above; no new environment variable is required (the three
new settings — `API_BODY_LIMIT_BYTES`, `RUN_BUFFER_MAX_BYTES`, `SESSION_LAST_SEEN_WRITE_MS` — have
defaults).
