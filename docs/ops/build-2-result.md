# tech-build.2 — Files ingest: P09 + P12 + P19 (part) + the P06 gaps — result

- Branch: `build/files-ingest`, from `build/files-fix` @ `5cafbac` (not merged). One squashed
  commit. Not merged, no PR, no deploy.
- Decision record: [ADR-0063](../decisions/0063-files-ingest-and-automated-gates.md) (supersedes the
  `CLAUDE.md` "Local first" bullet, ADR-0045 §1, parts of ADR-0062 / ADR-0013 / ADR-0020; their
  status lines say so).
- Owner's live test: [build-2-live-checklist.md](build-2-live-checklist.md), with the files to
  upload in [`build-2-fixtures/`](build-2-fixtures/).
- No provider was called: every test uses the harness fakes; the count APIs are faked.

## Models used

| Role | Model | How confirmed |
|---|---|---|
| Main session: reading, all code, tests, docs | **Claude Opus 5.5** (`claude-opus-5-5`) | `get_session`: `session_context.model` and `last_served_model` both `claude-opus-5-5` |
| Read-only lookup (frontend touchpoints: `validateFile`, error copy, project page, preview) | **Claude Sonnet 5.5** — `model: sonnet` passed on the call (the environment lists Sonnet 5.5 as that family's model) | a general-purpose agent restricted **by instruction** to Read / Grep / Glob, not by a tool list (this harness's agent types do not take one); it edited nothing |
| Test runner (one full backend run while the frontend was edited) | **Claude Haiku 5.5** — `model: haiku` passed on the call | restricted by instruction to Bash + Read, no edits; its report: tsc clean, 119 files / 1,179 passed / 19 skipped |

No Explore agent. Parallel work was limited to the read-only lookup and the test run (the code
files are interdependent, so no second writer).

## Checks (final run, this branch)

| Check | Command | Result |
|---|---|---|
| Backend types | `cd backend && npx tsc --noEmit` | clean |
| Backend tests | `cd backend && npx vitest run` | **119 files, 1,179 passed, 19 skipped** (baseline before the task: 114 files, 1,129 passed, 19 skipped) |
| Frontend types | `cd arcnave-frontend && npx tsc -b` | clean |
| Frontend build | `cd arcnave-frontend && npx vite build` | built (chunk-size warning only, as before) |
| Frontend tests | `cd arcnave-frontend && npx vitest run` | **42 files, 403 passed** (baseline: 42 files, 400 passed) |
| OpenAPI | `cd backend && npx tsx src/openapi.ts` | `docs/openapi.json` regenerated (project file read / replace routes, 202s) |
| Migration order | `npx vitest run src/db/journal.test.ts` | 0029 `files_ingest` re-stamped by tag to `1792300000000`, after 0028 (drizzle-kit stamped it earlier, again) |
| Compiled child | `npm run build`, then plain `node` (NODE_ENV=production) calling `dist/services/attachments/isolatedExtract.js` | the child ran from `dist/…/extractChild.js`: JPEG normalised 3000×2000 → 2576×1717 (1.1 s), HEIC 1280×854 → JPEG, PDF inspected, XLSX derived (`S!A1:B1`); `sharp`, `heic-decode`, `pdf-lib` dynamic imports resolve under plain ESM |
| HEIC decode | one-off: the libheif project's `example.heic` through the isolated child | `{"mimeType":"image/jpeg","width":1280,"height":854}`; not committed (licence of the sample not clear), no HEIC encoder here to make one |

Postgres: the native cluster (`service postgresql start`), per mistakes.md 2026-09-17. poppler,
ffmpeg present in the container; CI now installs ffmpeg too.

## Exit tests (each a new test)

| # | Exit test | Evidence (file › test) | Result |
|---|---|---|---|
| 1 | The unused `buildScannedPdf` fixture: upload → per-page OCR text → project search | `src/routes/fileReading.integration.test.ts` › "reads the scanned fixture page by page into a project, where search finds it with its page" (pages `ocr` / `gemini` / `fake-ocr-7`; one batch [1, 2]; search hit on page 2; chunk pages 1, 2) | pass |
| 2 | A mixed PDF keeps text and scanned pages | fileReading › "keeps a mixed PDF’s text page as text and OCRs only its scanned page" (sources `text`, `ocr`; OCR asked for [2] only) | pass |
| 3 | A 150-page scan is readable | fileReading › "reads a 150-page scan whole, in batches of at most 15 pages" (150 pages `ocr`; 10 calls, ≤ 15 pages each, every page once) | pass |
| 4 | A 40 MB audio file transcribed with segment timestamps (fake engine) | fileReading › "transcribes a 40 MB recording piece by piece…" (41,983,244-byte WAV, 238 s → `00:00–01:30`, `01:30–03:00`, `03:00–03:58` with ms times; 3 requests) | pass |
| 5 | An 8 MB JPEG with GPS EXIF reaches Claude without error; the stored copy has no GPS | fileReading › "sends an 8 MB JPEG with GPS EXIF to Claude without error, as a copy with no GPS" (~8.1 MB original with GPS IFD; copy has no EXIF, rotated by orientation 6 to 2576 px tall; Sonnet 5.5 turn `done`; sent base64 ≤ 5,242,880 and equal to the copy; original kept) | pass |
| 6 | Stage 8 skill-test files + Tamil PDF + UTF-16 CSV each yield a derivative with locators | `src/routes/fileDerivatives.integration.test.ts` › "Tamil DOCX on A4…" (sections `அறிமுகம்`, `Budget`; 11906 × 16838 twips), "16:9 PPTX…" (`Slide 1`, `Slide 2`, notes, aspect `16:9`), "lakh-format XLSX…" (`Budget!A1:B3`, `12,34,567`, `1,23,45,678`, hidden sheet labelled), "Tamil PDF…" (`p. 1`, `p. 2`, Tamil text layer, no OCR), "UTF-16 CSV…" (`utf-16le`, header in every chunk, `lines 1–…`) | pass |
| 7 | A 300 MB CSV goes through retrieval, not whole (no `context_overflow`) | fileDerivatives › "reaches the model as excerpts that match the question, far under any context limit" (≥ 300 MB file; count `null`/`too_large`; `retrieval_partial`; Gemini turn and a Claude turn carrying it in history both `done`, excerpts with the asked row, < 400,000 chars) | pass — the row is inserted directly: N-10 refuses a document over 100 MB at upload |
| 8 | A 100-page PDF on Claude stays under the request limit | fileDerivatives › "sends images of 8 pages chosen for the question…" (8 page images incl. the matching page 58; 100 pages of text; note; `buildAnthropicMessages` < 32 MB) | pass |
| 9 | Token counts stored per model family | fileDerivatives › "stores each family’s own count from its count API, exact" (different fake counts for the Gemini and Claude slots) and "stores null, not a guess, when a count API fails…" | pass |
| 10 | The EICAR file → malware | `src/routes/fileSafety.integration.test.ts` › "fails the EICAR test file as malware, before anything reads it" (a clamd stand-in speaking INSTREAM over TCP); plus `scan_incomplete` for a limit answer, a refused connection and an over-limit file | pass |
| 11 | A PDF with an OpenAction comes back stripped | fileSafety › "strips an OpenAction script, document JavaScript and link actions from the stored copy" (no `/OpenAction`, `/JavaScript`, `/Launch`, `app.alert` in the stored bytes; download serves the stripped copy; size follows) | pass |
| 12 | A poll request advances a queued job with polling off | `src/routes/fileIngest.integration.test.ts` › "advances a job queued by another instance, with polling off, inside the poll request" — **seen failing** with the poll's wake replaced by a no-op (10.4 s, job never claimed), passing with it | pass |
| 13 | A project-file upload and a chat attachment produce the same derivative | fileIngest › "a project-file upload and a chat attachment produce the same derivative" (txt, csv, pdf, xlsx, docx; same Markdown, kind, version, token counts, warnings, units; two users so G3 reuse does not short-cut it) | pass |

Also new: lease renewed per stage with a starved heartbeat, and a worker that lost its job writes
nothing (fileIngest › "the lease"); reuse by checksum (G3); generation changed after `complete` →
`corrupt` (D1 #35); derived objects deleted with chat and project files (D1 #37); replacing a
project file (D1 #38); OCR finish-reason retry → `ocr_partial`; > 20 images → ≤ 2,000 px; units in
`src/services/attachments/ingestUnits.test.ts` (need-OCR detection incl. TSCII and Bamini-style
legacy Tamil, OCR answer parsing, 3-h audio refusal, UTF-16 / Windows-1252 / NUL, HEIC and UTF-16
sniff, N-14 sizing and locators); G13 escaping in `xlsxRenderer.test.ts`; frontend: project upload
polled to ready (`Surfaces.test.tsx`), HEIC accepted under 20 MB (`types.test.ts`), preview guard.

### Parity before removing the old paths (one-off, then deleted)

Old synchronous project indexer (`indexFile` + isolated `extractPages`, pdf.js + single-call OCR)
against the new project job, same fixtures; status, and every word of the old text present in the
new derivative:

```
notes.txt: old=ready new=ready oldWords=3 newWords=3 oldWordsMissingInNew=[]
table.csv: old=ready new=ready oldWords=4 newWords=4 oldWordsMissingInNew=[]
readme.md: old=ready new=ready oldWords=3 newWords=3 oldWordsMissingInNew=[]
two.pdf: old=ready new=ready oldWords=3 newWords=5 oldWordsMissingInNew=[]
scan.pdf: old=ready new=ready oldWords=6 newWords=9 oldWordsMissingInNew=["provider","this","content"]
book.xlsx: old=ready new=ready oldWords=6 newWords=19 oldWordsMissingInNew=[]
letter.docx: old=ready new=ready oldWords=4 newWords=4 oldWordsMissingInNew=[]
sample.odt: old=ready new=ready oldWords=6 newWords=6 oldWordsMissingInNew=[]
sample.rtf: old=ready new=ready oldWords=6 newWords=6 oldWordsMissingInNew=[]
sample.epub: old=ready new=ready oldWords=11 newWords=11 oldWordsMissingInNew=[]
pic.png: old=unsupported(unsupported_type) new=unsupported(unsupported_type) …=[]
```

`scan.pdf`'s three "missing" words are the fake provider's one-call answer ("The fake provider read
this content."); the new path asks per page and gets the fake's per-page answer. `two.pdf` and
`book.xlsx` gain words (page markers; column letters and row numbers). Then removed: `indexFile`,
`isolatedExtractPages`, `extractPages`, `readPdfLayer`, `pagesFromPdfLayer` (D1 D2), the
`pdfLayer` child op, `runIndex` in `projects.ts`.

## Owner defaults used (the owner may change each)

- **OQ-08 token counts:** provider count APIs at ingest per family — Gemini `countTokens` on
  `MODEL_GEMINI_FLASH`, Claude `count_tokens` on `MODEL_SONNET`. No estimator. No count (over
  `TOKEN_COUNT_MAX_CHARS` 2 M chars, API failure, no text) → `null`, `exact: false`, retrieval.
  Page-image tokens are not counted (no API call with images); the N-13 page budget bounds images.
- **OQ-10 retrieval:** BM25 (Unicode tokens) for chat files too; whole ≤ 30k tokens (N-05, CXD-4).
- **OQ-11 OCR:** Gemini engine behind `OcrEngine`; Document AI not built. ClamAV: `Scanner` + clamd
  INSTREAM client + no-op `FILE_SCANNER=none` (default); no clamd deployed.
- **OQ-13 Office on sandbox turns:** locked Stage 9 wins: ≤ 30k tokens inline as normalised text,
  larger → pointer + excerpts (ADR-0063 Decision 6, superseding ADR-0045 §1).
- **OQ-29 dependencies:** `sharp` 0.35.5 (Apache-2.0; prebuilt libvips LGPL-3.0), `heic-decode`
  2.1.0 (ISC) → `libheif-js` 1.23.5 (LGPL-3.0, WebAssembly; runs in the isolated child) — HEIC is
  accepted; `regenerator-runtime` 0.13.11 (MIT, dev only, for the Tamil test font); ffmpeg / ffprobe
  (Debian package, LGPL-2.1+/GPL-2+) in the backend image and CI; test font Noto Sans Tamil (OFL 1.1).
  No AGPL.
- The sandbox image and tesseract: untouched.

## Numbers and settings added

| Setting | Value | Source |
|---|---|---|
| `WHOLE_FILE_MAX_TOKENS` | 30,000 | N-05 |
| `PDF_PAGE_IMAGES_PER_TURN` / `PDF_WHOLE_MAX_PAGES` | 8 / 20 | N-13 (Normal / Deep) |
| `CHUNK_TARGET_TOKENS` / `CHUNK_OVERLAP_PERCENT` | 800 / 15 | N-14 |
| `AUDIO_MAX_SECONDS` | 10,800 | N-10 |
| `FILE_JOB_LEASE_MS` | 900,000 (was 60,000) | ours (ADR-0063 Decision 2) |
| `FILE_POLL_HOLD_MS` | 5,000 | ours |
| `OCR_BATCH_PAGES` / `OCR_BATCH_DEADLINE_MS` / `OCR_CONCURRENCY` | 15 / 180,000 / 3 | Stage 9 OCR-M11 (15); ours |
| `AUDIO_SEGMENT_SECONDS` / `AUDIO_OVERLAP_SECONDS` / `AUDIO_SEGMENT_DEADLINE_MS` / `AUDIO_CONCURRENCY` | 90 / 2 / 120,000 / 4 | Stage 9 M10 (60–120 s); ours |
| `IMAGE_MAX_LONG_EDGE_PX` / `IMAGE_MAX_BYTES` / `IMAGE_MANY_LONG_EDGE_PX` | 2,576 / 3.75 MB / 2,000 | Stage 9 IMAGES, G48 |
| `TOKEN_COUNT_MAX_CHARS` / `EXTRACTED_TEXT_MAX_CHARS` | 2,000,000 / 2,000,000 | ours |
| `FILE_SCANNER` `clamd`, `CLAMD_HOST` / `PORT` / `TIMEOUT_MS` / `STREAM_MAX_BYTES` | 127.0.0.1 / 3310 / 120,000 / 500 MB | Stage 9 SCAN (≥ our max) |
| Need-OCR thresholds (10 word chars, 30 % garbage, 20 % legacy words) | — | ours |
| Preview fetch limit (frontend) | 50 MB | ours (D1 #33) |

Migration 0029 (additive only): `file_derivatives`, `file_derivative_pages`, `derivative_chunks`;
`attachments.checksum_sha256`, `attachments.object_generation`, `project_files.object_generation`.

## Found and fixed on the way

- The content sniff read a UTF-16 LE CSV (BOM `FF FE`) as MPEG audio and refused it (pre-existing;
  mistakes.md entry).
- officeparser's DOCX Markdown starts with YAML front matter holding the document author's name; it
  is dropped from the derivative (and so from `extracted_text`).
- A blank page in a text PDF is not OCR'd (`pdfimages -list`: no image on the page).

## Deferred (and why)

- **LibreOffice → page images for Office files** (OFFICE->PDF, D1 #29): needs the sandbox phase.
- **Chunked resumable upload** (D1 #36): a new upload protocol on both sides; did not fit.
- **Document AI OCR engine** (OQ-11), **clamd deployment** (infra, owner), `--no-cpu-throttling`
  (infra option, owner).
- **Image OCR** (Stage 9 IMAGES "also OCR'd"): images are normalised, not OCR'd; not in P09's scope.
- **Page-image token counts** (TOKENS asks for them): no count API call with images was made;
  recorded in each sidecar (`imagesCounted: false`).
- **Parsed text and versions in `file_versions`** (TC1, P9): the Markdown is in object storage; no
  `file_versions` table yet (a replaced project file keeps its id, the old version is not kept).
- **Excel CSV / Parquet exports for code** (EXCEL): the summary and table derivative exist; the
  per-sheet exports are a sandbox-phase item.
- **A frontend button for replacing a project file**: the API exists (`PUT`); the UI does not.
- **SheetJS / ExcelJS replacement** (VS-16): still only in the isolated child.
- The sandbox's own Python skills that write CSV / XLSX: G13 escaping is in our renderer only.

## Where the brief and the code disagreed

- The 300 MB CSV exit test is above N-10's 100 MB document limit; the test inserts the row directly
  to prove the turn path, and the live checklist uses a 50–100 MB CSV.
- "A 150-page scan is readable" and "40 MB audio" use the fake engine, as the brief says; the real
  engines are checked live (checklist steps 4–5).
