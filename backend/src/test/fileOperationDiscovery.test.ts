import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import {
  getDeferredPolicyCatalog,
  getInitialCoreTools,
} from '../tools/catalog.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import { FileOperationExecutor } from '../tools/fileOperationExecutor.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';

describe('File Operation Deferred Discovery & Execution Flow', () => {
  const cfg = {
    ENABLE_TOOL_USE: true,
    ENABLE_RUN_PYTHON: false,
    ENABLE_SKILLS: true,
    ENABLE_WEB: false,
    ENABLE_MEMORY: false,
    ENABLE_GENERATIVE_UI: false,
    ENABLE_IMAGE_GENERATION: false,
  } as any;

  const flags = {
    skillsEnabled: true,
  };

  const context = {
    userId: 'user-discovery-123',
    projectId: null,
    allowPython: false,
    allowDeliverable: true,
  };

  it('verifies the locked flow: Round 0 initial tools -> search_tools -> dynamic tool activation -> model invocation', async () => {
    // 1. Initial Round 0 Tools:
    const initialTools = getInitialCoreTools(cfg, flags, context);
    const initialToolNames = initialTools.map((t) => t.name);

    // Initial tools must contain search_tools and load_skill
    expect(initialToolNames).toContain('search_tools');
    expect(initialToolNames).toContain('load_skill');

    // Initial tools must NOT contain deferred file operations
    expect(initialToolNames).not.toContain('inspectPdf');
    expect(initialToolNames).not.toContain('mergePdfFiles');

    // 2. Policy-approved catalog
    const policyCatalog = getDeferredPolicyCatalog(cfg, flags, context);

    // 3. Dynamic Tool Ingestion Callback Simulation (matches GenerationService and AgentLoop)
    const activeTools = [...initialTools];
    const activeToolNames = new Set<string>(activeTools.map((t) => t.name));

    const onToolDiscovered = async (discoveredTool: any) => {
      if (!activeTools.some((t) => t.name === discoveredTool.name)) {
        activeTools.push(discoveredTool);
        activeToolNames.add(discoveredTool.name);
      }
    };

    const searchToolsExecutor = new SearchToolsExecutor(policyCatalog, onToolDiscovered);

    // 4. Model executes search_tools({ query: "merge pdf" })
    const searchResult = await searchToolsExecutor.execute({
      id: 'call-search-1',
      name: 'search_tools',
      input: { query: 'merge pdf' },
    });

    expect(searchResult.ok).toBe(true);
    const resultJson = searchResult.content.find((c) => c.type === 'json')?.data as any;
    expect(resultJson.tools.length).toBeGreaterThan(0);
    expect(resultJson.tools.some((t: any) => t.name === 'mergePdfFiles')).toBe(true);

    // 5. Verify dynamic ingestion into active tool set
    expect(activeToolNames.has('mergePdfFiles')).toBe(true);
    const discoveredDefinition = activeTools.find((t) => t.name === 'mergePdfFiles');
    expect(discoveredDefinition).toBeDefined();
    expect((discoveredDefinition?.inputSchema as any).properties.fileIds).toBeDefined();

    // 6. Round 1: Model now invokes the discovered mergePdfFiles tool
    const runtime = new ExecutionRuntime();
    const mockStorageStore: Record<string, Buffer> = {};
    const mockDbRows: Record<string, any> = {};

    const mockStorage = {
      put: async (key: string, data: Buffer) => {
        mockStorageStore[key] = data;
      },
      // Streams to a path in the real storage; here it writes what get() returns.
      async downloadTo(this: { get: (key: string) => Promise<Buffer> }, key: string, dest: string) {
        await (await import('node:fs/promises')).writeFile(dest, await this.get(key));
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
              if (id && mockDbRows[id] && mockDbRows[id].userId === context.userId) {
                return [mockDbRows[id]];
              }
              const row = Object.values(mockDbRows).find((r) => r.userId === context.userId);
              return row ? [row] : [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const id = `att-merged-${Date.now()}`;
            const row = { id, ...vals };
            mockDbRows[id] = row;
            return [row];
          },
        }),
      }),
    } as any;

    // Create 2 test PDF attachments
    const doc1 = await PDFDocument.create();
    doc1.addPage([500, 300]);
    const pdfBytes1 = Buffer.from(await doc1.save());

    const doc2 = await PDFDocument.create();
    doc2.addPage([500, 300]);
    const pdfBytes2 = Buffer.from(await doc2.save());

    mockStorageStore['storage-pdf-1'] = pdfBytes1;
    mockDbRows['pdf-att-1'] = {
      id: 'pdf-att-1',
      userId: context.userId,
      filename: 'first.pdf',
      mimeType: 'application/pdf',
      storageKey: 'storage-pdf-1',
      sizeBytes: pdfBytes1.length,
    };

    mockStorageStore['storage-pdf-2'] = pdfBytes2;
    mockDbRows['pdf-att-2'] = {
      id: 'pdf-att-2',
      userId: context.userId,
      filename: 'second.pdf',
      mimeType: 'application/pdf',
      storageKey: 'storage-pdf-2',
      sizeBytes: pdfBytes2.length,
    };

    const fileOperationExecutor = new FileOperationExecutor({
      db: mockDb,
      storage: mockStorage,
      executionRuntime: runtime,
      userId: context.userId,
      chatId: 'chat-flow',
      messageId: 'msg-flow',
    });

    const mergeResult = await fileOperationExecutor.execute({
      id: 'call-exec-merge',
      name: 'mergePdfFiles',
      input: {
        fileIds: ['pdf-att-1', 'pdf-att-2'],
        outputFilename: 'final_merged.pdf',
      },
    });

    expect(mergeResult.ok).toBe(true);
    const mergeJson = mergeResult.content.find((c) => c.type === 'json')?.data as any;
    expect(mergeJson.status).toBe('success');
    expect(mergeJson.file.filename).toBe('final_merged.pdf');
    expect(mergeJson.metrics.inputFilesCount).toBe(2);

    // Verify stored PDF is valid and has 2 pages
    const mergedStoredBytes = mockStorageStore[mergeJson.file.storageKey];
    expect(mergedStoredBytes).toBeDefined();
    const verifiedMergedDoc = await PDFDocument.load(mergedStoredBytes!);
    expect(verifiedMergedDoc.getPageCount()).toBe(2);
  });
});
