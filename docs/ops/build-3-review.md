# tech-build.3 — code review report

The standing review step ([ADR-0068](../decisions/0068-code-review-after-every-big-prompt.md)),
run for the first time on this task. Base of the reviewed range: `ff1cab5`
(`origin/build/files-ingest`); head at review: `7ee58a3` (Waves 1 and 2 merged, both gate runs
green).

## What ran

| Round | Reviewer | How | Scope |
|---|---|---|---|
| 1 | `/code-review` (session skill `code-review`, args `high ff1cab5...HEAD`) | main session, forked | whole range |
| 1 | `/security-review` (session skill `security-review`) | main session; one finder sub-task (Opus 5.5) + a false-positive filter step | whole range vs `origin/HEAD` (pointed at the base branch locally for the run) |
| 1 | R1 — independent reviewer, gateway + turn split | fresh Opus 5.5 subagent, Read/Grep/Glob only, given only the area diff, the invariants, the exit tests and the pre-split files | Parts A and C |
| 1 | R2 — independent reviewer, security | same | Part B |
| 1 | R3 — independent reviewer, file pipeline | same | Part D |
| 2 | `/code-review` again + one combined fresh reviewer (R4) | on the fix diff only | review fixes |

Severity is the reviewer's own (BLOCKER / MAJOR / MINOR); `/code-review` gives no severity, so
main assigned one when re-opening the line. Every cited file:line was re-opened by main before a
decision.

## Round 1 — raw findings and outcome

### `/code-review` (10 findings)

| # | Finding (file:line at review) | Main's severity | Outcome |
|---|---|---|---|
| CR1 | `plugins/security.ts:50` Origin check refuses same-origin requests whose origin is not in `CORS_ORIGINS` (compose on another port / 127.0.0.1) | MAJOR | **Fixed** (main): `Sec-Fetch-Site: same-origin` passes. Test `security.test.ts` › "allows a same-origin request whose origin is not listed". Same as R2#2. |
| CR2 | `services/turn/turnStart.ts:175` `appendTurn` takes `max(seq)` without a lock; concurrent sends → 500 on `uq_message_seq` | MAJOR (pre-existing) | **Deferred**: moved verbatim by Part C (moves only); pre-existing since the route was written; NEW-PLAN P08 A-03 (one run per chat, DB lease) owns it. DEFERRED.md line. |
| CR3 | `history/failedExchanges.ts:25` drops errored exchanges even when tools ran or the question carried files | MAJOR | **Fixed** (worker A) — see round-1 fixes. Same as R1#7. |
| CR4 | `attachments/fileJobs.ts:215` reconcile before `failExhausted` re-queues a file whose job used its attempts | MINOR | **Fixed** (worker D). Same as R3#5. |
| CR5 | `services/webFetch.ts:51` a page over 5 MB now fails `too_large`; before it was truncated | MAJOR | **Fixed** (worker B). |
| CR6 | `services/safeFetch.ts:296` connects only to the first checked address | MAJOR | **Fixed** (worker B). Same as R2#6. |
| CR7 | `providers/grounding.ts:82` 3 redirects (was 20) leaves grounding citations unresolved | MINOR | **Fixed** (worker B): grounding has its own cap. |
| CR8 | `plugins/security.ts:19` `TRUST_PROXY_HOPS` default 1 trusts a client header when nothing is in front | MINOR | **Rejected**: every deployed topology has exactly one appending proxy (Cloud Run front end; nginx in compose); `npm run dev` is local. `.env.example` documents 0 for a direct exposure. ADR-0065 records the default. |
| CR9 | `attachments/derivatives.ts:351` `storedChecksum` dead | MINOR | **Fixed** (worker D): deleted. |
| CR10 | `docs/checkpoints/CURRENT.md` not updated | MINOR | **Fixed** (main) in the final commit (the review ran before the docs step by design). |

### `/security-review`

No findings at the > 80 % confidence bar; the finder sub-task listed what it checked (safeFetch
scheme / credentials / host forms / IPv4 and IPv6 ranges / rebinding / redirects; other outbound
fetches; Origin hook; trustProxy; the moved SQL `where` clauses; file routes' ownership checks;
subprocess env; XML scan; filename escaping; secrets). With no candidate, the false-positive
filter step had nothing to filter.

### R1 — gateway + turn split (11 findings)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| R1#1 | Partial end (`done.partial`, `finish_reason = partial`) shown as a finished answer; frontend ignores it | MAJOR | **Fixed** (worker A): cut-short note for `partial`. |
| R1#2 | `resetForRetry` keeps `tool_calls`; regenerate drops the new attempt's calls on the ordinal conflict | MAJOR (pre-existing, moved verbatim) | **Fixed** (worker C), as a separate post-split change. |
| R1#3 | `gemini.gateway.test.ts:595` the 120000-token test cannot fail against the old clearing policy | MINOR | **Fixed** (worker A). |
| R1#4 | `attachmentContent.ts:70/74` page label and description still carry the raw filename | MINOR | **Fixed** (worker A). |
| R1#5 | stale comment about `contextEditing.ts` in `generation.ts` | MINOR | **Fixed** (worker A). |
| R1#6 | partial turn's usage is `EMPTY_USAGE` (exact false) though tool rounds were billed | MINOR | **Deferred** (needs the adapter to surface per-round usage before it throws; Stage 15 ledger work). |
| R1#7 | errored exchange dropped with its tool calls | MINOR | **Fixed** with CR3. |
| R1#8 | text/thinking shown → `error` event, only a tool run → `partial` | MINOR | **Rejected**: matches the brief ("Once a tool ran … end the turn with the partial answer"); text or thinking already shown is kept on the error row and not retried (ADR-0072 §4); the wording in the reviewer prompt was main's summary. |
| R1#9 | quota-0 detection on Vertex unverified | MINOR | **Deferred** to the live check (checklist Part A step 5); already recorded in ADR-0072. |
| R1#10 | `audio.ts:115` `readMedia` retried on non-retryable codes | MINOR | **Fixed** (worker D). |
| R1#11 | `batch6OverflowStreamingSafety.test.ts` tests a hand copy | MINOR (pre-existing) | **Deferred**. |

Split behaviour: R1 compared every moved function against the pre-split files and found **no**
behaviour change.

### R2 — security (11 findings)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| R2#1 | `TRUST_PROXY_HOPS=1` is wrong behind the planned global ALB (appends two entries) | MAJOR (latent) | **Rejected for now / documented**: no ALB in production today; checklist Part B step 7 "Failure B" (a second network continues the first network's count) is exactly the "too low" check; DEFERRED line to set 2 when the ALB lands. |
| R2#2 | same-origin compose blocked | MINOR | **Fixed** with CR1. |
| R2#3 | `src/scripts` (compiled into `dist/`) and `arcnave-frontend/src/api.ts:33` still carry project identifiers; the guard skips scripts | MINOR | **Deferred** (brief: guard excludes tests/scripts; frontend URL waits on `VITE_API_BASE`). DEFERRED lines. |
| R2#4 | 401/403 rejections are not counted by the rate limiter | MINOR | **Deferred**. |
| R2#5 | hop-0 trust also takes `X-Forwarded-Host/Proto` | MINOR | **Deferred** (no reader today); DEFERRED line. |
| R2#6 | `pin` uses only `answers[0]` | MINOR | **Fixed** with CR6. |
| R2#7 | `<script` strip regex cost ×5 with the 5 MB cap | MINOR (pre-existing) | **Deferred**. |
| R2#8 | the report-only CSP would break srcdoc frames / thumbnails / API host if enforced | MINOR | **Deferred** (already a DEFERRED line: enforce only after a clean report-only run). |
| R2#9 | nginx duplicates headers on proxied `/v1` responses (compose only) | MINOR | **Deferred**. |
| R2#10 | migrate on every cold start; advisory lock has no timeout | MINOR | **Deferred** (N-70 / migrator-as-job DEFERRED line). |
| R2#11 | migrate non-zero test passes on any non-zero exit | MINOR | **Deferred**. |

SSRF: no bypass found (all address forms, rebinding, redirects, pooled sockets checked).

### R3 — file pipeline (10 findings)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| R3#1 | a ZIP named `.xls` skips the pre-flight and reaches the parser | MAJOR | **Fixed** (worker D). |
| R3#2 | EPUB `.opf` / `.ncx` / `.vml` parts not DTD-scanned | MAJOR | **Fixed** (worker D). |
| R3#3 | preview parses a `ready` workbook whose extraction ran out of memory | MAJOR | **Fixed** (worker D). |
| R3#4 | ZIP expansion working copies not counted as large | MAJOR | **Fixed** (worker D). |
| R3#5 | reconcile re-queues an exhausted file | MAJOR (main: MINOR) | **Fixed** with CR4. |
| R3#6 | `from-project` PDF page count downloads outside the large-job slot | MINOR | **Deferred**. |
| R3#7 | the pass inflates on the API event loop | MINOR | **Deferred** (move the pass into the child with the parser; P19). |
| R3#8 | no `-format_whitelist` | MINOR | **Deferred** (already a DEFERRED line). |
| R3#9 | hostile-media tests pass with or without the whitelist | MINOR | **Accepted as known**: ffmpeg 6.1 already refuses them (ADR-0066 Decision 1); the argument-order spy guards the flag. |
| R3#10 | `executionRuntime.ts` host fallback (non-production, `ALLOW_HOST_CLI=true`) inherits env | MINOR (pre-existing) | **Deferred**. |

## Round 1 fixes

All fixes were made on the merged branch (`3313034`), each by the worker that owns the code, one
commit each, then merged; every fix has a test that fails without it (the workers reproduced each
finding as a failing test first, except the dead-code removal and the comment).

| Finding | Commit | Covering test |
|---|---|---|
| CR1 / R2#2 | `3313034` (main) | `plugins/security.test.ts` › "allows a same-origin request whose origin is not listed (app and API behind one proxy)" |
| CR3 / R1#7 | `ea0c51c` (A) | `services/history/failedExchanges.test.ts` › "keeps an errored answer that made tool calls, with its question: the calls ran", "keeps the question of a failed exchange when it carried files, and drops only the answer"; `routes/gatewayTurn.integration.test.ts` › "keeps the question with its file when the answer failed, and an errored answer that ran a tool" |
| R1#1 | `ea0c51c` (A) | `arcnave-frontend/src/types.test.ts` › "cutOffReason"; `ChatStates.test.tsx` › "says a partial answer stopped early after a tool ran, and still offers Continue (ADR-0072)" |
| R1#3 | `ea0c51c` (A) | `providers/gemini.gateway.test.ts` › "a request with previousContextTokens 120000 carries every function response unchanged" (12 results; the old policy would have cleared 5) |
| R1#4 | `ea0c51c` (A) | `providers/attachmentContent.test.ts` › "a filename in page labels and attachment notes cannot add markup" (superseded in round 2, below) |
| R1#5 | `ea0c51c` (A) | comment only |
| R1#2 | `ec65981` (C) | `routes/regenerateToolCalls.integration.test.ts` › "keeps only the new attempt's call, and the next turn replays only that one"; characterization snapshots unchanged |
| CR6 / R2#6 | `2fcbd92` (B) | `services/safeFetch.test.ts` › "first address fails to connect → the next checked one is used, IPv4 first, one lookup only", "a dual-stack host whose first answer is AAAA falls back to IPv6 only after IPv4 fails", "never tries a blocked address, and does not move on after a non-connect failure", "the real transport reports a refused connect as ConnectError" |
| CR5 | `2fcbd92` (B) | `services/webFetch.test.ts` › "returns a 6 MB page cut at the ceiling, marked truncated, reading no further"; `safeFetch.test.ts` › "reads at most the ceiling and says the body was cut" |
| CR7 | `2fcbd92` (B) | `providers/groundingRedirects.test.ts` › "resolves a 5-hop public chain", "takes the configured grounding cap (8) by default, above web_fetch's 3", "a hop to 169.254.169.254 is still refused and the citation stays unresolved" |
| R3#1 | `241dae8` (D) | `services/attachments/preflightPass.test.ts` › "refuses the lying-ZIP bomb named budget.xls before any parser runs", "refuses a workbook with a DOCTYPE named budget.xls before any parser runs" |
| R3#2 | `241dae8` (D) | `preflightPass.test.ts` › "refuses an EPUB whose content.opf has a DOCTYPE with an internal subset", "refuses an xhtml chapter whose DOCTYPE carries an internal subset, or that declares an entity", "accepts a normal EPUB…" (revised in round 2) |
| R3#3 | `241dae8` (D) | `routes/fileReviewFixes.integration.test.ts` › "a ready workbook with a not_extracted note answers preview_unsupported" |
| R3#4 | `241dae8` (D) | `fileReviewFixes.integration.test.ts` › "two ZIP archive jobs never run together, though both are small" |
| CR4 / R3#5 | `241dae8` (D) | `fileReviewFixes.integration.test.ts` › "a queued file whose only job runs on a lapsed lease with attempts spent gets no new job and fails `timeout`" |
| CR9 | `241dae8` (D) | removal; `tsc` clean |
| R1#10 | `241dae8` (D) | `untrustedTools.test.ts` › "a non-retryable provider error (quota unavailable) is asked once per piece", "a retryable provider error, or any other failure, gets its one retry" (revised in round 2) |

New settings from the fixes (all ours): `SAFE_FETCH_CONNECT_TIMEOUT_MS` (3000),
`SAFE_FETCH_GROUNDING_MAX_REDIRECTS` (8).

## Round 2 — on the fix diff only (`git diff 7ee58a3 a2cfdda`, code only)

Ran: `/code-review` (args `high 7ee58a3..HEAD`) and R4, one combined fresh Opus 5.5 reviewer
given only the fix diff, the invariants and what each fix claims. The gate run on the fixed
branch was green before the round (see build-3-result.md).

### `/code-review` round 2 (10 findings)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| CR2-1 | `preflight.ts:43` `.ncx` / `.opf` in strict mode refuse an ordinary EPUB 2 `toc.ncx` DOCTYPE (accepted before) | MAJOR (regression) | **Fixed** (D, round-2 commit). Same as R4#1. |
| CR2-2 | `audio.ts:233` the no-retry `break` also skips unclassified errors (ProviderError defaults `retryable: false`) | MINOR | **Fixed** (D): only configuration codes skip the retry. |
| CR2-3 | `preflight.ts:45` EPUB parts chosen by extension; a chapter named `.xht` or with no extension is not scanned | MAJOR | **Fixed** (D): every EPUB member is scanned (binary image/font/audio names excepted). |
| CR2-4 | `isolatedExtract.ts:174` `hasZipMagic` checks offset 0 only; a ZIP with bytes prepended skips the pre-flight | MINOR | **Rejected**: the only parser for `.xls` is SheetJS `XLSX.read` (`derive.ts:55`, `extractChild.ts:42`), which takes the ZIP path only on `PK` at offset 0; a prefixed ZIP is read as text, never unzipped. `.xlsx` / `.docx` etc. always get the pre-flight by name. |
| CR2-5 | `fileJobs.ts:400` "a chat ZIP is large" duplicated in SQL; small fast-lane ZIPs wait behind a large job | MINOR | **Deferred** (store a `large` flag on the job at enqueue). |
| CR2-6 | `attachmentContent.ts:69` attribute escaping in plain text shows `R&amp;D` to the model | MAJOR (main) | **Fixed** (A): text positions neutralise only `<`, `>` and control characters; `xmlAttr` stays for attributes. |
| CR2-7 | `webFetch.ts:53` a page cut inside `<script>` keeps raw JS | MINOR | **Fixed** (B). |
| CR2-8 | `turn/context.ts:122` two attachments queries per turn | MINOR | **Deferred**. |
| CR2-9 | `safeFetch.ts:459` `prefix()` duplicates `bytes()` | MINOR | **Deferred**. |
| CR2-10 | `security.ts:36` docblock contradicts the same-origin pass | MINOR | **Fixed** (main, `a2cfdda`). |

### R4 (5 findings)

| # | Finding | Severity | Outcome |
|---|---|---|---|
| R4#1 | `.ncx` / `.opf` DOCTYPE refused | MAJOR | **Fixed** with CR2-1. |
| R4#2 | raw filenames still in `manifest.ts:72` (`<available_attachments>`) and `fileBudget.ts:96` | MAJOR | **Fixed** (A) with CR2-6, every interpolation site listed in ADR-0072. |
| R4#3 | an errored answer with tool calls is replayed as an ordinary assistant turn, unmarked | MINOR | **Deferred** (a replay note is ours and changes the provider payload; needs the P03 eval first). |
| R4#4 | no test reaches the per-address connect timeout or the deadline across the address loop | MINOR | **Fixed** (B): two tests. |
| R4#5 | stale docblock | MINOR | **Fixed** with CR2-10. |

R4 per-fix verdicts: fixes 1, 3, 5 OK; fix 2 → R4#3; fix 4 → R4#2; fix 6 → R4#4; fix 7 → R4#1 (the
rest of fix 7 OK). Checked clean: two consecutive user turns are merged by both adapters; an
unknown `finishReason` renders nothing; no foreign key points at `tool_calls`.

### Round 2 fixes

| Finding | Commit | Covering test |
|---|---|---|
| CR2-1 / R4#1 | `eff19a8` (D) | `preflightPass.test.ts` › "accepts an EPUB 2 toc.ncx with its NISO DOCTYPE", "refuses the same NCX with an internal subset", "keeps .xml/.rels/.vml strict inside an EPUB" |
| CR2-3 | `eff19a8` (D) | `preflightPass.test.ts` › "refuses an entity-laden chapter named ch1.xht", "refuses an entity-laden chapter with no extension", "accepts a normal EPUB with images, a font and a stylesheet" |
| CR2-2 | `eff19a8` (D) | `untrustedTools.test.ts` › "a provider error whose code says a retry cannot help (quota unavailable) is asked once per piece", "a retryable or unclassified provider error, or any other failure, gets its one retry" (skip codes: `provider_quota_unavailable`, `model_unavailable`, `context_overflow`) |
| CR2-6 / R4#2 | `fd7fbab` (A) | `attachmentContent.test.ts` › "a filename in prompt text: named as stored, no markup, no new line (D2 X-9, review r2)"; `manifest.test.ts` › "names a file as stored (R&D John's notes.pdf), and a hostile name cannot close the block or start a line (review r2)"; `fileDerivatives.integration.test.ts` › "names the file as stored in the excerpt note and the manifest, with only < and > neutralised (review r2)". Sites: `attachmentContent.ts` (pageLabel, describe), `manifest.ts`, `fileBudget.ts`, `retrieval.ts` (formatContext, formatWholeFiles), `compaction/autoCompact.ts`, `tools/codeExecutionExecutor.ts`. |
| CR2-7 | `63cd8f9` (B) | `webFetch.test.ts` › "a truncated page ending mid-script yields no script text" |
| R4#4 | `63cd8f9` (B) | `safeFetch.test.ts` › "an address that never connects times out after the connect timeout and the next is used", "the overall deadline stops the address loop with a timeout; later addresses are never tried" |
| CR2-10 / R4#5 | `a2cfdda` (main) | comment only |

The characterization snapshots did not change in either round (`turnCharacterization` passes
without `-u` after every merge).

## Final state

| | BLOCKER | MAJOR | MINOR | Fixed | Rejected | Deferred |
|---|---|---|---|---|---|---|
| Round 1 `/code-review` | 0 | 5 | 5 | 8 | 1 (CR8) | 1 (CR2) |
| Round 1 `/security-review` | 0 | 0 | 0 | — | — | — |
| R1 | 0 | 2 | 9 | 6 (+R1#7 with CR3) | 1 (R1#8) | 3 |
| R2 | 0 | 1 | 10 | 2 (with CR1, CR6) | 1 (R2#1, documented) | 8 |
| R3 | 0 | 5 | 5 | 5 | 0 | 4 (+R3#9 accepted as known) |
| Round 2 `/code-review` | 0 | 3 | 7 | 6 | 1 (CR2-4) | 3 |
| Round 2 R4 | 0 | 2 | 3 | 4 | 0 | 1 (R4#3) |

Overlapping findings (CR1/R2#2, CR3/R1#7, CR4/R3#5, CR6/R2#6, CR2-1/R4#1, CR2-6/R4#2,
CR2-10/R4#5) are counted under each reviewer. Every confirmed BLOCKER and MAJOR is fixed; no
BLOCKER was found. Round 2 was the last round (brief): its fixes were not reviewed a third time;
they were re-run through the full gate (build-3-result.md, "Final"). Every MINOR not fixed has a
line in `docs/ops/audit/DEFERRED.md` ("Code review of tech-build.3").
