# tech-build.1 — Files fix: P01 + P06 + P14 — result

- Branch: `build/files-fix`, from `audit/stage-1-21` @ `26f1ce9`. One squashed commit. Not merged,
  no PR, no deploy, no dev run.
- Decision record: [ADR-0062](../decisions/0062-file-pipeline-jobs-isolation-zip.md) (supersedes
  parts of ADR-0011; ADR-0011's status line says so).
- Models used: **Claude Opus 5.5** (`claude-opus-5-5`, confirmed with the session's
  `get_session`: `session_context.model` and `last_served_model` both `claude-opus-5-5`) for all of
  it — reading, code, tests and docs. No Sonnet or Haiku helper was started: the code lookups and
  test runs were done directly in the main session.
- No provider was called: every test uses the harness fakes (`src/test/harness.ts`).

## Checks (final run, this branch)

| Check | Command | Result |
|---|---|---|
| Backend types | `cd backend && npx tsc --noEmit` | clean |
| Backend tests | `cd backend && npx vitest run` | **114 files, 1,129 passed, 19 skipped** (baseline before the task: 110 files, 1,076 passed, 19 skipped) |
| Frontend types | `cd arcnave-frontend && npx tsc -b` | clean |
| Frontend build | `cd arcnave-frontend && npx vite build` | built (chunk-size warning only, as before) |
| Frontend tests | `cd arcnave-frontend && npx vitest run` | 42 files, 400 passed (baseline: 41 files, 390 passed) |
| OpenAPI | `cd backend && npx tsx src/openapi.ts` | `docs/openapi.json` regenerated (retry route; `errorCode`, `warnings`, `parentId`, `memberIds`; 202 on complete) |
| Migration order | `npx vitest run src/db/journal.test.ts` | 3 passed; 0028 stamped `1792200000000` after 0027 |
| Compiled child | `npm run build`, then plain `node` importing `dist/services/attachments/isolatedExtract.js` | the child ran from `dist/…/extractChild.js` with no `tsx`; `--- S ---\nWidgets \| 42` in ~1.0 s |

Postgres: the native cluster (`service postgresql start`), per mistakes.md 2026-09-17.

## Exit tests (each a new test)

| # | Exit test | Evidence (file › test) | Result |
|---|---|---|---|
| A1 | Tamil and Hindi chunks are found by project search | `src/routes/fileGuards.integration.test.ts` › "finds a Tamil chunk and a Hindi chunk by a word in each" (+ "keeps combining marks … NFC and NFD forms as one token") | pass |
| A2 | > 400 chunks shows a visible warning | same file › "indexes a file past the old 400-chunk cap whole, with no warning" (450 paragraphs → > 400 chunks, all indexed) and "reports a visible `chunk_cap` warning on a file over the cap" (2,100 → 2,000 + `chunk_cap`); frontend `types.test.ts` › "shows a ready file's chunk-cap warning on the chip" | pass |
| A3 | Claiming an already-claimed attachment → 409 | fileGuards › "refuses to claim a file already in a sent message with 409 file_already_attached" | pass |
| A4 | Deleting a project file leaves a picked chat attachment readable in the sandbox | fileGuards › "leaves a picked, sent attachment readable in the sandbox workspace" (`ExecutionRuntime.materializeAttachment` places it in `input/`, contents read back) | pass |
| A5 | A picked project DOCX reaches a no-sandbox turn as text | fileGuards › "sends a picked project DOCX to a no-sandbox turn as text" (+ PDF page count, + indexing → 409) | pass |
| A6 | Generate with a non-ready attachment → `file_not_ready` | fileGuards › "refuses a failed file", "refuses a file still being read"; `files.integration` › "will not send a message with a file that is still uploading" | pass |
| A7 | A corrupt PDF in history → `unreadable`, not "storage unavailable" | fileGuards › "is unreadable with a reason … on a later turn" and "reports a pdftotext failure as unreadable" (a failing `pdftotext` first on `PATH`) | pass |
| B1 | Upload → 202 → states seen by polling | `src/routes/filePipeline.integration.test.ts` › "answers complete with 202 `queued`, and a poll sees each stage before `ready`" (polls see `scanning`, `extracting`, then `ready`) | pass |
| B0 | Two `complete` calls at once (ours) | filePipeline › "queue one job; the other call answers with the row as it is" | pass |
| B2 | A worker killed mid-job resumes after lease expiry | filePipeline › "leaves a job another worker resumes once the lease lapses" (worker A held at `extracting` then `crash()`; B cannot claim before 300 ms, can after; file `ready`, job `attempts: 2`) | pass |
| B3 | A decompression-bomb DOCX refused in pre-flight without memory growth | `src/services/attachments/isolatedExtract.test.ts` › "refuses a decompression-bomb DOCX from its declared sizes, without inflating it" (declares 2 GB; `arrayBuffers` growth < 16 MB, RSS < 64 MB) and "refuses a real high-ratio member"; route: filePipeline › "refuses a decompression-bomb DOCX in pre-flight" (`zip_ratio`) | pass |
| B4 | `.docm` → refusal with save-as text | filePipeline › "refuses .docm before any byte is sent, with the save-as text" (415, exact text) and "refuses a macro document renamed .docx, by its content"; `storage.test.ts` save-as cases | pass |
| B5 | Password XLSX → `encrypted` | filePipeline › "fails a password-protected XLSX as `encrypted`" | pass — the fixture is a synthetic OLE2 file with an `EncryptedPackage` directory name (`test/fixtures/archives.ts`), not a real Excel-encrypted workbook (no tool here can write one) |
| B6 | Per-type limits in `checkUpload` and `validateFile` | `storage.test.ts` › "applies each type its own N-10 limit…"; filePipeline › "documents 100 MB, spreadsheets 50 MB, images 20 MB, ZIP 100 MB, audio 500 MB"; frontend `types.test.ts` › "applies each type's N-10 limit…", "rejects an image over the register's 20 MB" | pass |
| B7 | Three concurrent uploads no longer serialise | filePipeline › "reads three files at the same time" (a barrier at `extracting` opens only with all three inside it; fails with "serialised" otherwise) | pass |
| C1 | ZIP: nested, zip-slip, bomb ratio, > 20 members, encrypted, disallowed member type — each refused with its code | `src/routes/zipUpload.integration.test.ts` › 11 cases: `zip_nested` (×2: by name, by bytes), `zip_unsafe_path` (×2), `zip_symlink`, `zip_ratio` (declared, and a member that inflates past its declared size), `zip_too_many_members`, `zip_encrypted`, `zip_member_type`, `zip_too_large_unpacked`; each leaves no members | pass |
| C2 | A valid ZIP becomes member chips that go through the normal pipeline | zipUpload › "unpacks members into their own attachments…" (txt + 2-page PDF, `__MACOSX` skipped, members `ready`, sent, text reaches the provider), "reads a small ZIP in the request on the multipart path too", "removing an unsent ZIP removes its unsent members"; frontend `fileStates.test.tsx` › "replaces a ZIP with its member files once it is unpacked" | pass |
| F1 | Frontend: chip polling, Retry/Remove, Send disabled, no disclaimer | `arcnave-frontend/src/fileStates.test.tsx` › "polls a queued file through its stages, holding Send until it is ready" (also asserts the "sent without their text" note is gone), "shows Retry and Remove on a failed file, keeps Send blocked, and Retry reads it again", `pollFile` and `filesBlockSend` units | pass |
| P | Parity before removing the old path | old `processUpload` vs new `readAttachment`, one-off test run before deletion (below); kept: `filePipeline.integration` › "parity: the job path and the in-request path read every file the same" (11 fixtures: status, code, error, text, pages, reading) | pass |

Old-vs-new parity (one-off, run before `processUpload.ts`, `EXTRACTION_MEMORY_PER_BYTE` and
`oneAtATime` were deleted; status, extracted text, page count and notes compared):

```
notes.txt: old=ready new=ready text+pages+notes equal=true
table.csv: old=ready new=ready text+pages+notes equal=true
readme.md: old=ready new=ready text+pages+notes equal=true
two.pdf: old=ready new=ready text+pages+notes equal=true
blank.pdf: old=ready new=ready text+pages+notes equal=true
long.pdf: old=ready new=ready text+pages+notes equal=true
book.xlsx: old=ready new=ready text+pages+notes equal=true
letter.docx: old=ready new=ready text+pages+notes equal=true
pic.png: old=ready new=ready text+pages+notes equal=true
portal.xls: old=ready new=ready text+pages+notes equal=true
```

Refusals were not part of that comparison: they changed on purpose (thrown 413/415 → a `failed`
row with an ER-9 code).

## Owner defaults used (the owner may change each)

- **OQ-12 send rule:** a processing file blocks Send; a failed file blocks Send until Retry
  succeeds or it is removed. Server: 409 `file_not_ready`.
- **OQ-12 legacy / macro:** `.doc .ppt .docm .xlsm .pptm` refused by name before upload; true OLE2
  under `.xls`/`.docx`/`.xlsx`/`.pptx` refused by sniff; macro content (`vbaProject.bin`) refused by
  pre-flight. Text: "This .docm file contains macros. Save it as DOCX and upload it again." /
  "This .xls file is in an old Office format. Save it as XLSX and upload it again."
- **OQ-12 type list:** `LOCKED_TYPES` = Stage 9 TYPES. Kept in `EXTRA_TYPES` (not removed): `.xls`
  (HTML/XML table exports only), `.odt`, `.rtf`, `.epub`, `.json`, `.log`, `.py`, `.sql`, `.yml`,
  `.yaml`, `.html`, `.htm`, `.css`, `.xml`, `.js`, `.jsx`, `.mjs`, `.ts`, `.mp4`, `.webm`, `.mov`.
  (`.tsx .sh .toml .ini` stay accepted through the existing text-extension fallback.) HEIC is on the
  locked list but not accepted yet (needs a converter, P09).
- **OQ-15 limits** (from `config/numbers.ts`, N-ids in comments) — values that changed:
  | Value | Before | Now |
  |---|---|---|
  | Image size (N-10) | 10 MB | 20 MB |
  | Documents (N-10) | 500 MB (flat) | 100 MB |
  | XLSX (N-10) | 500 MB (flat) | 50 MB |
  | ZIP (N-10) | not accepted | 100 MB / 20 files / 500 MB unpacked |
  | Audio / video (N-10) | 500 MB | 500 MB (unchanged; 3 h not checked) |
  | Uploads per user per day (N-11) | none | 50 |
  | Project chunks per file (E4, no N-id) | 400, silent | 2,000, with `chunk_cap` warning |
  | Extraction memory | per-type formula (DOCX ~11 MB, XLSX ~45 MB …), one at a time | child heap = 4 GiB / 2 = 2 GiB each, 2 at a time |
  | File job attempts (N-44) | — | 3 |
- **ZIP:** `fflate` (already a dependency), plus our own central-directory reader. **No new
  dependency.**
- **SheetJS (VS-16):** VS-16 names openpyxl/csv (Python) only and forbids SheetJS/ExcelJS. No
  Node library is named, so SheetJS (and ExcelJS, already present) now run **only inside the
  isolated child**; replacing them is a follow-up. ExcelJS was not added anywhere new.
- **OQ-25:** `file_jobs` has no `company_id`. Scan stage exists, `FILE_SCANNER=none` (no-op,
  documented in config and ADR-0062). `ocr` / `transcribing` states exist; `ocr` is entered by
  nothing yet; `transcribing` is entered by audio/video, which the repo already transcribed at
  upload before this task (kept, not new).

## Decisions taken in this task (ours unless a source is named)

1. **Failures are rows, not thrown errors.** `complete` and multipart `POST /files` no longer
   answer 413/415 for a file that breaks a rule after upload; the file is `failed` with its ER-9
   code, and the chip offers Retry and Remove (AS-D6). Refusals by name/size still happen before
   any byte is sent (`checkUpload`).
2. **"Nothing to read" is a warning, "broken" is a failure.** An empty workbook, a recording
   with no transcript, or a document over the child's heap stays `ready` with a `not_extracted`
   note (code can still open it, as the old memory gate did); corrupt / encrypted / timeout fail.
3. **The multipart `POST /files` always reads in the request** (≤ `MAX_UPLOAD_BYTES`), and is the
   natural fast path; the browser's direct-upload path uses jobs.
4. **Fast lane = ≤ 2 MB** with one worker slot reserved; worker concurrency 3; extraction
   children 2. G30 names no numbers.
5. **What runs in the child:** officeparser, ExcelJS, SheetJS, pdf.js (project PDFs). Poppler is
   already a separate process with timeouts; plain text needs no parser; transcription/OCR are
   provider calls. The heap limit does not bound Buffers outside the V8 heap; the N-10 file size
   does.
6. **ZIP members are named by their path inside the archive** (`docs/report.pdf`), and macOS
   resource forks / `.DS_Store` / `Thumbs.db` are skipped instead of refused. ZIP64 is refused.
7. **`parent_attachment_id` is `ON DELETE SET NULL`**, so a sent member outlives its unsent ZIP
   being cleaned up. Deleting an unsent ZIP removes its unsent members.
8. **Re-index backfill** is a `reindex` file job per project file below `INDEX_VERSION` 2,
   idempotent per version, started with the worker (`FILE_REINDEX_BACKFILL`, off in tests).
   Tokens are computed at query time from stored chunk text (BM25 in JS), so "rebuilding the
   index" means re-chunking as NFC and lifting the 400 cap; the audit's "existing indexes" are
   the chunk rows.
9. **The worker is started by `index.ts`, not `createApp`** (OpenAPI build must not touch the
   database — mistakes.md 2026-10-15). Test apps start it with polling off.
10. **A refused generate still claims its files** (unchanged order: claim, then model limits).
    `modelLimits.integration` used to resend the same file in a second chat, which worked only
    through the claim bug; it now uploads it again.

## Where the audit and the code disagreed (trusted the code)

- The audit treats the project index as something to "rebuild"; BM25 runs in JavaScript over
  stored chunk text at query time, so no token index exists. Backfill = re-chunk (above, 8).
- D1 #19 says "require project status `ready`". An image or PDF project file is `unsupported`
  for indexing (no text) yet perfectly sendable; those may be picked. Others → `file_not_ready`.
- CLAUDE.md says the suite has "~900 tests (906)"; the baseline run had 1,076 (+19 skipped).

## Not done (and why)

- OCR at upload, Document AI, per-page OCR states (P09). `ocr` state exists, unused.
- ClamAV / real malware scan (P19): no-op scanner behind `FILE_SCANNER`.
- Token counts, derivatives / sidecar, 30k whole-vs-retrieve (P12, needs OQ-08).
- HEIC, EXIF strip, image normalisation; audio 3 h duration check (needs ffprobe).
- SheetJS / ExcelJS replacement (VS-16) — follow-up; both now isolated.
- A separate parser service with no egress (Stage 9 ISOLATION end state); this task isolates by
  child process inside the API container.
- Project-file uploads stay synchronous (they now use the isolated child and the sniff); only chat
  attachments go through `file_jobs`. Re-index uses jobs.
- A real Excel-encrypted fixture (B5 uses a synthetic compound file).
- Logging: new code logs ids, codes, sizes, durations; older `{ err }` log sites elsewhere are
  unchanged (Phase 5 item, CURRENT.md).
- No live verification, no deploy (owner approval needed).
