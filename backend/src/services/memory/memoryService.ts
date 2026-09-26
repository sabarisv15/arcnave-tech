import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { getDb } from '../../db/client.js';
import { memoryItems, type MemoryItem } from '../../db/schema.js';
import { checkPrivacy } from './privacy.js';
import type {
  CreateMemoryInput,
  MemorySearchResult,
  SearchMemoryFilter,
  UpdateMemoryInput,
} from './types.js';

/** Letters and digits of a query, lower-cased and de-duplicated: safe to join into a tsquery. */
export function searchWords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length > 1 || /\p{N}/u.test(w)))].slice(0, 32);
}

export class MemoryConcurrencyError extends Error {
  constructor(public readonly expectedVersion: number, public readonly actualVersion: number) {
    super(`Memory concurrency conflict: expected version ${expectedVersion}, but current version is ${actualVersion}`);
    this.name = 'MemoryConcurrencyError';
  }
}

export class MemoryService {
  /**
   * Creates or updates a memory item with privacy validation and upsert logic.
   */
  async createMemory(input: CreateMemoryInput, retried = false): Promise<MemoryItem> {
    const contentCheck = checkPrivacy(input.content);
    if (contentCheck.hasSecret) {
      throw new Error(`Cannot store memory containing sensitive secrets or credentials: ${contentCheck.violations.join(', ')}`);
    }

    const keyCheck = checkPrivacy(input.key);
    if (keyCheck.hasSecret) {
      throw new Error(`Memory key cannot contain sensitive secrets: ${keyCheck.violations.join(', ')}`);
    }

    const db = getDb();
    const scope = input.scope ?? 'global';
    const projectId = scope === 'project' ? (input.projectId ?? null) : null;
    const kind = input.kind ?? 'preference';
    const summary = input.summary ?? input.content.slice(0, 150);
    const isStanding = input.isStanding ?? false;
    const sourceType = input.sourceType ?? 'user_statement';

    // Check for existing item matching (userId, scope, projectId, key)
    const existing = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, input.userId),
          eq(memoryItems.scope, scope),
          projectId ? eq(memoryItems.projectId, projectId) : isNull(memoryItems.projectId),
          eq(memoryItems.key, input.key),
        ),
      )
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      const current = existing[0];
      const updated = await db
        .update(memoryItems)
        .set({
          content: input.content,
          summary,
          kind,
          isStanding,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(memoryItems.id, current.id))
        .returning();
      if (updated[0]) return updated[0];
      throw new Error('Failed to update memory item');
    }

    // Two saves of one new topic can both miss the SELECT above; the unique index turns the
    // second insert into an error, and one retry takes the update path instead.
    const inserted = await db
      .insert(memoryItems)
      .values({
        userId: input.userId,
        scope,
        projectId,
        kind,
        key: input.key,
        content: input.content,
        summary,
        isStanding,
        sourceType,
        sourceChatId: input.sourceChatId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        version: 1,
      })
      .returning()
      .catch(async (err: unknown) => {
        const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
        if (code === '23505' && !retried) return [await this.createMemory(input, true)];
        throw err;
      });

    if (inserted[0]) return inserted[0];
    throw new Error('Failed to insert memory item');
  }

  /**
   * Retrieves a single memory item by ID ensuring user isolation.
   */
  async getMemoryById(userId: string, memoryId: string): Promise<MemoryItem | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.id, memoryId), eq(memoryItems.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Updates a memory item with optimistic concurrency control.
   */
  async updateMemory(
    userId: string,
    memoryId: string,
    expectedVersion: number,
    updates: UpdateMemoryInput,
  ): Promise<MemoryItem> {
    if (updates.content) {
      const check = checkPrivacy(updates.content);
      if (check.hasSecret) {
        throw new Error(`Cannot store memory containing secrets: ${check.violations.join(', ')}`);
      }
    }
    if (updates.key) {
      const check = checkPrivacy(updates.key);
      if (check.hasSecret) {
        throw new Error(`Memory key cannot contain secrets: ${check.violations.join(', ')}`);
      }
    }

    const db = getDb();
    const patch: Partial<typeof memoryItems.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (updates.key !== undefined) patch.key = updates.key;
    if (updates.content !== undefined) patch.content = updates.content;
    if (updates.summary !== undefined) patch.summary = updates.summary;
    if (updates.kind !== undefined) patch.kind = updates.kind;
    if (updates.isStanding !== undefined) patch.isStanding = updates.isStanding;

    const rows = await db
      .update(memoryItems)
      .set({
        ...patch,
        version: sql`${memoryItems.version} + 1`,
      })
      .where(
        and(
          eq(memoryItems.id, memoryId),
          eq(memoryItems.userId, userId),
          eq(memoryItems.version, expectedVersion),
        ),
      )
      .returning();

    if (rows.length > 0 && rows[0]) {
      return rows[0];
    }

    // Determine whether not found or concurrency conflict
    const current = await this.getMemoryById(userId, memoryId);
    if (!current) {
      throw new Error(`Memory item not found: ${memoryId}`);
    }
    throw new MemoryConcurrencyError(expectedVersion, current.version);
  }

  /**
   * Forgets a memory item by deleting it from active storage.
   * Invariant: Does not alter or delete the underlying chat messages.
   */
  async forgetMemory(userId: string, memoryId: string, expectedVersion?: number): Promise<boolean> {
    const db = getDb();
    const conditions = [
      eq(memoryItems.id, memoryId),
      eq(memoryItems.userId, userId),
    ];
    if (expectedVersion !== undefined) {
      conditions.push(eq(memoryItems.version, expectedVersion));
    }

    const deleted = await db
      .delete(memoryItems)
      .where(and(...conditions))
      .returning({ id: memoryItems.id, key: memoryItems.key });

    return deleted.length > 0;
  }

  /**
   * Full-text search over key, summary and content, any word matching, ranked by ts_rank_cd.
   * Falls back to ILIKE on each word when full-text search finds nothing.
   */
  async searchMemory(userId: string, filter: SearchMemoryFilter): Promise<MemorySearchResult[]> {
    const db = getDb();
    const limit = filter.limit ?? 10;
    const words = searchWords(filter.query);
    if (words.length === 0) return [];
    // Any word may match, ranked by how many do: websearch_to_tsquery would AND every word, so
    // a memory about "KVB" never matched "how many entries in kvb and federal".
    const cleanQuery = words.join(' | ');

    // Scope conditions
    const scopeConditions = [eq(memoryItems.userId, userId)];
    if (filter.scope === 'global') {
      scopeConditions.push(eq(memoryItems.scope, 'global'));
    } else if (filter.scope === 'project' && filter.projectId) {
      scopeConditions.push(
        and(eq(memoryItems.scope, 'project'), eq(memoryItems.projectId, filter.projectId))!,
      );
    } else if (filter.projectId) {
      scopeConditions.push(
        or(
          eq(memoryItems.scope, 'global'),
          and(eq(memoryItems.scope, 'project'), eq(memoryItems.projectId, filter.projectId)),
        )!,
      );
    } else {
      scopeConditions.push(eq(memoryItems.scope, 'global'));
    }

    if (filter.kind) {
      scopeConditions.push(eq(memoryItems.kind, filter.kind));
    }

    // 1. Full-text search with ts_rank_cd
    const ftsQuery = sql`
      SELECT ${memoryItems.id} as id,
             ${memoryItems.key} as key,
             ${memoryItems.content} as content,
             ${memoryItems.summary} as summary,
             ${memoryItems.scope} as scope,
             ${memoryItems.kind} as kind,
             ${memoryItems.isStanding} as "isStanding",
             ${memoryItems.version} as version,
             ${memoryItems.updatedAt} as "updatedAt",
             ts_rank_cd(
               to_tsvector('simple', coalesce(${memoryItems.key}, '') || ' ' || coalesce(${memoryItems.summary}, '') || ' ' || coalesce(${memoryItems.content}, '')),
               to_tsquery('simple', ${cleanQuery})
             ) as score
      FROM ${memoryItems}
      WHERE ${and(...scopeConditions)}
        AND to_tsvector('simple', coalesce(${memoryItems.key}, '') || ' ' || coalesce(${memoryItems.summary}, '') || ' ' || coalesce(${memoryItems.content}, '')) @@ to_tsquery('simple', ${cleanQuery})
      ORDER BY score DESC, ${memoryItems.updatedAt} DESC
      LIMIT ${limit}
    `;

    try {
      const ftsResults = (await db.execute(ftsQuery)) as unknown as Array<{
        id: string;
        key: string;
        content: string;
        summary: string;
        scope: 'global' | 'project';
        kind: 'preference' | 'workflow' | 'fact' | 'constraint';
        isStanding: boolean;
        version: number;
        updatedAt: string | Date;
        score: number;
      }>;

      if (ftsResults.length > 0) {
        return ftsResults.map((r) => ({
          ...r,
          updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : r.updatedAt.toISOString(),
          score: Number(r.score) || 1.0,
        }));
      }
    } catch {
      // If FTS expression parsing errors on edge-case syntax, gracefully fallback to ILIKE
    }

    // 2. Fallback to ILIKE match on any word, for text the tokenizer splits differently.
    const likePatterns = words.map((w) => `%${w}%`);
    const fallbackQuery = sql`
      SELECT ${memoryItems.id} as id,
             ${memoryItems.key} as key,
             ${memoryItems.content} as content,
             ${memoryItems.summary} as summary,
             ${memoryItems.scope} as scope,
             ${memoryItems.kind} as kind,
             ${memoryItems.isStanding} as "isStanding",
             ${memoryItems.version} as version,
             ${memoryItems.updatedAt} as "updatedAt",
             0.5 as score
      FROM ${memoryItems}
      WHERE ${and(...scopeConditions)}
        AND (${sql.join(
          likePatterns.map(
            (p) =>
              sql`${memoryItems.key} ILIKE ${p} OR ${memoryItems.summary} ILIKE ${p} OR ${memoryItems.content} ILIKE ${p}`,
          ),
          sql` OR `,
        )})
      ORDER BY ${memoryItems.updatedAt} DESC
      LIMIT ${limit}
    `;

    const fallbackResults = (await db.execute(fallbackQuery)) as unknown as Array<{
      id: string;
      key: string;
      content: string;
      summary: string;
      scope: 'global' | 'project';
      kind: 'preference' | 'workflow' | 'fact' | 'constraint';
      isStanding: boolean;
      version: number;
      updatedAt: string | Date;
      score: number;
    }>;

    return fallbackResults.map((r) => ({
      ...r,
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : r.updatedAt.toISOString(),
      score: Number(r.score) || 0.5,
    }));
  }

  /**
   * The topic a user means by name, case-insensitively: the current project's first, then global.
   */
  async findByTopic(userId: string, topic: string, projectId: string | null): Promise<MemoryItem | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, userId),
          sql`lower(${memoryItems.key}) = lower(${topic.trim()})`,
          projectId
            ? or(eq(memoryItems.scope, 'global'), and(eq(memoryItems.scope, 'project'), eq(memoryItems.projectId, projectId)))!
            : eq(memoryItems.scope, 'global'),
        ),
      );
    return rows.find((r) => r.scope === 'project') ?? rows[0] ?? null;
  }

  /**
   * Everything remembered for this user, as the conversation starts from it: global topics, and
   * the project's own inside a project (Claude keeps a separate memory per project). Standing
   * items first, then most recently updated, within `maxChars`. What does not fit stays
   * reachable through search_memory; `omitted` says how many.
   */
  async getMemoryContext(
    userId: string,
    projectId: string | null,
    maxChars: number,
  ): Promise<{ text: string; included: number; omitted: number }> {
    const db = getDb();
    const items = await db
      .select()
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, userId),
          projectId
            ? or(eq(memoryItems.scope, 'global'), and(eq(memoryItems.scope, 'project'), eq(memoryItems.projectId, projectId)))!
            : eq(memoryItems.scope, 'global'),
        ),
      )
      .orderBy(desc(memoryItems.isStanding), desc(memoryItems.updatedAt));
    const lines: string[] = [];
    let used = 0;
    for (const item of items) {
      const line = `- ${item.key}${item.scope === 'project' ? ' (this project)' : ''}: ${item.content}`;
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return { text: lines.join('\n'), included: lines.length, omitted: items.length - lines.length };
  }

  /**
   * Retrieves standing memories formatted as concise bullets, capped at MEMORY_STANDING_MAX_CHARS.
   */
  async getStandingMemories(userId: string, projectId?: string | null): Promise<string> {
    const db = getDb();
    const cfg = config();
    const maxChars = cfg.MEMORY_STANDING_MAX_CHARS ?? 2000;

    const conditions = [
      eq(memoryItems.userId, userId),
      eq(memoryItems.isStanding, true),
    ];

    if (projectId) {
      conditions.push(
        or(
          eq(memoryItems.scope, 'global'),
          and(eq(memoryItems.scope, 'project'), eq(memoryItems.projectId, projectId)),
        )!,
      );
    } else {
      conditions.push(eq(memoryItems.scope, 'global'));
    }

    const items = await db
      .select()
      .from(memoryItems)
      .where(and(...conditions))
      .orderBy(desc(memoryItems.updatedAt))
      .limit(30);

    if (items.length === 0) return '';

    const lines: string[] = [];
    let currentLength = 0;

    for (const item of items) {
      const line = `- ${item.key}: ${item.content}`;
      if (currentLength + line.length + 1 > maxChars) {
        break;
      }
      lines.push(line);
      currentLength += line.length + 1;
    }

    return lines.join('\n');
  }

  /**
   * Lists memories for UI presentation.
   */
  async listMemories(
    userId: string,
    options?: {
      projectId?: string | null;
      scope?: string;
      isStanding?: boolean;
      limit?: number;
      offset?: number;
    },
  ): Promise<{ items: MemoryItem[]; total: number }> {
    const db = getDb();
    const conditions = [eq(memoryItems.userId, userId)];

    if (options?.scope) {
      conditions.push(eq(memoryItems.scope, options.scope));
    }
    if (options?.projectId !== undefined) {
      if (options.projectId) {
        conditions.push(eq(memoryItems.projectId, options.projectId));
      } else {
        conditions.push(isNull(memoryItems.projectId));
      }
    }
    if (options?.isStanding !== undefined) {
      conditions.push(eq(memoryItems.isStanding, options.isStanding));
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryItems)
      .where(and(...conditions));

    const items = await db
      .select()
      .from(memoryItems)
      .where(and(...conditions))
      .orderBy(desc(memoryItems.updatedAt))
      .limit(limit)
      .offset(offset);

    return {
      items,
      total: countResult?.count ?? 0,
    };
  }

  /**
   * Clears memories scoped to a specific project.
   */
  async clearProjectMemories(userId: string, projectId: string): Promise<number> {
    const db = getDb();
    const deleted = await db
      .delete(memoryItems)
      .where(
        and(
          eq(memoryItems.userId, userId),
          eq(memoryItems.scope, 'project'),
          eq(memoryItems.projectId, projectId),
        ),
      )
      .returning({ id: memoryItems.id });
    return deleted.length;
  }

  /**
   * Clears all memories for a user.
   */
  async clearAllMemories(userId: string): Promise<number> {
    const db = getDb();
    const deleted = await db
      .delete(memoryItems)
      .where(eq(memoryItems.userId, userId))
      .returning({ id: memoryItems.id });
    return deleted.length;
  }
}

export const memoryService = new MemoryService();
