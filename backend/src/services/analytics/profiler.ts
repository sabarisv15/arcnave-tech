/**
 * ArcNave Phase 7 Tabular Data Profiler.
 *
 * Infers column data types, computes robust summary statistics (min, max, mean,
 * median, quartiles, IQR, outlier counts), and profiles completeness.
 *
 * CRITICAL INVARIANT: Zero raw data rows are stored into Postgres metadata.
 * Only aggregated column profiles and quality metrics are persisted.
 */

import type { ColumnProfile, ColumnType, NumericStats } from './types.js';

export interface ProfiledDataset {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
}

/**
 * Fast robust CSV row parser respecting quoted fields with commas and escaped quotes.
 */
export function parseCSV(csvContent: string): { headers: string[]; rows: string[][] } {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i];
    const nextChar = csvContent[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++; // skip escaped quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        // ignore carriage return
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          lines.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      lines.push(currentRow);
    }
  }

  if (lines.length === 0 || !lines[0]) {
    return { headers: [], rows: [] };
  }

  const headers = lines[0].map((h, idx) => h || `col_${idx + 1}`);
  const rows = lines.slice(1);
  return { headers, rows };
}

/**
 * Profiles tabular data from parsed headers and string rows.
 */
export function profileTabularData(headers: string[], rows: string[][]): ProfiledDataset {
  const rowCount = rows.length;
  const columnCount = headers.length;

  if (rowCount === 0 || columnCount === 0) {
    return {
      rowCount,
      columnCount,
      columns: headers.map((name) => ({
        name,
        type: 'text',
        nullable: true,
        nullCount: 0,
        nullPct: 0,
        uniqueCount: 0,
      })),
    };
  }

  const columns: ColumnProfile[] = headers.map((name, colIdx) => {
    const values: string[] = [];
    let nullCount = 0;

    for (let r = 0; r < rowCount; r++) {
      const row = rows[r];
      const val = row ? row[colIdx] : undefined;
      if (val === undefined || val === null || val === '' || val.toLowerCase() === 'null' || val.toLowerCase() === 'nan' || val.toLowerCase() === 'na') {
        nullCount++;
      } else {
        values.push(val);
      }
    }

    const nullPct = Number(((nullCount / rowCount) * 100).toFixed(2));
    const distinctSet = new Set(values);
    const uniqueCount = distinctSet.size;

    // Type inference
    const type = inferColumnType(values);

    // Compute sample distinct values (sanitized, truncated, strictly <= 5 items)
    const sampleDistinctValues: string[] = Array.from(distinctSet)
      .slice(0, 5)
      .map((v) => (v.length > 30 ? v.slice(0, 27) + '...' : v));

    let stats: NumericStats | undefined;
    if (type === 'integer' || type === 'float') {
      const numericValues = values
        .map((v) => Number(v.replace(/,/g, '')))
        .filter((n) => !isNaN(n) && isFinite(n));

      if (numericValues.length > 0) {
        stats = computeNumericStats(numericValues);
      }
    }

    return {
      name,
      type,
      nullable: nullCount > 0,
      nullCount,
      nullPct,
      uniqueCount,
      sampleDistinctValues: sampleDistinctValues.length > 0 ? sampleDistinctValues : undefined,
      stats,
    };
  });

  return {
    rowCount,
    columnCount,
    columns,
  };
}

/**
 * Infer the semantic/storage type of a column from non-null string values.
 */
export function inferColumnType(values: string[]): ColumnType {
  if (values.length === 0) return 'text';

  let intCount = 0;
  let floatCount = 0;
  let boolCount = 0;
  let dateCount = 0;

  const total = values.length;

  for (const raw of values) {
    const v = raw.trim();
    const lower = v.toLowerCase();

    // Check boolean
    if (lower === 'true' || lower === 'false') {
      boolCount++;
      continue;
    }

    // Check integer (e.g. 123, -45)
    if (/^-?\d+$/.test(v)) {
      intCount++;
      continue;
    }

    // Check float (e.g. 123.45, -0.01)
    if (/^-?\d*\.\d+$/.test(v) && !isNaN(Number(v))) {
      floatCount++;
      continue;
    }

    // Check date (e.g. 2026-09-20, 2026/09/20, ISO format)
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(v) || /^\d{2}[-/]\d{2}[-/]\d{4}/.test(v)) {
      const timestamp = Date.parse(v);
      if (!isNaN(timestamp)) {
        dateCount++;
        continue;
      }
    }
  }

  if (boolCount / total >= 0.9) return 'boolean';
  if (intCount / total >= 0.9) return 'integer';
  if ((intCount + floatCount) / total >= 0.9) return 'float';
  if (dateCount / total >= 0.9) return 'date';

  const distinctCount = new Set(values).size;
  const avgLen = values.reduce((acc, v) => acc + v.length, 0) / total;
  if (distinctCount <= 20 && distinctCount < total && avgLen <= 30) {
    return 'categorical';
  }

  return 'text';
}

/**
 * Compute robust summary statistics for numeric columns:
 * min, max, mean, median, standard deviation, quartiles, IQR, and outlier counts.
 */
export function computeNumericStats(numbers: number[]): NumericStats {
  const count = numbers.length;
  if (count === 0) {
    return {
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      stdDev: 0,
      q25: 0,
      q75: 0,
      iqr: 0,
      outlierCount: 0,
    };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[count - 1] ?? 0;
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = Number((sum / count).toFixed(4));

  const getPercentile = (p: number): number => {
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    const valBase = sorted[base];
    const valNext = sorted[base + 1];
    if (valBase !== undefined && valNext !== undefined) {
      return Number((valBase + rest * (valNext - valBase)).toFixed(4));
    }
    return valBase ?? 0;
  };

  const median = getPercentile(0.5);
  const q25 = getPercentile(0.25);
  const q75 = getPercentile(0.75);
  const iqr = Number((q75 - q25).toFixed(4));

  // Sample standard deviation
  const variance = count > 1
    ? sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (count - 1)
    : 0;
  const stdDev = Number(Math.sqrt(variance).toFixed(4));

  // Tukey's fences for outliers: [Q1 - 1.5*IQR, Q3 + 1.5*IQR]
  const lowerFence = q25 - 1.5 * iqr;
  const upperFence = q75 + 1.5 * iqr;
  let outlierCount = 0;
  for (const val of sorted) {
    if (val < lowerFence || val > upperFence) {
      outlierCount++;
    }
  }

  // Pearson's coefficient of skewness: 3 * (mean - median) / stdDev
  const skewness = stdDev > 0 ? Number(((3 * (mean - median)) / stdDev).toFixed(4)) : 0;

  return {
    min,
    max,
    mean,
    median,
    stdDev,
    q25,
    q75,
    iqr,
    skewness,
    outlierCount,
  };
}
