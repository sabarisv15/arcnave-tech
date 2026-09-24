/**
 * ADR-0008: trusted work (poppler, packaged skill scripts) runs on the trusted executor, and
 * model-written Python never does. The trusted child process never sees the backend's secrets.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildCapabilityRegistry } from '../../capabilities/factory.js';
import { loadConfig } from '../../config.js';
import { SkillService } from '../../services/skills.js';
import type { SandboxClient, SandboxExecutionResult } from '../sandbox/client.js';
import { ProcessSandboxClient } from '../sandbox/processSandboxClient.js';
import { ExecutionRuntime } from './executionRuntime.js';

class Recorder implements SandboxClient {
  calls = 0;
  async runPython(): Promise<SandboxExecutionResult> {
    this.calls += 1;
    return { outputs: [{ mimeType: 'application/json', text: JSON.stringify({ msg_out: '{"stdout":"","stderr":"","exitCode":0}', msg_err: '' }) }] };
  }
}

const all = { pythonAllowed: true, trustedCliAllowed: true, skillScriptAllowed: true };

describe('trusted executor routing (ADR-0008)', () => {
  it('sends poppler and skill scripts to the trusted executor and run_python to the sandbox', async () => {
    const sandbox = new Recorder();
    const trusted = new Recorder();
    const runtime = new ExecutionRuntime(sandbox, undefined, all, trusted);

    await runtime.executeControlledCli('pdftoppm', ['-v']);
    expect([trusted.calls, sandbox.calls]).toEqual([1, 0]);

    await runtime.executeControlledCli('soffice', ['--version']);
    expect([trusted.calls, sandbox.calls]).toEqual([1, 1]);

    await runtime.executePython('print(1)');
    expect([trusted.calls, sandbox.calls]).toEqual([1, 2]);

    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x@localhost/x', COOKIE_SECRET: 'x'.repeat(32) });
    const skills = new SkillService(path.resolve('.'), 'skills', buildCapabilityRegistry(cfg));
    await skills.load();
    await runtime.withWorkspace(`trusted_${Date.now()}`, (ws) =>
      runtime.runSkillScriptJson({ skill: 'pdf', resource: 'scripts/normalize_table_rows.py' }, { pages: [] }, ws, skills),
    );
    expect([trusted.calls, sandbox.calls]).toEqual([2, 2]);
  });

  it('grants trusted work without a sandbox, but never run_python', () => {
    const runtime = new ExecutionRuntime(undefined, undefined, all, new Recorder());
    expect(runtime.can('trustedCliAllowed')).toBe(true);
    expect(runtime.can('skillScriptAllowed')).toBe(true);
    expect(runtime.can('pythonAllowed')).toBe(false);
  });

  it('a no-result skill script says why', async () => {
    const failing: SandboxClient = {
      runPython: async () => ({
        outputs: [{ mimeType: 'application/json', text: JSON.stringify({ msg_out: '', msg_err: 'boom', exit_code: 3 }) }],
      }),
    };
    const runtime = new ExecutionRuntime(undefined, undefined, all, failing);
    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x@localhost/x', COOKIE_SECRET: 'x'.repeat(32) });
    const skills = new SkillService(path.resolve('.'), 'skills', buildCapabilityRegistry(cfg));
    await skills.load();
    const res = await runtime.withWorkspace(`trusted_fail_${Date.now()}`, (ws) =>
      runtime.runSkillScriptJson({ skill: 'pdf', resource: 'scripts/normalize_table_rows.py' }, {}, ws, skills),
    );
    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain('exit code 3');
    expect((res as { error: string }).error).toContain('boom');
  });
});

describe('ProcessSandboxClient with inheritEnv: false', () => {
  it('does not pass the backend environment to the child', async () => {
    process.env.ARCNAVE_TRUSTED_TEST_SECRET = 'leak';
    try {
      const client = new ProcessSandboxClient({ pythonPath: 'python3', inheritEnv: false });
      const res = await client.runPython(
        'import os\nprint(os.environ.get("ARCNAVE_TRUSTED_TEST_SECRET", "absent"))',
        new AbortController().signal,
      );
      const run = JSON.parse(res.outputs[0]!.text) as { msg_out: string };
      expect(run.msg_out.trim()).toBe('absent');
    } finally {
      delete process.env.ARCNAVE_TRUSTED_TEST_SECRET;
    }
  });
});
