---
name: python-sandbox-patterns
version: 2.0.0
description: How ArcNave's run_python sandbox behaves (files, outputs, limits) and how to write code for it. Applied automatically whenever run_python is available.
category: internal
requires:
  tools:
    - run_python
autoload: true
metadata:
  source: arcnave
---

# Python Sandbox Patterns

Applied automatically when `run_python` is available. The `run_python` tool description is
authoritative for this chat; where it differs from this skill, follow it.

## Where things are

- `input/`: every file of the conversation, at the `run_python path` printed on its attachment
  line. Open it there; nothing needs uploading.
- `output/`: files for the user. Save deliverables (spreadsheets, charts, reports) here. If the
  tool description asks for `expected_outputs`, list each filename there.
- `view/`: images for you. Save a PNG/JPEG there to look at it (a chart you made, a rendered
  page or a cropped region).
- `/skills/<name>/`: the skills' own files, read-only, when the skills list says the sandbox
  has them.

## Persistence

On this chat's sandbox computer, **files persist between calls; Python variables do not**.
Parse a file once, save the result (`rows.json`, `.parquet`), and reuse it next call. If the
tool description says each call starts fresh, write everything a later call needs into the
same call's output instead.

## Limits

- No network and no `pip install`. Use the pre-installed libraries the tool description lists.
- stdout/stderr are truncated when large: print counts, totals and a few examples, not whole
  tables. Write full results to a file.
- Memory per run is bounded; a run over it stops with `MemoryError`. Process large data in
  chunks or with iterators.
- A call has a time limit. Avoid unbounded loops; batch work into a few calls.

## Patterns

- End with a short, parseable summary:
  ```python
  import json
  print(json.dumps({"rows": len(df), "total": float(df.amount.sum())}))
  ```
- Catch and report errors with context (which file, which row) rather than letting a
  traceback be the only output.
