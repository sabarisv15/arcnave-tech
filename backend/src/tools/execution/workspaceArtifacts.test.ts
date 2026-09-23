import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceFiles } from './executionRuntime.js';
import {
  createWorkspaceArtifact,
  readWorkspaceArtifact,
  resolveWorkspaceArtifact,
  writeWorkspaceArtifact,
} from './workspaceArtifacts.js';

describe('Safe Workspace Intermediate Artifacts', () => {
  let tempBase: string;
  let wsA: WorkspaceFiles;
  let wsB: WorkspaceFiles;

  beforeEach(async () => {
    tempBase = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-artifacts-test-'));
    const makeWs = async (name: string): Promise<WorkspaceFiles> => {
      const wsDir = path.join(tempBase, name);
      const input = path.join(wsDir, 'input');
      const output = path.join(wsDir, 'output');
      const temp = path.join(wsDir, 'temp');
      await fs.mkdir(input, { recursive: true });
      await fs.mkdir(output, { recursive: true });
      await fs.mkdir(temp, { recursive: true });
      return {
        workspaceDir: wsDir,
        inputDir: input,
        outputDir: output,
        tempDir: temp,
      };
    };

    wsA = await makeWs('run-A');
    wsB = await makeWs('run-B');
  });

  afterEach(async () => {
    await fs.rm(tempBase, { recursive: true, force: true });
  });

  it('creates an opaque artifact reference and resolves it to active workspace path', async () => {
    const opaqueRef = await createWorkspaceArtifact(wsA, 'temp/chunk-001.json');
    expect(opaqueRef).toMatch(/^artifact_[a-f0-9]{16}$/);

    const resolved = await resolveWorkspaceArtifact(wsA, opaqueRef);
    expect(resolved.replace(/\\/g, '/')).toContain('/run-A/temp/chunk-001.json');
  });

  it('writes and reads data via opaque artifact reference', async () => {
    const samplePayload = JSON.stringify({ page: 1, rows: [{ id: 1, val: 'test' }] });
    const opaqueRef = await writeWorkspaceArtifact(wsA, 'temp/data.json', samplePayload);

    const buf = await readWorkspaceArtifact(wsA, opaqueRef);
    expect(buf.toString('utf8')).toBe(samplePayload);
  });

  it('blocks cross-run artifact access', async () => {
    const opaqueRefA = await writeWorkspaceArtifact(wsA, 'temp/secret.json', 'PRIVATE DATA');

    // Attempting to resolve run A's artifact in run B must throw
    await expect(resolveWorkspaceArtifact(wsB, opaqueRefA)).rejects.toThrow(
      /does not exist in the active workspace/,
    );
  });

  it('rejects path traversal attempts', async () => {
    await expect(createWorkspaceArtifact(wsA, '../escape.json')).rejects.toThrow(
      /path traversal/,
    );
    await expect(createWorkspaceArtifact(wsA, '../../package.json')).rejects.toThrow(
      /path traversal/,
    );
    await expect(createWorkspaceArtifact(wsA, '/etc/passwd')).rejects.toThrow(
      /path traversal/,
    );
  });
});
