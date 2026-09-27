import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { ExecutionRuntime } from './executionRuntime.js';
import type { SandboxClient } from '../sandbox/client.js';
import { ProcessSandboxClient } from '../sandbox/processSandboxClient.js';
import { CodeExecutionToolExecutor } from '../codeExecutionExecutor.js';

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

  it('enforces guaranteed cleanup in withWorkspace even if an error is thrown', async () => {
    const runtime = new ExecutionRuntime();
    let capturedWorkspaceDir = '';

    await expect(
      runtime.withWorkspace(`error_run_${Date.now()}`, async (ws) => {
        capturedWorkspaceDir = ws.workspaceDir;
        await fs.writeFile(path.join(ws.inputDir, 'temp.txt'), 'hello');
        throw new Error('Simulated task failure');
      }),
    ).rejects.toThrow('Simulated task failure');

    // Verify workspace was cleaned up despite the thrown error
    expect(capturedWorkspaceDir).toBeTruthy();
    await expect(fs.access(capturedWorkspaceDir)).rejects.toThrow();
  });

  it('sanitizes input filenames and prevents path traversal escaping inputDir', async () => {
    const runtime = new ExecutionRuntime();
    const runId = `traversal_test_${Date.now()}`;
    const workspace = await runtime.createWorkspace(runId);

    try {
      const written = await runtime.materializeInputFiles(workspace, [
        { filename: '../../../../etc/passwd', data: 'malicious' },
        { filename: 'safe-file.txt', data: 'safe content' },
      ]);

      expect(written.length).toBe(2);
      // Ensure the traversal filename was flattened to a basename inside inputDir
      const resolvedInput = path.resolve(workspace.inputDir);
      for (const p of written) {
        expect(p.startsWith(resolvedInput)).toBe(true);
      }
      expect(await fs.readFile(path.join(workspace.inputDir, 'passwd'), 'utf8')).toBe('malicious');
    } finally {
      await runtime.cleanupWorkspace(workspace);
    }
  });

  it('materializes authorized user attachments from storage into workspace', async () => {
    const runtime = new ExecutionRuntime();
    const runId = `attachment_test_${Date.now()}`;
    const workspace = await runtime.createWorkspace(runId);

    const mockStorage = {
      // Streams to a path in the real storage; here it writes what get() returns.
      async downloadTo(this: { get: (key: string) => Promise<Buffer> }, key: string, dest: string) {
        await (await import('node:fs/promises')).writeFile(dest, await this.get(key));
      },
      get: async (key: string) => Buffer.from(`contents of ${key}`),
      put: async () => {},
    } as any;

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                id: 'att-123',
                userId: 'user-456',
                filename: 'Quarterly Report.xlsx',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                sizeBytes: 100,
                storageKey: 'users/user-456/raw_report.xlsx',
              },
            ],
          }),
        }),
      }),
    } as any;

    try {
      const result = await runtime.materializeAttachment(
        workspace,
        'att-123',
        'user-456',
        mockDb,
        mockStorage,
      );

      expect(result.attachmentId).toBe('att-123');
      expect(result.filename).toBe('Quarterly_Report.xlsx');
      expect(await fs.readFile(result.path, 'utf8')).toBe('contents of users/user-456/raw_report.xlsx');
    } finally {
      await runtime.cleanupWorkspace(workspace);
    }
  });

  it('rejects attachment materialization when user is unauthorized', async () => {
    const runtime = new ExecutionRuntime();
    const runId = `auth_test_${Date.now()}`;
    const workspace = await runtime.createWorkspace(runId);

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [], // Not found for this user
          }),
        }),
      }),
    } as any;

    try {
      await expect(
        runtime.materializeAttachment(workspace, 'att-999', 'wrong-user', mockDb, {} as any),
      ).rejects.toThrow('not found or not authorized');
    } finally {
      await runtime.cleanupWorkspace(workspace);
    }
  });

  it('persists generated workspace outputs into storage and database', async () => {
    const runtime = new ExecutionRuntime();
    const runId = `persist_test_${Date.now()}`;
    const workspace = await runtime.createWorkspace(runId);

    // Create a mock deliverable in output/
    await fs.writeFile(path.join(workspace.outputDir, 'chart.png'), Buffer.from('fake png image'));

    const storedFiles: Record<string, Buffer> = {};
    const mockStorage = {
      put: async (key: string, data: Buffer) => {
        storedFiles[key] = data;
      },
      // Streams to a path in the real storage; here it writes what get() returns.
      async downloadTo(this: { get: (key: string) => Promise<Buffer> }, key: string, dest: string) {
        await (await import('node:fs/promises')).writeFile(dest, await this.get(key));
      },
      get: async (key: string) => storedFiles[key]!,
    } as any;

    const mockDb = {
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => [{ id: 'new-att-id-1', ...vals }],
        }),
      }),
    } as any;

    try {
      const persisted = await runtime.persistOutputFiles(workspace, {
        userId: 'user-1',
        messageId: 'msg-1',
        db: mockDb,
        storage: mockStorage,
      });

      expect(persisted.length).toBe(1);
      expect(persisted[0]?.filename).toBe('chart.png');
      expect(persisted[0]?.downloadUrl).toBe('/files/new-att-id-1/download');
      expect(Object.keys(storedFiles).length).toBe(1);
    } finally {
      await runtime.cleanupWorkspace(workspace);
    }
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

  it('fails closed when host CLI execution is attempted without sandbox client and ALLOW_HOST_CLI is false', async () => {
    const origAllow = process.env.ALLOW_HOST_CLI;
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.ALLOW_HOST_CLI = 'false';
      const runtime = new ExecutionRuntime(); // no sandboxClient
      await expect(runtime.executeControlledCli('pdftotext', ['--version'])).rejects.toThrow(
        'Native CLI execution on host is disabled',
      );
    } finally {
      process.env.ALLOW_HOST_CLI = origAllow;
      process.env.NODE_ENV = origEnv;
    }
  });

  it('routes controlled CLI commands to sandboxClient when configured', async () => {
    const fakeSandboxClient: SandboxClient = {
      runPython: vi.fn().mockResolvedValue({
        outputs: [
          {
            mimeType: 'application/json',
            text: JSON.stringify({
              msg_out: JSON.stringify({
                stdout: 'pdftotext version 25.03.0',
                stderr: '',
                exitCode: 0,
              }),
              msg_err: '',
            }),
          },
        ],
      }),
    };

    const runtime = new ExecutionRuntime(fakeSandboxClient);
    const result = await runtime.executeControlledCli('pdftotext', ['-v']);

    expect(fakeSandboxClient.runPython).toHaveBeenCalledOnce();
    const calledCode = (fakeSandboxClient.runPython as any).mock.calls[0][0];
    expect(calledCode).toContain('"pdftotext"');
    expect(calledCode).toContain('subprocess.run');
    expect(result.stdout).toBe('pdftotext version 25.03.0');
    expect(result.exitCode).toBe(0);
  });

  it('renders documents safely via internal Node engine', async () => {
    const runtime = new ExecutionRuntime();

    const result = await runtime.renderDocument('# Sample Document\n\nThis is a test.', 'docx');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('executes real Python code in isolated workspace reading input and writing output', async () => {
    const runtime = new ExecutionRuntime(new ProcessSandboxClient({ codeTimeoutMs: 15_000 }));
    const runId = `python_real_${Date.now()}`;
    const workspace = await runtime.createWorkspace(runId);

    try {
      // 1. Stage input CSV file
      await runtime.materializeInputFiles(workspace, [
        {
          filename: 'values.csv',
          data: 'num\n10\n20\n30\n40\n',
        },
      ]);

      // 2. Python code reading from input/values.csv and writing to output/result.txt
      const code = `
import csv

with open('input/values.csv') as f:
    reader = csv.DictReader(f)
    nums = [int(r['num']) for r in reader]

mean_val = sum(nums) / len(nums)
print(f"Calculated mean: {mean_val}")

with open('output/result.txt', 'w') as out:
    out.write(f"MEAN={mean_val}")
`;

      const result = await runtime.executePython(code, workspace, new AbortController().signal);
      expect(result.outputs.length).toBeGreaterThan(0);
      const jsonOutput = JSON.parse(result.outputs[0]!.text);
      expect(jsonOutput.msg_out).toContain('Calculated mean: 25.0');
      expect(jsonOutput.exit_code).toBe(0);

      // 3. Verify output file was written to output/
      const outputs = await runtime.collectOutputFiles(workspace);
      expect(outputs.length).toBe(1);
      expect(outputs[0]?.filename).toBe('result.txt');
      expect(outputs[0]?.data.toString('utf-8')).toBe('MEAN=25.0');
    } finally {
      await runtime.cleanupWorkspace(workspace);
    }
  });

  it('CodeExecutionToolExecutor stores a file only when present_files hands it over', async () => {
    const runtime = new ExecutionRuntime(new ProcessSandboxClient());
    const runId = `tool_persist_${Date.now()}`;
    const workspace = await runtime.createWorkspace(runId);

    const storedFiles: Record<string, Buffer> = {};
    const mockStorage = {
      put: async (key: string, data: Buffer) => {
        storedFiles[key] = data;
      },
      // Streams to a path in the real storage; here it writes what get() returns.
      async downloadTo(this: { get: (key: string) => Promise<Buffer> }, key: string, dest: string) {
        await (await import('node:fs/promises')).writeFile(dest, await this.get(key));
      },
      get: async (key: string) => storedFiles[key]!,
    } as any;

    const mockDb = {
      insert: () => ({
        values: (vals: any) => ({
          returning: async () => [{ id: 'saved-chart-id', ...vals }],
        }),
      }),
    } as any;

    const executor = new CodeExecutionToolExecutor(runtime, 8000, {
      workspace,
      userId: 'test-user',
      messageId: 'test-msg',
      db: mockDb,
      storage: mockStorage,
    });

    try {
      const ran = await executor.execute(
        { id: 'call-1', name: 'bash_tool', input: { command: 'mkdir -p output && echo done > output/analysis.txt && echo Completed job', description: 'x' } },
        new AbortController().signal,
      );
      expect(ran.ok).toBe(true);
      const ranData = (ran.content[0] as { data: any }).data;
      expect(ranData.stdout).toContain('Completed job');
      expect(ranData.persistedFiles).toBeUndefined();

      const result = await executor.execute(
        { id: 'call-2', name: 'present_files', input: { filepaths: ['output/analysis.txt'] } },
        new AbortController().signal,
      );
      expect(result.ok).toBe(true);
      const block = result.content[0] as { type: string; data: any };
      expect(block.data.persistedFiles.length).toBe(1);
      expect(block.data.persistedFiles[0].filename).toBe('analysis.txt');
      expect(block.data.persistedFiles[0].downloadUrl).toBe('/files/saved-chart-id/download');
    } finally {
      await runtime.cleanupWorkspace(workspace);
    }
  });

  it('guarantees complete isolation between concurrent runs A and B', async () => {
    const runtime = new ExecutionRuntime();
    const runA = await runtime.createWorkspace(`run_A_${Date.now()}`);
    const runB = await runtime.createWorkspace(`run_B_${Date.now()}`);

    try {
      // Stage files in Run A
      await runtime.materializeInputFiles(runA, [{ filename: 'secret_a.txt', data: 'confidential A' }]);
      await fs.writeFile(path.join(runA.outputDir, 'output_a.txt'), 'result A');

      // Verify Run B workspace does NOT contain Run A files
      const bInputs = await fs.readdir(runB.inputDir);
      const bOutputs = await runtime.collectOutputFiles(runB);
      expect(bInputs).toEqual([]);
      expect(bOutputs).toEqual([]);

      // Verify directory paths are completely disjoint
      expect(runA.workspaceDir).not.toBe(runB.workspaceDir);
      expect(path.resolve(runA.workspaceDir)).not.toContain(runB.workspaceDir);
      expect(path.resolve(runB.workspaceDir)).not.toContain(runA.workspaceDir);
    } finally {
      await runtime.cleanupWorkspace(runA);
      await runtime.cleanupWorkspace(runB);
    }
  });

  it('cleans up workspace under timeout and client abort via withWorkspace', async () => {
    const runtime = new ExecutionRuntime();
    let capturedWorkspaceDir = '';

    // Simulate client abort inside withWorkspace
    const controller = new AbortController();
    await expect(
      runtime.withWorkspace(`abort_run_${Date.now()}`, async (ws) => {
        capturedWorkspaceDir = ws.workspaceDir;
        await fs.writeFile(path.join(ws.tempDir, 'temp_state.dat'), 'in-flight data');
        controller.abort();
        if (controller.signal.aborted) {
          throw new Error('Operation aborted by client');
        }
      }),
    ).rejects.toThrow('Operation aborted by client');

    // Verify workspace directory was deleted on abort
    expect(capturedWorkspaceDir).toBeTruthy();
    await expect(fs.access(capturedWorkspaceDir)).rejects.toThrow();
  });

  it('fails closed when no sandboxClient is provided — never silently executes host Python', async () => {
    const runtime = new ExecutionRuntime(undefined); // Explicitly no sandbox client
    const ws = await runtime.createWorkspace(`fail_closed_${Date.now()}`);

    try {
      await expect(
        runtime.executePython('print("This should never run on host")', ws),
      ).rejects.toThrow('Python sandbox execution is disabled or unavailable');
    } finally {
      await runtime.cleanupWorkspace(ws);
    }
  });

  describe('executeTrustedSkillScript', () => {
    it('rejects disallowed script extensions (only .py is permitted in sandbox)', async () => {
      const runtime = new ExecutionRuntime();
      const mockSkillService = {
        getSkillResource: vi.fn(),
      } as any;

      const res = await runtime.executeTrustedSkillScript(
        { skill: 'xlsx', resource: 'scripts/helper.js' },
        {},
        undefined,
        mockSkillService,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('Only packaged ".py" scripts are approved');
    });

    it('rejects when script resolution fails or path traversal is detected', async () => {
      const runtime = new ExecutionRuntime();
      const mockSkillService = {
        getSkillResource: vi.fn().mockResolvedValue(null), // traversal or missing
      } as any;

      const res = await runtime.executeTrustedSkillScript(
        { skill: 'xlsx', resource: '../../escape.py' },
        {},
        undefined,
        mockSkillService,
      );

      expect(res.ok).toBe(false);
      expect(res.error).toContain('could not be resolved or was outside skill directory boundary');
    });

    it('executes valid trusted Python script via sandboxClient', async () => {
      const mockSandbox: SandboxClient = {
        runPython: vi.fn().mockResolvedValue({
          exitCode: 0,
          outputs: [{ type: 'stdout', text: '{"verified": true}' }],
          rawLogs: '',
          durationMs: 120,
        }),
      } as any;

      const runtime = new ExecutionRuntime(mockSandbox);
      const mockSkillService = {
        getSkillResource: vi.fn().mockResolvedValue('print("{\\"verified\\": true}")'),
      } as any;

      const res = await runtime.executeTrustedSkillScript(
        { skill: 'xlsx', resource: 'scripts/validate.py' },
        { test: 123 },
        undefined,
        mockSkillService,
      );

      expect(res.ok).toBe(true);
      expect(res.output).toContain('{"verified": true}');
      expect(mockSandbox.runPython).toHaveBeenCalled();
    });
  });
});
