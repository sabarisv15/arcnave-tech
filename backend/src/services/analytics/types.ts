/**
 * ArcNave Phase 7 Analytics Types.
 *
 * Types for automated data profiling, data quality reporting,
 * dataset version lineage, and durable computation provenance.
 */

export type ColumnType =
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'categorical'
  | 'text';

export interface NumericStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  q25: number;
  q75: number;
  iqr: number;
  skewness?: number;
  outlierCount: number;
}

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  nullable: boolean;
  nullCount: number;
  nullPct: number;
  uniqueCount: number;
  /** Representative distinct values (sanitized, truncated, strictly <= 5 items). */
  sampleDistinctValues?: string[];
  /** Populated only for integer and float columns. */
  stats?: NumericStats;
}

export interface DataQualityIssue {
  column?: string;
  issueType: 'null_values' | 'outliers' | 'duplicates' | 'type_mismatch' | 'cardinality';
  severity: 'info' | 'warning' | 'critical';
  description: string;
  recommendation?: string;
}

export interface DataQualityReport {
  /** Overall quality score between 0 and 100. */
  score: number;
  totalRows: number;
  totalColumns: number;
  duplicateRowCount: number;
  issues: DataQualityIssue[];
  summary: string;
}
