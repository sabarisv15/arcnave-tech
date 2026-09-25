# ADR-0013: A PDF is sent to a model as page images and page text

- Status: accepted
- Date: 2026-09-25
- Builds on: [ADR-0011](0011-upload-follows-claude.md) (the upload-time `reading` value)

## Context

This is stage 2 of the file-handling decode: what a model receives when a PDF is sent to it.
Until now, ArcNave put the PDF's own bytes in the request (`inlineData` for Gemini, a `document`
block for Claude). Each provider's own PDF reader then decided what the model saw. That had
three consequences:

- Changing the model changed how the file was read.
- ADR-0011's rule, which reads a PDF of more than 100 pages as text only, had no effect.
- ArcNave could not see or check what the model was shown.

Claude's documentation ("How PDF support works") describes the reference behaviour: "When you
send a PDF to Claude ... the system converts each page of the document into an image" and "the
text from each page is extracted and provided alongside each page's image."

## Decision

1. When a PDF is sent (the current turn, or carried from earlier turns), `pdfForModel` reads it
   locally with poppler:
   - A PDF of up to 100 pages becomes one JPEG per page and that page's text, in the form
     `[<file> page N of M, fileId]`, then the image, then `Text of page N:`. A page with no text
     layer says so, and the model reads it from the image.
   - A PDF of more than 100 pages is sent as its page-marked text only, preceded by a note that
     says why.
   - A PDF poppler cannot open is not sent. Its note gives the reason (`unreadable`).
   - No provider is handed the PDF's own bytes on this path.
2. Page images are JPEG at quality 90, with the long edge at 2000 px. The user asked for output
   quality over token cost. 2000 px is the largest size Claude accepts when a request carries
   more than 20 images. Measured on the 12-page scanned KVB statement: 0.76 s to render,
   9.5 MB base64 in all, and 1.02 MB for the largest page. Balances and counts were legible
   at 1568 px already.
3. Renders are cached in memory per instance, keyed by storage key, up to 256 MB. A
   conversation resends its files every turn, and the bytes behind a key never change.
4. `enforceModelLimits` counts page images: the largest image against the per-image limit, all
   of them against the request limit, and pages against the PDF page limit. When the images of
   a PDF from an earlier turn do not fit, the PDF is kept with its page text and a
   `model_limit` note.

## Consequences

- Every provider sees the same pages and text. The KVB statement is scanned and has no text
  layer, so the model reads it from the images, as Claude would.
- **Request size is now ArcNave's to manage.** A 100-page text PDF renders to about 30 MB of
  JPEG at 2000 px (measured: 29.8 MB). That is over Claude-on-Vertex's 30 MB request limit once
  base64-encoded, so Claude fails with a typed `provider_payload_limit`. For Gemini, ArcNave has
  no verified per-request limit (sources say 20 MB or 100 MB for inline data). A very large PDF
  may be refused by the provider, and that refusal maps to the same typed error. The fix, if
  needed, is to send page images by `gs://` reference for Gemini. That has not been built.
- Token cost changes. Gemini's own PDF reading counted pages at a fixed rate; page images are
  counted as images. The user accepted this for quality.
- The PDF bytes still reach the sandbox unchanged. Code works on the original file.
