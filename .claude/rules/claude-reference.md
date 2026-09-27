# Claude is the reference for every change

ArcNave is built with Claude (claude.ai, the Claude apps, Claude's published docs, system
prompt and skills) as its reference. This file is development guidance only: it never ships.
Launch files still follow Invariant 7 and never describe ArcNave as Claude.

## Before any change

Every fix, bug, gap, feature, addition, removal, downgrade or upgrade starts from one
question: **how does Claude do this?**

1. Find Claude's actual behaviour from a source, not from memory: Anthropic's docs
   (platform.claude.com, support.claude.com), the published system prompts, the skills in
   `tools/Anthropic/` and github.com/anthropics/skills. Search the web when it is not already
   in the repo, and cite what you used.
2. Compare ArcNave's code with it, and say plainly where they differ.
3. Make ArcNave match. When ArcNave must differ (a different model, a provider limit, an
   invariant in `CLAUDE.md`, the brand rule), write down why in the ADR for the change.
4. Label anything that is our own idea, with no Claude equivalent, as ours. Add it only when
   an eval shows the Claude-aligned change alone is not enough.

## Answering "why does ArcNave do X?"

Answer in this shape, in the user's language:

- **Claude:** what Claude does here, with the source.
- **ArcNave now:** what ArcNave does, with the file and line.
- **Gap:** the difference, and that it has to be fixed to match Claude (or why ArcNave
  deliberately differs).
- **Fix:** the change that closes it.

## Precedence

The invariants in `CLAUDE.md` still win. Where matching Claude would break one (a silent
model fallback, an estimated token count, a committed secret), keep the invariant and record
the difference.
