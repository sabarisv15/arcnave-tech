# Helper prompts (ADR-0080)

The Stage 6 helper prompts (`docs/architecture/Stage-06-Context-Prompt-Assembly/06-policy-spec-v3.md`,
"Helper prompts (shared by both models)"), copied verbatim: `title-v1.md` is HP-TITLE,
`summary-v1.md` is HP-SUM. The version is in the file name; a change is a new file (`-v2`), never
an edit. Loaded by `src/services/helpers/helperPrompts.ts`, which also loads
`../system/recovery/continue-v1.md` (REC, Stage 6 doc-sync 2026-10-12).
