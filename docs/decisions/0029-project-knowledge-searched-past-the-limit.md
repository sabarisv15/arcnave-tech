# ADR-0029: Past the whole-file limit, project knowledge is searched with a tool

- Status: accepted. Tested locally; not live.
- Date: 2026-09-26
- Amends: [ADR-0020](0020-project-files-in-context.md), its excerpts-by-relevance branch.

## Context

Past `PROJECT_FULL_CONTEXT_MAX_CHARS`, ArcNave picked chunks by the prompt's words and put them
in the system prompt, so the prompt changed every turn and the model could not look further
(audit B9, B10).

Help Center, RAG for projects: "When RAG is enabled for your project, Claude uses a project
knowledge search tool to retrieve relevant information from your uploaded documents."

## Decision

1. Past the limit, the prompt lists the project's files and says to search them with
   `search_project_files` and read with `read_project_file`. Both are declared on every turn in
   a project. The text is the same whatever the question.
2. A turn without tools has no search tool, so it still gets excerpts by relevance.
3. The limit itself stays ArcNave's number, sized for the smallest configured window.

## Verify

`routes/projectKnowledge.integration.test.ts`.
