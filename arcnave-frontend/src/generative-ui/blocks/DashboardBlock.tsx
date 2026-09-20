import { useState } from 'react';
import { Filter } from 'lucide-react';
import type { DashboardBlock as DashboardBlockType, DashboardChildBlock } from '../types';
import { TextBlock } from './TextBlock';
import { TableBlock } from './TableBlock';
import { MetricBlock } from './MetricBlock';
import { ChartBlock } from './ChartBlock';
import { ComparisonBlock } from './ComparisonBlock';

function renderChildBlock(block: DashboardChildBlock) {
  switch (block.type) {
    case 'text':
      return <TextBlock key={block.blockId} block={block} />;
    case 'table':
      return <TableBlock key={block.blockId} block={block} />;
    case 'metric':
      return <MetricBlock key={block.blockId} block={block} />;
    case 'chart':
      return <ChartBlock key={block.blockId} block={block} />;
    case 'comparison':
      return <ComparisonBlock key={block.blockId} block={block} />;
  }
}

export function DashboardBlock({ block }: { block: DashboardBlockType }) {
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});

  const handleFilterChange = (key: string, value: string) => {
    setActiveFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const layoutClass = `dashboard-layout-${block.layout}`;

  return (
    <div className="ui-dashboard-container" role="region" aria-label={block.title || 'Dashboard'}>
      <div className="ui-dashboard-header">
        {block.title && <h3 className="ui-dashboard-title">{block.title}</h3>}

        {block.filters && block.filters.length > 0 && (
          <div className="ui-dashboard-filters" role="toolbar" aria-label="Dashboard filters">
            <Filter size={14} className="ui-filter-icon" />
            {block.filters.map((flt) => (
              <div key={flt.key} className="ui-dashboard-filter-control">
                <label htmlFor={`filter-${flt.key}`}>{flt.label}:</label>
                {flt.type === 'category' && flt.options ? (
                  <select
                    id={`filter-${flt.key}`}
                    value={activeFilters[flt.key] || ''}
                    onChange={(e) => handleFilterChange(flt.key, e.target.value)}
                  >
                    <option value="">All</option>
                    {flt.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`filter-${flt.key}`}
                    type="text"
                    placeholder={`Filter by ${flt.label.toLowerCase()}`}
                    value={activeFilters[flt.key] || ''}
                    onChange={(e) => handleFilterChange(flt.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`ui-dashboard-grid ${layoutClass}`}>
        {block.blocks.map((child) => (
          <div key={child.blockId} className="ui-dashboard-cell">
            {renderChildBlock(child)}
          </div>
        ))}
      </div>
    </div>
  );
}
