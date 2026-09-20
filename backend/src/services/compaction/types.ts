import { z } from 'zod';
import type { InferSelectModel } from 'drizzle-orm';
import { conversationCompactions } from '../../db/schema.js';

export type ConversationCompactionRow = InferSelectModel<typeof conversationCompactions>;

export const compactionArtifactSchema = z.object({
  artifactId: z.string(),
  title: z.string(),
  kind: z.string(),
  version: z.number(),
});

export const compactionGoalStateSchema = z.object({
  goalId: z.string().optional(),
  description: z.string(),
  status: z.string(),
  note: z.string().optional(),
});

/**
 * Validated 11-field structured compaction schema.
 * Ensures model summaries capture complete architectural, goal, and artifact context.
 */
export const compactionSummarySchema = z.object({
  priorSummaryFolded: z.boolean(),
  conversationTopic: z.string(),
  userExplicitPreferences: z.array(z.string()),
  establishedConstraints: z.array(z.string()),
  artifactsCreatedOrModified: z.array(compactionArtifactSchema),
  activeGoalsAndState: z.array(compactionGoalStateSchema),
  keyFactualDiscoveries: z.array(z.string()),
  pendingUserRequests: z.array(z.string()),
  openTasksAndNextSteps: z.array(z.string()),
  userDirectivesContinuity: z.array(z.string()),
  criticalContextNotes: z.string(),
});

export type CompactionSummary = z.infer<typeof compactionSummarySchema>;

export interface CompactionTriggerCheck {
  shouldCompact: boolean;
  totalContextTokens: number;
  currentInputTokens: number;
  headroomTokens: number;
  headroomRatio: number;
  reason?: string;
}
