import { describe, expect, it } from 'vitest';
import { validateAndNormalizeUI, sanitizeInertText } from './validator.js';

describe('UI Validator & Normalizer (Phase 6)', () => {
  it('validates a complete TextBlock and assigns blockId and sequence', () => {
    const input = {
      blocks: [
        {
          type: 'text',
          text: 'Here is an analysis with a code example:\n```js\nconst x = 42;\nconsole.log(x);\n```',
        },
      ],
    };

    const result = validateAndNormalizeUI(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.schemaVersion).toBe(1);
      expect(result.data.blocks).toHaveLength(1);
      const block = result.data.blocks[0]!;
      expect(block.type).toBe('text');
      expect(block.blockId).toMatch(/^blk_/);
      expect(block.sequence).toBe(1);
    }
  });

  it('validates a MetricBlock with explicit trend and delta sentiment', () => {
    const input = {
      blocks: [
        {
          type: 'metric',
          label: 'Operating Cost',
          value: '$4.2M',
          unit: 'USD',
          secondaryText: 'Q3 actuals',
          delta: {
            value: '+12.4%',
            direction: 'up',
            sentiment: 'negative', // Explicitly negative even though direction is up!
          },
          trend: 'Upward cost pressure',
        },
      ],
    };

    const result = validateAndNormalizeUI(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const block = result.data.blocks[0]!;
      expect(block.type).toBe('metric');
      if (block.type === 'metric') {
        expect(block.delta?.sentiment).toBe('negative');
        expect(block.delta?.direction).toBe('up');
      }
    }
  });

  it('validates a TableBlock with columns, raw values, and display values', () => {
    const input = {
      blocks: [
        {
          type: 'table',
          title: 'Regional Revenue',
          columns: [
            { key: 'region', label: 'Region', valueType: 'text', align: 'left' },
            { key: 'revenue', label: 'Revenue', valueType: 'currency', align: 'right' },
          ],
          rows: [
            { region: 'North America', revenue: { raw: 1250000, display: '$1.25M' } },
            { region: 'Europe', revenue: { raw: 950000, display: '$950K' } },
          ],
          sortable: true,
          pagination: { pageSize: 10 },
        },
      ],
    };

    const result = validateAndNormalizeUI(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const block = result.data.blocks[0]!;
      expect(block.type).toBe('table');
      if (block.type === 'table') {
        expect(block.columns).toHaveLength(2);
        expect(block.rows).toHaveLength(2);
      }
    }
  });

  it('validates a ChartBlock with line, bar, area, scatter, and pie types', () => {
    const chartTypes = ['line', 'bar', 'area', 'scatter', 'pie', 'donut'] as const;

    for (const chartType of chartTypes) {
      const input = {
        blocks: [
          {
            type: 'chart',
            chartType,
            title: `${chartType} Chart Test`,
            x: { field: 'month', label: 'Month', type: 'category' },
            series: [{ field: 'revenue', label: 'Revenue', color: '#3b82f6' }],
            data: [
              { month: 'Jan', revenue: 100 },
              { month: 'Feb', revenue: 120 },
            ],
          },
        ],
      };

      const result = validateAndNormalizeUI(input);
      expect(result.ok).toBe(true);
    }
  });

  it('validates ComparisonBlock, TimelineBlock, StepsBlock, CardsBlock, and SourcesBlock', () => {
    const input = {
      blocks: [
        {
          type: 'comparison',
          title: 'Database Comparison',
          items: [
            { id: 'pg', name: 'PostgreSQL' },
            { id: 'my', name: 'MySQL' },
          ],
          attributes: [
            { key: 'acid', label: 'ACID Compliance' },
            { key: 'license', label: 'License' },
          ],
          matrix: {
            pg: { acid: 'Full', license: 'PostgreSQL' },
            my: { acid: 'Full (InnoDB)', license: 'GPL' },
          },
        },
        {
          type: 'timeline',
          title: 'Project Milestones',
          events: [
            { dateOrPeriod: '2026-01', title: 'Phase 1 Launch', status: 'completed' },
            { dateOrPeriod: '2026-03', title: 'Phase 2 Launch', status: 'upcoming' },
          ],
        },
        {
          type: 'steps',
          title: 'Deployment Workflow',
          steps: [
            { index: 1, title: 'Build container', status: 'complete', codeSnippet: 'docker build -t app .' },
            { index: 2, title: 'Deploy service', status: 'active', codeSnippet: 'gcloud run deploy' },
          ],
        },
        {
          type: 'cards',
          title: 'Featured Resources',
          cards: [
            {
              id: 'c1',
              title: 'Documentation',
              subtitle: 'API Reference',
              action: { actionType: 'view_source', sourceRef: 'src_doc1' },
            },
          ],
        },
        {
          type: 'sources',
          title: 'References',
          sources: [
            { sourceRef: 'src_sec1', title: 'Security Guidance', publisher: 'OWASP' },
          ],
        },
      ],
    };

    const result = validateAndNormalizeUI(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.blocks).toHaveLength(5);
    }
  });

  it('validates a DashboardBlock containing non-recursive children', () => {
    const input = {
      blocks: [
        {
          type: 'dashboard',
          title: 'Executive KPI Dashboard',
          layout: '2col',
          blocks: [
            {
              type: 'metric',
              label: 'Total Customers',
              value: 12400,
            },
            {
              type: 'chart',
              chartType: 'bar',
              x: { field: 'quarter' },
              series: [{ field: 'sales' }],
              data: [{ quarter: 'Q1', sales: 50 }],
            },
          ],
          filters: [
            { key: 'region', label: 'Region', type: 'category', options: ['North', 'South'] },
          ],
        },
      ],
    };

    const result = validateAndNormalizeUI(input);
    expect(result.ok).toBe(true);
  });

  it('strictly rejects recursive DashboardBlock (dashboard inside dashboard)', () => {
    const input = {
      blocks: [
        {
          type: 'dashboard',
          title: 'Outer Dashboard',
          layout: '1col',
          blocks: [
            {
              type: 'dashboard', // Nested dashboard is strictly illegal!
              title: 'Inner Dashboard',
              layout: '1col',
              blocks: [],
            },
          ],
        },
      ],
    };

    const result = validateAndNormalizeUI(input);
    expect(result.ok).toBe(false);
  });

  it('strictly rejects executable script injection and HTML event handlers', () => {
    const maliciousInputs = [
      {
        blocks: [{ type: 'text', text: '<script>alert("hacked")</script>' }],
      },
      {
        blocks: [{ type: 'text', text: 'Click here: javascript:alert(1)' }],
      },
      {
        blocks: [{ type: 'text', text: '<img src="x" onerror="stealCookies()">' }],
      },
    ];

    for (const input of maliciousInputs) {
      const result = validateAndNormalizeUI(input);
      expect(result.ok).toBe(false);
    }
  });

  it('allows code snippets and fenced code blocks as inert text', () => {
    const input = {
      blocks: [
        {
          type: 'steps',
          title: 'Node.js Script',
          steps: [
            {
              index: 1,
              title: 'Write script',
              status: 'complete',
              codeSnippet: 'const http = require("http");\nhttp.createServer((req, res) => res.end("OK"));',
            },
          ],
        },
      ],
    };

    const result = validateAndNormalizeUI(input);
    expect(result.ok).toBe(true);
  });

  it('rejects unknown block types and extracts clean fallback', () => {
    const input = {
      blocks: [
        {
          type: 'unknown_widget_type',
          title: 'Unsupported Widget',
          description: 'This is an unsupported presentation widget.',
        },
      ],
    };

    const result = validateAndNormalizeUI(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fallbackText).toContain('Unsupported Widget');
      expect(result.fallbackText).toContain('This is an unsupported presentation widget.');
    }
  });

  it('rejects oversized payloads exceeding maxBytes ceiling', () => {
    const hugeText = 'A'.repeat(120_000);
    const input = {
      blocks: [{ type: 'text', text: hugeText }],
    };

    const result = validateAndNormalizeUI(input, 100_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('exceeds limit');
    }
  });

  it('sanitizes text properly via sanitizeInertText', () => {
    const dirty = '<script>evil()</script><b>Hello</b> <a href="javascript:run()">link</a>';
    const clean = sanitizeInertText(dirty);
    expect(clean).toBe('Hello link');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('javascript:');
  });
});
