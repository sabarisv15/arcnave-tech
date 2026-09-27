# ADR-0046: Table tools declared when the conversation holds a file

Status: accepted (2026-09-27). Amends ADR-0022 decision 4.

## Context

A scanned KVB + Federal statement ran out of its 16 tool rounds ("Answer cut off: it used every
tool step this turn allows"). `extract_scanned_table_rows` and `analyze_table_rows` were
deferred behind `search_tools`, so the model spent rounds on OCR in `run_python` and found the
table tools only near the end. Claude (Sonnet 5) did the same file in about 8 tool steps.

- **Claude:** tool search guidance keeps the most-used tools non-deferred.
- **ArcNave before:** the table tools were always deferred (`tools/catalog.ts`).
- **Gap:** on a file turn these are the most-used tools, so they must not cost a search.

## Decision

1. When the conversation holds a file, `DECLARED_WITH_ATTACHMENTS` (`extract_scanned_table_rows`,
   `analyze_table_rows`) is declared beside `DECLARED_EVERY_TURN`, if permission allows them.
   That can take the declared set past Claude's 3–5; this difference is ours, accepted because
   each search costs a round the turn may not have.
2. Gemini's final round: when Vertex rejects function calling `NONE`, the round is retried with
   no function declarations before a plain request, so it can only answer (handoff 2026-09-27,
   item 4).
