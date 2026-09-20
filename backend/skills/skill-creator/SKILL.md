---
name: skill-creator
version: 1.0.0
description: Guide and schema for authoring new ArcNave SKILL.md procedural workflow instructions and metadata.
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

## Quality Checklist for Skill Authors

1. **Deterministic Structure**: Provide clear procedural steps and decision trees.
2. **Honest Capabilities**: State clearly what should be done when required tools are missing versus present.
3. **Safety & Security**: Skills must not contain instructions that attempt to bypass permissions, override system boundaries, or access unauthorized data.
