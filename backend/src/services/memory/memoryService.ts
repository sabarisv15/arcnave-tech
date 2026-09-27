import { createHash } from 'node:crypto';

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { memoryItems, type MemoryItem } from '../../db/schema.js';
import { checkPrivacy } from './privacy.js';
import type { CreateMemoryInput, UpdateMemoryInput } from './types.js';

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

/** Memory files a listing returns at once; the rest page with cursor. */
const MEMORY_LIST_LIMIT = 100;
/** A memory file's size cap. */
export const MEMORY_FILE_MAX_BYTES = 16 * 1024;
const MEMORY_PATH = /^\/[A-Za-z0-9_\-./]{1,190}$/;

export interface MemoryFileInfo {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface MemoryFile extends MemoryFileInfo {
  content: string;
  /** Opaque: a write passes it back to prove it saw this content. */
  version: string;
}

export type MemoryWriteResult =
  | { ok: true; file?: MemoryFile }
  | { ok: false; error: string; current?: MemoryFile };

/**
 * A topic name given in settings or an import ("Writing style") as the file path the memory
 * tools use (/topics/writing-style.md), the same way migration 0022 moved the ones saved before.
 */
export function toMemoryPath(key: string): string {
  if (key.startsWith('/')) return key;
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
  return `/topics/${slug || 'note'}.md`;
}

/** A 12-character token for one version of one file. */
export function versionToken(row: Pick<MemoryItem, 'id' | 'version'>): string {
  return createHash('sha256').update(`${row.id}:${String(row.version)}`).digest('hex').slice(0, 12);
}

function toFile(row: MemoryItem): MemoryFile {
  return {
    path: row.key,
    sizeBytes: Buffer.byteLength(row.content, 'utf8'),
    updatedAt: row.updatedAt.toISOString(),
    content: row.content,
    version: versionToken(row),
  };
}

/** The frontmatter's description line, or the first content line. */
export function fileDescription(content: string): string {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  const desc = fm ? /^description:\s*(.+)$/m.exec(fm[1]!)?.[1] : undefined;
  if (desc) return desc.trim().slice(0, 200);
  const body = fm ? content.slice(fm[0].length) : content;
  return (body.split('\n').find((l) => l.trim() !== '') ?? '').trim().slice(0, 200);
}

/** Why a path or content cannot be stored, or null. */
function checkFile(path: string, content: string): string | null {
  if (!MEMORY_PATH.test(path) || path.includes('..') || path.endsWith('/')) {
    return 'A memory path starts with / and uses letters, digits, - _ . and /, e.g. /topics/work.md.';
  }
  if (content.trim() === '') return 'Empty content is not stored.';
  if (Buffer.byteLength(content, 'utf8') > MEMORY_FILE_MAX_BYTES) {
    return `A memory file is at most ${String(MEMORY_FILE_MAX_BYTES)} bytes: condense it.`;
  }
  const secret = checkPrivacy(content);
  if (secret.hasSecret) return `Memory never stores secrets or credentials: ${secret.violations.join(', ')}.`;
  return null;
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

    input = { ...input, key: toMemoryPath(input.key) };
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
    if (updates.key !== undefined) patch.key = toMemoryPath(updates.key);
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

  /* ------------------------------------------------------------ Memory as files (ADR-0047) */

  /** The store a chat reads and writes: the project's own inside a project, the user's otherwise. */
  private storeWhere(userId: string, projectId: string | null) {
    return and(
      eq(memoryItems.userId, userId),
      projectId
        ? and(eq(memoryItems.scope, 'project'), eq(memoryItems.projectId, projectId))!
        : eq(memoryItems.scope, 'global'),
    )!;
  }

  private async fileRow(userId: string, projectId: string | null, path: string): Promise<MemoryItem | null> {
    const rows = await getDb()
      .select()
      .from(memoryItems)
      .where(and(this.storeWhere(userId, projectId), eq(memoryItems.key, path)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Files in the store, by path, from `cursor` on. */
  async listFiles(
    userId: string,
    projectId: string | null,
    options: { pathPrefix?: string; cursor?: string; limit?: number } = {},
  ): Promise<{ files: Array<MemoryFileInfo & { description: string }>; nextCursor: string | null }> {
    const limit = options.limit ?? MEMORY_LIST_LIMIT;
    const rows = await getDb()
      .select()
      .from(memoryItems)
      .where(
        and(
          this.storeWhere(userId, projectId),
          options.pathPrefix ? sql`starts_with(${memoryItems.key}, ${options.pathPrefix})` : sql`TRUE`,
          options.cursor ? sql`${memoryItems.key} > ${options.cursor}` : sql`TRUE`,
        ),
      )
      .orderBy(memoryItems.key)
      .limit(limit + 1);
    const files = rows.slice(0, limit).map((r) => ({
      path: r.key,
      sizeBytes: Buffer.byteLength(r.content, 'utf8'),
      updatedAt: r.updatedAt.toISOString(),
      description: fileDescription(r.content),
    }));
    return { files, nextCursor: rows.length > limit ? files[files.length - 1]!.path : null };
  }

  async readFile(userId: string, projectId: string | null, path: string): Promise<MemoryFile | null> {
    const row = await this.fileRow(userId, projectId, path);
    return row ? toFile(row) : null;
  }

  /**
   * Writes a whole file against the version last read ('new' for a file not there yet). A
   * conflict returns the current file, so the model can merge and retry in the same turn.
   */
  async writeFile(
    userId: string,
    projectId: string | null,
    path: string,
    content: string,
    ifVersion: string,
  ): Promise<MemoryWriteResult> {
    const problem = checkFile(path, content);
    if (problem) return { ok: false, error: problem };
    const current = await this.fileRow(userId, projectId, path);
    if (ifVersion === 'new') {
      if (current) {
        return { ok: false, error: `${path} already exists: read it and pass its version.`, current: toFile(current) };
      }
      try {
        const [row] = await getDb()
          .insert(memoryItems)
          .values({
            userId,
            scope: projectId ? 'project' : 'global',
            projectId,
            key: path,
            content,
            summary: fileDescription(content),
            sourceType: 'user_statement',
            version: 1,
          })
          .returning();
        return { ok: true, file: toFile(row!) };
      } catch (err) {
        const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
        if (code !== '23505') throw err;
        const now = await this.fileRow(userId, projectId, path);
        return { ok: false, error: `${path} was just created elsewhere: read it and retry.`, ...(now ? { current: toFile(now) } : {}) };
      }
    }
    if (!current) return { ok: false, error: `${path} does not exist: pass new to create it.` };
    if (versionToken(current) !== ifVersion) {
      return { ok: false, error: `${path} has changed since that version.`, current: toFile(current) };
    }
    // The version in the WHERE makes a concurrent write lose instead of overwrite (a transaction is not a lock).
    const [row] = await getDb()
      .update(memoryItems)
      .set({ content, summary: fileDescription(content), version: current.version + 1, updatedAt: new Date() })
      .where(and(eq(memoryItems.id, current.id), eq(memoryItems.version, current.version)))
      .returning();
    if (!row) {
      const now = await this.fileRow(userId, projectId, path);
      return { ok: false, error: `${path} has changed since that version.`, ...(now ? { current: toFile(now) } : {}) };
    }
    return { ok: true, file: toFile(row) };
  }

  async appendFile(userId: string, projectId: string | null, path: string, text: string, ifVersion: string) {
    if (ifVersion === 'new') return this.writeFile(userId, projectId, path, text, 'new');
    const current = await this.fileRow(userId, projectId, path);
    if (!current) return { ok: false as const, error: `${path} does not exist: pass new to create it.` };
    const joined = current.content.endsWith('\n') ? current.content + text : `${current.content}\n${text}`;
    return this.writeFile(userId, projectId, path, joined, ifVersion);
  }

  async strReplaceFile(
    userId: string,
    projectId: string | null,
    path: string,
    oldStr: string,
    newStr: string,
    ifVersion: string,
  ): Promise<MemoryWriteResult> {
    const current = await this.fileRow(userId, projectId, path);
    if (!current) return { ok: false, error: `${path} does not exist.` };
    const count = current.content.split(oldStr).length - 1;
    if (count !== 1) {
      return {
        ok: false,
        error: count === 0 ? `old_str was not found in ${path}.` : `old_str occurs ${String(count)} times in ${path}; make it unique.`,
        current: toFile(current),
      };
    }
    return this.writeFile(userId, projectId, path, current.content.replace(oldStr, () => newStr), ifVersion);
  }

  async deleteFile(userId: string, projectId: string | null, path: string, ifVersion: string): Promise<MemoryWriteResult> {
    const current = await this.fileRow(userId, projectId, path);
    if (!current) return { ok: false, error: `${path} does not exist.` };
    if (versionToken(current) !== ifVersion) {
      return { ok: false, error: `${path} has changed since that version.`, current: toFile(current) };
    }
    const deleted = await getDb()
      .delete(memoryItems)
      .where(and(eq(memoryItems.id, current.id), eq(memoryItems.version, current.version)))
      .returning({ id: memoryItems.id });
    if (deleted.length === 0) return { ok: false, error: `${path} has changed since that version.` };
    return { ok: true };
  }

  /**
   * What a conversation starts from: the listing of every file, and /profile.md and
   * /preferences.md in full. The same text from turn to turn, so it keeps the prompt cache.
   */
  async memoryPrompt(userId: string, projectId: string | null, maxChars: number): Promise<string> {
    const rows = await getDb()
      .select()
      .from(memoryItems)
      .where(this.storeWhere(userId, projectId))
      .orderBy(memoryItems.key);
    const byPath = new Map(rows.map((r) => [r.key, r]));
    const lines = rows.map((r) => {
      const d = fileDescription(r.content);
      return `${r.key}${d ? ` — ${d}` : ''}`;
    });
    let listing = lines.join('\n');
    if (listing.length > maxChars) listing = `${listing.slice(0, maxChars)}\n(more files: memory_list shows them)`;
    const parts = [`<memory_listing>\n${listing || '(empty)'}\n</memory_listing>`];
    const profile = byPath.get('/profile.md');
    parts.push(`<profile>\n${profile ? profile.content.slice(0, maxChars) : '(not yet written)'}\n</profile>`);
    const preferences = byPath.get('/preferences.md');
    if (preferences) parts.push(`<preferences>\n${preferences.content.slice(0, maxChars)}\n</preferences>`);
    return parts.join('\n');
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
