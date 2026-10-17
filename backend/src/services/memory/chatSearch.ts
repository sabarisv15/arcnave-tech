/**
 * The user's earlier conversations, for conversation_search, read_conversation and recent_chats:
 * all chats outside projects from a chat outside one, and only that project's chats from a chat
 * inside one. Each result names its chat so the answer can cite it.
 *
 * Lexical, like every search here (Invariant 4): any word may match, ranked by ts_rank_cd.
 */
import { sql } from 'drizzle-orm';

import type { DbLike } from '../../db/client.js';
import { searchWords } from './memoryService.js';

export interface ChatScope {
  projectId: string | null;
  /** Left out of a search across chats: the conversation the user is in. */
  excludeChatId: string | null;
}

export interface ChatSearchHit {
  chatId: string;
  chatTitle: string;
  role: string;
  at: string;
  excerpt: string;
  /** Opens read_conversation at this hit, with the question that led to it. */
  pageToken: string;
}

const iso = (at: string | Date): string => (typeof at === 'string' ? at : at.toISOString());

const inScope = (scope: ChatScope) =>
  scope.projectId ? sql`c.project_id = ${scope.projectId}` : sql`c.project_id IS NULL`;

export async function searchChats(
  db: DbLike,
  userId: string,
  query: string,
  scope: ChatScope,
  limit: number,
  withinChatId?: string,
): Promise<ChatSearchHit[]> {
  const words = searchWords(query);
  if (words.length === 0) return [];
  const tsquery = words.join(' | ');
  const rows = (await db.execute(sql`
    SELECT m.chat_id AS "chatId",
           c.title AS "chatTitle",
           m.role AS role,
           m.seq AS seq,
           m.created_at AS at,
           ts_headline('simple', m.text, to_tsquery('simple', ${tsquery}),
             'MaxWords=60, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "') AS excerpt
    FROM messages m
    JOIN chats c ON c.id = m.chat_id
    WHERE c.user_id = ${userId}
      AND c.deleted_at IS NULL
      AND ${inScope(scope)}
      AND ${
        withinChatId
          ? sql`c.id = ${withinChatId}`
          : scope.excludeChatId
            ? sql`c.id <> ${scope.excludeChatId}`
            : sql`TRUE`
      }
      AND m.text <> ''
      AND to_tsvector('simple', m.text) @@ to_tsquery('simple', ${tsquery})
    ORDER BY ts_rank_cd(to_tsvector('simple', m.text), to_tsquery('simple', ${tsquery})) DESC, m.created_at DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ chatId: string; chatTitle: string; role: string; seq: number; at: string | Date; excerpt: string }>;
  return rows.map(({ seq, ...r }) => ({
    ...r,
    at: iso(r.at),
    // An answer opens with the question before it.
    pageToken: String(r.role === 'user' ? seq : Math.max(0, seq - 1)),
  }));
}

export interface ConversationPage {
  chatId: string;
  chatTitle: string;
  turns: Array<{ seq: number; role: string; at: string; text: string }>;
  nextPageToken: string | null;
  prevPageToken: string | null;
}

/** Turns of one chat from a page token on, or null when the chat is not the user's in this scope. */
export async function readConversation(
  db: DbLike,
  userId: string,
  chatId: string,
  scope: ChatScope,
  fromSeq: number,
  maxTurns: number,
): Promise<ConversationPage | null> {
  const [chat] = (await db.execute(sql`
    SELECT c.id, c.title FROM chats c
    WHERE c.id = ${chatId} AND c.user_id = ${userId} AND c.deleted_at IS NULL AND ${inScope(scope)}
  `)) as unknown as Array<{ id: string; title: string }>;
  if (!chat) return null;
  const rows = (await db.execute(sql`
    SELECT m.seq AS seq, m.role AS role, m.created_at AS at, m.text AS text
    FROM messages m
    WHERE m.chat_id = ${chatId} AND m.seq >= ${fromSeq} AND m.text <> ''
    ORDER BY m.seq
    LIMIT ${maxTurns + 1}
  `)) as unknown as Array<{ seq: number; role: string; at: string | Date; text: string }>;
  const turns = rows.slice(0, maxTurns).map((r) => ({ ...r, at: iso(r.at) }));
  return {
    chatId: chat.id,
    chatTitle: chat.title,
    turns,
    nextPageToken: rows.length > maxTurns ? String(rows[maxTurns]!.seq) : null,
    prevPageToken: fromSeq > 0 ? String(Math.max(0, fromSeq - maxTurns)) : null,
  };
}

export interface RecentChat {
  chatId: string;
  chatTitle: string;
  updatedAt: string;
  excerpt: string;
}

/** The user's chats in this scope, most recently updated first, with the start of each. */
export async function recentChats(
  db: DbLike,
  userId: string,
  scope: ChatScope,
  n: number,
  before?: string,
  after?: string,
): Promise<RecentChat[]> {
  const rows = (await db.execute(sql`
    SELECT c.id AS "chatId", c.title AS "chatTitle", c.updated_at AS "updatedAt",
           coalesce((SELECT left(m.text, 300) FROM messages m
                     WHERE m.chat_id = c.id AND m.role = 'user' AND m.text <> ''
                     ORDER BY m.seq LIMIT 1), '') AS excerpt
    FROM chats c
    WHERE c.user_id = ${userId}
      AND c.deleted_at IS NULL
      AND ${inScope(scope)}
      AND ${scope.excludeChatId ? sql`c.id <> ${scope.excludeChatId}` : sql`TRUE`}
      AND ${before ? sql`c.updated_at < ${before}` : sql`TRUE`}
      AND ${after ? sql`c.updated_at > ${after}` : sql`TRUE`}
    ORDER BY c.updated_at DESC
    LIMIT ${n}
  `)) as unknown as Array<{ chatId: string; chatTitle: string; updatedAt: string | Date; excerpt: string }>;
  return rows.map((r) => ({ ...r, updatedAt: iso(r.updatedAt) }));
}

/** The three reads bound to one database handle: what the container hands a turn (A-16). */
export class ChatSearch {
  constructor(private readonly db: DbLike) {}

  search(userId: string, query: string, scope: ChatScope, limit: number, withinChatId?: string): Promise<ChatSearchHit[]> {
    return searchChats(this.db, userId, query, scope, limit, withinChatId);
  }

  read(userId: string, chatId: string, scope: ChatScope, fromSeq: number, maxTurns: number): Promise<ConversationPage | null> {
    return readConversation(this.db, userId, chatId, scope, fromSeq, maxTurns);
  }

  recent(userId: string, scope: ChatScope, n: number, before?: string, after?: string): Promise<RecentChat[]> {
    return recentChats(this.db, userId, scope, n, before, after);
  }
}
