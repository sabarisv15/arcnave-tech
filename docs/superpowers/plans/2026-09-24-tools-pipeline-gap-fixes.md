# Tools pipeline gap fixes — plan

**Goal:** Bring the running pipeline in line with the locked architecture: the router checks
permission only, the model decides what to do, files reach the model and the sandbox intact,
exact document work has a real extraction capability, and QA reports only what it actually
checked. Gap IDs (G1–G26) refer to
[`docs/tools-skills-architecture.md`](../../tools-skills-architecture.md).

**Revision 2 (2026-09-24), after review:** G21 decided (Option A, no general sandbox
internet, see ADR-0007). The acceptance test moves to after Phase 3, because routing and
attachment fixes alone give the model no way to extract rows from a scanned PDF. G15 becomes
on-demand rehydration rather than upload-time extraction. The `att.name`/`filename` bug is now
its own gap (G26). G20 becomes a permission split inside the existing runtime, not a new
job. G14 keeps QA layers separate. G24's first script is generic, not bank-specific.

**Acceptance test (after Phase 3):** a scanned PDF bank statement plus "Count every transaction
exactly and classify them". The model loads the `pdf` skill and follows its exact/exhaustive
rules. It discovers the table-extraction capability through `search_tools`, gets structured
rows, counts them deterministically, reconciles, and answers. A follow-up turn about the same
PDF works the same way. The bank statement is one use case of a generic capability, not a
special path.

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

## Phase 0: Architecture tests, ADR, baseline ✅

- ADR-0006 "TurnRouter is a policy boundary only".
- `turnRouter.locked.test.ts`, with the G1/G2 cases marked `it.fails`.
- Full-suite baseline on 2026-09-24: 70 files, 691 passed, 4 expected fail.
- Production `ENABLE_*` flags: useful for deployment verification, **not a blocker** for fixing
  the proven architecture bug. Check before the first deployment.

## Phase 1: Model authority (G1, G2, G3, G7 + truthful capability prompt)

Target shape:

```
TurnRouter → policy only
Initial core tools: search_tools, load_skill (when skills are enabled)
Allowed catalog: run_python if the feature and security allow it, render_ui if enabled,
                 file tools if permitted, the other deferred tools
MODEL → understands the request → decides: direct answer / skill / tool
```

| Gap | Change | Proof |
|---|---|---|
| G1 | `exposedTools` is always `search_tools` + `load_skill` (when skills exist), on every intent. Intent stays in `detectedIntent` as telemetry | Phase 0 `it.fails` cases pass and become plain `it` |
| G2 | `run_python` is in the catalog when `ENABLE_RUN_PYTHON` and a sandbox client exist, whatever the prompt says. `evaluateRunPythonPolicy` becomes telemetry | Locked test: PDF + bank prompt → `run_python` allowed; sandbox off → not allowed |
| G3 | `render_ui` goes into `allowedTools` when `ENABLE_GENERATIVE_UI` | Router test |
| G7 | `<available_skills>` is written into the prompt only when `load_skill` is actually in the request's tools | Generation test |
| Truthful capability prompt | The base prompt states the real contract: core tools are always there, other tools are found with `search_tools`, and answering directly is correct when that is enough | Prompt test: no capability named in the prompt that the request cannot reach |

Risk: more tool calls on trivial turns. Measure with `runBehaviorEvaluation.ts` before and
after (spends quota, so it needs the user's approval).

## Phase 2: Attachment continuity (G6, G15, G26, G16, G17, G18)

| Gap | Change | Proof |
|---|---|---|
| G26 | One internal `AttachmentRef { id, filename, mimeType, sizeBytes, storageKey }`, normalised once at the attachment boundary. Drop `name` from `AttachmentBlock`. Every consumer (materialisation in `generation.ts` and `agentLoop.ts`, executors, adapters) reads `filename` | Test: an attachment built by `routes/chats.ts` lands in the workspace `input/` |
| G6 | "Has attachments" means any ready attachment in the chat, not just this message | Integration test: turn 2 about a turn-1 file has `read_uploaded_file` in the catalog |
| G15 | A historical attachment over the auto-hydration budget is **never** sent as an empty PDF block. It keeps its `AttachmentRef` (plus `extractedText` only if that text genuinely exists) and appears in the manifest. When the model or the user needs it, the exact `fileId` is rehydrated from object storage on demand (`read_uploaded_file`, workspace materialisation). `extractedText` is a fallback, never a replacement for rehydration. No bulk backfill of historical PDFs | Adapter test: an out-of-budget PDF produces a reference naming its fileId, never an empty block; rehydration test fetches the exact bytes |
| G16 | Office text is sent once: the document block stays, the `attachmentText` append to the prompt and to history turn text goes | Adapter probe: marker count 1 on both providers |
| G17 | No raw-binary fallback. An Office file without extracted text becomes an explicit "could not be read: <reason>" note | Adapter tests on both providers |
| G18 | Check PDF page count and image size at upload; reject with typed `ApiError` codes shown by the frontend | Route integration tests + `npm run openapi` + frontend test |

## Phase 3: Exact document intelligence + QA (scanned-table extraction, PDF skill rules, G14, G13) ✅ locally, ❌ live acceptance (see [phase 3 live failure](../../checkpoints/2026-09-24-phase3-live-failure.md))

**Done 2026-09-24, local only.** Decision taken at the start of the phase: vision first, called
from the backend; deterministic work in skill scripts; no offline OCR engine added (it stays a
possible later fallback or second signal). Delivered:

- G20 permission split: `ENABLE_TRUSTED_CLI`, `ENABLE_SKILL_SCRIPTS` beside `ENABLE_RUN_PYTHON`;
  the runtime enforces each grant, and the sandbox client is built when any is on.
- `extract_scanned_table_rows` (pdftoppm per page in the sandbox → one backend vision call per
  page → pass 2 re-reads low-confidence rows from a 300 dpi crop → `normalize_table_rows.py`),
  results stored under an `extractionId`; re-extracting pages re-renders them at 300 dpi.
- `analyze_table_rows` (`analyze_table_rows.py`): `count`, `sum`, `running_balance`, with
  `expected` → pass/fail and `suspiciousPages` for repair.
- PDF skill section 3B: exact/exhaustive rules. G14 and G13 as below.
- Acceptance: `routes/tableExtraction.integration.test.ts` runs the natural prompt on a
  scanned fixture with the real router, tools, pdftoppm and scripts; only the model and the
  vision replies are faked. The real `kvbfedral.pdf` against the live vision model has not run:
  that needs the file and approval to spend quota.

**Generic scanned-table extraction.** One capability, not a bank-statement path:

```
PDF / page images
→ render pages (pdftoppm, trusted CLI in the sandbox)
→ table extraction per page
→ rows: { page, rowIndex, cells, confidence, sourceRegion }
→ deterministic post-processing: normalise, dedupe across page breaks, count, sum
→ reconciliation where the document carries its own totals (page or closing balances)
```

**Design constraint from ADR-0007:** the sandbox has no general internet, so a vision-model
call cannot run inside it. The recommendation, to confirm when the phase starts:

- The sandbox renders the pages.
- A trusted Node handler sends the page images to the vision provider with a strict row schema.
  Low-confidence rows are flagged, never silently dropped.
- The deterministic parts (normalise, count, sum, reconcile) run as the first real skill script
  (G24): `extract_scanned_table_rows` post-processing, generic, in the sandbox with no network.
- The alternative is offline OCR baked into the image (for example Tesseract). It is fully
  deterministic but weaker on tables. Decide with a measured comparison, not by preference.

**PDF skill.** Add exact/exhaustive rules. A summary may use native vision. Counting, totals
or "every row" requires structured extraction plus deterministic counting and reconciliation,
and the answer reports confidence and any unreconciled difference.

| Gap | Change | Proof |
|---|---|---|
| G14 | QA layers stay separate: `structural` and `semantic` report their own results, and `visual` is `passed` / `failed` / `not_checked`. When no vision provider exists, visual is `not_checked`; the structural result is not changed. `overall` depends on whether the task required visual verification: required + `not_checked` → the result cannot be claimed VERIFIED. Wire the vision provider in so `not_checked` is the exception | QA tests for each combination; a structurally valid file never reports a structural failure because visual was skipped |
| G13 | `stop_reason: "refusal"` becomes a typed stream event with its category, shown to the user | Adapter-loop test with a faked refusal |

**Acceptance test runs here**: locally, against fixture PDFs (a digital one and a scanned
one). Live verification needs approval.

## Phase 4: Architecture unification (G4, G5, G8)

| Gap | Change | Proof |
|---|---|---|
| G4 | One `resolveTurnPolicy()` used by both the chat path and AgentLoop | Parity test in `architectureParity.test.ts`: same input → same catalog |
| G5 | Agent-loop routing lives in one function; the duplicate `isAgentMode` goes | Unit test |
| G8 | Remove the dead `selectedSkills` preload; autoload follows each skill's `autoload` frontmatter instead of a hard-coded name | Skills tests |

## Phase 5: Agent loop / performance (G9, G10, G11, G12). ADR-0016 first (ADR-0008 went to trusted work; 0009 and 0010 to background runs and the warm sandbox; 0011 to upload rules; 0012 to retention; 0013 to PDF pages; 0014 to sandbox resources per chat; 0015 to sandbox checkpoints)

- **G9:** Claude models use Claude's native tool search (`defer_loading`), which Vertex
  supports. Gemini keeps `search_tools`. Verify `cache_read_input_tokens` locally (needs approval).
- **G10:** Allow parallel tool calls. Execute them concurrently and return all results in one
  message.
- **G11:** Set `TOOL_MAX_ROUNDS` from measurements on the acceptance test after G10.
- **G12:** Retry transient failures (network, 5xx, timeout) once via a `retryable` flag; keep
  blocking identical retries only for deterministic failures.

## Phase 6: Execution runtime hardening (G19–G25)

| Gap | Change | Proof |
|---|---|---|
| G21 | **Decided: Option A** (ADR-0007). The sandbox gets no general outbound internet. Packages come only from the image, and web access goes through the controlled web tools. Implement with a VPC connector plus a deny-all egress firewall, keeping only the Google APIs the job needs (staging bucket, logging) through Private Google Access | Infra change (needs approval) + a live probe that an outbound HTTP call from the job fails |
| G20 | A permission model inside the existing `ExecutionRuntime`: `pythonAllowed`, `trustedCliAllowed`, `skillScriptAllowed`, as separate flags. The same isolated sandbox runs `soffice`/`pdftoppm` without arbitrary Python being enabled. The sandbox client is built when any of them is on. Only if isolation or resource needs genuinely demand it does a second job get built | Config test: `ENABLE_RUN_PYTHON=false` + trusted CLI on → rendering works, `run_python` is not in the catalog |
| G19 | Visual QA stages the file under `input/` and declares the PDF as an expected output, so the job returns it through the staging bucket | Unit test with a faked Cloud Run client, then a local run against the real job (approval) |
| G22 | Missing staging, oversized input and failed signed URLs become typed errors in the tool result | Client unit tests |
| G23 | Size the job for LibreOffice and extraction (CPU, memory, timeout); align the CLI bridge timeout | Local timing on real files |
| G24 | First real skill script: generic `extract_scanned_table_rows` post-processing (Phase 3), wired through `executeTrustedSkillScript` | Skills + runtime tests |
| G25 | Docker branch passes args as an argv array, with no `sh -c` string | Unit test with a newline in an arg |

G24 is delivered in Phase 3 and listed here for completeness.

## Order and sizing

| Phase | Size | Depends on |
|---|---|---|
| 0 ✅ | small | — |
| 1 | small | 0 |
| 2 | medium | 1 (G6 uses the router input) |
| 3 | medium–large | 2 (extraction needs files in the sandbox), G20's trusted-CLI split for rendering |
| 4 | medium | 1 |
| 5 | large | 4, ADR-0016 |
| 6 | medium–large | ADR-0007 (done) |

Phase 3 needs the trusted-CLI permission from G20 to render pages without enabling arbitrary
Python. Pull that single item forward into Phase 3; the rest of Phase 6 stays where it is.
