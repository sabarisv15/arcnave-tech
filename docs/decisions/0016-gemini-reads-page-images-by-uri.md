# ADR-0016: Gemini reads PDF page images from Cloud Storage, as Claude's Files API does

- Status: accepted. Tested locally; the bucket and the backend setting are not live.
- Date: 2026-09-25
- Builds on: [ADR-0013](0013-pdfs-sent-as-page-images-and-text.md), whose consequence "the fix,
  if needed, is to send page images by `gs://` reference for Gemini" this carries out.

## Context

ADR-0013 sends a PDF of up to 100 pages as page images and page text. A 100-page text PDF
renders to about 30 MB of JPEG. All of it went base64-encoded in the request body, and was sent
again with the history on every later turn.

Claude's answer to large PDFs (platform.claude.com, PDF support): "For large PDFs, consider
uploading with the Files API and referencing by `file_id` to keep request payloads small." The
same page warns that "requests with large PDFs can also fail before reaching the page limit,
even when using the Files API".

What the providers accept on the platform ArcNave calls:

- **Gemini on Vertex** takes a `fileData` part with a `gs://` URI. Search results for Google's
  docs gave 7 MB inline and 30 MB from Cloud Storage per image. The inline request limit was
  reported as 20 MB in some sources and 100 MB in others. None of these figures were read from
  Google's own pages, which this environment could not reach.
- **Claude on Vertex** takes base64 only: "On Amazon Bedrock and Google Cloud, only
  base64-encoded sources are currently available" (platform.claude.com, Vision). The request
  limit is 30 MB.

## Decision

1. When `MODEL_INPUT_BUCKET` is set and the selected model's provider is Google, each rendered
   page image is stored in that bucket and sent as `fileData` with a `gs://` URI. This covers
   the pages of the current turn and those carried in the history. The page text is still sent
   inline, next to each image.
2. **Page images get their own bucket**, not the attachments bucket, so the read access Vertex
   needs covers rendered pages and nothing a user uploaded. Objects are named by the SHA-256 of
   their content, so a page resent every turn is stored once.
3. A lifecycle rule deletes objects after 7 days (`LIFECYCLE_DAYS`). The backend trusts an
   object for 6 days after its creation, then writes it again, which resets its age. So a
   conversation never references a page the rule has just removed.
4. Claude is sent base64, as before. A Claude request over Vertex's 30 MB limit still fails with
   the typed `provider_payload_limit`. Claude's own documentation says a large PDF can fail even
   through its Files API, and on Google Cloud there is no Files API to use.
5. Without the bucket, Gemini is sent the images inline, as before. This is a transport choice
   made in configuration, not a substitution the user is shown as something else.

## Consequences

- A large PDF no longer puts tens of MB in each Gemini request, on the first turn or on later
  ones.
- Rendered pages of users' files sit in a second bucket for up to 7 days after they were last
  written. They are derived from files the user uploaded, and are readable by the Vertex AI
  service agent and the backend only.
- Which identity Vertex uses to read a `gs://` URI was not confirmed from Google's
  documentation. The runbook grants read to the Vertex AI service agent. A live probe confirms
  it before `MODEL_INPUT_BUCKET` is set.
- Audio, video and single images still go inline to Gemini. The same path could carry them.
