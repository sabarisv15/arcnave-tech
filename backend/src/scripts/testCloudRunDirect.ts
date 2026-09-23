import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CloudRunSandboxClient } from '../tools/sandbox/cloudRunSandboxClient.js';

async function main() {
  console.log('Testing CloudRunSandboxClient with ADC and File Bridge...');
  const client = CloudRunSandboxClient.withAdc('project-8bcf740a-a7bd-4aea-974', 'asia-south1', 'arcnave-python-sandbox', {
    maxCodeBytes: 20 * 1024,
    codeTimeoutMs: 10_000,
    orchestrationTimeoutMs: 90_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
  });

  const tempDir = path.join(os.tmpdir(), `test_cr_bridge_${Date.now()}`);
  const inputDir = path.join(tempDir, 'input');
  const outputDir = path.join(tempDir, 'output');
  await fs.mkdir(inputDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  await fs.writeFile(path.join(inputDir, 'numbers.csv'), 'val\n10\n20\n30\n40\n');

  const pythonCode = `
import pandas as pd

df = pd.read_csv('input/numbers.csv')
mean_val = float(df['val'].mean())
print(f"Computed mean: {mean_val}")

with open('output/output_result.txt', 'w') as f:
    f.write(f"MEAN={mean_val}")
`;

  try {
    const res = await client.runPython(pythonCode, new AbortController().signal, {
      workspaceDir: tempDir,
    });
    console.log('Result payload:', res.outputs[0]?.text);

    const outputFile = path.join(outputDir, 'output_result.txt');
    const content = await fs.readFile(outputFile, 'utf-8');
    console.log('Collected output file content:', content);
    console.log('FILE BRIDGE SUCCESS!');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(console.error);
