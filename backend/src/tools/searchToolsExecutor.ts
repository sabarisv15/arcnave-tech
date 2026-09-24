/**
 * SearchToolsExecutor: Executes deferred tool discovery.
 *
 * Implements:
 * - Policy-approved catalog search: Searches allowed tools by query keywords.
 * - Progressive tool disclosure: Discloses exact matching tool schemas on-demand.
 * - Dynamic activation callback: Activates discovered tools for subsequent loop rounds.
 * - Invariant 1: Typed ToolResults, never throws unhandled errors.
 */

import { z } from 'zod';

import type { ToolCall, ToolDefinition, ToolExecutor, ToolResult } from '../providers/types.js';
import { TOOL_CATALOG_ENTRIES } from './catalog.js';

const searchToolsInput = z.object({
  query: z.string().min(1),
});

function textResult(toolCallId: string, ok: boolean, text: string): ToolResult {
  return { toolCallId, ok, content: [{ type: 'text', text }] };
}

function jsonResult(toolCallId: string, data: unknown, ok = true): ToolResult {
  return { toolCallId, ok, content: [{ type: 'json', data }] };
}

export class SearchToolsExecutor implements ToolExecutor {
  constructor(
    private readonly catalog: ToolDefinition[],
    private readonly onToolDiscovered?: (tool: ToolDefinition) => void | Promise<void>,
  ) {}

  async execute(call: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) {
      return textResult(call.id, false, 'The request was aborted before search_tools completed.');
    }

    if (call.name !== 'search_tools') {
      return textResult(call.id, false, `Unknown tool "${call.name}".`);
    }

    const parsed = searchToolsInput.safeParse(call.input);
    if (!parsed.success) {
      return textResult(call.id, false, `Invalid input: ${parsed.error.message}`);
    }

    const rawQuery = parsed.data.query.toLowerCase().trim();
    const cleanQuery = rawQuery.replace(/[^a-z0-9_-]+/g, ' ').trim();
    const tokens = cleanQuery.split(/\s+/).filter(Boolean);

    const scored: { tool: ToolDefinition; score: number }[] = [];

    for (const tool of this.catalog) {
      // Don't return search_tools itself in search results
      if (tool.name === 'search_tools') continue;

      let score = 0;
      const name = tool.name.toLowerCase();
      const desc = tool.description.toLowerCase();

      // Look up matching catalog metadata if available
      const catalogEntry = TOOL_CATALOG_ENTRIES.find((e) => e.name === tool.name);

      // Exact or partial name match
      if (cleanQuery === name || rawQuery === name) {
        score += 30;
      } else if (tokens.includes(name)) {
        score += 20;
      } else if (tokens.some((token) => name.includes(token))) {
        score += 10;
      }

      // Catalog entry keyword & description matching
      if (catalogEntry) {
        for (const kw of catalogEntry.keywords) {
          const kwLower = kw.toLowerCase();
          if (cleanQuery === kwLower || cleanQuery.includes(kwLower)) {
            score += 15;
          } else if (tokens.some((t) => t === kwLower || kwLower.includes(t))) {
            score += 8;
          }
        }
        if (tokens.some((t) => catalogEntry.shortDescription.toLowerCase().includes(t))) {
          score += 4;
        }
      }

      // General description token matching
      for (const token of tokens) {
        if (desc.includes(token)) score += 3;
      }

      // Semantic / Domain Keyword Associations
      if (
        tokens.some((t) =>
          ['excel', 'spreadsheet', 'xlsx', 'sheet', 'workbook', 'word', 'doc', 'docx', 'document', 'powerpoint', 'presentation', 'pptx', 'slide', 'slides', 'deck', 'pdf', 'report', 'deliverable', 'export'].includes(t)
        ) &&
        name === 'generate_deliverable'
      ) {
        score += 15;
      }

      if (
        tokens.some((t) =>
          ['python', 'code', 'calculate', 'compute', 'simulate', 'numpy', 'pandas', 'statistics', 'math', 'regression', 'script'].includes(t)
        ) &&
        name === 'run_python'
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['file', 'read', 'upload', 'uploaded', 'attachment', 'pdf'].includes(t)) &&
        name === 'read_uploaded_file'
      ) {
        score += 12;
      }

      if (
        tokens.some((t) => ['web', 'search', 'internet', 'google', 'online', 'lookup', 'research'].includes(t)) &&
        name === 'web_search'
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['fetch', 'url', 'http', 'https', 'webpage', 'site', 'website'].includes(t)) &&
        name === 'web_fetch'
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['image', 'photo', 'picture', 'drawing', 'illustration', 'draw'].includes(t)) &&
        name === 'generate_image'
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['artifact', 'report', 'draft'].includes(t)) &&
        ['create_artifact', 'read_artifact', 'update_artifact'].includes(name)
      ) {
        score += 10;
      }

      if (
        tokens.some((t) => ['memory', 'remember', 'recall'].includes(t)) &&
        name === 'search_memory'
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['ui', 'render', 'dashboard', 'interactive'].includes(t)) &&
        name === 'render_ui'
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['project', 'repo', 'files'].includes(t)) &&
        ['search_project_files', 'read_project_file'].includes(name)
      ) {
        score += 12;
      }

      // Exact table work: a request to count, total or classify every row of a statement or
      // register should reach the extraction pair before run_python, which cannot read a
      // scanned page (Phase 3 live finding: three wasted rounds before extraction).
      // Strong words name the exact-figure intent; weak ones only support it, so "merge all
      // PDFs" does not pull the table tools above mergePdfFiles.
      const strong = [
        'count', 'counts', 'exact', 'exactly', 'transaction', 'transactions', 'entries', 'rows',
        'statement', 'statements', 'ledger', 'register', 'classify', 'reconcile', 'total', 'totals', 'sum',
      ];
      const weak = ['every', 'all', 'entry', 'row', 'table', 'tables', 'extract', 'scanned'];
      const strongHits = Math.min(tokens.filter((t) => strong.includes(t)).length, 4);
      const weakHits = Math.min(tokens.filter((t) => weak.includes(t)).length, 3);
      if (strongHits > 0 && (name === 'extract_scanned_table_rows' || name === 'analyze_table_rows')) {
        score += 20 + 15 * strongHits + 5 * weakHits;
        // Analysis needs an extractionId, so extraction is listed first.
        if (name === 'extract_scanned_table_rows') score += 25;
      }

      // File Operations (PDF, XLSX, DOCX, PPTX)
      if (
        tokens.some((t) => ['pdf', 'merge', 'split', 'page', 'pages', 'inspect'].includes(t)) &&
        ['inspectPdf', 'mergePdfFiles', 'splitPdfFile'].includes(name)
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['excel', 'xlsx', 'spreadsheet', 'sheet', 'workbook', 'cell', 'cells', 'formula'].includes(t)) &&
        ['inspectSpreadsheet', 'editSpreadsheetCells', 'combineWorkbooks'].includes(name)
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['docx', 'word', 'document', 'paragraph', 'paragraphs', 'heading', 'headings', 'section'].includes(t)) &&
        ['inspectDocxStructure', 'editDocxContent', 'appendDocxSection'].includes(name)
      ) {
        score += 15;
      }

      if (
        tokens.some((t) => ['pptx', 'powerpoint', 'presentation', 'slide', 'slides', 'deck', 'reorder'].includes(t)) &&
        ['inspectPptxStructure', 'reorderPptxSlides', 'editPptxSlideText'].includes(name)
      ) {
        score += 15;
      }

      if (score > 0) {
        scored.push({ tool, score });
      }
    }

    const matching = scored
      .sort((a, b) => b.score - a.score)
      .map((s) => s.tool);

    // Notify discovery callback for matching tools so they are dynamically activated
    if (this.onToolDiscovered) {
      for (const tool of matching) {
        await this.onToolDiscovered(tool);
      }
    }

    if (matching.length === 0) {
      return jsonResult(call.id, {
        message: `No matching tools found in policy-approved catalog for query "${parsed.data.query}".`,
        tools: [],
      });
    }

    return jsonResult(call.id, {
      message: `Found ${matching.length} matching tool(s) in catalog. Their schemas are now available for invocation.`,
      tools: matching.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }
}
