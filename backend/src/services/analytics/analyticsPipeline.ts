/**
 * ArcNave Phase 7 Analytics Pipeline Orchestrator.
 *
 * Coordinates data profiling, quality checks, statistical computations,
 * and builds validated UIResponseV1 blocks for generative dashboards.
 */

import { analyticsSessionService } from './session.js';
import { sandboxDataBridge } from './sandboxDataBridge.js';
import type { UIBlock } from '../ui/types.js';
import type { DataQualityReport } from './types.js';

export interface ProfileResultUI {
  summaryText: string;
  blocks: UIBlock[];
}

export class AnalyticsPipeline {
  /**
   * Generates a rich UI block presentation for a profiled dataset.
   * Produces an automated dashboard containing:
   * - Key metric cards (Rows, Columns, Quality Score, Missing Values)
   * - Data quality status and alerts
   * - Column overview table with types and null percentages
   */
  generateProfileDashboard(
    datasetHandle: string,
    datasetName: string,
    version: number,
    quality: DataQualityReport,
    columns: Array<{ name: string; type: string; nullPct: number; uniqueCount: number }>,
    analysisResultId: string,
  ): UIBlock[] {
    const blocks: UIBlock[] = [];

    // 1. Metric KPIs
    const metricBlocks: UIBlock[] = [
      {
        blockId: `metric_rows_${datasetHandle}`,
        sequence: 1,
        type: 'metric',
        label: 'Total Rows',
        value: quality.totalRows,
        unit: 'rows',
        provenance: {
          analysisResultId,
          datasetVersion: version,
          methodology: 'Count of valid tabular records',
        },
      },
      {
        blockId: `metric_cols_${datasetHandle}`,
        sequence: 2,
        type: 'metric',
        label: 'Columns',
        value: quality.totalColumns,
        unit: 'fields',
        provenance: {
          analysisResultId,
          datasetVersion: version,
        },
      },
      {
        blockId: `metric_quality_${datasetHandle}`,
        sequence: 3,
        type: 'metric',
        label: 'Quality Score',
        value: quality.score,
        unit: '/ 100',
        delta: {
          value: quality.score >= 80 ? 'Good' : quality.score >= 50 ? 'Fair' : 'Poor',
          direction: quality.score >= 80 ? 'up' : quality.score >= 50 ? 'flat' : 'down',
          sentiment: quality.score >= 80 ? 'positive' : quality.score >= 50 ? 'neutral' : 'negative',
        },
        provenance: {
          analysisResultId,
          datasetVersion: version,
          methodology: 'Completeness, uniqueness, and outlier penalty index',
        },
      },
      {
        blockId: `metric_dups_${datasetHandle}`,
        sequence: 4,
        type: 'metric',
        label: 'Duplicate Rows',
        value: quality.duplicateRowCount,
        unit: 'rows',
        delta: {
          value: quality.duplicateRowCount === 0 ? 'Zero duplicates' : `${quality.duplicateRowCount} found`,
          direction: quality.duplicateRowCount === 0 ? 'flat' : 'down',
          sentiment: quality.duplicateRowCount === 0 ? 'positive' : 'negative',
        },
        provenance: {
          analysisResultId,
          datasetVersion: version,
        },
      },
    ];

    // 2. Overview Table of Columns
    const tableBlock: UIBlock = {
      blockId: `table_cols_${datasetHandle}`,
      sequence: 5,
      type: 'table',
      title: `Dataset Schema (${datasetName} v${version})`,
      columns: [
        { key: 'name', label: 'Column Name', valueType: 'text', align: 'left' },
        { key: 'type', label: 'Inferred Type', valueType: 'text', align: 'center' },
        { key: 'nullPct', label: 'Missing %', valueType: 'percentage', align: 'right' },
        { key: 'uniqueCount', label: 'Unique Values', valueType: 'number', align: 'right' },
      ],
      rows: columns.slice(0, 50).map((c) => ({
        name: c.name,
        type: c.type,
        nullPct: c.nullPct,
        uniqueCount: c.uniqueCount,
      })),
      sortable: true,
      filterable: true,
      provenance: {
        analysisResultId,
        datasetVersion: version,
      },
    };

    // 3. Narrative Quality Summary Text
    const textBlock: UIBlock = {
      blockId: `text_summary_${datasetHandle}`,
      sequence: 6,
      type: 'text',
      text: `### Data Quality Assessment\n\n${quality.summary}\n\n${
        quality.issues.length > 0
          ? `**Identified Considerations:**\n` +
            quality.issues
              .slice(0, 5)
              .map((iss) => `- **${iss.severity.toUpperCase()}** (${iss.column ?? 'Dataset'}): ${iss.description}${iss.recommendation ? ` *Recommendation:* ${iss.recommendation}` : ''}`)
              .join('\n')
          : '*No significant data quality issues detected.*'
      }`,
    };

    // 4. Wrap into Dashboard Block
    const dashboardBlock: UIBlock = {
      blockId: `dashboard_${datasetHandle}`,
      sequence: 1,
      type: 'dashboard',
      title: `Data Profiling Dashboard: ${datasetName}`,
      layout: '2col',
      blocks: [
        metricBlocks[0] as any,
        metricBlocks[1] as any,
        metricBlocks[2] as any,
        metricBlocks[3] as any,
        tableBlock as any,
      ],
    };

    return [dashboardBlock, textBlock];
  }
}

export const analyticsPipeline = new AnalyticsPipeline();
