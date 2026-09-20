import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table } from 'lucide-react';
import type { ChartBlock as ChartBlockType } from '../types';

const THEME_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
];

function formatXLabel(val: unknown): string {
  const str = String(val ?? '');
  return str.length > 16 ? `${str.slice(0, 14)}…` : str;
}

export function ChartBlock({ block }: { block: ChartBlockType }) {
  const [showTable, setShowTable] = useState(false);

  if (!block.data || block.data.length === 0) {
    return (
      <div className="ui-chart-container ui-chart-empty" role="region" aria-label={block.title || 'Chart'}>
        <div className="ui-chart-header">
          {block.title && <h4 className="ui-chart-title">{block.title}</h4>}
          {block.description && <p className="ui-chart-description">{block.description}</p>}
        </div>
        <div className="ui-chart-empty-state" style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--muted-foreground)' }}>
          <p style={{ margin: 0, fontSize: '13px' }}>No chart data points available to display.</p>
        </div>
      </div>
    );
  }

  const renderChart = () => {
    switch (block.chartType) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={block.data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
              <XAxis dataKey={block.x.field} tickFormatter={formatXLabel} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                }}
              />
              <Legend verticalAlign="top" height={36} />
              {block.series.map((s, idx) => (
                <Line
                  key={s.field}
                  type="monotone"
                  dataKey={s.field}
                  name={s.label || s.field}
                  stroke={s.color || THEME_PALETTE[idx % THEME_PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={block.data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
              <XAxis dataKey={block.x.field} tickFormatter={formatXLabel} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                }}
              />
              <Legend verticalAlign="top" height={36} />
              {block.series.map((s, idx) => (
                <Bar
                  key={s.field}
                  dataKey={s.field}
                  name={s.label || s.field}
                  fill={s.color || THEME_PALETTE[idx % THEME_PALETTE.length]}
                  stackId={block.stacked ? 'stack' : undefined}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={block.data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
              <XAxis dataKey={block.x.field} tickFormatter={formatXLabel} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                }}
              />
              <Legend verticalAlign="top" height={36} />
              {block.series.map((s, idx) => {
                const color = s.color || THEME_PALETTE[idx % THEME_PALETTE.length];
                return (
                  <Area
                    key={s.field}
                    type="monotone"
                    dataKey={s.field}
                    name={s.label || s.field}
                    stroke={color}
                    fill={color}
                    fillOpacity={0.25}
                    stackId={block.stacked ? 'stack' : undefined}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'scatter':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.6} />
              <XAxis dataKey={block.x.field} name={block.x.label || block.x.field} stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis dataKey={block.series[0]?.field} name={block.series[0]?.label} stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                }}
              />
              <Legend verticalAlign="top" height={36} />
              {block.series.map((s, idx) => (
                <Scatter
                  key={s.field}
                  name={s.label || s.field}
                  data={block.data}
                  fill={s.color || THEME_PALETTE[idx % THEME_PALETTE.length]}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        );

      case 'pie':
      case 'donut': {
        const valField = block.series[0]?.field || 'value';
        const innerRadius = block.chartType === 'donut' ? 60 : 0;
        return (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--card)',
                  borderColor: 'var(--border)',
                  borderRadius: '8px',
                  color: 'var(--foreground)',
                }}
              />
              <Legend verticalAlign="bottom" height={36} />
              <Pie
                data={block.data}
                dataKey={valField}
                nameKey={block.x.field}
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={95}
                paddingAngle={2}
                label
              >
                {block.data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={THEME_PALETTE[index % THEME_PALETTE.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );
      }
    }
  };

  return (
    <div className="ui-chart-container" role="region" aria-label={block.title || 'Chart'}>
      <div className="ui-chart-header">
        <div>
          {block.title && <h4 className="ui-chart-title">{block.title}</h4>}
          {block.description && <p className="ui-chart-description">{block.description}</p>}
        </div>
        <button
          className="ui-chart-table-toggle"
          onClick={() => setShowTable(!showTable)}
          title={showTable ? 'View chart' : 'View accessible table'}
          aria-label={showTable ? 'View chart' : 'View accessible table'}
        >
          <Table size={14} />
          <span>{showTable ? 'Chart' : 'Table'}</span>
        </button>
      </div>

      <div className="ui-chart-body">
        {showTable ? (
          <div className="ui-chart-table-fallback">
            <table>
              <thead>
                <tr>
                  <th>{block.x.label || block.x.field}</th>
                  {block.series.map((s) => (
                    <th key={s.field}>{s.label || s.field}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.data.map((row, i) => (
                  <tr key={i}>
                    <td>{String(row[block.x.field] ?? '')}</td>
                    {block.series.map((s) => (
                      <td key={s.field}>{String(row[s.field] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          renderChart()
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
