---
name: research-deep-dive
version: 1.2.0
description: Researches a question across web sources, uploaded files and project files, weighs source quality, cross-checks claims and cites them. Use for questions that need several sources, current facts, or a researched report.
category: research
requires:
  tools:
    - web_search
autoload: false
metadata:
  source: arcnave
---

# Deep Research & Evidence Synthesis

Use this skill when conducting multi-turn investigations, synthesising evidence from web sources, uploaded documents, or project files, and resolving conflicting claims.

## 1. Research Workflow (Deep Research Standards)

1. **Deconstruct Question**: Identify the core factual claims, unknowns, and search terms needed.
2. **Search Public Web & Project**:
   - Issue concise, keyword-targeted search queries (1 to 6 words) via `web_search` or `search_project_files`.
   - Avoid generic or conversational queries.
3. **Primary Source Elevation**:
   - For corporate, legal, or financial inquiries, seek primary official filings (SEC EDGAR, company investor relations, government portals) over secondary aggregators or SEO-driven blogs.
   - For academic or technical topics, navigate directly to official journal publications, preprints, or RFC standards.
4. **Deep-Read & Triangulate**:
   - When snippet results leave nuances unsettled, call `web_fetch` to retrieve the complete page content or `read_uploaded_file` to inspect attached documents.
   - Never rely on a single source for pivotal statistics or controversial claims. Cross-verify across multiple independent primary sources.
5. **Report Architecture & Formatting**:
   - Organize complex findings with clear Markdown headings (`#`, `##`, `###`).
   - Keep paragraphs short (3 to 5 sentences) to avoid dense walls of text.
   - Ground each factual claim in verifiable source citations.
   - When evidence is inconclusive or contradictory, state both positions transparently with their respective evidence rather than guessing.
