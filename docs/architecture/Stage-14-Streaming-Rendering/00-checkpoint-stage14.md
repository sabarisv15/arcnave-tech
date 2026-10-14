# ArcNave – Checkpoint · Stage 14 Streaming / rendering – LOCKED 2026-10-03
_User OK 2026-10-03 (RD-1…RD-14 as recommended). Final word over 14-streaming-rendering.md (draft). Evidence: 14-astra-results.md._

> **Doc-sync 2026-10-03 (Stage 17) – see Stage-17-Observability/00-checkpoint-stage17.md:**
> - RN21 admin panel usage view reads tenant-filtered ledger aggregates via Mumbai API with a visible **"last updated"** timestamp (daily/hourly refresh, product pattern). RN22 ops console dashboards: Platform, Turns & latency, Models & cost, Safety & validation, Collector health; request-id lookup via `provider_ref` (OD-16).

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - remend is Apache-2.0; Shiki (MIT) for code highlighting; DOMPurify under its Apache-2.0 option + nh3 server-side (Bleach rejected); no OTA updates in MVP (VS-15/VS-19/VS-20).

> **Doc-sync 2026-10-03 (domain):** owner holds **arcnave.in** (not arcnave.tech). All hostnames read `app.arcnave.in`, `api.arcnave.in`, `usercontent.arcnave.in`, `share.arcnave.in`, `ops.arcnave.in`; Cloud Identity org = arcnave.in; wildcard cert `*.arcnave.in` + apex; CAA/DNSSEC on arcnave.in. Every earlier "arcnave.tech" reference means arcnave.in.

## Docs
| Doc | What |
|---|---|
| 14-astra-prompt.md / 14-astra-results.md | Research prompt + Astra answers (A1–A12 products, B–K libraries/platform; 49 IDs) |
| 14-streaming-rendering.md | Evidence table, facts F1–F23, gaps RN1–RN25, Claude-only CRN1–CRN5, decisions RD-1–RD-14, LV-1, doc-sync |

## Locked decisions (one line each)
- **RD-1 Markdown:** one shared parser (markdown-it, GFM) + remend-style termination in the shared TS client → web React components; Android native views via RonRadtke react-native-markdown-display (react-native-marked = alternate if Tamil tests fail). Snapshot parity tests web vs Android.
- **RD-2 Math:** web KaTeX (htmlAndMathml, throwOnError=false, copy-tex); Android block math in a local-asset WebView (bundled KaTeX, no network, no bridge), inline math as styled LaTeX text; server SVG Later.
- **RD-3 Charts:** web ECharts JSON (TD-8); Android @wuba/react-native-echarts Skia provisional – licence resolved on pinned release (lawyer LW-20); ECharts SSR SVG for static copies Later.
- **RD-4 Citations:** [file:n] → registry → web pdf.js/react-pdf page jump + text-layer highlight (fallback page only); Android react-native-pdf setPage + cited-passage bottom sheet; [web:n] → preview card.
- **RD-5 Spreadsheet preview:** server-rendered first rows per sheet (Stage 9 CSV sidecar); no client XLSX engine.
- **RD-6 HTML preview security:** web iframe sandbox="allow-scripts" only, served from **usercontent.arcnave.tech** with strict CSP (default-src 'none'; connect-src/form-action/base-uri 'none'; frame-ancestors app; sandbox) + COOP; Android = same HTTPS URL in hardened react-native-webview (JS on, file/content access off, universal access off, mixed content never, originWhitelist usercontent, no JS bridge, Safe Browsing on via native config) + **Report** button (Play policy). Closes Stage 6 "Android WebView rules" and Stage 16 "separate user-content domain" debts.
- **RD-7:** Google Search Suggestions renderedContent shown exactly as provided (same width, direct tap, nothing adjacent) under Gemini-grounded answers; hidden on share with the answer.
- **RD-8 Notifications:** in-app MVP (ARIA status / Android live region); push Later (Expo dev build + FCM v1, content-free); badge Later.
- **RD-9 Lists:** Android FlashList v2 (startRenderingFromBottom, maintainVisibleContentPosition); web react-virtuoso core (MIT) or TanStack Virtual; cursor paging.
- **RD-10 Fonts:** bundle Noto Sans Tamil + Devanagari (variable, OFL) in web (unicode-range subsets) and Android app; includeFontPadding=false + lineHeight tuned in LV-1; word-break normal; Intl en-IN.
- **RD-11 Admin consoles:** company admin panel screens = RN21 (Overview · Members · Settings switches · Claude limit · Usage & limits · Data) ; ops console = RN22 (companies approve/suspend + plan limits · Claude switch/limit · quotas · kill switches · config versions · request-id lookup · safety queue · deletion ledger/legal · dashboards · flags). Later: SSO/SCIM, groups, IP allowlist, model allowlist/effort caps, compliance export.
- **RD-12 Destructive actions:** typed confirmation + consequence text + export-before-delete offer + audit entry; no undo.
- **RD-13:** research early-findings panel + report TOC (MVP-lite). **RD-14:** tables = horizontal scroll, copy Markdown, CSV download; cell-select-to-ask Later.
- Also locked: streaming cadence (coalesce ~50–100 ms, never reorder), code blocks (label, copy, wrap, line numbers), thinking panel (summarized only, empty → hide, never redacted, hidden on share), activity step list (TD-10), WCAG 2.2 AA baseline (role=log, announce on done, 24×24, reflow, contrast, lang per message), share page rules (noindex + X-Robots-Tag, generic OG, print CSS, artifacts/files name only, Report link), Stage 13 UI hooks incl. retract card, Android parity list RN24.

## LV-1 additions → 00-lv1-register.md LV-68…LV-75
## Lawyer → LW-20 (@wuba/react-native-echarts licence conflict)
## Numbers → N-41
## Doc-sync → applied 2026-10-03 (00-doc-sync-register.md "Stage 14")
## Next: Stage 15 Error handling and fallbacks.

## Doc-sync 2026-10-06 (owner – product domain)
- `arcnave.tech` in RN10 / RN11 and L2 was a working name; the product domain is **`arcnave.in`** (`app.arcnave.in`, CSP `frame-ancestors https://app.arcnave.in`). The user-content origin is **`usercontent.arcnave.tech`** (owner, 2026-10-06) – a separate registrable domain, cross-site to the app; RN10 / RN11 / L2 keep that host.

## Doc-sync 2026-10-07 (Stage 21 Task 0.14 review – SSE through the ALB, LV-25 / LV-111)
- **SSE through the global external ALB is not buffered** (LV-25, HTTP/1.1 client over the internet: first event after 240 ms, 8 events + 7 pings, every gap 15.0 s, `done`). Server side as used: `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, one flush per write (async generator).
- **A 20-minute stream with 15 s pings (N-24) holds** (LV-111: 1,200 s, 20 data events, 79 pings, max data gap 60.1 s, ended `done`).
- **Without pings the stream dies silently** (LV-111 probe: one 660 s silent gap – the client never received the 660 s event and its own 720 s read timeout ended the stream; `lv-sse` sent the event and `done` normally and saw no disconnect). The cause (ALB 610 s idle timeout vs the home router) cannot be told apart from this run. Consequences: the 15 s ping is mandatory on every SSE stream, in every mode; the server must not assume that a write error tells it the client has gone. Phase 1 tests what the server sees when a client drops mid-stream with pings on (and that the turn is then stopped or left to finish by design).

## Doc-sync 2026-10-10 (Stage 21 Task 1.9 close – SSE relay live on dev)
- **Built (Task 1.9, ADR-0011):** `GET /v1/turns/{id}/events` – events `ack`, `status`, `delta`, `snapshot`, `done`, `error` (ER-11 body), named `ping` every N-24 15 s in every mode; `id:` = seq; resume by `Last-Event-ID` (wins) or `?after=`; `snapshot` when the buffer no longer holds the gap; session re-check every N-73 60 s (logout-all / removal → `error` 401, chat delete → 404); LV-25 headers (`Cache-Control: no-cache`, `X-Accel-Buffering: no`). Dev run 2026-10-10: first event 42 – 52 ms, largest relay lag 241 – 636 ms (Postgres buffer, poll 250 ms), resume after a drop without gap or duplicate, revoke ended the stream 56.5 s after logout-all.
- **Finding (dev run, Cloud Run job → service `run.app`, internal ingress):** a client that closed its connection mid-stream was **not seen by the container** – the request stayed open until the turn ended (52.9 s after the drop; 85.5 s in Cloud Run's request log), the relay logged `done`, never `client_gone`. Same picture as the LV-111 probe through the ALB. Rule: the server never relies on disconnect detection; a stream ends at the turn's end state, the N-43 turn deadline (10 min) or a send timeout – a gone viewer costs at most that much request time. The turn never depends on a viewer (05-2 F2).
