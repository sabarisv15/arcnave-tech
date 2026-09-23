import { z } from 'zod';

export const ValueFormatSchema = z.object({
  numberFormat: z.string().optional(),
  currency: z.string().optional(),
  percentage: z.boolean().optional(),
  locale: z.string().optional(),
  styleHint: z.record(z.string(), z.unknown()).optional(),
});

export type ValueFormat = z.infer<typeof ValueFormatSchema>;

/**
 * Standard typed value schema.
 * Explicitly separates strings, numbers, integers, booleans, dates, datetimes, formulas, and nulls.
 * JSON lacks native Date and Formula types, so explicit typing prevents string loss/ambiguity.
 */
export const TypedValueSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('string'),
    value: z.string(),
    format: z.union([ValueFormatSchema, z.string()]).optional(),
    styleHint: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('number'),
    value: z.number(),
    format: z.union([ValueFormatSchema, z.string()]).optional(),
    currency: z.string().optional(),
    percentage: z.boolean().optional(),
    locale: z.string().optional(),
    styleHint: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('integer'),
    value: z.number().int(),
    format: z.union([ValueFormatSchema, z.string()]).optional(),
    currency: z.string().optional(),
    locale: z.string().optional(),
    styleHint: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('boolean'),
    value: z.boolean(),
    styleHint: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('date'),
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD'),
    format: z.union([ValueFormatSchema, z.string()]).optional(),
    styleHint: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('datetime'),
    value: z.string().datetime({ message: 'Datetime must be ISO 8601 string' }),
    format: z.union([ValueFormatSchema, z.string()]).optional(),
    styleHint: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('formula'),
    value: z.string().min(1),
    format: z.union([ValueFormatSchema, z.string()]).optional(),
    styleHint: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('null'),
    value: z.null(),
    styleHint: z.record(z.string(), z.unknown()).optional(),
  }),
]);

export type TypedValue = z.infer<typeof TypedValueSchema>;

/**
 * Standard source reference for traceability, debugging, and semantic reconciliation.
 */
export const SourceReferenceSchema = z.object({
  attachmentId: z.string().min(1),
  page: z.number().int().positive().optional(),
  sheet: z.string().optional(),
  slide: z.number().int().positive().optional(),
  section: z.union([z.string(), z.number().int()]).optional(),
  table: z.union([z.string(), z.number().int()]).optional(),
  row: z.number().int().optional(),
  column: z.union([z.string(), z.number().int()]).optional(),
  region: z.string().optional(),
  extractionMethod: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type SourceReference = z.infer<typeof SourceReferenceSchema>;

/**
 * Standard warning contract across all file skills.
 */
export const DeliverableWarningSchema = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  type: z.string().min(1),
  message: z.string().min(1),
  source: SourceReferenceSchema.optional(),
  repairable: z.boolean().optional(),
});

export type DeliverableWarning = z.infer<typeof DeliverableWarningSchema>;

/**
 * Standard visual defect schema representing observable layout, clipping, and rendering defects.
 */
export const VisualDefectSchema = z.object({
  type: z.string().min(1),
  location: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().min(1),
  repairable: z.boolean().default(true),
});

export type VisualDefect = z.infer<typeof VisualDefectSchema>;

/**
 * Common operation result shape for file operations.
 * Important: does NOT expose raw filesystem or container paths to the model.
 * Extended additively in Batch 5 with structural, semantic, and visual QA sections.
 */
export const CommonOperationResultSchema = z.object({
  status: z.enum(['success', 'warning', 'failed']),
  summary: z.record(z.string(), z.unknown()),
  structural: z
    .object({
      passed: z.boolean(),
      errors: z.array(z.string()),
      warnings: z.array(z.string()).optional(),
      metrics: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  semantic: z
    .object({
      passed: z.boolean(),
      warnings: z.array(DeliverableWarningSchema).default([]),
      metrics: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  visual: z
    .object({
      passed: z.boolean(),
      defects: z.array(VisualDefectSchema).default([]),
      previewAvailable: z.boolean().default(false),
      inspectedPages: z.number().int().nonnegative().optional(),
      inspectedSlides: z.number().int().nonnegative().optional(),
      inspectedSheets: z.number().int().nonnegative().optional(),
      diagnostics: z.array(z.string()).optional(),
    })
    .optional(),
  outputs: z
    .array(
      z.object({
        fileRef: z.string().optional(),
        attachmentId: z.string().optional(),
        filename: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  warnings: z.array(DeliverableWarningSchema).optional(),
  repairable: z.boolean().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  intermediateRefs: z.array(z.string()).optional(),
});

export type CommonOperationResult = z.infer<typeof CommonOperationResultSchema>;

/**
 * Intermediate artifact reference schema.
 * Represents an opaque or workspace-relative reference (e.g. "artifact_a1b2c3d4" or "temp/chunk-001.json").
 */
export const IntermediateArtifactRefSchema = z.object({
  artifactRef: z.string().min(1),
});

export type IntermediateArtifactRef = z.infer<typeof IntermediateArtifactRefSchema>;
