import { desc, eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { getDb } from '../../db/client.js';
import { conversationCompactions, type ConversationCompaction } from '../../db/schema.js';
import type { Provider, Turn } from '../../providers/types.js';
import {
  compactionSummarySchema,
  type CompactionSummary,
  type CompactionTriggerCheck,
} from './types.js';

export class CompactionService {
  /**
   * Calculates remaining headroom and evaluates whether context pressure triggers compaction.
   * Headroom = contextWindow - currentInputTokens - outputReserve - safetyReserve.
   */
  checkTrigger(
    contextWindow: number,
    currentInputTokens: number,
    outputReserve = 4096,
    safetyReserve = 2048,
    forceEnabled?: boolean,
  ): CompactionTriggerCheck {
    const cfg = config();
    const headroomTokens = contextWindow - currentInputTokens - outputReserve - safetyReserve;
    const headroomRatio = contextWindow > 0 ? headroomTokens / contextWindow : 1;

    const minHeadroomTokens = cfg.COMPACTION_TRIGGER_HEADROOM_TOKENS ?? 8192;
    const minHeadroomRatio = cfg.COMPACTION_TRIGGER_HEADROOM_RATIO ?? 0.15;

    const isEnabled = forceEnabled !== undefined ? forceEnabled : cfg.ENABLE_CONTEXT_COMPACTION;
    const shouldCompact =
      isEnabled &&
      (headroomTokens <= minHeadroomTokens || headroomRatio <= minHeadroomRatio);

    return {
      shouldCompact,
      totalContextTokens: contextWindow,
      currentInputTokens,
      headroomTokens,
      headroomRatio,
      reason: shouldCompact
        ? `Headroom (${headroomTokens} tokens / ${(headroomRatio * 100).toFixed(1)}%) reached trigger threshold`
        : undefined,
    };
  }

  /**
   * Retrieves the most recent compaction summary for a chat.
   */
  async getLatestCompaction(chatId: string): Promise<ConversationCompaction | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(conversationCompactions)
      .where(eq(conversationCompactions.chatId, chatId))
      .orderBy(desc(conversationCompactions.throughSeq))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Formats a compaction summary for injection into the dynamic prompt context.
   */
  formatCompactionForPrompt(compaction: ConversationCompaction): string {
    const s = compaction.summary as unknown as CompactionSummary;
    if (!s) return '';

    const lines: string[] = [
      `<conversation_compaction through_message_id="${compaction.throughMessageId}" through_seq="${compaction.throughSeq}">`,
      `Topic: ${s.conversationTopic}`,
    ];

    if (s.userExplicitPreferences?.length) {
      lines.push(`User Explicit Preferences:`);
      for (const p of s.userExplicitPreferences) lines.push(`  - ${p}`);
    }

    if (s.establishedConstraints?.length) {
      lines.push(`Established Constraints:`);
      for (const c of s.establishedConstraints) lines.push(`  - ${c}`);
    }

    if (s.artifactsCreatedOrModified?.length) {
      lines.push(`Artifacts Created or Modified:`);
      for (const a of s.artifactsCreatedOrModified) {
        lines.push(`  - [${a.kind}] "${a.title}" (id: ${a.artifactId}, v${a.version})`);
      }
    }

    if (s.activeGoalsAndState?.length) {
      lines.push(`Goals and State:`);
      for (const g of s.activeGoalsAndState) {
        lines.push(`  - [${g.status}] ${g.description}${g.note ? ` (Note: ${g.note})` : ''}`);
      }
    }

    if (s.keyFactualDiscoveries?.length) {
      lines.push(`Key Factual Discoveries:`);
      for (const d of s.keyFactualDiscoveries) lines.push(`  - ${d}`);
    }

    if (s.pendingUserRequests?.length) {
      lines.push(`Pending User Requests:`);
      for (const r of s.pendingUserRequests) lines.push(`  - ${r}`);
    }

    if (s.openTasksAndNextSteps?.length) {
      lines.push(`Open Tasks and Next Steps:`);
      for (const t of s.openTasksAndNextSteps) lines.push(`  - ${t}`);
    }

    if (s.userDirectivesContinuity?.length) {
      lines.push(`User Directives Continuity:`);
      for (const u of s.userDirectivesContinuity) lines.push(`  - ${u}`);
    }

    if (s.criticalContextNotes) {
      lines.push(`Critical Context Notes: ${s.criticalContextNotes}`);
    }

    lines.push(`</conversation_compaction>`);
    return lines.join('\n');
  }

  /**
   * Generates and stores a structured compaction record by folding previous compaction
   * (if present) with intervening turns.
   * Invariant: Underlying message rows in Postgres are NEVER deleted.
   */
  async createCompaction(params: {
    chatId: string;
    throughMessageId: string;
    throughSeq: number;
    summary: CompactionSummary;
    tokenCountBefore?: number;
    tokenCountAfter?: number;
    provider?: string;
    model?: string;
  }): Promise<ConversationCompaction> {
    // Validate schema
    const validated = compactionSummarySchema.parse(params.summary);

    const db = getDb();
    const [inserted] = await db
      .insert(conversationCompactions)
      .values({
        chatId: params.chatId,
        throughMessageId: params.throughMessageId,
        throughSeq: params.throughSeq,
        summary: validated as unknown as Record<string, unknown>,
        tokenCountBefore: params.tokenCountBefore ?? null,
        tokenCountAfter: params.tokenCountAfter ?? null,
        provider: params.provider ?? null,
        model: params.model ?? null,
      })
      .returning();

    if (inserted) return inserted;
    throw new Error('Failed to insert conversation compaction');
  }
}

export const compactionService = new CompactionService();
