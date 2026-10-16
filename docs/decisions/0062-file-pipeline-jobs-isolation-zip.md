# ADR-0062: File pipeline — guards, file jobs, isolated parsers, ZIP

- Status: accepted (task tech-build.1, 2026-10-15). Tested locally (typecheck, full suites,
  frontend build); not deployed.
  2026-10-15: project uploads now go through file jobs, and the lease is 15 min renewed per stage:
  [ADR-0063](0063-files-ingest-and-automated-gates.md) Decisions 2–3.
- Date: 2026-10-15
- Task: tech-build.1 — P01 + P06 + P14 of [`docs/ops/audit/NEW-PLAN.md`](../ops/audit/NEW-PLAN.md)
- Yardstick: [ADR-0061](0061-locked-decisions-win-outside-stack-and-infra.md) — the locked Stage 1,
  9, 12, 15 and 16 decisions are the target; stack and infra may differ.
- Supersedes in part: [ADR-0011](0011-upload-follows-claude.md) Decision 4 (a broken limit is
  "deleted along with its row" with `payload_too_large`) and its Consequence "Extraction is gated
  by measured memory … one at a time per instance"; ADR-0011's 10 MB image limit (status line,
  2026-09-25). ADR-0011 is not edited beyond its status line; its other decisions stand.
- Relates to: [ADR-0004](0004-file-handling-parity.md) (extractors per format, unchanged),
  [ADR-0045](0045-office-files-read-with-code.md) (unchanged), [ADR-0020](0020-project-files-in-context.md)
  (`whole` now also false on a `chunk_cap` warning).

## Claude

Claude's published upload rules (500 MB per file, 20 files per chat, PDF 1,000 pages) are the
ones ADR-0011 cites ([support article][claude]). Anthropic does not publish how the Claude app
processes an upload after the bytes arrive (queue, states, isolation), so nothing here is
"Claude does X"; every rule below comes from a locked stage decision, or is marked **ours**.

## Decision

### Part A — P01 guards (Stage 1 FT-10, Stage 12 LANG-1 / E4, Stage 15 ER-9; D1 #2, #12a, #12b, #17, #18, #19, #23, #34)

1. **Claim guard.** `appendTurn` claims with `message_id IS NULL`; a file already in a sent
   message → 409 `file_already_attached`, never moved.
2. **Shared bytes are reference-checked** (`services/attachments/references.ts`) before any
   delete: project-file delete, attachment delete, unsent cleanup (route and retention sweep).
3. **A picked project file carries its text, page count and status.** Indexing/failed → 409
   `file_not_ready`; `unsupported` is pickable only when a model reads the type natively.
4. **Unicode tokens.** `tokenize` = runs of `\p{L}\p{M}\p{N}`, NFC at index and query time, no
   language logic. Chunk text is stored NFC. `project_files.index_version` (2 = this indexer);
   a `reindex` file job backfills older files (`FILE_REINDEX_BACKFILL`).
5. **Chunk cap 2,000 (E4) and never silent**: a `chunk_cap` warning on the file, and `whole`
   false for the whole-file prompt.
6. **`pdftotext` / `pdftoppm` failures are `unreadable`** with the reason, not
   `storage_unavailable`.
7. **Send rule (owner default for OQ-12):** only `ready` files are sent. One still being read
   blocks Send, and so does a failed one until Retry succeeds or it is removed. Server: 409
   `file_not_ready` (meta lists each file and its status). The "sent without their text"
   disclaimer is gone.
8. **ER-9 codes** in `attachments.error_code` / `project_files.error_code`, copy in
   `fileErrors.ts`; no parser or `String(err)` text reaches a user.

### Part B — P06 (Stage 9 PIPE, INTAKE, LIMITS, ISOLATION, RETRY, LIFE-MORE; Stage 1 FT-2/3/7/11/12/15; Stage 16 FL-5)

1. **`file_jobs` + in-process worker** (`fileJobs.ts`). Claim = `UPDATE … WHERE id = (SELECT …
   FOR UPDATE SKIP LOCKED)`; a lease renewed while running; on lapse another worker takes the
   job (`attempts`+1, at most 3 = N-44). Every write a job makes is fenced on still holding its
   lease. Idempotent per (file, kind, version); Retry = next version. No `company_id`
   (single user, OQ-25 default). Cloud Tasks stays the deferred Phase 5 executor (infra).
2. **States** `queued → scanning → extracting → (transcribing) → ready | failed` on
   `attachments.status`; `ocr` and `indexing` exist for the chip and are entered by nothing yet
   (P09 / P12). `POST /files/:id/complete` → 202; the chip polls `GET /files/:id`.
   `POST /files/:id/retry` re-reads a failed file.
3. **Fast lane (ours: G30 names no size):** files ≤ `FILE_FAST_LANE_MAX_BYTES` (2 MB) are
   `fast`; one worker slot is always kept for them.
4. **Sync path behind a flag.** `FILE_PIPELINE=sync` reads in the request with the same pipeline
   function; `filePipelineParity.integration` holds the two equal. Default: `jobs`. The
   multipart `POST /files` (≤ `MAX_UPLOAD_BYTES`) always reads in the request.
5. **Isolation.** JavaScript parsers (officeparser, ExcelJS, SheetJS, pdf.js) run in a child
   process: heap = `EXTRACTION_MEMORY_BUDGET_BYTES / EXTRACTION_CONCURRENCY`, wall clock
   `EXTRACTION_TIMEOUT_MS`, an environment with no secret. Over the heap → `ready` with a
   `not_extracted` note (code can open the file), as the old memory gate did; over the clock →
   `timeout`. Poppler stays its own process with timeouts; transcription/OCR are provider calls
   and stay in the API. **The memory-per-byte table and `oneAtATime` are removed** (after the
   old-vs-new parity check recorded in `docs/ops/build-1-result.md`).
6. **Pre-flight** for ZIP-based documents (`preflight.ts`), from the central directory, no
   inflate: ratio > `ZIP_MAX_RATIO` (100, ours) on members ≥ 1 MB or > 500 MB unpacked →
   `zip_ratio`; encrypted members → `encrypted`; `vbaProject.bin` → save-as refusal; an XML part
   whose first 4 KB declares `<!DOCTYPE` / `<!ENTITY` → `corrupt` (defusedxml rule).
7. **Intake sniff** (`sniff.ts`, ≥ 2 KB, own table, no new dependency): content must match the
   name. OLE2 under an Office name → `encrypted` when it holds `EncryptedPackage`, else the
   locked "save as" text. `.doc .ppt .docm .xlsm .pptm` are refused by name before upload with
   the same text. `.xls` reaches the sniff: true OLE2 refused, HTML/XML table exports read.
   Password PDF (`pdfinfo` "Incorrect password") → `encrypted`.
8. **Per-type limits** from `config/numbers.ts` (N-10) in `checkUpload` and the frontend's
   `validateFile`: docs 100 MB, XLSX 50 MB, images 20 MB (was 10), audio/video 500 MB, ZIP
   100 MB; `MAX_UPLOAD_BYTES` / `ATTACHMENT_MAX_BYTES` stay as route ceilings.
9. **Upload quota** 50/user/day (N-11, FT-15), counted by an upsert on `upload_quota` before any
   storage URL is issued → 429 `upload_quota_exceeded`.
10. **Scanner** stage runs with `FILE_SCANNER=none` (a no-op); nothing says a file was scanned.

### Part C — P14 (Stage 9 ZIP / TYPES, Stage 1 FT-4, Stage 16 FL-2, UD-2; D1 #1)

1. ZIP accepted (`application/zip`). Central directory first, nothing inflated: encrypted →
   `zip_encrypted`; `..` / absolute / backslash / NUL path → `zip_unsafe_path`; symlink →
   `zip_symlink`; > 20 files → `zip_too_many_members`; an archive member (by name, or by `PK`
   bytes under a non-container name) → `zip_nested`; > 500 MB declared → `zip_too_large_unpacked`;
   ratio → `zip_ratio`; a member `checkUpload` refuses → `zip_member_type`. The `zip_*` codes are
   ours (UD-2 names the cases, not codes).
2. Then each member is inflated from the central-directory offset with a running counter capped
   at its declared size and the 500 MB total; a liar → `zip_ratio`. Only after every member
   passed is anything stored.
3. Members become attachments (`parent_attachment_id`, `ON DELETE SET NULL` so a sent member
   outlives its unsent ZIP) and go through the normal pipeline as their own jobs. The chip
   replaces the ZIP with its members. macOS `__MACOSX/`, `._*`, `.DS_Store`, `Thumbs.db` are
   skipped (ours). ZIP64 is refused (N-10 never needs it).

### Type list (owner default for OQ-12)

The Stage 9 TYPES list is `LOCKED_TYPES`; HEIC is on it but needs a converter (P09) and is not
accepted yet. Types accepted before and not on the list stay, in one `EXTRA_TYPES` constant:
`.xls` (table exports only), `.odt`, `.rtf`, `.epub`, `.json`, `.log .py .sql .yml .yaml`,
`.html .htm`, `.css`, `.xml`, `.js .jsx .mjs`, `.ts` (as `video/mp2t`), `.mp4 .webm .mov`.

### SheetJS (VS-16)

VS-16 names openpyxl/csv (Python) and forbids SheetJS/ExcelJS; no Node library is named. Per
the owner default, SheetJS stays, but only inside the isolated child; ExcelJS (already a
dependency) likewise. No new dependency was added. Replacement is a follow-up (P19 parser
service or a Python sidecar).

## Consequences

- Clients must accept 202 from `complete` and poll; the frontend does. `GET /files/:id` gains
  `errorCode`, `warnings`, `parentId`, `memberIds`; project files gain `errorCode`, `warnings`.
- Failures are no longer thrown at `complete` (413/415): the row is `failed` with its code, and
  Retry / Remove are on the chip (AS-D6). Refusals by name or size still happen before upload.
- A test app's worker does not poll (it runs only the jobs its app queued), and
  `FILE_REINDEX_BACKFILL` is off in tests, because the suite shares one database.
- Not done here: OCR at upload (P09), token counts and derivatives (P12), ClamAV (P19), HEIC,
  audio duration (3 h), page-image budgets (N-13), DOCX/PPTX → PDF visuals.

[claude]: https://support.claude.com/en/articles/8241126-what-kinds-of-documents-can-i-upload-to-claude
