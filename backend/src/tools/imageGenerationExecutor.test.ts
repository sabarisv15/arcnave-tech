import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../config.js';
import { ImageGenerationExecutor } from './imageGenerationExecutor.js';

describe('ImageGenerationExecutor', () => {
  const mockCfg = {
    GOOGLE_CLOUD_PROJECT: 'test-project',
    geminiLocation: 'us-central1',
  } as Config;

  const mockStorage = {
    get: vi.fn().mockResolvedValue(Buffer.from('fake-source-image-bytes')),
    put: vi.fn().mockResolvedValue(undefined),
  } as any;

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'source-1',
              storageKey: 'key-1',
              mimeType: 'image/png',
              userId: 'u1',
            },
          ]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: 'generated-att-1',
            filename: 'generated_image_123.png',
          },
        ]),
      }),
    }),
  } as any;

  it('rejects unknown tool names', async () => {
    const executor = new ImageGenerationExecutor(
      mockCfg,
      mockStorage,
      mockDb,
      'u1',
      'c1',
      'm1',
    );
    const result = await executor.execute(
      { id: 'call-1', name: 'unknown_tool', input: {} },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.toolCallId).toBe('call-1');
  });

  it('generates an image successfully using generateImages API', async () => {
    const fakeClient = {
      models: {
        generateImages: vi.fn().mockResolvedValue({
          generatedImages: [
            {
              image: {
                imageBytes: Buffer.from('generated-png-data').toString('base64'),
              },
            },
          ],
        }),
        generateContent: vi.fn(),
      },
    };

    const onCard = vi.fn();
    const executor = new ImageGenerationExecutor(
      mockCfg,
      mockStorage,
      mockDb,
      'u1',
      'c1',
      'm1',
      onCard,
      fakeClient as any,
    );

    const result = await executor.execute(
      {
        id: 'call-2',
        name: 'generate_image',
        input: {
          prompt: 'A futuristic electric car in Tokyo at night',
          aspectRatio: '16:9',
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe('call-2');
    expect(mockStorage.put).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(onCard).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'generated-att-1',
        downloadUrl: '/api/files/generated-att-1/download',
        aspectRatio: '16:9',
      }),
    );
  });

  it('falls back to generateContent if generateImages fails or returns empty', async () => {
    const fakeClient = {
      models: {
        generateImages: vi.fn().mockRejectedValue(new Error('generateImages not supported')),
        generateContent: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: Buffer.from('candidate-image-bytes').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        }),
      },
    };

    const executor = new ImageGenerationExecutor(
      mockCfg,
      mockStorage,
      mockDb,
      'u1',
      'c1',
      'm1',
      undefined,
      fakeClient as any,
    );

    const result = await executor.execute(
      {
        id: 'call-3',
        name: 'generate_image',
        input: {
          prompt: 'Minimalist logo for an AI startup',
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe('call-3');
    const firstBlock = result.content[0];
    expect(firstBlock && firstBlock.type === 'text' && firstBlock.text).toContain('Generated image successfully');
  });
});
