# Native multimodal file input — design

**Date:** 2026-09-17
**Status:** Approved, proceeding to implementation plan.

## Problem

ArcNave's only path from an uploaded file to the model is text extraction (`backend/src/services/retrieval.ts`'s `extractText`). Images throw `ExtractionUnsupported` unconditionally. Scanned PDFs throw once `pdf-parse` finds no selectable text. In both cases the file is stored and shown as "attached" in the UI, but the model receives nothing about it — not the words, not the pixels. Both Claude and Gemini can read images and PDFs natively (Anthropic document/image content blocks; Gemini `inlineData` parts), but neither provider adapter (`anthropicVertex.ts`, `gemini.ts`) sends anything but plain text today.

`gpt-oss-120b-maas` has no vision capability on any surface, so this is a two-of-three-provider feature, not all four models — the routing layer has to know that.

## Scope

**In scope:**
- Images and PDFs (including scanned/image-only PDFs), sent as native content blocks to Claude and Gemini.
- Two attachment sources, unified behind the existing `attachments` table: a fresh upload (existing path), and picking an existing project file (new — reuses stored bytes, no re-upload).
- The attached file stays visible for the rest of that conversation, not just the message it was attached to.
- Caching, because the above is unaffordable without it: Gemini via Vertex's automatic implicit caching (no new infrastructure, just stable request construction); Claude via explicit `cache_control` breakpoints (Vertex's 5-minute TTL, not the 1-hour variant, which Vertex's header requirements don't support).
- Routing/capability gating so a vision-incapable model is never silently handed an attachment it can't see.

**Explicitly out of scope (separate, later work):**
- Project-file search (BM25) staying text-only. A project file with no extractable text is never auto-selected by search, full stop — it can only reach the model by being explicitly attached to a message, the same as any other attachment. This is deliberate: it matches how Claude.ai's and ChatGPT's own knowledge-base search actually work (both are text-chunk search; native vision reading is a whole-document, directly-provided feature in both products, not a search-result feature). Making scanned files searchable would mean vision embeddings (ColPali-style page-as-image retrieval) — a different, heavier system that reverses [the BM25-not-embeddings ADR](../../decisions/) and CLAUDE.md invariant #4. Not this piece of work.
- OCR and spreadsheet (`.xlsx`) text extraction — the next roadmap item after this one. DOCX/text/code files are untouched here.
- Conversation summarization/compaction beyond the existing `HISTORY_MAX_TURNS`/character-budget truncation in `loadHistory`. Caching here is scoped narrowly to "make resending an attached file affordable," not general context management.

## Data model changes

`backend/src/db/schema.ts`, `attachments` table:
- New nullable `projectFileId` column (references `projectFiles.id`). When set, the attachment's `storageKey`/`mimeType`/`filename` are copied from the referenced project file at attach time rather than re-uploaded. No duplicate bytes in storage.
- No new status value. In `files.ts`'s attachment upload handler only, images and PDFs stop calling `extractText()` — there is nothing to extract when the model reads the file directly. `extractedText` stays `null` for them; `status` stays `'ready'`. **This does not touch `extractText`/`ExtractionUnsupported` itself, or `projects.ts`'s project-file indexing path** — a project file that happens to be a scanned PDF still fails BM25 indexing exactly as it does today, per the out-of-scope note above. The function is shared code; only one caller changes what it passes through it.

`backend/src/routes/files.ts`:
- New route, `POST /files/from-project`, body `{ projectFileId }`. Creates an unclaimed `attachments` row pointing at the existing project file's storage key. Ownership-checked the same way every other project-scoped route is.
- `attachmentSchema` gains `viewable: boolean` — true for image/PDF attachments (regardless of whether extraction would have succeeded), replacing the misleading case where `hasText: false` reads as "ArcNave can't use this" when it actually means "ArcNave can see it, just not as text."

## Carrying attachments across turns

Today, `GenerationService.loadHistory` (`backend/src/services/generation.ts`) returns `Turn[]` — `{ role, text }` — read from `messages.text` only. Attachments are loaded separately, per-call, from `attachmentIds` in the request body (`chats.ts`), joined into a single `attachmentText` string, and injected into the system instruction for that one call. Nothing about an attachment survives into a later turn's `loadHistory` read.

Change:
- `Turn` gains an optional `attachments: { mimeType: string; base64: string }[]`.
- `loadHistory` additionally queries, per historical message, any `attachments` rows with `messageId` set and `mimeType` starting `image/` or equal to `application/pdf`, reads their bytes from `ObjectStorage`, and attaches them to that `Turn`.
- New config value `HISTORY_MAX_ATTACHMENT_BYTES` (same `int()` pattern as every other cap in `config.ts`; proposed default 12 MB, roughly Anthropic's per-request practical ceiling with room for text). Carried-forward attachments are dropped **oldest first** when the running total would exceed it — the newest turn's own attachments are never dropped, matching the existing "the newest content wins" philosophy already used for history truncation.
- The current-turn's newly-attached files (via `attachmentIds` in the generate request) are handled the same way structurally: turned into the same `{ mimeType, base64 }` shape and placed on the synthetic "current" turn before it's handed to the provider, replacing today's `attachmentText` string concatenation for images/PDFs. Non-image/PDF attachments (docx, text, code) keep using `attachmentText` exactly as today — this feature does not touch that path.

## Provider adapter changes

`backend/src/providers/types.ts`:
- `Turn.attachments?: { mimeType: string; base64: string }[]`.
- `GenerationRequest` unchanged in shape; `history` and the synthetic current turn both carry the richer `Turn`.

`backend/src/providers/anthropicVertex.ts` (`buildMessages`):
- Per turn with attachments, `content` becomes a block array: image blocks (`{ type: 'image', source: { type: 'base64', media_type, data } }`) and PDF blocks (`{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }`) placed before a trailing `{ type: 'text', text: turn.text }` — Anthropic's documented recommended order (media before the text that refers to it).
- `cache_control: { type: 'ephemeral' }` is set on the last content block of the second-to-last message (i.e., everything through the previous assistant turn is the cached prefix; the newest user turn is never cached, since it's new every time by definition). No `anthropic-beta` header is sent — Vertex rejects the ones the 1-hour cache needs, and the SDK's default 5-minute cache needs none.

`backend/src/providers/gemini.ts` (`buildContents`):
- Per turn with attachments, `parts` becomes `[{ inlineData: { mimeType, data: base64 } }, ..., { text: turn.text }]`.
- No explicit `cachedContent` resource is created for this iteration — implicit caching is automatic on Vertex for Gemini 2.5+/3.x models given a stable, repeated prefix. The only requirement is that `systemInstruction` and early turns stay byte-identical across calls, which the existing structure already satisfies as long as history isn't re-ordered or re-formatted between calls.

`backend/src/providers/gptOssVertex.ts`: unchanged. Never receives an attachment (see routing, below).

## Routing and capability gating

`backend/src/providers/registry.ts`: `ModelEntry` gains `supportsVision: boolean` — a static fact per provider (`anthropic`: true, `google`: true, `openai-oss`: false), not a runtime probe, mirroring how `supportsGrounding` already works.

`backend/src/providers/routing.ts`:
- `RoutingInput` gains `requiresVision: boolean` — true when the current turn or any carried-forward history turn has an image/PDF attachment.
- `routeAuto`'s candidate filter gains `entry.supportsVision` alongside the existing `entry.supportsGrounding` filter, when `requiresVision` is true.

`backend/src/services/generation.ts`:
- Before resolving history/attachments, if an explicit (non-`Auto`) model alias is chosen, lacks `supportsVision`, and a visual attachment is present (current turn or carried forward): throw `ApiError('capability_unavailable', { detail: '<model> cannot see images or PDFs. Choose Claude or Gemini, or remove the attachment.' })` — before any provider call, same pattern as the existing grounding-capability check a few lines above it.
- If `Auto` has no vision-capable model configured/available: existing `no_model_available` error, same as today's "no grounding-capable model" case.

## Error handling

- Oversized combined payload (current turn + carried-forward history attachments, after the `HISTORY_MAX_ATTACHMENT_BYTES` cap) still theoretically possible if a single file is very large. Falls through to the existing generic `provider_error` mapping (`mapProviderError`) — no new error code for this iteration; the cap is sized to make it a rare edge case, not a designed-for path.
- A carried-forward attachment whose storage object has been deleted (shouldn't happen — attachments aren't deletable once claimed by a message, per the existing `DELETE /files/:id` conflict check) is treated as a bug, not a user-facing case; `ObjectStorage.get` already throws a typed `not_found`, which surfaces as today's generic error handling would.

## Testing

Per `mistakes.md` and `CLAUDE.md`: no test may reach a real provider. Verification is entirely against `FakeProvider.seen`, extended to capture the exact request shape:
- A fake image/PDF attachment on the current turn produces the correct block shape for each adapter (unit-level, adapter functions extracted and tested directly — `buildMessages`/`buildContents` are already pure functions of `GenerationRequest`).
- `cache_control` lands on the correct block in the Anthropic adapter's output, and nowhere else.
- A second `generate` call in the same chat, after a first message with an image attachment, carries that image forward in `history` — proves `loadHistory`'s new join, not the adapters.
- `HISTORY_MAX_ATTACHMENT_BYTES` truncation drops the oldest carried-forward attachment first, keeps the newest.
- Routing: `requiresVision` correctly excludes `openai-oss` from `Auto` candidates; an explicit pin to `openai-oss` with an attachment present throws `capability_unavailable` before any provider is touched.

Not testable without spending Vertex quota, and therefore not attempted in the automated suite: actual cache hit/miss behavior, and whether the model's visual reading is any good. Those are manual, live-verification steps, the same as every other Vertex-dependent claim already in `docs/checkpoints/CURRENT.md`.

## Rollout

No feature flag. This ships as: routes → adapters → routing → tests → `npm run openapi` (the `/files/from-project` route and the changed `attachmentSchema` both change the OpenAPI surface) → manual live verification (attach a photo, ask about it two turns later, confirm the model still describes it; attach a scanned PDF; pin GPT-OSS with an image attached and confirm the typed error) → deploy, per the existing push-to-`main`-auto-deploys-the-backend mechanism, frontend deploy (the attachment picker for project files, and the `viewable` vs `hasText` UI distinction) via the existing manual `npm run deploy`.
