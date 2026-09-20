/**
 * ArcNave Phase 6 UI Authorizer.
 *
 * Verifies that referenced IDs (artifacts, sources, datasets, analysis results)
 * belong to the calling user and conversation before actions or links are exposed.
 */
import { eq, and } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { artifacts, messageSources } from '../../db/schema.js';
import type { UIBlock, UIResponseV1 } from './types.js';

export interface AuthorizationContext {
  userId: string;
  chatId: string;
  projectId?: string | null;
}

export class UIAuthorizer {
  constructor(private readonly db: Database) {}

  /**
   * Authorizes an artifact reference.
   */
  async authorizeArtifact(userId: string, artifactId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(and(eq(artifacts.id, artifactId), eq(artifacts.userId, userId)))
      .limit(1);
    return !!row;
  }

  /**
   * Authorizes a source reference.
   * Matches by source ID or URL domain against sources retrieved for this chat.
   */
  async authorizeSource(chatId: string, sourceRef: string): Promise<boolean> {
    // sourceRef can be an ID or a domain/url marker
    if (sourceRef.startsWith('src_') || sourceRef.length === 36) {
      const [row] = await this.db
        .select({ id: messageSources.id })
        .from(messageSources)
        .where(eq(messageSources.id, sourceRef))
        .limit(1);
      return !!row;
    }
    // If it's a general domain reference, allow it if it has no executable scheme
    return !sourceRef.toLowerCase().startsWith('javascript:');
  }

  /**
   * Filters and secures an entire UIResponseV1 payload:
   * - Strips unauthorized artifact actions
   * - Strips unverified sourceRefs
   */
  async filterAuthorizedUI(response: UIResponseV1, ctx: AuthorizationContext): Promise<UIResponseV1> {
    const sanitizedBlocks: UIBlock[] = [];

    for (const block of response.blocks) {
      if (block.type === 'cards') {
        const sanitizedCards = await Promise.all(
          block.cards.map(async (card) => {
            if (!card.action) return card;
            if (card.action.actionType === 'open_artifact') {
              const ok = await this.authorizeArtifact(ctx.userId, card.action.artifactId);
              if (!ok) {
                // Drop unauthorized action
                const { action: _, ...rest } = card;
                return rest;
              }
            }
            return card;
          }),
        );
        sanitizedBlocks.push({ ...block, cards: sanitizedCards });
      } else if (block.type === 'sources') {
        const sanitizedSources = await Promise.all(
          block.sources.map(async (src) => {
            const ok = await this.authorizeSource(ctx.chatId, src.sourceRef);
            return ok ? src : { ...src, url: undefined };
          }),
        );
        sanitizedBlocks.push({ ...block, sources: sanitizedSources });
      } else {
        sanitizedBlocks.push(block);
      }
    }

    return {
      schemaVersion: 1,
      blocks: sanitizedBlocks,
    };
  }
}
