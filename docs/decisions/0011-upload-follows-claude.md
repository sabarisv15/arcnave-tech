# ADR-0011: Step 1 of file handling follows Claude's published rules

- Status: accepted. Stage 2 acts on `reading` for PDFs: [ADR-0013](0013-pdfs-sent-as-page-images-and-text.md).
  2026-09-25: `MAX_UPLOAD_BYTES` (project files and the multipart route) raised from 20 MB to
  30 MB, Claude's per-file limit for project files.
  2026-09-25: an image over 10 MB is refused at upload ("10 MB on claude.ai", Vision). A paste
  longer than 4,000 characters becomes an attached `pasted-text.txt`, as claude.ai turns a long
  paste into an attachment. Anthropic does not publish its threshold, so 4,000 is ArcNave's own.
  2026-09-27: amended by [ADR-0045](0045-office-files-read-with-code.md): with run_python on the
  turn, Office files are read from the file with code instead of sent as extracted text.
  2026-10-15: superseded in part by [ADR-0062](0062-file-pipeline-jobs-isolation-zip.md):
  Decision 4's "deleted along with its row" (a broken limit is now a `failed` file with an ER-9
  code), the memory-per-byte gate and one-at-a-time extraction (now isolated child processes),
  and the 10 MB image limit (now 20 MB, N-10).
- Date: 2026-09-25
- See also: [ADR-0004](0004-file-handling-parity.md) (which extractors read which format)

## Context

ArcNave's file handling is being decoded one stage at a time, with Claude as the reference.
Stage 1 covers what happens to a file between upload and the first model call. At that stage,
ArcNave differed from Claude in four ways:

| | Claude ([support article][claude]) | ArcNave before |
|---|---|---|
| Per-file size | 500 MB | 20 MB. The file passed through one Cloud Run request, capped at 32 MiB. |
| Files per chat | 20 | no limit |
| Types | PDF, DOCX, CSV, TXT, HTML, ODT, RTF, EPUB, JSON, XLSX; JPEG, PNG, GIF, WebP | no ODT, RTF or EPUB |
| PDF | up to 1,000 pages. Up to 100 pages: text and page images. Beyond 100: text only. | no page limit, no text extracted. The PDF bytes went to Gemini, and Gemini's own PDF reader decided. |
| Image | up to 8000×8000 px | no check |
| Other documents | text extraction only | text extraction only (same) |

The model is one API behind an interface, and it can change. If upload processing depends on
one provider's PDF reader, then changing the model changes what the file says.

## Decision

1. **The user can do at least what Claude allows.**
   - All of Claude's types are accepted.
   - Every type ArcNave already accepted stays accepted: PPTX, audio, video, code and text files.
   - Limits: 500 MB per file (`ATTACHMENT_MAX_BYTES`), 20 files per chat, 1,000 PDF pages, and
     8000 px per image side. These are the limits from `FILE_LIMITS` in
     `backend/src/services/attachments/processUpload.ts`.
2. **Large files go straight to storage.**
   - `POST /files/uploads` checks the name, type and size, then creates a row with status
     `uploading`.
   - With GCS storage, it returns a resumable-upload session URI. That URI can write that one
     object and nothing else. The browser PUTs the bytes to the URI, so they never pass through
     Cloud Run.
   - With local storage, it returns `PUT /files/:id/content`, which streams the bytes to disk.
   - `POST /files/:id/complete` confirms that the stored size equals the declared size. Only
     then does it read the file.
   - The multipart route `POST /files` still exists, for scripts and tests. It keeps the
     20 MB `MAX_UPLOAD_BYTES` limit.
3. **Upload processing does not depend on the model.**
   - PDFs are counted with `pdfinfo`, and their text is read per page with `pdftotext`. This
     runs locally with poppler, which the backend image already contains.
   - Upload records a `reading` value, which says how any model will be shown the file:
     - `text+visual`: a PDF of 100 pages or fewer
     - `text`
     - `visual`: an image
     - `media`: audio or video
     - `none`
   - Audio and video transcription is the one exception. It stays with `visionProvider`,
     because nothing local can do it.
4. **A broken limit is a refusal, never a silent cut.**
   - A PDF over 1,000 pages, or an image over 8000 px, is deleted along with its row. The
     client gets `payload_too_large` with the reason.
   - A file that is too large to extract, or a long PDF with no text layer, stays `ready` and
     carries a note. It is not marked `unsupported`, because only `ready` files reach later
     turns and code.
   - Extracted text is kept whole; the old 200,000-character upload cap is gone. As in Claude,
     the limit is the answering model's context window, and that is checked when the file is
     sent (stage 2), from exact token counts.

## Consequences

- **Bucket CORS.** The GCS bucket needs a CORS rule for the site's origin. The steps are in
  [`docs/deploy/direct-upload.md`](../deploy/direct-upload.md). Without the rule, a
  cross-origin PUT from the browser fails, and the file shows "The upload did not finish".
- **Extraction is gated by measured memory, not by a flat size.**
  - The in-process parsers build a whole document tree. Measured peak memory per byte of
    file: DOCX ~370×, ODT ~210×, XLSX ~90×, EPUB ~80×, XLS ~35×, RTF ~20×, PPTX ~16×, and
    CSV/text and PDF (poppler) ~2×. One 44 MB workbook peaked at 3.8 GB.
  - The measurements are in `EXTRACTION_MEMORY_PER_BYTE`. Each type's size limit is
    `EXTRACTION_MEMORY_BUDGET_BYTES` divided by its ratio. The budget is 4 GiB on the 8 GiB
    backend.
  - A larger file is stored and marked `ready` with a note, so code can still open it.
  - Extractions run one at a time per instance.
  - Resulting limits: DOCX ~11 MB, ODT ~19 MB, XLSX ~45 MB, EPUB ~51 MB, XLS ~117 MB, RTF
    ~204 MB, PPTX ~256 MB, and text and PDF up to the 500 MB upload limit.
  - This is a measured boundary, not a match with Claude. Claude extracts larger Office files.
    Closing the gap needs streaming parsers or more memory; the budget should rise only
    together with the memory.
- **Stage 2 is still open.** Stage 1 records `reading`, but the provider adapters do not act on
  it yet. PDFs still go to Gemini as bytes, so a PDF over 100 pages is still shown to Gemini
  visually. The sandbox's per-workspace disk and the file preview panel also still assume
  small files. All of this is stage 2 of the decode.

[claude]: https://support.claude.com/en/articles/8241126-what-kinds-of-documents-can-i-upload-to-claude
