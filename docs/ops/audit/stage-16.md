# Stage 16 - Security and safety: conformance audit

Sources read: `docs/architecture/Stage-16-Security-Safety/00-checkpoint-stage16.md` (doc-syncs to 2026-10-10), `16-security-safety.md` (gaps SE1-SE21, SF1-SF12), `00-Handoff/00-numbers-register.md` (N-49, N-72, N-07),
repo `backend/src/{app.ts,config.ts,logger.ts,plugins/context.ts,routes/auth.ts,routes/chats.ts,services/{auth,googleSignIn,webFetch,systemPrompt}.ts,providers/gemini.ts,tools/*,db/schema.ts}`, `backend/sandbox/Dockerfile.service`, `arcnave-frontend/{nginx.conf,src/SandboxFrame.tsx,src/Content.tsx}`,
`.github/workflows/ci.yml`, ADR 0007, 0053, 0054, 0056, 0061, repo `CLAUDE.md`, `mistakes.md` not read. Port source consulted: `arcnave.in:backend/packages/db/src/arcnave_db/*` (not opened for auth; Python auth packages are outside this group).
Not checked: live deployment state (headers, firewall), installed dependency versions, `.env.example` (access denied to this auditor). Auditor model: Sonnet 5.5 (subagent arcnave-auditor).

## 1. Locked decisions

| Id | Decision (one line) | Status |
|---|---|---|
| SD-1a | No passwords; sign-in = Google or e-mail code/link (single-use, short, attempt-limited, neutral answers); invite-only | SD-1 password length/blocklist/Argon2id lines SUPERSEDED by doc-sync 2026-10-09 (ADR-0010) |
| SD-1b | Short access token + refresh rotation with replay detection; user sessions idle 24 h / absolute 28 d | LOCKED (N-49) |
| SD-1c | Owner/admin absolute 24 h, re-authentication for sensitive actions, TOTP required for owner + admin, recovery codes | LOCKED; DEFERRED (roles) |
| SD-1d | Logout-all | LOCKED |
| SD-1e1 | Cookies Secure + HttpOnly | LOCKED |
| SD-1e2 | Cookies SameSite=Lax | LOCKED (needs same-site hosting) |
| SD-1f | CSRF checks incl. the Google ID-token POST | LOCKED (SE2: double-submit or Origin check) |
| SD-1g | Sign-in throttling per account + IP; code attempts per N-72 | LOCKED (N-72 numbers 2026-10-09) |
| SD-1h | Tokens >= 128-bit, single-use where one-time, hashed at rest | LOCKED |
| SD-2a | Google sign-in verifies signature/aud/iss/exp | LOCKED |
| SD-2b | Account key = Google `sub` | LOCKED |
| SD-2c | No self-signup (invite-only), per-company `hd`, one e-mail = one company | SD-2 self-signup/Gmail lines SUPERSEDED by 2026-10-09; DEFERRED (company) |
| SD-3 | reCAPTCHA Enterprise on e-mail code + Google sign-in; Cloud Armor limits | LOCKED (revised 2026-10-09); DEFERRED (ADR-0056 table: Phase 5) |
| SD-4 | Tenant isolation proof: FORCE RLS, `SET LOCAL`, composite keys, pgTAP, partition policies, access guards | LOCKED; DEFERRED (RLS) |
| SD-5 | Per-company encryption keys Later | LOCKED; DEFERRED |
| SD-6a | Artifact Analysis + SBOM, Binary Authorization on prod Cloud Run | LOCKED; infra |
| SD-6b | CI security gates: gitleaks, dependency audit, OSV-Scanner, Trivy on images, Dependabot, SHA-pinned Actions, OIDC, minimal permissions; all blocking | LOCKED (built in Python repo 2026-10-08) |
| SD-6c | Hash-pinned dependency installs (pip `--require-hashes`) | LOCKED (Python tool; outcome = reproducible, verified installs) |
| PH-1 | Platform hardening: Cloud SQL `ENCRYPTED_ONLY`, GCS public-access prevention, restore drills, Secret Manager rotation, Cloud Armor CRS, ingress internal + LB, Direct VPC egress, SCC, Data Access logs, pgAudit `ddl,role`, IAM DB auth | LOCKED; infra |
| PH-2 | Headers: web HSTS 2 y + COOP/CORP/Permissions-Policy/Referrer-Policy + app CSP (no external image auto-load); API HSTS + nosniff | LOCKED (SE10) |
| PH-3 | No secrets in sandbox/parser images; log redaction of secrets | LOCKED |
| PH-4 | Owner decision A1: no project id/number, instance connection name, service-account/owner e-mail in code, tests, workflows, logs; passwords/keys/tokens nowhere; repo-wide guard test | LOCKED (2026-10-08, -09) |
| PH-5 | Claude provider identity = Anthropic Workload Identity Federation, no API key anywhere | LOCKED (ADR-0012 doc-sync 2026-10-10); conflicts with repo ADR-0054 #6 (owner decision 2026-10-14) |
| FL-1 | ClamAV scan with AlertExceedsMax + encrypted-archive alert; not clean = blocked (`malware` / `scan_incomplete`); quarantine states before parsing | LOCKED |
| FL-2 | ZIP containment: resolved path inside target, entry count, expanded bytes, one level | LOCKED |
| FL-3 | PDF: strip JavaScript/OpenAction/Launch (best effort), pdf.js scripting off; images re-encoded (EXIF/XMP stripped), pixel cap kept, HEIC inside the sandbox | LOCKED |
| FL-4 | LibreOffice macro level Very High + no trusted locations | LOCKED |
| FL-5 | Macro-enabled and legacy formats rejected (Stage 9) | LOCKED |
| SD-7 | M9 safety screen: separate Gemini Flash-Lite call, structured verdict on inputs, web/file tool outputs, sampled outputs; rules block hard categories instantly; calibrated on a human-rated Tanglish/Tamil/Hindi/English set | LOCKED; model revised to `gemini-3.5-flash-lite` (provisional) by doc-sync 2026-10-08 (3.1 text SUPERSEDED) |
| SD-8 | Model Armor shadow trial only, never primary | LOCKED; DEFERRED |
| SD-9a | Gemini thresholds BLOCK_MEDIUM_AND_ABOVE explicit; Claude CSAM image block -> finish code `blocked` | LOCKED |
| SD-9b | Claude refusal `frontier_llm` / `reasoning_extraction` / `null` -> fallback to Gemini only if the M9 input screen passed; `cyber`, `bio`, `general_harms` never fall back | LOCKED |
| SD-10 | Safety categories (11) each with block / care-reply / allow-with-notice | LOCKED |
| INJ-1 | Untrusted content labelled as data (files, web, tool outputs) | LOCKED |
| INJ-2 | Output exfiltration controls: no auto external images, link hardening, CSP | LOCKED |
| INJ-3 | Memory provenance + tombstones + rollback | LOCKED |
| INJ-4 | Tool approval slot + per-turn caps (N-07) | LOCKED |
| INJ-5 | Permission-aware retrieval | LOCKED |
| INJ-6 | Canary in prompts | LOCKED |
| INJ-7 | Controlled web fetch (egress): private ranges and metadata blocked; Fetcher service with no secrets | LOCKED (Stage 8/19; security-relevant) |
| SD-11 | Red-team set HarmBench/JailbreakBench + IndicGuard + own Tanglish/Hinglish + code-mixed + audio attacks; pass thresholds fixed before launch | LOCKED |
| AB-1 | Crisis: separate rules detector + prompt, India helplines (Tele-MANAS 14416) | LOCKED |
| AB-2 | Abuse: warn -> throttle -> ops review + appeal; 18+ attestation; AUP/AI disclosure; PT-2 human review | LOCKED; DEFERRED (admin/company) |
| SD-12 | Incident runbooks (breach, credential/WIF compromise, outage, restore, provider) | LOCKED; DEFERRED (ops) |
| SD-13 | `legal_hold` per data class | LOCKED; DEFERRED |
| SD-14 | Grievance officer + SLA, AI banner, ToS items | LOCKED; DEFERRED (legal/text) |
| SD-15 | DLP, sector addenda Later | LOCKED; DEFERRED |
| SB-1 | Sandbox: zero general egress | LOCKED (ADR-0007 matches) |

## 2. Repo today

| Id | Evidence (file:line) or "not found (searched: ...)" |
|---|---|
| SD-1a | Passwords exist: `routes/auth.ts:49-71,73-94,144-165`, `services/auth.ts:19-37,158-228` (min length 12, Argon2id 19,456 KiB / t2 / p1 :52-58); open registration unless `REGISTRATION_ENABLED=false` (`config.ts:91`); Google beside it (`routes/auth.ts:96-115`, ADR-0056); e-mail code/link and invitations not found (searched `invite|code|magic|otp` in `backend/src/{routes,services}`) |
| SD-1b | Single opaque server session, absolute TTL 336 h (`config/numbers.ts:73`, `services/auth.ts:276-286`); `sessions.last_seen_at` is written (`auth.ts:307-311`) but never enforced; no refresh token, no rotation, no replay detection |
| SD-1c | not found (searched `role`, `totp`, `mfa` in `backend/src`, `db/schema.ts:39-52`) |
| SD-1d | `AuthService.logoutAll` exists (`auth.ts:322-324`) but is called only after a password change (`:346`); no route (`routes/auth.ts` has register, login, google, logout, me, password) |
| SD-1e1 | `routes/auth.ts:35-44`: httpOnly, signed, secure when `SESSION_COOKIE_SECURE`; production boot refuses non-secure (`config.ts:431`) |
| SD-1e2 | `sameSite: cfg.SESSION_COOKIE_SECURE ? 'none' : 'lax'` (`routes/auth.ts:38`); reason documented `:4-15` (frontend on Cloudflare, API on Cloud Run: different sites) |
| SD-1f | not found (searched `csrf|Origin|Sec-Fetch` in `backend/src` non-test: only the SSE ACAO echo `routes/chats.ts:792-800` and upload origin `routes/files.ts:546`). Body-less state-changing POSTs reachable cross-site with `SameSite=None`: `POST /auth/logout` (`routes/auth.ts:117-130`), `POST /chats/:id/stop` (`routes/chats.ts:696-713`); JSON routes are protected only by CORS preflight (`app.ts:83-91`) |
| SD-1g | `RATE_LIMIT_AUTH_PER_MINUTE=10` per route (`config.ts:369`, `routes/auth.ts:62,82,105,154`) keyed by user id else IP (`app.ts:99`); no per-account counter, no lock-out, no N-72 numbers |
| SD-1h | 256-bit token, SHA-256 at rest (`services/auth.ts:1-7,95-101`; `db/schema.ts:54-76`) |
| SD-2a | `services/googleSignIn.ts:36-51` (`verifyIdToken` with audience; signature/issuer/expiry by the library; `email_verified` required for linking `auth.ts:236-238`) |
| SD-2b | keyed by e-mail (`auth.ts:239-241`); `sub` is read (`googleSignIn.ts:46`) but not stored (no `google_sub` column, `schema.ts:39-52`); ADR-0056 table records it as a deliberate deviation |
| SD-2c | `hd` / invite / company: not found |
| SD-6b | `.github/workflows/ci.yml:1-78`: typecheck, tests, build only; actions pinned by tag (`actions/checkout@v4`, `setup-node@v4`), no `permissions:` block, no secret scan, no dependency audit, no image scan, no Dependabot file (`.github/` holds only `ci.yml`) |
| SD-6c | `backend/sandbox/Dockerfile.service:25-31` `pip install` unpinned, no hashes; backend uses `package-lock.json` with `npm ci` (`ci.yml:52`) |
| PH-1 | no Terraform / cloud config in repo; `backend/sandbox/verify-deployment-config.sh` exists (not read) |
| PH-2 | web: `arcnave-frontend/nginx.conf:19-21` nosniff, `X-Frame-Options: DENY`, `Referrer-Policy`; no HSTS, COOP, CORP, Permissions-Policy, CSP (searched `Strict-Transport|Content-Security-Policy|Permissions-Policy` in `nginx.conf`, `backend/src`); API: per-route nosniff only on downloads (`routes/usage.ts:363`, `artifacts.ts:471`, `projects.ts:477`, `files.ts:357`) - no HSTS; sandboxed visuals have their own CSP meta (`src/SandboxFrame.tsx:18-52`: `default-src 'none'`, `img-src data: blob:`, `connect-src 'none'`) |
| PH-3 | log redaction paths `logger.ts:40-67`; sandbox image carries no secret ENV (`Dockerfile.service:41-42`; runs as root with a per-chat uid for code, :9-10) |
| PH-4 | `DATABASE_URL` default embeds a credential (`config.ts:97`); frontend fallback API URL is a hard-coded Cloud Run service address containing a numeric project identifier (`arcnave-frontend/src/api.ts:31-33`); no repo-wide guard test (searched `a1|identifier` tests) |
| PH-5 | API key in env (`config.ts:122`, `providers/anthropic.ts:44-55`); ADR-0054 #6 records it as the prototype choice |
| FL-1..FL-3 | not found (searched `clamav|malware|quarantine|scan_incomplete|OpenAction|exif|sharp` in `backend/src`); only `image-size` (`services/attachments/processUpload.ts:21`) and size/page limits (`:29-37`) |
| FL-4 | not found (searched `macro|MacroSecurity|SecurityLevel` in `backend/sandbox`); LibreOffice installed `Dockerfile.service:18` |
| FL-5 | legacy `.xls` and OpenDocument/RTF accepted (`processUpload.ts:97-132`); macro-enabled formats not specifically rejected (not found) |
| SD-7 | not found (searched `M9|screen|safety.?verdict|flash-lite` in `backend/src`); `gemini-3.5-flash-lite` not in `config.ts`; ADR-0055 fixes three models |
| SD-9a | not found (searched `safetySettings|HarmBlockThreshold` in `backend/src`); Gemini finish reasons not mapped (`providers/gemini.ts:520`) |
| SD-9b | not found; Claude refusal -> `model_refused` (`services/generation.ts:1022-1023,2258-2264`); no category rules, no fallback |
| SD-10 | prompt-level only: `services/systemPrompt.ts:81-92` (children, weapons, drugs, malicious code, real people, legal/financial, copyright), wellbeing section :94-99; no rules layer, no per-category action table |
| INJ-1 | `services/systemPrompt.ts:74-79` (`<trust_boundaries>`), prompt-kit tests `test/promptKit/cases.ts:100-115`; tool outputs are not wrapped or labelled in code |
| INJ-2 | links: `rel="noopener noreferrer"` (`Content.tsx:294`, `Panels.tsx:309,335`, ...); image-search / display cards link to third-party image URLs (`App.tsx:1085`, `generative-ui/blocks/DisplayCards.tsx:55`; whether an `<img>` loads them automatically was not traced); no app CSP (see PH-2); artifact frames CSP-locked (`SandboxFrame.tsx`) |
| INJ-3 | not found (searched `provenance|tombstone|rollback` in `services/memory`) |
| INJ-4 | per-turn tool rounds only (`config.ts:206`, N-06); per-tool caps N-07 and approval slot not found (searched `perTurn|cap` in `tools/`) |
| INJ-5 | project search is scoped by the owner's project (`services/generation.ts:1486-1502`, `ProjectToolExecutor` gets `project.id`); no company ACLs |
| INJ-6 | not found (searched `canary`) |
| INJ-7 | `services/webFetch.ts:19-37,61-63,89-93`: hostname regex list only, no DNS resolution; `new URL('http://[::1]/').hostname` is `[::1]` with brackets, so `^::1$` / `^fe80:` never match IPv6 literals (code reading, not executed); redirects are followed first and checked after the request went out (`:82-93`); `response.text()` buffers the whole body before the 1 MB slice (`:95-96`); no `metadata.google.internal`, `100.64/10`, `::ffff:` mapped addresses |
| SD-11 | partial: `src/scripts/runReliabilityMatrix.ts`, `runBehaviorEvaluation.ts` (one injection scenario each); no HarmBench/IndicGuard sets or thresholds |
| AB-1 | not found (searched `14416|Tele-MANAS|helpline` in `backend/src`) |
| AB-2 | prompt line "capable adult ... minor" (`systemPrompt.ts:61`); no throttle/appeal/attestation |
| SB-1 | ADR-0007 "Implementation (2026-09-25)": all-traffic egress into a VPC with no NAT and a deny-all egress firewall, probe verified; Job engine still open egress (`ADR-0007:67-68`) and `SANDBOX_ENGINE=auto` can pick it (`config.ts:242`) |

## 3. Buckets

| Id | Bucket | One-line reason |
|---|---|---|
| SD-1a | NEW-BUILD | e-mail code/link sign-in absent; provisional until owner Q-S1 |
| SD-1b | REWRITE | no idle expiry, rotation or replay detection |
| SD-1c | DEFERRED | roles/TOTP |
| SD-1d | REWRITE | service method exists, no route |
| SD-1e1 | KEEP | httpOnly + secure + signed |
| SD-1e2 | DIFF-INFRA | Lax needs web and API on one site |
| SD-1f | REWRITE | no CSRF/Origin check; two body-less POSTs exposed |
| SD-1g | REWRITE | no per-account throttle |
| SD-1h | KEEP | 256-bit token, hash at rest |
| SD-2a | KEEP | library verification with audience |
| SD-2b | REWRITE | `sub` not stored or used |
| SD-2c | DEFERRED | company |
| SD-3 | DEFERRED | Phase 5 per ADR-0056 |
| SD-4 | DEFERRED | RLS |
| SD-5 | DEFERRED | Later |
| SD-6a | DIFF-INFRA | Artifact Analysis / Binary Authorization |
| SD-6b | NEW-BUILD | CI has no security gates |
| SD-6c | REWRITE | sandbox pip installs unpinned |
| PH-1 | DIFF-INFRA | Terraform-managed controls |
| PH-2 | REWRITE | headers incomplete on web and API |
| PH-3 | KEEP | redaction list + no secrets in image |
| PH-4 | REWRITE | credential default and project-bearing URL in code; no guard test |
| PH-5 | DEFERRED | owner ADR-0054 #6 moves WIF to Phase 5 |
| FL-1 | NEW-BUILD | no scanner or quarantine |
| FL-2 | NEW-BUILD | no ZIP containment |
| FL-3 | NEW-BUILD | no PDF/image sanitising |
| FL-4 | REWRITE | LibreOffice macro level not configured |
| FL-5 | REWRITE | legacy formats accepted |
| SD-7 | NEW-BUILD | no M9 (conflicts with "three models only": Q-S3) |
| SD-8 | DEFERRED | shadow trial |
| SD-9a | REWRITE | explicit Gemini thresholds absent |
| SD-9b | NEW-BUILD | needs fallback chain + M9 |
| SD-10 | REWRITE | prompt-only; categories/actions table and rules layer missing |
| INJ-1 | KEEP | `<trust_boundaries>` + tests |
| INJ-2 | REWRITE | no app CSP; third-party image cards |
| INJ-3 | NEW-BUILD | no memory provenance/tombstones |
| INJ-4 | NEW-BUILD | no per-tool caps / approval slot |
| INJ-5 | KEEP | retrieval scoped to the owner's project (single-user) |
| INJ-6 | NEW-BUILD | no canary |
| INJ-7 | REWRITE | SSRF filter bypasses (IPv6, DNS, redirects) |
| SD-11 | NEW-BUILD | only two ad-hoc scenarios |
| AB-1 | NEW-BUILD | no crisis detector or India helplines |
| AB-2 | DEFERRED | admin/company |
| SD-12 | DEFERRED | ops runbooks |
| SD-13 | DEFERRED | legal hold |
| SD-14 | DEFERRED | legal/text |
| SD-15 | DEFERRED | Later |
| SB-1 | KEEP | ADR-0007 implemented (verified live per ADR) |

Counts (48 ids): KEEP 7 (SD-1e1, SD-1h, SD-2a, PH-3, INJ-1, INJ-5, SB-1) - REWRITE 14 (SD-1b, SD-1d, SD-1f, SD-1g, SD-2b, SD-6c, PH-2, PH-4, FL-4, FL-5, SD-9a, SD-10, INJ-2, INJ-7) - NEW-BUILD 12 (SD-1a, SD-6b, FL-1, FL-2, FL-3, SD-7, SD-9b, INJ-3, INJ-4, INJ-6, SD-11, AB-1) - DISCARD 0 - DIFF-STACK 0 - DIFF-INFRA 3 (SD-1e2, SD-6a, PH-1) - DEFERRED 12, not bucketed (SD-1c, SD-2c, SD-3, SD-4, SD-5, PH-5, SD-8, AB-2, SD-12, SD-13, SD-14, SD-15). Total 7 + 14 + 12 + 3 + 12 = 48.

## 4. Non-KEEP items

### SD-1a - sign-in without passwords (blocked by Q-S1)
- Exact change: add e-mail code (6 digits, 10 min, single use, 5 wrong tries) and link sign-in, per-e-mail/IP/account limits (N-72), neutral answers, a mailer adapter; keep Google. Remove password routes, `weak_password` and Argon2 only after the owner decides. Invitation/invite-only parts need companies (DEFERRED).
- Files touched: `routes/auth.ts`, `services/auth.ts`, new `services/mailer.ts`, `db/schema.ts` (+ `login_codes`), frontend `src/auth/*`. Port source: Python auth package is outside `gateway`; `arcnave.in:backend/packages/db/src/arcnave_db/migrations/versions/v0002_auth.py`, `v0004_auth_factors.py` for table shapes.
- Option A (NEW-BUILD beside the password path, switch after owner OK): Time L, risk medium, keeps login working. Option B (REWRITE: delete passwords now): Time M, breaks existing accounts and `auth.integration.test.ts`.
- Pick: A, blocked on Q-S1 (ADR-0056 keeps passwords beside Google; owner decision of 2026-10-14).

### SD-1b / SD-1d - session lifetime, rotation, logout-all
- Exact change: enforce idle expiry (`last_seen_at` older than 24 h = expired), absolute 28 d (N-49; repo 14 d), rotate the session token on a short interval with a family id and revoke the family when a rotated-out token is replayed; add `POST /auth/logout-all`. A short-lived access JWT is not required if a rotating opaque session meets the outcome (short exposure + replay detection); pick safety first.
- Files touched: `services/auth.ts`, `routes/auth.ts`, `db/schema.ts` + migration (`sessions.family_id`, `rotated_at`), `config/numbers.ts` (N-49 values with comments), tests. Port source: `arcnave.in:backend/packages/db/src/arcnave_db/migrations/versions/v0002_auth.py` (refresh families).
- Option A (REWRITE rotating opaque sessions): Time M, risk medium (cookie handling, SSE reconnects must survive rotation), breaks `auth.integration.test.ts` TTL assertions. Option B (access JWT + refresh cookie as in the Python design): Time L, higher risk.
- Pick: A.

### SD-1f - CSRF
- Exact change: reject unsafe-method requests (POST/PUT/PATCH/DELETE) whose `Origin` (or `Sec-Fetch-Site`) is not in `CORS_ORIGINS` or same-origin, including body-less ones (`/auth/logout`, `/chats/:id/stop`) and the Google ID-token POST; one `onRequest` hook, applied before the route.
- Files touched: `app.ts` (hook), `config.ts` (reuse `CORS_ORIGINS`), tests. Port source: none. Option A (REWRITE): Time S, risk low (curl/tests need an Origin header). Option B: double-submit token. Time M, frontend change. Pick: A.

### SD-1g - sign-in throttling
- Exact change: counters per account (normalised e-mail) and per IP for password and code attempts: >= 10 failures/hour -> 15 min lock (N-72), neutral error, no timing leak. Today the limit is 10/min per user-or-IP per route. Files: `services/auth.ts`, `db/schema.ts` (`auth_attempts`), `config/numbers.ts`. Option A (REWRITE with a DB table): S-M. Option B (in-memory): S, per instance only. Pick: A.

### SD-2b - key Google accounts by `sub`
- Exact change: `users.google_sub` (unique, nullable), match sub-first then verified e-mail (link once), keep e-mail as attribute. Files: `db/schema.ts` + migration, `services/auth.ts:235-260`, tests `googleSignIn.integration.test.ts`. Option A (REWRITE) S. Option B (leave, ADR-0056 deviation stays): S, but an e-mail change at Google would mis-link. Pick: A (small).

### SD-6b / SD-6c - CI security gates and pinned installs
- Exact change: add a `security` job: secret scan (gitleaks), `npm audit` / OSV-Scanner on both lockfiles, an image scan (Trivy) for backend and sandbox images, Dependabot config (npm, docker, actions), pin actions to commit SHAs, add top-level `permissions: contents: read`, `persist-credentials: false`; sandbox `pip install` from a hash-pinned requirements file (`--require-hashes`). All blocking, per the Python repo's rule (checkpoint 2026-10-08).
- Files touched: `.github/workflows/ci.yml`, new `.github/dependabot.yml`, `backend/sandbox/requirements.lock`, `Dockerfile.service`. Port source: none (Python repo's workflow is not in the sources read). Option A (NEW-BUILD in one commit): M. Option B (non-blocking first): S, weaker. Pick: A. Note: a push/PR runs this on every branch, CI time grows.

### PH-2 - headers
- Exact change: web (`nginx.conf`): HSTS (2 y, includeSubDomains), COOP same-origin, CORP same-site, Permissions-Policy restrictive, keep Referrer-Policy, add an app CSP without external image auto-load (artifact frames keep their own); API: HSTS + nosniff on every response (one `onSend` hook). Files: `arcnave-frontend/nginx.conf`, `app.ts`. Option A (REWRITE) S-M (the CSP needs a pass over Google Sign-In script/frames and fonts). Option B: headers except CSP first. S. Pick: B then A.

### PH-4 - identifiers and credentials in code
- Exact change: remove the credential from the `DATABASE_URL` default (`config.ts:97`; require it outside tests or build the dev URL from compose variables), remove the hard-coded service URL from `src/api.ts:31-33` (require `VITE_API_BASE`, default `/v1`), add a repo-wide guard test over tracked files for project ids/numbers, instance connection names and e-mail addresses (allowlist for synthetic ones), as in the Python build's `test_a1_identifiers.py`. Files: `config.ts`, `arcnave-frontend/src/api.ts`, `.env.example` (not readable here), new guard test. Port source: the Python guard is under `arcnave.in:backend/tests/test_a1_identifiers.py` (not opened). Option A (REWRITE) S. Pick: A. Check: the repo is private, but the number is in git history; rotating is not needed (a project number is not a secret) but the guard is.

### FL-1..FL-5 - file safety
- Exact change: scanner service (ClamAV) call after upload; states `unscanned -> clean | quarantined`, parsing only after `clean`; `scan_incomplete` on timeout/size/encrypted archive; ZIP containment helper (path inside target, entry count, expanded bytes, one level) for ZIP uploads and for OOXML/EPUB expansion done by `jszip`/`exceljs`; PDF sanitising before preview (strip JavaScript/OpenAction/Launch; viewer scripting off); image re-encode (needs an image library; `sharp` is not a dependency - new dependency needs owner approval via the checkpoint list); LibreOffice profile with macro security Very High and no trusted locations in the sandbox image; reject macro-enabled (`.docm/.xlsm/.pptm`) and legacy binary formats the Stage 9 list names (repo accepts `.xls`, `processUpload.ts:129`).
- Files touched: `services/attachments/processUpload.ts`, `routes/files.ts`, `routes/projects.ts`, `db/schema.ts` (+ scan status), `backend/sandbox/Dockerfile.service`. Port source: none. Option A (NEW-BUILD scanner as a separate Cloud Run service + states, switch on once green): L, keeps uploads working. Option B: size/format rejection only (FL-4/FL-5): S, leaves FL-1..3 open. Pick: B first, then A.

### SD-7 / SD-9 / SD-10 - M9 screen, provider thresholds, categories
- Exact change: a rules-first detector for the hard categories plus one separate Gemini Flash-Lite call (structured verdict) before generation and on web/file tool outputs; explicit Gemini safety thresholds; a categories table with action per category (block / care-reply / allow-with-notice) used by the screen and by tests; refusal-category fallback rules (SD-9b) after the fallback chain exists (stage-15.md ER-14a).
- Files touched: new `services/safety/*`, `providers/gemini.ts`, `services/generation.ts`, `config/numbers.ts` (N-xx for the screen timeout: LV-84 decides), frontend care-reply card. Port source: none in the Python repo's gateway (M9 not built there).
- Option A (NEW-BUILD behind a flag, shadow first): L; Option B: SD-9a + SD-10 table only, no model call: M.
- Pick: B now, A after owner decision Q-S3 (a Flash-Lite call is a fourth model, ADR-0055 says three).

### INJ-2 / INJ-3 / INJ-4 / INJ-6 - exfiltration and memory/tool controls
- INJ-2: app CSP (PH-2); do not auto-load third-party images in chat (image-search thumbnails go through a proxy or are links only). Files: `generative-ui/blocks/DisplayCards.tsx`, `nginx.conf`. S-M.
- INJ-3: memory writes record origin (user / model / tool), deletions leave a tombstone, a per-change history allows rollback. Files: `services/memory/*`, `db/schema.ts`. M. Option B: log-only provenance. Pick: A.
- INJ-4: per-turn caps per tool type (N-07: search 1-3-8, run_code 1-3-8, fetch_url 2-5-10, artifacts 3-5-10, file_search 1-3-6 by profile) and an approval slot for write tools. Files: `tools/dispatchingExecutor.ts`, `config/numbers.ts`. M. Pick: A with caps first.
- INJ-6: canary string in the system prompt, test that it never appears in output. S.

### INJ-7 - web fetch SSRF filter
- Exact change: resolve the host first and check every resolved address (IPv4 and IPv6, v4-mapped) against private, loopback, link-local, CGNAT and metadata ranges, strip IPv6 brackets before matching, connect to the checked address, follow redirects manually (re-check each hop before the request), stream with a hard byte cap, add `metadata.google.internal`. Files: `services/webFetch.ts`, `webFetch` tests. Option A (REWRITE) S-M. Option B: only fix the bracket bug and the redirect order: S, leaves DNS rebinding. Pick: A.

### SD-11, AB-1
- SD-11: red-team harness over HarmBench/JailbreakBench subsets (licence review), own Tanglish/Hinglish and code-mixed sets, thresholds fixed before launch; repo has two scenarios (`runReliabilityMatrix.ts`, `runBehaviorEvaluation.ts`). Option A NEW-BUILD M-L (Stage 21).
- AB-1: crisis rules detector + prompt block with India helplines (list per Stage 16 SAF-5), care reply, no block. Files: `services/safety/crisis.ts`, `systemPrompt.ts`. S-M. Note: the "no language detection / transliteration logic" rule (LANG-1) applies; the detector must be rule lists, not language logic.

## 5. Open questions for the owner

- Q-S1. ADR-0056 keeps e-mail/password beside Google sign-in; SD-1 (revised 2026-10-09, ADR-0010) removes passwords and makes sign-in invite-only. Which governs? Decides SD-1a, SD-1g, the `weak_password` / `password_incorrect` / `invalid_credentials` codes, account deletion by password (ADR-0040) and the Google-only deletion gap named in ADR-0056.
- Q-S2. Claude identity: ADR-0054 #6 uses an API key for the prototype (WIF in Phase 5); ADR-0012 (locked) has no key anywhere. Treated as DEFERRED (owner decision); confirm it stays out of the plan.
- Q-S3. M9 (SD-7) is a Gemini Flash-Lite call; ADR-0055 / B-4 say three models only. Same conflict class as the Haiku 5.5 router. Not resolved here.
- Q-S4. SameSite=None is a hosting consequence (web on Cloudflare, API on Cloud Run). Until web and API share a site, CSRF rests on the Origin check (SD-1f). Move to one site (DIFF-INFRA) before Phase 5?
- Q-S5. Session length: register N-49 user idle 24 h / absolute 28 d; repo 14 d absolute. Adopt N-49 as written?
- Q-S6. New dependencies: image re-encode (FL-3), ClamAV client, CSRF/helmet helpers need owner approval against the pinned-stack list (checkpoint 00-checkpoint-stage20.md, not re-read here).

## 6. KEEP spot-check

7 KEEP rows, 1 re-opened (>= 10 %), plus one extra:
- SD-1e1: `routes/auth.ts:36-43` sets `httpOnly: true`, `secure: cfg.SESSION_COOKIE_SECURE`, `signed: true`; `config.ts:431-433` refuses production boot without Secure - confirmed.
- SB-1: `docs/decisions/0007-sandbox-no-general-egress.md:52-68` states the deployed warm service has no NAT and a deny-all egress firewall and was probed live on 2026-09-25; the Cloud Run Job engine still has open egress and `SANDBOX_ENGINE=auto` could select it (`config.ts:242`) - confirmed as KEEP for the production engine, with that caveat (a deployment must set `SANDBOX_ENGINE=warm`).
- Not re-opened: SD-1h, SD-2a, PH-3, INJ-1, INJ-5.
