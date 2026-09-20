import { Check, X } from 'lucide-react';
import type { ComparisonBlock as ComparisonBlockType } from '../types';

function renderMatrixValue(val: string | number | boolean | undefined) {
  if (val === true) return <Check size={16} className="text-emerald-500" />;
  if (val === false) return <X size={16} className="text-rose-500" />;
  if (val === undefined || val === null) return <span className="text-muted-foreground">—</span>;
  return <span>{String(val)}</span>;
}

export function ComparisonBlock({ block }: { block: ComparisonBlockType }) {
  return (
    <div className="ui-comparison-container" role="region" aria-label={block.title || 'Comparison matrix'}>
      {block.title && <h4 className="ui-comparison-title">{block.title}</h4>}

      <div className="ui-comparison-scroll">
        <table className="ui-comparison-table">
          <thead>
            <tr>
              <th className="ui-comparison-attr-col">Attribute</th>
              {block.items.map((item) => (
                <th key={item.id} className="ui-comparison-item-col">
                  <div className="ui-comparison-item-header">
                    <strong>{item.name}</strong>
                    {item.badge && <span className="ui-comparison-badge">{item.badge}</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.attributes.map((attr) => (
              <tr key={attr.key}>
                <td className="ui-comparison-attr-cell">
                  <span>{attr.label}</span>
                  {attr.category && <small className="ui-comparison-category">{attr.category}</small>}
                </td>
                {block.items.map((item) => {
                  const val = block.matrix[item.id]?.[attr.key];
                  return (
                    <td key={item.id} className="ui-comparison-val-cell">
                      {renderMatrixValue(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {block.notes && block.notes.length > 0 && (
        <ul className="ui-comparison-notes">
          {block.notes.map((note, idx) => (
            <li key={idx}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
