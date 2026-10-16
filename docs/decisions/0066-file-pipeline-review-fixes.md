# ADR-0066: File pipeline — fixes from the independent review of tech-build.1 / tech-build.2

- Status: accepted (task tech-build.3 Part D, 2026-10-16). Tested by automated gates (typecheck,
  the part's test files and the file-pipeline suites); not deployed. The owner verifies live after
  merging (`docs/ops/build-3-live-checklist.md`, Part D).
- Date: 2026-10-16
- Task: tech-build.3 Part D — the review's findings M1, M2, M3, N1, N3, N4, N5 and carry-overs D0a–c.
- Yardstick: [ADR-0061](0061-locked-decisions-win-outside-stack-and-infra.md). Locked Stage 9
  outcomes are unchanged; this ADR changes how they are enforced.
- Supersedes in part:
  - [ADR-0062](0062-file-pipeline-jobs-isolation-zip.md) Part B §6 "Pre-flight … from the central
    directory, no inflate … an XML part whose first 4 KB declares `<!DOCTYPE` / `<!ENTITY`" (Decision 2).
  - [ADR-0063](0063-files-ingest-and-automated-gates.md) Decision 7 "Generation + checksum at
    `complete`" (Decision 4).
  Both are not edited beyond their status lines.

## Claude

- **What Claude publishes about uploads:** 500 MB per file and 20 files per chat, 30 MB per
  project file, PDFs up to 1,000 pages, and "Claude extracts text only from these files" for
  non-PDF documents ([Upload files to Claude][claude-upload], fetched 2026-10-16).
- **What it does not publish:** how the Claude app processes an upload after the bytes arrive —
  temporary storage, how its parsers are isolated, archive or XML hardening, how it treats a
  password-protected file, checksums, or how many large files one server reads at once. A search
  of support.claude.com on 2026-10-16 found no article on password-protected files.
- So nothing below is "Claude does X". Every rule is a locked stage outcome (Stage 9 ISOLATION /
  G4–G6, INTAKE, PIPE; Stage 1 FT-11, FT-12) enforced more strictly, or is marked **ours**.

## ArcNave before this ADR (reproduced from the code, 2026-10-16)

| Finding | Where (at 583d449) | Reproduced |
|---|---|---|
| M2: ffmpeg/ffprobe/poppler inherit the API's environment, no `-nostdin`, no protocol whitelist | `audio.ts:48`, `:75`; `pipeline.ts` `run('pdfinfo'…)`; `ocr.ts` `pdftoppm`; `pdfPages.ts`; `routes/files.ts:687` — `promisify(execFile)` with no `env` | `untrustedTools.test.ts` asserts `env` is set; with the old calls it is `undefined` (= `process.env`, secrets included) |
| M3: pre-flight trusts the central directory | `preflight.ts:168–201` inflated only `.xml/.rels`, only 4 KB each; any other member declaring ≤ 1 MB was never inflated before a parser inflated all of it | `preflightPass.test.ts` "declares 1 KB and really inflates to 200 MB" resolves on the old code |
| N1: DTD check reads 4 KB | `preflight.ts:151` `PROLOG_BYTES = 4096` | "10 KB comment before `<!DOCTYPE`" passes the old check |
| N3: `complete` not atomic | `routes/files.ts:295` `claimFrom` then `:304` `enqueueAttachment`, two statements | a failure between them left the row `queued` with no job; nothing ever re-queued it |
| N4: SHA-256 in the request | `routes/files.ts:291` `storedChecksum` streamed the whole object (up to 500 MB) inside `complete` | spy on `openRead` is called |
| N5: `%PDF-` anywhere for every type | `sniff.ts:40` | `sniffBuffer(".md" mentioning %PDF- at line 5)` → `unsupported_type` (run 2026-10-16) |
| M1: working copies in `/tmp` | every `mkdtemp(os.tmpdir())` in `services/attachments` and `routes/files.ts` | on Cloud Run `/tmp` is in memory |

All seven findings hold.

## Decision

### 1. System tools over an upload run with nothing of ours (M2)

`services/attachments/untrustedTools.ts` is the only place `execFile` is called for an upload.
Every ffmpeg, ffprobe, pdfinfo, pdftotext, pdfimages and pdftoppm call gets an environment built
from nothing — `PATH` and `TMPDIR` — and its stdin is closed. ffmpeg and ffprobe get
`-protocol_whitelist file` before `-i`; ffmpeg gets `-nostdin` (ffprobe 6.1 has no such flag:
"Option not found"). The parser child (`isolatedExtract.ts`) keeps `PATH`, `TMPDIR` and
`NODE_ENV` (not a secret; the child imports the API's modules). A test (`untrustedTools.test.ts`)
puts fake `ANTHROPIC_API_KEY` / `COOKIE_SECRET` into the test process and checks every child's
options, and a static guard fails when a file in `services/attachments` or `routes/files.ts`
calls `execFile`, `spawn`, `mkdtemp` or `tmpdir()` outside the helpers.

Found while testing, recorded plainly: ffmpeg 6.1 already refuses both hostile playlists
(an ID3 tag then an `#EXTM3U` playlist) on its own — a file not named `.m3u8` is not probed as HLS,
a segment named `/etc/hostname` fails `allowed_extensions`, and a local playlist's segments are
limited to `file,crypto,data`. The explicit whitelist pins that on every ffmpeg version and drops
`crypto` and `data`; there is no control case on 6.1 that the flag alone changes.

### 2. The pre-flight inflates every member once, keeping nothing (M3, N1)

After the directory checks, one streaming pass over every member of a ZIP document: inflated in
4 KB steps (`PASS_READ_BYTES`, ours; deflate's ratio bounds one step to ~4 MB), real bytes counted
and discarded; a member past its declared size, or a real total past N-10's 500 MB, is `zip_ratio`;
a wall clock `ZIP_PREFLIGHT_TIMEOUT_MS` (ours, 120 s) gives `timeout`. In the same pass every
`.xml` / `.rels` member is scanned to its end for `<!DOCTYPE` / `<!ENTITY` with a 64-byte overlap
between chunks, NUL bytes dropped so UTF-16 (either order) matches. The parsers run only after the
pass (`isolatedText` / `isolatedDerive`), and the spreadsheet preview, which parses in the API
process, now opens only a `ready` file (a failed bomb answers `file_not_ready`).

Not scanned: EPUB's `.xhtml` / `.opf` (XHTML legitimately carries `<!DOCTYPE html>`), and encodings
other than UTF-8/UTF-16 (UTF-32 is caught by the NUL drop; EBCDIC is not).

### 3. `complete` is one transaction; orphans are re-queued (N3)

`enqueueAttachment(row, tx)` (and `enqueueProjectFile`) take an optional transaction. `complete`
and `retry` move the row and insert the job in one transaction; the worker is woken after commit.
A failure leaves the file `uploading` (or `failed`), and the same call can be made again. A file
left `queued` with no live job for longer than `FILE_ORPHAN_GRACE_MS` (ours, 60 s; measured from
the row's creation and the last job change) gets a job on its next status poll (`wake`), under a
`FOR UPDATE` lock so two polls queue one job. This also covers a crash between a ZIP's member
rows and their jobs.

### 4. The checksum is the job's first stage (N4)

`complete` records the object's generation and size only, and never opens the object. The job,
after downloading its copy, checks the generation is unchanged (after the download, so the copy is
that generation), then streams its copy through SHA-256 and writes it to the row — before the scan
and before the reuse lookup, which is keyed on it. A changed generation is `corrupt` and nothing is
scanned. The derivative records the checksum of the bytes it was read from.

### 5. `%PDF-` anywhere only for a declared PDF (N5)

`detectKind(head, { pdfAnywhere })`: within the first 1,024 bytes when the name or MIME declares a
PDF (what PDF readers accept), at offset 0 otherwise.

### 6. Working directory and one large job per instance (M1) — ours

- `FILE_TMP_DIR` (default empty = `os.tmpdir()`): every working copy in `services/attachments` and
  `routes/files.ts` is made under it (`workDir.ts`), and the tools' `TMPDIR` points there. Set it to
  a mounted volume to take working copies out of the instance's memory.
- `FILE_LARGE_JOB_BYTES` (100 MB): at most one job for a file above it runs per instance. The claim
  takes the large slot before its query and returns it when the job claimed is small, so two
  claims in flight cannot both take one; `FOR UPDATE SKIP LOCKED` is unchanged. Reads inside a
  request (multipart `POST /files`, `FILE_PIPELINE=sync`) are not jobs and are not limited.
- Deploy config is not changed. Sizing rule for the owner: the instance's memory must exceed the
  working copies it can hold at once — roughly 3 × the largest file allowed + 1 GiB while `/tmp` is
  in memory — and `--no-cpu-throttling` keeps long OCR/audio jobs moving (ADR-0063 Decision 2).

### 7. Carry-overs

- D0a: a genuine encrypted workbook (msoffcrypto-tool, password `test`) is now a fixture
  (`docs/ops/build-2-fixtures/11-encrypted-password-test.xlsx`, README beside it); it ends `encrypted`.
- D0b: libheif-js (LGPL-3.0, with libde265) is item LW-56 in
  `docs/architecture/00-Handoff/00-lawyer-list-addendum-2026-10-16.md`.
- D0c: the documents limit (500 → 100 MB, N-10) and the 15-min lease stay as they are until the
  owner decides (DEFERRED).

### 8. Review round 1 (2026-10-16)

All five findings were reproduced by a failing test first.

- **R3#1** A ZIP under a non-ZIP name (an `.xlsx` saved as `.xls`, which the sniff accepts)
  reached the parser without the pre-flight. The pre-flight now runs for every file the child
  parses whose name or type is a ZIP document **or whose bytes start with a ZIP signature**
  (`isolatedExtract.ts` `preflightIfZip`).
- **R3#2** EPUB parts officeparser hands to its XML parser are scanned: `.opf`, `.ncx`, `.vml`
  strictly, like `.xml`. `.xhtml` / `.html` chapters may have one `<!DOCTYPE html …>` with no
  internal subset (the EPUB 2 PUBLIC form included: the parser fetches no external DTD); any
  `<!ENTITY>`, any other DOCTYPE, or a DOCTYPE left open is refused.
- **R3#3** The preview refuses a `ready` workbook carrying a `not_extracted` note (the child ran out
  of heap, or found nothing): `preview_unsupported` (422, "No preview for this file … Download
  it"), because the file is readable but not previewable. `file_not_ready` would tell the user to
  wait for something that will not happen.
- **R3#4** A chat ZIP archive's job counts as large whatever its own size (ours): its expansion
  writes up to N-10's 500 MB of members to the work dir.
- **R3#5** The orphan reconcile treats any `running` job as present, so a job running on a lapsed
  lease with its attempts spent is failed `timeout` by `failExhausted`, not replaced by a new job.
- **R1#10** Transcription does not retry a piece after a `ProviderError` marked not retryable
  (`provider_quota_unavailable`, `model_unavailable`, …); a deadline, a cut answer or an
  unclassified error keeps its one retry.
- `storedChecksum` (no caller since Decision 4) is removed.

Review round 2 (2026-10-16) amends two of these:

- **R3#2, amended.** Scanning `.opf` / `.ncx` strictly refused every EPUB 2 book, whose `toc.ncx`
  opens with `<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "…ncx-2005-1.dtd">`. EPUB parts
  (`.opf`, `.ncx`, `.xhtml`, `.xht`, `.html`, `.htm`) now get one lenient rule: a DOCTYPE naming
  any root is allowed only without an internal subset (`[`), and any `<!ENTITY` is refused (the
  XML parser fetches no external DTD; with no subset there is nothing to expand). `.xml`,
  `.rels`, `.vml` stay strict. **In an EPUB every member is scanned** with the lenient rule
  (strict for `.xml/.rels/.vml`), except `mimetype` and media no XML parser reads (images, fonts,
  audio, video), because the parser opens what the OPF manifest lists, whatever its name (a
  `.xht` chapter, or none). A file is an EPUB by its `.epub` name or by its layout (`mimetype` +
  `META-INF/container.xml`).
- **R1#10, amended.** `retryable: false` is ProviderError's default and what an unclassified
  Gemini failure carries, so it does not end a piece's attempts. Only the codes that say a retry
  cannot help do: `provider_quota_unavailable` (Gemini 429 with limit 0), `model_unavailable`
  (404 publisher model, 401/403) and `context_overflow` (the same request is too large again).
  `provider_error`, `provider_timeout`, `provider_limit` and non-provider errors keep the one retry.

## Consequences

- New config: `FILE_TMP_DIR`, `FILE_LARGE_JOB_BYTES`, `FILE_ORPHAN_GRACE_MS`,
  `ZIP_PREFLIGHT_TIMEOUT_MS`. No migration, no new dependency, no API schema change.
- `complete` answers faster for large files (no streamed SHA-256); the checksum appears on the row
  when the job has run, not at 202.
- The pre-flight now costs one inflate of each ZIP document (bounded memory, ≤ 500 MB of work).
- A workbook preview needs the file to be `ready`.

[claude-upload]: https://support.claude.com/en/articles/8241126-upload-files-to-claude
