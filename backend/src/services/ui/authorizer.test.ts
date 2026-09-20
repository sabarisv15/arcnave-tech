import { describe, expect, it, vi } from 'vitest';
import { UIAuthorizer } from './authorizer.js';
import type { Database } from '../../db/client.js';
import type { UIResponseV1 } from './types.js';

describe('UIAuthorizer (Two-Stage Reference Security)', () => {
  const validArtifactId = '11111111-1111-1111-1111-111111111111';
  const unauthorizedArtifactId = '99999999-9999-9999-9999-999999999999';

  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            // Mock returning row only if it matches validArtifactId
            return [{ id: validArtifactId }];
          }),
        })),
      })),
    })),
  } as unknown as Database;

  const authorizer = new UIAuthorizer(mockDb);

  it('authorizes valid user artifact and rejects unauthorized artifact ID', async () => {
    // Override select for unauthorized test
    const customDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      })),
    } as unknown as Database;
    const strictAuthorizer = new UIAuthorizer(customDb);

    const isAuthorized = await strictAuthorizer.authorizeArtifact('user_123', unauthorizedArtifactId);
    expect(isAuthorized).toBe(false);
  });

  it('strips unauthorized open_artifact actions from cards while preserving card metadata', async () => {
    // Authorizer where validArtifactId is authorized and unauthorizedArtifactId is not
    const selectiveAuthorizer = new UIAuthorizer({} as Database);
    vi.spyOn(selectiveAuthorizer, 'authorizeArtifact').mockImplementation(async (_u, id) => {
      return id === validArtifactId;
    });

    const response: UIResponseV1 = {
      schemaVersion: 1,
      blocks: [
        {
          blockId: 'cards_1',
          sequence: 1,
          type: 'cards',
          cards: [
            {
              id: 'c1',
              title: 'Valid Card',
              action: {
                actionType: 'open_artifact',
                artifactId: validArtifactId,
              },
            },
            {
              id: 'c2',
              title: 'Unauthorized Card',
              action: {
                actionType: 'open_artifact',
                artifactId: unauthorizedArtifactId,
              },
            },
          ],
        },
      ],
    };

    const sanitized = await selectiveAuthorizer.filterAuthorizedUI(response, {
      userId: 'user_1',
      chatId: 'chat_1',
    });

    expect(sanitized.blocks).toHaveLength(1);
    const cardsBlock = sanitized.blocks[0] as Extract<typeof response.blocks[0], { type: 'cards' }>;
    expect(cardsBlock.cards[0]!.action).toBeDefined();
    expect(cardsBlock.cards[0]!.action?.actionType).toBe('open_artifact');
    // c2 should have had its action stripped
    expect(cardsBlock.cards[1]!.action).toBeUndefined();
    expect(cardsBlock.cards[1]!.title).toBe('Unauthorized Card');
  });

  it('rejects dangerous javascript: sourceRef schemes', async () => {
    const isAllowed = await authorizer.authorizeSource('chat_1', 'javascript:alert(1)');
    expect(isAllowed).toBe(false);
  });
});
