# ArcNave – Checkpoint · Stage 9 File-processing pipeline – LOCKED 2026-10-02
_User OK 2026-10-02. This checkpoint is the final word; where 09-file-processing.md / 09c differ (drafts), this file wins._

> **Doc-sync 2026-10-03 (Stage 12) – Stage 12 Retrieval (see Stage-12-Retrieval/00-checkpoint-stage12.md):**
> - Stage 12 additions to the pipeline: detect **several tables in one sheet** (split on empty rows/cols) before CSV/Parquet export; **audio chunks by 60–120 s segments** with t_start–t_end; chunks store **PDF page index + printed page label** (DOCX: heading + page); Docling **page furniture excluded from chunks** (kept for provenance); NFC at index time; embedding token pre-count; 1 page per image-embedding request; upload embeddings in a low-priority lane.


> **Doc-sync 2026-10-03 (Stage 15) – see Stage-15-Error-Handling-Fallbacks/00-checkpoint-stage15.md:**
> - File error taxonomy ER-9 (unsupported_type, too_large/too_many_pages, encrypted, corrupt, malware, ocr_failed, ocr_blocked, timeout, quota) with Retry/Remove; Doc AI LRO check before resubmit; quota 6 req/min default → increase before launch (LV-1); embeddings re-queued per row.

> **Doc-sync 2026-10-03 (Stage 16) – see Stage-16-Security-Safety/00-checkpoint-stage16.md:**
> - File hardening SE14: ClamAV AlertExceedsMax + encrypted-archive alert → `malware` / `scan_incomplete` blocked; PDF JavaScript/OpenAction/Launch best-effort strip; images re-encoded (EXIF stripped), Pillow bomb limits; LibreOffice Very High + no trusted locations; no secrets in parser/sandbox images.

> **Doc-sync 2026-10-03 (Stage 18) – see Stage-18-Cost-Performance/00-checkpoint-stage18.md + 00-Handoff/00-cost-decision-log.md:**
> - Document AI Mumbai default quota is **6 requests/min/project/processor** → request 60 req/min before launch; >15 pages per document → batch processor path (CD-12). OCR cost $1.50/1k pages (1,000 free/month); OCR quota 1,000 pages/company/month default.

> **Doc-sync 2026-10-03 (Stage 19) – see Stage-19-Infrastructure/00-checkpoint-stage19.md:**
> - Delhi (asia-south2) has **no Document AI** → DR mode OCR = Gemini OCR fallback only (Stage 19 ID-15).

> **Doc-sync 2026-10-03 (Stage 20 + review 13–20) – see Stage-20-Vendor-Tool-Selection/00-checkpoint-stage20.md and 00-Handoff/00-review-stages-13-20.md:**
> - SPD-5 bake-off now Gemini 3.8 Flash vs **Speech-to-Text v2 Chirp 3 asia-south1** (Hindi GA, Tamil Preview, India processing) – Stage 21 (VS-17). FFmpeg LGPL build via subprocess (no pydub); ZIP via stdlib only; Playwright/Chromium for HTML→PDF/PNG; Docling model assets in licence register. OCR quota default **5,000 pages/company/month** (review R-6).

## Docs
| Doc | What |
|---|---|
| 09-astra-prompt.md / 09b-astra-prompt.md | Research prompts (round 1, round 2) |
| 09-file-processing.md | Round 1 facts, gaps G1–G28, Claude-only CF1–CF9 |
| 09c-visual-retrieval-chunking.md | Round 2: visual retrieval, chunking, extraction tech (V-1…V-10) |
| 09-file-processing-scope.md | Pre-research scope (superseded) |

## Pipeline (locked)
Upload complete → Cloud Task → 1 check (magic + extension + allowlist + limits) → 2 ClamAV → 3 ZIP unpack → 4 DOCX/PPTX → PDF (LibreOffice) → 5 Docling text/structure/tables → 6 scanned pages → Document AI OCR → 7 audio → Gemini transcript → 8 Excel summary + CSV/Parquet → 9 images normalise + OCR → 10 normalised Markdown + JSON sidecar → 11 token count → 12 chunks → 13 embeddings (text + visual pages) → 14 ready / failed.
Answer time (big files): search → top pages → OCR/extracted text + those pages' images to the model.

## Locked decisions (one line each)
- **OCR (M11):** Document AI Enterprise OCR, asia-south1, pinned GA version; Gemini vision fallback on quota/outage.
- **Speech (M10, SPD-5):** Gemini 3.8 Flash for mic + audio files, provisional; final after Stage 21 Tanglish/Tamil/Hindi eval (G51). Chirp 3 no; gemini-3.5-transcribe re-check at GA. Mic max 2 min (SPD-3 / G50). Audio citations by timestamp (G41).
- **Limits:** docs ≤100 MB / ≤1,000 pages · XLSX ≤50 MB (G44) · images ≤20 MB · audio ≤500 MB / ≤3 h · ZIP ≤100 MB, ≤20 files, ≤500 MB uncompressed · ≤10 files/message, ≤20/chat · project file limits (G43), per-user upload rate limit (G33), company OCR-page + audio-minute quotas (G31): numbers in Stage 18.
- **Types:** Stage 1 list + CSV, TXT, MD (G32). Reject macro (.docm/.xlsm/.pptm) and legacy (.doc/.xls/.ppt) with "save as" message.
- **PDF to model:** small PDF within budget → whole PDF (text + page images); large → text + images of retrieved pages, Fast 3 / Normal 8 / Deep 20 (V-3).
- **Visual retrieval (V-1, V-2):** Gemini Embedding 2 page-image vectors for visual pages only (scanned, images, charts, tables). LLM image descriptions Later.
- **Office visuals (V-4):** DOCX/PPTX → PDF via LibreOffice, macros off.
- **Extraction stack (V-5):** Docling behind a swappable extractor layer; bake-off Docling vs Unstructured vs own (pypdfium2 + pdfplumber + LangChain) in Stage 21.
- **Isolation (G34):** all parsers (Docling, LibreOffice, PDF render) in an isolated sandbox service: no egress, no secrets. Background worker orchestrates only.
- **Excel:** whole if ≤30k tokens; else per-sheet summary + samples; sheets → CSV/Parquet for run_code (G44); cell addresses (G47); hidden sheets included + labelled (G37).
- **Tables (V-7):** Docling TableFormer; scanned tables = OCR text + page image. No Form Parser.
- **Normalised format:** Markdown + JSON sidecar with page/slide/sheet/cell/section ids, OCR confidence, warnings, extractor/model versions (G47).
- **Chunking (V-6):** ~800 tokens, ~15% overlap, ancestor headings, table header repeat, location ref.
- **Embedding (V-8, provisional, Stage 12 confirms):** Gemini Embedding 2, 1,536 dims, text + images; vectors in Mumbai pgvector. Limits E1 max 8,000 tokens/text + no silent truncation · E3 1,536 dims · E4 ~2,000 chunks/file · E5 company quota · E6 batch size via LV-1 · E7 retry, FTS works meanwhile.
- **When to embed:** big/retrieval files at upload; small chat files lazily; project files always.
- **Contextual retrieval (V-10):** slot built, OFF until eval (L-4).
- **Token count (G46):** includes page-image tokens (Gemini 560/page; Claude 28×28 formula) per model family.
- **Page images (G49):** not stored; rendered on demand from stored PDF (process pool, pypdfium2 not thread-safe). Revises Stage 6 CXD-4 note.
- **Claude images (G48):** >20 images → ≤2,000 px; JPEG; request-size budget under 30 MB.
- **Ready (D1 unchanged):** Send blocked until text + token count ready; embedding continues in background.
- **Capacity (G30 revised):** small-file fast lane (target ≤10 s), quota-based scaling + quota increase before launch, Gemini OCR fallback, big files via batch with progress, company fairness only under saturation, alert when queue wait >5 s.
- **Safety:** G1–G5 (type, ClamAV limits + AlertExceedsMax, encrypted reject, defusedxml, ZIP bomb rules), G36 image pixel cap, G35 legacy Tamil font detection → OCR, G24 files untrusted.
- **Content details:** G38 PDF form fields + comments, G39 embedded files ignored + warning, G40 DOCX final text + comments, G10 DOCX/PPTX images via rendered pages, G25 per-file warnings.
- **Lifecycle:** G29 cancel + clean up when file/chat deleted mid-processing; G45 reference-counted deletion for deduped files; G23 app delete ≤23 d + 7-d soft delete; G42 project file replace = re-process + old data deleted; G53 ArcNave artifacts go through the same pipeline.
- **Retry / re-process:** Retry button MVP; bulk re-process Later. File card summary Later. Claude native citations Later (keep `[file:n]`). Company glossary for transcription Later (G52).
- **Not used in MVP:** RAG Engine (no residency), Layout Parser (not Mumbai), ColPali, Form Parser, Perplexity embeddings API.
- **Claude-only:** CF1–CF9 (09-file-processing.md).

## LV-1 additions from Stage 9
1. Document AI OCR: GA version in asia-south1; Hindi/Tamil printed + handwritten quality; quotas (requests/min, batch jobs).
2. Gemini 3.8 Flash transcription: Tanglish/Tamil/Hindi accuracy, 2-min mic latency, long-audio split size.
3. gemini-3.5-transcribe Tamil (when GA).
4. Gemini 3,000-page PDF + 560 tok/page; Claude tokens per PDF page.
5. ClamAV scan time at 100 / 500 MB.
6. HEIC conversion from Android.
7. Docling vs Unstructured vs own bake-off (20 Indian sample docs): accuracy + speed on Cloud Run CPU.
8. Gemini Embedding 2: tokens per page image, latency, text→page-image retrieval quality on Indian docs, batch size (250 vs 1), GA vs Preview price label.
9. LibreOffice Indic font + chart fidelity.
10. pypdfium2 render time at 2,576 px in process pool.
11. Legacy Tamil font (Bamini/TSCII) detection.
12. Small-file fast lane ≤10 s end-to-end.

## Doc-sync debt
- Stage 1: add CSV/TXT/MD.
- Stage 4 L5i B6 + handoff: Gemini PDF 3,000 pp, images 3,000, HEIC.
- Stage 4 L5f: SPD-3 = 2 min, SPD-5 = Gemini provisional.
- Stage 6 CXD-4 note: page images rendered on demand, not stored.
- Stage 7 capability matrix: Claude 600 pp (1M ctx), 28×28 image formula, Gemini document MIME list.
- Stage 8: sandbox input for large Excel = CSV/Parquet; parser sandbox service shares runner design.

## Deferred
- Stage 10: whole-document map-reduce job.
- Stage 12: hybrid search, reranker, query rewrite, embedding final pick, FTS language config, RAG Engine vs own (own expected).
- Stage 14: progress UI, citation file viewer.
- Stage 16: parser sandbox security review.
- Stage 17: per-file metrics. Stage 18: all numbers (quotas, limits, cost).
- Stage 21: bake-off, speech eval, LV-1.

## Doc-sync 2026-10-05 (Stage 21 Task 0.12 brief – Document AI live tests LV-35 / LV-105)
- **LV-35 / LV-105** (Task 0.12): a dev LV-only Enterprise OCR processor `lv-ocr` (`OCR_PROCESSOR`, asia-south1) called by the in-VPC runner through `asia-south1-documentai.googleapis.com` (private VIP expected); pinned version `pretrained-ocr-v2.1-2024-08-07` (stable), RC `pretrained-ocr-v2.1.1-2025-01-31` as a probe; synthetic printed English / Tamil / Hindi / mixed pages (clean 200 dpi + degraded), optional owner handwriting cards (EXIF stripped), and **Gemini 3.8 Flash OCR on the same pages** (quality of the M11 fallback and of DR-mode OCR, ID-15). Error rate = CER / WER after NFC. LV-105: burst of 8 online requests at the default quota, 16-page online refusal, 20-page batch timing; quota request 6 → 60 req/min in dev (ID-17 rehearsal, LV-105Q).
- **Facts per Google pages (reviewer fetch 2026-10-05; Claude Code re-confirms in Task 0.12):** asia-south1 is a "limited support" single-region location offering OCR v1.2 / v2.0 / v2.1 / v2.1.1; online max **15 pages / 40 MB**; batch max **500 pages per document / 1 GB / 5,000 files per request**; online requests **6 / min per project per processor type** in single-region locations; 5 concurrent batch requests.
- **Consequence to confirm:** batch max 500 pages is below our 1,000-page document limit → Phase 3 splits scanned PDFs above 500 pages before batch OCR (fits AS-D2 "split long PDFs into parallel pieces"). Recorded at Task 0.12 close.

## Doc-sync 2026-10-05 (Stage 21 Task 0.12 review – Part 1 corrections to the brief block above)
- **Correction – versions in Mumbai:** Google's regions table (read cell by cell by Claude Code from the page HTML, 2026-10-05) ticks **only `pretrained-ocr-v2.1.1-2025-01-31` (Release candidate / Preview)** for asia-south1; v1.2, v2.0 and **v2.1 (the stable version we planned to pin) are not marked there** (they are for us / eu). The brief block above wrongly listed all four for asia-south1. LV-35 case 35.2 reads the live version list; Task 0.12 fix F-1 measures OCR quality with the RC if the pinned version is not deployed. **Open product question for the Task 0.12 close:** M11 "pinned GA version in asia-south1" may not be possible – options then: pin the RC in Mumbai, or Gemini OCR, or a non-India region (excluded by C1 / C3 storage-and-processing rules for customer files – not an option without an owner decision).
- **Languages (Google "processors list", Enterprise OCR table):** handwriting supported for English and Hindi, **not supported for Tamil**; printed text supported for all three.
- **Quotas:** confirmed 6 online requests / min per project per processor type (single region); concurrent batch requests **5 per processor** (single region). Metric names `documentai.googleapis.com/processor_online_process_document_requests_regional` and `…/processor_concurrent_batch_process_document_requests_regional`.
- **Batch storage access:** the caller needs read / write on the buckets; the auto-granted DocumentAI Core Service Agent role (`roles/documentaicore.serviceAgent`) already holds storage object permissions in the same project – no extra grant for same-project buckets (verified live by LV-105).

## Doc-sync 2026-10-06 (Stage 21 Task 0.12 close)
- **OCR version in Mumbai (LV-35 35.2 FAIL):** asia-south1 deploys only `pretrained-ocr-v2.1.1-2025-01-31` (RC) and `pretrained-ocr-v1.0-2020-09-23`; the pinned GA `v2.1-2024-08-07` is **absent**. Measured with the RC: printed clean EN / TA / HI CER 0.0; mixed EN+TA/HI CER 0.042 (clean) / 0.050 (degraded), language confidence 0.49 on mixed pages; degraded EN 0.0043, TA / HI 0.0; 4-page scanned PDF OK (page CER 0.0043 / 0 / 0 / 0.042); Tamil language hint OK. OCR server time 0.26–0.42 s per page. Handwriting not measured (no fixtures; Tamil handwriting is unsupported). **Decision pending (ADR): pin the RC in Mumbai / Gemini OCR / US–EU Document AI (a non-India processing region for customer files – only with an explicit owner decision under C1 / C3).**
- **Quotas, asia-south1 defaults (LV-105Q):** 10 online requests / min per processor type; **5 online pages / min** per processor type + model version; 5 concurrent batch requests. Google's quota page lists 120 pages / min and 120 requests / min as the US / EU defaults. A burst of 8 one-page requests got 8 × 200 – enforcement is not strict per burst; do not rely on that.
- **Online limit 15 pages** (16 pages → 400 INVALID_ARGUMENT). **Batch is not interactive:** 20 pages took 558 s (≈ 9.3 min) LRO. Product rule: ≤ 15 pages online; larger files split into 15-page chunks sent online in parallel (needs a higher pages quota); batch only for very large files in the background with a "processing" status. Estimate (not measured): 110 pages ≈ 22 min at 5 pages / min, ≈ 2 min at 60 pages / min → synthetic 110-page test in a later task.
- **Batch max 500 pages** per request (documentation) is below our 1,000-page document limit → Phase 3 splits scanned PDFs above 500 pages before batch OCR (rule confirmed at this close; 500 pages not measured).
- `best_effort_online_process_document_pages_*` applies only to Gemini-based processors (Custom Extractor) – not to Enterprise OCR.
- **Gemini OCR fallback (M11):** run 1 CER 0.0 on 7 of 8 printed images; the rerun got **504 DEADLINE_EXCEEDED after 68 s** on the 4th image → the fallback needs its own deadline / retry rule (Stage 15).
- The pages quota has only a "(default)" row in the Console (no region / version dimension); a Console increase request on it fails ("try again later", twice) → ask through support / the sales contact with region + processor type.

## Doc-sync 2026-10-06 (ADR-0006 – Mumbai OCR version, owner decision D)
- **M11 changed (version only):** primary OCR = Document AI Enterprise OCR in asia-south1 pinned to the exact id `pretrained-ocr-v2.1.1-2025-01-31` (release candidate – no GA version is deployed in Mumbai); **Gemini 3.8 Flash OCR (global) as fallback** on quota exhaustion, 5xx / timeout, or the pinned version disappearing – own deadline, at most one retry, then the page is marked failed. US / EU Document AI not used.
- Each page records `ocr_engine` + `ocr_version` (sidecar + usage ledger). Monthly check of deployed versions in asia-south1; when GA appears, re-run LV-35 and move the pin.
- Cost unchanged (FD-05 OCR ≈ ₹0.8 per user per day). Pre-GA terms of the RC → next legal pass. See `docs/architecture/adr/0006-mumbai-ocr-rc-pinned-gemini-fallback.md`.
