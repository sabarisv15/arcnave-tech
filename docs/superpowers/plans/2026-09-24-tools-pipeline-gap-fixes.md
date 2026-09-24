# Tools pipeline gap fixes — plan

**Goal:** Bring the running pipeline in line with the locked architecture: the router checks
permission only, the model decides what to do, files reach the model intact, and QA reports only
what it actually checked. Gap IDs (G1–G18) refer to
[`docs/tools-skills-architecture.md`](../../tools-skills-architecture.md).

**Acceptance test for the whole plan:** a PDF bank statement plus "Count every transaction exactly
and classify them". The model loads the `pdf` skill, discovers an extraction tool or `run_python`
via `search_tools`, produces structured rows, counts them deterministically, and answers. The same
works on a follow-up turn about that same PDF.

## Ground rules (from CLAUDE.md, applied to every phase)

- One phase = one PR. Nothing merges until `npx tsc --noEmit` and `npx vitest run` are clean
  in `backend/`, and `npm run build` + `npm test` in `arcnave-frontend/` when it is touched.
- Tests never reach a provider. Live evaluation scripts (`src/scripts/run*Evaluation.ts`) spend
  Vertex quota, so run them only when the user approves.
- Local first. No deployment without the user's explicit approval in that task, then a
  separate live check.
- Any route schema change → `npm run openapi` and commit `docs/openapi.json`.
- A new client-visible failure is an `ApiError` with a stable `code`, and the frontend handles
  that `code`.
- Update `docs/tools-skills-architecture.md` (mark gaps fixed), `docs/checkpoints/CURRENT.md`
  and `mistakes.md` in the same PR.

## Phase 0: Record the decision (no behaviour change)

1. Write **ADR-0006 "TurnRouter is a policy boundary only"**. It records the locked architecture:
   the router returns what is *allowed* (flags, permissions, sandbox present, project present),
   never what is *needed*. Intent detection stays, as telemetry only.
2. Add a regression test file `turnRouter.locked.test.ts` with the traced cases (bank prompt,
   "Summarize this PDF", "hi"), marked `it.fails` until Phase 1 lands, so the fix is proven by
   the tests flipping.
3. Before planning Phase 1 rollout, check which `ENABLE_*` flags production actually has set
   (`ENABLE_TOOL_USE`, `ENABLE_RUN_PYTHON` and `ENABLE_SKILLS` in particular). Read them; don't assume.

## Phase 1: Unblock the model (G1, G2, G3, G7) — the bank-statement blocker

| Gap | Change | Proof |
|---|---|---|
| G1 | `exposedTools` is always `search_tools` + `load_skill` (when skills exist), on every intent | Phase 0 tests flip to passing |
| G7 | Follows from G1: the skills list in the prompt now always has `load_skill` behind it | Test: whenever `<available_skills>` is in the system prompt, `load_skill` is in `tools` |
| G2 | `run_python` is in the catalog when `ENABLE_RUN_PYTHON` and a sandbox exist, whatever the prompt says. `evaluateRunPythonPolicy` becomes telemetry | Router test: PDF + bank prompt → `run_python` in `allowedTools` |
| G3 | `render_ui` goes into `allowedTools` when `ENABLE_GENERATIVE_UI` | Router test |

**Risk:** the model may now call tools on simple turns ("hi"), adding latency. Mitigation: one
line in the base system prompt: answer directly when that is enough, and use tools only when
the task needs them. Measure with `runBehaviorEvaluation.ts` before and after (needs approval).

## Phase 2: Files reach the model intact (G6, G15, G16, G17, G18)

| Gap | Change | Proof |
|---|---|---|
| G6 | "Has attachments" means any ready attachment in the chat, not just this message | Integration test: turn 2 about a turn-1 file has `read_uploaded_file` in the catalog |
| G15 | Extract PDF text at upload too (kept as a fallback, the model still gets native PDF when it fits). When bytes are left out, send the extracted text plus an explicit note: "`bank.pdf` not attached this turn (history size limit); call `read_uploaded_file` with fileId X" | Adapter test: out-of-budget PDF produces non-empty content that names the fileId |
| G16 | Send Office text once: drop the `attachmentText` append to the prompt and keep the document block. Same for history turns | Adapter probe: marker count 1 on both providers |
| G17 | No raw-binary fallback. Office file without extracted text becomes an explicit "could not be read: <reason>" note | Adapter test on both providers |
| G18 | Check PDF page count and image size at upload; reject with typed `ApiError` codes, and have the frontend show them | Route integration tests + `npm run openapi` + frontend test |

Existing uploaded PDFs have no extracted text. Add a one-off backfill script, run locally
first; running it against production is a deployment and needs approval.

## Phase 3: Honest reporting (G13, G14)

| Gap | Change | Proof |
|---|---|---|
| G13 | Handle `stop_reason: "refusal"` from Claude: a typed stream event / `ApiError` with the category, shown to the user | Adapter-loop test with a faked refusal stream |
| G14 | Pass the vision provider into visual QA. When none is available, report `visual: not_checked`, never `passed` | QA test: no vision provider → not passed; faked provider → its verdict is used |

## Phase 4: One gate, one route (G4, G5, G8)

| Gap | Change | Proof |
|---|---|---|
| G4 | One `resolveTurnPolicy()` used by both the chat path and AgentLoop | Parity test: same input → same catalog on both paths (extends `architectureParity.test.ts`) |
| G5 | Agent-loop routing lives in one function; the duplicate `isAgentMode` goes | Unit test on that function |
| G8 | Remove the dead `selectedSkills` preload, and replace the hard-coded autoload name with the skill's `autoload` frontmatter | Skills tests |

## Phase 5: Loop efficiency (G9, G10, G11, G12). Needs ADR-0007 first

Larger changes, each with its own design note inside ADR-0007:

- **G9:** Claude models use Claude's native tool search (`defer_loading`), which is available
  on Vertex per the platform table. Gemini keeps `search_tools`. Verify cache reads with
  `usage.cache_read_input_tokens` locally.
- **G10:** Allow parallel tool calls. Execute them concurrently and return all results in one
  message.
- **G11:** Revisit `TOOL_MAX_ROUNDS` after G10, measured on the acceptance test.
- **G12:** Retry transient failures (network, 5xx, timeout) once; keep blocking identical
  retries only for deterministic failures.

## Order and sizing

| Phase | Size | Depends on |
|---|---|---|
| 0 | small | nothing |
| 1 | small (2 files + tests) | 0 |
| 2 | medium (routes, adapters, upload, frontend, backfill) | 1 for G6 |
| 3 | small–medium | nothing |
| 4 | medium | 1 |
| 5 | large | 4, ADR-0007 |

After Phases 0–2 the acceptance test should pass locally. Phases 3–5 make it honest and efficient.
