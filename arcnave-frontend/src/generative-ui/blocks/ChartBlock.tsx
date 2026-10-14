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
import { BAR_GAP, BAR_RADIUS, CHART_AXIS, CHART_GRID, CHART_TEXT, CHART_TOOLTIP_STYLE, seriesColor } from '../../chartColors';

// Series colours are the brand's six chart tokens in their fixed order (src/chartColors.ts).

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
        <div className="ui-chart-empty-state" style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--color-muted)' }}>
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
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey={block.x.field} tickFormatter={formatXLabel} stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} tickLine={false} />
              <YAxis stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Legend verticalAlign="top" height={36} />
              {block.series.map((s, idx) => (
                <Line
                  key={s.field}
                  type="monotone"
                  dataKey={s.field}
                  name={s.label || s.field}
                  stroke={s.color || seriesColor(idx)}
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
            <BarChart data={block.data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }} barGap={BAR_GAP}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey={block.x.field} tickFormatter={formatXLabel} stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} tickLine={false} />
              <YAxis stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Legend verticalAlign="top" height={36} />
              {block.series.map((s, idx) => (
                <Bar
                  key={s.field}
                  dataKey={s.field}
                  name={s.label || s.field}
                  fill={s.color || seriesColor(idx)}
                  stackId={block.stacked ? 'stack' : undefined}
                  radius={BAR_RADIUS}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={block.data} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey={block.x.field} tickFormatter={formatXLabel} stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} tickLine={false} />
              <YAxis stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Legend verticalAlign="top" height={36} />
              {block.series.map((s, idx) => {
                const color = s.color || seriesColor(idx);
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
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey={block.x.field} name={block.x.label || block.x.field} stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} />
              <YAxis dataKey={block.series[0]?.field} name={block.series[0]?.label} stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Legend verticalAlign="top" height={36} />
              {block.series.map((s, idx) => (
                <Scatter
                  key={s.field}
                  name={s.label || s.field}
                  data={block.data}
                  fill={s.color || seriesColor(idx)}
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
                contentStyle={CHART_TOOLTIP_STYLE}
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
                  <Cell key={`cell-${index}`} fill={seriesColor(index)} />
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
