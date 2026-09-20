import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { TableBlock as TableBlockType, TableColumn } from '../types';

function formatCellValue(raw: unknown, column: TableColumn, display?: string): string {
  if (display !== undefined) return display;
  if (raw === null || raw === undefined) return '—';

  switch (column.valueType) {
    case 'currency':
      return typeof raw === 'number'
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(raw)
        : String(raw);
    case 'percentage':
      return typeof raw === 'number'
        ? `${(raw * (raw <= 1 ? 100 : 1)).toFixed(1)}%`
        : String(raw);
    case 'number':
      return typeof raw === 'number' ? raw.toLocaleString() : String(raw);
    case 'date':
      try {
        return new Date(String(raw)).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      } catch {
        return String(raw);
      }
    default:
      return String(raw);
  }
}

export function TableBlock({ block }: { block: TableBlockType }) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = block.pagination?.pageSize ?? 10;

  const handleSort = (key: string) => {
    if (!block.sortable) return;
    if (sortKey === key) {
      if (sortOrder === 'asc') setSortOrder('desc');
      else {
        setSortKey(null);
        setSortOrder('asc');
      }
    } else {
      setSortKey(key);
      setSortOrder('asc');
    }
  };

  const processedRows = useMemo(() => {
    let result = [...block.rows];

    // Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((row) =>
        block.columns.some((col) => {
          const val = row[col.key];
          const text = typeof val === 'object' && val !== null && 'display' in val
            ? String((val as { display: unknown }).display)
            : String(val ?? '');
          return text.toLowerCase().includes(q);
        }),
      );
    }

    // Sort
    if (sortKey) {
      result.sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        const rawA = typeof valA === 'object' && valA !== null && 'raw' in valA ? (valA as { raw: unknown }).raw : valA;
        const rawB = typeof valB === 'object' && valB !== null && 'raw' in valB ? (valB as { raw: unknown }).raw : valB;

        if (typeof rawA === 'number' && typeof rawB === 'number') {
          return sortOrder === 'asc' ? rawA - rawB : rawB - rawA;
        }
        return sortOrder === 'asc'
          ? String(rawA ?? '').localeCompare(String(rawB ?? ''))
          : String(rawB ?? '').localeCompare(String(rawA ?? ''));
      });
    }

    return result;
  }, [block.rows, block.columns, searchQuery, sortKey, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(processedRows.length / pageSize));
  const currentRows = processedRows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="ui-table-container" role="region" aria-label={block.title || 'Data table'}>
      {(block.title || block.filterable) && (
        <div className="ui-table-header">
          {block.title && <h4 className="ui-table-title">{block.title}</h4>}
          {block.filterable && (
            <div className="ui-table-search">
              <Search size={14} />
              <input
                type="text"
                placeholder="Filter table rows…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter rows"
              />
            </div>
          )}
        </div>
      )}

      <div className="ui-table-scroll">
        <table className="ui-table">
          <thead>
            <tr>
              {block.columns.map((col) => {
                const isSorted = sortKey === col.key;
                const alignClass = col.align ? `align-${col.align}` : '';
                return (
                  <th
                    key={col.key}
                    className={`${alignClass} ${block.sortable ? 'sortable' : ''}`}
                    onClick={() => handleSort(col.key)}
                    scope="col"
                  >
                    <div className="ui-table-th-content">
                      <span>{col.label}</span>
                      {block.sortable && (
                        <span className="ui-sort-icon">
                          {isSorted ? (
                            sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                          ) : (
                            <ArrowUpDown size={11} className="dim" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {currentRows.length > 0 ? (
              currentRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {block.columns.map((col) => {
                    const cell = row[col.key];
                    const raw = typeof cell === 'object' && cell !== null && 'raw' in cell
                      ? (cell as { raw: unknown }).raw
                      : cell;
                    const display = typeof cell === 'object' && cell !== null && 'display' in cell
                      ? (cell as { display?: string }).display
                      : undefined;
                    const alignClass = col.align ? `align-${col.align}` : '';
                    return (
                      <td key={col.key} className={alignClass}>
                        {formatCellValue(raw, col, display)}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={block.columns.length} className="ui-table-empty">
                  No matching records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ui-table-footer">
        <span className="ui-table-meta">
          Showing {processedRows.length > 0 ? (page - 1) * pageSize + 1 : 0}–
          {Math.min(page * pageSize, processedRows.length)} of {processedRows.length} rows
        </span>
        {totalPages > 1 && (
          <div className="ui-pagination-controls">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {block.provenance && (
        <small className="ui-block-provenance">
          Source: Verified calculation ({block.provenance.methodology || 'Computed result'})
        </small>
      )}
    </div>
  );
}
