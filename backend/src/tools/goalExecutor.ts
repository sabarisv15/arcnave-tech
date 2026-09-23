/**
 * Goal bookkeeping and failure tracking executor for Item 10.
 *
 * Implements:
 * - Invariant 1: Bad inputs, invalid transitions, or unmet preconditions return explicit ToolResults (never throw).
 * - Invariant 3: Context remaining queries report exact counts only when measured, else nulls (never estimate).
 * - B2 Rule: Transition to status 'blocked' is rejected unless the failure threshold (consecutiveFailureCount >= 3) is met.
 * - G2 Rule: Consecutive failure tracking and recovery detection per normalized deterministic fingerprint.
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/client.js';
import { goalEvents, goals } from '../db/schema.js';
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';

export interface ContextRemainingMeasurement {
  available?: boolean;
  maxInputTokens?: number | null;
  contextWindowTokens?: number | null;
  activeInputTokensExact?: number | null;
  inputTokensRemainingExact?: number | null;
  lastRequestPromptTokensExact?: number | null;
  exact?: boolean;

  // Backward compatibility fields
  contextLimit?: number | null;
  tokensUsed?: number | null;
  tokensRemaining?: number | null;
}

const updateGoalInput = z
  .object({
    status: z.enum(['complete', 'blocked']).optional(),
    note: z.string().optional(),
    blockedReason: z.string().optional(),
  })
  .refine((data) => data.status !== undefined || data.note !== undefined, {
    message: 'At least one of status or note must be provided',
  });

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown, ok = true): ToolResult {
  return { toolCallId, ok, content: [{ type: 'json', data }] };
}

/**
 * Deterministically normalizes a failure into a stable fingerprint:
 * `${toolName}|${category}|${stableCode}`
 * Strips volatile information (timestamps, UUIDs, stack traces, hex addresses, line numbers).
 */
export function normalizeFailureFingerprint(toolName: string, error: unknown): string {
  const errStr = error instanceof Error ? error.message : String(error ?? 'unknown');
  const lower = errStr.toLowerCase();

  let category = 'execution_error';
  if (lower.includes('timeout') || lower.includes('deadline') || lower.includes('timed out')) {
    category = 'timeout';
  } else if (
    lower.includes('not found') ||
    lower.includes('enoent') ||
    lower.includes('404') ||
    lower.includes('cannot find')
  ) {
    category = 'not_found';
  } else if (
    lower.includes('permission') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('403') ||
    lower.includes('401') ||
    lower.includes('eacces')
  ) {
    category = 'permission_denied';
  } else if (
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted') ||
    lower.includes('429') ||
    lower.includes('quota')
  ) {
    category = 'rate_limit';
  } else if (
    lower.includes('validation') ||
    lower.includes('invalid input') ||
    lower.includes('zod') ||
    lower.includes('invalid')
  ) {
    category = 'validation_error';
  }

  let stableCode = 'Error';
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as Record<string, unknown>).code === 'string') {
    stableCode = (error as Record<string, unknown>).code as string;
  } else if (error instanceof Error && error.name && error.name !== 'Error') {
    stableCode = error.name;
  } else {
    // Look for error codes like ENOENT, EACCES, 403, 404, 500, or SpecificError/Exception
    const codeMatch = errStr.match(/\b(E[A-Z0-9_]+|HTTP_\d{3}|[45]\d{2}|[A-Z][a-zA-Z0-9]*(?:Error|Exception))\b/);
    if (codeMatch?.[1]) {
      stableCode = codeMatch[1];
    } else {
      stableCode = 'Error';
    }
  }

  return `${toolName}|${category}|${stableCode}`;
}

export class GoalToolExecutor implements ToolExecutor {
  constructor(
    private readonly db: Database,
    private readonly activeGoalId: string | null = null,
    private readonly runId?: string,
    private readonly exactContextRemaining?: ContextRemainingMeasurement | null,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) {
      return textResult(call.id, false, 'The request was aborted before this tool ran.');
    }

    switch (call.name) {
      case 'get_goal':
        return this.getGoal(call);
      case 'update_goal':
        return this.updateGoal(call);
      case 'get_context_remaining':
        return this.getContextRemaining(call);
      default:
        return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }
  }

  private async getGoal(call: ToolCall): Promise<ToolResult> {
    if (!this.activeGoalId) {
      return textResult(call.id, false, 'No active goal is set for this session.');
    }

    const [goal] = await this.db
      .select()
      .from(goals)
      .where(eq(goals.id, this.activeGoalId))
      .limit(1);

    if (!goal) {
      return textResult(call.id, false, `Goal ${this.activeGoalId} not found.`);
    }

    const checkpoints = await this.db
      .select()
      .from(goalEvents)
      .where(eq(goalEvents.goalId, goal.id))
      .orderBy(desc(goalEvents.createdAt));

    const checkpointNotes = checkpoints
      .filter((e) => e.type === 'checkpoint')
      .map((e) => ({
        id: e.id,
        note: (e.data as { note?: string })?.note ?? '',
        at: e.createdAt ? e.createdAt.toISOString() : null,
      }));

    const remainingBudget =
      goal.tokenBudget != null ? Math.max(0, goal.tokenBudget - goal.spentTokens) : null;

    return jsonResult(call.id, {
      goalId: goal.id,
      chatId: goal.chatId,
      description: goal.description,
      status: goal.status,
      tokenBudget: goal.tokenBudget,
      spentTokens: goal.spentTokens,
      remainingBudget,
      consecutiveFailureCount: goal.consecutiveFailureCount,
      lastFailureFingerprint: goal.lastFailureFingerprint,
      lastFailedTool: goal.lastFailedTool,
      checkpoints: checkpointNotes,
    });
  }

  private async updateGoal(call: ToolCall): Promise<ToolResult> {
    if (!this.activeGoalId) {
      return textResult(call.id, false, 'No active goal is set for this session.');
    }

    const parsed = updateGoalInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const [goal] = await this.db
      .select()
      .from(goals)
      .where(eq(goals.id, this.activeGoalId))
      .limit(1);

    if (!goal) {
      return textResult(call.id, false, `Goal ${this.activeGoalId} not found.`);
    }

    const { status, note, blockedReason } = parsed.data;

    if (status === 'blocked') {
      // B2 Rule: Blocked status is permitted ONLY when consecutive failure count is >= 3
      if (goal.consecutiveFailureCount < 3) {
        return textResult(
          call.id,
          false,
          `Cannot mark goal as blocked: B2 rule requires 3 consecutive identical failures before blocking. Current consecutive failures: ${goal.consecutiveFailureCount}.`,
        );
      }

      await this.db
        .update(goals)
        .set({
          status: 'blocked',
          blockedReason: blockedReason ?? 'Blocked by failure threshold',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goal.id));

      await this.db.insert(goalEvents).values({
        goalId: goal.id,
        runId: this.runId,
        type: 'status_change',
        data: { status: 'blocked', blockedReason: blockedReason ?? 'Blocked by failure threshold' },
      });

      if (note) {
        await this.db.insert(goalEvents).values({
          goalId: goal.id,
          runId: this.runId,
          type: 'checkpoint',
          data: { note },
        });
      }

      return jsonResult(call.id, {
        success: true,
        status: 'blocked',
        message: 'Goal marked as blocked.',
      });
    }

    if (status === 'complete') {
      await this.db
        .update(goals)
        .set({
          status: 'complete',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goal.id));

      await this.db.insert(goalEvents).values({
        goalId: goal.id,
        runId: this.runId,
        type: 'status_change',
        data: { status: 'complete' },
      });

      if (note) {
        await this.db.insert(goalEvents).values({
          goalId: goal.id,
          runId: this.runId,
          type: 'checkpoint',
          data: { note },
        });
      }

      return jsonResult(call.id, {
        success: true,
        status: 'complete',
        message: 'Goal marked as complete.',
      });
    }

    // Only note checkpoint
    if (note) {
      await this.db.insert(goalEvents).values({
        goalId: goal.id,
        runId: this.runId,
        type: 'checkpoint',
        data: { note },
      });

      return jsonResult(call.id, {
        success: true,
        message: 'Checkpoint recorded.',
        note,
      });
    }

    return textResult(call.id, false, 'No updates specified.');
  }

  private async getContextRemaining(call: ToolCall): Promise<ToolResult> {
    const isAvailable = Boolean(
      this.exactContextRemaining &&
        (this.exactContextRemaining.available ??
          (typeof this.exactContextRemaining.tokensRemaining === 'number' &&
            this.exactContextRemaining.exact !== false)),
    );

    if (isAvailable && this.exactContextRemaining) {
      const maxInput =
        this.exactContextRemaining.maxInputTokens ?? this.exactContextRemaining.contextLimit ?? null;
      const contextWindow = this.exactContextRemaining.contextWindowTokens ?? null;
      const activeExact =
        this.exactContextRemaining.activeInputTokensExact ?? this.exactContextRemaining.tokensUsed ?? null;
      const remainingExact =
        this.exactContextRemaining.inputTokensRemainingExact ??
        this.exactContextRemaining.tokensRemaining ??
        null;

      return jsonResult(call.id, {
        available: true,
        maxInputTokens: maxInput,
        contextWindowTokens: contextWindow,
        activeInputTokensExact: activeExact,
        inputTokensRemainingExact: remainingExact,
        lastRequestPromptTokensExact: this.exactContextRemaining.lastRequestPromptTokensExact ?? null,
        exact: true,
        // Backward-compatibility aliases
        contextLimit: maxInput ?? contextWindow ?? null,
        tokensUsed: activeExact,
        tokensRemaining: remainingExact,
      });
    }

    return jsonResult(call.id, {
      available: false,
      maxInputTokens: this.exactContextRemaining?.maxInputTokens ?? null,
      contextWindowTokens: this.exactContextRemaining?.contextWindowTokens ?? null,
      activeInputTokensExact: null,
      inputTokensRemainingExact: null,
      lastRequestPromptTokensExact: this.exactContextRemaining?.lastRequestPromptTokensExact ?? null,
      exact: false,
      contextLimit: null,
      tokensUsed: null,
      tokensRemaining: null,
      note: 'Exact context measurement unavailable',
    });
  }

  /**
   * Records a tool failure for the active goal, updating consecutive failure counters and fingerprints.
   */
  static async recordToolFailure(
    db: Database,
    goalId: string,
    toolName: string,
    error: unknown,
    runId?: string,
  ): Promise<{ consecutiveFailureCount: number; fingerprint: string; isG2Blocked: boolean }> {
    const fp = normalizeFailureFingerprint(toolName, error);

    const [goal] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    if (!goal) {
      return { consecutiveFailureCount: 1, fingerprint: fp, isG2Blocked: false };
    }

    const sameFingerprint = goal.lastFailureFingerprint === fp;
    const newCount = sameFingerprint ? goal.consecutiveFailureCount + 1 : 1;

    await db
      .update(goals)
      .set({
        consecutiveFailureCount: newCount,
        lastFailureFingerprint: fp,
        lastFailedTool: toolName,
        lastFailureAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(goals.id, goalId));

    await db.insert(goalEvents).values({
      goalId,
      runId,
      type: 'tool_failure',
      toolName,
      failureFingerprint: fp,
      data: {
        error: error instanceof Error ? error.message : String(error),
        consecutiveFailureCount: newCount,
      },
    });

    return {
      consecutiveFailureCount: newCount,
      fingerprint: fp,
      isG2Blocked: newCount >= 2 && goal.lastFailedTool === toolName,
    };
  }

  /**
   * Records a tool success, resetting consecutive failure counts if previously failing.
   */
  static async recordToolSuccess(
    db: Database,
    goalId: string,
    toolName: string,
    runId?: string,
  ): Promise<void> {
    const [goal] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    if (!goal) return;

    if (goal.consecutiveFailureCount > 0) {
      await db
        .update(goals)
        .set({
          consecutiveFailureCount: 0,
          lastFailureFingerprint: null,
          lastFailedTool: null,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, goalId));

      await db.insert(goalEvents).values({
        goalId,
        runId,
        type: 'recovery_attempt',
        toolName,
        data: {
          recovered: true,
          previousFailures: goal.consecutiveFailureCount,
        },
      });
    }

    await db.insert(goalEvents).values({
      goalId,
      runId,
      type: 'tool_success',
      toolName,
      data: {},
    });
  }

  /**
   * Checks whether the tool is currently G2 blocked (2 consecutive identical failures without recovery).
   */
  static async isToolG2Blocked(
    db: Database,
    goalId: string,
    toolName: string,
  ): Promise<boolean> {
    const [goal] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
    if (!goal) return false;
    return goal.consecutiveFailureCount >= 2 && goal.lastFailedTool === toolName;
  }
}
