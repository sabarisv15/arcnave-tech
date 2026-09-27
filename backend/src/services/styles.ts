/**
 * ArcNave Style Presets & Custom Style Service.
 *
 * Implements WP-05 (Gap 18) per ADR-0033:
 * - 4 built-in presets: Normal, Concise, Explanatory, Formal.
 * - Resolves active style instructions for turn context.
 * - Synthesizes style instructions from 1-3 writing samples using an injectable provider.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { styles } from '../db/schema.js';
import { ApiError } from '../errors.js';
import type { Provider, ProviderUsage } from '../providers/types.js';
import { EMPTY_USAGE } from '../providers/types.js';

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

export const STYLE_PRESETS: readonly StylePreset[] = [
  {
    id: 'normal',
    name: 'Normal',
    description: 'Default workspace style',
    instructions: '',
  },
  {
    id: 'concise',
    name: 'Concise',
    description: 'Clear, direct, and compact answers with minimal elaboration',
    instructions:
      'Respond concisely. Deliver essential conclusions, direct answers, and code without unnecessary background, filler, or extended exposition.',
  },
  {
    id: 'explanatory',
    name: 'Explanatory',
    description: 'Detailed, concept-first explanations with helpful context and rationale',
    instructions:
      'Provide clear, well-structured explanations. Walk through key concepts, rationale, and background context so the answer is easy to understand and learn from.',
  },
  {
    id: 'formal',
    name: 'Formal',
    description: 'Polished, professional, and objective tone suited for workplace communication',
    instructions:
      'Use an objective, professional, and sophisticated tone. Ensure structured phrasing, precise vocabulary, and well-organized formatting suitable for executive and professional communication.',
  },
] as const;

export function getPresetStyle(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.id === id);
}

/**
 * Resolves style instructions for generation.
 * If styleId is empty or 'normal', returns empty instructions.
 * If styleId matches a preset, returns preset instructions.
 * If styleId is a UUID, checks user's custom styles.
 * Throws ApiError('style_not_found') if unknown or unowned.
 */
export async function resolveStyle(
  db: Database,
  userId: string,
  styleId?: string | null,
): Promise<{ id: string; name: string; instructions: string }> {
  const effectiveId = styleId?.trim() || 'normal';
  const preset = getPresetStyle(effectiveId);
  if (preset) {
    return { id: preset.id, name: preset.name, instructions: preset.instructions };
  }

  // Custom styles use UUID primary keys; non-UUID strings cannot match any row.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(effectiveId)) {
    throw new ApiError('style_not_found');
  }

  // Look up in database
  const [row] = await db
    .select({
      id: styles.id,
      name: styles.name,
      instructions: styles.instructions,
    })
    .from(styles)
    .where(and(eq(styles.id, effectiveId), eq(styles.userId, userId)));

  if (!row) {
    throw new ApiError('style_not_found');
  }

  return row;
}

/**
 * Summarizes 1 to 3 writing samples into concrete style instructions (<= 4000 characters).
 * Uses an injectable provider (faked in tests).
 */
export async function summarizeStyleSamples(
  provider: Provider,
  modelId: string,
  samples: string[],
  signal?: AbortSignal,
): Promise<{ instructions: string; usage: ProviderUsage }> {
  if (!samples || samples.length === 0 || samples.length > 3) {
    throw new ApiError('validation_error', {
      detail: 'Provide between 1 and 3 writing samples.',
    });
  }

  for (const sample of samples) {
    if (sample.length > 10_000) {
      throw new ApiError('sample_too_long');
    }
  }

  const sampleBlocks = samples
    .map((s, i) => `--- Writing Sample ${i + 1} ---\n${s.trim()}`)
    .join('\n\n');

  const systemInstruction =
    'You are an expert writing style analyst. Your job is to analyze the provided writing samples ' +
    "and synthesize concise, actionable style guidelines describing the author's voice, tone, " +
    'sentence structure, paragraph length, and vocabulary choices.\n\n' +
    'Rules:\n' +
    '- Describe HOW to write, not what topics to write about.\n' +
    '- Use direct, clear imperative instructions (e.g. "Use active voice", "Keep paragraphs under 3 sentences").\n' +
    '- Keep the total instructions under 4000 characters.\n' +
    '- Do not include pleasantries, preamble, or conversational filler.';

  const userTurnText =
    `Please analyze the following writing samples and extract their stylistic guidelines:\n\n${sampleBlocks}\n\n` +
    'Provide the extracted style instructions.';

  let accumulatedText = '';
  let finalUsage: ProviderUsage = { ...EMPTY_USAGE };

  for await (const event of provider.stream({
    prompt: userTurnText,
    history: [],
    systemInstruction,
    mode: 'chat',
    maxOutputTokens: 2048,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    signal: signal ?? new AbortController().signal,
  })) {
    if (event.type === 'delta') {
      accumulatedText += event.text;
    } else if (event.type === 'completed') {
      finalUsage = event.usage;
    }
  }

  const trimmed = accumulatedText.trim();
  const instructions = trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;

  return {
    instructions,
    usage: finalUsage,
  };
}
