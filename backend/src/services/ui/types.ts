/**
 * ArcNave Phase 6 Generative UI Types (UIResponseV1).
 *
 * Defines the canonical typed blocks for structured conversational presentation.
 * Blocks are validated on the server via Zod before streaming or persistence.
 */

export interface ProvenanceRef {
  /** The canonical UUID of the persisted analysis result. */
  analysisResultId: string;
  /** Optional display version number of the dataset. */
  datasetVersion?: number;
  /** Methodology or formula used for computation. */
  methodology?: string;
}

export type SafeAction =
  | { actionType: 'open_artifact'; artifactId: string }
  | { actionType: 'view_source'; sourceRef: string }
  | { actionType: 'filter_view'; filterKey: string; filterValue: string | number | boolean };

/* -------------------------------------------------------------------------- Individual Blocks */

export interface BaseBlock {
  /** Stable identifier for stream deduplication and idempotency. */
  blockId: string;
  /** 1-based sequence order within the response. */
  sequence: number;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  text: string;
}

export interface TableColumn {
  key: string;
  label: string;
  valueType?: 'text' | 'number' | 'currency' | 'percentage' | 'date';
  align?: 'left' | 'center' | 'right';
}

export interface TableRowCell {
  raw: unknown;
  display?: string;
}

export interface TableBlock extends BaseBlock {
  type: 'table';
  title?: string;
  columns: TableColumn[];
  rows: Array<Record<string, unknown | TableRowCell>>;
  pagination?: { pageSize: number };
  sortable?: boolean;
  filterable?: boolean;
  provenance?: ProvenanceRef;
}

export interface MetricDelta {
  value: number | string;
  direction: 'up' | 'down' | 'flat';
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface MetricBlock extends BaseBlock {
  type: 'metric';
  label: string;
  value: string | number;
  unit?: string;
  secondaryText?: string;
  delta?: MetricDelta;
  trend?: string;
  provenance?: ProvenanceRef;
}

export type ChartType = 'line' | 'bar' | 'area' | 'scatter' | 'pie' | 'donut';

export interface ChartSeries {
  field: string;
  label?: string;
  color?: string;
}

export interface ChartBlock extends BaseBlock {
  type: 'chart';
  chartType: ChartType;
  title?: string;
  description?: string;
  x: {
    field: string;
    label?: string;
    type?: 'category' | 'time' | 'numeric';
  };
  series: ChartSeries[];
  data: Array<Record<string, unknown>>;
  stacked?: boolean;
  provenance?: ProvenanceRef;
}

export interface ComparisonItem {
  id: string;
  name: string;
  badge?: string;
}

export interface ComparisonAttribute {
  key: string;
  label: string;
  category?: string;
}

export interface ComparisonBlock extends BaseBlock {
  type: 'comparison';
  title?: string;
  items: ComparisonItem[];
  attributes: ComparisonAttribute[];
  matrix: Record<string, Record<string, string | number | boolean>>;
  notes?: string[];
}

export interface TimelineEvent {
  id?: string;
  dateOrPeriod: string;
  title: string;
  description?: string;
  status?: 'completed' | 'in_progress' | 'upcoming' | 'blocked';
  sourceRef?: string;
}

export interface TimelineBlock extends BaseBlock {
  type: 'timeline';
  title?: string;
  events: TimelineEvent[];
}

export interface StepItem {
  index: number;
  title: string;
  description?: string;
  status: 'pending' | 'active' | 'complete' | 'blocked';
  codeSnippet?: string;
}

export interface StepsBlock extends BaseBlock {
  type: 'steps';
  title?: string;
  steps: StepItem[];
}

export interface CardItem {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  metadata?: Record<string, string>;
  imageRef?: string;
  action?: SafeAction;
}

export interface CardsBlock extends BaseBlock {
  type: 'cards';
  title?: string;
  layout?: 'grid' | 'list';
  cards: CardItem[];
}

export interface SourceItem {
  sourceRef: string;
  title?: string;
  publisher?: string;
  url?: string;
  date?: string;
  context?: string;
}

export interface SourcesBlock extends BaseBlock {
  type: 'sources';
  title?: string;
  sources: SourceItem[];
}

export type DashboardChildBlock =
  | TextBlock
  | TableBlock
  | MetricBlock
  | ChartBlock
  | ComparisonBlock;

export interface DashboardFilter {
  key: string;
  label: string;
  type: 'category' | 'date_range' | 'numeric_range';
  options?: string[];
}

export interface DashboardBlock extends BaseBlock {
  type: 'dashboard';
  title?: string;
  layout: '1col' | '2col' | '3col' | 'grid';
  blocks: DashboardChildBlock[];
  filters?: DashboardFilter[];
}

/**
 * Model-written HTML, drawn only inside the client's script-only sandbox (ADR-0035). `html` is
 * absent in the tool result sent back to the model, which gets `htmlBytes` instead.
 */
export interface VisualBlock extends BaseBlock {
  type: 'visual';
  title: string;
  html?: string;
  htmlBytes?: number;
}

/**
 * A display card (ADR-0048): the client draws `tool`'s card from `data`, the call's arguments
 * with any photos the server added. Its `blockId` is `display_<toolCallId>`, so a reload finds
 * the same block from the stored call.
 */
export interface DisplayBlock extends BaseBlock {
  type: 'display';
  tool: string;
  data: Record<string, unknown>;
}

export type UIBlock =
  | DisplayBlock
  | TextBlock
  | TableBlock
  | MetricBlock
  | ChartBlock
  | ComparisonBlock
  | TimelineBlock
  | StepsBlock
  | CardsBlock
  | SourcesBlock
  | DashboardBlock
  | VisualBlock;

export interface UIResponseV1 {
  schemaVersion: 1;
  blocks: UIBlock[];
}
