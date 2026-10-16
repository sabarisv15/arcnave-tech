# tech-build.3 — what is still pending (explain.3)

Read-only explanation of `build/gateway-security` @ `fce4a22` (task explain.3, 2026-10-16). No
code, config or deploy change. Written by the main session (Opus 5.5) from the code, the
pre-squash commits (still present locally: round-2 range `a2cfdda` → `f4efc41`, whose `backend/`
and `arcnave-frontend/` trees are identical to `fce4a22`), and a third review round run for this
task. Where the build-3 docs and the code disagree, this file says so.

## Summary (moonu line)

- **Open MAJOR items: 6** — all from the round-3 review of the round-2 fixes (section 1c), each
  re-checked by main: F1 project filenames raw in the system prompt; F2 web_fetch cleaning regexes
  quadratic; F3 web_fetch drops real page text after `</style >` / `<style-guide>`; F13 EPUB DOCTYPE
  scan quadratic (1 MB → 1 s, 2 MB → 7 s, measured); F14 an EPUB with an ordinary Illustrator SVG is
  now refused; F15 audio now retries a 400 (breaks the Stage 15 never-retry rule). Plus one
  reviewer-MAJOR main rates MINOR (F16). Three of the six (F3, F14, F15) were made by round 2.
- **P05 split:** ithu Prompt 4-ku munnadi oru thani chinna task-a pannanum (missing
  characterization scenarios mudhalla, apram split) — P08-la fold panna move-um behaviour change-um
  kalandhu, snapshot proof poyidum (section 2e).
- **Merge build-3?** **Yes, after X:** the six MAJORs fixed (all small and local, ~1 day with
  their tests) and the two owner settings (`CORS_ORIGINS` exact; `SANDBOX_SIGNING_SA` if the Job
  sandbox uses a staging bucket). Reason: everything else in build-3 is a net gain, but F2/F13 let
  one hostile page or file stall the API, and F14/F15/F3 are regressions build-3 itself made.

---

## 1. Round 2 of the review — the fixes nobody reviewed

### 1a. Every round-2 finding and its fix

Round 2 ran on `7ee58a3..a2cfdda` (round-1 fixes). Its fixes landed in `eff19a8` (worker D),
`fd7fbab` (worker A), `63cd8f9` (worker B) and `a2cfdda` (main). "Fails without fix" was
**proved for this task** by reverting only the fixed file(s) to `a2cfdda` in a scratch worktree
and running the test file (or by a targeted mutation where the fix was tests-only).

| Id | Sev | file:line (now) | What was wrong | Fix | Covering test | Fails without fix? |
|---|---|---|---|---|---|---|
| CR2-1 / R4#1 | MAJOR | `backend/src/services/attachments/preflight.ts:46`, `:179` | `.ncx`/`.opf` scanned strictly → an ordinary EPUB 2 `toc.ncx` with `<!DOCTYPE ncx PUBLIC …>` failed as `corrupt` (regression made in round 1) | EPUB parts use the `epub` rule: DOCTYPE with any root name allowed only without `[`; any `<!ENTITY` refused (`:179`) | `preflightPass.test.ts:293` "accepts an EPUB 2 toc.ncx with its NISO DOCTYPE"; `:298` "refuses the same NCX with an internal subset" | `:293` **yes** (reverted `preflight.ts` → fails). `:298` passes on old code too (old code refused every NCX DOCTYPE) — it guards the new rule, not the fix. |
| CR2-3 | MAJOR (premise false — see F14) | `preflight.ts:52`, `:98`, `:103-108` | EPUB parts chosen by extension; a chapter named `.xht` or with no extension was never scanned (but officeparser never parses such members, so this closed no real path and opened F14) | every EPUB member scanned except `mimetype` and media extensions (`:52`); EPUB detected by name or by layout (`:98`) | `:309` "refuses an entity-laden chapter with no extension"; `:304` "…named ch1.xht"; `:316` "accepts a normal EPUB with images, a font and a stylesheet" | `:316` **yes** (revert). `:309`/`:304` pass on the old code **for the wrong reason** (the fixture's NCX DOCTYPE made the old code refuse the whole book). Mutation proof: removing only the every-member line (`:106`) fails `:309`; `:304` still passes (`.xht` is in the extension regex `:46`). |
| CR2-6 / R4#2 | MAJOR | `backend/src/providers/attachmentContent.ts:74-76`; sites `manifest.ts:73`, `fileBudget.ts:97`, `retrieval.ts:456`, `:569`, `compaction/autoCompact.ts:171`, `tools/codeExecutionExecutor.ts:513-514`, `attachmentContent.ts:81`, `:85` | round 1 used attribute escaping in plain text (`R&amp;D`), and the manifest / excerpt note still had raw names | `filenameInText`: `<`/`>` → `&lt;`/`&gt;`, C0/C1 controls + U+2028/2029 → space; `&`, quotes kept | `attachmentContent.test.ts` "filenameInText leaves &, quotes…", "names the file as stored in the page label and the attachment note", `:159` "a hostile name cannot close a tag…"; `manifest.test.ts:37`; `routes/fileDerivatives.integration.test.ts:209` | **yes**, all five (revert of the three files). Note: the revert also failed 4 unrelated tests in `fileDerivatives.integration.test.ts` (mixed old/new tree), so that revert is not perfectly isolated. **But one site was missed** — round 3 F1. |
| CR2-2 | MINOR (fix regressed — see F15) | `backend/src/services/attachments/audio.ts:32`, `:135` | no-retry `break` hit every `ProviderError` with `retryable:false`, i.e. unclassified ones too | skip the retry only for `provider_quota_unavailable`, `model_unavailable`, `context_overflow` | `untrustedTools.test.ts:240` "a retryable or unclassified provider error, or any other failure, gets its one retry"; `:235` | `:240` **yes** (revert). `:235` passes on old code too (quota was already skipped). |
| CR2-7 | MINOR | `backend/src/services/webFetch.ts:62` | a page cut inside `<script>` kept raw JS | drop an unclosed `<script`/`<style` to the end | `webFetch.test.ts:51` "a truncated page ending mid-script yields no script text" | **yes** (revert). **But the fix itself has a defect** — round 3 F3. |
| R4#4 | MINOR | `backend/src/services/safeFetch.test.ts:429`, `:443` (code `safeFetch.ts:295-297`, `:398` unchanged) | no test reached the connect timeout or the deadline across the address loop | two tests with a fake connector | `:429` "an address that never connects times out after the connect timeout and the next is used"; `:443` "the overall deadline stops the address loop…" | **Only partly.** Mutations: removing the real per-address timer (`safeFetch.ts:296`) → both still **pass**; removing the loop's deadline check (`:398`) → both still **pass**; not passing `connectTimeoutMs` (`:400`) → both fail. The real timer and the loop check stay untested (round 3 F7). |
| CR2-10 / R4#5 | MINOR | `backend/src/plugins/security.ts:36-43` | docblock contradicted the same-origin pass | comment fixed | none (comment) | n/a |

### 1b. Code that changed after the last review pass

History was squashed into `fce4a22`, but the pre-squash objects are still in the local repo, so
the range is exact: `git diff a2cfdda f4efc41 -- backend arcnave-frontend` (16 files, +306 / −56).
Code (non-test) files:

| File | Function / place | ≈ lines |
|---|---|---|
| `backend/src/services/attachments/preflight.ts` | `XML_PART`, `EPUB_MARKUP_PART`, `EPUB_UNSCANNED` (`:40-52`), `preflightContainer` EPUB detection (`:98`), new `scannerFor` (`:103-108`), `streamingPass` signature, `MarkupScanner` mode `epub` (`:179`) | ~57 |
| `backend/src/services/attachments/audio.ts` | `NO_RETRY_CODES` (`:32`), retry loop in `transcribe` (`:135`) | ~19 |
| `backend/src/providers/attachmentContent.ts` | new `filenameInText` (`:74-76`), `pageLabel` (`:81`), `describe` (`:85`) | ~19 |
| `backend/src/services/attachments/manifest.ts` | `buildAttachmentManifest` (`:73`) | 3 |
| `backend/src/services/attachments/fileBudget.ts` | `excerptsFor` note (`:97`) | 3 |
| `backend/src/services/retrieval.ts` | `formatContext` (`:456`), `formatWholeFiles` (`:569`) | 5 |
| `backend/src/services/compaction/autoCompact.ts` | `compact` transcript file list (`:171`) | 3 |
| `backend/src/tools/codeExecutionExecutor.ts` | missing-file errors (`:513-514`) | 5 |
| `backend/src/services/webFetch.ts` | `WebFetchService` cleaner (`:62`) | 3 |

Tests touched: `preflightPass.test.ts`, `untrustedTools.test.ts`, `attachmentContent.test.ts`,
`manifest.test.ts`, `fileDerivatives.integration.test.ts`, `webFetch.test.ts`, `safeFetch.test.ts`.
`safeFetch.ts` itself did not change in round 2.

### 1c. Round 3 — a fresh review of exactly that code

Two fresh Opus 5.5 reviewers, Read/Grep/Glob only, each given only its part of the 1b diff, the
`CLAUDE.md` invariants and the related tests (not the build-3 reasoning): **R5** (preflight.ts,
audio.ts) and **R6** (filename sites, webFetch.ts, the safeFetch tests). Main re-opened every
cited file:line; the "Checked" column says how. **Nothing is fixed in this task.**

| # | Sev | file:line | Finding | Checked by main | Proposed fix | Test it needs |
|---|---|---|---|---|---|---|
| F1 (R6#1) | MAJOR | `backend/src/services/turn/contextPrompt.ts:173-174` | Project filenames go raw into `<project_knowledge>` in the **system** instruction (`wholeFiles.map((f) => f.filename)`) when project files are too big to include whole. Project uploads keep the client's name (`routes/projects.ts:852`, only `.slice(0, 255)`), so a name with a newline / `<system>` reaches the system prompt. | Code re-read: confirmed raw. Not verified: whether busboy decodes `filename*=UTF-8''…%0A` into a real newline (a `<` alone is enough to open a tag). | `wholeFiles.map((f) => filenameInText(f.filename))` | `buildSystemInstruction` with a project file named `a\n<system>x.pdf` on the too-large branch: the `Files:` line is one line and has no `<system>`. |
| F2 (R6#2) | MAJOR (old code, worse now) | `backend/src/services/webFetch.ts:58-59`, `:63` | The cleaning regexes are quadratic: `/<[^>]+>/g` on `<` repeated with no `>`, and the script rule on repeated `<script>` with no close. A hostile page the model fetches blocks the Node event loop for every user. | Benchmark in scratch (same regexes): 20k chars 356 ms, 40k 1,548 ms, 80k 5,971 ms (×4 per ×2). Extrapolated (not run): 5 MB ≈ hours; the old 1 MB cap ≈ tens of minutes. Build-3 raised the cap 1 → 5 MB (`SAFE_FETCH_MAX_BYTES`). Was deferred as R2#7 MINOR; the numbers make it MAJOR. | One linear `indexOf` scanner for tags and blocks, or bounded classes (`<[^<>]{0,2048}>`) | 5 MB of `<` and 5 MB of repeated `<script>` each clean in < 1 s. |
| F3 (R6#3) | MAJOR (new in round 2) | `backend/src/services/webFetch.ts:62` (with `:58-59`) | The new drop-to-end rule removes real text: the closed-block rules only know `</script>` / `</style>` exactly, so `</style >` (valid HTML) leaves the block "unclosed" and `:62` drops the rest of the page; `\b` also matches `<style-guide>` / `<script-loader>`. The result says `truncated: false`, so a cut page is reported as complete. | Scratch run of the same regexes: `<style>a{}</style ><p>After</p>` → `" "` (all text gone); `<p>Before</p><style-guide>Kept</style-guide>` → "Kept" gone. | `<\/script\s*>` / `<\/style\s*>`; `<(script\|style)(?=[\s>/])`; apply `:62` only when the body was truncated | `<style>a{}</style ><p>After</p>` keeps "After"; `<style-guide>Kept</style-guide>` keeps "Kept"; a truncated page ending mid-script still yields no script. |
| F13 (R5#1) | MAJOR | `backend/src/services/attachments/preflight.ts:162-180` (comment `:150`) | In `epub` mode a closed DOCTYPE has no length limit and `doctype.exec` restarts inside each declaration it already judged, so one chunk of `<!DOCTYPE a ` repeated is superlinear. The comment says a DOCTYPE longer than `DOCTYPE_MAX_CHARS` is refused; the code refuses only an unclosed one. Reachable now through every EPUB member and `.opf/.ncx/.xht` in any ZIP; one 4 KB compressed read can inflate to ~4 MB per push, and the deadline is checked only between pushes (`:116`, `:128`). | Timed the real `MarkupScanner` (scratch, `tsx`): 1.04 MB → 1.0 s, 2.1 MB → 7.2 s, **not refused** either time. 4 MB not run (extrapolated tens of seconds of blocked event loop per push). | look for `>` only within `DOCTYPE_MAX_CHARS`, refuse a longer declaration, set `doctype.lastIndex = end + 1` | `new MarkupScanner('epub').push(enc('<!DOCTYPE a '.repeat(87000) + '>'))` returns true in < 200 ms |
| F14 (R5#2) | MAJOR (new in round 2) | `preflight.ts:52`, `:106` | The EPUB catch-all scans `.svg` (not in the unscanned list). Illustrator's SVG 1.1 export carries `<!DOCTYPE svg PUBLIC … [ <!ENTITY …> ]>`, so an ordinary EPUB with such an image is refused `corrupt`. No parser reads it. | Code re-read, including `backend/node_modules/officeparser/dist/parsers/EpubParser.js:37-40`: officeparser's EPUB reader extracts only `META-INF/container.xml`, `*.opf` and `*.xhtml/html/htm` (images only with `extractAttachments`, which we do not set). **So the reason in `preflight.ts:48-50` / ADR-0066 §8 and the premise of round-2 finding CR2-3 ("the parser opens what the OPF lists; a chapter may be `.xht` or have no extension") is false for officeparser 8: `.ncx`, `.xht` and extension-less members are never parsed.** How often such SVGs appear: not measured. | scan exactly what the parser reads (container.xml, `.opf`, `.xhtml/.html/.htm`) strictly enough, or at least add `svg` to the unscanned list; correct the comment and ADR-0066 | an EPUB containing an Illustrator-style SVG resolves |
| F15 (R5#4) | MAJOR (regression in round 2) | `backend/src/services/attachments/audio.ts:32`, `:135` with `providers/gemini.ts:306-311` | `classifyGeminiError` returns a 400 / 413 / non-model 404 as `provider_error`, `retryable:false`, with `statusCode`; the round-2 rule retries every code not in `NO_RETRY_CODES`, so these are now retried once — against the Stage 15 ER-2 never-retry rule; a systematic 400 over a 3-hour recording doubles the requests. The comment (`:29-30`) and the test call `provider_limit` retryable; it is Anthropic's spend limit, never-retry. | Code re-read: confirmed (round 1 had `break` on `retryable:false`, which was right for a 400; round 2 replaced it). | retry only when `err.retryable`, or `provider_timeout`, or `provider_error` with no `statusCode`; add `provider_limit` to the no-retry set | `new ProviderError('x', { statusCode: 400 })` → 1 call; `{ code: 'provider_limit' }` → 1 call; a `{ code: 'model_unavailable', retryable: true }` case so the code test can fail |
| F16 (R5#3) | reviewer MAJOR, **main MINOR** | `preflight.ts:84`, `:118`; `zipReader.ts:11` vs officeparser's streaming `Unzip` (local headers) | The pre-flight judges central-directory names and sizes; the parser reads local headers, so a local entry renamed or not listed in the central directory skips the scan and the ratio/total checks. | Mismatch confirmed by reading; main rates MINOR: pre-existing since build-1, the parser runs in a child with a V8 heap and time limit (`isolatedExtract.ts:4`, `:46`) — but Buffers outside the heap are not bounded (`:15`); "xmldom 0.9 does not expand the internal subset" is the reviewer's, **not verified** by main | refuse when a local name differs from its central name or bytes are unaccounted for | a ZIP whose local and central names differ is refused |
| F17 (R5#5) | MINOR | `audio.ts:27` | "Gemini 429" in a provider-neutral launch file (Invariant 7) | confirmed | "a 429 with zero quota" | brand guard covers comments? (check `brandNeutral` scope) |
| F18 (R5#6) | MINOR | `preflight.ts:148-150` | `<!DOCTYPE x SYSTEM "http://…">` passes; safe only because the parsers never fetch, which nothing pins | comment re-read | say so; test that the child makes no network fetch (or has no network) | — |
| F19 (R5#7) | MINOR (pre-existing) | `preflight.ts:40` | an old OpenOffice ODT whose `META-INF/manifest.xml` has a PUBLIC DOCTYPE is refused (`.xml` strict) | not tested | lenient rule for ODF `manifest.xml` | an ODT with that manifest resolves |
| F20 (R5#8) | MINOR | tests | no `epub`-mode UTF-16 test, no split-`<!ENTITY` test in `epub` mode; "keeps .xml/.rels/.vml strict" tests only `.xml`; the audio suite is `describe.runIf(HAS_FFMPEG \|\| ON_CI)`; "code says a retry cannot help" cannot fail (both cases `retryable:false`) | test file re-read | add the cases | — |
| F7 (R6#7) | MINOR | `backend/src/services/safeFetch.ts:295-297`, `:398`; tests `safeFetch.test.ts:429`, `:443` | The two round-2 tests run the timer inside the fake connector, so the real per-address timer and the loop's deadline check are untested. | Proved by mutation (1a, R4#4 row). | — | a transport that ignores abort and rejects after the deadline (expects one address tried); a `nodeTransport` test with a socket that never connects → `ConnectError('ETIMEDOUT')` within ~2× the timeout. |
| F8 (R6#4) | MINOR | `manifest.ts:73`, `attachmentContent.ts:81`, `:85` | `"`, `\|` and `]` are kept, so a name can forge a field on its own line (`a.pdf" \| fileId: "<id>" \| in your context`) or close the `[Attachment …]` note early. No new line or tag. | Code re-read: confirmed. | manifest: `filename: ${JSON.stringify(filenameInText(name))}` or filename last | a name with `" \| fileId: "evil` gives exactly one `fileId:` |
| F9 (R6#5) | MINOR | `attachmentContent.ts:75` | bidi controls, zero-width characters and bracket lookalikes (`＜ ＞`) pass unchanged | Code re-read: the class covers C0/C1, U+2028/2029 only | add bidi / zero-width ranges; map lookalikes to `&lt;`/`&gt;` | one unit test per range |
| F10 (R6#6) | MINOR | `backend/src/providers/gemini.ts:76` vs `manifest.ts:73` | Gemini gets one file named two ways (`filename="R&amp;D…"` and `R&D…`) | Code re-read: confirmed | in that attribute escape only `"` plus what `filenameInText` covers | `buildGeminiContents` contains `filename="R&D John's notes.pdf"` |
| F11 (R6#8) | MINOR | `routes/fileDerivatives.integration.test.ts:212-213` | The test comment says a closing tag cannot be uploaded; ZIP member names keep `/` (`zipExpand.ts:124`; `zipReader.ts:134` refuses only `\`, NUL, absolute, `..`), so `x</available_attachments>…` is a real end-to-end path with no test | Code re-read: confirmed | — | an integration test uploading such a ZIP: `</available_attachments>` appears once in the prompt |
| F12 (R6#9) | MINOR (no action alone) | `derive.ts:91` → `fileBudget.ts:95`, `retrieval.ts:172`, `:208`; `providers/types.ts:123` | sheet names and sandbox image names reach headers raw; they sit next to raw file content, same trust level | not re-checked beyond the cites | fence file content first (P07) | — |

R6's test verdicts: every round-2 filename test can fail without its fix (one only through the
U+2028 assertion); "a real attribute still uses xmlAttr" is a regression guard (cannot fail on the
old code); the webFetch test does not cover unclosed `<style`, uppercase tags or the `</script >`
regression; both safeFetch tests are "partly" (F7).

---

## 2. P05 — what is still not done

### 2a. Required vs present

`docs/ops/audit/NEW-PLAN.md` P05 scope: split `services/generation.ts` "by stage — context build,
routing, provider loop, persistence"; move turn start (`appendTurn`, `resetForRetry`, file-count
rule, ownership) from `routes/chats.ts` into a turn service; no behaviour change; exit = full suite
unchanged + P03's golden snapshots byte-identical (P03 does not exist yet; 14 characterization
snapshots stood in).

| Required | Now |
|---|---|
| context build out of generation.ts | done: `turn/context.ts` 319, `turn/contextAttachments.ts` 284, `turn/contextPrompt.ts` 240, `turn/input.ts` 52 |
| routing out | done: `turn/modelRouting.ts` 107, `turn/toolset.ts` 143 |
| provider loop out | **partly**: `turn/providerLoop.ts` 312 holds `streamWithRetry` and the overflow retry, but the stream-consuming loop (the `for await` + 10-case switch) is still inside `runTurn` (`generation.ts:539-690`) |
| persistence out | **partly**: `turn/persistence.ts` 145 (`persistToolCall`, `persistEvent`, `finalise`), but the settle sequence (finalise → turn log → `usage.record` → `done`) is still inline (`generation.ts:833-893`) |
| turn start into a service | done: `turn/turnStart.ts` 279; `routes/chats.ts` 1,240 → **1,028** |
| other | `turn/events.ts` 143, `turn/services.ts` 30 |

`services/generation.ts` = **915** lines; `runTurn` = **`generation.ts:142-914`, 773 lines**, with
**24 forward stages + outer catch + outer finally (26 blocks)**, 21 yield sites, 3 nested try
blocks, ~17 `let`s and ~15 mutated collections shared across stages (map below, from a read-only
Sonnet helper, spot-checked by main at `:125`, `:142-147`, `:160`, `:512-520`, `:691-700`, `:785`,
`:894-914`).

Stages of `runTurn`: 1 init + workspace (`:143-158`, **outside every try**) · 2 prefs/project/
compaction row (`:160-169`) · 3 history (`:170-194`) · 4 model resolution + history reload
(`:196-230`) · 5 capability gates (`:232-272`) · 6 `start` (`:274-280`) · 7 compaction
(`:282-295`) · 8 tools/routing (`:297-339`) · 9 skills (`:341-353`) · 10 system instruction +
context events (`:354-376`) · 11 effort (`:377-387`) · 12 budget reservation + `releaseReservation`
closure (`:389-401`) · 13 segments + executors (`:403-421`) · 14 attachments (`:423-475`) ·
15 request (`:477-510`) · 16 turn state init (`:512-537`) · 17 stream loop (`:539-690`) ·
18 stream catch: partial / cancel / error (`:691-759`) · 19 release (`:760-762`) · 20 text
(`:764-765`) · 21 forced answer (`:767-831`, calls `provider.stream` directly at `:785`, not the
retry wrapper) · 22 finalise (`:833-848`) · 23 log + `usage.record` (`:850-871`) · 24 debug +
`done` (`:873-893`) · 25 outer catch (`:894-899`) · 26 outer finally: timing, `turn_logs`, workspace
cleanup (`:900-913`).

### 2b. Why `runTurn` stayed one generator (the real reason)

1. **Shared mutable state, written in one stage and read in another.** `status` is written at
   `:713`, `:715`, `:812`, `:820` and read at `:769`, `:819`, `:841-843`, `:852`, `:869-870`, `:875`;
   `usage`, `finishReason`, `errorCode`, `endedPartial`, `text`, `collectedText`, `segments`,
   `toolsCalled`, `turnCalls`, `searchEntryPoint`, `eventOrdinal` likewise span stages 17 → 24.
   Splitting means passing or returning ~15 values, or a state object — a rename of every use,
   which is not a cut-and-paste.
2. **Closures that capture those locals and run while `runTurn` is suspended.** `releaseReservation`
   (`:395-401`) captures `reservationHeld`/`prefs`/`maxOutputTokens` and is called from inside
   `limitToModel` (`turn/contextAttachments.ts:182`), the catch (`:734`) and the finally (`:761`);
   the tool executors built at `:406` push into `segments` and `pendingUiEvents`
   (`turn/toolset.ts:94-102`) while the adapter is mid-stream at `:548`.
3. **Generators and try/finally.** 21 yields across stages; the stream catch (`:691-759`) yields
   and `return`s from inside the outer try so the outer finally (`:900-913`) still writes the turn
   log and cleans the workspace. Moving a yielding block into a helper needs `yield*` and
   explicit return values for every early exit; a missed `return` would emit a second terminal
   event or skip the finally — exactly the class of bug snapshots must catch.
4. **Snapshot coverage was too thin for those paths.** The 14 scenarios do not reach stop/abort
   mid-stream, the turn deadline, compaction, the overflow retry, `sources`/`code`/`ui_draft`
   events, the forced-answer failures, budget refusal or `ModelNotFoundError` (2c). Moving the
   stream loop and the settle without them would have been unproved.
5. **Context.** The brief said "mechanical moves only, no while-I'm-here fixes"; the worker chose
   the part that could be proved byte-identical and left the rest, saying so (ADR-0067).

### 2c. A concrete split plan

Introduce one `TurnState` object first, then extract generators that take `(svc, ctx, state)` and
`yield*` from `runTurn`.

| Step | New function | Inputs | Outputs / effects | Shares | Snapshots that cover it |
|---|---|---|---|---|---|
| 0 | — add the missing scenarios (list below) first, one commit, on the unsplit code | | | | — |
| 1 | `TurnState` (object holding `usage`, `finishReason`, `status`, `errorCode`, `endedPartial`, `collected*`, `segments`, `toolsCalled`, `turnCalls`, `eventOrdinal`, `searchEntryPoint`, `answerGuard`, `pending*`, `draftSent`) | — | rename of locals at `:512-537` and every use | everything after stage 16 | all 13 turn scenarios |
| 2 | `settleTurn` (stages 22-24) | svc, input, entry, prefs, state, timing, turnLog, reasoningEffort, routing/loadedSkills | finalise, `usage.record`, yields `debug` + `done` | `state`, `logOutcome` | plain (L263), files (L277), tool loop (L295), forced (L317), retry (L339), partial (L358), search/regenerate (L413), Gemini (L515), Claude (L569). **Not:** a stopped turn (no `done`) |
| 3 | `forcedAnswer` (stage 21) | svc, request, provider, turnCalls, state | yields deltas / error; sets `state.status`, `errorCode`, `text` | `state` | L317 (success only). **Not:** `:809-817` failure, `:819-830` empty_response |
| 4 | `streamAndCollect` (stages 17-19) | svc, provider, request, state, `releaseReservation`, `addSegment`, `pendingUiEvents`, executors | yields every stream event; on failure yields `error` and returns a flag `ended` so `runTurn` returns (keeps the outer finally) | `state`, closures | delta/thinking/tool/progress (L295), retry (L339), partial (L358), refusal (L378), stream error (L392), Gemini/Claude wire. **Not:** `sources`, `code`, `ui_draft`, pending UI drain, stop, deadline, `ModelNotFoundError`, overflow retry |
| 5 | `buildTurnContext` (stages 8-15) | svc, input, prefs, project, history, entry, provider, flags | `{ request, routingDecision, loadedSkills, releaseReservation, segments, executors, … }`; yields context events (stage 10) | `segments`, reservation closure | plain, files, png, search (L413), code-exec refusal (L403, partly). **Not:** project, web on, sandbox, skills read, non-empty context events, effort, budget refusal |
| 6 | `prepareTurn` (stages 2-5) + `compactStage` (stage 7) | svc, input | `{ input', prefs, project, history, historyAlias, latestCompaction, entry, provider, modelInfo, grounded }`; compaction yields research events | `input` is reassigned at `:193` — return it | Auto + named models, code-exec refusal (L403). **Not:** no adapter (`:226-230`), research/search without grounding (`:237-247`), any compaction (`:282-295`, `latestCompaction` non-null) |

Order: 0 → 1 → 2 → 3 → 4 → 5 → 6, one commit each, the snapshot file unchanged after every step
(as in build-3: `git diff <step-0> <step-n> -- '*.snap'` empty).

**Paths with no snapshot yet — add before step 1:** stop/abort mid-stream (`:712-713`, `:841-843`,
no `done` at `:875`); turn deadline (`:695`, `:716-719`); compaction trigger and reload (`:282-295`);
context-overflow retry (`turn/providerLoop.ts:90-122`); `sources` + `searchEntryPoint` (`:574-584`);
`code` event (`:586-593`); `ui_draft` (`:595-606`) and the pending UI drain (`:650-652`);
forced-answer failure and empty_response (`:809-830`); `ModelNotFoundError` (`:692-694`); budget
refusal at `usage.reserve` (`:392`); a project chat (project executor, `<project_knowledge>`);
skills read; non-empty context events (`:365-368`); a turn with `effort`. (`max_tokens` and
`pause_turn` have no branch in `runTurn`; they pass through.)

### 2d. Effect of the unsplit `runTurn` on later phases

| Phase | Effect | Why |
|---|---|---|
| P07 system prompt | slows a little | prompt assembly already lives in `turn/contextPrompt.ts`; only its inputs come from `runTurn` locals |
| P08 durable runs | **blocks / riskier** | it changes `run`/`runTurn` lifecycle itself: persisted turn parameters, lease, settle order (A-05), I/O outside transactions (A-21), throttled text flush — all inside stages 17-24 |
| P10 routing profiles | slows | `resolveModel`/`routeTurn` are in `turn/modelRouting.ts`, but effort and flags are set in stages 4-11 inline |
| P11 error matrix | **riskier** | the error branches live in the stream catch (`:691-759`), which has no snapshot for deadline / stop / ModelNotFound |
| P13 history budget, summary | **riskier** | compaction (stage 7) and the history reload have no snapshot at all |
| P15 output validation | riskier | it edits the answer guard inside the stream loop and the settle (`:559`, `:676-683`, `:705-711`, `:794-800`), shared state |

### 2e. Recommendation

| Option | Cost | Risk |
|---|---|---|
| A. Own small task before Prompt 4: step 0 (≈ 12 new scenarios, ½ day) + steps 1-6 (≈ 1 day), Opus, snapshot-proved | ~1½ days | low: each step is proved byte-identical; behaviour changes come later on clean seams |
| B. Fold into P08's first step | saves ~½ day of hand-off | high: P08 changes behaviour in the same functions, so a snapshot diff can no longer tell a move from a change; P08 is already the riskiest phase (A-01…A-05) |

**Recommend A**, before any prompt that touches P07/P08/P11/P13/P15. If Prompt 4 touches none of
them, A can run beside it.

---

## 3. Everything deferred or rejected

"Safe 1 month live" = safe to leave on the live service for a month if nothing else changes.
Owner question "—" means no owner decision is needed, only work.

| # | Item | Why deferred / rejected | Severity if left | Owner decision? | Picked up by | Test that would prove it fixed | Safe 1 month? |
|---|---|---|---|---|---|---|---|
| 1 | D2 X-4 option B (tool history as a user-side note) | owner decision (brief) | low | yes — "build option B?" | P07/P17 | adapter payload snapshot | yes |
| 2 | ER-2b resume from the failed round | needs per-round state | low (turn ends partial, marked) | — | P08 / Phase 5 executor | resume test: tool not re-run, answer continues | yes |
| 3 | Claude thinking across turns | `messages.thinking` stores text only | low (quality) | — | P22 (data model) | next-turn request carries signed blocks | yes |
| 4 | Compaction transcript keeps failed exchanges / `[Response stopped]` | outside Part A files | low | — | P13 | compaction input snapshot | yes |
| 5 | Frontend fallback API URL with project number (`arcnave-frontend/src/api.ts:33`) | needs `VITE_API_BASE` in Cloudflare first | low (identifier in the bundle) | yes — set `VITE_API_BASE` | P27 / next small task | identifier guard extended to the frontend | yes |
| 6 | COOP / CORP | COOP `same-origin` breaks the Google popup | low | — | P25 | live sign-in with `same-origin-allow-popups` | yes |
| 7 | Enforce the CSP | report-only first | low | yes — "enforce after a clean report?" | P25 | no violation in a report window | yes |
| 8 | Separate fetch service (A-08 B) | infra | low | yes (infra) | P27 | — | yes |
| 9 | Migrator as a job; N-70 lock/statement timeouts | infra | medium (stuck lock blocks new instances) | — | P27 | migration test with `lock_timeout` | yes |
| 10 | Shared rate-limit store (Redis) | owner-deferred infra | low (per-instance limits) | yes (Redis is deferred) | Phase 5 | — | yes |
| 11 | SD-1d logout-all route | not built | low | — | P25 | route + Origin test | yes |
| 12 | Documents limit 500 → 100 MB (N-10) | owner OK needed | low | yes — "apply N-10's 100 MB?" | next files task | limit test | yes |
| 13 | `FILE_JOB_LEASE_MS` 15 min | owner decides | medium (a crashed job waits 15 min) | yes — lease length | next files task | — | yes |
| 14 | A lapsed lease burns an attempt | heartbeat starved under request CPU | medium (healthy long jobs can end `timeout`) | yes — `--no-cpu-throttling`? | next files task | starved-heartbeat test keeps attempts | **watch** (OCR/audio > lease) |
| 15 | Sync reads not counted by the large-job limit | not jobs | low | — | P12 follow-up | — | yes |
| 16 | `routes/projects.ts` two-statement insert + enqueue | not Part D's file | low (reconcile covers) | — | P08 | injected failure test | yes |
| 17 | ffmpeg `-format_whitelist` | further hardening | low | — | P19 | — | yes |
| 18 | CR2 concurrent sends → 500 on `uq_message_seq` | pre-existing, moved verbatim | medium (double-click → 500) | — | P08 (A-03) | two concurrent sends → one `run_in_progress` | yes (single user) |
| 19 | R1#6 partial turn ledger `EMPTY_USAGE` | adapter throws before usage | medium (budget under-counts partial turns) | — | P11 / P22 | partial turn records its rounds' tokens | yes |
| 20 | R1#11 hand-copied retry loop test | test quality | low | — | P11 | point at `streamWithRetry` | yes |
| 21 | R2#1 ALB → `TRUST_PROXY_HOPS=2` | no ALB today | high **if** an ALB is added without changing it | — | P27 | checklist B7 | yes (no ALB) |
| 22 | R2#3 ids in compiled `src/scripts` | guard skips scripts | low | — | P21 | guard over `dist/` | yes |
| 23 | R2#4 401/403 not rate-limited | hook order | low | — | P25 | flood test | yes |
| 24 | R2#5 X-Forwarded-Host/Proto trusted | no reader | low (latent) | — | P25 | guard: no `request.host` reader | yes |
| 25 | R2#7 = round 3 **F2** (quadratic web_fetch regexes) | was MINOR; benchmark makes it MAJOR | **high** (event loop) | — | **now** | 5 MB hostile inputs < 1 s | **no** |
| 26 | R2#9 nginx duplicate headers (compose only) | compose only | low | — | P27 | — | yes |
| 27 | R2#11 migrate exit test too loose | test quality | low | — | P27 | assert the `migration failed` line | yes |
| 28 | R3#6 from-project PDF page count outside the large-job slot | — | medium (memory) | — | P12 follow-up | concurrency test | yes |
| 29 | R3#7 ZIP pass on the API event loop | — | medium (CPU during uploads) | — | P19 | — | yes |
| 30 | R3#10 host fallback inherits env | non-prod only | low | — | P18 | guard covers `tools/execution` | yes |
| 31 | CR2-5 ZIP-large in SQL; small ZIP waits behind a large job | — | low-medium (Stage 9 G30 fast lane) | — | next files task | small ZIP not blocked by a large job | yes |
| 32 | CR2-8 two attachments queries per turn | perf | low | — | P13 | — | yes |
| 33 | CR2-9 `prefix()` duplicates `bytes()` | quality | low | — | P21 | — | yes |
| 34 | R4#3 errored-with-tools answer replayed unmarked | ours, changes payload | low-medium | yes — "replay note?" | P07 with P03 eval | history payload snapshot | yes |
| 35 | Part C: attachments without `ORDER BY` | moves only | low (cache, reproducibility) | — | P07/P08 | order test | yes |
| 36 | Part C: foreign file id silently skipped | moves only | medium (user thinks a file was sent) | yes — "404 or skip?" | P08 | 404 test | yes |
| 37 | Part C: Claude wire "too large" label on a 30-byte file | moves only | low-medium (model told wrongly) | — | P07 | wire snapshot | yes |
| 38 | Part C: unused `const api` in `mapProviderError` | moves only | none | — | P11 | — | yes |
| 39 | `streamAndCollect` / `settleTurn` | not mechanical | medium (slows P08-P15) | yes — section 2e | own task (2e) | snapshots | yes |
| R-a | **Rejected** CR8 `TRUST_PROXY_HOPS` default 1 | every deployed path has one appending proxy; the API is called straight at its Cloud Run URL (`arcnave-frontend/src/api.ts:30-33`), no Cloudflare in front of it | — | — | — | checklist B7 | yes |
| R-b | **Rejected** R1#8 text/thinking → `error` not `partial` | brief said "once a tool ran"; text stays on the error row | — | yes — "partial for text-only failures too?" | P11 | — | yes |
| R-c | **Rejected for now** R2#1 ALB hops | no ALB in production; checklist B7 "Failure B" detects too-low | see #21 | — | P27 | — | yes |
| R-d | **Rejected** CR2-4 prepended ZIP | `.xls` is read only by SheetJS `XLSX.read` (`attachments/derive.ts:55`, chosen at `extractChild.ts:42`), which takes the ZIP path only on `PK` at offset 0 | — | — | — | — | yes |
| R-e | **Accepted as known** R3#9 hostile-media tests pass without the whitelist | ffmpeg 6.1 already refuses them; but **the image ships Debian bookworm's ffmpeg (5.1 series by the distribution; the version in the built image was not checked)** — the tests never ran on it | low-medium | — | P19 | run the hostile tests on the image's ffmpeg | yes |
| N-1 | Not done: everything in `build-3-result.md` "Not done" is rows 2-5, 6-7, 11, 16, 39 above | — | — | — | — | — | — |

Round-3 findings (MAJOR F1-F3, F13-F15; MINOR F7-F12, F16-F20) are not in DEFERRED.md yet: this
task writes only this file. They belong in the fix task (section 1c).

---

## 4. Decisions taken alone (the 14 in `build-3-result.md`)

| # | What | Why | If the owner disagrees | Locked stage / invariant? |
|---|---|---|---|---|
| 1 | Partial turn = `status complete`, `error_code partial_after_tool_run`, `finish_reason partial` (`generation.ts:696-711`, `:885-892`) | history keeps what the tool did; the UI shows a cut-short note (`arcnave-frontend/src/ChatStates.tsx` `CutShortNote`, `types.ts` `cutOffReason`) | store `status error` → history drops it (and its tool calls, unless decision 3 keeps them), UI shows the error card | **Stage 15 ER-2b** (both "resume" and "end partial" allowed; storing as complete is ours). **Invariant 1:** honoured only by the UI note. **Effects:** UI = answer + "stopped early" note + Continue; **ledger** = `usage.record` status `complete`, `finishReason partial`, usage `EMPTY_USAGE` → cost `null` (`turn/events.ts:135`), tokens 0 → budgets under-count (R1#6); **history** = replayed as a normal assistant turn, unmarked (like R4#3); **regenerate** = `resetForRetry` clears text, `errorCode`, `finishReason`, tool calls (`turn/turnStart.ts`) → clean retry. |
| 2 | Quota-0 429 by `limit: 0` / `quotaValue 0` → `provider_quota_unavailable`; RetryInfo ≤ 10 s honoured | proto3 drops a zero int64; N-42 | a different code/copy; no change to retry safety | Stage 15 ER-2e/g. Vertex shape **not verified** |
| 3 | History drops failed/refused/empty exchanges, keeps errored-with-tools and questions with files | X-3 + review | stricter drop → model may redo a tool; looser → refusals become few-shot | Stage 6 R-3 (doc-sync) |
| 4 | `trustProxy` = hop function `(addr, hop) => hop < N` (`plugins/security.ts:19-22`) | Fastify 5.12 treats a number as trust-nothing | a number → `request.ip` = Google front end → everyone anonymous in one bucket | Stage 3 1.5 (A-09) |
| 5 | Origin check: `Sec-Fetch-Site: same-origin` passes before the allowlist (`security.ts:56`); `null`, same-site-without-Origin and a Google form post refused | compose serves app + API on one origin; the header cannot be forged by a page | allowlist-only → compose on another port/host 403s | **Stage 16 SE2 / SD-1f.** Safe only while nothing on the API origin serves attacker HTML (stored HTML/SVG are attachment-only, `/docs` off in prod) |
| 6 | CSP report-only; XFO DENY enforced | a wrong enforced CSP breaks the app | enforce now → srcdoc visuals / thumbnails may break | Stage 16 SE10 / PH-2 |
| 7 | Advisory lock 72430065; `migrate && exec index` | concurrent cold starts; fail closed | `\|\| true` back → app runs on a half-migrated DB | Stage 19 S19-14; no timeout (row 9) |
| 8 | ffprobe stdin closed (no `-nostdin`); parser child keeps `NODE_ENV` | ffprobe rejects the flag | — | none |
| 9 | Preview only for `ready` without `not_extracted` (`preview_unsupported`) | in-process ExcelJS OOM | `file_not_ready` copy instead | Invariant 5 (typed) kept |
| 10 | ZIP expansion job counts as large (`attachments/fileJobs.ts:401-402`); EPUB lenient rule | working copies up to 500 MB; EPUB DOCTYPEs | per-size rule → three small ZIPs can fill `/tmp` | **Stage 9 G30** ("a small file never waits behind a large one"): a small ZIP now waits behind any large job (CR2-5) — a conflict with a locked outcome |
| 11 | Filenames in text: only `<`, `>`, controls neutralised | model must see the stored name | full escaping → `R&amp;D` | D2 X-9; incomplete (F1, F8-F10) |
| 12 | `runTurn` kept as one generator | not provable as a move | — | NEW-PLAN P05 scope partly open (section 2) |
| 13 | `resetForRetry` deletes tool calls | regenerate kept old calls | — | none (bug fix) |
| 14 | Missing `SANDBOX_SIGNING_SA` only logs an error at start-up (`container.ts:176-177`) | no identifier default in code (PH-4) | fail closed (no Job sandbox) or a typed tool error per run | **Invariant 1 / 5 at risk:** with a staging bucket and no SA, inputs are staged without signed URLs and outputs get none (`tools/sandbox/cloudRunSandboxClient.ts:271`, `:308`); the user sees no typed error. What the Job does with an input that has no URL: **not verified** |

---

## 5. What could break on live (most likely × worst first)

| # | Risk | What the owner sees | Proof (log / status) | One-line fix or rollback |
|---|---|---|---|---|
| 1 | `CORS_ORIGINS` missing the exact live origin (e.g. `www.` vs bare, a second domain) | sign-in, send, upload all fail with "Request blocked" | 403 `origin_not_allowed` in the error log; the same origin also fails CORS preflight | `gcloud run services update … --update-env-vars CORS_ORIGINS=…` (never `--set-env-vars`), or roll traffic back to the previous revision |
| 2 | web_fetch on a hostile / huge page (F2); a hostile EPUB part (F13) | every chat freezes for minutes; Cloud Run may restart the instance | request latency spike; no log line while blocked; instance restart | fix F2; meanwhile `SAFE_FETCH_MAX_BYTES=1048576` (smaller, still quadratic) or `ENABLE_WEB=false` |
| 3 | Memory: large files, in-memory `/tmp` | uploads fail, instance restarts | "Memory limit of … exceeded" | raise memory (≈ 3 × largest file + 1 GiB) or set `FILE_TMP_DIR` to a mounted volume (checklist D5) |
| 4 | `SANDBOX_SIGNING_SA` unset with the Job sandbox + staging bucket | `run_python` runs but files come back missing / inputs unreadable | start-up line `SANDBOX_STAGE_BUCKET is set but SANDBOX_SIGNING_SA is unset` | set the env var; which engine production uses is **not verified** from the repo |
| 5 | New revision cannot migrate (Cloud SQL stopped / slow, or a stuck advisory lock) | deploy "fails"; the old revision keeps serving | revision not Ready; `migration failed` / startup probe failures | fix DB, redeploy; stuck lock: `select pg_terminate_backend(pid) from pg_locks where locktype='advisory' and objid=72430065` (check first) |
| 6 | `TRUST_PROXY_HOPS` wrong for the real path | anonymous sign-in rate limit hits everyone (if too low) or spoofable (if too high) | checklist B7 `ratelimit-remaining`; 429 `rate_limit` bursts | `TRUST_PROXY_HOPS=0/1/2` per the check. The frontend calls the API straight at its Cloud Run URL (`api.ts:30-33`), so 1 is expected — Cloud Run's real header **not verified** |
| 7 | Pre-flight false positive (F14: EPUB with an Illustrator SVG; F19: old ODT), slow scan (F13), or web_fetch losing text (F3) | a normal book fails "XML features that are not opened for safety"; an upload stalls the API for seconds; a page summary misses most of the page | file `failed` + `corrupt`; latency spikes during uploads; tool result short with `truncated:false` | fix F3 / F13 / F14 |
| 8 | Large-job rule serialises ZIPs and > 100 MB files | chips stay "Waiting to be read" behind a long OCR/audio job | `file_jobs` rows queued while one large job runs | raise `FILE_LARGE_JOB_BYTES`; CR2-5 fix |

Checked and **not** a risk: `/models` needing login — the only callers run after sign-in
(`arcnave-frontend/src/session.tsx:148-155` returns early without a user; `Settings.tsx:811` is a
signed-in screen). CSP report-only — console noise only, nothing is blocked.

---

## 6. What was not verified (fakes only)

| Claim in `build-3-result.md` | Tested with | A live run must check |
|---|---|---|
| Gemini keeps every function response; Auto keeps the earliest turn | fake SDK client / FakeProvider | checklist A1-A2 on Gemini 3.8 Flash with a > 100k-token chat |
| Retry gate, partial end, tool never re-run | FakeProvider failures | checklist A4 over a week (`provider failed after a tool ran`) |
| Gemini error classes, quota-0 429 | fixtures from the AI Studio shape | **Vertex** quota-0 body shape; RetryInfo on Vertex |
| SDK retries off | real SDK code with a stubbed `fetch` | nothing beyond logs (no extra provider calls per turn) |
| Claude thinking replay | fake Anthropic client | a real Sonnet/Opus tool turn with thinking: no 400 on signatures |
| Characterization snapshots | fake providers | the checklist C1-C8 smoke on live |
| safeFetch blocks / pins / falls back | fake resolver + fake connector, one local socket | real DNS on Cloud Run; IPv6 egress absent → IPv4 fallback; checklist B11 |
| Grounding redirect resolution | fake resolver | citations resolve on a live grounded answer |
| `trustProxy` and the rate-limit key | `app.inject` with made-up `X-Forwarded-For` | Cloud Run's real header (checklist B7) |
| Origin check | injected headers | real Chrome / Safari / Firefox `Sec-Fetch-Site`; Google popup sign-in (B6) |
| Web security headers | file comparison test; `nginx -t` **never run**; Cloudflare `_headers` on the SPA fallback **not verified** | B9 on `/` and a deep route |
| CSP | report-only, hash from a local build | B10 console reports |
| Dockerfile `migrate && exec index` | `sh` with stub scripts; the image was **not built** in build-3 | B1-B2 on the deploy; SIGTERM handling through `dumb-init` + `sh -c` |
| Advisory lock with several instances | three local processes on Postgres 16 | Cloud SQL socket; several cold starts at once |
| Swagger off in production | a local production-mode boot of `dist/` | B4 |
| ffmpeg env / whitelist / hostile playlist | **real ffmpeg 6.1.1** (this sandbox) | the image's ffmpeg is Debian bookworm's (`backend/Dockerfile:28-36`; 5.1 series by the distribution, not checked in the image) — run the hostile-media tests in the image |
| `complete` records the generation; job re-checks it | `LocalObjectStorage` (mtime as generation, `storage.ts:159`) | the GCS path (`storage.ts:281-285`) never ran in a test: a real upload, then checklist D3 |
| One large job per instance, `FILE_TMP_DIR` | in-process worker, local disk | D5-D6 on Cloud Run memory |
| Encrypted `.xlsx` → `encrypted` | **genuine** file, real parser (verified) | D1 |
| Malware scan | `FILE_SCANNER=none` | nothing until clamd exists |
| Partial note in the UI | frontend unit tests | review check 2 when a partial happens |
| Filenames in prompt text | unit + one integration test | review check 6; F1 is still open |

---

*Sources for this file: the code at `fce4a22`; pre-squash commits `a2cfdda`, `eff19a8`,
`fd7fbab`, `63cd8f9`, `f4efc41`; revert / mutation runs and a regex benchmark in a scratch
worktree (not committed); round-3 reviewers R5 and R6 (Opus 5.5, read-only); a read-only Sonnet 5.5
map of `runTurn`, spot-checked by main.*

---

## Status after fix (tech-build.3-fix, 2026-10-16)

Appended by tech-build.3-fix; everything above is unchanged from `review/build-3-explain`.
Evidence: [build-3-fix-result.md](build-3-fix-result.md); review: [build-3-fix-review.md](build-3-fix-review.md).

| Finding / decision | Sev here | Status | Test |
|---|---|---|---|
| F1 project names raw in the system prompt | MAJOR | **fixed** (`nameForModel` at every site; `Files:` quoted) | `untrustedNames.integration.test.ts` F1 |
| F2 web_fetch regexes quadratic | MAJOR | **fixed** (linear scanners; 5 MB inputs 7–361 ms) | `webFetch.cleaner.test.ts` "linear on any page" |
| F3 `</style >`, `<style-guide>`, `truncated` | MAJOR | **fixed** | `webFetch.cleaner.test.ts` F3 block |
| F13 EPUB DOCTYPE scan quadratic | MAJOR | **fixed** (state machine; 8 MB cases 0–170 ms) | `preflightPass.test.ts` "the DTD scan is linear" |
| F14 Illustrator SVG EPUB refused | MAJOR | **fixed** (scan = officeparser 8 read set; ADR-0070 supersedes ADR-0066 §8) | `preflightPass.test.ts` "EPUB members: exactly what the reader parses is scanned" |
| F15 audio retried a 400 | MAJOR | **fixed** (retry only adapter-classified retryable, once) | `audioRetry.test.ts` |
| F16 local vs central ZIP names | MINOR | deferred (not exploitable: xmldom fixed entity map) | — |
| F17 provider word in `audio.ts` | MINOR | **fixed** (guard scope deferred) | — |
| F18 SYSTEM DTD never fetched | MINOR | **guard test added** | `preflightPass.test.ts` "an allowed external DTD is never fetched" |
| F19 old ODT manifest DOCTYPE | MINOR | open (not in this task) | — |
| F20 missing scanner tests | MINOR | **fixed** (UTF-16, split ENTITY, all strict types) | `preflightPass.test.ts` |
| F7 safeFetch timer tests | MINOR | open (not in this task) | — |
| F8 forged manifest field | MINOR | **fixed** | `manifest.test.ts` "a name cannot forge a field" |
| F9 bidi / zero-width / lookalikes | MINOR | **fixed** (Default_Ignorable + chosen lookalikes) | `attachmentContent.test.ts` |
| F10 one file, two spellings | MINOR | **fixed** | `gemini.gateway.test.ts` `<document filename>` |
| F11 ZIP member closing tag | MINOR | **test added** (was not a live bug: passes on `fce4a22`) | `untrustedNames.integration.test.ts` F11 |
| F12 sheet / image names | MINOR | excerpt locator fixed; chunk-text lines deferred to P07 | `untrustedNames` "excerpt locators" |
| Decision #10 ZIP always large | (G30 conflict) | **superseded** by ADR-0070 §4 | `fileReviewFixes.integration.test.ts` ZIP describes |
| Decision #14 missing SA only logged | (Inv. 1/5) | **superseded** by ADR-0070 §5 (`sandbox_misconfigured`, fail closed) | `cloudRunSandboxClient.test.ts`, `sandboxMisconfigured.integration.test.ts` |
| Section 3 row 25 (R2#7 = F2) | — | **fixed** | as F2 |
| Section 3 row 31 (CR2-5) | — | **fixed** | as decision #10 |

Open MAJOR after the fix: **0**. Section 2 (P05 split) is unchanged: still its own task.
