# P08 live checklist — durable runs, one turn per chat (ADR-0078)

For the owner, after the merge has deployed. Each step: what to do, what you should see, and what
a failure looks like. Use a real browser on the deployed site, signed in. Steps 6–8 need the Cloud
Run console (or `gcloud`); the rest need only the app.

Before you start: the deploy ran migration `0030_durable_turns` (Cloud Run log line
`"msg":"migrations applied"`). A `migration failed` line means stop here and report it.

| # | Do | Expect | Failure looks like |
|---|----|--------|--------------------|
| 1 | New chat, ask "Write a 600-word essay about rivers". | The answer streams as before; the footer shows tokens and cost. | Nothing streams; an error card right away; the answer appears only after a reload. |
| 2 | While step 1's answer is still streaming, click **Stop**. | It stops within about 2 s; the row says stopped and keeps the text so far. | It keeps writing; the row spins after a reload. |
| 3 | Start a long answer in chat A, open chat B (sidebar) and send a question there too. | Both answer at the same time. Stop in chat B stops only B; A keeps going. | B refuses ("A response is already running"); Stop in B also stops A. |
| 4 | Start a long answer, then switch the phone to airplane mode for ~10 s, then back. | A "Reconnecting…" banner shows; when the network is back the answer continues without repeated or missing text. | "Connection interrupted" with no recovery; text repeated; the banner never goes away. |
| 5 | Start a long answer, reload the page mid-answer. | The reply is shown with the text so far and keeps filling in until it finishes. | An empty spinner until the answer ends; a reply that stops filling in. |
| 6 | Start a long answer, then deploy a new revision (or `gcloud run services update … --update-env-vars P08_PROBE=1`) while it streams. | Within ~10 s the reply ends with "The server is restarting" (code `server_shutdown`) and keeps its text; Retry works. Log: `"msg":"drained"` with `settled: true`. | The reply spins forever; after a reload it says "generating"; no `drained` line. |
| 7 | Settings → Usage & limits: set a daily budget below what you already used today, then send. | The send is refused at once with "Token budget reached"; no new user message appears in the chat. | The message is saved and then an error card appears under it. |
| 8 | Optional, two instances: with min instances ≥ 2, start a long answer and reconnect (step 5) until the request lands on the other instance (check `X-Request-ID` in logs). | The reply still fills in (from snapshots about every second) and ends. | 404 "No response is running here"; the reply stays empty until the end. |
| 9 | Send a message, and while it streams send another in the **same** chat from a second tab. | The second tab says "A response is already running". | Two answers interleave; two assistant rows appear. |

Report: for each step, pass / fail and, for a fail, the time and the chat id (from the URL).
