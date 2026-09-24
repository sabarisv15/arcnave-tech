/**
 * G20: the sandbox's three grants are separate. Rendering with a trusted CLI utility must work
 * with arbitrary Python off, and neither grant may stand in for the other.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { ExecutionRuntime, RuntimePermissionError } from './executionRuntime.js';
import { ProcessSandboxClient } from '../sandbox/processSandboxClient.js';

const cliOnly = { pythonAllowed: false, trustedCliAllowed: true, skillScriptAllowed: false };

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 100]);
  return doc.save();
}

describe('ExecutionRuntime permissions (G20)', () => {
  it('renders a PDF page with pdftoppm when only the trusted CLI is granted', async () => {
    const runtime = new ExecutionRuntime(new ProcessSandboxClient(), undefined, cliOnly);
    await runtime.withWorkspace(`perm_cli_${Date.now()}`, async (ws) => {
      await fs.writeFile(path.join(ws.inputDir, 'doc.pdf'), await onePagePdf());
      const res = await runtime.executeControlledCli(
        'pdftoppm',
        ['-r', '36', '-png', 'input/doc.pdf', 'output/page'],
        { cwd: ws.workspaceDir, expectedOutputs: ['page-1.png'] },
      );
      expect(res.exitCode).toBe(0);
      const png = await fs.readFile(path.join(ws.outputDir, 'page-1.png'));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
    });
  });

  it('refuses model-written Python under a CLI-only grant', async () => {
    const runtime = new ExecutionRuntime(new ProcessSandboxClient(), undefined, cliOnly);
    await expect(runtime.executePython('print(1)')).rejects.toBeInstanceOf(RuntimePermissionError);
  });

  it('refuses the CLI when only Python is granted', async () => {
    const runtime = new ExecutionRuntime(new ProcessSandboxClient(), undefined, {
      pythonAllowed: true,
      trustedCliAllowed: false,
      skillScriptAllowed: false,
    });
    await expect(runtime.executeControlledCli('pdftoppm', ['-v'])).rejects.toBeInstanceOf(RuntimePermissionError);
  });

  it('can() needs both a sandbox and the grant', () => {
    expect(new ExecutionRuntime(undefined, undefined, cliOnly).can('trustedCliAllowed')).toBe(false);
    const runtime = new ExecutionRuntime(new ProcessSandboxClient(), undefined, cliOnly);
    expect(runtime.can('trustedCliAllowed')).toBe(true);
    expect(runtime.can('pythonAllowed')).toBe(false);
    expect(runtime.can('skillScriptAllowed')).toBe(false);
  });
});
