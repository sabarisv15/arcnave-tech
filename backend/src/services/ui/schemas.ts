/**
 * ArcNave Phase 6 Generative UI Zod Schemas.
 *
 * Enforces strict validation, payload ceilings, non-recursive dashboards,
 * safe action allowlists, and inert-code security rules.
 */
import { z } from 'zod';
import type {
  ChartType,
  DashboardChildBlock,
  ProvenanceRef,
  SafeAction,
  UIBlock,
  UIResponseV1,
} from './types.js';

/* -------------------------------------------------------------------------- Security Helpers */

/**
 * Checks for prohibited executable patterns (e.g. `<script>`, `javascript:`, `on<event>=`).
 * Code snippets (e.g. JavaScript text inside fenced blocks or string literals) are allowed as inert text.
 */
const noScriptInjection = (val: string): boolean => {
  const lower = val.toLowerCase();
  if (lower.includes('<script') || lower.includes('</script>')) return false;
  if (/\bjavascript:\s*/i.test(lower)) return false;
  if (/\bon[a-z]+\s*=\s*['"][^'"]*['"]/i.test(lower)) return false;
  return true;
};

const safeString = (max: number = 2000) =>
  z
    .string()
    .max(max)
    .refine(noScriptInjection, {
      message: 'Executable script or event handler syntax is strictly prohibited.',
    });

/* -------------------------------------------------------------------------- Common Schemas */

export const provenanceRefSchema: z.ZodType<ProvenanceRef> = z.object({
  analysisResultId: z.string().uuid(),
  datasetVersion: z.number().int().positive().optional(),
  methodology: safeString(500).optional(),
});

export const safeActionSchema: z.ZodType<SafeAction> = z.discriminatedUnion('actionType', [
  z.object({
    actionType: z.literal('open_artifact'),
    artifactId: z.string().uuid(),
  }),
  z.object({
    actionType: z.literal('view_source'),
    sourceRef: safeString(120),
  }),
  z.object({
    actionType: z.literal('filter_view'),
    filterKey: safeString(64),
    filterValue: z.union([z.string().max(120), z.number(), z.boolean()]),
  }),
]);

const baseBlockSchema = {
  blockId: z.string().min(1).max(64),
  sequence: z.number().int().positive(),
};

/* -------------------------------------------------------------------------- Block Schemas */

export const textBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('text'),
  text: safeString(20_000),
});

export const tableColumnSchema = z.object({
  key: safeString(64),
  label: safeString(120),
  valueType: z.enum(['text', 'number', 'currency', 'percentage', 'date']).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
});

export const tableRowCellSchema = z.object({
  raw: z.unknown(),
  display: safeString(200).optional(),
});

export const tableBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('table'),
  title: safeString(200).optional(),
  columns: z.array(tableColumnSchema).min(1).max(30),
  rows: z.array(z.record(z.string().max(64), z.union([tableRowCellSchema, z.unknown()]))).max(500),
  pagination: z.object({ pageSize: z.number().int().min(5).max(100) }).optional(),
  sortable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  provenance: provenanceRefSchema.optional(),
});

export const metricDeltaSchema = z.object({
  value: z.union([z.number(), safeString(64)]),
  direction: z.enum(['up', 'down', 'flat']),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
});

export const metricBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('metric'),
  label: safeString(120),
  value: z.union([z.number(), safeString(64)]),
  unit: safeString(32).optional(),
  secondaryText: safeString(200).optional(),
  delta: metricDeltaSchema.optional(),
  trend: safeString(120).optional(),
  provenance: provenanceRefSchema.optional(),
});

export const chartSeriesSchema = z.object({
  field: safeString(64),
  label: safeString(120).optional(),
  color: safeString(32).optional(),
});

export const chartBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('chart'),
  chartType: z.enum(['line', 'bar', 'area', 'scatter', 'pie', 'donut']) as z.ZodType<ChartType>,
  title: safeString(200).optional(),
  description: safeString(500).optional(),
  x: z.object({
    field: safeString(64),
    label: safeString(120).optional(),
    type: z.enum(['category', 'time', 'numeric']).optional(),
  }),
  series: z.array(chartSeriesSchema).min(1).max(10),
  data: z.array(z.record(z.string().max(64), z.unknown())).min(1).max(200),
  stacked: z.boolean().optional(),
  provenance: provenanceRefSchema.optional(),
});

export const comparisonItemSchema = z.object({
  id: safeString(64),
  name: safeString(120),
  badge: safeString(64).optional(),
});

export const comparisonAttributeSchema = z.object({
  key: safeString(64),
  label: safeString(120),
  category: safeString(64).optional(),
});

export const comparisonBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('comparison'),
  title: safeString(200).optional(),
  items: z.array(comparisonItemSchema).min(2).max(10),
  attributes: z.array(comparisonAttributeSchema).min(1).max(25),
  matrix: z.record(
    z.string().max(64),
    z.record(z.string().max(64), z.union([safeString(500), z.number(), z.boolean()])),
  ),
  notes: z.array(safeString(500)).max(10).optional(),
});

export const timelineEventSchema = z.object({
  id: safeString(64).optional(),
  dateOrPeriod: safeString(120),
  title: safeString(200),
  description: safeString(1000).optional(),
  status: z.enum(['completed', 'in_progress', 'upcoming', 'blocked']).optional(),
  sourceRef: safeString(120).optional(),
});

export const timelineBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('timeline'),
  title: safeString(200).optional(),
  events: z.array(timelineEventSchema).min(1).max(30),
});

export const stepItemSchema = z.object({
  index: z.number().int().positive(),
  title: safeString(200),
  description: safeString(1000).optional(),
  status: z.enum(['pending', 'active', 'complete', 'blocked']),
  codeSnippet: safeString(2000).optional(),
});

export const stepsBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('steps'),
  title: safeString(200).optional(),
  steps: z.array(stepItemSchema).min(1).max(20),
});

export const cardItemSchema = z.object({
  id: safeString(64),
  title: safeString(200),
  subtitle: safeString(200).optional(),
  description: safeString(1000).optional(),
  metadata: z.record(z.string().max(64), safeString(200)).optional(),
  imageRef: safeString(200).optional(),
  action: safeActionSchema.optional(),
});

export const cardsBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('cards'),
  title: safeString(200).optional(),
  layout: z.enum(['grid', 'list']).optional(),
  cards: z.array(cardItemSchema).min(1).max(20),
});

export const sourceItemSchema = z.object({
  sourceRef: safeString(120),
  title: safeString(200).optional(),
  publisher: safeString(120).optional(),
  url: safeString(500).optional(),
  date: safeString(64).optional(),
  context: safeString(500).optional(),
});

export const sourcesBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('sources'),
  title: safeString(200).optional(),
  sources: z.array(sourceItemSchema).min(1).max(20),
});

/* -------------------------------------------------------------------------- Dashboard (Non-Recursive) */

export const dashboardChildBlockSchema: z.ZodType<DashboardChildBlock> = z.discriminatedUnion('type', [
  textBlockSchema,
  tableBlockSchema,
  metricBlockSchema,
  chartBlockSchema,
  comparisonBlockSchema,
]);

export const dashboardFilterSchema = z.object({
  key: safeString(64),
  label: safeString(120),
  type: z.enum(['category', 'date_range', 'numeric_range']),
  options: z.array(safeString(120)).max(50).optional(),
});

export const dashboardBlockSchema = z.object({
  ...baseBlockSchema,
  type: z.literal('dashboard'),
  title: safeString(200).optional(),
  layout: z.enum(['1col', '2col', '3col', 'grid']),
  blocks: z.array(dashboardChildBlockSchema).min(1).max(8),
  filters: z.array(dashboardFilterSchema).max(5).optional(),
});

/* -------------------------------------------------------------------------- Union & Response */

export const uiBlockSchema: z.ZodType<UIBlock> = z.discriminatedUnion('type', [
  textBlockSchema,
  tableBlockSchema,
  metricBlockSchema,
  chartBlockSchema,
  comparisonBlockSchema,
  timelineBlockSchema,
  stepsBlockSchema,
  cardsBlockSchema,
  sourcesBlockSchema,
  dashboardBlockSchema,
]);

export const uiResponseV1Schema: z.ZodType<UIResponseV1> = z.object({
  schemaVersion: z.literal(1),
  blocks: z.array(uiBlockSchema).min(1).max(12),
});

/* -------------------------------------------------------------------------- Provider-Safe Tool Schema */

/**
 * Generates a provider-safe JSON Schema describing the discriminated union of UI blocks.
 * Used in ToolDefinition for render_ui so models understand supported structures upfront.
 */
export function getProviderSafeUISchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        description: 'Ordered list of structured UI blocks to render (max 12 blocks).',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: [
                'text',
                'table',
                'metric',
                'chart',
                'comparison',
                'timeline',
                'steps',
                'cards',
                'sources',
                'dashboard',
              ],
              description: 'The discriminator type of the UI block.',
            },
            title: { type: 'string', description: 'Optional title heading for the block.' },
            text: { type: 'string', description: 'Markdown content (for text blocks).' },
            columns: {
              type: 'array',
              description: 'Table column specifications with key, label, valueType, and align.',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  label: { type: 'string' },
                  valueType: { type: 'string', enum: ['text', 'number', 'currency', 'percentage', 'date'] },
                  align: { type: 'string', enum: ['left', 'center', 'right'] },
                },
                required: ['key', 'label'],
              },
            },
            rows: {
              type: 'array',
              description: 'Table row data objects mapped by column key.',
              items: { type: 'object' },
            },
            label: { type: 'string', description: 'KPI metric label (e.g. Monthly Revenue).' },
            value: { description: 'Primary KPI value (number or formatted string).' },
            unit: { type: 'string', description: 'Unit descriptor (e.g. USD, ms, %).' },
            delta: {
              type: 'object',
              properties: {
                value: { description: 'Delta amount or percentage.' },
                direction: { type: 'string', enum: ['up', 'down', 'flat'] },
                sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
              },
              required: ['value', 'direction', 'sentiment'],
            },
            chartType: {
              type: 'string',
              enum: ['line', 'bar', 'area', 'scatter', 'pie', 'donut'],
              description: 'Visualization chart type.',
            },
            x: {
              type: 'object',
              properties: {
                field: { type: 'string', description: 'Data field for X-axis.' },
                label: { type: 'string', description: 'X-axis label.' },
                type: { type: 'string', enum: ['category', 'time', 'numeric'] },
              },
              required: ['field'],
            },
            series: {
              type: 'array',
              description: 'Data series definitions with field names and colors.',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  label: { type: 'string' },
                  color: { type: 'string' },
                },
                required: ['field'],
              },
            },
            data: {
              type: 'array',
              description: 'Semantic chart data points array.',
              items: { type: 'object' },
            },
            items: {
              type: 'array',
              description: 'Comparison items to evaluate side-by-side.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  badge: { type: 'string' },
                },
                required: ['id', 'name'],
              },
            },
            attributes: {
              type: 'array',
              description: 'Comparison attributes/criteria.',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  label: { type: 'string' },
                  category: { type: 'string' },
                },
                required: ['key', 'label'],
              },
            },
            matrix: {
              type: 'object',
              description: 'Comparison matrix indexed by item ID and attribute key.',
            },
            events: {
              type: 'array',
              description: 'Timeline events with dateOrPeriod, title, and status.',
              items: {
                type: 'object',
                properties: {
                  dateOrPeriod: { type: 'string' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  status: { type: 'string', enum: ['completed', 'in_progress', 'upcoming', 'blocked'] },
                },
                required: ['dateOrPeriod', 'title'],
              },
            },
            steps: {
              type: 'array',
              description: 'Ordered steps with index, title, status, and codeSnippet.',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  title: { type: 'string' },
                  description: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'active', 'complete', 'blocked'] },
                  codeSnippet: { type: 'string' },
                },
                required: ['index', 'title', 'status'],
              },
            },
            cards: {
              type: 'array',
              description: 'Collection of card items with title, subtitle, and metadata.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  subtitle: { type: 'string' },
                  description: { type: 'string' },
                  metadata: { type: 'object' },
                },
                required: ['id', 'title'],
              },
            },
            sources: {
              type: 'array',
              description: 'Trusted citation sources with sourceRef.',
              items: {
                type: 'object',
                properties: {
                  sourceRef: { type: 'string' },
                  title: { type: 'string' },
                  publisher: { type: 'string' },
                  url: { type: 'string' },
                },
                required: ['sourceRef'],
              },
            },
            layout: {
              type: 'string',
              enum: ['1col', '2col', '3col', 'grid'],
              description: 'Layout specification for dashboard blocks.',
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['blocks'],
    additionalProperties: false,
  };
}
