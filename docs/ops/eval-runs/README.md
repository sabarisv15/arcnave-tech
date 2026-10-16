# eval-runs

Commit-able results of the owner-run prompt evaluation (`npm run eval:prompt`, tech-p03). One file
per run: `<UTC date>-<models>-<prompt12>.md`, where `prompt12` is the first 12 hex of the sha256 of
the assembled static system prompt. A file holds case ids, judge verdicts, scores, provider-reported
tokens, `costUsd` (`null` where no verified price exists), latencies, finish codes and error codes.
It never holds model text, a judge's reason or a prompt. Full answers go to `backend/eval-out/`
(gitignored, stays on your machine).

`prompt12` and the tools stamp are computed from the tools-on request of case T1 (every kit tool on); the tools-off cases send a different, shorter prefix under the same stamp. Two files with the same `prompt12` were produced by the same prompt and tool declarations, so they
are comparable. A different `prompt12` means the prompt changed (that is what P07 will do).

## How to run (PowerShell, from `backend/`)

The script spends real provider quota. It refuses unless `LIVE=1`, prints what it will do, and asks
you to type `yes` (or pass `--yes`). It is never run by tests or CI. Provider settings come from
`backend/.env` (`GOOGLE_CLOUD_PROJECT`, `ANTHROPIC_API_KEY`, `MODEL_*`) as for `npm run dev`; a model
that is not configured is reported as `error:model_unavailable` for every case, never swapped.

```powershell
# Quick check first: two cases, one model (a handful of calls)
$env:LIVE="1"; npm run eval:prompt -- --models gemini-flash --runs 1 --cases S1,T3

# The full kit, three runs, one model
$env:LIVE="1"; npm run eval:prompt -- --models gemini-flash --runs 3 --all --yes

# All three models (68 kit cases + 3 extra cases per run)
$env:LIVE="1"; npm run eval:prompt -- --models gemini-flash,claude-sonnet,claude-opus --runs 3 --all --yes

# Choose the judges (always the other vendor; defaults shown)
$env:EVAL_JUDGE_FOR_CLAUDE="gemini-flash"; $env:EVAL_JUDGE_FOR_GEMINI="claude-sonnet"
```

Flags: `--models a,b` (required: `gemini-flash`, `claude-sonnet`, `claude-opus`), `--runs N` (default 1),
`--all` or `--cases id,id` (one of them), `--yes`, `--concurrency N` (1-8, default 3).
`--all` includes the three owner-added extra cases; they are shown apart and are not in any figure.

## What the numbers mean

- **C-gate pass** is the share of critical (gate C) kit cases the judge passed. **Judge verdicts are
  report-only**: no judge is calibrated against human grades yet, so nothing is gated on them.
- **mean judge** is the mean of pass (1) / fail (0) over judged records; **variance across runs** is the
  mean per-case variance of that score (n/a with one run).
- **tokens in/out/cached** are the provider's own; `exact:false` means the provider returned no count (any zeros then are
  absence, not usage). **costUsd** is `null` when there is no verified price.
- A case that errors is `error:<code>` (`rate_limited` for a 429) and the run continues; nothing is retried.

## Provider conformance (dev-run only)

```powershell
$env:LIVE="1"; npm run conformance:live -- --yes            # both providers, about 6 requests each
$env:LIVE="1"; npm run conformance:live -- --providers gemini --yes
```

Prints a pass / fail / skip table: streaming text, tool call round trip, exact usage metadata, thinking
replay, history replay, typed error on a bad model id. No model text is printed.
