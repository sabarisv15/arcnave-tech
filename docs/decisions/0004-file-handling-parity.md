# ADR-0004: File-handling parity with Claude.ai / ChatGPT

- Status: accepted
- Date: 2026-09-18

## Context

A gap analysis against Claude.ai and ChatGPT (confirmed against current product docs and
release notes, not assumed from training data — see Sources) found ArcNave missing eight
things:

1. No spreadsheet (`.xlsx`) text extraction — accepted for upload, never read.
2. No PowerPoint (`.pptx`) support at all.
3. No OCR / scanned-PDF fallback — a text-less PDF just fails.
4. `.docx` tables collapse to unstructured plain text.
5. No audio/video ingestion or transcription.
6. No page-level citations — extracted text has no position metadata.
7. No code-execution sandbox — the model can't run code against a file.
8. No generated-file output — the model can't hand back an edited or new file.

(A ninth gap — no tool-use/agent framework — is tracked separately and explicitly deferred;
see "Out of scope" below.)

This ADR records the chosen approach for each, and why, so the decision survives past the
session that made it. Per `CLAUDE.md`, this document changes in the same commit as the code
that implements it.

## Decisions

### 1. Spreadsheet extraction — ExcelJS

**Chosen: [`exceljs`](https://www.npmjs.com/package/exceljs).** Read each worksheet and
render it as a pipe-delimited text grid (one row per line), which is what gets chunked and
indexed — BM25 tokenizes it like any other text, so cell values become searchable without a
separate "structured query" layer.

Rejected: `xlsx` (SheetJS). SheetJS Community Edition has no true streaming reader (loads the
whole workbook into memory) and is the more widely-used *browser-side* choice; ExcelJS is the
better-regarded 2026 default for server-side Node work and — critically — is also used for
**generation** (item 8), so one library covers both read and write for this format instead of
two.

### 2. PowerPoint extraction — officeParser

**Chosen: [`officeparser`](https://www.npmjs.com/package/officeparser)** (the actively
maintained `harshankur` fork; last published 2026-09-16, two days before this decision).
Extracts slide text directly; no bespoke OOXML/zip parsing to write or maintain.

`.pptx` gets added to `ALLOWED` in `backend/src/services/storage.ts` and to the frontend
`allowed` regex in `arcnave-frontend/src/storage.ts`.

### 3. OCR / scanned PDFs — pdf-parse screenshots + Gemini vision, no new dependency

**Chosen:** `pdf-parse` (already a dependency, already used for PDF extraction) exposes
`PDFParse.getScreenshot()`, which rasterizes pages to PNG buffers entirely within the existing
library. When `getText()` returns no selectable text, each page is screenshotted and sent to
Gemini as an `inlineData` vision part (the same mechanism the in-progress multimodal-file-input
work already uses for message attachments) with a prompt asking for a verbatim transcription.

This is deliberately **not** a bundled local OCR engine (e.g. Tesseract). Per Invariant 1
(never substitute silently) this path is explicit and typed: if Gemini is not configured
(`GOOGLE_CLOUD_PROJECT` unset), extraction fails with `ExtractionUnsupported` naming the real
reason — it does not silently skip OCR or fall back to a lesser method. This only works for
project-file indexing when a Gemini-capable provider is configured; it is a capability, not a
guarantee, exactly like grounding.

### 4. `.docx` tables — officeParser's Markdown output, not mammoth's raw text

**Chosen:** since `officeparser` (item 2) already parses `.docx` into a structured AST with
table nodes and can render Markdown (`ast.to('md')`, tables as pipe rows) or plain text, reuse
it for `.docx` instead of adding a second, bespoke HTML-flattening path on top of `mammoth`.
`mammoth` is dropped as a dependency — one library now covers `.docx`/`.pptx` extraction with
table structure preserved, instead of two libraries each covering part of the problem.
(Originally scoped as a mammoth `convertToHtml` flattener to avoid a new dependency; revised
once `officeparser` was already committed to for item 2, since duplicating table-handling logic
across two libraries is worse than depending on one library for both formats.)

### 5. Audio/video — native Gemini multimodal input, no transcription pipeline

**Chosen:** Gemini on Vertex understands audio and video natively via `inlineData`, the same
part type already used for images and PDFs (`backend/src/providers/gemini.ts`). No separate
speech-to-text service, no new GCP API to enable.

Two paths:
- **Message attachments** (current-turn, ephemeral): audio/video mime types added to
  `ALLOWED`; sent as native `inlineData` parts, same as the existing image/PDF vision path.
  Not available to Claude (Anthropic's Vertex API has no audio/video input) or `gpt-oss-120b`
  (no vision) — gated by the existing `supportsVision`-style capability check, so picking a
  non-multimodal model with an audio/video attachment fails fast with
  `capability_unavailable`, not a silent drop.
- **Project-file indexing** (durable, searchable): `extractText` gains an audio/video branch
  that asks Gemini for a transcript, and stores that as the chunk text. Same honesty rule as
  OCR — `ExtractionUnsupported` with a real reason if no Gemini provider is configured.

### 6. Page-level citations — carry `pdf-parse`'s existing per-page structure through

**Chosen:** `pdf-parse`'s `getText()` already returns `TextResult.pages: Array<{ num, text }>`
— per-page text, already computed, currently discarded (`retrieval.ts` only reads the
concatenated `.text`). `chunkText` and `fileChunks` gain a `page` column (nullable — only PDFs
have pages; everything else stays `null`, not `0`, consistent with Invariant 2). Chunking runs
per-page instead of over the flattened document, so a chunk never straddles a page boundary and
`formatContext` can render `(p. 4)` next to a filename instead of just "part 3".

This is a schema change: `npm run db:generate` + migration, and `npm run openapi` since
`RetrievedChunk`/the citation shape in the generate response changes.

### 7. Code execution — Gemini's built-in `code_execution` tool; Claude explicitly excluded

**Chosen:** Gemini's server-side `code_execution` tool, already typed in `@google/genai`
(confirmed in `node_modules/@google/genai/dist/*.d.ts` — `CodeExecution` type, `"code_execution"`
tool literal) and reachable with the exact pattern `grounding`'s `googleSearch` tool already
uses in `gemini.ts`: `tools: [{ codeExecution: {} }]`. New provider method
`supportsCodeExecution()` mirroring `supportsGrounding()`, gated by a new
`ENABLE_GEMINI_CODE_EXECUTION` config flag. New `ProviderEvent` variants for the code/result
steps the SDK streams back, rendered in the UI as a collapsible "ran code" block, the same
family as the existing `progress`/`sources` events for grounding.

**Confirmed via current Anthropic docs: Claude's `code_execution` tool is not available on
Vertex AI** (only the direct Anthropic API and Azure AI Foundry, as of an April 2026 report).
Since ArcNave only ever calls Claude through Vertex (Invariant 6 — ADC, no direct Anthropic API
key), this is not a gap ArcNave's stack can close today. Per Invariant 1, this is surfaced
honestly: requesting code execution while routed to a Claude alias returns
`capability_unavailable` with that reason. It does not silently run on Gemini instead when the
user picked a Claude model, and Auto-routing does not treat "needs code execution" as an
excuse to override an explicit model pin.

### 8. Generated file output — deterministic conversion of an artifact's own content, not model-emitted JSON

**Chosen:** extend the existing **Artifacts** feature (`backend/src/routes/artifacts.ts`,
already CRUD + version history) with an *export* action, rather than depend on either
provider's sandbox for the actual bytes, and rather than inventing a JSON contract the model
has to be prompted into emitting. Reasons:
- Gemini's `code_execution` sandbox has no persistent filesystem and only `matplotlib` for
  rendered output — it cannot produce a real `.xlsx`/`.docx`/`.pptx` binary.
- Claude has no code execution on Vertex at all (item 7). A file-generation feature that only
  worked for one provider would itself be the silent-inconsistency problem Invariant 1 exists
  to prevent.
- A "the model emits a magic fenced JSON block, the backend watches for it" design is exactly
  the shape of an ad hoc tool-call protocol — which is item 9's actual scope, explicitly
  deferred. Building a one-off version of it here to get file generation sooner would prejudge
  that design before it exists.

Instead: an artifact already holds Markdown text the model wrote in the ordinary course of a
response (tables, headings, bullet lists — no new prompting contract). `POST
/artifacts/:id/export` deterministically parses that Markdown into a small typed spec and
renders it:
- Markdown tables → sheet rows, via `exceljs` (write path — same library as item 1) → `.xlsx`
- Markdown headings/paragraphs → document sections, via
  [`docx`](https://www.npmjs.com/package/docx) (dolanmiu; actively maintained, v9.x, zero
  runtime dependencies) → `.docx`
- Markdown headings/bullet lists → slides/bullets, via
  [`pptxgenjs`](https://www.npmjs.com/package/pptxgenjs) → `.pptx`

The rendered file is stored via the existing `ObjectStorage` abstraction and attached as a new
`artifactVersions` row: schema change adds `format` (`'markdown' | 'xlsx' | 'docx' | 'pptx'`,
default `'markdown'` for every existing row) plus nullable `storageKey`/`mimeType`/`sizeBytes`
— `content` stays `''` for a binary version rather than repurposed. `artifacts.kind` (the
editor-surface type: document/code/webpage) is untouched; a version's `format` is independent
of its artifact's `kind`; no change to `ck_artifact_kind`. Downloaded through a new
`GET /artifacts/:id/versions/:version/download` route, mirroring the existing
`/files/:id/download` pattern (`Content-Disposition: attachment`, `nosniff`).

This is provider-agnostic by construction — the conversion runs on whatever Markdown ended up
in the artifact regardless of which model produced it, so it does not inherit item 7's
Vertex/Claude limitation. It is honest about what it does not do: it cannot generate a
spreadsheet from a request that never produced a markdown table, because there is no
information to convert. That is a real, stated limit versus Claude.ai/ChatGPT's sandbox-backed
generation (item 9's tool-use framework is the eventual path to closing it), not a silent gap.

## Out of scope (explicitly deferred — item 9)

**Tool-use/function-calling framework, agent loop, Skills system, browser/computer-use
agent.** The user has asked for items 1-8 now and item 9 separately, with instructions to
follow. Nothing in items 1-8 requires a general tool-calling contract — code execution (item 7)
and file generation (item 8) are both wired as fixed, single-purpose capabilities (a provider
flag and a structured-output convention, respectively), not a reusable tool registry. Building
that registry is the actual scope of item 9 and is not pulled forward here.

## Consequences

- Three new runtime dependencies: `exceljs`, `officeparser`, `docx`. `pptxgenjs` was
  considered but current npm data shows its last release over a year old; the actively
  maintained fork question is left to whoever picks up item 8's frontend/download work to
  re-verify at implementation time, since library churn in this space is fast.
- Two schema migrations: `fileChunks.page` (item 6) and `artifactVersions.storageKey` /
  `mimeType` / `sizeBytes` plus an extended `ck_artifact_kind` check (item 8).
- `docs/openapi.json` regenerates for both migrations' route changes.
- Gemini gains two more server-side tool capabilities (`code_execution`, on top of
  `googleSearch`); Claude's capability set does not grow, and that asymmetry is now documented
  rather than discovered by a confused user.
- Extraction that depends on Gemini (OCR, audio/video transcription) is *capability-gated*,
  not universal — a deployment with no `GOOGLE_CLOUD_PROJECT` configured loses those two
  specifically, with a typed reason, same as grounding already behaves today.

## Sources

Verified against current product documentation and 2026 release notes before this ADR was
written (see chat transcript for full citations): Claude Help Center (file upload/creation),
Anthropic Platform Docs (code execution tool, Vertex AI availability), Google Cloud Vertex AI
docs (Gemini code execution, audio understanding), npm registry metadata for `exceljs`,
`officeparser`, `docx`, `pptxgenjs` (version/publish-date checks run directly against the
registry, not searched).
