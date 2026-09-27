# ADR-0045: Office files are read with code when the turn has a sandbox

- Status: accepted. Tested locally (typecheck, full suite); not deployed.
- Date: 2026-09-27
- Amends: [ADR-0011](0011-upload-follows-claude.md) ("every other document is read as its
  extracted text"), for turns where run_python is available.
- Follows: [`.claude/rules/claude-reference.md`](../../.claude/rules/claude-reference.md)

## Claude

- Claude's app system prompt (capture in `tools/Anthropic/claude-fable-5.1.md`,
  `notes_on_user_uploaded_files`): every upload is on disk; "some types also appear in the
  context window as text (md, txt, html, csv) or image (png, pdf) … Types not in-context must be
  read via the computer."
- Claude Opus 5.5's prompt (`where_files_live`, from the public extract split at
  github.com/cbrunner/opus-5.5-system-prompt-components): text and image attachments "(md, txt,
  html, csv, png, pdf) usually also appear directly in the conversation … while other types (a
  .docx, an .xlsx, audio or video, an archive) do need reading."
- Claude's xlsx skill (github.com/anthropics/skills): a quick look has "no cell coordinates, so
  don't plan edits from it"; formulas and values are read with two `load_workbook` passes.
- Claude's Help Center, "Create and edit files with Claude": uploads such as XLSX need code
  execution; the container has openpyxl, xlrd and python-docx.

## ArcNave before

Every Office file (`.xlsx`, `.xls`, `.docx`, `.pptx`, `.odt`, `.rtf`, `.epub`) was sent to the
model as flattened extracted text on every turn (`providers/attachmentContent.ts`
`attachmentText`). A workbook lost cell addresses, formulas and hidden-sheet state, a large one
crowded the request or was dropped by the history budget, and the skills told the model to
answer from that text.

## Gap

Claude reads these types from the file with code; ArcNave inlined lossy text. That is the same
pattern that let a figure be read off by eye in the PDF case (ADR-0044).

## Decision

1. When the turn has run_python, an Office or e-book attachment is sent as a pointer: its
   identity, fileId, and a note to open it from `input/` in run_python or with
   `read_uploaded_file` (`asReadWithCode`, `omittedReason: 'read_with_code'`). This applies to
   the current turn and to history, in chat and agent mode (`readOfficeFilesWithCode` in
   `services/generation.ts`).
   Only where the sandbox has the readers (`sandboxReadsOfficeFiles` in `tools/catalog.ts`):
   the warm service image (`Dockerfile.service`: xlrd, python-docx, python-pptx, pandoc) and the
   local process engine. The single-use Cloud Run Job image (`sandbox/Dockerfile`) lacks them, so
   with that engine the text is still sent (review on PR #31).
2. Without run_python, the extracted text is still sent: nothing else could read the file, and
   a model with no way to read it would be worse off. This is where ArcNave differs from the
   reference, because its code tool can be off.
3. An uploaded PDF's manifest hint names `pdf-reading`, not `pdf` (review on PR #31).
4. PDFs, images and plain-text types (csv, md, txt, html, json) stay in the conversation, as in
   the reference.
5. The xlsx, docx and pptx skills say how to read the file (pandas and openpyxl, pandoc and
   python-docx, python-pptx) and keep the text fallback for turns without run_python. Their
   descriptions now trigger on any question about an uploaded file of that type.

## Consequences

- A question about a workbook or document costs a tool call when run_python is on; answers come
  from the file, not from lossy text.
- `officeReadWithCode.integration.test.ts` fails if the flattened text reaches either provider
  on a sandbox turn; `attachmentContent.test.ts` covers the types and the no-sandbox fallback.
- Not yet run live.
