/**
 * ArcNave Phase 7 Data Quality Evaluator.
 *
 * Assesses completeness, uniqueness, consistency, and statistical anomalies.
 * Produces an automated DataQualityReport with an overall score (0-100) and actionable advice.
 */

import type { ColumnProfile, DataQualityIssue, DataQualityReport } from './types.js';
import type { ProfiledDataset } from './profiler.js';

export function evaluateDataQuality(
  profile: ProfiledDataset,
  rawRows?: string[][],
): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  const { rowCount, columnCount, columns } = profile;

  if (rowCount === 0 || columnCount === 0) {
    return {
      score: 0,
      totalRows: rowCount,
      totalColumns: columnCount,
      duplicateRowCount: 0,
      issues: [
        {
          issueType: 'null_values',
          severity: 'critical',
          description: 'The dataset contains no rows or columns.',
          recommendation: 'Check file parsing or data extraction source.',
        },
      ],
      summary: 'Empty dataset: 0 rows and 0 columns.',
    };
  }

  let totalCells = rowCount * columnCount;
  let totalNulls = 0;

  // 1. Column-level quality analysis
  for (const col of columns) {
    totalNulls += col.nullCount;

    // High null percentage
    if (col.nullPct > 50) {
      issues.push({
        column: col.name,
        issueType: 'null_values',
        severity: col.nullPct > 80 ? 'critical' : 'warning',
        description: `Column "${col.name}" is missing ${col.nullPct}% of its values (${col.nullCount}/${rowCount} rows).`,
        recommendation: col.nullPct > 80
          ? 'Consider dropping this column or imputing with defaults.'
          : 'Inspect source data for systematic omission or collection errors.',
      });
    } else if (col.nullPct > 10) {
      issues.push({
        column: col.name,
        issueType: 'null_values',
        severity: 'info',
        description: `Column "${col.name}" has ${col.nullPct}% missing values.`,
        recommendation: 'Check if missing values are random or follow a pattern.',
      });
    }

    // High outlier ratio
    if (col.stats && col.stats.outlierCount > 0) {
      const outlierPct = (col.stats.outlierCount / rowCount) * 100;
      if (outlierPct > 5) {
        issues.push({
          column: col.name,
          issueType: 'outliers',
          severity: outlierPct > 15 ? 'warning' : 'info',
          description: `Column "${col.name}" contains ${col.stats.outlierCount} outliers (${outlierPct.toFixed(1)}% of rows) based on 1.5×IQR fences.`,
          recommendation: 'Verify if extreme values are data entry errors or genuine tail events.',
        });
      }
    }

    // Constant column (cardinality = 1)
    if (rowCount > 1 && col.uniqueCount === 1) {
      issues.push({
        column: col.name,
        issueType: 'cardinality',
        severity: 'info',
        description: `Column "${col.name}" has a single constant value across all rows.`,
        recommendation: 'Zero-variance features provide no analytical signal; consider dropping.',
      });
    }
  }

  // 2. Duplicate row detection (if rawRows provided)
  let duplicateRowCount = 0;
  if (rawRows && rawRows.length > 0) {
    const rowHashes = new Set<string>();
    for (const r of rawRows) {
      const rowKey = r.join('||');
      if (rowHashes.has(rowKey)) {
        duplicateRowCount++;
      } else {
        rowHashes.add(rowKey);
      }
    }

    if (duplicateRowCount > 0) {
      const dupPct = ((duplicateRowCount / rowCount) * 100).toFixed(1);
      issues.push({
        issueType: 'duplicates',
        severity: duplicateRowCount > rowCount * 0.1 ? 'warning' : 'info',
        description: `Found ${duplicateRowCount} duplicate rows (${dupPct}% of dataset).`,
        recommendation: 'Use deduplication transformation to retain only unique entries.',
      });
    }
  }

  // 3. Compute overall score (0-100)
  let score = 100;

  // Penalize for null ratio
  const nullRatio = totalNulls / totalCells;
  score -= Math.min(40, Math.round(nullRatio * 60));

  // Penalize for duplicate rows
  const dupRatio = rowCount > 0 ? duplicateRowCount / rowCount : 0;
  score -= Math.min(25, Math.round(dupRatio * 50));

  // Penalize for severe issues
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 15;
    else if (issue.severity === 'warning') score -= 5;
    else if (issue.severity === 'info') score -= 1;
  }

  score = Math.max(0, Math.min(100, score));

  // 4. Summary generation
  let summary = `Dataset contains ${rowCount.toLocaleString()} rows and ${columnCount} columns. `;
  if (score >= 90) {
    summary += 'High data quality overall with minimal nulls and anomalies.';
  } else if (score >= 70) {
    summary += 'Good data quality with moderate issues identified (see recommendations).';
  } else if (score >= 50) {
    summary += 'Fair data quality. Notable missing values or anomalies require attention before modelling.';
  } else {
    summary += 'Poor data quality. Substantial missing data or structural issues detected.';
  }

  return {
    score,
    totalRows: rowCount,
    totalColumns: columnCount,
    duplicateRowCount,
    issues,
    summary,
  };
}
