# Stage 14 — Streaming / rendering: conformance audit

Sources read: `Stage-14-Streaming-Rendering/00-checkpoint-stage14.md` (doc-syncs 2026-10-03 Stage 17, Stage 20, domain; 2026-10-06 domain; 2026-10-07 SSE through the ALB; 2026-10-10 SSE relay live), `14-streaming-rendering.md` (RN1–RN25, CRN1–CRN5, RD-1…RD-14, LV-1 list); `00-numbers-register.md` (N-24, N-41, N-73); repo `CLAUDE.md`, ADR-0009, ADR-0061, `docs/ops` none; code `backend/src/routes/chats.ts:529-835`, `services/runHub.ts`, `services/generation.ts:110-160, 900-1040`, `routes/share.ts`, `routes/sheetPreview.ts`, `services/documents/sheetPreview.ts`; frontend `adapter.ts`, `workspace.tsx:430-730`, `Content.tsx`, `markdownPlugins.ts`, `CodeBlock.tsx`, `ChatStates.tsx`, `ToolActivity.tsx`, `Panels.tsx`, `FilePreviews.tsx`, `officePreview.ts`, `SandboxFrame.tsx`, `SharedPage.tsx`, `Composer.tsx`, `brand/fonts.ts`, `scripts/prerender.mjs`, `package.json`. Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

Port source: `arcnave.in:backend/apps/api/src/arcnave_api/chat/relay.py` (SSE relay: events ack/status/delta/snapshot/done/error/ping, resume by `Last-Event-ID`/`?after=`, session re-check, disconnect rules), `arcnave.in:backend/packages/chat/src/arcnave_chat/stream.py` (`PostgresStreamStore`), `arcnave.in:backend/apps/lvsse/src/arcnave_lvsse/main.py` (SSE load/LV tool). No rendering code exists in the archived build (no web or Android client).

Stack note: the locked client is Next.js 16 (web) + Expo (Android); this repo is React 19 + Vite with a prerender script and has **no Android tree** (searched root and `*/package.json`: only `arcnave-frontend`, `backend`; no `app.json`, `android/`, `expo/`). Android-only parts are bucketed once (D-31, Phase 6 of the build plan).

## 1. Locked decisions
Latest doc-sync wins: the SSE event set and resume rules of 2026-10-10 (Task 1.9, ADR-0011) replace the older F3 description; "SSE not buffered through the ALB" and "20-minute stream with 15 s pings holds" (2026-10-07); hostnames `app.arcnave.in`, `api.arcnave.in`, `share.arcnave.in`, `ops.arcnave.in` (2026-10-03/06); the user-content origin stays `usercontent.arcnave.tech` (2026-10-06). Draft ids RN1–RN25 are carried inside the RD rows below.

| Id | Decision (one line) | Status |
|---|---|---|
| D-01 RD-1 / RN1 | One shared parser (markdown-it, GFM) in the shared TS client → web React components; Android native via RonRadtke fork; snapshot parity tests | LOCKED |
| D-02 RD-1 / RN1 / S13-OV15 | remend-style termination of unfinished Markdown while streaming | LOCKED |
| D-03 RN2 | Render on animation frame / `startTransition`, coalesce deltas ~50–100 ms (N-41; runner flush 100 ms, N-73), never reorder blocks, `maintainVisibleContentPosition` | LOCKED |
| D-04 RD-2 / RN5 | Web math: KaTeX (`htmlAndMathml`, `throwOnError:false`, strict warn, copy-tex); Android block math in a local WebView | LOCKED (web part here) |
| D-05 RD-3 / RN6 | Charts: web ECharts JSON (TD-8, `notMerge`, templates not functions); Android @wuba/react-native-echarts provisional (LW-20) | LOCKED |
| D-06 RD-4 / RN7 | `[file:n]` → registry → web pdf.js/react-pdf page jump + text-layer highlight (fallback page only); Android react-native-pdf + passage sheet | LOCKED |
| D-07 RN7 | `[web:n]` → hover/long-press preview card (title, domain, snippet) + open; always rendered (CRN2) | LOCKED |
| D-08 RD-5 / RN8 | Spreadsheet preview = server-rendered first rows per sheet (Stage 9 sidecar), no client XLSX engine | LOCKED |
| D-09 RN8 | File preview: PDF viewer, images with zoom, DOCX/PPTX via LibreOffice→PDF, audio = player + transcript with timestamps | LOCKED |
| D-10 RD-6 / RN10 / RN11 | HTML preview: iframe `sandbox="allow-scripts"` only, served from `usercontent.arcnave.tech` with strict CSP headers + COOP; Android hardened WebView + Report button | LOCKED |
| D-11 RD-7 / RN14 | Google Search Suggestions `renderedContent` shown exactly as provided under Gemini-grounded answers; hidden on share | LOCKED |
| D-12 RD-8 / RN15 | Notifications: in-app MVP (ARIA status), push Later | LOCKED |
| D-13 RD-9 / RN17 | Long lists: web react-virtuoso / TanStack Virtual; cursor paging; streaming message pinned at bottom | LOCKED |
| D-14 RD-10 / RN18 | Bundle Noto Sans Tamil + Devanagari (variable, unicode-range) in web; `word-break: normal`; `Intl` en-IN | LOCKED |
| D-15 RD-11 / RN21 / RN22 | Company admin panel screens + ops console screens | LOCKED — DEFERRED |
| D-16 RD-12 / RN23 | Destructive admin actions: typed confirmation, consequence text, export offer, audit entry | LOCKED — DEFERRED (admin) |
| D-17 RD-13 / RN13 | Research early-findings panel + report TOC | LOCKED (MVP-lite) |
| D-18 RD-14 / RN3 | Tables: horizontal scroll, copy as Markdown, CSV download, sticky header; cell-select-to-ask Later | LOCKED |
| D-19 RN4 | Code blocks: language label, copy, wrap toggle, line numbers for >10 lines | LOCKED |
| D-20 RN12 | Thinking panel: collapsible, elapsed time, summarized only, empty → hide, redacted never shown, hidden on share | LOCKED |
| D-21 RN13 / TD-10 | Live step list from tool status with expandable details | LOCKED |
| D-22 RN16 | WCAG 2.2 AA baseline: transcript `role=log` polite, announce on done not per token, no focus steal, 24×24 targets, 320 px reflow, 4.5:1, `lang` per message | LOCKED |
| D-23 RN19 | Share page: noindex meta + X-Robots-Tag, no robots.txt block, generic OG, print CSS, escaped Markdown, artifacts/files name only, thinking + Google-grounded answers hidden (SL-1), Report link | LOCKED |
| D-24 RN20 | Stage 13 UI hooks: cut-short + Continue, generic verify note, weak-citation marks, "verify numbers" note, recitation notice, retract card | LOCKED |
| D-25 RN9 | Artifact panel: side panel, version prev/next, download formats, "Edit with ArcNave" on selection | LOCKED |
| D-26 SSE contract (2026-10-10) | Events `ack`, `status`, `delta`, `snapshot`, `done`, `error` (ER-11 body), named `ping`; `id:` = seq; resume by `Last-Event-ID` (wins) or `?after=`; snapshot when the buffer lost the gap; stream ends at turn end, N-43 deadline or send timeout, never relies on disconnect detection | LOCKED |
| D-27 | 15 s ping (N-24) mandatory on every SSE stream, in every mode (LV-111) | LOCKED |
| D-28 | Headers `Cache-Control: no-cache`, `X-Accel-Buffering: no`, one flush per write (LV-25) | LOCKED |
| D-29 | Open stream re-checks the session every N-73 60 s (logout-all/removal → `error` 401; chat delete → 404) | LOCKED |
| D-30 | Hostnames / origins (app, api, share, ops, usercontent) | LOCKED (hosting = infra) |
| D-31 RN24 | Android parity list (everything renders on Android except the listed items) | LOCKED (Phase 6) |

## 2. Repo today
| Id | Evidence (file:line) or "not found (searched: …)" |
|---|---|
| D-01 | `react-markdown` 10 + `remark-gfm` + `remark-math` + `rehype-katex` + `rehype-highlight` (`package.json:27-40`, `markdownPlugins.ts:1-57`, `Content.tsx:226-321`). markdown-it: not found (searched `markdown-it` in `package.json`, `src`). No shared TS client package. |
| D-02 | not found (searched `remend`, `streamdown`, `termin` in `arcnave-frontend/src`, `package.json`). The full text is re-parsed on every delta (`workspace.tsx:498-506`, `Content.tsx:245-316`); only a render-error boundary shows raw source (`Content.tsx:34-67`); a test streams an incomplete fence (`MarkdownStreaming.test.tsx:30-60`). |
| D-03 | Every delta is one `patchMessage` state update (`workspace.tsx:498-506`); the server publishes each provider chunk as its own frame (`generation.ts:910-916`, `runHub.ts:44-53`). No coalescing, no `startTransition`/rAF (searched `requestAnimationFrame`, `startTransition`, `coalesc` in `src`: none). |
| D-04 | `rehypeKatex` with `{ throwOnError: false }` (`markdownPlugins.ts:41-44`), KaTeX CSS imported (`:6`); currency guard `preserveCurrency` (`:18-35`). `copy-tex`, `strict` warn: not found. |
| D-05 | Charts are Recharts blocks (`package.json:36`, `generative-ui/blocks/ChartBlock.tsx`); ECharts: not found (searched `echarts` in `package.json`, `src`). |
| D-06 | PDF preview is a plain `<iframe src=blob>` (`Panels.tsx:950-951`); pdf.js/react-pdf not in `package.json`; no `[file:n]` chip, no registry (see Stage 12 L-16). |
| D-07 | `Citation` hover card (domain · type, title, snippet, "Click citation to inspect") for links of the form `#source-N` (`Content.tsx:189-225, 252-264`); unresolved id → "[reference unavailable]". The token is `#source-N`, not `[web:n]`, and no producer of such links was found (searched `source-` / `#source` in `backend/src`: none). Sources are also shown as a list (`generative-ui/blocks/SourcesBlock.tsx`). |
| D-08 | Server renders typed cells, 200 rows × 50 columns (`services/documents/sheetPreview.ts:8-9`, `routes/sheetPreview.ts`), drawn as sheet tabs over a grid (`FilePreviews.tsx:75-99`). |
| D-09 | DOCX via `docx-preview`, PPTX drawn by own renderer, both in a script-less frame (`officePreview.ts:1-24, 334`, `FilePreviews.tsx:1-29`); PDF iframe (`Panels.tsx:950`); plain text ≤200 KB (`Panels.tsx:940-948`). Not found (searched `<audio`, `zoom`, `transcript` in `src` non-test): audio player + timestamps, image zoom viewer. LibreOffice→PDF preview: not used (client renderers instead). |
| D-10 | Web: `sandbox="allow-scripts"` only (`SandboxFrame.tsx:11, 192`, tests `SandboxFrame.test.tsx:51-52`), CSP as a `<meta>` first in `srcdoc` (`:31, 52`), the frame gets an opaque origin; Office previews use `allow-same-origin` without scripts (`FilePreviews.tsx:10-13`). No separate user-content origin (searched `usercontent` in `src`, `backend/src`: only Google client-id test strings), no HTTP CSP/COOP header route, no Report button (searched `Report` in frontend: none). |
| D-11 | The backend forwards `searchEntryPoint` (`generation.ts:127, 926-936`, `gemini.ts:610-613`); the frontend type has it (`adapter.ts:51`, `api.ts:504`) but nothing renders it (searched `searchEntryPoint`, `renderedContent`, `Search Suggestions` in `src` non-test: types only). |
| D-12 | not found as "finished in another chat"; `role="status"` toast `App.tsx:372`, generation status `App.tsx:1103`, offline banner `App.tsx:319`. |
| D-13 | No virtualization library (`package.json`); transcript loaded whole (the only cursor in `routes/chats.ts` is the conversation list, `:212-248`). |
| D-14 | `@fontsource-variable/noto-sans-tamil`, `noto-serif-tamil` (`package.json:18-19`, `brand/fonts.ts:3-6`); Devanagari "is on the sheet but is not self-hosted yet" (`brand/fonts.ts:6`); `word-break: break-word` in places (`styles.css:1284, 1428, 5107`), not `normal`; en-IN partly (see Stage 13 V-21). |
| D-15, D-16 | not found (no company/admin). User-level destructive actions (account deletion, data export) exist under ADR-0040 and are not audited here. |
| D-17 | not found (no research mode). Progress rows render in the step list (`workspace.tsx:519-528`). |
| D-18 | `.table-scroll` wrapper with `role="region"` and keyboard focus (`Content.tsx:300-309`). Copy as Markdown / CSV download: not found (searched `csv`, `Copy as Markdown` in `Content.tsx`, `TableBlock.tsx`); sticky header: not verified. |
| D-19 | `CodeBlock` with copy button and language badge (`CodeBlock.tsx`, wired `markdownPlugins.ts:54-56`); no wrap toggle, no line numbers (searched `wrap`, `line.?number` in `CodeBlock.tsx`: only `code-block-wrapper`). |
| D-20 | `ThinkingBlock` with live timer and headline, expandable (`ToolActivity.tsx:278-300`, used `App.tsx:1021-1027, 1051` only when text exists); summarized display requested (`anthropic.ts:488`); Gemini thought summaries (`gemini.ts:438-443, 480`); share route never reads thinking (`routes/share.ts:7`). |
| D-21 | Verb table per tool (`ToolActivity.tsx:55-82`), `tool_use`/`tool_result` frames (`workspace.tsx:529-566`), research frames (`:519-528`). |
| D-22 | `role="status" aria-live="polite"` on run status (`App.tsx:799, 1103`); no transcript `role="log"` (searched `role="log"` in `src`: none); `lang="ta"` only for Tamil answers (`answerLang.ts`, `Content.tsx:245`); 24×24 targets / 320 px reflow: not verified. |
| D-23 | `noindex, nofollow` meta set by JS (`SharedPage.tsx:57`); `X-Robots-Tag` is on the **API JSON response**, not on the page HTML (`routes/share.ts:103`); `robots.txt` **disallows `/s/`** (`scripts/prerender.mjs:36`) which hides the noindex from crawlers (spec RN19/F22: no robots.txt block); OG tags exist only for the four marketing pages (`prerender.mjs:14-28`); print CSS: not found (searched `@media print` in `src/*.css`); Report link: not found; thinking/memory/usage never read (`share.ts:7`) but **sources of Gemini-grounded answers are returned** (`share.ts:383-393`, see Stage 10 RG2). Page is a Vite SPA, not Next.js SSR (DIFF-STACK). |
| D-24 | "Cut short" + Continue (`ChatStates.tsx:159-191`), stopped note (`:130-156`), dropped-connection note (`:194-214`), error card. Not found (searched `weak`, `verify`, `withdrawn`, `recitation`): verify note, weak-citation marks, "verify numbers", recitation notice, retract card. |
| D-25 | Artifact panel with versions (append-only history, restore appends) and Preview/Edit/Download (`Panels.tsx:63, 446-483`, `routes/artifacts.ts:2-9`), exports xlsx/docx/pptx (`artifacts.ts:41`), selection → ask (`SelectionFloatingButton.tsx`, `selection.ts`). |
| D-26 | Events actually sent: `start`, `research`, `delta`, `thinking`, `sources`, `code`, `tool_use`, `tool_result`, `artifact_created`, `ui_block`, `ui_draft`, `debug`, `done`, `error` (`generation.ts:122-142`); frame `id:` = index in the in-memory buffer (`chats.ts:828`); resume only via `GET /chats/:id/stream?after=` (`chats.ts:668-692`); no `Last-Event-ID` handling (searched `last-event-id` case-insensitive in `chats.ts`, `adapter.ts`: none); no `snapshot` — a lost gap is a 404 `no_active_run` (`chats.ts:686-689`, `runHub.ts:63-66`); stream ends on request `close` (`chats.ts:823`) or run end (`:816-822`), no send timeout. Route shape is `POST /chats/:id/generate` (`chats.ts:531`), not `POST /turns` + `GET /v1/turns/{id}/events`. |
| D-27 | `: heartbeat` comment frame every 15,000 ms in every stream (`chats.ts:813-815`); same number as N-24; not a named `ping` event; the client ignores comments (`adapter.ts:272-290`). |
| D-28 | `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no` (`chats.ts:802-809`). |
| D-29 | not found (no re-check inside `streamRun`, `chats.ts:784-834`). Chat delete aborts the run (`chats.ts:446`); logout-all does not. |
| D-30 | Frontend hosting is Cloudflare (`package.json:9` `wrangler deploy`, build plan ADR-0060 pending); no `usercontent` host. |
| D-31 | no Android code. |

## 3. Buckets
| Id | Bucket | One-line reason |
|---|---|---|
| D-01 | DIFF-STACK | react-markdown/remark stack renders the same GFM on web; markdown-it is chosen for Android parity (Phase 6) |
| D-02 | NEW-BUILD | termination of unfinished constructs while streaming |
| D-03 | REWRITE | coalesce deltas (server flush 100 ms + client rAF) |
| D-04 | KEEP | KaTeX with `throwOnError:false` (markdownPlugins.ts:41-44) |
| D-05 | DIFF-STACK | Recharts vs ECharts JSON: library choice, but TD-8 is Stage 8's decision (owner question Q1 below; cross-reference corrected by the main session, AUDIT-LOG C-2) |
| D-06 | NEW-BUILD | pdf.js + registry-driven highlight; depends on Stage 12 L-16 |
| D-07 | REWRITE | `[web:n]` token and producer; card exists |
| D-08 | KEEP | server-rendered rows (sheetPreview.ts:8-9) |
| D-09 | REWRITE | audio+transcript, image zoom missing; DOCX/PPTX client renderers differ from LibreOffice→PDF but meet the outcome |
| D-10 | NEW-BUILD | header CSP/COOP route + Report button; separate origin host is DIFF-INFRA |
| D-11 | NEW-BUILD | render `renderedContent` (compliance) |
| D-12 | NEW-BUILD | in-app notice for other-chat completion (with Stage 10 AO-7) |
| D-13 | NEW-BUILD | virtualized transcript + cursor paging |
| D-14 | REWRITE | self-host Devanagari, `word-break: normal` |
| D-15 | DEFERRED | admin/ops consoles |
| D-16 | DEFERRED | admin destructive actions |
| D-17 | NEW-BUILD | with research mode |
| D-18 | REWRITE | add copy-as-Markdown and CSV download |
| D-19 | REWRITE | add wrap toggle and line numbers |
| D-20 | KEEP | ToolActivity.tsx:278-300, App.tsx:1021-1051, share.ts:7 |
| D-21 | KEEP | ToolActivity.tsx:55-82, workspace.tsx:529-566 |
| D-22 | REWRITE | transcript `role=log`, announce-on-done, per-message lang |
| D-23 | REWRITE | X-Robots-Tag on the HTML, drop `/s/` from robots.txt, generic OG, print CSS, hide grounded answers, Report link |
| D-24 | NEW-BUILD | verify note, weak marks, retract card, recitation notice (cut-short already exists) |
| D-25 | KEEP | Panels.tsx:446-483, artifacts.ts:2-9 |
| D-26 | REWRITE | event contract on the durable store (`ping`, `snapshot`, `Last-Event-ID`, send timeout); store itself = Stage 10 AO-4b |
| D-27 | KEEP | 15 s keep-alive frame in every stream (chats.ts:813-815) |
| D-28 | KEEP | chats.ts:802-809 |
| D-29 | NEW-BUILD | 60 s session re-check inside the stream |
| D-30 | DIFF-INFRA | domains/hosting (ADR-0060) |
| D-31 | NEW-BUILD | Android client, Phase 6 |

Counts (31 ids): KEEP 7 · REWRITE 9 · NEW-BUILD 10 · DIFF-STACK 2 · DIFF-INFRA 1 · DISCARD 0 · DEFERRED 2.

## 4. Non-KEEP items

### D-26 + D-29 — SSE contract on the durable run store
- Exact change: after Stage 10 AO-4b, serve `GET` stream from the event store: named `ping` every 15 s (N-24) in addition to the comment keep-alive, `id:` = per-turn seq, honour `Last-Event-ID` before `?after=`, `snapshot {text,status,upto_seq}` when the gap is gone, `ack` as the first frame, 60 s session re-check (logout-all/removal → `error` 401, chat delete → 404), send timeout = one ping interval, never trust `close` to mean the viewer is gone (the turn must not depend on it). Keep the richer repo frames (`thinking`, `tool_*`, `ui_*`, …) as a superset of `status`/`delta`. Files: `routes/chats.ts:668-834`, `adapter.ts:109-290`, `workspace.tsx:430-730`, new `services/runStore.ts`. Port source: `arcnave.in:backend/apps/api/src/arcnave_api/chat/relay.py` (ping, snapshot, resume, lag counters, send timeout), `arcnave.in:backend/apps/lvsse/src/arcnave_lvsse/main.py`.
- Option A (REWRITE `streamRun` over the store when AO-4b lands, same URL): Time M · risk low · breaks `chats.integration.test.ts`, `runResume.integration.test.ts`, `adapter.test.ts` frame expectations.
- Option B (add `Last-Event-ID` + named `ping` + session re-check on the current in-memory hub first): Time S · risk: gap still 404 (no snapshot) until the store exists.
- Pick: B immediately for `ping`/`Last-Event-ID`/session re-check/send timeout, then A. Both keep the app runnable.

### D-02 + D-03 — streaming Markdown termination and cadence
- Exact change: `remend` (Apache-2.0, Stage 20 pin) in the client before `react-markdown` (close bold/italic/code/links/math; incomplete images removed); coalesce deltas — server flush 100 ms (N-73) and client `requestAnimationFrame`/`startTransition` batching; never reorder blocks; pin the streaming message to the bottom. Files: `Content.tsx:226-321`, `workspace.tsx:498-513`, `generation.ts` delta path, `package.json`. Port source: none.
- Option A (client-side batching + remend only): Time S–M · risk low · breaks `MarkdownStreaming.test.tsx` snapshots slightly.
- Option B (add server-side coalescing too): Time S · risk: needs the 100 ms flush inside `generation.ts`; reduces SSE frame count (helps the Postgres store).
- Pick: A then B.

### D-06 + D-07 + D-24 — citation viewer, web chip, Stage 13 hooks
- Exact change: web `[file:n]` chip → `react-pdf`/pdf.js page jump + text-layer highlight by normalised cited text (fallback page only); `[web:n]` token and a producer (prompt rule + parser in the answer pipeline) feeding the existing `Citation` card (`Content.tsx:189-225`); notes/marks from Stage 13 (verify note, weak-citation dotted chip, "verify numbers", recitation notice, "This answer was withdrawn (reason)" card). Files: `Content.tsx`, `Panels.tsx:950`, `package.json` (pdfjs/react-pdf), `ChatStates.tsx`, `adapter.ts` (new frames), `workspace.tsx`. Port source: none.
- Option A (NEW-BUILD with the Stage 12 registry as the data source): Time L · risk medium · breaks `Panels` PDF preview tests.
- Option B (page jump only via `#page=N` on the existing iframe first): Time S · risk: no highlight; RD-4 (b) unmet until A.
- Pick: B now, A after Stage 12 L-16.

### D-10 — HTML preview security
- Exact change: serve artifact HTML from a separate origin route with response headers CSP (`default-src 'none'; script-src 'self' 'unsafe-inline'; style-src …; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors <app>; sandbox allow-scripts`), COOP on the app, Report button on shared/artifact content; keep the opaque-origin iframe. Origin/host and DNS: DIFF-INFRA (ADR-0060). Files: `routes/artifacts.ts` (new `GET /artifacts/:id/frame` signed short-lived URL), `SandboxFrame.tsx`, `Panels.tsx`, nginx/Cloudflare headers. Port source: none.
- Option A (NEW-BUILD route + `src=` URL on a second host): Time M · risk: needs a second hostname in dev (use `localhost` vs `127.0.0.1` pair). Option B (keep `srcdoc` + `<meta>` CSP, add Report button only): Time S · risk: `frame-ancestors`/`sandbox` directives cannot be set from a meta tag.
- Pick: A with a path-based origin in dev; production host later.

### D-11 — Google Search Suggestions
- Exact change: render `searchEntryPoint.renderedContent` exactly as provided (same-width sandboxed iframe, nothing adjacent, no modification) directly under Gemini-grounded answers; hide on share with the answer. Files: `Content.tsx`/`App.tsx` message footer, `adapter.ts:51`, `share.ts`. Time S · risk: **Google grounding terms of use** — today the backend collects it and the UI drops it (`generation.ts:926-936`). Pick: build now; non-negotiable compliance item.

### D-12 / D-13 / D-17 / D-18 / D-19 / D-22 — small UI items
- D-12: status line + toast when another chat's run ends (with Stage 10 AO-7, RG6). Time S.
- D-13: `@tanstack/react-virtual` (MIT) or react-virtuoso core; page transcript by cursor; keep streaming message pinned. Time M · breaks `ChatView.test.tsx`. Port source none.
- D-17: early-findings panel + report TOC once research exists. Time S–M.
- D-18: copy-as-Markdown + client CSV download on `.table-scroll` (`Content.tsx:300-309`); sticky header. Time S.
- D-19: wrap toggle + line numbers for >10 lines in `CodeBlock.tsx`. Time S.
- D-22: `role="log"` on the transcript, announce only on `done`, `lang` per message from script detection (extend `answerLang.ts`), check 24×24/reflow/contrast by axe in CI. Time M.
- Pick: A for each (REWRITE/NEW-BUILD in place).

### D-14 / D-09 — fonts and previews
- D-14: self-host Noto Sans Devanagari (variable, unicode-range) in `brand/fonts.ts`; `word-break: normal`; `Intl.NumberFormat('en-IN')` via the shared formatter (Stage 13 V-21). Time S.
- D-09: audio preview with transcript segments (needs Stage 12 L-05 timestamps) and an image viewer with zoom; PDF via the D-06 viewer. Time M. DOCX/PPTX stay on the client renderers (the PPTX renderer was written because LibreOffice-free open-source renderers drew nothing, `officePreview.ts:6-8`); record as a DIFF-STACK deviation, not a defect.

### D-23 — share page
- Exact change: serve the share page HTML with `X-Robots-Tag: noindex, nofollow` (Cloudflare `_headers` or the Worker) and remove `Disallow: /s/` from `robots.txt` (`scripts/prerender.mjs:36`) so crawlers can see the noindex; generic OG tags for share URLs (title/image only, no content); `@media print` CSS; hide Gemini-grounded answers and their sources (Stage 10 RG2); Report link; keep Markdown escaped, artifacts/files name only. Files: `scripts/prerender.mjs`, `SharedPage.tsx:57`, `routes/share.ts`, hosting headers, CSS. Time M · breaks nothing. Pick: A.

## 5. Open questions for the owner
- Q1. Charts: Stage 14 RD-3 / Stage 8 TD-8 lock ECharts JSON; the repo draws Recharts blocks with its own zod schema. Rewrite to ECharts JSON now (needed for the Android adapter and the VD-7 chart gate) or record Recharts as an owner deviation until Phase 6?
- Q2. Markdown parser: switch the web to markdown-it now (shared with the future Android renderer) or keep react-markdown until Phase 6? (Both meet the web outcome; only parity with Android differs.)
- Q3. The user-content origin is `usercontent.arcnave.tech` (a different registrable domain from `arcnave.in`, by owner decision 2026-10-06). Confirm this stays when the frontend hosting question (ADR-0060, Cloudflare vs Google-only) is decided, because the CSP `frame-ancestors` value depends on it.
- Q4. Stage 14's SSE contract names `POST /v1/turns` + `GET /v1/turns/{id}/events`; the repo exposes `POST /chats/:id/generate` + `GET /chats/:id/stream`. Keep the chat-scoped URLs (outcome identical) or rename with the Stage 5 audit?

## 6. KEEP spot-check
(7 KEEP rows; 3 re-opened = 43 %.)
| Id | file:line | Result |
|---|---|---|
| D-27 | `chats.ts:813-815` interval 15,000 ms writes `: heartbeat`; `adapter.ts:272-290` ignores it | confirmed (keep-alive bytes present; not a named `ping` event — carried in D-26) |
| D-08 | `services/documents/sheetPreview.ts:8-9` (200 rows × 50 cols), `FilePreviews.tsx:75-99` | confirmed; N-41 row limit has no register value |
| D-20 | `ToolActivity.tsx:281-300`, `App.tsx:1051` (`m.thinking &&` hides empty), `share.ts:7` | confirmed |

## Numbers that differ (N-xx)
| N | Register value (line in `00-numbers-register.md`) | Repo value |
|---|---|---|
| N-24 | SSE ping 15 s; Redis stream retention ~15 min after done (l.29) | ping 15,000 ms (`chats.ts:815`) = same; finished run replayable 5 min (`runHub.ts:20`) vs 15 min |
| N-41 | delta coalesce ~50–100 ms; spreadsheet preview rows; artifact preview URL TTL; chat page size; max formulas per message (l.46) | no coalescing (`workspace.tsx:498-506`); preview 200 rows × 50 cols (`sheetPreview.ts:8-9`); preview URL TTL none; conversation list page via `limit` (default not read), transcript not paged |
| N-73 | runner delta flush 100 ms; relay poll 250 ms; stream events kept 15 min; Redis `MAXLEN ~` 10,000; session re-check 60 s; turn lease 30 s / heartbeat 10 s (l.80) | buffer 50,000 events in memory (`runHub.ts:17`); no flush interval; no relay poll; retention 5 min; no re-check; no lease |
