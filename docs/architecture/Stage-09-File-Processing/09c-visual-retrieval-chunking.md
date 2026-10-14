# ArcNave – Stage 9c · Visual retrieval, chunking, extraction tech – DRAFT
_2026-10-02 · Source: GPT Astra round 2 (09b prompt; official docs/papers, checked 2 Oct 2026) · Status: DRAFT – decisions need user OK · Adds to / revises 09-file-processing.md (D9-3, D9-4, D9-6, D9-14, E1, E3)_

Labels: ✅ Vendor documented · ⚠️ Partial · 📄 Paper/blog · 🔧 ArcNave design

## 1. What real products do
| | Claude | ChatGPT | Gemini (Enterprise) | Perplexity |
|---|---|---|---|---|
| Visual retrieval | PDF visuals ≤100 pp; above = text only ✅ | Enterprise: retrieves **text-image pairs**; images linked to text embeddings ✅ (pages/answer ❌) | **Image annotation**: image descriptions attached to chunks ✅ | ❌ |
| Too big → RAG | Projects auto-switch to RAG near context limit, up to 10× capacity, search tool ✅ (threshold ❌) | Enterprise: first **110k tokens** in context, rest indexed (text + images) ✅ | Ingest-time chunking ✅ | Short = whole; long = important parts ✅ |
| Chunk size | ❌ | ❌ (API ≠ ChatGPT) | Layout chunks **100–500 tokens, default 500**, ancestor headings option ✅ | ❌ |
| Office images | Text only ✅ | Images discarded ✅ | Layout parser detects DOCX/PPTX images ✅ | ❌ |
| Tables | Visual within 100 pp ⚠️ | PDF visuals ⚠️ | Table detection + table annotation ✅ | ❌ |
**Pattern:** big products describe images/tables in text (annotation) and retrieve text+image pairs; none publishes pages-per-answer.

## 2. Vendor tech facts
- **OpenAI Responses PDF input = extracted text + image of each page** ✅ (same as Claude, Gemini). file_search: 800/400 default, static 100–4,096, hybrid weights, score threshold ✅.
- **Gemini Embedding 2 (`gemini-embedding-2`) GA** ✅: text, image, PDF (≤6 pages, 1 page/PDF recommended), audio, video; 3,072 dims (128–3,072); **8,192 input tokens**; **global/us/eu only** (no Mumbai); text $0.20/M, image $0.45/M tokens (pricing page still says Preview ⚠️). Over-limit input truncated.
- `multimodalembedding@001` legacy: English text only, 32 tokens, 512×512 images → not suitable.
- pgvector: `vector` index ≤2,000 dims, `halfvec` ≤4,000 → use 1,536 dims ✅.
- RAG Engine: Mumbai **Preview**, **no data-residency controls** ✅ → not for us.
- Document AI Layout Parser: **not in Mumbai**; Gemini-based versions global ✅ → not for us.
- Document AI OCR output: blocks, lines, bounding boxes, confidence, image quality, Math OCR, checkboxes ✅. **Form Parser: simple tables only (no merged cells)** ✅.
- Gemini: native PDF keeps visuals; handwriting may hallucinate; split long docs ✅.
- Claude: PDF = text + charts + tables; images must be legible; 2,576 px / 4,784-token tier ✅.
- Anthropic contextual retrieval 📄: 50–100 tokens context per chunk, embeddings + BM25, rerank 150 → 20 best; 800 tokens only a cost example; −49% failures, −67% with rerank.

## 3. Open-source tech facts
| Tech | Does | Licence | GPU | Note |
|---|---|---|---|---|
| Docling (HybridChunker + TableFormer) | Structure + token-aware chunks, **table headers repeat**, ML table structure incl. merged cells | MIT code; models CDLA-Permissive-2.0/Apache | CPU OK | No accuracy guarantee ✅ |
| Unstructured by_title | Section chunks, tables isolated; default 500 chars | Apache-2.0 | No | hi_res needs models |
| LangChain splitters | Recursive / Markdown-header / token | MIT | No | No table protection |
| LlamaIndex parsers | Sentence / Markdown / semantic | MIT | No | No table guarantee |
| ColPali / ColQwen 📄 | Page-image multi-vector retrieval; beats OCR on ViDoRe benchmark | Gemma / Apache backbones, MIT adapters | GPU examples | `colpali-engine` deprecated; multi-vector = extra engineering |
| Jina late chunking 📄 | Contextual chunk vectors | Apache (English model) | Depends | Not needed with contextual slot |
| Perplexity contextual embeddings | Chunk vectors with doc context | MIT weights | Self-host GPU | API India residency ❌ |
| pdfplumber | Digital PDF tables (borderless via text strategy) | MIT | No | No OCR |
| Camelot | Ruled/borderless tables, optional ML/OCR | MIT | Optional | — |
| python-docx / python-pptx | Extract embedded image bytes | MIT | No | Doesn't render pages/slides |
| LibreOffice headless | DOCX/PPTX → PDF render | MPL/LGPL | No | Not pixel-identical to MS Office |
| pypdfium2 | PDF page → image (scale = DPI/72) | Apache/BSD | No | **Not thread-safe → use processes** |

## 4. Proposed design (🔧)
**Ingest (upload time):**
1. DOCX/PPTX → also LibreOffice → PDF (isolated, macros off) → same PDF path. Text still from python-docx/pptx (clean).
2. Digital PDF/Office → Docling: structure, tables (TableFormer), headings. Scanned pages → Document AI OCR.
3. Chunks: Docling HybridChunker on our structure, ~800 tokens, ~15% overlap, ancestor headings, table header repeat, page/slide ref.
4. "Visual pages" (scanned, has images/charts/tables) → render image (≤2,576 px long edge) → **Gemini Embedding 2 image vector**.
5. Text chunks → Gemini Embedding 2 text vector (1,536 dims) + Postgres FTS. All vectors stored in Mumbai pgvector.

**Answer time (details in Stage 12):**
6. Hybrid search over text chunks + page-image vectors → top pages.
7. Model gets page **images + text** of top pages: Fast 3 / Normal 8 / Deep 20; rendered on demand from stored PDF (process pool).

## 5. Decisions (recommendations – need OK)
| ID | Decision | Options | Rec |
|---|---|---|---|
| **V-1** | Visual retrieval method | (a) LLM describes images → text embedding (ChatGPT/Gemini Ent pattern) (b) Gemini Embedding 2 page-image vectors (c) ColPali self-host | **(b)** MVP: one managed call, no GPU, no caption hallucination. (a) for charts Later if eval shows misses. (c) no (GPU, deprecated runtime). |
| **V-2** | Which pages get image vectors | all / visual pages only | **Visual pages only** (scanned, images, charts, tables) |
| **V-3** | Page images to model per turn | — | Fast 3 / Normal 8 / Deep 20; long edge ≤2,576 px; render on demand |
| **V-4** | Office visuals | text only / render via LibreOffice | **Render DOCX/PPTX → PDF via LibreOffice in MVP** (revises D9-4 "no LibreOffice"); isolated, macros off, Noto Indic fonts (already in Stage 8 image) |
| **V-5** | Extraction + chunking stack | (a) Docling (b) pypdfium2/pdfplumber + LangChain splitters (c) Unstructured | **(a) Docling**, fallback (b) if LV-1 speed test fails on Cloud Run CPU |
| **V-6** | Chunk size | — | 800 tokens, ~15% overlap, headings + table header repeat; tune in Stage 12 (evidence range 500–1,024) |
| **V-7** | Tables | Docling / Form Parser / pdfplumber | Docling TableFormer for digital; scanned tables = OCR text + page image. **No Form Parser** (simple tables only, $30/1k) |
| **V-8** | Embedding model (provisional, Stage 12 confirms) | gemini-embedding-001 / Gemini Embedding 2 | **Gemini Embedding 2**, 1,536 dims, text + images in one space; global (C3 OK), vectors in Mumbai |
| **V-9** | Not used | — | RAG Engine (no residency), Layout Parser (not Mumbai), ColPali, Perplexity embeddings API (residency ❌), Form Parser |
| **V-10** | Contextual retrieval | — | Keep L-4 slot (Anthropic method); late chunking not needed |

**Updates to embedding limits (09 doc E1/E3):** E1 hard max per text 8,000 tokens with Embedding 2 (chunks stay ~800); keep no-silent-truncation guard. E3 = 1,536 dims `vector`.

## 6. LV-1 additions
1. Docling speed + memory on Cloud Run CPU (100-page PDF, 50-slide PPTX).
2. Gemini Embedding 2 tokens per page image + latency; text-query → page-image retrieval quality on Indian docs (Tamil/Hindi/English).
3. LibreOffice render fidelity for Indic fonts + charts.
4. pypdfium2 render time at 2,576 px in process pool.
5. Gemini Embedding 2 GA vs Preview pricing label.

## 7. Confidence
- Product patterns: Medium (thresholds and pages/answer not published).
- Vendor tech limits: High.
- Visual-retrieval accuracy gain on our documents: unknown until LV-1 eval.

## 8. Sources
help.openai.com 10416312, 10029836, 8555545 · support.claude.com 8241126, 11473015 · docs.cloud.google.com/gemini/enterprise/docs/parse-chunk-documents · support.google.com/gemininotebook 16215270 · perplexity.ai/help-center 10354807, 12009761 · docs.cloud.google.com gemini-enterprise-agent-platform: models/gemini/embedding-2, embeddings/get-multimodal-embeddings, resources/data-residency, rag-engine (overview, layout-parser-integration, llm-parser), models/capabilities/document-understanding, models/gemini/3-8-flash · document-ai: layout-parse-chunk, regions, ProcessOptions, Document, enterprise-document-ocr, form-parser · cloud.google.com pricing · github.com/pgvector/pgvector · platform.claude.com pdf-support, vision, cookbook contextual embeddings · anthropic.com/engineering/contextual-retrieval · github.com/anthropics/claude-cookbooks · developers.openai.com retrieval, tools-file-search, file-inputs · docs.langchain.com splitters · developers.llamaindex.ai node parsers · docs.unstructured.io chunking, partitioning · docling-project.github.io · arxiv 2407.01449 (ColPali), 2409.04701 (late chunking) · github illuin-tech/colpali, jina-ai/late-chunking, jsvine/pdfplumber, camelot-dev/camelot, docling-ibm-models · huggingface vidore, jinaai, perplexity-ai, docling-project · docs.perplexity.ai contextualized-embeddings · python-docx / python-pptx / pypdfium2 docs · help.libreoffice.org.
