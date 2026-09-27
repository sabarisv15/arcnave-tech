/**
 * conversation_search, read_conversation and recent_chats: the user's earlier conversations,
 * in this chat's scope (a project's chats inside a project, the rest outside one).
 *
 * Invariant 1: bad inputs or errors return explicit ToolResults, never throw.
 */
import { z } from 'zod';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import { readConversation, recentChats, searchChats, type ChatScope } from '../services/memory/chatSearch.js';

const searchInput = z.object({
  query: z.string().trim().min(1),
  max_results: z.number().int().min(1).max(10).optional(),
  within_conversation_id: z.string().uuid().nullish(),
});
const readInput = z.object({
  conversation_id: z.string().uuid(),
  page_token: z.string().regex(/^\d+$/).nullish(),
  max_turns: z.number().int().min(1).max(50).optional(),
});
const recentInput = z.object({
  n: z.number().int().min(1).max(20).optional(),
  before: z.string().datetime({ offset: true }).nullish(),
  after: z.string().datetime({ offset: true }).nullish(),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown): ToolResult {
  return { toolCallId, ok: true, content: [{ type: 'json', data }] };
}

export class ChatToolExecutor implements ToolExecutor {
  private readonly scope: ChatScope;

  constructor(
    private readonly userId: string,
    projectId: string | null,
    chatId: string | null,
  ) {
    this.scope = { projectId, excludeChatId: chatId };
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (signal.aborted) return textResult(call.id, false, 'The request was aborted before this tool ran.');
    try {
      switch (call.name) {
        case 'conversation_search': {
          const p = searchInput.safeParse(call.input);
          if (!p.success) return textResult(call.id, false, `Invalid input: ${p.error.message}`);
          const hits = await searchChats(
            this.userId,
            p.data.query,
            this.scope,
            p.data.max_results ?? 5,
            p.data.within_conversation_id ?? undefined,
          );
          return jsonResult(call.id, { results: hits });
        }
        case 'read_conversation': {
          const p = readInput.safeParse(call.input);
          if (!p.success) return textResult(call.id, false, `Invalid input: ${p.error.message}`);
          const page = await readConversation(
            this.userId,
            p.data.conversation_id,
            this.scope,
            Number(p.data.page_token ?? 0),
            p.data.max_turns ?? 20,
          );
          if (!page) return textResult(call.id, false, 'No chat with that id is available here.');
          return jsonResult(call.id, page);
        }
        case 'recent_chats': {
          const p = recentInput.safeParse(call.input);
          if (!p.success) return textResult(call.id, false, `Invalid input: ${p.error.message}`);
          const chats = await recentChats(
            this.userId,
            this.scope,
            p.data.n ?? 3,
            p.data.before ?? undefined,
            p.data.after ?? undefined,
          );
          return jsonResult(call.id, { chats });
        }
        default:
          return textResult(call.id, false, `Unknown tool "${call.name}".`);
      }
    } catch (err) {
      return textResult(call.id, false, `${call.name} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
