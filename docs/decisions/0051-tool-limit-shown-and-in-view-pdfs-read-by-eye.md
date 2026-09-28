# ADR-0051: The tool limit is shown, and a PDF in view is read by eye

- Status: accepted by the owner on 2026-09-28 ("1 to 7 fix pannu"). Tested locally; not deployed.
- Date: 2026-09-28
- Source: [the audit of turn log `8931cd51`](../audits/2026-09-28-claude-vs-arcnave-upload-to-answer.md),
  items G1, G2, G4, G5, G6, G7, G8 and S6.
- Amends: [ADR-0013](0013-pdfs-sent-as-page-images-and-text.md) (page image resolution on
  Gemini), [ADR-0021](0021-turn-usage-sums-every-request.md) (the forced-synthesis request is
  gone), [ADR-0026](0026-parallel-tool-calls.md) (the last round's finish reason),
  [ADR-0049](0049-prompt-and-skills-line-by-line-with-the-reference.md) (the pdf skill's scope),
  [ADR-0050](0050-a-turn-log-under-every-reply.md) (the final round in the turn log).

## Context

A live turn on a 12-page scanned KVB + Federal statement ("Total the kvb and federal entries",
Gemini 3.8 Flash) ran 15 OCR commands over pages already in view, hit the tool limit and ended
with no text. `generation.ts` then sent a second request without the loop's tool results, told
the model to answer "based on the previous tool results above", and replaced `tool_limit` with
`STOP`. The reply stated figures nothing had read, and the Continue button never appeared.

## Reference

- **Tool limit:** the app stops at a per-turn tool-use limit and shows "reached its tool-use
  limit for this turn" with Continue; context is kept. It does not write a second answer.
- **bash_tool:** "Run a bash command in the container"; no library is named. Environment
  facts live in skills: "skills encode environment-specific constraints (available libraries…)".
- **pdf skill:** "Use this skill whenever the user wants to do anything with PDF files. This
  includes reading or extracting text/tables … OCR on scanned PDFs … If the user mentions a .pdf
  file … use this skill."
- **Skill rule:** stated in `## skills` and again in `additional_skills_reminder` at the end,
  after an examples block ("Summarize this attached file → in-conversation → use provided
  content, do NOT use view").
- **Tool rule:** no sentence sends the model to a tool for "verification".
- **Page images:** each PDF page is an image plus its text. Claude 4.7+ reads an image at up to
  2576 px and 4784 visual tokens; an A4 page at 2000 px is about 3,650.

## Decision

1. **No second request.** A turn that ends with no text is kept as it is: `tool_limit` stays
   complete and shows the limit with Continue, and anything else is `empty_response`
   (`generation.ts`).
2. **The last round always reports the limit.** When the loop reaches its last allowed round,
   the turn is reported as `tool_limit` whether or not that round answered. An output cut-off or
   a refusal on that round is reported as itself (`toolLoopPolicy.finalRoundFinishReason`, both
   adapters). The Anthropic adapter no longer runs a call returned on its tool-less final round.
3. **bash_tool names no library.** The description says what the machine is and that output is
   truncated. Locations and the no-network rule stay in the prompt's computer section; libraries
   stay in the skills that use them.
4. **pdf (7.0.0) covers anything with a PDF,** reading included, in our own words with the
   reference's scope. Its new "Reading a PDF" section: pages in view are read by eye, and a
   region that cannot be read is rendered larger and viewed. A figure still unreadable is
   reported as such, and a figure worked out from others is labelled as worked out. OCR does not
   replace the page images. pdf-reading keeps ADR-0049's scope (a PDF not in context).
5. **The skill rule is repeated last.** A `<skills_reminder>` section after `<files>` carries
   the reference's examples that fit ArcNave, and the rule again. Left out: the blog-post example
   (ArcNave's file rules answer an article in the reply) and the web-search example (a turn may
   have no search).
6. **The tool rule drops "verification" and "materially improves correctness".**
7. **Gemini reads PDF page images at `MEDIA_RESOLUTION_ULTRA_HIGH`** (2,240 tokens a page, set
   per part), configurable as `GEMINI_PDF_PAGE_RESOLUTION` (`ultra_high` | `high` | `default`).
   If Vertex rejects it with INVALID_ARGUMENT, the round is sent again at the default and that
   model keeps the default for the life of the process.
8. **The turn log records the final round:** whether function calling was off as asked, the
   calls it made that did not run, its text length and the provider's own finish reason.

## Where ArcNave still differs

- **Resolution:** ultra_high is still about 60% of the reference's detail on a 2000 px page.
  This is ours, a Gemini limit, and it roughly doubles image input tokens. Whether it helps is
  not yet measured live.
- **The final round:** ArcNave still sends one last round with calls off, asking for an answer
  from the results so far. The reference does not do this. It is kept because that answer is
  built from real results, and the reply now shows the limit beside it.
- **Skill content:** the reference's docx/pdf/pptx/xlsx skills are proprietary and cannot be
  copied or adapted. ArcNave's are written independently.

## Consequences

- An answer at the tool limit shows "Answer cut off: it used every tool step this turn allows"
  with Continue. It was previously shown as finished.
- PDF turns on Gemini cost more input tokens for page images.
- Items 3 to 7 change model behaviour. Only a live run of the KVB + Federal question proves them
  (expected 48 / 277 / 325, no OCR loop). That eval script still has to be written (audit G10).
