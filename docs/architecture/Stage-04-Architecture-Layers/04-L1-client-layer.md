# ArcNave – Stage 4 · L1 Client Layer (Web + Android) – deep dive
_Last updated: 2026-09-30 · Status: LOCKED_
_Parent: 04-architecture-layers.md_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - UI states added (Stage 4 review + later): answer retract, model auto-switch note (PE-2), low-confidence note (V-2), messages/limits remaining counter (L3-G4), Thinking panel (TH-1), failed file Retry/Remove (AS-D6), share link hides thinking + Google-grounded answers (SL-1, also research reports RG2), force app update (P31).
> - Artifacts (Stage 6 CR-1 / Stage 8): side panel, versions, downloads, KaTeX math, typed citation rendering `[file:n]`/`[web:n]`, AI disclosure banner, HTML preview in sandboxed iframe (Android WebView rules → Stage 16), live tool status labels (TD-10).
> - Research mode (Stage 10): plan editor, progress steps, Stop, in-app notification, remaining counter; normal chat live step list + completion states.
> - **Memory (Stage 11):** Settings → Memory shows topics (profile, preferences, topics, ongoing work, people) with edit line / delete line or doc / export / reset / pause / sensitive opt-in; per-chat memory toggle set before first message; chat shows "Personalised with your memory" chip (tap → list) and "Saved to memory" notice (separate notice for sensitive saves; refused saves explained); chat-delete dialog says explicitly saved memories stay.
> - Company admin: memory ON/OFF (default ON, OFF deletes all after warning), company instructions (CI-1), web search, code execution + file creation, research ON/OFF, public share links (default OFF), Claude limit + alerts (Stage 7).


> **Doc-sync 2026-10-03 (Stage 13) – see Stage-13-Output-Validation/00-checkpoint-stage13.md:**
> - UI: "answer was cut short" notice + Continue button (VD-3); generic "verify important facts" note + weak-citation marks (VD-2); "verify numbers" note (VD-8); retract/replace rendering for the fixed list (VD-5); recitation notice + regenerate; KaTeX throwOnError=false; streaming-safe Markdown termination in the shared TS client (web + Android).

> **Doc-sync 2026-10-03 (Stage 14) – see Stage-14-Streaming-Rendering/00-checkpoint-stage14.md:**
> - Module 7 renderer = RN1–RN20 (shared markdown-it + remend termination; RonRadtke RN display; KaTeX web / local WebView block math Android; ECharts + @wuba provisional; pdf.js/react-pdf + react-native-pdf citation viewer; server-rendered sheet preview; FlashList v2 / react-virtuoso; bundled Noto Tamil + Devanagari; WCAG 2.2 AA; Google Search Suggestions iframe; in-app notifications; retract card). Module 13 admin panel = RN21 screen list; ops console = RN22. HTML preview: usercontent.arcnave.tech iframe sandbox (web) / hardened WebView (Android) + Report button (RD-6).

> **Doc-sync 2026-10-03 (Stage 15) – see Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md:**
> - Reconnect: backoff 1/2/4/8/16 s + jitter, 5 attempts → "Reconnecting…" banner → manual Retry; seq gap → snapshot; foreground → refetch (ER-10). Error UX: plain message + Retry/Regenerate, reset time on limits, support code small, keep typed text (ER-12); incident banner; GCS resumable 308 + fresh signed URL on expiry.

> **Doc-sync 2026-10-03 (Stage 17) – see Stage-17-Observability/00-checkpoint-stage17.md:**
> - Client telemetry: **no Sentry SaaS / Firebase Crashlytics-Performance-Analytics** (US/EU/global storage). Own `/telemetry` endpoint on Mumbai API: allowlisted event codes, numeric timings, app version, pseudonymous ids; no text/URLs/titles/filenames/breadcrumbs/replay. Web vitals via `useReportWebVitals`; Android crash = RN handler + native stack only; CSP `connect-src` own origins; product analytics opt-out per company (OD-15).

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - Expo SDK 57 / RN 0.86 / React 19.2.3; **no OTA updates in MVP** (store releases; Later self-hosted signed expo-updates endpoint on GCS Mumbai). Google Identity Services (web) + Android Credential Manager. Admin panel: **bulk staff invite (CSV/email list) + join link with domain check** for 50-staff colleges (review §3).

## 1. Job of L1
Show UI, collect input, talk to L3 API only. **No business logic, no model calls, no secrets.** Every decision (model allowed, quota, safety) is made on the server; client only reflects it.

## 2. Modules inside L1
| # | Module | What it does (technical) | Linked decision |
|---|---|---|---|
| 1 | **Auth module** | Email/password + Google sign-in via identity SDK; gets ID token; auto-refresh; attaches token to every API call. Android: token in encrypted storage (Keystore-backed). Web: SDK-managed storage; logout clears everything | R13 |
| 2 | **API client** | Generated from the API schema (OpenAPI) → same typed client logic for web + Android. Adds `Authorization`, `request_id` (idempotency, 0.5), app version header. Retries only safe (read) calls | 1.4 |
| 3 | **Stream client** | Opens streaming connection for a turn; parses typed events `ack · status · delta · citation · tool_status · done · error`; tracks last `sequence_number`; on drop → reconnect with last number (resume) | C5, D3, L-2 |
| 4 | **Composer** | Text box, attachments list (per-file status chip), mic button, model picker (list from `/models`; Claude hidden if company switch OFF; "Auto" default), Send disabled until all files "ready", Stop button during generation | D1, D2, D4 |
| 5 | **Upload manager** | Client pre-check (type/size – server re-checks) → asks API for one-time signed URL → **resumable upload** straight to storage (important on mobile networks) → progress bar → file status updates (uploading → processing → ready/failed) | 0.2 |
| 6 | **Mic module** | Mic permission → record (max duration limit) → send audio to `/speech` → transcript placed in composer, editable before send. MVP = record-then-transcribe (not live voice) | A5 |
| 7 | **Answer renderer** | Incremental markdown render while streaming; code blocks (copy), tables, lists; citation chips (file + page / web link); **sanitize output – never render raw HTML from model (XSS guard)** | C7 |
| 8 | **Conversation UI** | Chat list, open/rename/delete, pagination; shows "stopped" / "failed" states | D4 |
| 9 | **Local store** | Drafts, UI prefs, small read-only cache of recent chats. No tokens in plain storage, no secrets, no other users' data | – |
| 10 | **Error & state UX** | Maps server error codes → friendly messages (quota over, Claude off, file failed, network lost, app update required) | Stage 15 |
| 11 | **Version guard** | App sends version; server can reply "update required" → forced update screen. Needed because old Android versions stay installed for months; API must be versioned | Stage 19 |
| 12 | **Client telemetry** | Crash + performance metrics only. **No prompt/answer content in telemetry** (privacy) | Stage 17 |
| 13 | **Admin panel** | Company settings (Claude switch, quotas), users/roles, usage view | UI-2 |

## 3. Android-specific points
- App can be killed in background → stream stops. Server keeps generating and saves (D3); on reopen the app fetches the finished answer.
- Streaming (SSE) support in the chosen mobile framework must be verified (Stage 14) – some mobile networking stacks do not stream responses by default.
- Large uploads must be resumable (mobile network switches Wi-Fi ↔ 4G).
- Optional: push notification when a long file job finishes (UI-4).

## 4. Security rules for L1
- No API keys / service credentials in the app (anyone can decompile an APK).
- All traffic HTTPS; web has strict Content-Security-Policy.
- Output sanitization (module 7).
- Client checks are only for UX; server always re-validates.

## 5. Open decisions (L1)
| ID | Question | Options | Recommendation |
|---|---|---|---|
| UI-1 | Tech stack | (a) React/Next.js web + React Native (Expo) Android – shared TypeScript; (b) Flutter for Android + web; (c) React web + native Kotlin Android | (a): one language (TypeScript) for web + mobile, share API client + stream parser + types; iOS later from same mobile code. Verify streaming support in Stage 14 |
| UI-2 | Admin panel on mobile? | Web only / both | Web only in MVP |
| UI-3 | UI language | English only / + Tamil / + Hindi | Decide by customers (user input needed) |
| UI-4 | Push notification when long job done | MVP / later | Later |

## 6. Decisions (user, 2026-09-30)
- UI-1: React/Next.js web + React Native (Expo) Android, shared TypeScript.
- UI-2: Admin panel web only (MVP).
- UI-3: UI language English only (MVP).
- UI-4: Push notifications later.

## 7. Gap check vs other AI apps (official help docs, verified 2026-09-30)
Facts found:
- Gemini web app: edit prompt → regenerate; "View other drafts"; copy code; export (Docs, Sheets, PDF, DOCX, XLSX, CSV); Temporary chat (not saved); feedback on responses; model picker (Flash-Lite / Flash / Pro).
- ChatGPT: shared links (anonymous by default; can include history, a single response, images, files); update link snapshot; manage/delete all shared links in Settings → Data controls.
- Claude.ai: up to 20 files per chat, 500 MB per file; PDF ≤ 1000 pages (visual analysis only ≤ 100 pages, text-only above).
- Perplexity: file limit 40 MB; weekly upload allowance with pop-up when exceeded; drag-and-drop attach; Web search ON/OFF toggle; share link; History search; unsigned sessions deleted after 14 days; self-serve data deletion; account deletion removes data within 30 days.

| # | Feature missing in our L1 | Seen in | Impact beyond L1 | Rec |
|---|---|---|---|---|
| G1 | Edit a sent message → regenerate | Gemini | Messages need versions/branches in data model (Stage 5) | MVP |
| G2 | Regenerate answer / see other versions | Gemini | Same as G1 | MVP (with G1) |
| G3 | Share chat link | ChatGPT, Perplexity | B2B risk → company-internal only; permissions | Later |
| G4 | Temporary chat (not saved, no memory) | Gemini, Perplexity (incognito) | Skip save + memory; retention rules | Later |
| G5 | Search my chats | Perplexity | Search index on conversations | MVP (title + text) |
| G6 | 👍/👎 feedback on answers | Gemini | Feedback table; feeds Evaluation harness | MVP |
| G7 | Copy answer / copy code | Gemini | – | MVP |
| G8 | Export answer (PDF/DOCX/XLSX) | Gemini | Export service | Later |
| G9 | Drag-and-drop + paste images/files | Perplexity | – | MVP (web) |
| G10 | Show upload limits + clear pop-up when limit hit | Perplexity, Claude | Need ArcNave limits: max size/file, files/chat, per-user allowance | MVP – limits to decide (Stage 9) |
| G11 | Web search ON/OFF toggle | Perplexity | Depends on tools (Stage 8) | Decide in Stage 8 |
| G12 | Self-serve delete my data / chats | Perplexity | Deletion jobs across DB, storage, vectors, memory (DPDP) | MVP |
| G13 | Source trust labels | Perplexity | – | Later |

Sources: support.google.com/gemini/answer/13275745 ; help.openai.com/en/articles/7925741 ; support.claude.com/en/articles/8241126 ; perplexity.ai/help-center articles 10354775, 10354807, index

### Gap decisions (user, 2026-09-30)
- G1 + G2 (edit & regenerate, versions): MVP → Stage 5 must design message versions/branches.
- G3 (share chat link): MVP. Pending: who can open the link (rec: logged-in users of same company only).
- G8 (export): pending – scope = single answer vs whole chat vs full account data.
- Others: as recommended in table above (pending user confirm).
- 2026-09-30 update: G8 export = NOT needed. G3 share = PUBLIC link (anyone with link). G4–G13 = as recommended (G4 later, G5/G6/G7/G9/G10/G12 MVP, G11 Stage 8, G13 later).
- G3 safeguards (ArcNave rec, to confirm in Stage 16): unguessable link token; snapshot at share time; owner can revoke; company admin can disable public sharing for their company; not indexed by search engines; shared view served from Mumbai storage.

## 8. L1 final summary (for lock)
- Stack: Next.js web + React Native (Expo) Android, TypeScript, shared API client/stream parser/types.
- Model picker: Auto (default) · Gemini 3.8 Flash · Claude Sonnet 5.5 · Claude Opus 5.5 (Claude shown only if ArcNave team enabled it for that company – UI-5).
- MVP features: 13 modules (sec. 2) + G1 edit/regenerate, G2 versions, G3 public share, G5 search chats, G6 feedback, G7 copy, G9 drag-drop/paste, G10 upload limits UI, G12 self-serve delete.
- Later: G4 temporary chat, G13 source labels, UI-4 push. Not needed: G8 export. Stage 8: G11 web toggle.
- English UI; admin panel web only.
- UI-5 DECIDED: Claude ON/OFF per company is controlled by ArcNave team only (internal super-admin), NOT by company admin – for now. Revisit later. → needs an internal ArcNave ops console (see L2/L3).

- 2026-09-30 · L1 LOCKED.
