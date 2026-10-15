# ArcNave – Stage 4 · L2 Edge Layer – deep dive
_Last updated: 2026-09-30 · Status: LOCKED_
_Parent: 04-architecture-layers.md · L1 LOCKED_

> **Doc-sync 2026-10-03 (Stage 14) – see Stage-14-Streaming-Rendering/00-checkpoint-stage14.md:**
> - New hostname **usercontent.arcnave.tech** (HTML/web-page artifact previews + Search Suggestions frames): separate origin, no cookies, CSP default-src 'none' + connect-src/form-action/base-uri 'none' + frame-ancestors app.arcnave.tech + sandbox allow-scripts, COOP on app; no CDN cache; noindex. Closes the "separate user-content domain" item (was Stage 16).

> **Doc-sync 2026-10-03 (Stage 19) – see Stage-19-Infrastructure/00-checkpoint-stage19.md:**
> - **No Cloud CDN on any host** (CDN caches worldwide – residency). Global external ALB (EXTERNAL_MANAGED) + serverless NEGs for app / api / usercontent / share; SSL policy **MODERN + min TLS 1.2** set explicitly (default allows TLS 1.0); Certificate Manager DNS-auth wildcard + CAA; DNSSEC with DS at registrar. Cloud Armor Standard CRS 4.22 tuned, body inspection 64 kB, rate limit per IP 600/min + per user key, **verbose logging OFF in prod** (snippets contain content) (ID-8/ID-9).

> **Doc-sync 2026-10-03 (domain):** owner holds **arcnave.in** (not arcnave.tech). All hostnames read `app.arcnave.in`, `api.arcnave.in`, `usercontent.arcnave.in`, `share.arcnave.in`, `ops.arcnave.in`; Cloud Identity org = arcnave.in; wildcard cert `*.arcnave.in` + apex; CAA/DNSSEC on arcnave.in. Every earlier "arcnave.tech" reference means arcnave.in.

## 1. Job of L2
The only public door into ArcNave. Terminates HTTPS, blocks bad traffic, routes each hostname to the right backend. No business logic.

## 2. Documented facts (Google Cloud docs, verified 2026-09-30)
- E-F1. Cloud Run request timeout: default 5 min, max 60 min. For >15 min Google recommends clients can reconnect/resume (idempotent or resumable handlers).
- E-F2. Cloud Run supports streaming HTTP responses (`Transfer-Encoding: chunked`), no config needed. 32 MiB response cap applies only to non-streamed responses.
- E-F3. Cloud Run max request size: 32 MiB on HTTP/1 server; no limit on HTTP/2 server. Max 1000 concurrent requests per instance.
- E-F4. Global external Application Load Balancer supports Cloud Run via serverless NEG; Cloud Armor + Cloud CDN supported; backend timeout for serverless NEG = 60 min, not configurable; no health checks for serverless backends (outlier detection available).
- E-F5. IAP with external LB → Cloud Run works only for users inside your Google organization (not public end users).
- E-F6. Cloud Armor rate limiting: throttle or rate-based ban; keys: IP, header, cookie, path, XFF IP, region code, ASN, TLS fingerprint, etc. (up to 3 combined).

## 3. Hostnames (ArcNave design)
| Hostname | Goes to | Why separate |
|---|---|---|
| `app.<domain>` | Web app (Next.js) | Main product |
| `api.<domain>` | API service (Cloud Run, Mumbai) | Web + Android both call this |
| `share.<domain>` | Public shared-chat pages (G3) | **Separate origin** → a bug in shared content can't touch logged-in app cookies/session |
| `ops.<domain>` | Internal ArcNave console (UI-5 Claude switch per company, support) | Protected by **IAP**, only ArcNave staff Google accounts (E-F5) |
| Signed upload URLs | Cloud Storage directly | Big files never pass through LB/API (E-F3 32 MiB limit) |

## 4. Components
| # | Component | Setting / rule |
|---|---|---|
| 1 | DNS | Managed DNS zone for the domain |
| 2 | TLS | Google-managed certificates; HTTPS only; HTTP → HTTPS redirect; HSTS |
| 3 | Global external Application LB | One LB, host-based routing to backends (section 3); HTTP/2 + HTTP/3 to clients |
| 4 | Cloud Run ingress lock | Services accept traffic **only from the LB** ("internal + Cloud Load Balancing") → nobody bypasses Cloud Armor via the default run.app URL |
| 5 | Cloud Armor – WAF | Preconfigured OWASP-type rules (SQLi, XSS, LFI, RCE) on `api`, `app`, `share` |
| 6 | Cloud Armor – DDoS | Default L3/L4 protection on global LB; adaptive protection alerts |
| 7 | Cloud Armor – edge rate limit | Per-IP throttle (coarse, anti-flood). **Per-user / per-company limits stay in L3** (needs login identity) |
| 8 | Streaming path | SSE over chunked HTTP; API service timeout set above longest expected turn (≤ 60 min, E-F1/E-F4); resume via `sequence_number` (C5) covers drops |
| 9 | CDN | Only static web assets (JS/CSS/images). **Never** API or chat. Share pages: no cache or very short TTL so revoke works immediately |
| 10 | CORS | `api` allows only `app` origin (+ Android has no CORS) |
| 11 | Security headers | HSTS, CSP, X-Content-Type-Options, frame-ancestors none, Referrer-Policy; share pages add `noindex` |
| 12 | Request limits at edge | Max body for API JSON (small, e.g. ≤1 MB); uploads never via API |
| 13 | Edge logging | LB + Cloud Armor logs → observability (Stage 17); no request bodies logged |

## 5. Open decisions (L2)
| ID | Question | Options | Recommendation |
|---|---|---|---|
| E-1 | Where to host Next.js web app | (a) Cloud Run (Mumbai) behind same LB + CDN for static; (b) Firebase App Hosting; (c) static export on Storage + CDN | (a) – one LB, one security policy, same region |
| E-2 | Domain name | – | User to give (e.g., arcnave.com?) |
| E-3 | Share page caching | No cache / short TTL | No cache in MVP |
| E-4 | Bot/abuse protection on login & signup (reCAPTCHA-type) | MVP / later | MVP for signup + login only |
| E-5 | Country blocking | None / India-only | None (B2B customers may travel) |

Sources: docs.cloud.google.com/run/docs/configuring/request-timeout ; /run/docs/triggering/https-request ; /run/quotas ; /load-balancing/docs/negs/serverless-neg-concepts ; /armor/docs/rate-limiting-overview

## 6. Gap check vs vendor docs (verified 2026-09-30)
Facts found:
- Anthropic streaming: event streams "may also include any number of `ping` events"; errors can arrive mid-stream after HTTP 200 (`error` event, e.g. overloaded); interrupted streams can be recovered by capturing partial output and continuing (Claude 4.6+: add a user message asking to continue).
- Anthropic errors: JSON shape {type:"error", error:{type, message}, request_id}; every response has a `request-id` header; 413 `request_too_large` (Messages API 32 MB); 429 has `retry-after`; spend-cap 429 has NO retry-after and carries `error_code: enforced_spend_limit_reached`; 529 overloaded.
- Anthropic rate limits: token-bucket; per-tier RPM/ITPM/OTPM; response headers `anthropic-ratelimit-*`; cached input tokens mostly don't count toward ITPM.
- Anthropic publishes fixed inbound/outbound IP ranges so customers can allowlist.
- ChatGPT Enterprise/Edu: workspace IP allowlisting – requests from non-allowlisted IPs blocked "even if the user has valid credentials"; set by workspace owners/admins.
- OpenAI residency: data residency (storage) vs inference residency (GPU); India = storage only, inference residency only EU/US/UAE → same split as ArcNave C3.

| # | Gap | Seen in | Where it lives | Rec |
|---|---|---|---|---|
| L2-G1 | **Heartbeat (`ping`) events** in stream every ~15 s so LB/mobile networks don't drop idle streams (Opus 5.5 thinking is always on → long silent gaps before first word) | Anthropic | L2 + L4 event emitter | MVP |
| L2-G2 | **One error format everywhere** (incl. errors made by LB/Cloud Armor) + `request-id` header on every response; shown to user as "support code" | Anthropic | L2 custom error responses + L3 | MVP |
| L2-G3 | **429 with `Retry-After`**, and a different code for "quota/budget finished" (no retry) | Anthropic | L2 (edge throttle) + L3 | MVP |
| L2-G4 | Clear 413 "too large" error at edge | Anthropic | L2 | MVP |
| L2-G5 | Error event in the middle of a stream (after 200 OK) | Anthropic | L4 events | Already covered (`error` event) |
| L2-G6 | **Company IP allowlist** (company admin lists office IPs; others blocked even with valid login) | ChatGPT Enterprise | L2 passes real client IP → L3 enforces per company | Later (keep client-IP passthrough now) |
| L2-G7 | **Fixed outbound IP** for ArcNave (so customer systems can allowlist ArcNave when tools/webhooks call them) | Anthropic | Cloud NAT static IP | Later (with Stage 8 tools) |
| L2-G8 | Resume ArcNave↔model stream if the model connection breaks mid-answer | Anthropic | L5 Gateway | Moved to Stage 15 |
| L2-G9 | Storage-vs-inference residency wording | OpenAI | Documentation | Covered by C3 |
| L2-G10 | Public status page (uptime/incidents) | ArcNave rec | Ops | Later |

Sources: platform.claude.com/docs/en/build-with-claude/streaming ; /api/errors ; /api/rate-limits ; /api/ip-addresses ; help.openai.com/en/articles/12111596 ; help.openai.com/en/articles/9903489

## 7. Decisions (user, 2026-09-30)
- L2-G1…G10: accepted as recommended (G1–G4 MVP; G5, G9 covered; G6, G7, G10 later; G8 → Stage 15).
- E-1: Next.js web app on Cloud Run (Mumbai) behind the same LB + CDN for static assets.
- E-2: Domain = arcnave.tech → app.arcnave.tech · api.arcnave.tech · share.arcnave.tech · ops.arcnave.tech (root arcnave.tech = marketing/landing, later).
- E-4: Bot/abuse protection on signup + login in MVP.
- E-3: No cache for share pages (revoke must work immediately).
- E-5: No country blocking for now. Decide after ArcNave is live (options: block non-India / monitor only / India-only signup).
- 2026-09-30 · L2 LOCKED.
