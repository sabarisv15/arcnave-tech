# ArcNave

ArcNave is the frontend for a general-purpose AI workspace: conversation, source-backed search
and research, persistent projects, and an artifact editor in one interface. It talks to the
ArcNave backend in [`../backend`](../backend) — there is no mock data and no local-only mode.

## Run locally

The backend has to be running first; see its README for Postgres and environment setup.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` and create an account. The dev server proxies `/v1` to
`http://127.0.0.1:8080`; override the target with `VITE_API_PROXY` (see `.env.example`).

`npm run build` produces a production bundle and `npm test` runs the suite — SSE framing,
error mapping, evidence integrity, and upload policy. No test reaches a server.

## Product surfaces

- Sign-in and sign-up against server-held sessions (HttpOnly cookie; no token is stored in JS)
- Chat, Search, and Research conversation modes
- Streamed responses over server-sent events, with stop, retry, regenerate, edit, copy, and
  feedback, all persisted
- Inline citations, source filtering, source details, and the provider's own research steps
- Projects with uploaded files that are extracted, indexed, and ranked against your questions
- Artifacts with append-only version history, restore, and download
- Usage & limits: token totals by period and model, budgets, warnings, and CSV export
- Appearance, personalization, model, account, privacy, and keyboard settings
- Responsive desktop, tablet, and mobile layouts with light and dark themes

## Architecture

| File                | Responsibility                                                            |
| ------------------- | ------------------------------------------------------------------------- |
| `src/api.ts`        | The HTTP boundary: every endpoint, the DTO types, and typed `ApiError`    |
| `src/adapter.ts`    | The generation boundary: `POST /chats/:id/generate` read as an SSE stream |
| `src/session.tsx`   | Who is signed in; model availability                                      |
| `src/workspace.tsx` | Workspace state and every action, backed by the API                       |
| `src/types.ts`      | The shapes the interface renders, and the mapping from the API's shapes   |
| `src/storage.ts`    | Local interface state only — theme, sidebar, unsaved artifact drafts      |

Three rules run through all of it. Errors are typed: the server returns a machine-readable
`code` with its own title and detail, and the UI switches on the code rather than on prose.
Nothing is invented: a cost the server reports as `null` is shown as unpriced, not as zero, and
token counts flagged `exact: false` are labelled rather than displayed as measurements. Model
availability comes from `GET /models`, so an alias that is not configured is shown disabled with
the server's reason attached instead of quietly disappearing.

Design reconnaissance is recorded in [docs/reconnaissance.md](docs/reconnaissance.md), and the
validation matrix is in [docs/verification.md](docs/verification.md).
