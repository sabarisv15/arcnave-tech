import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';

import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';
import { CodeExecutionToolExecutor } from '../tools/codeExecutionExecutor.js';
import { visualQaEngine } from '../services/qa/visualQaEngine.js';

describe('Python Output QA & Corruption Persistence Blocking', () => {
  it('Test A: persists valid PDF output and completes structural + visual QA', async () => {
    let capturedWs: any = null;
    const mockStorageMap = new Map<string, Buffer>();
    const mockStorage = {
      put: async (key: string, data: Buffer) => {
        mockStorageMap.set(key, data);
      },
      get: async (key: string) => mockStorageMap.get(key),
    } as any;

    const mockDb = {
      insert: () => ({
        values: (val: any) => ({
          returning: async () => [
            {
              id: 'att-pdf-1',
              userId: val.userId,
              filename: val.filename,
              mimeType: val.mimeType,
              sizeBytes: val.sizeBytes,
            },
          ],
        }),
      }),
    } as any;

    // Create valid minimal PDF
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([400, 300]);
    const validPdfBytes = Buffer.from(await pdfDoc.save());

    const mockSandbox = {
      runPython: async () => {
        // Simulate python script writing valid PDF to output/
        if (capturedWs) {
          await fs.writeFile(path.join(capturedWs.outputDir, 'report.pdf'), validPdfBytes);
        }
        return {
          outputs: [
            {
              mimeType: 'application/json',
              text: JSON.stringify({ msg_out: 'Report generated successfully\n', msg_err: '' }),
            },
          ],
        };
      },
    } as any;

    const runtime = new ExecutionRuntime(mockSandbox);
    const ws = await runtime.createWorkspace(`py_qa_test_${Date.now()}`);
    capturedWs = ws;

    try {
      const executor = new CodeExecutionToolExecutor(
        runtime,
        8000,
        {
          workspace: ws,
          userId: 'user-py-test',
          messageId: 'msg-py-test',
          db: mockDb,
          storage: mockStorage,
        },
      );

      const res = await executor.execute(
        {
          id: 'call-py-1',
          name: 'run_python',
          input: { code: 'generate_pdf()' },
        },
        new AbortController().signal,
      );

      expect(res.ok).toBe(true);
      const data = (res.content[0] as any).data;
      expect(data.persistedFiles).toHaveLength(1);
      expect(data.persistedFiles[0].filename).toBe('report.pdf');
      expect(mockStorageMap.size).toBe(1);

      // Verify no structural corruption warnings were emitted
      const warnings = (data.warnings || []) as any[];
      const structCorruptions = warnings.filter((w) => w.type === 'structural_corruption');
      expect(structCorruptions).toHaveLength(0);
    } finally {
      await runtime.cleanupWorkspace(ws);
    }
  });

  it('Test B: blocks persistence of corrupted DOCX/XLSX/PPTX outputs and returns repairable warning', async () => {
    let capturedWs: any = null;
    const mockStorageMap = new Map<string, Buffer>();
    const mockStorage = {
      put: async (key: string, data: Buffer) => {
        mockStorageMap.set(key, data);
      },
      get: async (key: string) => mockStorageMap.get(key),
    } as any;

    const mockDb = {
      insert: () => ({
        values: (val: any) => ({
          returning: async () => [
            {
              id: 'att-corrupt-1',
              userId: val.userId,
              filename: val.filename,
              mimeType: val.mimeType,
              sizeBytes: val.sizeBytes,
            },
          ],
        }),
      }),
    } as any;

    const mockSandbox = {
      runPython: async () => {
        if (capturedWs) {
          await fs.writeFile(path.join(capturedWs.outputDir, 'corrupt.docx'), Buffer.from('NOT A VALID ZIP FILE'));
        }
        return {
          outputs: [
            {
              mimeType: 'application/json',
              text: JSON.stringify({ msg_out: 'Done\n', msg_err: '' }),
            },
          ],
        };
      },
    } as any;

    const runtime = new ExecutionRuntime(mockSandbox);
    const ws = await runtime.createWorkspace(`py_corrupt_test_${Date.now()}`);
    capturedWs = ws;

    try {
      const executor = new CodeExecutionToolExecutor(
        runtime,
        8000,
        {
          workspace: ws,
          userId: 'user-py-test',
          messageId: 'msg-py-test',
          db: mockDb,
          storage: mockStorage,
        },
      );

      const res = await executor.execute(
        {
          id: 'call-py-2',
          name: 'run_python',
          input: { code: 'generate_corrupt_docx()' },
        },
        new AbortController().signal,
      );

      expect(res.ok).toBe(true);
      const data = (res.content[0] as any).data;

      // Persistence must be BLOCKED: persistedFiles must be empty or undefined
      expect(data.persistedFiles).toBeUndefined();
      expect(mockStorageMap.size).toBe(0);

      // File must be deleted from outputDir
      const remainingOutputs = await fs.readdir(ws.outputDir);
      expect(remainingOutputs).not.toContain('corrupt.docx');

      // Model must receive repairable warning
      expect(data.repairable).toBe(true);
      const warnings = data.warnings as any[];
      expect(warnings).toBeDefined();
      const corruptWarning = warnings.find((w) => w.type === 'structural_corruption');
      expect(corruptWarning).toBeDefined();
      expect(corruptWarning.repairable).toBe(true);
      expect(corruptWarning.message).toContain('failed structural verification');
    } finally {
      await runtime.cleanupWorkspace(ws);
    }
  });

  it('Test C: preserves structural success and surfaces diagnostic when Office renderer is unavailable', async () => {
    let capturedWs: any = null;
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      'word/document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello QA Fallback</w:t></w:r></w:p></w:body></w:document>',
    );
    const validDocxBytes = await zip.generateAsync({ type: 'nodebuffer' });

    const evalSpy = vi.spyOn(visualQaEngine, 'evaluateVisualQa').mockResolvedValueOnce({
      status: 'not_checked',
      passed: false,
      defects: [],
      previewAvailable: false,
      diagnostics: ['QA RENDERER FAILURE: Headless Office conversion exited with code 1: Mocked missing binary'],
    });

    const mockStorageMap = new Map<string, Buffer>();
    const mockStorage = {
      put: async (key: string, data: Buffer) => {
        mockStorageMap.set(key, data);
      },
      get: async (key: string) => mockStorageMap.get(key),
    } as any;

    const mockDb = {
      insert: () => ({
        values: (val: any) => ({
          returning: async () => [
            {
              id: 'att-valid-docx',
              userId: val.userId,
              filename: val.filename,
              mimeType: val.mimeType,
              sizeBytes: val.sizeBytes,
            },
          ],
        }),
      }),
    } as any;

    const mockSandbox = {
      runPython: async () => {
        if (capturedWs) {
          await fs.writeFile(path.join(capturedWs.outputDir, 'document.docx'), validDocxBytes);
        }
        return {
          outputs: [
            {
              mimeType: 'application/json',
              text: JSON.stringify({ msg_out: 'Generated document.docx\n', msg_err: '' }),
            },
          ],
        };
      },
    } as any;

    const runtime = new ExecutionRuntime(mockSandbox);
    const ws = await runtime.createWorkspace(`py_renderer_fallback_${Date.now()}`);
    capturedWs = ws;

    try {
      const executor = new CodeExecutionToolExecutor(
        runtime,
        8000,
        {
          workspace: ws,
          userId: 'user-py-test',
          messageId: 'msg-py-test',
          db: mockDb,
          storage: mockStorage,
        },
      );

      const res = await executor.execute(
        {
          id: 'call-py-3',
          name: 'run_python',
          input: { code: 'generate_docx()' },
        },
        new AbortController().signal,
      );

      expect(res.ok).toBe(true);
      const data = (res.content[0] as any).data;

      // Structural success is preserved: valid docx is persisted despite renderer failure
      expect(data.persistedFiles).toHaveLength(1);
      expect(data.persistedFiles[0].filename).toBe('document.docx');
      expect(mockStorageMap.size).toBe(1);

      // Warning includes renderer diagnostic with repairable: false
      const warnings = data.warnings as any[];
      expect(warnings).toBeDefined();
      const diagWarning = warnings.find((w) => w.type === 'visual_qa_diagnostic');
      expect(diagWarning).toBeDefined();
      expect(diagWarning.message).toContain('QA RENDERER FAILURE');
      expect(diagWarning.repairable).toBe(false);

      evalSpy.mockRestore();
    } finally {
      await runtime.cleanupWorkspace(ws);
    }
  });
});
