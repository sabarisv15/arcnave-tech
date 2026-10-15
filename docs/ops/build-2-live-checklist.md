# tech-build.2 — live checklist (owner)

The owner does not run the app locally ([ADR-0063](../decisions/0063-files-ingest-and-automated-gates.md)
Decision 1): the automated gates passed (see [build-2-result.md](build-2-result.md)), and this list
is the first manual test, on the live site, **after** you merge `build/files-ingest`.

Files to upload are in [`build-2-fixtures/`](build-2-fixtures/) (download them from GitHub). Use a
new chat for each step unless the step says otherwise. "Chip" is the file card in the message box.

## Before you start (once)

1. **Deploy config to check, not change:** the backend image now installs `ffmpeg`. After the Cloud
   Build deploy, open Cloud Run → `arcnave` backend → *Revisions*: the newest revision serves 100 %
   of traffic. **Failure:** an older revision still serves (mistakes.md, "spec is not serving").
2. **Migration:** Cloud Run logs of the new revision show `migrations applied` (migration
   `0029_files_ingest`). **Failure:** `migration failed`; stop and report.
3. **Malware scanning stays off** (`FILE_SCANNER=none`) until you deploy clamd. Step 12 says what
   to do then.
4. The first minutes after deploy, the backfill re-reads every older project file (index version 3).
   Project files may show "Reading…" briefly. **Failure:** a project file stays in a reading state
   for more than 20 minutes.

## Steps

### 1. A job moves while you watch (P06 gap a)
- **Upload:** any small PDF into a chat.
- **Expected:** the chip shows *Checking…* / *Reading…* and turns ready within a few seconds;
  Send becomes active.
- **Failure:** the chip stays on *Waiting to be read…* for more than a minute, or only becomes
  ready after you send another request.

### 2. Scanned PDF → OCR per page → project search
- **Upload:** `01-scanned-statement.pdf` into a **project** (Project → Files → Add).
- **Expected:** the row shows *Reading scanned pages…*, then `N indexed chunks`. In a chat in that
  project ask: *"What is the closing balance?"* → the answer says **25,450** and cites page 2.
- **Failure:** the row ends `unsupported` / "no text could be read", or the answer cannot find the
  balance.

### 3. Mixed PDF keeps both kinds of pages
- **Upload:** `02-mixed-text-and-scan.pdf` in a chat. Ask: *"What is the invoice total on page 1,
  and what was paid on page 2?"*
- **Expected:** **4,800 rupees** (typed page) and **1,250** (scanned page).
- **Failure:** either figure is missing or wrong.

### 4. A 150-page scan is readable
- **Upload:** `03-scan-150-pages.pdf` in a chat. Wait for the chip to be ready (OCR takes a few
  minutes: 10 batches of 15 pages).
- **Ask:** *"What amount is on entry 137?"* → **13700**.
- **Failure:** the chip fails, shows an `ocr_partial` note listing many pages, or the answer says the
  pages cannot be read.

### 5. A 40 MB recording, with timestamps
- **Upload:** any recording of 35–45 MB (for example a 40-minute MP3 at 128 kbit/s, or a phone voice
  memo) in a chat.
- **Expected:** the chip shows *Transcribing…* then ready. Ask: *"Summarise what is said between
  minute 3 and minute 5, with timestamps."* → the answer quotes `[03:00–04:30]`-style times.
- **Failure:** the chip fails (`timeout`, "could not be transcribed"), or a recording over 3 hours
  is accepted (it must be refused as too long).

### 6. An 8 MB phone photo with location reaches Claude
- **Upload:** a phone photo taken with **location on**, 6–10 MB (iPhone HEIC works too). Choose
  **Sonnet 5.5**. Ask: *"Describe this photo."*
- **Expected:** a description; no "too large" / `provider_payload_limit` error.
- **Failure:** an error about image size, or no answer.
- *Optional, technical:* the stored copy has no GPS. In Cloud SQL run
  `select normalized_key from file_derivatives order by created_at desc limit 1;` then
  `gsutil cp gs://<STORAGE_GCS_BUCKET>/<normalized_key> /tmp/x.jpg` and `exiftool /tmp/x.jpg | grep -i gps`
  → nothing. **Failure:** any GPS line.

### 7. Stage 8 skill-test files and more, each with locators
Upload each into its own chat and ask:
- `04-tamil-a4.docx` → *"What is the budget for the library?"* → **twelve lakh**, Tamil text read
  correctly.
- `05-deck-16x9.pptx` → *"What do the speaker notes on slide 1 say?"* → **Mention the Chennai branch
  first.**
- `06-budget-lakh.xlsx` → *"Which cell holds the Labs amount, and what is it?"* → **B3, 1,23,45,678**
  (lakh format); mentions the hidden sheet *Workings* if asked.
- `07-tamil.pdf` → *"What does this PDF say?"* → Tamil words about a language/education report.
- `08-cities-utf16.csv` → *"What is the amount for சென்னை-1500?"* → **150000**.
- **Failure:** any answer is wrong, the Tamil comes out as boxes or Latin gibberish, or a file fails.

### 8. A large CSV goes through retrieval, not whole
- Uploads are limited to 100 MB for documents (N-10), so live uses the largest you have: a CSV of
  50–100 MB with one distinctive row (for example a bank export).
- **Ask** about that one row by a name in it.
- **Expected:** the right figure; no `context_overflow`, no "too long" error.
- **Failure:** `context_overflow` or a timeout.

### 9. A 100-page PDF on Claude
- **Upload:** `09-agreement-100-pages.pdf`. Choose **Sonnet 5.5**. Ask: *"What does the quorvane
  clause say?"*
- **Expected:** **a penalty of 2 percent per month**, page 58.
- **Failure:** `provider_payload_limit`, or the clause is not found.

### 10. Token counts stored per model family (technical)
- After step 7, in Cloud SQL: `select kind, token_counts from file_derivatives order by created_at desc limit 5;`
- **Expected:** each row has `gemini` and `claude` with `"exact": true` and a number.
- **Failure:** `"reason": "unavailable"` for every row (a count API is not reachable: check the
  service's Vertex and `ANTHROPIC_API_KEY` setup).

### 11. PDF with an OpenAction comes back stripped
- **Upload:** `10-openaction.pdf` in a chat. When ready, open the chip's menu → Download.
- **Expected:** the chip notes *"Scripts and automatic actions in this PDF were removed"*; the
  downloaded PDF opens with no alert box in Adobe Reader.
- **Failure:** no note, or the downloaded copy still shows the alert *"ArcNave test: this script
  should have been removed"*.

### 12. Malware scan (only after clamd is deployed)
- Today: skip; `FILE_SCANNER=none`.
- When you deploy clamd (sidecar or service), set `FILE_SCANNER=clamd`, `CLAMD_HOST`, `CLAMD_PORT`,
  and clamd's `StreamMaxLength` ≥ 500M. Then upload the EICAR test file (create a text file holding
  the standard EICAR string from eicar.org).
- **Expected:** the chip fails with *"This file was removed because it looks harmful."*
- **Failure:** the file becomes ready, or fails `scan_incomplete` (clamd unreachable or its limit too
  low).

### 13. One ingest path: project file and chat file read alike
- **Upload** `06-budget-lakh.xlsx` into a project, and again into a chat outside the project.
- **Ask** the same question in a project chat and in the plain chat: *"Library amount?"*
- **Expected:** both **12,34,567**.
- **Failure:** the answers differ, or the project row ends `unsupported`.

### 14. Replace a project file (API only for now)
- No button yet. Skip unless you use the API: `PUT /v1/projects/:id/files/:fileId` with a new file;
  the same row id re-reads and old answers no longer appear.

## What to send back

For each step: pass / fail, and for a fail the chip's text or the error card's title and the
request id. Paste them in the next task brief.
