# ArcNave

ArcNave is a polished, responsive frontend for a general-purpose AI workspace. It combines calm conversation, source-backed search and research, persistent projects, and an artifact editor in one coherent interface.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. Use `npm run build` for a production bundle and `npm test` for the adapter, persistence, cancellation, source-integrity, and file-storage tests.

## Product surfaces

- Chat, Search, and Research conversation modes
- Streaming responses with stop, retry, regenerate, edit, copy, and feedback states
- Inline citations, source filtering, source details, and research progress
- Persistent chats and projects with local search, rename, pin, branch, export, and delete flows
- Resizable artifact workspace with drafts, version history, editing, and download
- Local file attachments stored in IndexedDB with validation and text previews
- Appearance, model, research, privacy, personalization, and keyboard settings
- Responsive desktop, tablet, and mobile layouts with light and dark themes

## Architecture

`src/workspace.tsx` owns the workspace state and actions. `src/adapter.ts` is the provider boundary: replace its async generator with a server-backed streaming client while keeping the existing `AdapterEvent` contract. Search results should arrive as structured `Source` records so citations remain linked to evidence rather than embedded as arbitrary prose.

This repository intentionally ships with a prepared demo adapter. It does not call an AI model, perform live web search, create an account, or upload files to a server. Conversations, settings, artifacts, and attachments remain in the current browser. The interface labels that behavior directly.

Design reconnaissance is recorded in [docs/reconnaissance.md](docs/reconnaissance.md), and the completed validation matrix is in [docs/verification.md](docs/verification.md).
