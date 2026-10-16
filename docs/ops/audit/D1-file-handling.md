# D1 — File handling end to end: conformance audit
Task tech-audit.A, deep-dive D1. Auditor model: Sonnet 5.5 (subagent arcnave-auditor). Static read only: nothing was run, no provider was called.
Sources read: Stage 1 (`01-requirements.md`), Stage 3 D1, Stage 4 L1/L6 (AS-D6, AS21), Stage 5 (FG3, UD-2), Stage 8 checkpoint (TD-4c/TD-5c), Stage 9 (checkpoint, `09-file-processing.md`, scope doc), Stage 12 checkpoint, Stage 14 checkpoint, Stage 15 ER-9, numbers register N-08…N-15, build plan Phase 2; repo ADRs 0004, 0011, 0013, 0016, 0020, 0029, 0044, 0045, 0049, 0052; `mistakes.md`; `docs/checkpoints/CURRENT.md`; all repo code listed in the brief; tests and fixtures; Stage 8 `skill-tests` (older snapshot, listing only).
The reference handbook (`docs/architecture/reference/claude-managed-agents-handbook.pdf`) is absent and is not cited anywhere below.
Could not check: `.env.example` (read permission denied); `backend/node_modules` is not installed, so what officeParser v8 / pdf-parse v2 emit for PPTX notes, DOCX comments, headers is **unverified** (no fixture exists either); LV-1 numbers (no runs); the attachments bucket location (not stated in `docs/deploy/direct-upload.md`; the model-inputs bucket is `asia-south1`, `docs/deploy/model-inputs.md:16`).
All paths are relative to `D:\arcnave-tech`.

---

## 1. Summary verdict

**The owner is right: file handling is poor against the locked design.** It is a *working* happy path for a few types (PDF ≤100 pages as page images + text, images, plain text, XLSX/Office text), built on a **synchronous, in-request, in-process extractor** (`routes/files.ts:233-266` → `services/attachments/processUpload.ts:148-164`). Stage 9's pipeline (intake sniff → ClamAV → ZIP → LibreOffice → Docling → OCR → audio → sheets → image normalise → Markdown+JSON sidecar → token count → chunks → embeddings → ready/failed) is, in the repo, three statuses (`uploading | ready | unsupported`, `db/schema.ts:422`), one `pdfinfo/pdftotext` call, one `officeParser`/`ExcelJS`/`SheetJS` call, and a text blob stored in a Postgres column (`attachments.extracted_text`).

What is **right and worth keeping**: server-generated storage keys + traversal guard (`services/storage.ts:20-28,56-58`), ownership scoping on every file route (`routes/files.ts:470-483`), `nosniff` + attachment disposition (`files.ts:348-359`), the 10/message and 20/chat counts (`chats.ts:546`, `1114`), PDF page count cap 1,000 (`processUpload.ts:185-191`), poppler-rendered page images on demand with no stored copy (`services/attachments/pdfPages.ts:78-153`, matches G49), Gemini page images by `gs://` URI (`generation.ts:229-249`, `modelInputStore.ts:43-57`), the manifest "is it in your context" note (`manifest.ts:28-42`), hash-based chunked sandbox input transfer (`tools/sandbox/warmSandboxClient.ts:6-8`), tolerance for HTML tables disguised as `.xls` (`retrieval.ts:336-345`).

**Worst problems (P0 = content wrong or lost):**
1. **ZIP not supported at all**, and legacy `.xls` *is* accepted while Stage 9 says reject (`storage.ts:347-354`; frontend `storage.ts:46-47` has no `zip`). Locked R5 / UD-2 unmet. (P1, feature absent but loud.)
2. **Scanned PDFs have no OCR at upload.** Chat: ≤100 pages the model re-reads page images itself every turn; >100 pages "nothing in it can be read" (`processUpload.ts:224-226`). Project files: one Gemini call for *all* pages, no output-truncation check, page-less result, and mixed text+scanned PDFs silently drop the scanned pages (`retrieval.ts:155-180`).
3. **No token count and no whole-vs-retrieve decision for chat files** (Stage 9 G18/G46, Stage 12 D1 30k). A 1,000-page text PDF or a 300 MB CSV is sent whole every turn; the failure is a provider `context_overflow` after the chip said "ready".
4. **Indic text is invisible to project search**: `tokenize` is ASCII-only (`retrieval.ts:415-419`), so a Tamil/Hindi chunk has zero tokens and is skipped (`retrieval.ts:524`). Chunks are silently capped at 400 per file (`retrieval.ts:22,686`).
5. **Deleting a project file destroys the bytes of chat attachments that were picked from it** (`projects.ts:530-535`, no reference check; `schema.ts:415-417` `ON DELETE SET NULL`), after which every later sandbox call in that chat fails with "was not found" (`codeExecutionExecutor.ts:508-513`).
6. **Audio over roughly 20 MB cannot be transcribed** (whole file as one inline base64 call, `retrieval.ts:200-207`) although the UI advertises 500 MB; no segments, no timestamps, no 3 h check.
7. **Untrusted files are parsed inside the API process** with no sniff, no bomb guard, no ClamAV (`EXTRACTION_MEMORY_PER_BYTE` is by *file* size only, `processUpload.ts:107-118`); `xlsx` 0.18.5 from npm (`backend/package.json:49`) is, from my knowledge and unverified here, a version with published CVEs.

UX against locked D1 / AS-D6: Send is blocked only while a file is *uploading* (`Composer.tsx:445,451`, `chats.ts:1103`). A failed/unsupported file is **sent along** with the message ("Files marked with a warning are sent without their text.", `Composer.tsx:836-837`), there is **no Retry** on chat files (`Composer.tsx:232-237` Remove only), and there is no ER-9 error taxonomy.

Counts (Section 5): NEW-BUILD 16 · REWRITE 24 · DISCARD 4 · KEEP 14 (evidenced, 3 re-opened) · DIFF-STACK 1 · DIFF-INFRA/deferred 4 (listed, not bucketed). Severity of the 40 gap rows: P0 × 8, P1 × 26, P2 × 6 (rows can overlap; see table).

---

## 2. Pipeline map (stage → file:line)

| # | Stage | Where | Notes |
|---|---|---|---|
| 0 | Client pick + local check | `arcnave-frontend/src/Composer.tsx:388-437`; `storage.ts:46-68` | max 10 files (`:390`); `allowed` regex has no zip/heic; 10 MB image check `:65`; uploads **one file at a time** (`await` in the `for`, `:395-436`) |
| 1 | Start upload + policy check | `routes/files.ts:137-187`; `services/storage.ts:428-485` | MIME claim + extension only; no byte sniff; row `uploading` |
| 2 | Byte transfer | GCS resumable URI `storage.ts:295-302` + browser `api.ts:656-683`; local `files.ts:189-231` | one XHR PUT of the whole file (`api.ts:681`): no chunks, no resume |
| 3 | Complete + size check | `files.ts:233-266` | stored size must equal declared (`:251`); then **synchronous** read |
| 4 | Read / extract | `processUpload.ts:148-279` → `retrieval.ts:40-88` | PDF: `pdfinfo` `:173`, `pdftotext` `:209`; Office: `parseOffice` `retrieval.ts:233`; sheets `:289-358`; audio `:189-215`; process-wide serial queue `processUpload.ts:141-146` |
| 5 | Persist | `files.ts:501-538` | text in `attachments.extracted_text`; any unexpected error → `unsupported` (`:524-531`) |
| 6 | Claim by message | `chats.ts:1085-1177` | only `uploading` blocks (`:1103`); 20/chat (`:1114`); claim UPDATE has no `message_id IS NULL` guard (`:1158-1165`) |
| 7 | Load for a turn | `chats.ts:588-609` (no status filter); history `generation.ts:1582-1613`, `1629-1653`; bytes `1738-1761`; history byte budget `1798-1894` (12 MB, `config.ts:176`) | |
| 8 | PDF → pages | `generation.ts:255-261` → `pdfPages.ts:78-153` | ≤100 pages: pdftoppm JPEG q90 2000 px `:124-136` + per-page text; >100: text only `:115-122` |
| 9 | Model limits | `generation.ts:1773-1796` → `modelLimits.ts:70-129` | current turn = hard error; history = dropped with note |
| 10 | Page images by URI (Gemini) | `generation.ts:229-249`; `modelInputStore.ts:43-57` | hash-named objects, 7-day lifecycle |
| 11 | Manifest | `manifest.ts:28-85`; `generation.ts:811-832` | |
| 12 | Provider wire | Gemini `providers/gemini.ts:38-80`; Claude `anthropic.ts:233-296`; fallbacks `attachmentContent.ts:26-114` | |
| 13 | Sandbox hand-off | `codeExecutionExecutor.ts:440-518`; `executionRuntime.ts:203-255`; `warmSandboxClient.ts:95-250`; `catalog.ts:13-15`; Office pointer `attachmentContent.ts:74-78`, `generation.ts:313-324,813-817` | |
| 14 | Project files | upload+index `projects.ts:374-425,781-813` → `retrieval.ts:659-707` → prompt `generation.ts:1954-2011` → tools `tools/executor.ts:64-66` | |
| 15 | Delete / retention | `files.ts:388-465`; `retention.ts:56-103`; `projects.ts:512-539` | |
| 16 | Display / preview | chips `Composer.tsx:180-239`; panel `Panels.tsx:840-960`; sheets `FilePreviews.tsx:99-186`, `files.ts:363-384` | PDF preview = bare iframe `Panels.tsx:950-951` |

N-ids in scope — register value vs repo value:

| N-id | Register (`00-Handoff/00-numbers-register.md`) | Repo | Where |
|---|---|---|---|
| N-10 docs | ≤100 MB / ≤1,000 pp (`:15`) | 500 MB flat for every type; 1,000 pp ✓ | `config/numbers.ts:59`, `config.ts:355`; `processUpload.ts:31` |
| N-10 XLSX | ≤50 MB | 500 MB accepted; text extracted only ≤ ~45 MB | `processUpload.test.ts:116` (derived) |
| N-10 images | ≤20 MB | 10 MB (+ 8000 px) | `processUpload.ts:34-36`; frontend `storage.ts:52` |
| N-10 audio | ≤500 MB / ≤3 h | 500 MB ✓, no duration check | `numbers.ts:59` |
| N-10 ZIP | ≤100 MB / ≤20 files / ≤500 MB unpacked | none (type absent) | — |
| N-10 counts | ≤10/msg, ≤20/chat | ✓ ✓ | `chats.ts:546`, `processUpload.ts:30` |
| N-11 | per-user rate, project file limits, company OCR pages (5,000/month after review R-6), audio minutes | none; project files 30 MB each (`numbers.ts:57`), no count cap | `projects.ts:374-425` |
| N-13 | page images Fast 3 / Normal 8 / Deep 20 (`:18`) | all pages ≤100 | `processUpload.ts:33`, `pdfPages.ts:124-149` |
| N-14 | ~800 tokens / ~15 % (`:19`) | 1,400 chars (≈350 tokens) / 180 chars (12.9 %) | `retrieval.ts:20-21` |
| N-15 | 1,536-dim embeddings (`:20`) | no embeddings; schema comment says so | `db/schema.ts:183` |
| N-08 | sandbox ≤30 MB ×10, workspace ~500 MB (`:13`) | workspace 2 GiB, no per-file/-run cap | `sandbox/server.py:63` |
| N-09 | tool result ~8k tokens | `read_project_file` 6,000 chars | `numbers.ts:45` |
| Claude request | Stage 9: 30 MB incl. base64 | 32,000,000 (first-party API, ADR-0054) | `providers/capabilitiesTable.ts:52-53` |
| Gemini image inline | Stage 9: 7 MB inline / 30 MB GCS (`09-file-processing.md:26`) | 20,000,000 "inline" | `capabilitiesTable.ts:91` |

---

## 3. Per-type traces

Common entry for every type: `Composer.addFiles` (`Composer.tsx:388`) → `validateFile` (`storage.ts:56`) → `api.files.upload` (`api.ts:1045`) → `POST /files/uploads` (`files.ts:137`) → `checkUpload` (`storage.ts:428`) → PUT bytes (`api.ts:656`) → `POST /files/:id/complete` (`files.ts:233`) → `finishUpload` (`files.ts:501`) → `processUpload` (`processUpload.ts:148`). On send: `Composer.submit` (`:450`) → `POST /chats/:id/generate` (`chats.ts:563`) → `appendTurn` (`:1085`) → `generation.run` → `hydrateAttachmentBytes` (`generation.ts:1738`) → `limitToModel` (`:1773`) → provider adapter.

### 3.1 Text PDF (e.g. 12-page statement with a text layer)
1. `processPdf` (`processUpload.ts:170`): `pdfinfo` page count `:173`; reject >1,000 pp `:185`; `pdftotext` split on form feed, `--- Page N ---` blocks `:209-218`; row ready with `extractedText`, `pageCount`.
2. Chip shows "12 pages" (`Composer.tsx:222`). `readingFor` = `text+visual` (`processUpload.ts:52`).
3. Send → `asPdfForModel` (`generation.ts:255`) → `pdfForModel` re-runs `pdfinfo`+`pdftotext`+`pdftoppm` (`pdfPages.ts:99-149`); the upload-time `extractedText` is **not used** for ≤100 pages (double extraction). Cache is per instance, in memory (`pdfPages.ts:41-61`).
4. **Gemini receives**, per page: a text label `["name" page N of M, fileId: …]`, the page image (`fileData` gs:// URI when `MODEL_INPUT_BUCKET` is set, else `inlineData`), then `Text of page N:` (`gemini.ts:42-51`). **Claude receives** the same as text/base64 image/text blocks (`anthropic.ts:237-251`). Manifest line: "in your context: N page images, a text layer on k of N" (`manifest.ts:31-36`).
5. Failure: `pdfinfo` fails (corrupt/encrypted) → status `unsupported`, message with first stderr line (`processUpload.ts:177-183`); chip warning + **Remove only**; the file can still be sent and the model gets "could not be opened as a PDF" (`attachmentContent.ts:101-105`).
6. Weak vs locked: no ClamAV, no encrypted-PDF error (G3), no JS strip (SE14); no token count / whole-vs-retrieve (G18, D1); N-13 not applied — all ≤100 pages go as images each turn; ~30 MB of JPEG for 100 pages (ADR-0013 measured 29.8 MB) exceeds Claude's 32 MB once base64 (hard `provider_payload_limit`, `modelLimits.ts:89-91`); no printed page label / furniture removal (Stage 12); no citation ids; legacy Tamil-font text layers (G35) unchecked; `pdftotext` at `pdfPages.ts:109` is unguarded, its failure surfaces as the misleading "could not be loaded from storage" (`generation.ts:1749-1756`). **Severity: P1** (works for small PDFs; cost, Claude failure on ~60+ page documents, no citations).

### 3.2 Scanned PDF (e.g. 12-page phone-scanned bank statement)
1. Upload: `pdftotext` returns nothing → `text=''`, status `ready`, `extractedText=null`, no note when ≤100 pages (`processUpload.ts:224-233`). The chip looks like a normal PDF; nothing says "scanned/OCR" (G25).
2. Send: ≤100 pages → same page images; Gemini/Claude get "Page N has no text layer; read it from the image." (`gemini.ts:50`, `anthropic.ts:249`). OCR happens inside the answering model **every turn**; no stored OCR text, no search, no confidence, no `ocr_engine/ocr_version` stamp (ADR-0006).
3. >100 pages (up to 1,000): `ready`, note "no text layer, so nothing in it can be read" (`processUpload.ts:224-226`); model gets only a note (`attachmentContent.ts:108-112`). The `pdf-reading` skill then tells the model to render pages and use pytesseract (`skills/pdf-reading/SKILL.md:60-61`) — an escape hatch, not OCR at upload. **Content lost for the model: P0.**
4. As a **project file**: `extractPdfPages` (`retrieval.ts:144-187`): if *any* page has a text layer, only text pages are indexed and scanned pages are dropped silently (`:155-162`); if none, `getScreenshot()` of **all pages** → one Gemini `describeMedia` call (`:174-179`; `gemini.ts:303-340`), no page cap, no `finishReason` check (output truncated at max tokens comes back as `ready`), result is one page-less block (`num: null`), so no page citations. Engine is Gemini Flash (global), not Document AI Mumbai (ADR-0006); no Document AI code or dependency exists (searched `backend/` for documentai/docai: none).
5. Failure UX: Gemini errors become `ExtractionUnsupported("…could not be read: ${String(err)}")` (`retrieval.ts:183`) → project file `unsupported` with raw error text.
6. Fixtures: `test/fixtures/scannedPdf.ts` builds a real image-only PDF but **nothing imports it** (searched `src`); the scanned path is tested only with a blank-page stub and a mocked provider (`retrieval.test.ts:49-69`).
**Severity: P0** (lost/partial content for >100-page scans, mixed PDFs and large project scans; no OCR text for search).

### 3.3 DOCX (e.g. Tamil A4 letter with a table)
1. `checkUpload` accepts by MIME or extension (`storage.ts:347-348`, fallback `:474-477`). Size gate: memory formula 370 B/B → ~11 MB at the 4 GiB budget (`processUpload.ts:107-118,152-162`); larger → `ready`, **no text**, note "Text is extracted from files of this type up to 11 MB".
2. `processDocument` → `extractWithOfficeParser` (`retrieval.ts:222-242`): `parseOffice(data, {ocr:false, fileType:'docx'})` → Markdown; tables become pipe rows; embedded images dropped **without a warning** (G10/G25); comments/tracked changes/headers/footers: **unverified** (no fixture, no node_modules). No page numbers, no heading/page sidecar (Stage 12), no LibreOffice→PDF visuals (V-4).
3. **Model on a sandbox turn** (warm service or process engine): a **pointer only** — "not in your context: read it from its file" (`manifest.ts:29`); the model must run pandoc/python-docx (`skills/file-reading/SKILL.md:30`) (ADR-0045; `generation.ts:813-817`). **Without sandbox**: Gemini `<document filename="…">text</document>` (`gemini.ts:71-76`), Claude a `document` block with `text/plain` source (`anthropic.ts:284-292`). No 30k-token rule, no retrieval.
4. Failure: encrypted/corrupt → `"This Word file could not be read: ${String(err)}"` (`retrieval.ts:236`) = raw library error to the user, status `unsupported`, no Retry; `.doc` / `.docm` → generic 415 "This file format is not supported…" (`storage.ts:479-484`), not the locked "save as DOCX" message (D9-12).
5. Tests: **none** read a real DOCX (only `Buffer.alloc(1000)` for the size gate, `processUpload.test.ts:100-110`); Stage 8 `a4_tamil_test.docx` exists in the older snapshot but is not in the repo.
**Severity: P1** (text mostly works; images/visuals lost silently; >11 MB without text; raw errors; legacy/macro message). With sandbox off and file >11 MB it is P0 for that file.

### 3.4 XLSX (e.g. college intake workbook)
1. Accepted as `.xlsx` and also `.xls` (`storage.ts:347-354`, pinned by `storage.test.ts:109-120`). Size gate 90 B/B → ~45 MB (`processUpload.test.ts:116`); register says ≤50 MB.
2. `extractSpreadsheet` (`retrieval.ts:289-358`): ExcelJS first for ZIP magic (`:298-326`), then SheetJS (`:270-286, 330`), then HTML-table (`:337-345`, India portal exports), then raw CSV (`:348-355`). Output: `--- sheet ---` + pipe grid. **Missing**: cell addresses (G47), formulas/"no cached value" warning (G12), hidden-sheet label (G37), multi-table split (Stage 12), per-sheet summary/samples, CSV/Parquet sidecar for code (G44/D9-8), any row/token cap (a million-row sheet becomes one text value).
3. Model: sandbox on → pointer (+ xlsx skill: pandas/openpyxl); sandbox off → full text inline on both providers.
4. Failure: password-protected workbook falls through every branch and ends in the misleading "has no cells with data on any sheet" (`retrieval.ts:357`), not `encrypted`.
5. Preview: server-typed first rows works for `.xlsx` only (`files.ts:363-384`, `FilePreviews.tsx:99-186`, 25 MB cap `sheetPreview.ts:10`) — meets RD-5 for xlsx; CSV has no grid preview.
6. Tests: real in-test workbooks, BIFF8 `.xls` and HTML-disguised (`retrieval.test.ts:201-282`), octet-stream upload (`files.integration.test.ts:77`); none for hidden sheets, formulas, merged cells, multi-table, password, 50 MB. `skill-tests/lakh_format_test.xlsx` unused.
**Severity: P1** (readable, but lossy and unbounded; `.xls` contradicts D9-12; vulnerable parser risk in 4).

### 3.5 PPTX (e.g. 16:9 deck)
1. Same path as DOCX with `fileType:'pptx'` (`retrieval.ts:54-56,233`); 16 B/B → ~256 MB. Comment at `retrieval.ts:230-232` records a past misdetection of a 30 MB pptx as zip.
2. Text via officeParser Markdown. **Unverified / not built**: slide markers, speaker notes (G11), table fidelity, chart data, image warnings (G10), slide→PDF visuals (V-4). `parseOffice(…, {ocr:false})` explicitly skips OCR of embedded images.
3. Model: sandbox on → pointer (python-pptx via skill); off → inline text. No per-slide locator for citations.
4. Failure/limits: same raw-error and legacy (`.ppt`, `.pptm` → generic 415) behaviour as DOCX.
5. Tests: **none** (no fixture, no extraction test). `skill-tests/deck_16x9_test.pptx` unused.
**Severity: P1** (P0 if notes/slide structure are in fact dropped — unverified).

### 3.6 Image (JPEG/PNG/WebP/GIF)
1. `checkUpload` allows only those four (`storage.ts:376-379`); **HEIC/HEIF (Android camera) → 415** (`storage.ts:479-484`). Frontend caps 10 MB (`storage.ts:65`); `processImage` caps 10 MB and 8000 px via `image-size` header read (`processUpload.ts:236-266`). No EXIF rotate/strip, no re-encode, no resize, no OCR (G14, G15, G36, SE14).
2. Model: bytes read from storage and base64'd unchanged (`generation.ts:1752`). **Gemini**: `inlineData` always — single images never use `gs://` (ADR-0016 line 57; `gemini.ts:66-68`). **Claude**: `image` base64 block (`anthropic.ts:273-282`); `enforceModelLimits` throws `provider_payload_limit` for any image whose base64 exceeds 5,242,880 bytes (≈3.9 MB raw) (`modelLimits.ts:81-83`) — a normal 4–10 MB phone photo cannot be sent to Claude at all; the user must switch model (`generation.ts:2296-2310` text). No >20-images ≤2,000 px rule (G48), no 28×28 token accounting.
3. Project image files are stored but unindexed: `ExtractionUnsupported("Images are stored…")` (`retrieval.ts:80-84`).
4. Tests: synthetic grayscale PNG only (`test/fixtures/files.ts:43-57`); no JPEG with EXIF, WebP, GIF, CMYK, HEIC.
**Severity: P1** (EXIF/GPS retained and served back — privacy; Claude hard-fails on big photos; HEIC rejected).

### 3.7 CSV / TXT / MD
1. Accepted (`storage.ts:366-368`; extension fallback `:464-469` for empty/octet-stream/`text/*` claims — **any bytes** under a `.txt` name are accepted, no sniff).
2. `extractText` → `data.toString('utf8')` (`retrieval.ts:74-76`): no BOM/UTF-16/Windows-1252/Indic legacy encoding handling (the file-reading skill itself warns Tamil text "is often not UTF-8", `SKILL.md:40-43`), no binary check (a renamed ZIP/PNG becomes mojibake in the prompt, against the "binary is never decoded as text" invariant stated at `attachmentContent.ts:5-7`), no size/token cap (500 MB limit `numbers.ts:59`; stored whole in `attachments.extracted_text` and re-read for **every** history load, `generation.ts:1582-1592`).
3. Model: both providers get the whole text inline on every turn (CSV/MD/TXT are excluded from read-with-code, `attachmentContent.ts:66-67`). A big CSV ends in `context_overflow` (`generation.ts:2285-2294`) *after* the chip said ready. No CSV/Parquet sidecar, no per-column summary (G44).
4. Pasted text >4,000 chars becomes `pasted-text.txt` (`Composer.tsx:158-164`) — fine.
5. Tests: `files.integration.test.ts:53,103` (250 kB `x…` string); none for encodings, BOM, big CSV.
**Severity: P1.**

### 3.8 ZIP
1. Frontend `allowed` regex has no `zip` (`storage.ts:46-47`); backend `ALLOWED` has no `application/zip` (`storage.ts:341-390`). The upload is refused with the generic 415 text. No unpack, no inspection, no nested-ZIP rule, no members-as-files, no caps (UD-2, G5; N-10 ZIP 100 MB / 20 files / 500 MB unpacked).
2. Only workaround: none for the user (the sandbox `file-reading` skill lists `.zip` at `SKILL.md:36`, but an upload can never reach `input/`).
3. Tests: none (feature absent). `jszip` (`backend/package.json:56`) and `fflate` (`accountExport.ts:8`) are present for other uses.
**Severity: P1** (locked MVP type; build plan P2-A lists it).

### 3.9 Extra: audio (not one of the 8, but the same path fails first)
`audio/*`/`video/*` are accepted (`storage.ts:381-389`; video is not in Stage 1 R5 / N-10). Upload-time: `processDocument` → `extractAudioVideo` sends the **whole file as one inline base64 `generateContent` call** (`retrieval.ts:200-207`, `gemini.ts:314-324`). Anything above the provider's inline limit fails → status `unsupported` with `String(err)` (`retrieval.ts:209`). When it works the transcript is plain text, no `t_start–t_end` segments, no speaker/timestamp locators (G16, Stage 12 60–120 s segments, G41). **Gemini** is then also sent the raw audio inline each turn (`gemini.ts:59-68`); **Claude** gets only the stored transcript (`anthropic.ts:285-292`) and, if transcription failed, "no readable text". **Severity: P0** above ~20 MB.

---

## 4. Cross-cutting findings

### 4.1 Limits
- Per-type N-10 limits are not implemented; one flat 500 MB attachment ceiling and one 30 MB project ceiling (`numbers.ts:57-59`). The *effective* text-extraction limits are an unrelated memory formula (docx ~11 MB, xlsx ~45 MB, pptx ~256 MB): a 15 MB DOCX uploads "ready" with **no text** (`processUpload.ts:152-162`). (The memory ratios were measured, `mistakes.md` "2026-09-25 (memory)"; they are an artefact of parsing in the API process, G6.)
- Page limits: 1,000 ✓. Image: 10 MB (register 20 MB) and a 8000 px cap that no locked doc requires (Claude parity from ADR-0011).
- Files per message/chat ✓ (counts include picked project files). Count and rate quotas (N-11/G33), project file count: none.
- `HISTORY_MAX_ATTACHMENT_BYTES` 12 MB (`config.ts:176`) has no N-id; it only governs Gemini-without-bucket and non-PDF bytes.
- Gemini inline limit conflict (7 MB vs 20 MB) and Claude 30 vs 32 MB are open (see Section 7).

### 4.2 Send-block and statuses (D1, FG3, AS21, AS-D6)
- Server: only `uploading` blocks, with code `upload_incomplete` 409 (`chats.ts:1103-1107`); Stage 5 FG3 wants 409 "file not ready" and "failed file must be removed first". `unsupported` and failed files pass.
- The generate route loads attachments **without a status filter** (`chats.ts:589-609`) while history loads `ready` only (`generation.ts:1601`, `1649`) — an `unsupported` file is sent on its own turn and silently vanishes from later turns.
- Client: `pending` blocks Send (`Composer.tsx:445,808`); `unusable` only changes the disclaimer (`:446-448,833-838`); `submit` sends `ready|unsupported` and drops `failed` chips without telling the user (`:452-458`).
- States: `uploading|ready|unsupported` only (`schema.ts:422`); no queued/scanning/extracting/ocr/transcribing/indexing (G22), no progress other than upload bytes, no "N files indexing" (Stage 12), no `error_code`.
- Extraction runs inside the HTTP request and behind a **process-wide serial queue** (`processUpload.ts:141-146`): one slow PDF holds every other user's `complete` call on that instance (G30 "fast lane ≤10 s" unmet). A crash mid-extraction leaves the row `uploading` for 24 h (`config.ts:338`).

### 4.3 Retry UX and error taxonomy (AS-D6, ER-9)
- Chat files: Remove (X) only; the failed row is already deleted server-side by `api.files.upload` (`api.ts:1054-1057`) so "retry" means re-pick the file. No retry endpoint. Project files have `POST …/reindex` (`projects.ts:484-508`) and a Re-index button (`Pages.tsx:393`) — chat files have nothing comparable.
- ER-9 codes: unsupported_type ≈ `unsupported_media_type` (415, generic text); too_large/too_many_pages ≈ `payload_too_large` (413); encrypted, corrupt, malware, ocr_failed, ocr_blocked, timeout, quota: **none** (free-text `error` column; raw `String(err)` in `retrieval.ts:183,209,236`). "Save as" copy for legacy/macro: absent.

### 4.4 Citations (Stage 12 registry, Stage 14 RD-4)
- No `[file:n]`, no `chat_citation` registry, no cite ids (searched `backend/src`, skills, frontend: only docs). `message_sources` is web-only (`url NOT NULL`, `domain`, `schema.ts:327-345`). Retrieval chunks carry `page` (`retrieval.ts:423-432`) and `formatContext` prints "(p. N)" (`:560`), and the `file-reading` skill tells the model to "say which sheet, rows or pages" in prose (`SKILL.md:47-48`). That is all.
- Viewer: PDF = blob in an `<iframe>` (`Panels.tsx:950-951`); no pdf.js/react-pdf dependency (`arcnave-frontend/package.json`: only `docx-preview`, `katex`, `react-markdown`, `recharts` among relevant); no page jump or highlight; the panel fetches the **whole file as a blob** (up to 500 MB) for every type (`Panels.tsx:848-857`).
- Build plan P2-E "citation viewer check (pdf.js highlight)" is the matching task.

### 4.5 Sandbox hand-off
- Every chat file is downloaded in full and placed in `input/` on the first code call of each turn (`codeExecutionExecutor.ts:440-445,497-518`; `executionRuntime.ts:203-255`); no per-file cap (N-08: ≤30 MB × 10), workspace limit 2 GiB (`server.py:63`).
- **One** missing/unreadable file makes **every** code call in the chat fail (`codeExecutionExecutor.ts:508-513`) — the "attachments Not found" class from `mistakes.md` (2026-09-18/-24) still exists for deleted bytes.
- Project files never reach `input/` (`chatFilesOf` reads only `attachments`, `generation.ts:393-412`): a workbook in a project is available only as 1,400-char text chunks, never as data for pandas/DuckDB (Stage 8 TD-4c adds DuckDB; G44).
- `input/` is not OS-read-only: the workspace uid owns it (`server.py:166-170`); read-only is enforced only in the tool wrapper (`codeExecutionExecutor.ts:113-117,175-204`). Inputs are re-verified by sha256 on each run, which limits the damage.
- Image content: `Dockerfile.service:28,30` installs **pymupdf** and **pytesseract**; Stage 8 checkpoint excludes PyMuPDF (AGPL) (`00-checkpoint-stage8.md:43`), Stage 20 excludes AGPL from customer-serving runtime (`20-vendor-tool-selection.md:5,72`), and the Stage 9 scope doc lists "no PyMuPDF/pytesseract" as decided (`09-file-processing-scope.md:21`). The `pdf-reading` skill is written around `pymupdf` (`SKILL.md:32-35,56-57,65-67`). The Cloud Run Job image has no readers at all (`Dockerfile:12-15`), hence the inline-text fallback (`catalog.ts:13-15`).
- ADR-0045 (pointer only on sandbox turns) differs from Stage 9 CF4/D9-8 (always send our extracted text; whole when ≤30k tokens). Live evidence for the cost: 26-call OCR loop and re-reading loops in `mistakes.md` / ADR-0052.
- `RUN_PYTHON_CODE_TIMEOUT_MS` 10 s and warm 300 s (`numbers.ts:51-53`) vs N-08 60 s (Deep 120 s) — different, documented in the file.

### 4.6 Project files vs chat files
| | Chat attachment | Project file |
|---|---|---|
| Extractor | poppler + officeParser/ExcelJS | **pdf-parse (pdf.js)** + officeParser/ExcelJS (`retrieval.ts:144-187`) — different text for the same PDF |
| When | in `/complete` request | in the upload request (`projects.ts:422`), "nothing to poll" |
| Storage of text | `attachments.extracted_text` | chunks 1,400 chars, ≤400 per file (`retrieval.ts:20-22,686`) — silent truncation, `whole=false` only affects the whole-file switch |
| To the model | whole, every turn | all files whole if ≤200,000 characters total (`config.ts:171`, `generation.ts:1957-1966`), else search tools (ADR-0029); the whole-file query reloads **all** chunks of the project each turn (`retrieval.ts:605-617`) |
| Page images | yes (≤100 pp) | never |
| Citations | none | page in tool results only |
| Sandbox | yes (`input/`) | no |

Picking a project file into a chat (`files.ts:270-311`): the new row has `extractedText: null`, `pageCount: null`, `status: 'ready'` regardless of the project file's status (`:297-306`). For DOCX/XLSX/PPTX with no sandbox the model receives "no readable text" (`attachmentContent.ts:108-112`); for PDFs `readingFor` says `text`/`none` because `pageCount` is null (`processUpload.ts:50-58`) although the PDF is rendered anyway. Deleting a project file deletes the shared object (`projects.ts:530-535`) while chat rows keep pointing at it; `retention.ts:74-77` has a reference check for chats but project deletion does not. Search is BM25 over ASCII tokens only (see 5, row 12a).

### 4.7 Provider differences
| Content | Gemini | Claude |
|---|---|---|
| PDF ≤100 pp | page image (`gs://` URI if bucket set, else inline) + page text | base64 image + page text; request cap 32 MB → hard error near 60–100 image pages; 600-page cap (`capabilitiesTable.ts:52`) |
| PDF >100 pp | text only | text only |
| Image | inline, ≤20 MB (repo) | base64, hard error >5 MB base64 |
| Audio/video | inline raw (`gemini.ts:59-68`) | transcript made at upload by Gemini; none if that failed |
| Office/text | `<document>` text, or pointer | `document` text block, or pointer |
| History | 12 MB inline budget unless PDF+bucket (`generation.ts:1811-1816`) | newest-first fit under 32 MB / 600 pp (`modelLimits.ts:94-112`) |
| Context overflow | detected only from the provider error (`generation.ts:2244-2255`) | same |
The transport differences are intentional; the **outcome** difference that matters is that the same photo or the same 80-page scan works on Gemini and errors on Claude.

### 4.8 Storage, upload transport, safety
- Bucket/region: the attachments bucket's location is not documented in the repo (searched `docs/deploy`, `docs/runbooks`); model-inputs is `asia-south1`; `SANDBOX_LOCATION` defaults to `us-central1` (`config.ts:254`). Build plan P2-C covers verification. Residency is B-7 (deferred, not bucketed).
- "Resumable" is the session URI only; the browser sends a single PUT (`api.ts:681`), so a dropped connection on a 500 MB file restarts from zero (UD-1..4 session intent).
- After `complete` validated the bytes, the resumable session URI stays valid for its own lifetime (GCS default ~1 week) and "can write that one object" (ADR-0011): bytes can be replaced after validation; nothing records the object generation or a checksum for chat attachments (project files store `checksum_sha256`, attachments do not, `schema.ts:166` vs `401-435`).
- Derived Gemini page images (7-day bucket, hash-named) are not deleted with the file or chat (`modelInputStore.ts:22`, ADR-0016); G29/G45 want derived data removed with the file.
- File claim: `appendTurn` updates `message_id` without `IS NULL` (`chats.ts:1158-1165`), so a file already sent in message A can be re-attached to a new message; the row moves, A loses its file, and the "refuse deleting a sent file" invariant (`files.ts:404-409`) is bypassed.
- Memory (Stage 11): "never save file/tool content" is a prompt policy line (`services/memory/policy.ts:59,63`, long lines, not re-read in full); no code path stores file text in memory. Treated as KEEP-unverified.

---

## 5. Gap list vs locked ids

Bucket legend: KEEP / REWRITE / NEW-BUILD / DISCARD. "Breaks" = tests/ADRs that must change. Every pick keeps the app runnable at each commit (additive migrations, old path kept until the new one passes parity tests). OWNER-DEFERRED (company_id/RLS, Cloud Tasks executor, NO_CONTENT enforce, Terraform, OTel, residency) is not bucketed; see Section 7 for the one that forces rework.

| # | Locked id(s) | Gap (evidence) | Sev | Bucket | Option A | Option B | Pick |
|---|---|---|---|---|---|---|---|
| 1 | R5, UD-2, G5, N-10 ZIP, build plan P2-A | ZIP absent (3.8) | P1 | NEW-BUILD | Inspect the central directory without inflating (declared sizes, ratio, count ≤20, no nested ZIP, no symlink/`..`, no encryption), then stream-extract with running byte counters via `fflate` (already used); each member becomes its own `attachments` row (`parent_attachment_id` additive column) and goes through the normal path. **M**; risk: ZIP bombs/zip-slip handled in the in-process worker until #7; breaks nothing (new); updates `types.test.ts`, frontend `allowed`. | Unpack in the isolated sandbox with Python `zipfile` (Stage 20 "stdlib only"). **M-L**; risk: couples upload to sandbox availability; needs trusted-endpoint design. | **A** (smaller, testable; move to #7 worker later) |
| 2 | D1, FG3, AS-D6, AS21 | Failed/unsupported files are sent; no Retry; server blocks only `uploading`; failed chips dropped silently (4.2, 4.3) | P1 | REWRITE | Server: 409 `file_not_ready` for any attachment not `ready` (and `unsupported` → "remove it first"); client: Send disabled while any chip not ready; chip gets **Retry** (re-run `complete`/re-upload) + **Remove**; delete the "sent without their text" disclaimer. **S-M**; breaks `files.integration.test.ts:502` copy/code, `errors.ts:93-97`, frontend `errorCopy`. | Wait for the status machine (#3) and build UI once on top. **L**; app stays wrong meanwhile. | **A** now; UI states extend with #3 |
| 3 | G22, AS21, G21, G30, D9-9 (Cloud Tasks itself is DIFF-INFRA) | Sync extraction in the request, 3 statuses, serial process-wide queue, no progress (4.2) | P1 | NEW-BUILD | `file_jobs` table (file id + version idempotency key) + in-process worker with `FOR UPDATE SKIP LOCKED` lease; `/complete` returns 202 and the chip polls `GET /files/:id` (exists, `files.ts:315-326`); statuses queued/scanning/extracting/ocr/transcribing/indexing/ready/failed + `error_code`; small-file fast lane. Swap the executor for Cloud Tasks in Phase 5. **M-L**; risk: restart recovery; breaks `files.integration.test.ts:440-460` (complete returns final status → poll helper) and `api.ts:1045-1058`. | Keep sync, run extraction in a worker thread/child process with a concurrency pool. **S**; does not give states/retry/progress. | **A** (additive; old synchronous path stays behind a flag until parity) |
| 4 | G1, D9-12, Stage 1 doc-sync | No byte sniff; legacy `.doc/.xls/.ppt` and macro files not rejected with "save as" copy; `.xls` accepted and test-pinned (`storage.ts:347-354`, `storage.test.ts:109-120`) | P1 | REWRITE | Own magic table over the first 2 KB (PDF, ZIP/OOXML, OLE2, PNG/JPEG/WebP/GIF, text/binary NUL check) + a ZIP probe for `vbaProject.bin`; reject true OLE2 `.doc/.xls/.ppt` and `.docm/.xlsm/.pptm` with the locked message; **accept HTML/XML-table exports named `.xls`** (AICTE portal case, `retrieval.test.ts:243-282`). **S-M**; breaks `storage.test.ts:109-120`, ADR-0004 item 1 note, `types.test.ts` copy. | Add `file-type` as a direct dependency (it is transitive, `package-lock.json:5288`). **S**; new dependency needs approval; still need the ZIP probe. | **A** (no new dependency) |
| 5 | G2, DB-6, SE14 (daemon = DIFF-INFRA) | No malware scan; build plan defers to Phase 5 (line 72) | P1 | NEW-BUILD | `Scanner` interface + clamd INSTREAM client as pipeline step (`scanning`, `malware`, `scan_incomplete` when size > ClamAV max or encrypted archive); env flag off in local dev, required in prod. **M**; breaks nothing. | No scan until Phase 5. **0**; every upload is `ready` unscanned. | **A** (hook now; owner Q4) |
| 6 | G3, ER-9 `encrypted` | No encrypted detection (PDF/OOXML/ZIP/xlsx); password xlsx says "no cells" (`retrieval.ts:357`) | P1 | REWRITE | Detect: `pdfinfo` "Encrypted: yes" with a user password, OLE2 `EncryptedPackage` stream signature, ZIP encrypted flag; code `encrypted`, copy "remove the password and upload again". **S**; breaks none. | Ask the sandbox (`qpdf`/python) to classify. **M**; more moving parts. | **A** |
| 7 | G4, G5, G6, G34, SE14 | Untrusted files parsed in the API process; memory-by-file-size formula; no decompressed-size/ratio/DTD guard; `xlsx@0.18.5` from npm (my knowledge: known CVEs, unverified here) used on untrusted bytes (`retrieval.ts:270-286`, `package.json:49`) | **P0** (availability/security) | NEW-BUILD | Run every extractor in a child process with `--max-old-space-size`, wall-clock timeout and a pre-flight (ZIP central-directory size/ratio, reject `<!DOCTYPE`/`<!ENTITY` in XML parts = defusedxml equivalent); replace or upgrade SheetJS. **M**; risk: IPC of large text; breaks `processUpload.test.ts:112-135` (queue, size table), ADR-0011 consequence section. | Dedicated parser service/sandbox (Stage 9 G34 target: no egress, no secrets). **L**; correct end state, needs infra. | **A** now, B when #29 needs LibreOffice |
| 8 | G7, G8, M11, ADR-0006, G35, G25, ER-9 `ocr_*` | No OCR at upload (3.2); project OCR = one call, no truncation check, mixed PDFs lose scanned pages; Doc AI absent (build plan: keep Gemini OCR until Phase 5) | **P0** | NEW-BUILD | `OcrEngine` interface; per-page need-OCR detection (empty / `(cid:` / garbage-ratio incl. legacy Tamil fonts) → OCR only those pages in ≤15-page batches in parallel; Gemini engine with own deadline, ≤1 retry, `finishReason` check, then page failed; store per-page text + `ocr_engine`/`ocr_version`; Document AI engine (pinned RC, ADR-0006) plugs in later. **M-L**; breaks `retrieval.test.ts:49-69` contract (one call → one block), ADR-0004 item 3 amendment. | Implement Document AI first. **L**; new dependency (`@google-cloud/documentai`), provisioning, 5 pages/min quota (LV-105Q) makes it slow without a quota raise. | **A** (matches the plan's interim) |
| 9 | G9-G12, G25, G37, G40, G44, G47, V-5, Stage 12 (sheets, furniture) | No normalised Markdown + JSON sidecar; no slide/sheet/cell/page ids, warnings, extractor versions; XLSX/PPTX/DOCX gaps in 3.3-3.5 | P1 | NEW-BUILD | `file_derivatives` (text_md, sidecar_json, warnings, extractor/version, per-page rows) beside the old `extracted_text`; extractors per type in order XLSX (addresses, hidden labelled, per-sheet summary + samples, CSV/Parquet for sandbox) → PPTX (slide markers + notes) → DOCX (headings, comments) → PDF (page labels). Old path remains until parity tests pass. **L**; breaks `attachmentContent.test.ts`, `officeTextOnce.integration.test.ts` assertions only when the switch is made. | Patch existing extractors in place (markers, warnings), no sidecar. **M**; no ids for citations, no sheets for code. | **A**, staged per type |
| 10 | G18, G46, D1 (S12), CXD-4, D9-8 | No token count; no per-file whole (≤30k) vs retrieve; chat files never retrieved (3.7, 4.2) | **P0** | NEW-BUILD | Count with provider count APIs (Gemini `countTokens`, Claude `count_tokens`) in the job, store per model family incl. page-image tokens; whole ≤30k tokens (Deep test arm 100k) else retrieval over the file's chunks; the repo CLAUDE.md "no token counting" (Invariant 3, cited in ADR-0020 §4) must be lifted by the owner. **L**; breaks ADR-0020 decision 4 wording, `config.ts:171` (chars). | Character heuristic like today (`PROJECT_FULL_CONTEXT_MAX_CHARS`). **S**; Tamil/Hindi under-count (ADR-0020 consequence), violates G46. | **A** (needs owner Q1) |
| 11 | N-13, V-3, D9-3, G19, G20 | All ≤100 pages as images every turn; Claude 32 MB hard error; Gemini cost | P1 | REWRITE | Interim: if the model's byte/token budget is exceeded, send full text + images only for the first K / retrieved pages, with a note (drop the hard stop for PDFs). **S**; breaks `files.integration.test.ts:549-590`, ADR-0013 consequences. Final: top-page images by retrieval Fast 3 / Normal 8 / Deep 20 (needs #10, #12c). | Wait for retrieval then rebuild. **L**. | **A** now, final with #12c |
| 12a | LANG-1, Stage 12 | `tokenize` ASCII-only → Tamil/Hindi chunks unsearchable (`retrieval.ts:415-419,524`); test covers ASCII only (`retrieval.test.ts:93-101`) | **P0** | REWRITE | Unicode-aware tokenizer (`\p{L}\p{M}\p{N}`), NFC at index and query time, no language logic. **S**; breaks `retrieval.test.ts:93-101` expectations. | Postgres `simple` FTS config per Stage 12 (pg_textsearch). **M**; extension is infra-adjacent. | **A** now, B in #12c |
| 12b | E1, E4, N-14 | 400-chunk silent cap (`retrieval.ts:22,686`); chunk size 1,400 chars vs ~800 tokens; no overlap % per N-14 | **P0** (silent cut) | REWRITE | Raise cap to E4 ~2,000, make truncation an explicit `ready`-with-warning (never silent), size chunks by tokens via #10. **S-M**; breaks chunk tests (`retrieval.test.ts:103-130`), ADR-0020 `whole` flag. | Keep 400, only warn. **S**; still loses content. | **A** |
| 12c | Stage 12 D3-D5, N-15 | No hybrid retrieval, vectors, planner, RRF, rerank, coverage flags, per-turn `file_search` caps (N-07) | P1 | NEW-BUILD | pgvector + Gemini Embedding 2 hybrid with RRF beside BM25, behind the existing `Retriever` seam (`retrieval.ts:434-441`); build plan P2-D decides sequencing (ADR-0059). **L**; additive. | BM25-only + Unicode tokens + page chunks until eval says otherwise. **S**. | **A**, but sequencing is owner Q3 |
| 13 | Stage 12 citation registry, RD-4, P2-E | No `[file:n]`/registry/viewer (4.4) | P1 | NEW-BUILD | `chat_citation` table (cite_id → file version + page/sheet!range/time + hash), ids in tool results and context blocks, client parser; viewer with pdf.js page jump (text-layer highlight second). **M-L**; new frontend dependency; replaces `Panels.tsx:950`. | Keep prose-only page mentions. **0**; fails Stage 12/14. | **A** |
| 14 | N-10, P2-B | Flat limits; image 10 vs 20 MB; extraction limits by memory (4.1) | P1 | REWRITE | Per-type limit table in `config/numbers.ts` with N-ids, enforced in `checkUpload` + frontend; remove the memory-derived "ready, no text" outcome once #7 lands. **S**; breaks `processUpload.test.ts:77-81`, `types.test.ts:286-306`, ADR-0011 limits. | DB `settings` table. **M**; needs company model (deferred). | **A** |
| 15 | G14, G15, G36, SE14 | No EXIF strip/rotate, resize, HEIC, image OCR (3.6) | P1 | NEW-BUILD | Normalised copy (≤2,576 px, ≤5 MB, JPEG/PNG, EXIF stripped, original kept) via `sharp`; HEIC via a separate decoder. **M**; new dependencies (owner Q6); prebuilt libvips usually lacks HEIC (unverified here). | Pillow + pillow-heif in a parser service (D9-4 libs). **M-L**; adds the service #7 B needs. | **B long-term; A interim for JPEG/PNG/WebP** |
| 16 | G16, SPD, G41, N-10 audio, Stage 12 audio segments | Audio >~20 MB cannot be transcribed; no segments/timestamps/duration (3.9) | **P0** | NEW-BUILD | Interim: copy to the model-inputs bucket and send a `gs://` `fileData` part (no size failure). **S-M**. Final: ffmpeg subprocess split into 60-120 s pieces with overlap → Gemini → merge with `t_start–t_end`, duration ≤3 h check. **M**; new binary in image. | Final-only. **M**; leaves failure meanwhile. | **A interim then final** |
| 17 | G23, G29, G45 | Project-file delete removes shared bytes (4.6); derived page images outlive the file | **P0** | REWRITE | Before `storage.delete`, check `attachments.storage_key`/other project rows (same `not exists` as `retention.ts:74-77`); cancel in-flight jobs (G29 after #3). **S**; add test; no existing test breaks. | Copy-on-pick (attachment gets its own object). **S-M**; doubles storage. | **A** |
| 18 | D1 integrity | Claim UPDATE lacks `message_id IS NULL` (`chats.ts:1158-1165`) | P1 | REWRITE | Add the guard, 409 if any id is already claimed. **S**; new test (current tests cover only other users, `files.integration.test.ts:205`). | None. | **A** |
| 19 | Stage 12 RT-1, G42 | Picked project file: `extractedText` null, status not checked, pageCount null (`files.ts:294-307`) | **P0** (no-sandbox Office) | REWRITE | Copy the project file's derivative/text and page count at pick time; require project status `ready`. **S**; breaks `files.integration.test.ts:347-364` fixtures slightly. | Reuse #9 derivative by bytes hash. **M**. | **A** now, B after #9 |
| 20 | V-5, RT-1 | Two ingest paths (poppler vs pdf-parse; chunks vs text) (4.6) | P1 | REWRITE | One ingest service (job + derivative) with `scope=chat|project`; project OCR uses #8. **L** (part of #9). | Keep both. **0**. | **A** within #9 |
| 21 | G48, G14, CF6 | Claude rejects images >5 MB base64; no >20-images ≤2,000 px rule | P1 | REWRITE | Use the normalised copy (#15) for both providers; apply the 2,000 px rule at send time. **S** after #15. | Resize at send time with `sharp`. **M**. | **A** |
| 22 | SE14 | No PDF JavaScript/OpenAction strip, LibreOffice hardening, Pillow bomb limits | P1 | NEW-BUILD | With #7/#29: qpdf/pdf-lib strip on the normalised copy; pixel cap before decode. **M**. | Defer. | **A** |
| 23 | ER-9, Stage 15 | No taxonomy; raw `String(err)` in messages (4.3) | P1 | REWRITE | `error_code` column + copy table for the nine codes; map extractor failures; remove raw error text. **S-M**; breaks `errors.ts` copy tests, frontend `errorCopy`. | Free text stays. | **A** |
| 24 | N-11, G31, G33, G43 | No per-user upload rate, project file count/size caps, OCR-page or audio-minute quota | P1 | NEW-BUILD | Per-user limits now (settings), company pools after tenancy. **S-M**. | Wait for company model. | **A** |
| 25 | TD-4c, Stage 20 AGPL, scope doc | pymupdf/pytesseract in the warm image; pdf-reading skill depends on them (4.5) | P1 | REWRITE | Replace with pypdfium2 + pdfplumber + pypdf in image and skill snippets; drop pytesseract per scope doc (owner may want tesseract as a cross-check: Q7); add DuckDB. **M**; breaks `skills.test.ts`/`skillContent.test.ts` snippet asserts, `behaviorEvaluation.test.ts`. | Keep and record an ADR/lawyer item. **S**; violates TD-4c. | **A** |
| 26 | TD-5c, N-08 | No per-file/per-run caps; one missing file aborts all code calls; all files copied each run (4.5) | P1 | REWRITE | ≤30 MB × 10 per run; larger files via sidecar/chunked read; per-file error note instead of aborting; stage lazily by referenced path. **M**; breaks `codeExecutionExecutor.test.ts` staging asserts. | Leave. | **A** |
| 27 | Stage 14 upload states, G25 | Chip shows no stage/warnings list; no "N files indexing" | P2 | REWRITE | Show stage + warnings from #3/#9. **S**. | — | **A** |
| 28 | Stage 9 CF4, D9-8 vs ADR-0045 | Pointer-only on sandbox turns | P1 | REWRITE | Inline normalised text when ≤30k tokens, pointer + retrieval above; supersede ADR-0045 §1. **S** after #10; breaks `officeReadWithCode.integration.test.ts:34`, `attachmentContent.test.ts`. | Keep ADR-0045. **0**. | **A** (owner Q2) |
| 29 | V-4, G10 | No DOCX/PPTX → PDF page images | P1 | NEW-BUILD | LibreOffice (macros off, Very High, no trusted locations) in the parser sandbox → page images for Office files. **M-L**. | Text only + warnings (#9). **0**. | **A** after #7 |
| 30 | G38, G39 | PDF form fields/comments, embedded-file warning | P2 | NEW-BUILD | Add to PDF extractor/sidecar. **S-M**. | Leave to skill. | **A** |
| 31 | G32, G46, G44 | CSV/TXT/MD: no encoding detection, binary check, cap, sidecar (3.7) | P1 | REWRITE | BOM/UTF-16/UTF-8-fatal → Windows-1252 fallback, NUL check, token gating (#10), CSV summary/Parquet (#9). **S**; add tests. | `chardet` dependency. **S**. | **A** |
| 32 | G20, G14, ADR-0016 | Gemini inline image/audio; 7 vs 20 MB conflict | P1 | REWRITE | Send images ≥ ~4 MB and audio by `gs://` via `ModelInputStore`. **S**; breaks `modelInputs` asserts. | Keep inline; resolve with LV-1. | **A** |
| 33 | RD-4/RD-5 | Preview downloads whole file (500 MB) for all types (4.4) | P2 | REWRITE | Fetch only for types drawn client-side; size guard; xlsx uses server preview only. **S**. | — | **A** |
| 34 | ER-9 `corrupt` | `pdftotext` unguarded and reported as "storage unavailable" (`pdfPages.ts:109`, `generation.ts:1749-1756`) | P2 | REWRITE | Catch → `unreadable` with reason. **S**. | — | **A** |
| 35 | G21, UD security | Post-validation overwrite via session URI; no checksum/generation on attachments | P1 | REWRITE | Store object generation + sha256 at `complete`, read with `ifGenerationMatch`. **S-M**. | Copy to a new key then delete the original. **M**. | **A** |
| 36 | UD-1..4 | Single-PUT "resumable" upload (`api.ts:681`) | P1 | REWRITE | Chunked PUT with `Content-Range`, resume by querying offset; retry per chunk. **M**. | Keep. | **A** |
| 37 | G29/G45 | Derived page images not removed with file | P2 | REWRITE | Track by file id or accept ≤7-day lifecycle and document it (G23 ≤23 d). **S**. | — | **either; document** |
| 38 | G42 | No project file replace (= re-process + delete old data) | P2 | NEW-BUILD | `PUT /projects/:id/files/:fileId`. **S-M**. | Delete+upload. | **A** |
| D1 | — | `EXTRACTION_MEMORY_PER_BYTE` table + `oneAtATime` | — | DISCARD | after #7 | | — |
| D2 | — | pdf-parse OCR single-call path (`retrieval.ts:165-180`) | — | DISCARD | after #8/#20 | | — |
| D3 | — | "Files marked with a warning are sent without their text" (`Composer.tsx:836-837`) | — | DISCARD | with #2 | | — |
| D4 | — | `pymupdf`/`pytesseract` in the sandbox image (`Dockerfile.service:28,30`) | — | DISCARD | with #25 | | — |
| K1-K14 | KEEP (file:line above) | storage key shape + traversal guard `storage.ts:20-28,56-58`; ownership scoping `files.ts:470-483`; nosniff attachment download `files.ts:348-359`; sent-file delete guard `files.ts:404-409`; project-key guard in delete/cleanup `files.ts:412,456`; 10/message `chats.ts:546`; 20/chat `chats.ts:1114`; PDF 1,000-page reject `processUpload.ts:185-191`; page render on demand, no stored pages (G49) `pdfPages.ts:78-153`; Gemini `gs://` pages `generation.ts:229-249`; manifest in-context note `manifest.ts:28-42`; hash-chunked sandbox input transfer `warmSandboxClient.ts:6-8`; `.xls`-as-HTML tolerance `retrieval.ts:336-345`; CSV/TXT/MD accepted `storage.ts:366-368`; xlsx server preview `files.ts:363-384` | | KEEP | | | |
| S1 | Poppler instead of pypdfium2 (D9-4) | outcome (text + page render) met | — | DIFF-STACK | | | |

KEEP spot-check (3 of 14 re-opened in code this session): storage key guard `storage.ts:20-28,56-58` — confirmed; `retention.ts:56-82` chat purge reference check — confirmed (used as the pattern for #17); `modelLimits.ts:70-129` newest-first history fit — confirmed (but see #11/#21 for the outcome gaps). Not bucketed (deferred/infra): Cloud Tasks file queue (AS-D1), ClamAV daemon deployment, Document AI processor provisioning, attachments bucket region/residency (P2-C).

Suggested order that keeps the app runnable: #18, #17, #19, #12a, #12b (S fixes, no new structure) → #2, #4, #6, #14, #23, #31 (policy + UX) → #3 (state machine, additive) → #7 → #8, #1, #16 → #10, #9, #12c, #13, #11, #28 → #15, #21, #29, #22, #25, #26.

---

## 6. Test gaps

| Type / area | Fixture or test today | Missing |
|---|---|---|
| Text PDF | `pdfWithPages` Latin-only (`test/fixtures/files.ts:10-19`); `processUpload.test.ts:34-68`; `files.integration.test.ts:454-481,549-590` | Tamil/Hindi text layer, legacy-font PDF, multi-column, encrypted, corrupt-but-valid-header, 100-page byte-size vs Claude 32 MB, printed page labels |
| Scanned PDF | `buildScannedPdf` exists (`test/fixtures/scannedPdf.ts`) but **is imported nowhere**; blank-page stub + mocked vision (`retrieval.test.ts:49-69`); >100-page blank (`processUpload.test.ts:50-55`) | real image-only PDF through upload → page images → provider wire; mixed text+scanned PDF; OCR truncation; Hindi/Tamil scan; large project scan |
| DOCX | none (size-gate only, `processUpload.test.ts:100-110`) | any real DOCX incl. Tamil, tables, images, comments, encrypted; `a4_tamil_test.docx` (older snapshot) unused |
| XLSX | in-test workbooks, BIFF8, HTML-disguised (`retrieval.test.ts:201-282`), octet-stream upload (`files.integration.test.ts:77`) | hidden sheets, formulas without cached values, merged cells, multi-table, password, 50 MB, lakh formats (`lakh_format_test.xlsx` unused) |
| PPTX | none | everything (slide markers, notes, tables, charts) |
| Image | grayscale PNG (`files.ts:43-57`); size/dimension tests (`processUpload.test.ts:70-86`) | JPEG with EXIF/GPS, WebP, GIF, CMYK, HEIC, >5 MB on Claude through the route, >20 images |
| CSV/TXT/MD | plain ASCII string (`files.integration.test.ts:53,103`) | UTF-8 BOM, UTF-16, Windows-1252, Tamil legacy encoding, binary-as-.txt, 100 MB CSV |
| ZIP | none (feature absent) | UD-2 cases: nested, zip-slip, bomb ratio, >20 members, encrypted, disallowed member type |
| Audio | mocked provider (`retrieval.test.ts:71-91`) | real size, over inline limit, segments/timestamps |
| Send-block / UX | `files.integration.test.ts:502` (uploading) | server rejection of unsupported/failed; frontend chip states, Retry/Remove, sequential upload — `Composer.test.ts` has none (only `validateFile`, `types.test.ts:274-306`; `AttachmentChip` is mocked, `Surfaces.test.tsx:33`) |
| Lifecycle | `retention.integration.test.ts`, `files.integration.test.ts:380-408` | project-file delete with attached chat rows; claim of an already-claimed file; sandbox with a missing object |
| Citations / viewer | none | registry, `[file:n]`, page jump |
| Retrieval | `retrieval.test.ts:93-200` ASCII only | Tamil/Hindi tokens, 400-chunk cap, hybrid/RRF |
| Environment | tests call real `pdfinfo/pdftotext/pdftoppm` | local Windows runs fail 25 tests without poppler (`docs/checkpoints/CURRENT.md:118-120`); CI must carry poppler |

---

## 7. Open owner questions

1. **Token counting.** Stage 9 G18/G46 and Stage 12 D1 need exact token counts per model family; the repo rule "ArcNave counts no tokens (Invariant 3)" (cited `ADR-0020` §4, `generation.ts:331`) blocks it. Lift it for files (provider count APIs, free)? Cost of "no": #10 stays a character heuristic that mis-sizes Tamil.
2. **ADR-0045 vs Stage 9 CF4 / D9-8.** Keep "pointer only when a sandbox exists" or inline normalised text when ≤30k tokens (locked outcome)? Not resolved here.
3. **Build-plan deferral line (`00-build-plan-arcnave-tech.md:72`)** defers ClamAV, Document AI OCR, the Cloud Tasks file queue and embeddings/reranker to Phase 5, while the 2026-10-15 owner rule asks for locked-decision parity except stack/infra. ClamAV *states*, OCR quality and embeddings are app behaviour, not infra. Confirm which of #5, #8 (Document AI engine), #12c are in this pass. (Recorded, not resolved; also P2-D/ADR-0059 sequencing.)
4. **ClamAV in dev.** May the scan step ship with a no-op dev scanner behind a flag, with prod required? (Avoids blocking uploads locally.)
5. **company_id now?** `attachments`, `project_files`, `file_chunks` carry only `user_id` (`schema.ts:151-207,401-435`); Stage 12 wants chunk tables list-partitioned per company with their own BM25/HNSW indexes. If the new tables built here (`file_jobs`, `file_derivatives`, `chat_citation`, chunks) omit `company_id`, tenancy later forces a rewrite of all of them. Cost of asking now: one nullable column + index per new table.
6. **New dependencies:** `sharp` (+ a HEIC decoder) or Pillow/pillow-heif in a parser service (#15); `@google-cloud/documentai` (#8); `pdfjs-dist`/react-pdf (#13); ffmpeg binary (#16). Repo has no Stage 20 Node BOM; approve each?
7. **Sandbox tesseract.** Scope doc says no pytesseract; the sandbox image installs tesseract + Tamil pack and the skill uses it as a cross-check. Remove or keep as the only OCR for >100-page scans until #8 lands?
8. **Legacy `.xls`.** D9-12 says reject; real AICTE/portal exports are HTML or XML tables named `.xls` (the repo handles them, `retrieval.test.ts:243-282`). Reject only true OLE2 BIFF and accept table exports?
9. **Extra types accepted today** beyond the locked list: video (`mp4/webm/mov`), RTF/ODT/EPUB, and many code/text extensions (`storage.ts:341-390`; ADR-0011 Claude parity). Keep (no regression for users) or restrict to Stage 1 + CSV/TXT/MD?
10. **Numbers to settle by LV-1 / owner:** Gemini inline image limit 7 MB (Stage 9 vendor fact) vs 20 MB (repo); Claude request limit 30 MB (Stage 9) vs 32 MB (first-party API, ADR-0054); image max 10 vs 20 MB; project-file max 30 MB (N-11 has no value, "–").
11. **B-4 "three models only" vs Stage 12 D3 query planner (M3, `gemini-3.5-flash-lite`) and M5 reranker.** The planner/reranker are separate model calls; B-4 lists three chat models. Recorded as a conflict, not resolved (affects #12c only).
