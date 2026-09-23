import { z } from 'zod';
import { DeliverableWarningSchema, type DeliverableWarning } from './primitives.js';

export const UnitsProcessedSchema = z.object({
  pages: z.number().int().nonnegative().optional(),
  sheets: z.number().int().nonnegative().optional(),
  slides: z.number().int().nonnegative().optional(),
  sections: z.number().int().nonnegative().optional(),
  rows: z.number().int().nonnegative().optional(),
  tables: z.number().int().nonnegative().optional(),
});

export type UnitsProcessed = z.infer<typeof UnitsProcessedSchema>;

/**
 * Generic format-neutral SourceProfile.
 * Describes the processed sources, high-level unit counts, structure summary, warnings, and domain metadata.
 * Does NOT force spreadsheet-specific fields globally across all file types.
 */
export const SourceProfileSchema = z.object({
  attachmentIds: z.array(z.string()).min(1),
  sourceType: z.string().min(1),
  mimeTypes: z.array(z.string()),
  unitsProcessed: UnitsProcessedSchema.optional(),
  structure: z.record(z.string(), z.unknown()).optional(),
  warnings: z.array(DeliverableWarningSchema).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  domainMetadata: z.record(z.string(), z.unknown()).optional(),
});

export type SourceProfile = z.infer<typeof SourceProfileSchema>;
