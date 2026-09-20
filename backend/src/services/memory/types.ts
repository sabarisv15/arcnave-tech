import type { InferSelectModel } from 'drizzle-orm';
import { memoryItems } from '../../db/schema.js';

export type MemoryItemRow = InferSelectModel<typeof memoryItems>;

export type MemoryScope = 'global' | 'project';
export type MemoryKind = 'preference' | 'workflow' | 'fact' | 'constraint';
export type MemorySourceType = 'user_statement' | 'system_detected';

export interface CreateMemoryInput {
  userId: string;
  scope?: MemoryScope;
  projectId?: string | null;
  kind?: MemoryKind;
  key: string;
  content: string;
  summary?: string;
  isStanding?: boolean;
  sourceType?: MemorySourceType;
  sourceChatId?: string | null;
  sourceMessageId?: string | null;
}

export interface UpdateMemoryInput {
  key?: string;
  content?: string;
  summary?: string;
  kind?: MemoryKind;
  isStanding?: boolean;
}

export interface SearchMemoryFilter {
  query: string;
  scope?: MemoryScope;
  projectId?: string | null;
  kind?: MemoryKind;
  limit?: number;
}

export interface MemorySearchResult {
  id: string;
  key: string;
  content: string;
  summary: string;
  scope: MemoryScope;
  kind: MemoryKind;
  isStanding: boolean;
  version: number;
  score: number;
  updatedAt: string;
}

export interface MemoryContextPayload {
  standingContext: string;
  relevantContext: string;
  retrievedCount: number;
}
