# ADR-0018: Skills follow Claude's Agent Skills rules

- Status: accepted. Tested locally; the sandbox image carrying `/skills` is not live.
- Date: 2026-09-25
- See also: [docs/tools-skills-architecture.md](../tools-skills-architecture.md),
  [ADR-0010](0010-warm-sandbox-service.md) (the warm sandbox image)

## Context

Claude's Agent Skills (platform.claude.com, "Agent Skills") load in three levels:

1. **Metadata, always.** Every skill's `name` and `description` are in the system prompt
   (about 100 tokens each). "The `description` is what Claude matches your request against."
2. **Instructions, when triggered.** Claude reads `SKILL.md` with bash.
3. **Resources and code, as needed.** Reference files are read into context. Scripts are run
   with bash, and "only their output enters context".

Field rules: `name` at most 64 characters of lowercase letters, numbers and hyphens, no XML
tags, no "anthropic" or "claude"; `description` non-empty, at most 1024 characters, no XML tags.

What ArcNave did (audit of 2026-09-25):

- Level 1 was partly done. The turn listed each skill's name and description in
  `<available_skills>`, but the static prompt also carried a hard-coded list (docx, xlsx, pptx,
  pdf) and hard-coded triggers. One of them ("PDF creation and conversion → pdf") contradicted
  the pdf skill's own description, which also covers reading PDFs.
- `artifact-design` and `dashboard-design` had `category: presentation`, which the schema
  rejects. Both were dropped at startup with only a log warning, so the model never saw them.
- Names could be 100 characters with no character rule. Descriptions had no length limit.
- No sandbox had the skill files. Asking `load_skill` for a script returned its source code,
  which is the opposite of Claude's level 3.

## Decision

1. **Level 1 comes from the skill files only.** The hard-coded list and triggers are removed.
   The prompt tells the model to match the request against each description in
   `<available_skills>`.
2. **Claude's field rules are enforced.** The name must also equal its directory, because
   resources are read from the directory named after the skill. A rejected skill is recorded
   with its reason in `SkillService.rejected`. A test fails if any bundled skill is rejected.
3. **The warm sandbox image has the skills at `/skills`**, read-only (root-owned, not writable
   by the per-chat uids). The image is built from `backend/`
   (`sandbox/cloudbuild.service.yaml`).
4. **With that sandbox, a script is run, not read.** `load_skill` with a `.py` or `.sh`
   resource returns the script's path and how to run it from `run_python`, not its code. A
   reference file is still returned as text. Without the warm sandbox (Cloud Run Jobs, or
   `run_python` off) the old behaviour stays: the source is returned, because nothing could run
   it.

Not done: **custom skill upload**, which claude.ai has (zip files in Settings). Claude's docs
say to treat a skill from an untrusted source like installing software. It needs its own
security design before it is built.

## Consequences

- The sandbox image must be rebuilt and deployed **before** a backend that tells the model about
  `/skills`, or the model is pointed at a directory that does not exist.
- The two PDF scripts expect the tool runtime's input conventions, so they still run through
  `extract_scanned_table_rows` and `analyze_table_rows`, as the pdf skill says. A future script
  meant to be run directly must take command-line arguments.
