# ArcNave – Stage 4 · L3 API Layer – deep dive
_Last updated: 2026-09-30 · Status: LOCKED_
_Parent: 04-architecture-layers.md · L1, L2 LOCKED_

> **Doc-sync 2026-10-03 (later stages override this doc where they differ):**
> - Endpoints added: **/memory** (list docs, read doc, edit line, delete line/doc, export, reset, pause, sensitive opt-in), **/admin/memory** (company ON/OFF), **/admin/instructions**, job/file status, signed upload session (UD-4), min-app-version, artifacts (+versions, download), research runs (start, plan edit, cancel, progress).
> - All endpoints keep resource-ownership check (R12) and tenant RLS.


> **Doc-sync 2026-10-03 (Stage 14) – see Stage-14-Streaming-Rendering/00-checkpoint-stage14.md:**
> - Endpoints: signed short-TTL artifact preview URL (usercontent), POST /report (content/user report – Play policy), company admin screens per RN21, ops screens per RN22 (IAP), notifications feed (in-app), citation resolve (cite_id → file_version/page/passage) for the source viewer.

> **Doc-sync 2026-10-03 (Stage 15) – see Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md:**
> - Error format = RFC 9457 `application/problem+json` + extensions `code`, `request_id`, `retryable`, `retry_after_s` (replaces pipeline step 8 shape); SSE `error` event carries the same body; 503 + Retry-After on DB connection exhaustion; incident banner endpoint (ops flag).

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - Auth endpoints/policies SD-1…SD-3: MFA (TOTP) enrol/verify/recovery codes, re-auth for sensitive actions, logout-all, refresh rotation + replay detection, email verification/reset tokens (single-use, 1 h), reCAPTCHA assessment on signup/login/reset, CSRF checks; grievance endpoint + published officer contact (SD-14); legal_hold admin flag (ops).

## 1. Job of L3
Single entry for web + Android at `https://api.arcnave.tech/v1`. Checks who you are, checks input, protects against duplicates/abuse, hands work to L4, streams results back. **No AI logic here.**

## 2. Request pipeline (middleware order – every request)
1. Assign `request-id` (returned in header + every error)  
2. Verify login token → user, company, role (tenant context)  
3. Client version check (old Android app → "update required")  
4. Rate limit (token bucket per user + per company, Redis) → 429 + `Retry-After`  
5. Schema validation (OpenAPI 3.1 is the single source of truth → generates TypeScript client for web + Android)  
6. Idempotency check (`Idempotency-Key` on create calls; kept 24 h)  
7. Handler → L4 / repositories  
8. Error formatter: `{type:"error", error:{type, code, message}, request_id}`  
9. Audit log for admin / ops actions

## 3. Endpoint catalogue (v1)
| Area | Endpoint | Notes / linked decision |
|---|---|---|
| Me | `GET /me`, `DELETE /me/data` | G12 self-serve delete (async job) |
| Models | `GET /models` | Only models allowed for this company (UI-5) |
| Conversations | `GET /conversations?q=&limit=&page=` · `POST` · `GET/PATCH/DELETE /conversations/{id}` | Cursor pagination; `q` = search (G5) |
| Turns (chat) | `POST /conversations/{id}/turns` → **SSE stream** | Body: text, file_ids, model (or auto), `parent_message_id` (edit/branch, G1) |
| | `POST /turns/{id}/regenerate` | G2 new version |
| | `POST /turns/{id}/cancel` | Stop (D4); idempotent |
| | `GET /turns/{id}/events?after=<seq>` | Resume after drop (D3, C5) |
| Messages | `GET /conversations/{id}/messages` | Returns message tree + versions |
| Files | `POST /files` (get signed upload URL) · `POST /files/{id}/complete` · `GET /files/{id}` · `DELETE` | Direct-to-storage upload; status |
| Speech | `POST /speech/transcribe` | Mic → text (A5) |
| Feedback | `POST /messages/{id}/feedback` | 👍/👎 + reason (G6) |
| Share | `POST /conversations/{id}/shares` · `DELETE /shares/{id}` | Public read page on `share.arcnave.tech/s/<token>` (G3) |
| Company admin | `/admin/users`, `/admin/roles`, `/admin/usage`, `/admin/settings` | Web only (UI-2) |
| ArcNave ops | `ops.arcnave.tech` (IAP) → company Claude switch, quotas, support lookup by request-id | UI-5 |

## 4. Streaming contract (SSE)
- Named events: `ack · status · delta · citation · tool_status · ping · error · done`
- Every event carries `seq`; SSE `id:` = `seq`, so the standard `Last-Event-ID` reconnect also works.
- `ping` every ~15 s (L2-G1). `error` can arrive after HTTP 200.
- **One active turn per conversation** (second Send while generating → 409).

## 5. Gap check vs vendor docs (verified 2026-09-30)
Facts: Anthropic versioning – may add optional inputs, output values and **new streaming event types** without a version change; SSE events are named. Anthropic list endpoints use cursor pagination (`limit`, `page`/`next_page`). Anthropic returns `anthropic-ratelimit-*` remaining/reset headers. Anthropic Models API lists models; Token Counting API counts before sending. OpenAI streaming: semantic events (`response.created`, `…output_text.delta`, `response.completed`, `error`); "partial completions may be more difficult to evaluate" – moderation arrives only after full output. OpenAI webhooks: Standard Webhooks signature, retries up to 72 h, dedupe by `webhook-id`; cancel is idempotent. Claude Enterprise Compliance API: org owner pulls activity logs, chats, files for audit (not covering Vertex usage).

| # | Gap | Seen in | Rec |
|---|---|---|---|
| L3-G1 | **Clients must ignore unknown fields & event types**; inside `/v1` only additive changes (protects old Android versions) | Anthropic | MVP |
| L3-G2 | SSE named events + `id`=seq + `Last-Event-ID` resume | Anthropic, OpenAI | MVP |
| L3-G3 | Cursor pagination (`limit`, `next_page`) on all lists | Anthropic | MVP |
| L3-G4 | Rate-limit info headers (limit / remaining / reset) → app can show "N messages left today" | Anthropic | MVP |
| L3-G5 | **Streamed answer safety is only checkable after it finishes** → need "retract/replace answer" event + UI support if output check fails | OpenAI | MVP (design now, rules in Stage 13/16) |
| L3-G6 | Cancel endpoint idempotent | OpenAI | MVP |
| L3-G7 | Per-company + per-user quota settings (like per-workspace limits) | Anthropic | MVP (ops console) |
| L3-G8 | Webhooks for companies (signed, retried, dedupe id) | OpenAI | Later |
| L3-G9 | Company audit/compliance export API (activity, chats, files) | Claude Enterprise | Later |
| L3-G10 | SSO (SAML/OIDC) + SCIM user provisioning for enterprises | Claude/ChatGPT Enterprise | Later |
| L3-G11 | Token counting before send | Anthropic | Covered in L5 (internal) |
| L3-G12 | Models list endpoint | Anthropic | Covered (`GET /models`) |

## 6. Open decisions (L3)
| ID | Question | Options | Recommendation |
|---|---|---|---|
| A-1 | Backend language (API service + worker) | (a) Python + FastAPI; (b) TypeScript/Node; (c) Go | (a): best libraries for Gemini/Claude SDKs, PDF/DOCX/XLSX/PPTX/OCR parsing, embeddings; OpenAPI → TypeScript client for apps |
| A-2 | API style | REST + SSE / GraphQL / gRPC | REST + SSE (works on web, Android, LB, simple to debug) |
| A-3 | Rate-limit numbers (per user/company) | – | Set in Stage 18 (cost) with ops-console override |

Sources: platform.claude.com/docs/en/api/{versioning, overview, rate-limits} ; developers.openai.com/api/docs/guides/{streaming-responses, webhooks, background} ; support.claude.com/en/articles/13015708

## 7. Decisions (user, 2026-09-30)
- A-3: OK – rate-limit numbers set in Stage 18 with ops-console override.
- A-2: REST + SSE – DECIDED.
- A-1: DECIDED – Option A: Python + FastAPI (+ Pydantic) for BOTH API service and background worker; frontend stays TypeScript (Next.js + React Native). OpenAPI spec generates the TS client.
- L3-G1…G12 accepted as recommended.
- 2026-09-30 · L3 LOCKED.
- (history) A-1 evidence: Evidence shared: OpenAI – per ex-employee essay (Calvin French-Owen, Jul 2025; NOT official docs): monorepo "~mostly Python", "Pretty much everything operates around FastAPI … and Pydantic", growing Rust services, some Go. Anthropic – no official statement; Claude App Infrastructure job ad lists "Python, Go, Rust, or a similar language". Confidence: OpenAI medium, Anthropic low.
