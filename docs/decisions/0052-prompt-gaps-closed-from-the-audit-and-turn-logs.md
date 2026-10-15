# ADR-0052: The reference's rules, from the audit and three turn logs

- Status: accepted by the owner on 2026-09-28 ("make maximum use of all the attachments and give
  excellent fixes"). Tested locally; not deployed.
- Date: 2026-09-28
- Supersedes in part: ADR-0032 (progress updates only on important findings), ADR-0049 (articles
  and posts written in the reply; a bare "report" asked about first; "open the result to check it,
  and fix and rebuild when it is wrong"; the safety sections left for the owner), ADR-0025 and
  ADR-0047 where noted below (memory and past chats as one switch, the deployment's only).
- Reference: `tools/Anthropic/claude-fable-5.1.md` (the app prompt the audit compared against),
  its tool descriptions, and the docx skill in `tools/Anthropic/skills/docx/`.

## Context

The owner supplied two audit reports (the rule-by-rule comparison of the prompt ArcNave sends with
the reference: 666 rules, 315 missing, 4 opposite) and three turn logs from 2026-09-28. Every
claim below was checked in the code, not in the reports.

The turn logs showed what the audit could only infer:

- **531d000c**, "how many entries in kvb and federal?" on a 12-page scanned PDF sent as 12 page
  images: the model had the right counts by round 9 (277) and still made 17 more OCR and OpenCV
  calls, 26 in all, for 819 s. It read no skill. `bash_tool`'s description listed `pytesseract`
  and `opencv`; the manifest said only that the file was on the computer; the prompt said
  converting or producing a file from an upload "does" need the computer. The loop ended with
  `tool_limit`, the forced answer request carried none of the 26 results it was told to answer
  from, and its `stop` overwrote `tool_limit`, so no Continue button showed.
- **2f2d502c** and **a36e16d9**, the same PDF with "without tools": 0 tool calls, 277 / 325 and
  244 / 33 read from the page images, right. The tools were never needed.
- All three replies used `###` headers, horizontal rules and bold runs for a count.

Found in the code while checking the reports (not in either report):

- `anthropicVertex.ts` dropped every tool on the last round, including the web search server
  tool. With no other tools a turn has one round, which is also the last, so a Claude turn with
  search on and no other tools was sent without its search tool.
- The React artifact line offered `plotly`, which `REACT_MODULES` in `fileArtifacts.ts` does not
  resolve ("not available here"); the module is `plotly.js-dist-min`.
- `chats.ts` built an attachment manifest that `assemblePrompt` never renders; the turn log still
  listed it as a system-prompt part.
- `ENABLE_MEMORY` was the only memory switch, for the whole deployment. The reference tells the
  model it cannot turn memory off and names the user's setting; ArcNave had no setting to name.
- `privacy.ts` refused API keys and passwords only; Aadhaar, PAN, card and account numbers were
  stored if the model saved them.

## Decision

Reference behaviour, in our own words (Invariant 7), unless marked **ours**.

1. **Tool-step limit** (`generation.ts`, both adapters). The forced answer after a loop that used
   every step carries this turn's calls and results (`<this_turn_tool_steps>`, the same text form
   history uses) and keeps `tool_limit`. Both adapters report `tool_limit` whenever the forced
   final round is reached. The Claude adapter keeps its tools declared on that round and sets
   `tool_choice: {type: "none"}`, which the Define-tools docs list as supported on every Claude 5
   model, including those that reject forced tool use; a turn with no other tools keeps its search
   tool.
2. **What is in view is read.** Each manifest line says whether the file is in the model's context
   (`contextNote`: page images, text layer, or "read it from its file"). The prompt says a fact
   read, counted or transcribed from context needs no tool, a conversion takes its content from
   what is in view, and the computer is for changing a file or building a new one (the
   reference's grayscale and transcription examples). `bash_tool` no longer lists libraries
   (**ours**: the list drew the OCR); the skills name them where the work is done. The
   `pdf-reading` description stays the reference's ("especially when ... not in your context"):
   the turn that ran OCR read no skill, so the description did not cause it.
3. **Files.** A short file is written once, straight to `output/`; only a long one is reviewed and
   refined (reference line 1559). An article, blog post, essay, story or social post is a file
   however short (line 1529); a bare report is a Markdown file, not a question. The reference's
   example decisions are added, with two of ours for a PDF in view. The docx skill sets table
   widths in the grid and every cell, once (the reference skill's "dual widths"; python-docx's
   `_Column` is the grid column, `_Cell.width` the cell's), renders the result once as the reference
   skill does, and fixes a defect once at its cause (**ours**: the Word turn rebuilt three times
   for one wrapping number).
4. **Safety, wellbeing, evenhandedness** (reference lines 32 to 203): child safety, weapons,
   drugs with harm-reduction information, malicious code, real people, legal and financial
   questions, copyrighted text and images, mental health, political balance, rude or abusive users.
   The thumbs-down button they point to exists (`App.tsx`).
5. **Tone and format**: warm tone, no quoting the user back, examples and metaphors, no cursing,
   minors, the three avoided words, brief caveats, no formatting in personal chats, no report
   headers or rules in chat answers, a requested no-formatting kept.
6. **Progress**: one short sentence every couple of tool calls (reference line 132), no
   justifying a tool choice, and a one- or two-sentence answer after the last call.
7. **Knowledge**: answer as of the cutoff, search what may have changed, say it may be out of date
   when there is no search. No cutoff date is stated (**ours**): ArcNave serves several models, and
   a wrong date is a claim ArcNave cannot back (Invariant 1).
8. **Saved preferences** (lines 1410 to 1497): behavioural and contextual preferences, when each
   applies, never as analogies, where they are edited (Settings > Personalization), and that a
   change applies from the next message (true: `loadPreferences` reads them every turn).
9. **Search** (only when a search tool is declared): one search for a simple fact, the
   unrecognised-name rule, the name as written, no operators, the current year, no thanks for
   results, no cutoff talk, harmful sources, and the copyright limits (under 15 words, one quote
   per source, no lyrics or poems, short summaries). The ten-step research workflow (**ours**,
   over-researched) is replaced by the reference's scaling rule. `image_search` asks for 3 or 4
   images (the schema's maximum is 4, its executor too); `web_fetch` says not to add "www.".
10. **Memory** (lines 226 to 1203): reading, the application rules (always, selectively, never),
    phrases to avoid, open items, other people, sensitive attributes, healthy distance, filing
    calibration (stated only, the month test, picks not options), `(stated)` tags, `[[links]]`,
    `aliases` (the listing now prints them), editing and forgetting, size reports (tool results
    carry size, cap and free space, with a note from 85% of the cap: **ours**, the reference gives
    no number), the never-save list for anyone, the unsafe-preference list, and refusal wording.
    Past chats get their own rules block (lines 1380 to 1407).
11. **Consent-governed facts** (health, orientation, gender identity, ethnicity, religion,
    politics, union membership, disability, finances): the reference writes them "only where a
    save-time consent check decides; otherwise leave them out". ArcNave has no consent check, so
    they are saved only when the user asks to remember that fact (**ours**: the explicit request
    is the consent we have).
12. **Never-stored identifiers** in code (`privacy.ts`): card numbers (Luhn), Aadhaar (Verhoeff),
    PAN, social security, and passport, driving licence, voter ID and account numbers next to the
    word that names them. The error says "Memory never stores ..." so the model can decline by
    name and save the rest.
13. **Settings** (migration 0024): "Use and update memory" and "Search and reference past chats"
    in Settings > Personalization, both on by default. Off sends no tool and no policy text.
    Supersedes ADR-0025/0047's single deployment switch; `ENABLE_MEMORY` still gates both.

## Still different, on purpose or pending

- **Saving during the turn** (ADR-0025) stays. The reference files memory in a background pass
  after each turn. That is an architecture change with a cost (a model call per turn) and a
  concurrency story (an explicit write wins; a forget is never re-saved). Pending the owner.
- **Product self-knowledge**: the reference searches its docs before answering about itself.
  ArcNave has no public docs site to search. Pending content.
- **Knowledge cutoff per model** and **user location**: need a verified cutoff per model and a
  consented location source.
- **Ending abusive chats, artifact storage, connectors, plugins, published artifacts, incognito**:
  features ArcNave does not have (Appendix A of the audit).
- `sendPrompt` fills the message box (ADR-0035) and memory's ongoing-work folder is `/projects/`,
  not `/areas/`; both recorded, unchanged.

## Verification

Run on 2026-09-28: backend typecheck clean; backend suite 940/940 in a Linux container with
Node 22, Poppler and `python` on PATH (on the Windows host, 32 fail for the environment only);
frontend typecheck, build and 196/196; the two settings switches checked in Chromium against the
local stack (saved, survive a reload, no console or server errors).

- `npx vitest run src/routes/toolLimit.integration.test.ts`: the forced answer carries the tool
  steps and the message keeps `tool_limit`.
- `src/providers/*.adapter-loop.test.ts`: final round `tool_choice: none` with tools declared,
  `tool_limit` on a forced answer, search kept on a one-round Claude turn.
- `src/services/attachments/manifest.test.ts`, `src/test/behaviorEvaluation.test.ts` (Evals 5,
  9, 11b to 11b6), `src/services/memory/memory.test.ts`, `memoryFiles.test.ts`,
  `src/routes/memorySettings.integration.test.ts`.
- Live, after the owner approves a deploy: the same KVB + Federal question with the PDF in view
  should make no OCR call; a one-page PDF-to-Word request should give the file without a
  rebuild loop; a Tanglish question gets a Tanglish answer without report headers.
- Unverified here, needs `gcloud`: 531d000c ran 26 tool rounds, so the deployed `TOOL_MAX_ROUNDS`
  is not the code default of 16; and whether Vertex rejects `FunctionCallingConfigMode.NONE` on
  `gemini-3.8-flash` (the final round still made a call).
