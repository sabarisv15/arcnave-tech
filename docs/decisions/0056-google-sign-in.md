# ADR-0056: Google sign-in beside e-mail and password

- Status: accepted
- Date: 2026-10-14
- Task: tech-p1.B (build plan P1-B)
- Relates to: Stage 16 checkpoint SD-1 / SD-2 / SD-3, numbers register N-49, brand board
  `S3-SignIn-4` (button G1), [ADR-0040](0040-data-export-and-account-deletion.md).
- Numbering: ADR-0053's forward list named 0056 "typed errors kept"; the tech-p1 brief assigns
  0056 to Google sign-in, so the remaining forward ADRs take the next free numbers when written.

## Decision

1. **`POST /v1/auth/google {credential}`** takes a Google Identity Services ID token from the
   browser and verifies it with `google-auth-library`'s `OAuth2Client.verifyIdToken` against
   `GOOGLE_OAUTH_CLIENT_ID` (signature, issuer, expiry, audience). Unset client id → the route
   answers the typed `google_signin_disabled` (404). A bad token → `invalid_credentials`.
2. **Linking is by verified e-mail.** Only a token with `email_verified: true` links or creates;
   anything else is refused, so an unverified Google account cannot claim an existing address.
   An existing account (any sign-in method) gets a session; a new address gets a password-less
   account (`users.password_hash` is nullable, migration 0026) and its preferences row.
3. **Same session model** as `/auth/login`: the same server-side session row and signed cookie.
4. **`REGISTRATION_ENABLED=false`** blocks new Google accounts (`registration_closed`) and still
   signs existing ones in.
5. **A password-less account** answers `/auth/login` with `invalid_credentials` after the same
   dummy Argon2 work as an unknown address, so the endpoint reveals nothing about how an address
   signs in. Change-password answers `invalid_credentials` too.
6. **The verifier is a container seam** (`BuildOptions.googleVerifier`); tests use a fake and
   never call Google.
7. **Frontend:** `GoogleSignInButton` loads the official script
   (`https://accounts.google.com/gsi/client`) once, renders Google's own button and lays it,
   transparent, over the locked G1 face (Google Neutral theme, 48 px, 12 px corners; dark
   variant from `S3-SignIn-4-Dark`). The click, popup and token are Google's. With no
   `VITE_GOOGLE_OAUTH_CLIENT_ID` the button is not rendered.

## Differences from Stage 16 (recorded, deliberate for the prototype)

| Stage 16 | Here | Why / when |
|---|---|---|
| SD-2: account key = Google `sub` | key = verified e-mail | the brief's rule; one user, and the repo's accounts are keyed by e-mail. A `google_sub` column and sub-first matching are Phase 5 (tenancy) work. |
| SD-1: CSRF check on the Google ID-token POST | popup mode + JSON body + CORS allow-list | the double-submit `g_csrf_token` cookie exists only in GIS redirect mode; a cross-site page cannot send this JSON body without passing CORS. Revisit with the same-origin API (Phase 5). |
| SD-3: reCAPTCHA on Google sign-in | none | Phase 5 security task. |
| SD-1 revised: no passwords at all | passwords stay | build plan: Google sign-in **beside** e-mail/password. |

## Known gap

Account deletion (ADR-0040) asks for the account password. A Google-only account has none, so
it cannot delete itself from Settings yet. Follow-up: confirm deletion with a fresh Google
sign-in (or an e-mail code) for password-less accounts.

## Owner to-do (cannot be done from code)

In Google Cloud Console → APIs & Services → Credentials: create an **OAuth client ID** of type
**Web application**; add **Authorised JavaScript origins** for every origin that shows the
sign-in page (e.g. `http://localhost:5173`, `http://127.0.0.1:5173`, the production frontend
origin); no redirect URI is needed (popup mode). Configure the OAuth consent screen (app name,
support e-mail, `email` / `profile` / `openid` scopes). Put the client id in
`backend/.env` as `GOOGLE_OAUTH_CLIENT_ID` and in the frontend build env as
`VITE_GOOGLE_OAUTH_CLIENT_ID` (the same value; it is not a secret).
