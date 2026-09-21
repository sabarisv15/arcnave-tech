import { describe, expect, it, vi } from 'vitest';
import { DeliverableToolExecutor } from './deliverableExecutor.js';

describe('DeliverableToolExecutor', () => {
  const mockStorage = {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(Buffer.from('Date\tDescription\tAmount\n2026-09-01\tDeposit\t5000\n2026-09-02\tTransfer\t-1200')),
  } as any;

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 'source-pdf-1',
              filename: 'kvbfedral.pdf',
              mimeType: 'application/pdf',
              storageKey: 'key-pdf',
              extractedText: 'Date\tDescription\tAmount\n2026-09-01\tDeposit\t5000\n2026-09-02\tTransfer\t-1200',
            },
          ]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: 'generated-xlsx-1',
            filename: 'kvbfedral.xlsx',
          },
        ]),
      }),
    }),
  } as any;

  it('generates an XLSX deliverable via Mode A (direct markdown table)', async () => {
    const onCard = vi.fn();
    const executor = new DeliverableToolExecutor(
      mockStorage,
      mockDb,
      'user-1',
      'chat-1',
      'msg-1',
      onCard,
    );

    const result = await executor.execute(
      {
        id: 'call-mode-a',
        name: 'generate_deliverable',
        input: {
          format: 'xlsx',
          title: 'Financial_Summary',
          content: '| Quarter | Revenue | Expenses |\n| --- | --- | --- |\n| Q1 | 50000 | 32000 |\n| Q2 | 65000 | 41000 |',
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe('call-mode-a');
    expect(mockStorage.put).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
    expect(onCard).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'generated-xlsx-1',
        filename: 'kvbfedral.xlsx',
        format: 'xlsx',
        downloadUrl: '/files/generated-xlsx-1/download',
      }),
    );
  });

  it('converts an uploaded PDF to XLSX via Mode B (source-aware conversion)', async () => {
    const onCard = vi.fn();
    const executor = new DeliverableToolExecutor(
      mockStorage,
      mockDb,
      'user-1',
      'chat-1',
      'msg-1',
      onCard,
    );

    const result = await executor.execute(
      {
        id: 'call-mode-b',
        name: 'generate_deliverable',
        input: {
          format: 'xlsx',
          sourceAttachmentId: 'source-pdf-1',
          instructions: 'Convert transaction list into clean Excel columns',
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe('call-mode-b');
    expect(mockStorage.put).toHaveBeenCalled();
    expect(onCard).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: 'generated-xlsx-1',
        format: 'xlsx',
        downloadUrl: '/files/generated-xlsx-1/download',
      }),
    );
  });
});
