# Stage 6 prompt kit (68 cases)

`06-eval-cases-v1.json` is the Stage 6 eval case file, copied **byte for byte** (`cmp` clean).

| | |
|---|---|
| sha256 | `2bb6eae6c6ac919c8343ab90947e63d7deafba2abb80ad2be22a060fcaf2765c` |
| cases | 68 cases |
| ids | 68 unique ids |
| gates | C = 32 (critical), S = 34 (standard), O = 2 (observe only: LG1, LG2) |
| source | `arcnave-test-kit.zip` → `smoke-test/cases.json` |

The owner compared this hash with the Stage 6 master `06-eval-cases-v1.json`
(`Get-FileHash`, `D:\Architecture\Stage-06-…`, 2026-10-16): **identical**, so the zip's
`cases.json` and the master are the same file. If the master ever changes, replace this file with
the new bytes, update the hash here and in `kit.ts` (`KIT_SHA256`), and the tests will tell you
which cases moved. Verify:

```powershell
(Get-FileHash backend\evals\prompt-kit\06-eval-cases-v1.json -Algorithm SHA256).Hash.ToLower()
```

The zip itself is not committed. From it only the mock-tool names and the judge instruction were
read (re-written in TypeScript in `kit.ts`; none of the kit's Python is copied).

## Schema (read from the file, not assumed)

A JSON array of objects. Required: `id`, `rules` (policy rule ids, free text such as
`"ME-3 (long chat)"`), `gate` (`C` | `S` | `O`), `user`, `expect`, `fail_if`, `tools` (boolean:
whether the case runs with tools). Optional setup fields: `docs` (passages with id / source /
page / coverage / text), `history`, `long_chat`, `mem_records`, `company`, `project`, `formats`,
`web_search`, `memory`, `skill_loader` (`on`|`off`), `profile`, `pending`, `app_note`.

There is no tool-definition section and no judge section in the JSON. The kit's mock tools and
its judge instruction live in `smoke_test.py` in the zip; `kit.ts` carries the judge instruction
unchanged and maps the mock tools to ArcNave's deployed tools (`KIT_TOOL_TO_DEPLOYED`).
"C-gate" means a case with `gate: "C"`; it is the kit's critical gate (policy rules with priority C).

## Extra cases (owner request, outside the master)

`arcnave-extra-cases.json` holds three live-only, report-only cases. The master file above is not
edited. They have no C gate: `stop_then_greeting` gets a judge verdict ("Did the reply answer 'hai'
as a greeting without regenerating the earlier essay?"); `missing_topic_excel` and
`missing_topic_essay` are only labelled `asked` / `built` / `other`. `npm run eval:prompt -- --all`
runs them with the 68 and prints them in their own "extra" section; they are never in a C-gate or
mean figure. `stop_then_greeting` was observed live: Gemini 3.8 Flash continued the essay after Stop
and "hai". The offline proof that the stopped partial is in the next request's history is
`src/test/stopThenGreeting.integration.test.ts`.

## Files

- `kit.ts` – strict schema, case → deployed request, mock tool executor, judge helpers.
- `offlineGates.ts` – which cases are offline-checkable, their request-side requirements, and the
  recorded prompt gaps (`EXPECTED_GAPS`).
- `../../src/test/promptKit.test.ts` – the offline test (runs in `npx vitest run`, no provider).
- `../../scripts/evalPrompt.ts` – the live runner (`npm run eval:prompt`), owner-run, never in CI.

## What a case is run against

Since P07 (ADR-0075) the v3 prompt the kit was written for: each case is built on the rendering of
the model that answers it (`buildCaseRun(case, now, provider)`), with the session state, the
per-turn state and the profile's effort as a turn sends them. The tools are still the deployed set
(the stage names are mapped to them, `backend/src/services/prompt/toolNameMap.ts`). Where the
request cannot express what a case sets (company tier, per-format switch, pending operations,
document memory) the case runs with the nearest thing and the report lists the approximation
next to the result.
