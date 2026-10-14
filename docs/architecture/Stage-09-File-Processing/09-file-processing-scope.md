# ArcNave – Stage 9: File-processing pipeline — SCOPE DRAFT (2026-10-02)
Status: DRAFT. Nothing locked. Research not yet done (Astra prompt: 09-astra-prompt.md).

## 1. Scope (Tanglish)
User file upload pannina appuram, Send button-ku munnadi file-a "model padikka ready"-a maathura work dhaan Stage 9.
Flow: upload → type check → malware scan → text/structure eduthal (PDF, DOCX, XLSX, PPTX, image, audio, ZIP) → scanned-na OCR / audio-na speech-to-text → ellathaiyum oru same normalised format-a store → token count paathu "full file model-ku" (≤30k) illa "retrieval" nu mudivu → ready / failed status.

Stage 9 la illa (already decided / vera stage): upload session & ZIP rules (F5), chunking+embedding picks (Stage 12), tool contracts read_file/file_search (Stage 8), safety (Stage 16).

Sub-stages:
- 9.1 Intake & validation (type sniffing, size, malware scan, ZIP, encrypted files)
- 9.2 Per-type extraction (PDF text vs scanned, DOCX, XLSX, PPTX, images, audio)
- 9.3 OCR engine = M11
- 9.4 Speech engine = M10 (SPD-5)
- 9.5 Normalised output format (text + structure + page map + tables + warnings)
- 9.6 Big files: split, parallel, progress, retry, failure
- 9.7 Derived-data storage, lifecycle, deletion
- 9.8 Claude-only list

## 2. Already decided (not re-decided)
Types: PDF/DOCX/XLSX/PPTX/image/audio/ZIP (S1) · UD-1..4 upload · D1 block Send till ready · AS-D6 failed = reason+Retry+Remove · DB-6 ClamAV MVP · AS-D1 file-blocking queue · AS-D2 long audio/PDF split parallel · ≤30k tokens whole file else retrieval · scanned PDFs OCR at upload · SPD-2/3/4 mic rules · chat files die with chat (≤30 d incl. embeddings) · tenant_id+RLS · sandbox /input RO ≤30 MB, no PyMuPDF/pytesseract.

## 3. Evidence table (from SAVED official-doc facts only; blanks = research needed)
| Topic | Claude | ChatGPT | Gemini | Perplexity |
|---|---|---|---|---|
| App limits | claude.ai 20 files/chat, 500 MB/file, PDF ≤1000 pp (visual ≤100) ✅ | — research | — (app limits not saved) | 40 MB/file, weekly upload allowance ✅ |
| API/model PDF | Vertex: ≤600 pp, text + page image, ~1.5–3K tokens/pp + image, no encrypted PDF ✅ | — | Vertex 3.8 Flash: 50 MB; **1,000 pp (L5i) vs 3,000 pp (Astra) CONFLICT → verify** ⚠️ | Agent API file inputs (details —) |
| Scanned PDF/OCR | via page images (no separate OCR) ⚠️ verify | — | vision on PDF; Doc AI OCR v2.1.1 preview + Form Parser in asia-south1; Layout Parser NOT in asia-south1 ✅ | — |
| DOCX/XLSX/PPTX | not native → own extraction ⚠️ verify | — (Code Interpreter?) research | not native; text formats only ✅ | — |
| Images | Vertex ≤5 MB, ≤8000 px (>20 imgs ≤2000 px), ≤600, JPEG/PNG/GIF/WebP ✅ | — | ≤3,600/request, media_resolution ✅(L5i) | — |
| Audio | none (no audio input) ✅ | dictation → transcript in composer ✅ | 32 tok/s, ≤9.5 h, inline ≤20 MB, 1 file/prompt, timestamps+speakers ✅; Chirp 3 US/EU only, en-IN/hi-IN GA, ta-IN preview ✅ | — |
| ZIP | — | — | not native ✅ | — |
| Retention | chats deleted ≤30 d ✅ | audio kept while chat exists ✅ | Enterprise 1–180 d ✅ | Enterprise session files 7 d ✅ |
| Request size | Vertex 30 MB, no Files API ✅ | — | no Files API on Vertex: inline or GCS URI ✅ | — |

## 4. Candidate gaps (pre-research; labels: ✅ Vendor · ⚠️ Partial · 🔧 ArcNave) — proposal MVP/Later
| # | Gap | Label | Proposal |
|---|---|---|---|
| G1 | Type detect by content, not extension; allowlist | 🔧 (OWASP saved) | MVP |
| G2 | Malware scan BEFORE parsing; ClamAV size limit check | 🔧 | MVP |
| G3 | Encrypted/password PDF/Office → clear error | ⚠️ Claude no encrypted PDF | MVP |
| G4 | Macro files (docm/xlsm), embedded objects policy | 🔧 | MVP reject/ignore macros; rest Later |
| G5 | Zip/XML-bomb + decompressed-size limits | 🔧 (OWASP, zipfile warn) | MVP |
| G6 | Per-page text vs scanned detection (mixed PDFs); "(cid:" / empty → OCR | 🔧 | MVP |
| G7 | OCR quality for Hindi/Tamil/English + residency (Doc AI OCR preview in Mumbai; Gemini global) | ⚠️ | MVP (engine = D9-1) |
| G8 | Tables kept as Markdown/CSV with page/sheet ref | 🔧 | MVP |
| G9 | DOCX/PPTX embedded images & charts → vision caption or skip | 🔧 (only PDF gets vision) | Later (MVP: list images, no caption) |
| G10 | XLSX: big sheets, multi-sheet, hidden, formulas (cached values), lakh format; link to code tool TL-4 | 🔧 | MVP |
| G11 | Audio: split long files, speakers/timestamps, Tanglish/Hinglish | ⚠️ | MVP |
| G12 | Images: EXIF rotate, resize to vendor limits, HEIC convert | ⚠️ | MVP |
| G13 | One normalised schema (text, structure, page map, tables, images list, metadata, warnings) | 🔧 | MVP |
| G14 | Token count at ingest (free countTokens) → whole vs retrieval | ✅ | MVP |
| G15 | File status states (queued/scanning/extracting/ready/failed) + progress | 🔧 | MVP |
| G16 | Idempotent retry + extractor version stamp (re-process later) | 🔧 | MVP |
| G17 | Derived data (text, page images, OCR) stored + deleted ≤30 d; GCS soft-delete 7 d accounted | 🔧 | MVP |
| G18 | Files = untrusted data (prompt injection inside files) | ✅ Anthropic guidance | MVP |
| G19 | Language detection per file (FTS stemmer, embeddings) | 🔧 | Later |
| G20 | Per-file warnings to user ("pages OCR'd, low confidence") | 🔧 | MVP |

## 5. Claude-only list (every stage)
| # | Fact | Label |
|---|---|---|
| C1 | Files API not on Vertex → send base64 inline each request | ✅ |
| C2 | Request payload ≤30 MB | ✅ |
| C3 | PDF ≤600 pp; each page = text + image tokens; no encrypted PDF | ✅ |
| C4 | Images ≤5 MB, ≤8000 px, ≤600 total, JPEG/PNG/GIF/WebP | ✅ |
| C5 | No audio/video input → speech always separate engine, transcript text to Claude | ✅ |
| C6 | DOCX/XLSX/PPTX not native → our extraction (exact accepted document types: verify) | ⚠️ |
| C7 | Citations + structured outputs together → 400 (affects [file:n] citation design) | ✅ |
| C8 | Can custom extracted text carry doc-level/page-range citations? | ⚠️ verify |
| C9 | File content in stable prefix → prompt caching (min 512 tok on 5.5, 5 m/1 h) | ✅ |
| C10 | 4.7+ tokenizer ~30% more tokens; image token cost verify; use count_tokens | ⚠️ |
| C11 | claude.ai limits (20 files, 500 MB, PDF 1000 pp) are app, not Vertex API | ✅ |

## 6. Research needed (→ 09-astra-prompt.md)
R-A vendor file handling, 4 products (types, how processed, scanned PDF, sheets, ZIP, limits, retention, failure UX)
R-B Gemini on Vertex: PDF pages (resolve 1,000 vs 3,000), image/audio limits, formats incl. HEIC, tokens/page
R-C Claude on Vertex: document/image blocks, accepted types, citations on custom text, image tokens
R-D Document AI: processors, asia-south1, Indic + handwriting, page limits, price, residency
R-E Speech: Chirp 3 vs Gemini audio vs gemini-3.5-transcribe; Tamil/Hindi/code-switching; region; price; long-audio guidance
R-F Libraries + security: licences/guidance for pdf/docx/xlsx/pptx parsers, LibreOffice convert, defusedxml, macros, formula injection, ClamAV limits, type detection
R-G Chunk/normalised-format guidance (OpenAI file_search defaults, Vertex RAG layout parser, Anthropic/Google)
R-H Large-file compute on Cloud Run (memory/disk, jobs vs tasks, Eventarc, Doc AI batch limits)
R-I GCS lifecycle/soft-delete for derived artifacts

## 7. Decisions (ALL OPEN — need research + your OK)
| # | Decision | Options |
|---|---|---|
| D9-1 | OCR engine M11 | Document AI OCR / Gemini vision / hybrid |
| D9-2 | Speech engine M10 (SPD-5) | Gemini audio / Chirp 3 / hybrid |
| D9-3 | PDF path | native PDF to model / own text extraction / both |
| D9-4 | Office extraction libs + LibreOffice conversion yes/no | — |
| D9-5 | Normalised format | Markdown + JSON sidecar / JSON only |
| D9-6 | Store page images? | yes (scanned only) / no |
| D9-7 | Image to model | original / resized |
| D9-8 | Spreadsheet threshold (text vs code tool) | — |
| D9-9 | Where it runs | background worker + Cloud Run jobs for big |
| D9-10 | Re-process when extractor improves | yes / only on demand |

## 8. Confidence
- Saved vendor facts (✅): High (official, dated 2026-09/10).
- Evidence table overall: Low-to-Medium — ChatGPT and Perplexity columns mostly empty; Gemini PDF page limit conflicting.
- Gaps G1–G20: Medium (my analysis; final after research).

## 9. Sources
Saved research (memory topics/arcnave-research, Project docs): Claude docs cross-check 2026-10-01 (PDF/image limits), L5i second audit, Astra facts 2026-10-01 (Gemini PDF/Doc AI/Chirp), Stage 5 F5 (OWASP, GCS resumable), Stage 8 (licences, sandbox), claude.ai/Perplexity help docs 2026-09-30. No new web fetch this turn.
