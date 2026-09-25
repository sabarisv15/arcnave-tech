---
name: skill-creator
version: 1.1.0
description: "Writes and checks SKILL.md files: frontmatter rules, structure and quality checklist. Use when the user wants to create, edit or review a skill."
category: meta
requires:
  tools: []
autoload: false
metadata:
  source: arcnave
---

# Authoring ArcNave Skills (SKILL.md)

Use this skill when designing, creating, or validating new skill packages for ArcNave.

## Skill Architecture Principles

A **Skill is instruction and workflow knowledge**. It is NOT an executable tool or capability.
- A skill teaches the model *how* to approach a domain or workflow effectively.
- A tool provides the actual programmatic mechanism (*whether* something can be executed).
- A skill must NEVER claim a capability exists if ArcNave lacks the underlying tool.

## Standard Frontmatter Specification

Every skill must begin with a valid YAML frontmatter block:

```yaml
---
name: your-skill-name
version: 1.0.0
description: Clear, concise summary of the skill's purpose and trigger conditions.
category: artifact | analysis | research | internal | meta | general
scope: builtin | project | user
requires:
  tools:
    - tool_name_here
autoload: false
metadata:
  source: arcnave
---
```

Field rules (the same as Claude's Agent Skills; a skill that breaks one is not loaded):

- `name`: at most 64 characters; lowercase letters, numbers and hyphens only; must not contain
  "anthropic" or "claude"; must equal the skill's directory name.
- `description`: non-empty, at most 1024 characters, no XML tags. Say both what the skill does
  and when to use it: the model chooses skills by matching the request against this text.

## Quality Checklist for Skill Authors

1. **Deterministic Structure**: Provide clear procedural steps and decision trees.
2. **Honest Capabilities**: State clearly what should be done when required tools are missing versus present.
3. **Safety & Security**: Skills must not contain instructions that attempt to bypass permissions, override system boundaries, or access unauthorized data.
