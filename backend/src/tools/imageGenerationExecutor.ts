/**
 * Image Generation & Editing Tool Executor.
 *
 * Calls Vertex AI Gemini image generation models using the modern hierarchy:
 * - Primary: gemini-3.1-flash-image (Vertex AI GA image model for low-latency generation and editing)
 * - Fallback: gemini-3.1-flash-lite-image
 * - Quality: gemini-3-pro-image
 *
 * Supports both text-to-image and image editing / restyling.
 */
import { GoogleGenAI } from '@google/genai';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { attachments } from '../db/schema.js';
import { logger } from '../logger.js';
import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import { generateStorageKey, type ObjectStorage } from '../services/storage.js';

const log = logger.child({ module: 'tool:generate_image' });

const inputSchema = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).default('1:1'),
  sourceImageAttachmentId: z.string().uuid().optional(),
});

export interface ImageCardDto {
  attachmentId: string;
  filename: string;
  mimeType: string;
  downloadUrl: string;
  prompt: string;
  aspectRatio: string;
}

export class ImageGenerationExecutor implements ToolExecutor {
  private client?: GoogleGenAI;

  constructor(
    private readonly cfg: Config,
    private readonly storage: ObjectStorage,
    private readonly db: Database,
    private readonly userId: string,
    private readonly chatId: string,
    private readonly assistantMessageId: string,
    private readonly onImageGenerated?: (card: ImageCardDto) => void,
    private readonly injectedClient?: Pick<GoogleGenAI, 'models'>,
  ) {}

  private getClient(): Pick<GoogleGenAI, 'models'> {
    if (this.injectedClient) return this.injectedClient;
    if (!this.client) {
      if (!this.cfg.GOOGLE_CLOUD_PROJECT) {
        throw new Error('GOOGLE_CLOUD_PROJECT is not configured');
      }
      this.client = new GoogleGenAI({
        vertexai: true,
        project: this.cfg.GOOGLE_CLOUD_PROJECT,
        location: this.cfg.geminiLocation,
      });
    }
    return this.client;
  }

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (call.name !== 'generate_image') {
      return {
        toolCallId: call.id,
        ok: false,
        content: [{ type: 'text', text: `Unknown tool: ${call.name}` }],
      };
    }

    const parsed = inputSchema.safeParse(call.input);
    if (!parsed.success) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [
          {
            type: 'text',
            text: `Invalid arguments for generate_image: ${parsed.error.message}`,
          },
        ],
      };
    }

    const { prompt, aspectRatio, sourceImageAttachmentId } = parsed.data;

    let sourceImageBuffer: Buffer | undefined;
    let sourceMimeType = 'image/png';
    if (sourceImageAttachmentId) {
      const [sourceRow] = await this.db
        .select({
          storageKey: attachments.storageKey,
          mimeType: attachments.mimeType,
          userId: attachments.userId,
        })
        .from(attachments)
        .where(
          and(
            eq(attachments.id, sourceImageAttachmentId),
            eq(attachments.userId, this.userId),
          ),
        )
        .limit(1);

      if (!sourceRow) {
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            {
              type: 'text',
              text: `Source image attachment ${sourceImageAttachmentId} was not found.`,
            },
          ],
        };
      }
      sourceImageBuffer = await this.storage.get(sourceRow.storageKey);
      sourceMimeType = sourceRow.mimeType;
    }

    // Modern Gemini Image Hierarchy
    const isQuality =
      prompt.toLowerCase().includes('photorealistic') ||
      prompt.toLowerCase().includes('ultra high quality') ||
      prompt.toLowerCase().includes('studio quality');
    const modelCandidates = isQuality
      ? ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image']
      : ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image'];

    let imageBytes: Buffer | null = null;
    let successfulModel = '';
    let lastError: unknown;

    for (const modelId of modelCandidates) {
      if (signal.aborted) break;
      try {
        log.info({ modelId, prompt, isEdit: Boolean(sourceImageBuffer) }, 'attempting image generation');
        const client = this.getClient();

        // 1. Try generateImages if available on the SDK client
        if (typeof (client.models as any).generateImages === 'function') {
          try {
            const response = await (client.models as any).generateImages({
              model: modelId,
              prompt,
              config: {
                numberOfImages: 1,
                aspectRatio,
                outputMimeType: 'image/png',
                abortSignal: signal,
              },
            });
            const base64 = response.generatedImages?.[0]?.image?.imageBytes;
            if (base64) {
              imageBytes = Buffer.from(base64, 'base64');
              successfulModel = modelId;
              break;
            }
          } catch (genImagesErr) {
            log.debug({ modelId, err: String(genImagesErr) }, 'generateImages failed, falling back to generateContent');
          }
        }

        // 2. Try generateContent with multimodal content (supported for gemini-3.1-flash-image)
        const parts: any[] = [];
        if (sourceImageBuffer) {
          parts.push({
            inlineData: {
              mimeType: sourceMimeType,
              data: sourceImageBuffer.toString('base64'),
            },
          });
        }
        parts.push({ text: `Generate image: ${prompt} with aspect ratio ${aspectRatio}` });

        const response = await client.models.generateContent({
          model: modelId,
          contents: [{ role: 'user', parts }],
          config: {
            abortSignal: signal,
            httpOptions: { timeout: 25_000 },
          },
        });

        // Search response candidates for inline image data
        const candidates = (response as any).candidates ?? [];
        for (const cand of candidates) {
          const contentParts = cand.content?.parts ?? [];
          for (const p of contentParts) {
            if (p.inlineData?.data) {
              imageBytes = Buffer.from(p.inlineData.data, 'base64');
              successfulModel = modelId;
              break;
            }
          }
          if (imageBytes) break;
        }

        if (imageBytes) {
          break;
        }
      } catch (err) {
        lastError = err;
        log.warn({ modelId, err: String(err) }, 'image generation candidate failed, trying fallback');
      }
    }

    if (!imageBytes) {
      return {
        toolCallId: call.id,
        ok: false,
        content: [
          {
            type: 'text',
            text: `Image generation failed: ${lastError instanceof Error ? lastError.message : 'No image produced by Gemini Image models'}.`,
          },
        ],
      };
    }

    // Persist generated image to Storage and Database
    const storageKey = generateStorageKey(this.userId);
    await this.storage.put(storageKey, imageBytes, 'image/png');

    const [created] = await this.db
      .insert(attachments)
      .values({
        userId: this.userId,
        messageId: this.assistantMessageId,
        filename: `generated_image_${Date.now()}.png`,
        mimeType: 'image/png',
        sizeBytes: imageBytes.length,
        storageKey,
        status: 'ready',
        error: '',
        extractedText: null,
      })
      .returning();

    const card: ImageCardDto = {
      attachmentId: created!.id,
      filename: created!.filename,
      mimeType: 'image/png',
      downloadUrl: `/files/${created!.id}/download`,
      prompt,
      aspectRatio,
    };

    if (this.onImageGenerated) {
      this.onImageGenerated(card);
    }

    return {
      toolCallId: call.id,
      ok: true,
      content: [
        {
          type: 'text',
          text: `Generated image successfully using ${successfulModel}: [Download / View Image](${card.downloadUrl})`,
        },
        {
          type: 'json',
          data: card,
        },
      ],
    };
  }
}
