# System prompt v3 (runtime files)

- `gemini.md`, `claude.md`: the code block of the Stage 6 renderings
  (`docs/architecture/Stage-06-Context-Prompt-Assembly/06-system-prompt-v3-{gemini,claude}.md`),
  byte for byte, with only the tool-name map applied (`backend/src/services/prompt/toolNameMap.ts`).
  Change the docs mirror first, then regenerate; `v3Prompt.test.ts` fails on any byte of drift.
- `appendix-product-tools.md`: **transitional and ArcNave's own (not stage text).** Usage
  paragraphs, carried from the earlier prompt builder, for tools that have no Stage 8 equivalent yet.
  Each `<!-- section: id -->` is sent only when its tools are declared; the markers are not sent.
  Deleted when the tools are renamed (Prompt 6). ADR-0075.
- The prompt version stamped on a turn is the first 12 hex of the SHA-256 of a base file and the
  appendix file.
