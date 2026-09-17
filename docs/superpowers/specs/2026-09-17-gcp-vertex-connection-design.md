# Connect ArcNave to Vertex AI — design

**Date:** 2026-09-17
**Scope:** Vertex AI model access only. No GCS, no Docker, no Cloud Run, no Cloud SQL.

## Problem

The backend was built to call Vertex AI and has never called it. Three separate gaps sit
between the current code and a real model call.

1. **No project.** `GOOGLE_CLOUD_PROJECT` is unset, so `config.vertexConfigured` is `false`
   and every alias reports `vertex_not_configured` without attempting a call.
2. **No env file is ever read.** There is no `dotenv` dependency and no `--env-file` flag on
   any npm script. Writing a `.env` today would change nothing — the values would never
   reach `process.env`.
3. **`gpt-oss-120b-maas` is not served at `global`.** `gptOssVertex.ts` derives its endpoint
   from `cfg.VERTEX_LOCATION`, which must stay `global` because that is the only endpoint
   type serving Opus 5 and Sonnet 5 (ADR: `docs/decisions`, and `config.ts:72`). So the
   fourth alias can never resolve as the code stands.

## Verified facts

Checked against the live Vertex API on 2026-09-17 with ADC for `arcnave15@gmail.com`.

| Fact | Result |
| --- | --- |
| `project-8bcf740a-a7bd-4aea-974` billing | enabled (`billingAccounts/01ED49-7B5A6A-799AFB`) |
| `aiplatform.googleapis.com` | already enabled on that project |
| ADC `quota_project_id` | already `project-8bcf740a-a7bd-4aea-974` |
| `claude-opus-5` @ `global` | exists |
| `claude-sonnet-5` @ `global` | exists |
| `gemini-3.8-flash` @ `global` | exists |
| `openai/gpt-oss-120b-maas` @ `global` | **404 not found** |
| `openai/gpt-oss-120b-maas` @ `us-central1` | exists |

The other two projects on the account (`gen-lang-client-0840409690`,
`project-6a5a004b-62ee-4741-848`) have billing disabled and cannot serve Vertex.

**A listing proves existence, not entitlement.** The Anthropic publisher models advertise a
`requestAccess` action, meaning Model Garden terms must be accepted before the project may
call them. That acceptance is a console click the user must perform; it cannot be automated
here. If a call returns a permission error, surface the console URL and stop.

## Changes

### 1. Env file loading

Add `--env-file-if-exists=.env` to the `dev` and `start` scripts in `backend/package.json`.

Node 22 native, so no new dependency. The `-if-exists` variant rather than `--env-file`
deliberately: `config.ts` is written so a dev machine boots with zero configuration, and
plain `--env-file` aborts startup when the file is absent, which would destroy that
property for anyone who clones the repo.

### 2. Per-provider location for gpt-oss

Mirror the override that `GEMINI_LOCATION` already establishes, rather than inventing a new
mechanism:

- `config.ts` — add `GPT_OSS_LOCATION: optionalStr` beside `GEMINI_LOCATION`, and the
  derived `gptOssLocation: env.GPT_OSS_LOCATION ?? env.VERTEX_LOCATION` on `Config`.
- `gptOssVertex.ts:75` and `:101` — read `cfg.gptOssLocation`.
- `registry.ts:92` — the `GPT-OSS 120B` row's `location` reads `cfg.gptOssLocation`.

Three call sites and one knob. `VERTEX_LOCATION` stays `global` and the Anthropic adapters
are untouched.

The alternative — dropping the alias as permanently unavailable — was rejected by the user.

### 3. Environment values

- `backend/.env.example` — committed, names with empty values.
- `backend/.env` — real values, already covered by `.gitignore`.

No credential material is written to either file. Authentication is Application Default
Credentials, which already exist on this machine.

```
GOOGLE_CLOUD_PROJECT=project-8bcf740a-a7bd-4aea-974
VERTEX_LOCATION=global
GPT_OSS_LOCATION=us-central1
MODEL_OPUS=claude-opus-5
MODEL_SONNET=claude-sonnet-5
MODEL_GEMINI_FLASH=gemini-3.8-flash
MODEL_GPT_OSS=openai/gpt-oss-120b-maas
```

Grounding flags stay `false`. Turning them on is a behaviour change with its own
verification story and is out of scope here.

## Verification

Static checks must pass unchanged: `npx tsc --noEmit` clean, `npx vitest run` at 63 passing.
No test may reach a provider, so the existing suite must stay provider-free — the new config
field must not make any test hit the network.

Then, against the running server with a real account:

1. `GET /models` — all four aliases report available, none `vertex_not_configured`.
2. One real streaming generation per alias, recording for each: whether tokens streamed,
   the reported usage, and any error code.
3. Regression on the 2026-09-16 stuck-status bug: a failing generation must leave the
   assistant row `error`, not `generating`.

Report what actually happened per model, including failures. The checkpoint's claim that no
model call has ever been made is what this pass exists to end; replacing it with an
unverified claim of success would be worse than the current honest gap.

Cost: a few streaming calls at small `max_tokens`, well under one cent, billed to
`01ED49-7B5A6A-799AFB`.

## Out of scope

GCS storage backend, Docker, Cloud Run, Cloud SQL, workload identity, frontend rewiring,
grounding enablement. `STORAGE_BACKEND` stays `local`.

## Follow-on

`docs/checkpoints/CURRENT.md` lists "Blocked on the user: `GOOGLE_CLOUD_PROJECT` and region"
and states no model call has ever been made. Both statements become false when this lands
and must be rewritten in the same change.
