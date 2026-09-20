/**
 * ArcNave Static Compaction Policy (v1).
 *
 * 100% static, deterministic policy defining conversation compaction rules for the model.
 * Included in the stable cacheable prefix alongside Base System Prompt v1.
 */

export const STATIC_COMPACTION_POLICY_V1 = `<compaction_policy>
When a conversation grows large, earlier history is compacted into a structured summary.
- Compaction does not end the task.
- Treat work spanning compactions as one continuous logical chain of events.
- Continue naturally from the compacted state and make reasonable assumptions about details folded into the summary.
- Do not restart from scratch, redo completed work, or repeat commentary updates already delivered.
- Honor all accepted user corrections, decisions, and constraints preserved in the compaction summary.
</compaction_policy>`;
