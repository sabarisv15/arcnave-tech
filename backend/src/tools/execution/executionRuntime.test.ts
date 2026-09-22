import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { ExecutionRuntime } from './executionRuntime.js';

describe('ExecutionRuntime', () => {
  it('manages file workspace lifecycle: creation, materialization, collection, cleanup', async () => {
    const runtime = new ExecutionRuntime();
    const runId = `test_run_${Date.now()}`;

    // 1. Create workspace
    const workspace = await runtime.createWorkspace(runId);
    expect(workspace.workspaceDir).toBeDefined();

    // 2. Materialize input files
    const written = await runtime.materializeInputFiles(workspace, [
      { filename: 'data.csv', data: 'col1,col2\nval1,val2' },
      { filename: 'image.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ]);
    expect(written.length).toBe(2);
    expect(await fs.readFile(path.join(workspace.inputDir, 'data.csv'), 'utf8')).toContain('val1,val2');

    // 3. Write dummy output file and collect
    await fs.writeFile(path.join(workspace.outputDir, 'report.docx'), Buffer.from('dummy docx'));
    const outputs = await runtime.collectOutputFiles(workspace);
    expect(outputs.length).toBe(1);
    expect(outputs[0]?.filename).toBe('report.docx');
    expect(outputs[0]?.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    // 4. Cleanup workspace
    await runtime.cleanupWorkspace(workspace);
    await expect(fs.access(workspace.workspaceDir)).rejects.toThrow();
  });

  it('validates OOXML packages accurately (structural check)', async () => {
    const runtime = new ExecutionRuntime();

    // 1. Valid XLSX OOXML mock package
    const validZip = new JSZip();
    validZip.file('[Content_Types].xml', '<Types></Types>');
    validZip.file('xl/workbook.xml', '<workbook></workbook>');
    const validBuffer = await validZip.generateAsync({ type: 'nodebuffer' });

    const validResult = await runtime.validateOoxmlPackage(validBuffer);
    expect(validResult.valid).toBe(true);
    expect(validResult.format).toBe('xlsx');
    expect(validResult.hasContentTypes).toBe(true);
    expect(validResult.errors).toEqual([]);

    // 2. Corrupt package (missing [Content_Types].xml)
    const corruptZip = new JSZip();
    corruptZip.file('xl/workbook.xml', '<workbook></workbook>');
    const corruptBuffer = await corruptZip.generateAsync({ type: 'nodebuffer' });

    const corruptResult = await runtime.validateOoxmlPackage(corruptBuffer);
    expect(corruptResult.valid).toBe(false);
    expect(corruptResult.hasContentTypes).toBe(false);
    expect(corruptResult.errors.length).toBeGreaterThan(0);

    // 3. Non-zip buffer
    const nonZipBuffer = Buffer.from('This is not a zip file at all');
    const nonZipResult = await runtime.validateOoxmlPackage(nonZipBuffer);
    expect(nonZipResult.valid).toBe(false);
    expect(nonZipResult.errors[0]).toContain('Invalid ZIP');
  });

  it('strictly enforces CLI allowlist and blocks shell injection control characters', async () => {
    const runtime = new ExecutionRuntime();

    // Utility not in allowlist
    await expect(runtime.executeControlledCli('rm', ['-rf', '/'])).rejects.toThrow(
      'not in the approved security allowlist',
    );

    // Disallowed control characters in arguments
    await expect(runtime.executeControlledCli('pdftotext', ['input.pdf; rm -rf /'])).rejects.toThrow(
      'disallowed shell control characters',
    );
  });

  it('renders documents safely via internal Node engine', async () => {
    const runtime = new ExecutionRuntime();

    const result = await runtime.renderDocument('# Sample Document\n\nThis is a test.', 'docx');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});
