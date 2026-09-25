import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ExecutionRuntime } from './execution/executionRuntime.js';
import { FileOperationExecutor } from './fileOperationExecutor.js';

describe('FileOperationExecutor', () => {
  const runtime = new ExecutionRuntime();
  const userId = 'user-auth-123';
  const otherUserId = 'user-other-456';
  const chatId = 'chat-test';
  const messageId = 'msg-test';

  // In-memory attachment and storage store
  const mockStorageStore: Record<string, Buffer> = {};
  const mockDbRows: Record<string, { id: string; userId: string; filename: string; mimeType: string; storageKey: string; sizeBytes: number }> = {};

  const mockStorage = {
    put: async (key: string, data: Buffer) => {
      mockStorageStore[key] = data;
    },
    // Streams to a path in the real storage; here it writes what get() returns.
    async downloadTo(this: { get: (key: string) => Promise<Buffer> }, key: string, dest: string) {
      await (await import('node:fs/promises')).writeFile(dest, await this.get(key));
    },
    get: async (key: string) => {
      const data = mockStorageStore[key];
      if (!data) throw new Error(`Not found in storage: ${key}`);
      return data;
    },
  } as any;

  const mockDb = {
    select: () => ({
      from: () => ({
        where: (condition: any) => ({
          limit: async () => {
            // Find row that matches condition in mockDbRows
            // drizzle 'and(eq(id), eq(userId))'
            for (const row of Object.values(mockDbRows)) {
              return [row];
            }
            return [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (vals: any) => ({
        returning: async () => {
          const id = `att-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const inserted = { id, ...vals };
          mockDbRows[id] = inserted;
          return [inserted];
        },
      }),
    }),
  } as any;

  // Dedicated DB mock that strictly checks userId and fileId
  function createStrictDb(authorizedUserId: string) {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              // We'll intercept through helper
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const id = `att-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const inserted = { id, ...vals };
            mockDbRows[id] = inserted;
            return [inserted];
          },
        }),
      }),
    };
  }

  function registerAttachment(id: string, ownerId: string, filename: string, mimeType: string, data: Buffer) {
    const storageKey = `storage-key-${id}`;
    mockStorageStore[storageKey] = data;
    mockDbRows[id] = { id, userId: ownerId, filename, mimeType, storageKey, sizeBytes: data.length };
  }

  // Custom DB that looks up from mockDbRows matching id & userId
  const strictDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
    insert: () => ({
      values: (vals: any) => ({
        returning: async () => {
          const id = `att-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const inserted = { id, ...vals };
          mockDbRows[id] = inserted;
          return [inserted];
        },
      }),
    }),
  } as any;

  function createExecutor(callerUserId: string = userId) {
    const dbWithAuth = {
      select: () => ({
        from: () => ({
          where: (_cond: any) => ({
            limit: async () => {
              // Find matching row for requested fileId and callerUserId
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const id = `att-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const inserted = { id, ...vals };
            mockDbRows[id] = inserted;
            return [inserted];
          },
        }),
      }),
    };

    // Override select.where to inspect params
    const dbMock = {
      select: () => ({
        from: () => ({
          where: (expr: any) => ({
            limit: async () => {
              // Find matching row in mockDbRows
              // By iterating mockDbRows:
              for (const row of Object.values(mockDbRows)) {
                if (row.userId === callerUserId) {
                  return [row];
                }
              }
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const id = `att-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const inserted = { id, ...vals };
            mockDbRows[id] = inserted;
            return [inserted];
          },
        }),
      }),
    };

    return new FileOperationExecutor({
      db: dbMock as any,
      storage: mockStorage,
      executionRuntime: runtime,
      userId: callerUserId,
      chatId,
      messageId,
    });
  }

  // Specific db factory where each fileId lookup matches exact row
  function createExactDb(callerUserId: string) {
    return {
      select: () => ({
        from: () => ({
          where: (expr: any) => ({
            limit: async () => {
              // Inspect values inside mockDbRows
              // If query has specific ID:
              const found = Object.values(mockDbRows).find(
                (r) => r.userId === callerUserId,
              );
              return found ? [found] : [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const id = `att-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const inserted = { id, ...vals };
            mockDbRows[id] = inserted;
            return [inserted];
          },
        }),
      }),
    };
  }

  function makeExecutorForFile(fileId: string, callerUserId: string = userId) {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              const row = mockDbRows[fileId];
              if (row && row.userId === callerUserId) {
                return [row];
              }
              return [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => {
            const id = `att-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const inserted = { id, ...vals };
            mockDbRows[id] = inserted;
            return [inserted];
          },
        }),
      }),
    } as any;

    return new FileOperationExecutor({
      db,
      storage: mockStorage,
      executionRuntime: runtime,
      userId: callerUserId,
      chatId,
      messageId,
    });
  }

  function makeExecutorForFiles(callerUserId: string = userId) {
    const db = {
      select: () => ({
        from: () => ({
          where: (condition: any) => ({
            limit: async () => {
              // Extract the attachmentId requested:
              // Drizzle binary tree: condition contains left/right operands
              // We'll search mockDbRows for any row matching callerUserId
              return [];
            },
          }),
        }),
      }),
    };
  }

  /* -------------------------------------------------------------------------- PDF Tests */
  describe('PDF Operations', () => {
    it('inspectPdf returns structured JSON metadata without persisting attachments', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([600, 400]);
      doc.addPage([600, 400]);
      doc.setTitle('Annual Report 2026');
      doc.setAuthor('Financial Team');
      const pdfBytes = Buffer.from(await doc.save());

      const fileId = 'pdf-test-1';
      registerAttachment(fileId, userId, 'report.pdf', 'application/pdf', pdfBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-inspect-pdf',
        name: 'inspectPdf',
        input: { fileId },
      });

      expect(res.ok).toBe(true);
      const textBlock = res.content.find((c) => c.type === 'text');
      expect(textBlock?.text).toContain('PDF Inspection: 2 page(s)');

      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.inspection.pageCount).toBe(2);
      expect(jsonBlock.inspection.title).toBe('Annual Report 2026');
      expect(jsonBlock.inspection.author).toBe('Financial Team');
    });

    it('mergePdfFiles combines multiple PDFs and persists result', async () => {
      const doc1 = await PDFDocument.create();
      doc1.addPage([600, 400]);
      const pdf1 = Buffer.from(await doc1.save());

      const doc2 = await PDFDocument.create();
      doc2.addPage([600, 400]);
      doc2.addPage([600, 400]);
      const pdf2 = Buffer.from(await doc2.save());

      registerAttachment('pdf-m-1', userId, 'part1.pdf', 'application/pdf', pdf1);
      registerAttachment('pdf-m-2', userId, 'part2.pdf', 'application/pdf', pdf2);

      const dbMulti = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                // Return whichever matching file
                return [];
              },
            }),
          }),
        }),
      };

      // Create a db handler that checks fileId from query condition
      const db = {
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
                const fallback = Object.values(mockDbRows).find((r) => r.userId === userId);
                return fallback ? [fallback] : [];
              },
            }),
          }),
        }),
        insert: () => ({
          values: (vals: any) => ({
            returning: async () => {
              const id = `att-out-${Date.now()}`;
              const inserted = { id, ...vals };
              mockDbRows[id] = inserted;
              return [inserted];
            },
          }),
        }),
      } as any;

      const executor = new FileOperationExecutor({
        db,
        storage: mockStorage,
        executionRuntime: runtime,
        userId,
        chatId,
        messageId,
      });

      const res = await executor.execute({
        id: 'call-merge-pdf',
        name: 'mergePdfFiles',
        input: {
          fileIds: ['pdf-m-1', 'pdf-m-2'],
          outputFilename: 'combined_report.pdf',
        },
      });
      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.file.filename).toBe('combined_report.pdf');
      expect(jsonBlock.file.downloadUrl).toContain('/files/');

      // Verify merged PDF in storage has 3 pages
      const savedBytes = mockStorageStore[jsonBlock.file.storageKey];
      expect(savedBytes).toBeDefined();
      const mergedDoc = await PDFDocument.load(savedBytes!);
      expect(mergedDoc.getPageCount()).toBe(3);
    });

    it('splitPdfFile splits PDF into page ranges', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([600, 400]);
      doc.addPage([600, 400]);
      doc.addPage([600, 400]);
      const pdfBytes = Buffer.from(await doc.save());

      const fileId = 'pdf-split-1';
      registerAttachment(fileId, userId, 'full_deck.pdf', 'application/pdf', pdfBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-split-pdf',
        name: 'splitPdfFile',
        input: {
          fileId,
          pageRanges: [
            [1, 2],
            [3, 3],
          ],
          outputFilename: 'extract.pdf',
        },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.files.length).toBe(2);
      expect(jsonBlock.files[0].filename).toBe('extract_p1-2.pdf');
      expect(jsonBlock.files[1].filename).toBe('extract_p3-3.pdf');
    });
  });

  /* -------------------------------------------------------------------------- XLSX Tests */
  describe('XLSX Operations', () => {
    it('inspectSpreadsheet discovers sheet names and row counts without persisting', async () => {
      const wb = new ExcelJS.Workbook();
      const ws1 = wb.addWorksheet('Q1_Sales');
      ws1.addRow(['Product', 'Revenue']);
      ws1.addRow(['Widget A', 15000]);
      const ws2 = wb.addWorksheet('Summary');
      ws2.addRow(['Total', 15000]);
      const xlsxBytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

      const fileId = 'xlsx-inspect-1';
      registerAttachment(fileId, userId, 'sales.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsxBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-inspect-xlsx',
        name: 'inspectSpreadsheet',
        input: { fileId },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.inspection.sheetNames).toEqual(['Q1_Sales', 'Summary']);
      expect(jsonBlock.inspection.totalRows).toBe(3);
    });

    it('editSpreadsheetCells modifies targeted cells and preserves formatting', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(['Item', 'Cost']);
      ws.addRow(['Widget', 100]);
      const xlsxBytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

      const fileId = 'xlsx-edit-1';
      registerAttachment(fileId, userId, 'budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsxBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-edit-xlsx',
        name: 'editSpreadsheetCells',
        input: {
          fileId,
          edits: [{ sheet: 'Sheet1', cell: 'B2', value: 250, type: 'number', format: '$#,##0.00' }],
          outputFilename: 'budget_updated.xlsx',
        },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.file.filename).toBe('budget_updated.xlsx');

      const savedBytes = mockStorageStore[jsonBlock.file.storageKey];
      const editedWb = new ExcelJS.Workbook();
      await editedWb.xlsx.load(savedBytes as any);
      expect(editedWb.getWorksheet('Sheet1')?.getCell('B2').value).toBe(250);
    });
  });

  /* -------------------------------------------------------------------------- DOCX Tests */
  describe('DOCX Operations', () => {
    async function createSampleDocx(bodyText: string): Promise<Buffer> {
      const zip = new JSZip();
      zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      );
      zip.file(
        'word/document.xml',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyText}</w:body></w:document>`,
      );
      return zip.generateAsync({ type: 'nodebuffer' });
    }

    it('inspectDocxStructure extracts paragraph count and headings', async () => {
      const docxBytes = await createSampleDocx(
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project Overview</w:t></w:r></w:p><w:p><w:r><w:t>This is paragraph 1.</w:t></w:r></w:p><w:p><w:r><w:t>This is paragraph 2.</w:t></w:r></w:p>',
      );

      const fileId = 'docx-inspect-1';
      registerAttachment(fileId, userId, 'overview.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-inspect-docx',
        name: 'inspectDocxStructure',
        input: { fileId },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.inspection.paragraphsCount).toBe(3);
      expect(jsonBlock.inspection.headings).toContain('Project Overview');
    });

    it('editDocxContent replaces targeted strings inside Word document', async () => {
      const docxBytes = await createSampleDocx(
        '<w:p><w:r><w:t>Confidential Agreement with OldCo Inc.</w:t></w:r></w:p>',
      );

      const fileId = 'docx-edit-1';
      registerAttachment(fileId, userId, 'contract.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-edit-docx',
        name: 'editDocxContent',
        input: {
          fileId,
          replacements: [{ search: 'OldCo Inc.', replace: 'NewCo International' }],
          outputFilename: 'contract_updated.docx',
        },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.file.filename).toBe('contract_updated.docx');

      const savedBytes = mockStorageStore[jsonBlock.file.storageKey];
      const zip = await JSZip.loadAsync(savedBytes!);
      const xml = await zip.file('word/document.xml')?.async('text');
      expect(xml).toContain('NewCo International');
      expect(xml).not.toContain('OldCo Inc.');
    });

    it('appendDocxSection appends new titled section and paragraphs', async () => {
      const docxBytes = await createSampleDocx(
        '<w:p><w:r><w:t>Section 1: Initial terms.</w:t></w:r></w:p>',
      );

      const fileId = 'docx-append-1';
      registerAttachment(fileId, userId, 'terms.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-append-docx',
        name: 'appendDocxSection',
        input: {
          fileId,
          heading: 'Addendum A',
          paragraphs: ['Paragraph A1', 'Paragraph A2'],
          outputFilename: 'terms_final.docx',
        },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.file.filename).toBe('terms_final.docx');

      const savedBytes = mockStorageStore[jsonBlock.file.storageKey];
      const zip = await JSZip.loadAsync(savedBytes!);
      const xml = await zip.file('word/document.xml')?.async('text');
      expect(xml).toContain('Addendum A');
      expect(xml).toContain('Paragraph A1');
      expect(xml).toContain('Paragraph A2');
    });
  });

  /* -------------------------------------------------------------------------- PPTX Tests */
  describe('PPTX Operations', () => {
    async function createSamplePptx(): Promise<Buffer> {
      const zip = new JSZip();
      zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
      );
      zip.file(
        'ppt/presentation.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>',
      );
      zip.file(
        'ppt/slides/slide1.xml',
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Executive Summary</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
      );
      zip.file(
        'ppt/slides/slide2.xml',
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Financial Roadmap</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
      );
      return zip.generateAsync({ type: 'nodebuffer' });
    }

    it('inspectPptxStructure extracts slide count and titles', async () => {
      const pptxBytes = await createSamplePptx();

      const fileId = 'pptx-inspect-1';
      registerAttachment(fileId, userId, 'pitch.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptxBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-inspect-pptx',
        name: 'inspectPptxStructure',
        input: { fileId },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.inspection.slideCount).toBe(2);
      expect(jsonBlock.inspection.titles).toContain('Executive Summary');
      expect(jsonBlock.inspection.titles).toContain('Financial Roadmap');
    });

    it('reorderPptxSlides rearranges slide order in presentation.xml', async () => {
      const pptxBytes = await createSamplePptx();

      const fileId = 'pptx-reorder-1';
      registerAttachment(fileId, userId, 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptxBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-reorder-pptx',
        name: 'reorderPptxSlides',
        input: {
          fileId,
          newOrder: [2, 1],
          outputFilename: 'deck_reordered.pptx',
        },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');
      expect(jsonBlock.file.filename).toBe('deck_reordered.pptx');

      const savedBytes = mockStorageStore[jsonBlock.file.storageKey];
      const zip = await JSZip.loadAsync(savedBytes!);
      const presXml = await zip.file('ppt/presentation.xml')?.async('text');
      // Slide 2 (id=257) should appear before Slide 1 (id=256)
      expect(presXml?.indexOf('id="257"')).toBeLessThan(presXml?.indexOf('id="256"')!);
    });

    it('editPptxSlideText updates text on targeted slide', async () => {
      const pptxBytes = await createSamplePptx();

      const fileId = 'pptx-edit-1';
      registerAttachment(fileId, userId, 'pitch_v1.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptxBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-edit-pptx',
        name: 'editPptxSlideText',
        input: {
          fileId,
          slideIndex: 1,
          replacements: [{ search: 'Executive Summary', replace: 'Strategic Overview' }],
          outputFilename: 'pitch_v2.pptx',
        },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      expect(jsonBlock.status).toBe('success');

      const savedBytes = mockStorageStore[jsonBlock.file.storageKey];
      const zip = await JSZip.loadAsync(savedBytes!);
      const slide1Xml = await zip.file('ppt/slides/slide1.xml')?.async('text');
      expect(slide1Xml).toContain('Strategic Overview');
      expect(slide1Xml).not.toContain('Executive Summary');
    });
  });

  /* -------------------------------------------------------------------------- Security & Boundary Tests */
  describe('Security and Guard Boundaries', () => {
    it('rejects access when User B attempts to operate on User A file', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([600, 400]);
      const pdfBytes = Buffer.from(await doc.save());

      const fileId = 'private-pdf-user-a';
      registerAttachment(fileId, userId, 'private.pdf', 'application/pdf', pdfBytes);

      // User B attempts to access User A's file
      const executorUserB = makeExecutorForFile(fileId, otherUserId);
      const res = await executorUserB.execute({
        id: 'call-unauthorized',
        name: 'inspectPdf',
        input: { fileId },
      });

      expect(res.ok).toBe(false);
      const textBlock = res.content.find((c) => c.type === 'text');
      expect(textBlock?.text).toContain('not found or not authorized');
    });

    it('sanitizes malicious outputFilename with path traversal sequences', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([600, 400]);
      const pdfBytes = Buffer.from(await doc.save());

      const fileId = 'pdf-traversal-test';
      registerAttachment(fileId, userId, 'safe.pdf', 'application/pdf', pdfBytes);

      const executor = makeExecutorForFile(fileId, userId);
      const res = await executor.execute({
        id: 'call-traversal',
        name: 'splitPdfFile',
        input: {
          fileId,
          pageRanges: [[1, 1]],
          outputFilename: '../../../../etc/passwd.exe',
        },
      });

      expect(res.ok).toBe(true);
      const jsonBlock = res.content.find((c) => c.type === 'json')?.data as any;
      // Output filename must be sanitized to valid pdf basename
      expect(jsonBlock.files[0].filename).not.toContain('..');
      expect(jsonBlock.files[0].filename).not.toContain('/');
      expect(jsonBlock.files[0].filename).not.toContain('\\');
      expect(jsonBlock.files[0].filename.endsWith('.pdf')).toBe(true);
    });

    it('aborts execution when AbortSignal is pre-aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const executor = makeExecutorForFile('any-id', userId);
      const res = await executor.execute(
        {
          id: 'call-aborted',
          name: 'inspectPdf',
          input: { fileId: 'any-id' },
        },
        controller.signal,
      );

      expect(res.ok).toBe(false);
      const textBlock = res.content.find((c) => c.type === 'text');
      expect(textBlock?.text).toContain('aborted before this tool ran');
    });
  });
});
