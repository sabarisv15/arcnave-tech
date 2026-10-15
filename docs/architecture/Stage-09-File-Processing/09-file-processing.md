# ArcNave – Stage 9 · File-processing pipeline – DRAFT
_2026-10-02 · Source: GPT Astra (official URLs + quotes, checked 2 Oct 2026) + saved facts · Status: DRAFT – decisions need user OK · Supersedes 09-file-processing-scope.md (pre-research)_

Labels: ✅ Vendor documented · ⚠️ Partial / conflicting · 🔧 ArcNave design (our recommendation, not vendor fact)

## 1. Real-product evidence (apps, not APIs)
| | Claude (claude.ai) | ChatGPT | Gemini app | Perplexity |
|---|---|---|---|---|
| Size / count | 500 MB/file, 20 files/chat, PDF ≤1,000 pp; Projects 30 MB/file ✅ | 512 MB/file, docs 2M tokens/file, sheets ~50 MB, images 20 MB, 80 files/3 h ✅ | 10 files/prompt, 100 MB/file (video 2 GB); audio 10 min (paid 3 h) ✅ | 40 MB/file; Ent Ask 30 files × 50 MB; Projects 100 MB/file ✅ |
| PDF | ≤100 pp text + visuals; 101–1,000 pp text only ✅ | Enterprise prompt PDFs = visual retrieval; project/GPT files = text ✅ | Not documented | Ask = parsable text ✅ |
| Scanned PDF OCR | Visual only within 100 pp; no named OCR ⚠️ | Visual retrieval (Ent); no named OCR ⚠️ | Not documented | Not documented |
| Spreadsheets | Code execution (Python) ✅ | Code Interpreter ✅ | Analysis + charts (route undocumented) ⚠️ | Computer uses code; Ask = text ⚠️ |
| DOCX/PPTX images | Text only, embedded images ignored ✅ | Text extracted, images discarded ✅ | Not documented | Not documented |
| ZIP | Not documented | Not documented | Accepted: 100 MB, 10 files, no audio/video inside ✅ | Computer can open ZIP in Projects ✅ |
| Failure UX | "Uploaded file is too large" ✅ | "upload limit reached"; failed tries count ✅ | "Delete data to upload file" ✅ | Upgrade prompt / project cap ✅ |
| Retention | Ent custom ≥30 d (default indefinite) ✅ | Library files survive chat delete ✅ | Activity 18 months (personal) ✅ | Session files 30 d, Ent 7 d ✅ |

**Pattern (what everyone does):** Office files → text extraction, embedded images dropped · PDFs → visual pages only for small files, text for big · spreadsheets → code tool · scanned-PDF OCR engines never published · limits shown as plain error messages.

## 2. Key vendor facts for our stack (Vertex)
**Gemini 3.8 Flash (Vertex)** ✅
- PDF 50 MB, **3,000 pages**/file (Vertex model page). 1,000 pages = Developer API only → conflict resolved.
- PDF tokens/page: LOW 280 / **MEDIUM 560 (default)** / HIGH 1,120 + extracted text. Images 280/560/1,120/2,240 (ULTRA), default HIGH.
- Native document types only `application/pdf`, `text/plain`. DOCX/XLSX/PPTX not accepted.
- Images png/jpeg/webp/**heic/heif**, ≤3,000/prompt; inline 7 MB, GCS 30 MB.
- Audio 11 MIME types, **1 audio file/prompt**, ~8.4 h. 32 tok/s generic (3.8-specific not found).

**Claude Sonnet/Opus 5.5 (Vertex)** ✅
- Document blocks: base64 PDF, text/plain, custom content. No DOCX/XLSX/PPTX. PDF base64 only (no URL, no Files API).
- PDF = text + page images; **600 pages with 1M context** (100 with smaller); no encrypted PDFs.
- **30 MB whole request incl. base64** (generic docs say 32 MB → Vertex wins).
- Image tokens (4.7+): `ceil(w/28) × ceil(h/28)`, long edge 2,576, max 4,784 tokens/image; 5 MB base64/image; >20 images → ≤2,000 px; ≤600 images.
- Citations: plain text → `char_location` (0-based, end-exclusive); custom content → `content_block_location` (block index); PDF → `page_location` (1-based). Scanned PDF without text = not citable.

**Document AI** ✅/⚠️
- Enterprise OCR GA (v2.0, v2.1; v2.1.1 Preview); Form Parser GA; Layout Parser GA v1.0 + Gemini-based Preview versions (global inference, no residency).
- **Mumbai: OCR + Form Parser yes, Layout Parser no.** Exact Mumbai version matrix not found ⚠️.
- OCR languages include **Hindi, Tamil**; handwriting flags for hi/ta not verified ⚠️.
- Sync: 15 pages, 40 MB (Layout 20 MB). Batch: 500 pages (Form 100), 1 GB/file, 5,000 files.
- Price /1k pages: OCR $1.50 (first 1k free; $0.60 > 5M), Form $30, Layout $10.

**Speech** ⚠️
- Chirp 3: **US/EU multi-region only** (no Mumbai/global); en-IN, hi-IN GA, **ta-IN Preview**; no code-switch guarantee; diarization not for ta-IN; sync <1 min, batch 1–60 min (20 min with word timestamps); $0.016/min.
- gemini-3.5-transcribe: **Preview, global**, 85+ languages + code-mixing, Tamil not listed; diarization/timestamps Experimental, 15 min (pricing page says 60 min ⚠️); ~$0.0051/min.
- Gemini 3.8 Flash audio: GA, global; timestamps/speakers only via prompt (not guaranteed); no official split guidance.

**Libraries / security** ✅
- Licences OK: pypdf BSD-3, pdfplumber MIT, pdfminer.six MIT, pypdfium2 Apache/BSD (+PDFium notices), python-docx/openpyxl/python-pptx MIT, MarkItDown MIT, Docling MIT (models separate), Unstructured Apache. No library publishes size limits → our limits.
- openpyxl: **no XML-bomb protection by default → install defusedxml**.
- ZIP: Python "never extract untrusted archives without inspection"; OWASP: limit **decompressed** size. No standard numbers → ours.
- ClamAV defaults: StreamMaxLength 100M, MaxFileSize 100M, MaxScanSize 400M; **bigger files skipped silently** (AlertExceedsMax = no); >2 GB unscannable.
- python-magic: read ≥2,048 bytes; one Magic instance per thread. OWASP: magic check alone not enough.
- CSV/XLSX formula injection (`= + - @`): no universal sanitizer.

**Chunking** ✅/⚠️
- OpenAI file_search 800-token chunks / 400 overlap; no CSV/XLSX/ZIP/images/audio.
- Vertex Layout Parser chunks 1,024 / 256 (console); RAG Engine Mumbai Preview; Layout Parser not in Mumbai.
- Anthropic: long docs first, query last, `<document>` tags, quote-grounding. No vendor says Markdown vs JSON.

**Compute / storage** ✅
- Cloud Run max 32 GiB; filesystem **in memory**; service 60 min; jobs 168 h.
- GCS OBJECT_FINALIZE / Eventarc **at-least-once, duplicates, unordered**.
- Lifecycle Delete = async, no SLA. Soft delete default 7 d (0–90, per bucket).

## 3. Corrections to saved facts
| Old | New |
|---|---|
| Gemini PDF 1,000 pp (L5i B6) | Vertex 3.8 Flash = **3,000 pp**, 50 MB |
| Gemini images ≤3,600/request | **≤3,000/prompt**; inline 7 MB / GCS 30 MB; HEIC OK |
| Claude PDF ≤600 pp | 600 only with **1M context** (5.5 = 1M → OK); 100 otherwise |
| Claude image cost (area/750) | **28×28 patches**, max 4,784 tokens |
| Doc AI OCR "v2.1.1 preview" only | GA v2.0/v2.1 exist; Mumbai version matrix unverified |

## 4. Pipeline (🔧 proposed shape)
```
Upload done (UD-4 session) → API enqueues Cloud Task (file-blocking queue)   [no Eventarc in MVP]
 1 Intake     : magic sniff (≥2 KB) + extension + allowlist + size/page caps → reject early
 2 Scan       : ClamAV INSTREAM (limits ≥ our max, AlertExceedsMax=yes) → quarantine on hit
 3 Unpack     : ZIP only – inspect first, limits, each member = own file (UD-2)
 4 Extract    : per-type extractor in subprocess (time + memory limits, defusedxml)
 5 OCR        : scanned / "(cid:" / empty pages + images → Document AI OCR (Mumbai)
 6 Transcribe : audio → split pieces (AS-D2) → Gemini 3.8 Flash → merge
 7 Normalise  : Markdown + JSON sidecar (page map, tables, images list, warnings, versions)
 8 Count      : tokens (Gemini countTokens + Claude count_tokens, free) → whole (≤30k) or retrieval
 9 Index      : chunks + embeddings (Stage 12 decides how) for retrieval files
10 Ready      : status=ready (DB truth, AS-D5) → Send unblocked (D1); failed → reason + Retry + Remove (AS-D6)
```

## 5. Gaps (final list)
| # | Gap | Label | MVP / Later |
|---|---|---|---|
| G1 | Content-based type check (magic ≥2 KB + extension + allowlist); legacy .doc/.xls/.ppt and macro files (.docm/.xlsm/.pptm) rejected with message | ✅ OWASP / 🔧 | MVP |
| G2 | ClamAV limits raised to our max + AlertExceedsMax=yes (else big files pass unscanned) | ✅ ClamAV | MVP |
| G3 | Encrypted / password files → clear error "remove password" | ✅ Claude no encrypted PDF | MVP |
| G4 | XML-bomb protection (defusedxml) for all Office parsing | ✅ openpyxl | MVP |
| G5 | ZIP: inspect before extract; caps on members, total uncompressed size, ratio; no nesting, symlinks, path traversal, encryption | ✅ Python/OWASP | MVP |
| G6 | Extractors run in subprocess with time + memory caps; stream to GCS (in-memory FS) | ✅ Cloud Run / 🔧 | MVP |
| G7 | Per-page scanned detection (empty / "(cid:" / low text) → OCR only those pages | 🔧 | MVP |
| G8 | OCR engine with Hindi/Tamil, in Mumbai | ✅ Doc AI | MVP (D9-1) |
| G9 | Tables kept as Markdown tables with page/sheet ref | 🔧 | MVP |
| G10 | DOCX/PPTX embedded images: text only + warning "N images not read" (same as Claude/ChatGPT) | ✅ pattern | MVP; image captions Later |
| G11 | PPTX: slide text + speaker notes, slide markers | 🔧 | MVP |
| G12 | XLSX: read_only + cached values; per-sheet summary (columns, types, row count, sample) + code tool for maths; warn when formulas have no cached value | ✅ pattern / 🔧 | MVP |
| G13 | Formula-injection escaping when our generated CSV/XLSX contains user/file text | ✅ OWASP | MVP |
| G14 | Images: EXIF rotate, HEIC→JPEG, resize to ≤2,576 px long edge and ≤5 MB (Claude limits; Gemini also OK); keep original | ✅ limits / 🔧 | MVP |
| G15 | Images also OCR'd (cheap) so text inside images is searchable | 🔧 | MVP |
| G16 | Audio split into pieces with small overlap, merge, timestamps per piece; speaker labels best-effort | ⚠️ no official guide | MVP |
| G17 | One normalised format + extractor/OCR/model version stamps | 🔧 | MVP |
| G18 | Token count per model family at ingest (Claude tokenizer ~30% more) | ✅ free APIs | MVP |
| G19 | Native PDF (visual) only when it fits budget + limits; else extracted text | ✅ limits / 🔧 | MVP (D9-3) |
| G20 | Request-size guard: Claude 30 MB incl. base64 (~22 MB raw), Gemini inline 7 MB/image | ✅ | MVP |
| G21 | Idempotent jobs (Cloud Tasks at-least-once, retries) keyed by file id + version | ✅ | MVP |
| G22 | Status states + progress (queued/scanning/extracting/ocr/transcribing/indexing/ready/failed) | 🔧 | MVP |
| G23 | Deletion: app-driven delete of upload + derived objects ≤23 d, 7-d soft delete → ≤30 d total (matches R11); lifecycle only backstop (no SLA) | ✅ GCS | MVP |
| G24 | Files are untrusted content (prompt injection) – tagged as data in context | ✅ Anthropic | MVP (Stage 6 rule exists) |
| G25 | Per-file warnings shown to user (OCR'd pages, skipped images, truncated sheets, low OCR confidence) | 🔧 | MVP |
| G26 | Language detect per file (FTS stemmer / embeddings) | 🔧 | Later |
| G27 | Re-process when extractor improves | 🔧 | Later (on-demand Retry in MVP) |
| G28 | Handwriting OCR quality Hindi/Tamil | ⚠️ unverified | LV-1 test |

## 6. Claude-only list
| # | Fact → ArcNave impact | Label |
|---|---|---|
| CF1 | No Files API on Vertex; PDF base64 only → file bytes sent every call; prompt cache helps repeat turns | ✅ |
| CF2 | 30 MB whole request incl. base64 → raw PDF ≤ ~22 MB for native mode; bigger → text only | ✅ |
| CF3 | PDF 600 pp needs 1M context (5.5 OK); each page = text + image tokens (~1.5–3k) → native PDF only for small files | ✅ |
| CF4 | Only PDF / text / custom content blocks → DOCX/XLSX/PPTX always sent as our extracted text | ✅ |
| CF5 | No audio input → transcript text only | ✅ |
| CF6 | Images: no HEIC (convert), 5 MB, 28×28 patch cost, max 4,784 tokens, >20 images → 2,000 px | ✅ |
| CF7 | Native citations possible on custom content (block index) and PDFs (page) but **not with structured outputs** → keep Stage 6 `[file:n]` scheme MVP; native citations Later eval | ✅ / 🔧 |
| CF8 | Scanned PDF without text layer not citable → our OCR text needed for Claude too | ✅ |
| CF9 | Same file can't reuse Gemini's processing; count tokens separately for Claude | ✅ |

## 7. Decisions (recommendations – need OK)
| ID | Decision | Options | Rec |
|---|---|---|---|
| **D9-1** | OCR engine (M11) | (a) Document AI Enterprise OCR, Mumbai (b) Gemini 3.8 Flash vision, global (c) both | **(a)** primary for text/search: India processing, Hindi/Tamil listed, $1.50/1k pages, confidence scores. Model still sees page images at answer time for small PDFs (D9-3). Gemini vision fallback only if Doc AI fails. Pin GA version available in Mumbai (LV-1). |
| **D9-2** | Speech engine (M10, SPD-5) | (a) Gemini 3.8 Flash audio (b) Chirp 3 (c) gemini-3.5-transcribe | **(a)** MVP: GA, global (C3 OK), one model for mic + audio files, code-mixing via prompt. Chirp 3 no (US/EU only, ta-IN Preview). (c) re-check when GA + Tamil listed. LV-1 Tanglish/Tamil test. |
| **D9-3** | PDF to model | (a) text only (b) native PDF always (c) both by rule | **(c)**: always extract text (+OCR). Send native PDF too only in whole-file mode when it fits the token budget and Claude ≤22 MB / Gemini ≤50 MB. Else text only + note. Page threshold tuned in eval. |
| **D9-4** | Libraries | — | pypdfium2 (text + render) + pdfplumber (tables), python-docx, openpyxl (+defusedxml), python-pptx, Pillow + pillow-heif, python-magic. **No LibreOffice in extraction MVP** (legacy formats rejected). MarkItDown/Docling = Later evaluation only. |
| **D9-5** | Normalised format | (a) Markdown + JSON sidecar (b) JSON only | **(a)** |
| **D9-6** | Page images stored? | (a) scanned pages only (b) all (c) none | **(a)**, deleted with the file |
| **D9-7** | Images | original / normalised | Normalised copy for models (G14) + original kept |
| **D9-8** | Spreadsheets | — | Whole-file if ≤30k tokens; else per-sheet summary + samples + code tool (TL-4) for maths |
| **D9-9** | Where it runs | — | Background worker (file-blocking queue), extractors in subprocess with limits; Cloud Run job for very big (AS-D1). Trigger = our upload-complete call, no Eventarc in MVP |
| **D9-10** | Re-process | — | Retry on demand MVP; bulk re-process via ops job Later |
| **D9-11** | Upload limits (FD-2 numbers) | — | Docs ≤100 MB and ≤1,000 pages; images ≤20 MB; audio ≤500 MB and ≤3 h; ZIP ≤100 MB, ≤20 files, ≤500 MB uncompressed; ≤10 files/message, ≤20 files/chat |
| **D9-12** | Macro + legacy files | reject / accept | Reject .docm/.xlsm/.pptm and .doc/.xls/.ppt with "save as DOCX/XLSX/PPTX" |
| **D9-13** | Claude native citations | MVP / Later | Later (keep `[file:n]`) |

## 8. LV-1 additions (Stage 21 live tests)
1. Doc AI OCR: which GA version exists in asia-south1; Hindi/Tamil printed + handwritten quality.
2. Gemini 3.8 Flash: Tanglish/Tamil/Hindi transcription accuracy; 2-min mic latency; long-audio split size.
3. gemini-3.5-transcribe Tamil (when GA).
4. Gemini 3,000-page PDF and 560 tok/page real usage.
5. Claude PDF tokens per page (text + image) on Vertex.
6. ClamAV scan time for 100 MB / 500 MB files.
7. HEIC conversion on Android uploads.

## 9. Doc-sync debt
- L5i B6 + handoff: Gemini PDF 3,000 pp, images 3,000, HEIC.
- L5f speech: SPD-5 → result of D9-2.
- Stage 7 capability matrix: Claude 600 pp (1M ctx), image 28×28 formula, Gemini document MIME list.

## 10. Confidence
- Vendor facts: High (official, 2 Oct 2026); Chirp/transcribe docs have internal conflicts → Medium.
- App behaviour (Part A): Medium – many details not published.
- Our recommendations: Medium-High; OCR/speech quality for Tamil needs LV-1.

## 11. Sources
support.claude.com (8241126, 12111783, 10440198) · help.openai.com (8555545, 10029836, 10416312, 8983778) · support.google.com/gemini (14903178, 13594961) · perplexity.ai/help-center (10354807, 12009761, 10354810) · docs.cloud.google.com: gemini-enterprise-agent-platform/models/gemini/3-8-flash, …/3-5-transcribe, get-started-with-gemini-3, document-understanding, document-ai/docs/processors-list, document-ai/docs/regions, document-ai/limits, speech-to-text/docs/models/chirp-3, run/quotas, run/docs/container-contract, storage/docs/pubsub-notifications, storage/docs/lifecycle, storage/docs/soft-delete, eventarc/docs/retry-events, rag-engine layout-parser-integration · cloud.google.com/products/document-ai/pricing, speech-to-text/pricing · platform.claude.com: pdf-support, citations, vision, claude-on-vertex-ai, prompting best practices · developers.openai.com retrieval · pypi (pypdf, pdfminer.six, pypdfium2, python-docx, openpyxl, python-pptx, markitdown, docling, unstructured, defusedxml) · github (pdfplumber, python-magic, Cisco-Talos/clamav) · docs.python.org zipfile · OWASP File Upload cheat sheet, CSV Injection · help.libreoffice.org.
