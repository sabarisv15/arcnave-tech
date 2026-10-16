# ADR-0063: Files ingest (OCR, audio, images, derivatives, token gating, scan) and automated gates before deploy

- Status: accepted (task tech-build.2, 2026-10-15). Tested by automated gates (typecheck, full
  suites, builds); not deployed. The owner verifies live after merging
  ([`docs/ops/build-2-live-checklist.md`](../ops/build-2-live-checklist.md)).
  2026-10-16: Decision 7 "Generation + checksum at `complete`" superseded: the checksum is the
  job's first stage ([ADR-0066](0066-file-pipeline-review-fixes.md) Decision 4).
- Date: 2026-10-15
- Task: tech-build.2 — P09 + P12 + P19 (part) of [`docs/ops/audit/NEW-PLAN.md`](../ops/audit/NEW-PLAN.md),
  plus the two P06 gaps found in review.
- Yardstick: [ADR-0061](0061-locked-decisions-win-outside-stack-and-infra.md): locked Stage 1, 6, 9,
  16 and 20 outcomes; stack and infra may differ.
- Supersedes in part:
  - `CLAUDE.md`, the bullet **"Local first, production second"** (owner decision 2026-10-15,
    Decision 1 below). The bullet is edited in the same commit.
  - [ADR-0045](0045-office-files-read-with-code.md) §1 ("Office files are read with code when the
    turn has a sandbox"): by the locked Stage 9 CF4 / D9-8 rule (OQ-13), a file whose token count
    fits N-05 goes inline as normalised text even on a sandbox turn (Decision 6).
  - [ADR-0062](0062-file-pipeline-jobs-isolation-zip.md) Part B "Project-file uploads stay
    synchronous" and its lease of 60 s (Decisions 2 and 3).
  - [ADR-0013](0013-pdfs-sent-as-page-images-and-text.md)'s fixed "≤ 100 pages → every page as an
    image" rule, for files read after this ADR (Decision 7).
  - [ADR-0020](0020-project-files-in-context.md) §4 "ArcNave counts no tokens": token counts are now
    taken at ingest from the providers' count APIs (Decision 5). Invariant 3 is unchanged: these are
    provider numbers, and a missing count is `null`, never a guess.
  ADRs above are not edited beyond their status lines.

## Claude

What Claude does here, from its published sources:

- **Token counting.** The Claude API's token counting endpoint (`messages.countTokens`, platform
  docs "Token counting") is free and returns the input tokens a message would use. The Gemini API
  has `countTokens` likewise. Both are provider metadata; neither is an estimate.
- **Images.** Claude's vision docs: images over 8,000 × 8,000 px are refused; with more than 20
  images in one request the limit is 2,000 × 2,000 px; the API takes at most 5 MB per image.
- **Files in the Claude app.** Anthropic does not publish how the Claude app ingests a file after
  upload (OCR engine, chunking, scanning). Nothing below is "Claude does X" beyond the two points
  above; every other rule comes from a locked stage decision, or is marked **ours**.

## Decision

### 1. Automated gates before deploy; live is the first manual test (owner, 2026-10-15)

The owner will not run the app locally. **Automated gates are mandatory before any deploy:**
backend `npx tsc --noEmit` and `npx vitest run`, frontend `npx tsc -b`, `npx vite build`,
`npx vitest run`, and CI. **Manual local runs are optional.** A deploy is still only the owner's
merge to `main`, with explicit approval in the current task. Because the live service is now the
first place a person runs a change, every task that changes behaviour ships a numbered live
checklist (`docs/ops/<task>-live-checklist.md`): what to upload, what to ask, the expected result,
and what a failure looks like.

### 2. Jobs that move without background CPU (P06 gap a)

The live service runs with request-based CPU, so the in-process worker (`setInterval` pump,
lease heartbeat) can starve once `/complete` has answered.

- `GET /files/:id` and `GET /projects/:id/files/:fileId` call `FileService.wake()` for that file,
  which claims its queued (or lapsed) job even with polling off, and hold the request open up to
  `FILE_POLL_HOLD_MS` (5 s, ours) until the status moves. The chip polls, so a request is open
  while the job runs. `/complete` and every enqueue also wake the worker.
- The lease is renewed at every stage as well as by the heartbeat, and `FILE_JOB_LEASE_MS` is
  15 min (was 60 s): longer than the longest step between stages (`EXTRACTION_TIMEOUT_MS` 5 min; an
  OCR batch's 3-min deadline × 2 attempts), so a starved heartbeat does not hand a healthy job to a
  second worker. Cost: a job whose process really died waits up to 15 min to resume.
- Every write a job makes stays fenced on holding its lease, so a duplicate run of the same version
  writes nothing (`fileIngest.integration` › "a worker that lost its job…").
- `--no-cpu-throttling` (instance-based CPU) on the Cloud Run service would also fix this. It is
  an infra option for the owner (cost); deploy config is not changed here.

### 3. One ingest path (P06 gap b, D1 #20)

Project-file upload, replace and re-index enqueue a `project` file job (re-index backfill keeps
the `reindex` kind) and answer **202**; the page polls the file. The job runs the same pipeline
(`pipeline.ts`) as a chat attachment and stores the same derivative; it differs only in the row it
finishes and in writing `file_chunks` for project search. The synchronous `indexFile` path, the
isolated `extractPages` wrapper and pdf.js page reading were removed after a one-off parity run on
11 fixtures (`docs/ops/build-2-result.md`). `INDEX_VERSION` is 3, so the backfill re-reads every
older project file through the new path.

### 4. OCR, audio and images (P09; Stage 9 OCR-M11, AUDIO, IMAGES, CLAUDE-IMG; D1 #8, #15, #16, #21, #32)

- **OCR per page** (`ocr.ts`). A page is sent to OCR when its text layer is unusable: fewer than
  10 letters/digits *and* it draws an image (`pdfimages -list`; a blank page is not a scan),
  `(cid:` glyph ids, or garbage (> 30 % private-use / replacement / control / Latin-1 symbol
  characters, or > 20 % of words with ASCII punctuation between letters: the TSCII / Bamini-style
  legacy Tamil font signatures). Thresholds are **ours**. Pages go in batches of ≤ 15
  (`OCR_BATCH_PAGES`, OCR-M11), 3 batches at a time, each with its own deadline
  (`OCR_BATCH_DEADLINE_MS`), at most one retry of the pages it did not return, and a finish-reason
  check (anything but `STOP` is a cut answer). A page still unread is `failed`, and the file is
  `ready` with an `ocr_partial` warning. Each page stores `ocr_engine` and `ocr_version` (the model
  version Gemini reports). The engine is an `OcrEngine` interface; Gemini 3.8 Flash is the engine
  now. **Document AI is not built** (OQ-11 default); it plugs in behind the interface later.
- **The single-call pdf-parse OCR path is removed** (D1 D2), after the parity run.
- **Audio** (`audio.ts`): ffprobe duration, over N-10's 3 h → `too_large`; ffmpeg cuts 90-s pieces
  (`AUDIO_SEGMENT_SECONDS`, inside M10's 60–120 s) with 2 s read before each, as 16 kHz mono MP3;
  each piece is one request (deadline, one retry, finish reason) and one segment with
  `t_start`–`t_end`. Pieces go by `gs://` when `MODEL_INPUT_BUCKET` is set (D1 #32), inline
  otherwise. ffmpeg is added to the backend image and to CI.
- **Images** (`derive.ts`, in the isolated child): a normalised copy, rotated by EXIF orientation,
  all metadata (EXIF, GPS, XMP) dropped, long edge ≤ 2,576 px, ≤ 3.75 MB of bytes so its base64 is
  within Claude's 5 MB; HEIC / HEIF decoded first. The original is kept. Every model is sent the
  copy; with more than 20 images in a request each goes at ≤ 2,000 px (Claude's vision rule). Large
  images go by `gs://` for Gemini where page images already do (D1 #32); the normalised copy is at
  most 3.75 MB, so images are not sent by URI separately.

### 5. Derivatives and token counts (P12; Stage 9 NORM, TOKENS, CHUNK, EXCEL, EXTRACT, G13; D1 #9, #10, #30, #31)

- `file_derivatives` (one per file, replaced in the job's fenced transaction), with
  `file_derivative_pages` (page / slide / sheet / section / segment, source, OCR engine and version,
  times) and `derivative_chunks`. The Markdown lives in object storage under its own key (TC1);
  `attachments.extracted_text` keeps it only up to `EXTRACTED_TEXT_MAX_CHARS` (2 M chars, ours).
- Builders, in the plan's order: **XLSX** (SheetJS in the child: each sheet a table with column
  letters and row numbers, values as Excel formats them — lakh format included —, hidden sheets
  labelled, formulas with no cached value warned); **PPTX** (slides in presentation order with
  speaker notes, slide size and aspect); **DOCX** (officeparser Markdown split at headings, comments,
  page size; the front matter with the author's name is dropped); **PDF** (text per page, OCR'd
  pages, form fields and comments with pdf-lib, embedded files warned). CSV / TXT: BOM, UTF-16 with
  or without BOM, strict UTF-8, else Windows-1252 with an `encoding_guess` warning; a NUL in the
  decoded text → `corrupt`; streamed, so a 300 MB file is never one string.
- **Token counts** per model family at ingest (OQ-08 default): Gemini `countTokens` on
  `MODEL_GEMINI_FLASH`, Claude `count_tokens` on `MODEL_SONNET`, stored as `{tokens, exact, model}`.
  A text over `TOKEN_COUNT_MAX_CHARS` (2 M chars, ours), an API failure or no text is stored as
  `tokens: null, exact: false` with the reason. Page-image tokens are not counted (no count API
  call with images; `sidecar.imagesCounted: false`); the PDF page budget below bounds images.
- **Chunks** ~800 tokens, ~15 % overlap (N-14). Tokens become characters by this file's own count
  (its characters per token, as the count API measured them); a file with no count falls back to
  the old 1,400-character size and records `sizedBy: chars`. Tables and CSVs repeat their header
  in every chunk and are cut at whole lines. Each chunk has a locator (page, slide, sheet range,
  lines). At most 2,000 chunks (E4); past it a `retrieval_partial` (chat) or `chunk_cap` (project)
  warning.
- **Formula injection** (G13): text written into a generated workbook that starts with `= + - @`,
  a tab or a CR gets a leading apostrophe; numbers and formulas the model asked for are left alone.

### 6. Whole or retrieved, per file and per model family (Stage 6 CXD-4, Stage 9 PDF->MODEL, D1 #10, #11, #28)

- A file whose count for the turn's family is ≤ N-05 (30k) goes whole; otherwise, or with no count,
  it goes as BM25 excerpts of its chunks chosen for the question (≤ N-05 / N-14 = 37 chunks), with a
  note that code can open the whole file. BM25 stays (OQ-10 default; Invariant 4: lexical).
- On a turn with a sandbox, a file within N-05 goes inline as normalised text; a larger Office file
  is pointed to, with its excerpts (supersedes ADR-0045 §1, OQ-13 default).
- **PDFs**: within N-05 and ≤ 20 pages (N-13 Deep, the most any profile sends) → whole, every page's
  image and text. Otherwise images of 8 pages (N-13 Normal; profiles arrive with P10) — the pages
  whose text best matches the question, else the first — plus every page's text when the text fits
  N-05, or only the chosen pages' text when it does not; a note says which pages. OCR'd page text
  replaces the empty text layer on page images.

### 7. Safety and integrity (P19 part, D1 #5, #22, #35, #37, #38; Stage 9 SCAN, G3)

- **Scanner** interface; `FILE_SCANNER=clamd` streams the file to clamd with INSTREAM
  (`CLAMD_HOST`, `CLAMD_PORT`, `CLAMD_TIMEOUT_MS`, `CLAMD_STREAM_MAX_BYTES` = 500 MB). FOUND →
  `malware`; size limit, refused connection, timeout or any other answer → `scan_incomplete` (a new
  code beside ER-9: Stage 9 SCAN names it). `FILE_SCANNER=none` (default) is the no-op dev scanner;
  nothing says a file was scanned. **No clamd is deployed** (infra, owner).
- **PDF active content** stripped in the child (pdf-lib): an OpenAction that is an action, every
  `/AA`, document JavaScript, link / widget actions that run script, launch, import or submit, and
  the action objects themselves. The stored copy is replaced (its size and generation on the row
  follow), with an `active_content_removed` warning. An encrypted PDF is not rewritten.
- **Not here: LibreOffice → page images** for Office files (OFFICE->PDF, D1 #29): it needs the
  sandbox phase (P18). Deferred.
- **Reuse** (G3): a later upload by the same user with the same SHA-256, extractor version and
  scanner copies the earlier derivative (its own copies of the objects) instead of reading again;
  not for a PDF whose copy was stripped.
- **Generation + checksum at `complete`** (D1 #35): SHA-256 and the object's generation (GCS
  `generation`, local mtime) are stored; a job whose object's generation changed fails `corrupt`.
- **Derived objects deleted with their file** (D1 #37): file delete, ZIP members, unsent cleanup,
  project-file delete and the retention sweep remove the Markdown and normalised-image objects.
  Page images Gemini reads by URI stay content-addressed in the model-input bucket and expire by its
  7-day lifecycle (ADR-0016), within G23's ≤ 23 days.
- **Replace a project file** (D1 #38): `PUT /projects/:id/files/:fileId`, same id; the new version
  is read by a job, its chunks and derivative replace the old ones, the old bytes are deleted unless
  a picked chat attachment still reads them.
- **Preview size guard** (D1 #33): the preview panel downloads a file only when it draws that format
  itself, and only up to 50 MB (ours); otherwise it offers the download.
- **Not done: chunked resumable upload** (D1 #36). It needs a new upload protocol on both sides
  (`Content-Range` sessions, resume by offset) and did not fit this task.

### Dependencies (OQ-29)

| Package | Licence | Where | Why |
|---|---|---|---|
| `sharp` 0.35.5 (with prebuilt libvips 8.18, LGPL-3.0, dynamically linked) | Apache-2.0 | backend | image normalisation |
| `heic-decode` 2.1.0 → `libheif-js` 1.23.5 (WebAssembly libheif) | ISC → LGPL-3.0 | backend | HEIC / HEIF decode, in the isolated child |
| `regenerator-runtime` 0.13.11 | MIT | backend dev only | a global @pdf-lib/fontkit needs to embed the Tamil test font |
| ffmpeg / ffprobe (Debian package) | LGPL-2.1+ / GPL-2+ (Debian build) | backend image, CI | audio duration and pieces |
| Noto Sans Tamil Regular (test fixture font) | SIL OFL 1.1 | test fixtures | a real Tamil PDF text layer |

No AGPL. The sandbox image and its tesseract are untouched (sandbox phase).

## Consequences

- Clients: project upload / re-index answer 202 and are polled (`GET /projects/:id/files/:fileId`);
  the frontend does. `PUT /projects/:id/files/:fileId` is new; the frontend has no replace button yet.
- Every chat file read from now on has a derivative; files read before keep working as before
  (no derivative → no budget step, original image bytes, `extracted_text` as stored).
- A file over N-05 is no longer sent whole on any turn; that is the locked outcome, and the owner's
  live checklist checks an answer from a large file.
- The Claude count API is called twice per file read (two families); Gemini's once. Both are free;
  Claude's is rate-limited separately from messages.
- Lease 15 min: a crashed job resumes after 15 min, not 60 s.
