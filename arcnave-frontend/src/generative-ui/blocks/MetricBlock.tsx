import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { MetricBlock as MetricBlockType } from '../types';

export function MetricBlock({ block }: { block: MetricBlockType }) {
  const delta = block.delta;
  const sentimentClass = delta
    ? delta.sentiment === 'positive'
      ? 'metric-delta-positive'
      : delta.sentiment === 'negative'
        ? 'metric-delta-negative'
        : 'metric-delta-neutral'
    : '';

  return (
    <div className="ui-metric-card" role="region" aria-label={block.label}>
      <span className="ui-metric-label">{block.label}</span>
      <div className="ui-metric-value-row">
        <span className="ui-metric-value">
          {typeof block.value === 'number' ? block.value.toLocaleString() : block.value}
        </span>
        {block.unit && <span className="ui-metric-unit">{block.unit}</span>}
      </div>

      {(delta || block.secondaryText) && (
        <div className="ui-metric-footer">
          {delta && (
            <span className={`ui-metric-delta ${sentimentClass}`}>
              {delta.direction === 'up' && <ArrowUpRight size={15} />}
              {delta.direction === 'down' && <ArrowDownRight size={15} />}
              {delta.direction === 'flat' && <Minus size={15} />}
              <span>{delta.value}</span>
            </span>
          )}
          {block.secondaryText && (
            <span className="ui-metric-secondary">{block.secondaryText}</span>
          )}
        </div>
      )}

      {block.trend && <p className="ui-metric-trend">{block.trend}</p>}

      {block.provenance && (
        <small className="ui-metric-provenance">
          Computed ({block.provenance.methodology || 'Verified computation'})
        </small>
      )}
    </div>
  );
}
