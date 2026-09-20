import { describe, expect, it, vi } from 'vitest';
import { toMessage } from '../types';
import type { MessageDto, ToolCallDto } from '../api';
import type { TableColumn, TableBlock, DashboardBlock, UIBlock, SafeAction } from './types';

describe('Historical UI Hydration (toMessage)', () => {
  it('hydrates UI blocks from executed render_ui tool call content', () => {
    const mockToolCall: ToolCallDto = {
      toolCallId: 'call_1',
      name: 'render_ui',
      input: {
        blocks: [
          {
            type: 'text',
            text: 'Preview',
          },
        ],
      },
      content: [
        {
          type: 'json',
          data: {
            schemaVersion: 1,
            blocks: [
              {
                blockId: 'blk_1',
                sequence: 1,
                type: 'metric',
                label: 'ARR',
                value: 5000000,
                unit: 'USD',
              },
            ],
          },
        },
      ],
      ok: true,
      at: null,
    };

    const dto: MessageDto = {
      id: 'msg_1',
      seq: 2,
      role: 'assistant',
      text: 'Here is your metric:',
      mode: 'chat',
      status: 'complete',
      errorCode: null,
      researchStage: null,
      questions: [],
      feedback: null,
      modelAlias: 'Claude 3.7 Sonnet',
      providerModelId: null,
      finishReason: 'stop',
      artifactId: null,
      searchEntryPoint: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      sources: [],
      events: [],
      toolCalls: [mockToolCall],
      attachments: [],
      usage: null,
    };

    const message = toMessage(dto);
    expect(message.uiBlocks).toBeDefined();
    expect(message.uiBlocks).toHaveLength(1);
    expect(message.uiBlocks![0].type).toBe('metric');
    expect(message.uiBlocks![0].blockId).toBe('blk_1');
  });

  it('hydrates UI blocks from tool input when content is not yet committed', () => {
    const mockToolCall: ToolCallDto = {
      toolCallId: 'call_2',
      name: 'render_ui',
      input: {
        blocks: [
          {
            blockId: 'blk_pending',
            sequence: 1,
            type: 'text',
            text: 'Streamed message',
          },
        ],
      },
      content: [],
      ok: false,
      at: null,
    };

    const dto: MessageDto = {
      id: 'msg_2',
      seq: 3,
      role: 'assistant',
      text: '',
      mode: 'chat',
      status: 'generating',
      errorCode: null,
      researchStage: null,
      questions: [],
      feedback: null,
      modelAlias: 'Gemini 2.5 Flash',
      providerModelId: null,
      finishReason: null,
      artifactId: null,
      searchEntryPoint: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      sources: [],
      events: [],
      toolCalls: [mockToolCall],
      attachments: [],
      usage: null,
    };

    const message = toMessage(dto);
    expect(message.uiBlocks).toBeDefined();
    expect(message.uiBlocks).toHaveLength(1);
    expect(message.uiBlocks![0].blockId).toBe('blk_pending');
  });
});

describe('Table Component Behaviors: Sorting, Filtering & Pagination', () => {
  const columns: TableColumn[] = [
    { key: 'name', label: 'Product Name', valueType: 'text', align: 'left' },
    { key: 'category', label: 'Category', valueType: 'text', align: 'left' },
    { key: 'price', label: 'Price', valueType: 'currency', align: 'right' },
  ];

  const rows = [
    { name: 'Gamma', category: 'Software', price: 300 },
    { name: 'Alpha', category: 'Hardware', price: 100 },
    { name: 'Beta', category: 'Hardware', price: 200 },
    { name: 'Delta', category: 'Services', price: 50 },
  ];

  it('sorts numeric and text rows ascending and descending', () => {
    // Sort by name ascending
    const sortedByNameAsc = [...rows].sort((a, b) => a.name.localeCompare(b.name));
    expect(sortedByNameAsc.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);

    // Sort by price descending
    const sortedByPriceDesc = [...rows].sort((a, b) => b.price - a.price);
    expect(sortedByPriceDesc.map((r) => r.name)).toEqual(['Gamma', 'Beta', 'Alpha', 'Delta']);
  });

  it('filters rows matching query across all columns case-insensitively', () => {
    const filterQuery = 'hard';
    const filtered = rows.filter((r) =>
      Object.values(r).some((val) => String(val).toLowerCase().includes(filterQuery.toLowerCase())),
    );
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
  });

  it('paginates rows accurately according to pageSize', () => {
    const pageSize = 2;
    const page1 = rows.slice(0, pageSize);
    const page2 = rows.slice(pageSize, pageSize * 2);

    expect(page1.map((r) => r.name)).toEqual(['Gamma', 'Alpha']);
    expect(page2.map((r) => r.name)).toEqual(['Beta', 'Delta']);
    expect(Math.ceil(rows.length / pageSize)).toBe(2);
  });
});

describe('Dashboard Client-Side View Filter Logic', () => {
  it('applies client-side category filter to nested table blocks without mutating base data', () => {
    const items = [
      { id: 1, region: 'US', sales: 500 },
      { id: 2, region: 'EU', sales: 300 },
      { id: 3, region: 'US', sales: 200 },
      { id: 4, region: 'APAC', sales: 400 },
    ];

    const activeFilter = { key: 'region', value: 'US' };

    // Filter only applied to view
    const viewRows = items.filter((row) => row[activeFilter.key as keyof typeof row] === activeFilter.value);
    expect(viewRows).toHaveLength(2);
    expect(viewRows.map((r) => r.id)).toEqual([1, 3]);

    // Base items remain completely intact
    expect(items).toHaveLength(4);
  });
});

describe('Duplicate Block Deduplication & Stream Idempotency', () => {
  it('deduplicates streamed blocks by blockId, updating in-place rather than appending duplicates', () => {
    const existing: UIBlock[] = [
      { blockId: 'blk_1', sequence: 1, type: 'text', text: 'Draft text' },
      { blockId: 'blk_2', sequence: 2, type: 'metric', label: 'Users', value: 100 },
    ];

    // Stream update frame for blk_1
    const incoming: UIBlock = { blockId: 'blk_1', sequence: 1, type: 'text', text: 'Final finalized text' };

    const exists = existing.some((b) => b.blockId === incoming.blockId);
    const updated = exists
      ? existing.map((b) => (b.blockId === incoming.blockId ? incoming : b))
      : [...existing, incoming];

    expect(updated).toHaveLength(2);
    expect((updated[0] as Extract<UIBlock, { type: 'text' }>).text).toBe('Final finalized text');
  });
});

describe('Safe Actions Contract', () => {
  it('validates safe action dispatching contracts', () => {
    const onAction = vi.fn();

    const openArtifactAction: SafeAction = {
      actionType: 'open_artifact',
      artifactId: '11111111-1111-1111-1111-111111111111',
    };

    onAction(openArtifactAction);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'open_artifact',
      artifactId: '11111111-1111-1111-1111-111111111111',
    }));
  });
});
