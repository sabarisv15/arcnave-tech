# tech-p0 – Phase 0: base adoption – RESULT (2026-10-14)

_Executed in the Claude cloud session itself (before the prompt-only rule was set); from Phase 1 the owner runs prompts in Claude Code._

## Branch / PR
- Branch `phase0/base-adoption` on `sabarisv15/arcnave-tech`, from `main` 882e8de (28 Sep).
- PR #39 https://github.com/sabarisv15/arcnave-tech/pull/39 — owner merges; merge = Cloud Build deploy.

## Commit 1 – `8622146` chore: local work 29 Sep – 6 Oct
- The uncommitted work in `D:\arcnave-tech-main\arcnave-tech-main` (folder had no `.git`): 55 files, sha256-verified against the local folder.
- New: migration `0024_memory_settings.sql` + snapshot, `memorySettings.integration.test.ts`, `toolLimit.integration.test.ts`, `memoryFiles.test.ts`, ADR-0052, audits `2026-09-28-fable-audit-recheck.md`, `2026-09-29-arcnave-vs-fable-5.1-line-by-line.html`.
- Changed (47): schema, providers (anthropicVertex, gemini + adapter-loop tests), generation, memory service/policy/privacy/executor, systemPrompt, promptAssembly, turnRouter, tools (definitions, displayDefinitions, registry, webExecutor), routes (chats, preferences), skills (docx, pdf-reading), frontend (Auth, Landing, Settings, api, types, workspace, prerender), docs (CURRENT, ADR-0025/0032/0047/0049, direct-upload, openapi), mistakes.md, .claude/launch.json.
- Excluded: `.env`, `backend/.env`, `.env.compose-adc.yaml`, `tsconfig.tsbuildinfo`, `backend/Python/` (portable Python, untracked).

## Commit 2 – `5c32f78` chore(phase0): CI, ADR-0053, CLAUDE.md rules, architecture mirror
- `.github/workflows/ci.yml`: jobs `backend` (Node 22, postgres:16 service, poppler-utils + python3, `tsc --noEmit`, `vitest run`; `TEST_DATABASE_URL` per harness default) and `frontend` (`tsc -b`, `vite build`, `vitest run`; prerender skipped – needs a browser). Triggers: `pull_request`, `push` on non-main branches. Concurrency per ref.
- `docs/decisions/0053-prototype-base-and-target-spec.md`: decisions B-1…B-11 (base, target spec, single user, 3 models, Claude first-party, switch dropped, Phase-5 items, workflow, branch-only, phase order, local-stable gate) + follow-up ADR list 0054–0060.
- `CLAUDE.md`: section "Build rules on this base (ADR-0053)"; test-count line updated (906, was 167).
- `docs/architecture/`: read-only mirror (plan, numbers/LV-1/cost registers, Stage 1–3 + 5 docs, checkpoints 4, 6–21) + README. Scanned: no project ids, e-mails or keys.
- `docs/checkpoints/CURRENT.md`: 2026-10-14 Phase 0 block.

## Not done here
- Typecheck/tests not run (npm registry unreachable in the session; no TS changed). Item 0 of tech-p1 verifies.
- P0-4 numbers wiring → merged into tech-p1 Item A.

## Owner to-dos
1. Read CI on PR #39 (Actions tab).
2. Branch protection on `main`: require `backend` + `frontend`, PR only.
3. Decide merge (deploy) or pause the trigger.
4. Local pull: `git init` → `git remote add origin …` → `git fetch origin` → `git checkout -B phase0/base-adoption origin/phase0/base-adoption` in `D:\arcnave-tech-main\arcnave-tech-main`; `git status` should show only `.env` files untracked.
