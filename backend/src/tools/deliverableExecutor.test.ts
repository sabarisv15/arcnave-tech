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

  it('refuses to split a PDF\'s extracted text into a sheet, and says to pass rows (audit D1)', async () => {
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

    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('typed rows as "workbook"');
    expect(mockStorage.put).not.toHaveBeenCalled();
    expect(onCard).not.toHaveBeenCalled();
  });

  it('rejects raw binary files with missing extractedText, requiring upstream structured parsing', async () => {
    const rawBinaryDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 'binary-pdf-raw',
                filename: 'scanned_statement.pdf',
                mimeType: 'application/pdf',
                storageKey: 'key-pdf',
                extractedText: null, // raw unextracted binary
              },
            ]),
          }),
        }),
      }),
    } as any;

    const executor = new DeliverableToolExecutor(
      mockStorage,
      rawBinaryDb,
      'user-1',
      'chat-1',
      'msg-1',
    );

    const result = await executor.execute(
      {
        id: 'call-raw-binary',
        name: 'generate_deliverable',
        input: {
          format: 'xlsx',
          sourceAttachmentId: 'binary-pdf-raw',
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    expect((result.content[0] as any).text).toContain('is not a text file');
  });

  it('still copies a CSV file\'s text into a sheet', async () => {
    const csvDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: 'csv-1', filename: 'rows.csv', mimeType: 'text/csv', storageKey: 'k', extractedText: 'Date,Amount\n2026-01-01,100\n2026-01-02,250' },
            ]),
          }),
        }),
      }),
      insert: mockDb.insert,
    } as any;
    const executor = new DeliverableToolExecutor(mockStorage, csvDb, 'user-1', 'chat-1', 'msg-1');
    const result = await executor.execute(
      { id: 'call-csv', name: 'generate_deliverable', input: { format: 'xlsx', sourceAttachmentId: 'csv-1', title: 'rows' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
  });

  it('generates an XLSX deliverable from typed StructuredWorkbook input', async () => {
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
        id: 'call-structured-wb',
        name: 'generate_deliverable',
        input: {
          format: 'xlsx',
          title: 'Structured_Ledger',
          workbook: {
            sheets: [
              {
                name: 'Ledger',
                columns: [
                  { key: 'date', label: 'Date', type: 'date' },
                  { key: 'amount', label: 'Amount', type: 'number', format: '$#,##0.00' },
                ],
                rows: [
                  {
                    cells: {
                      date: { value: { type: 'date', value: '2026-09-23' } },
                      amount: { value: { type: 'number', value: 2500 } },
                    },
                  },
                ],
              },
            ],
          },
          sourceProfile: {
            attachmentIds: ['att-source-1'],
            sourceType: 'pdf',
            mimeTypes: ['application/pdf'],
            unitsProcessed: { pages: 1, rows: 1 },
          },
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(mockStorage.put).toHaveBeenCalled();
    const data = (result.content[1] as any).data;
    expect(data).toHaveProperty('sourceProfile');
    expect(data.sourceProfile.sourceType).toBe('pdf');
  });

  it('rejects raw binary files passed directly as content', async () => {
    const executor = new DeliverableToolExecutor(
      mockStorage,
      mockDb,
      'user-1',
      'chat-1',
      'msg-1',
    );

    const result = await executor.execute(
      {
        id: 'call-raw-binary-content',
        name: 'generate_deliverable',
        input: {
          format: 'xlsx',
          title: 'Corrupt',
          content: '%PDF-1.4 binary content stream ...',
        },
      },
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    expect((result.content[0] as any).text).toContain('raw binary data cannot be passed directly as content');
  });
});
