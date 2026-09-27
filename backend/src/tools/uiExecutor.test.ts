import { describe, expect, it, vi } from 'vitest';
import { UIToolExecutor } from './uiExecutor.js';
import type { UIAuthorizer } from '../services/ui/authorizer.js';
import type { UIBlock, UIResponseV1 } from '../services/ui/types.js';

describe('UIToolExecutor (render_ui Tool Execution)', () => {
  const mockAuthorizer = {
    filterAuthorizedUI: vi.fn(async (res: UIResponseV1) => res),
    authorizeArtifact: vi.fn(async () => true),
    authorizeSource: vi.fn(async () => true),
  } as unknown as UIAuthorizer;

  const authCtx = {
    userId: '00000000-0000-0000-0000-000000000001',
    chatId: '00000000-0000-0000-0000-000000000002',
  };

  it('successfully executes and normalizes valid blocks, calling onBlock for each block', async () => {
    const onBlock = vi.fn();
    const executor = new UIToolExecutor(mockAuthorizer, authCtx, 100_000, onBlock);

    const call = {
      id: 'call_123',
      name: 'render_ui',
      input: {
        blocks: [
          {
            type: 'metric',
            label: 'Revenue',
            value: 125000,
            unit: 'USD',
          },
          {
            type: 'text',
            text: 'Quarterly revenue exceeded forecasts by 12%.',
          },
        ],
      },
    };

    const result = await executor.execute(call, new AbortController().signal);

    expect(result.ok).toBe(true);
    expect(result.content[0]!.type).toBe('json');
    const response = (result.content[0] as { type: 'json'; data: UIResponseV1 }).data;
    expect(response.schemaVersion).toBe(1);
    expect(response.blocks).toHaveLength(2);

    // Ensure blockId and sequence were normalized
    expect(response.blocks[0]!.blockId).toBeDefined();
    expect(response.blocks[0]!.sequence).toBe(1);
    expect(response.blocks[1]!.sequence).toBe(2);

    // Ensure streaming callback was invoked for both blocks
    expect(onBlock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid inputs gracefully with informative error and fallback text', async () => {
    const executor = new UIToolExecutor(mockAuthorizer, authCtx, 100_000);
    const call = {
      id: 'call_bad',
      name: 'render_ui',
      input: { notBlocks: [] },
    };

    const result = await executor.execute(call, new AbortController().signal);
    expect(result.ok).toBe(false);
    const textContent = (result.content[0] as { type: 'text'; text: string }).text;
    expect(textContent).toContain('UI rendering validation failed');
  });

  it('rejects nested dashboards (max nesting depth = 1)', async () => {
    const executor = new UIToolExecutor(mockAuthorizer, authCtx, 100_000);
    const nestedCall = {
      id: 'call_nested',
      name: 'render_ui',
      input: {
        blocks: [
          {
            type: 'dashboard',
            layout: '2col',
            blocks: [
              {
                type: 'dashboard',
                layout: '1col',
                blocks: [],
              },
            ],
          },
        ],
      },
    };

    const result = await executor.execute(nestedCall, new AbortController().signal);
    expect(result.ok).toBe(false);
    const textContent = (result.content[0] as { type: 'text'; text: string }).text;
    expect(textContent).toContain('validation failed');
  });

  it('rejects executable scripts and provides sanitized textual fallback', async () => {
    const executor = new UIToolExecutor(mockAuthorizer, authCtx, 100_000);
    const hostileCall = {
      id: 'call_hostile',
      name: 'render_ui',
      input: {
        blocks: [
          {
            type: 'text',
            text: 'Hello <script>alert("pwned")</script><img src=x onerror=alert(1)>world',
          },
        ],
      },
    };

    const result = await executor.execute(hostileCall, new AbortController().signal);
    expect(result.ok).toBe(false);
    const textContent = (result.content[0] as { type: 'text'; text: string }).text;
    expect(textContent).toContain('Executable script or event handler syntax is strictly prohibited');
    expect(textContent).not.toContain('<script>');
    expect(textContent).not.toContain('onerror=');
    expect(textContent).toContain('world');
  });

  it('rejects responses exceeding the maximum payload cap (100KB)', async () => {
    const executor = new UIToolExecutor(mockAuthorizer, authCtx, 100_000);
    const hugeRows = Array.from({ length: 600 }, (_, i) => ({
      id: i,
      name: 'Item '.repeat(50),
      data: 'Blob '.repeat(50),
    }));

    const hugeCall = {
      id: 'call_huge',
      name: 'render_ui',
      input: {
        blocks: [
          {
            type: 'table',
            title: 'Excessive Table',
            columns: [
              { key: 'id', label: 'ID' },
              { key: 'name', label: 'Name' },
              { key: 'data', label: 'Data' },
            ],
            rows: hugeRows,
          },
        ],
      },
    };

    const result = await executor.execute(hugeCall, new AbortController().signal);
    expect(result.ok).toBe(false);
  });
});

describe('render_ui visual blocks (ADR-0035)', () => {
  const authorizer = {
    filterAuthorizedUI: vi.fn(async (res: UIResponseV1) => res),
  } as unknown as UIAuthorizer;
  const ctx = { userId: '00000000-0000-0000-0000-000000000001', chatId: '00000000-0000-0000-0000-000000000002' };

  it('streams the HTML to the client but sends the model only its size', async () => {
    const onBlock = vi.fn();
    const html = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';
    const executor = new UIToolExecutor(authorizer, ctx, 100_000, onBlock);
    const result = await executor.execute(
      { id: 'c1', name: 'render_ui', input: { blocks: [{ type: 'visual', title: 'Dot', html }] } },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect((onBlock.mock.calls[0]![0] as UIBlock & { html?: string }).html).toBe(html);
    const sent = (result.content[0] as { type: 'json'; data: UIResponseV1 }).data.blocks[0]!;
    expect(sent).toMatchObject({ type: 'visual', title: 'Dot', htmlBytes: Buffer.byteLength(html) });
    expect(JSON.stringify(result.content)).not.toContain('<circle');
  });

  it('fails an oversized visual with its code in the result', async () => {
    const executor = new UIToolExecutor(authorizer, ctx, 100_000);
    const result = await executor.execute(
      { id: 'c2', name: 'render_ui', input: { blocks: [{ type: 'visual', title: 'Big', html: 'a'.repeat(200_001) }] } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect((result.content[0] as { type: 'text'; text: string }).text).toContain('(visual_too_large)');
  });
});
