import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { renderMarkdownExport } from '../services/documents/index.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import { FileOperationExecutor } from '../tools/fileOperationExecutor.js';

describe('Batch 5: Multi-Tier Post-Mutation QA & Zero-Replacement Verification', () => {
  const userId = 'user-qa-123';

  function createMockEnvironment() {
    const runtime = new ExecutionRuntime();
    const mockStorageStore: Record<string, Buffer> = {};
    const mockDbRows: Record<string, any> = {};

    const mockStorage = {
      put: async (key: string, data: Buffer) => {
        mockStorageStore[key] = data;
      },
      get: async (key: string) => mockStorageStore[key]!,
    } as any;

    const mockDb = {
      select: () => ({
        from: () => ({
          where: (expr: any) => ({
            limit: async () => {
              const findId = (e: any, depth = 0): string | undefined => {
                if (!e || depth > 3) return undefined;
                if (Array.isArray(e.queryChunks)) {
                  for (const c of e.queryChunks) {
                    if (c && typeof c === 'object') {
                      if ('value' in c && typeof c.value === 'string' && mockDbRows[c.value]) {
                        return c.value;
                      }
                      const found = findId(c, depth + 1);
                      if (found) return found;
                    }
                  }
                }
                return undefined;
              };
              const id = findId(expr);
              if (id && mockDbRows[id] && mockDbRows[id].userId === userId) {
                return [mockDbRows[id]];
              }
              const row = Object.values(mockDbRows).find((r) => r.userId === userId);
              return row ? [row] : [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const id = `att-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const row = { id, ...vals };
            mockDbRows[id] = row;
            return [row];
          },
        }),
      }),
    } as any;

    const executor = new FileOperationExecutor({
      db: mockDb,
      storage: mockStorage,
      executionRuntime: runtime,
      userId,
      chatId: 'chat-qa',
      messageId: 'msg-qa',
    });

    return { runtime, mockStorageStore, mockDbRows, executor };
  }

  it('detects 0 replacements in DOCX and returns search_string_not_found warning with repairable: true', async () => {
    const env = createMockEnvironment();

    // Create a real DOCX
    const docxBuf = await renderMarkdownExport('# Section Header\n\nExisting text here.', 'docx');
    env.mockStorageStore['storage-docx-1'] = docxBuf;
    env.mockDbRows['docx-att-1'] = {
      id: 'docx-att-1',
      userId,
      filename: 'sample.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      storageKey: 'storage-docx-1',
      sizeBytes: docxBuf.length,
    };

    // Invoke editDocxContent with a search string that does NOT exist
    const result = await env.executor.execute({
      id: 'call-docx-miss',
      name: 'editDocxContent',
      input: {
        fileId: 'docx-att-1',
        replacements: [{ search: 'NON_EXISTENT_TEXT_XYZ', replace: 'New Content' }],
        outputFilename: 'sample_miss.docx',
      },
    });

    expect(result.ok).toBe(true);
    const data = result.content.find((c) => c.type === 'json')?.data as any;
    expect(data.status).toBe('warning');
    expect(data.structural.passed).toBe(true);
    expect(data.warnings).toBeDefined();
    expect(data.warnings.length).toBeGreaterThan(0);
    const notFoundWarning = data.warnings.find((w: any) => w.type === 'search_string_not_found');
    expect(notFoundWarning).toBeDefined();
    expect(notFoundWarning.repairable).toBe(true);
    expect(data.repairable).toBe(true);
  });

  it('detects 0 replacements in PPTX and returns search_string_not_found warning with repairable: true', async () => {
    const env = createMockEnvironment();

    // Create a real PPTX
    const pptxBuf = await renderMarkdownExport('# Slide Title\n\nBody text on slide.', 'pptx');
    env.mockStorageStore['storage-pptx-1'] = pptxBuf;
    env.mockDbRows['pptx-att-1'] = {
      id: 'pptx-att-1',
      userId,
      filename: 'presentation.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      storageKey: 'storage-pptx-1',
      sizeBytes: pptxBuf.length,
    };

    // Invoke editPptxSlideText with a search string that does NOT exist on slide 1
    const result = await env.executor.execute({
      id: 'call-pptx-miss',
      name: 'editPptxSlideText',
      input: {
        fileId: 'pptx-att-1',
        slideIndex: 1,
        replacements: [{ search: 'MISSING_STRING_123', replace: 'Replacement' }],
        outputFilename: 'presentation_miss.pptx',
      },
    });

    expect(result.ok).toBe(true);
    const data = result.content.find((c) => c.type === 'json')?.data as any;
    expect(data.status).toBe('warning');
    expect(data.structural.passed).toBe(true);
    expect(data.warnings).toBeDefined();
    const notFoundWarning = data.warnings.find((w: any) => w.type === 'search_string_not_found');
    expect(notFoundWarning).toBeDefined();
    expect(notFoundWarning.repairable).toBe(true);
    expect(data.repairable).toBe(true);
  });

  it('populates structural, semantic, and visual QA sections on PDF operations', async () => {
    const env = createMockEnvironment();

    const doc1 = await PDFDocument.create();
    doc1.addPage([400, 300]);
    const pdfBytes1 = Buffer.from(await doc1.save());

    const doc2 = await PDFDocument.create();
    doc2.addPage([400, 300]);
    const pdfBytes2 = Buffer.from(await doc2.save());

    env.mockStorageStore['pdf-1'] = pdfBytes1;
    env.mockDbRows['pdf-att-1'] = {
      id: 'pdf-att-1',
      userId,
      filename: 'doc1.pdf',
      mimeType: 'application/pdf',
      storageKey: 'pdf-1',
      sizeBytes: pdfBytes1.length,
    };

    env.mockStorageStore['pdf-2'] = pdfBytes2;
    env.mockDbRows['pdf-att-2'] = {
      id: 'pdf-att-2',
      userId,
      filename: 'doc2.pdf',
      mimeType: 'application/pdf',
      storageKey: 'pdf-2',
      sizeBytes: pdfBytes2.length,
    };

    const result = await env.executor.execute({
      id: 'call-merge-qa',
      name: 'mergePdfFiles',
      input: {
        fileIds: ['pdf-att-1', 'pdf-att-2'],
        outputFilename: 'qa_merged.pdf',
      },
    });

    expect(result.ok).toBe(true);
    const data = result.content.find((c) => c.type === 'json')?.data as any;
    expect(data.structural).toBeDefined();
    expect(data.structural.passed).toBe(true);
    expect(data.semantic).toBeDefined();
    expect(data.semantic.passed).toBe(true);
    expect(data.visual).toBeDefined();
    expect(data.visual.previewAvailable).toBe(true);
  });
});
