/**
 * Search over the user's earlier conversations: all chats outside projects from a chat outside
 * one, and only that project's chats from a chat inside one. The model calls it when the user refers to
 * an earlier conversation; each hit names its chat so the answer can cite it.
 *
 * Lexical, like every search here (Invariant 4): any word may match, ranked by ts_rank_cd.
 */
import { sql } from 'drizzle-orm';

import { getDb } from '../../db/client.js';
import { searchWords } from './memoryService.js';

export interface ChatSearchHit {
  chatId: string;
  chatTitle: string;
  role: string;
  at: string;
  excerpt: string;
}

export async function searchChats(
  userId: string,
  query: string,
  scope: { projectId: string | null; excludeChatId: string | null },
  limit: number,
): Promise<ChatSearchHit[]> {
  const words = searchWords(query);
  if (words.length === 0) return [];
  const tsquery = words.join(' | ');
  const rows = (await getDb().execute(sql`
    SELECT m.chat_id AS "chatId",
           c.title AS "chatTitle",
           m.role AS role,
           m.created_at AS at,
           ts_headline('simple', m.text, to_tsquery('simple', ${tsquery}),
             'MaxWords=60, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "') AS excerpt
    FROM messages m
    JOIN chats c ON c.id = m.chat_id
    WHERE c.user_id = ${userId}
      AND c.deleted_at IS NULL
      AND ${scope.projectId ? sql`c.project_id = ${scope.projectId}` : sql`c.project_id IS NULL`}
      AND ${scope.excludeChatId ? sql`c.id <> ${scope.excludeChatId}` : sql`TRUE`}
      AND m.text <> ''
      AND to_tsvector('simple', m.text) @@ to_tsquery('simple', ${tsquery})
    ORDER BY ts_rank_cd(to_tsvector('simple', m.text), to_tsquery('simple', ${tsquery})) DESC, m.created_at DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ chatId: string; chatTitle: string; role: string; at: string | Date; excerpt: string }>;
  return rows.map((r) => ({ ...r, at: typeof r.at === 'string' ? r.at : r.at.toISOString() }));
}
