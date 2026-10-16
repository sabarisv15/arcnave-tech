# ADR-0070: File pipeline and sandbox — fix round after review round 3

- Status: Accepted (task tech-build.3-fix, worker W2, 2026-10-16). Tested by automated gates
  (backend typecheck, the touched test files and the file-pipeline suites; frontend `tsc -b` and
  its suite). Not deployed. The owner verifies live after merging.
- Date: 2026-10-16
- Task: tech-build.3-fix W2: round-3 findings F13, F14, F15, F17 (with F18 and F20), round-2
  finding CR2-5, and build-3 decisions #10 and #14 (`docs/ops/build-3-result.md`).
- Supersedes:
  - [ADR-0066](0066-file-pipeline-review-fixes.md) §8, the round-2 amendments of R3#2 (every EPUB
    member scanned, EPUB detected by layout), R3#4 (a chat ZIP is always a large job) and R1#10
    (any provider error but three codes keeps its retry). ADR-0066 is not edited beyond a status
    line.
  - Build-3 decision #10 (ZIP expansion counts as large) and decision #14 (a missing
    `SANDBOX_SIGNING_SA` only logs at start-up).

## Claude

- **Retries.** Anthropic's own client (`@anthropic-ai/sdk` 0.126.0, `client.js` `shouldRetry`,
  read 2026-10-16 in `backend/node_modules`) retries a request timeout (408), a lock timeout (409),
  a rate limit (429) and server errors (≥ 500), honours an explicit `x-should-retry`, and treats
  every other 4xx as not retryable. ArcNave's turn loop already follows that through each
  adapter's classification (`ProviderError.retryable`, Stage 15 ER-2); transcription now does too.
  Where ArcNave differs, by the Stage 15 matrix: a 429 with zero quota and an account spend limit
  are not retried (ER-2 / ER-2g), and a piece gets at most one retry (M10), not two.
- **Upload processing, XML hardening, job scheduling, sandbox staging.** Claude publishes none of
  this (see ADR-0066 "Claude": the upload article gives limits only). Every rule below is a locked
  stage outcome enforced (Stage 9 ISOLATION / G30, Stage 15 ER-2, Invariants 1 and 5) or is marked
  **ours**.

## ArcNave before this ADR (`fce4a22`)

- `preflight.ts` `MarkupScanner` ('epub' mode) re-ran `indexOf('>')` from every `<!DOCTYPE` it
  found: 1 MB of `<!DOCTYPE a ` took 1 s, 2 MB 7 s, and was not refused (F13). A DOCTYPE longer
  than 4,096 chars was refused only when unclosed, though the comment said otherwise.
- Every EPUB member but `mimetype` and media was scanned (ADR-0066 §8), so an ordinary EPUB with an
  Illustrator SVG (`<!DOCTYPE svg PUBLIC … [ <!ENTITY ns_svg …> ]>`) was refused `corrupt` (F14).
  The premise ("the parser opens what the OPF lists, a chapter may be `.xht` or have no
  extension") is false for the installed reader.
- `audio.ts` retried every provider error except three codes, so a 400, a 413 and an account limit
  (`provider_limit`) were retried; the comment called `provider_limit` retryable (F15). It also
  said "Gemini 429" in a provider-neutral file (F17).
- `fileJobs.ts` marked every chat ZIP job large at claim time, so a small ZIP waited behind any
  large job (CR2-5), against Stage 9 G30 "a small file never waits behind a large one".
- With `SANDBOX_STAGE_BUCKET` set and `SANDBOX_SIGNING_SA` unset, the Job sandbox staged inputs with
  no signed URL and gave outputs none; outputs never came back (the runner uploads an output only to
  a signed PUT URL, `backend/sandbox/runner.py`) and the user saw no typed error (decision #14).

## Decision

### 1. The DTD scanner is a byte state machine (F13)

`MarkupScanner` reads each byte once, its state carried across chunks: a matcher for `<!DOCTYPE` /
`<!ENTITY` (case-insensitive, NUL bytes skipped so UTF-16 in either byte order reads as ASCII) and,
in 'epub' mode, a DOCTYPE parser. 'xml' mode refuses either marker. 'epub' mode refuses any
`<!ENTITY`; it allows a `<!DOCTYPE` naming a root (`[A-Za-z_][\w.:-]*`) only with no `[`, no `<`
outside a quoted literal, no `>` inside one (parsers disagree on where such a declaration ends),
at most `DOCTYPE_MAX_CHARS` (4,096, ours) whether or not it closes, and closed before the part
ends. Time is linear in the member's size: 8 MB of any hostile pattern scans in ≤ 80 ms
(`preflightPass.test.ts`, "the DTD scan is linear on hostile input").

### 2. The EPUB scan follows what the installed reader parses (F14)

`officeparser` 8.0.0's EPUB reader (`dist/parsers/EpubParser.js`, the `extractFiles` predicate)
extracts `META-INF/container.xml`, `*.opf` and `*.xhtml/html/htm` — images only with
`extractAttachments`, which ArcNave never sets (`retrieval.ts` calls `parseOffice(data, { ocr:
false, fileType })`). So:

- `.opf`, `.xhtml`, `.html`, `.htm`: the lenient 'epub' rule, in any container.
- `.xml`, `.rels`, `.vml`: strict, in **every** container including an EPUB, so
  `META-INF/container.xml`, `encryption.xml` and `com.apple.ibooks.display-options.xml` are strict.
  Reason: which reader opens a file is chosen by its name and, for a name with no extension, by the
  type the browser claimed (`storage.ts resolveMime`, `retrieval.ts extractText`), so the
  pre-flight cannot know that an "EPUB" will not be read by the Word or OpenDocument reader, which
  parse every `.xml`. The OCF metadata files carry no DTD in practice. (**ours**)
- Everything else (`.ncx`, `.xht`, a name with no extension, `.svg`, CSS, media) is not scanned: no
  reader we run parses it. The EPUB 2 NCX DTD is therefore accepted (and is also accepted by the
  'epub' rule wherever it appears).
- The rule follows the member, not the container: "is this an EPUB" (by name or layout) no longer
  matters.
- Pinned: a test reads the installed `EpubParser.js`, checks its predicate text, runs it on a book's
  names and asserts each name it reads is scanned. An officeparser upgrade that reads more fails it.

Round-2 tests that asserted the old scope were changed on purpose: ".ncx with an internal subset",
"chapter named ch1.xht" and "chapter with no extension" are now accepted (no reader parses them).

F18: the lenient rule allows an external identifier (`SYSTEM "http://…"`). A test serves a DTD from
a local server, reads an EPUB whose `.opf` and chapter point at it through the isolated reader, and
asserts the server saw no request.

### 3. Transcription retries what the adapter classified retryable (F15, F17)

`audio.ts` `readPiece` retries a piece once, and only when the failure is
`isRetryableProviderError(err)` (new, `providers/types.ts`: a `ProviderError` with `retryable`) or
the piece's own deadline ran out (a timeout). Never a 400, 413 or other 4xx, a quota-0 429, an
account limit, a model or credentials problem, nor an error that is not a `ProviderError` (the
adapter turns every SDK failure into one, so anything else is a bug and repeats). The turn loop
(`providerLoop.ts`) uses the same helper; that change is a pure refactor. A reading that ended
without a natural stop, or empty, is still read once more (unchanged). The provider name is gone
from `audio.ts` (F17). The brand guard (`brandNeutral.test.ts`) checks wording that describes
ArcNave as another assistant, not provider names; 24 non-provider launch files name a provider
today, so widening it is not trivial and is left (see DEFERRED in the task's notes).

### 4. A ZIP is a large job only when it unpacks past the limit (CR2-5; supersedes decision #10)

A chat ZIP is claimed by its stored size like any file. Once the job has the file, `expand` reads
the central directory (`zipExpand.ts plannedUnpackedBytes`: what the members declare; the inflate
never writes more, so it bounds the disk the expansion takes) before writing anything. Over
`FILE_LARGE_JOB_BYTES`:

- the large slot is free on this instance → the job takes it (`ClaimedJob.large`, released when the
  job ends, as for a large file);
- it is taken → the job goes back to the queue in a new lane value `large` (the `lane` column,
  `varchar(8)`, no migration), the claim's attempt given back, the file `queued`. The claim query
  counts a `large`-lane job as large, so it is not claimed again until the slot is free and the
  ending large job wakes the worker: no busy loop, and at most one deferral per job.

At most one large job per instance still holds. A `large`-lane job counts against the normal slots,
never the reserved fast slot. A ZIP claimed in the fast lane that takes the large slot while
running leaves the fast count and counts as normal work from then on, so the pump keeps the fast
slot free; when every normal slot is taken it defers instead (review build-3-fix round 1;
`fileReviewFixes.integration.test.ts` "a fast-lane ZIP that expands large gives up the fast
slot"). A ZIP read inside a request (multipart, `FILE_PIPELINE=sync`) is not a
job and is not limited, as before (ADR-0066 §6). (**ours**: the deferral mechanism; the outcome is
Stage 9 G30.)

### 5. Staging without a signing account fails typed (decision #14)

`CloudRunSandboxClient.runPython`, with a staging bucket and no `SANDBOX_SIGNING_SA`, refuses a run
that has an input file in `workspace/input` or declares expected outputs (`present_files`), before
anything is staged or launched: `SandboxMisconfiguredError` (`tools/sandbox/client.ts`), code
`sandbox_misconfigured`. `runner.py` uploads an output only to its signed PUT URL, so without one
the file is lost; it reads an input without a URL by reference with the Job's own token, which
works only if that account may read the bucket, and otherwise drops the input with a stderr line.
Nothing in the API can check that grant, so a run with an input fails closed too (Invariant 1).

A chat's files are in `workspace/input` for every run, so in a misconfigured deployment no code
runs in a chat that has files until the owner sets `SANDBOX_SIGNING_SA`. Review round 1 first
narrowed the check to outputs only, to keep code running in such chats; review round 2 showed that
reopened the silent input loss, and the check went back to inputs and outputs. What round 1 found
wrong was the copy, which said code without files still runs: the message to the model now says
code cannot run while the conversation has files, not to retry, and that the owner must set it; the
user copy says the same (`cloudRunSandboxClient.test.ts` "a run with an input file fails with
sandbox_misconfigured"). A run with no file still runs. (**ours**: fail closed rather than trust an
unchecked IAM grant.) The start-up log line stays (reworded). The code reaches the
browser on the failed tool result: `ToolResult.errorCode` → `CodeExecutionToolExecutor.run()` keeps
it → `tool_result` SSE frame `errorCode` → the frontend shows `api.errorCopy.sandbox_misconfigured`
on the failed step (`ToolActivity.tsx toolFailureNotice`, looked up by code). The catalog entry is
in `errors.ts` (503). The model gets the message text, which names the setting.

Not changed: when `SANDBOX_SIGNING_SA` is set but signing fails, the client still stages without a
URL silently (`catch {}`), and a stored (reloaded) tool call does not keep its `errorCode` (no
column). Both are recorded as deferred.

## Consequences

- No migration, no new dependency, no new config, no new number (the 4,096-char DOCTYPE limit and
  the one-retry rule are existing values). `file_jobs.lane` gains the value `large`.
- The SSE `tool_result` frame may carry `errorCode`; SSE frames have no route schema, so
  `docs/openapi.json` does not change. `ERROR_CATALOG` gains `sandbox_misconfigured`.
- Two small ZIPs may now run together; a ZIP that unpacks large may be downloaded twice (once to
  read its directory, once when it gets the slot).
- An officeparser upgrade must re-derive the EPUB scan set: the pin test fails until it is.
