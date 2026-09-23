import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { ProcessSandboxClient } from './processSandboxClient.js';

describe('ProcessSandboxClient', () => {
  it('executes python code and captures stdout cleanly', async () => {
    const client = new ProcessSandboxClient();
    const result = await client.runPython('print("Hello ArcNave Sandbox")', new AbortController().signal);

    expect(result.outputs.length).toBe(1);
    const parsed = JSON.parse(result.outputs[0]!.text);
    expect(parsed.msg_out.trim()).toBe('Hello ArcNave Sandbox');
    expect(parsed.exit_code).toBe(0);
  });

  it('captures stderr and reports exit code for failing scripts', async () => {
    const client = new ProcessSandboxClient();
    const result = await client.runPython(
      'import sys\nsys.stderr.write("Fatal error in calculation\\n")\nsys.exit(42)',
      new AbortController().signal,
    );

    const parsed = JSON.parse(result.outputs[0]!.text);
    expect(parsed.msg_err).toContain('Fatal error in calculation');
    expect(parsed.exit_code).toBe(42);
  });

  it('terminates execution when runtime exceeds codeTimeoutMs', async () => {
    const client = new ProcessSandboxClient({ codeTimeoutMs: 500 });
    const result = await client.runPython(
      'import time\ntime.sleep(5)\nprint("Should not finish")',
      new AbortController().signal,
    );

    const parsed = JSON.parse(result.outputs[0]!.text);
    expect(parsed.timed_out).toBe(true);
    expect(parsed.msg_err).toContain('timed out');
  });

  it('rejects when AbortSignal is pre-aborted', async () => {
    const client = new ProcessSandboxClient();
    const controller = new AbortController();
    controller.abort();

    await expect(client.runPython('print(1)', controller.signal)).rejects.toThrow('aborted');
  });

  it('truncates stdout when output exceeds maxStdoutBytes', async () => {
    const client = new ProcessSandboxClient({ maxStdoutBytes: 50 });
    const result = await client.runPython('print("x" * 200)', new AbortController().signal);

    const parsed = JSON.parse(result.outputs[0]!.text);
    expect(parsed.msg_out.length).toBeLessThanOrEqual(50);
    expect(parsed.msg_err).toContain('stdout truncated');
  });

  it('runs within specified workspace directory and accesses files relative to it', async () => {
    const client = new ProcessSandboxClient();
    const tempDir = path.join(os.tmpdir(), `ws_test_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      await fs.writeFile(path.join(tempDir, 'sample.txt'), 'workspace content 123');

      const result = await client.runPython(
        'with open("sample.txt") as f:\n    print(f.read().strip())',
        new AbortController().signal,
        { workspaceDir: tempDir },
      );

      const parsed = JSON.parse(result.outputs[0]!.text);
      expect(parsed.msg_out.trim()).toBe('workspace content 123');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
