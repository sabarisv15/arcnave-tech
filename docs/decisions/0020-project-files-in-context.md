# ADR-0020: Project files go into the prompt whole while they fit, as Claude keeps project knowledge in context

- Status: accepted. Excerpt branch amended by [ADR-0029](0029-project-knowledge-searched-past-the-limit.md): past the limit the model searches with a tool.
- Date: 2026-09-25
- See also: [ADR-0019](0019-long-chats-follow-claude.md) (compaction),
  CLAUDE.md invariant 4 (retrieval is lexical)

## Context

Claude (Help Center, "Retrieval augmented generation (RAG) for projects"): "When your project
knowledge approaches the context window limit, Claude will automatically enable RAG mode." Below
that point the project's files are in context. Claude publishes no exact threshold.

ArcNave always retrieved: the 8 best BM25 chunks, at most 12,000 characters
(`PROJECT_CONTEXT_MAX_CHUNKS`, `PROJECT_CONTEXT_MAX_CHARS`), whatever the project's size. A
two-page project file never reached the model whole.

## Decision

1. When every ready project file's text totals at most `PROJECT_FULL_CONTEXT_MAX_CHARS`
   (200,000 characters), every file goes into the prompt whole. The prompt labels them as whole
   documents, and the user sees "Using all N project files in full".
2. Past that, or when a file was cut at indexing (`MAX_CHUNKS_PER_FILE`), the turn uses
   excerpts by relevance, as before. `search_project_files` and `read_project_file` stay
   available in both modes.
3. A file's whole text is rebuilt from its stored chunks, with the overlap between neighbouring
   chunks removed (`joinChunks`), page by page. There is no schema change. A test checks the
   round trip against `chunkText`.
4. The limit is counted in characters, not tokens: there is no token estimator (invariant 3).
   200,000 is ArcNave's own number. For English text it is about a third of the compaction
   trigger, which leaves a chat room before it compacts; a file in the prompt is not
   compactable.

## Consequences

- Small projects cost more input tokens per turn, as on Claude.
- Tamil or other scripts use more tokens per character, so the same character limit takes a
  larger share of the window for them.
