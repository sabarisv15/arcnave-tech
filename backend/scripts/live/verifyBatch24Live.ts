import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CloudRunSandboxClient } from '../../src/tools/sandbox/cloudRunSandboxClient.js';
import { Storage as GcsStorage } from '@google-cloud/storage';

const PROJECT_ID = 'project-8bcf740a-a7bd-4aea-974';
const REGION = 'asia-south1';
const JOB_NAME = 'arcnave-python-sandbox';
const STAGING_BUCKET = 'arcnave-sandbox-staging-project-8bcf740a-a7bd-4aea-974';
const SIGNING_SA = 'sandbox-invoker@project-8bcf740a-a7bd-4aea-974.iam.gserviceaccount.com';

async function runLiveTests() {
  console.log('================================================================');
  console.log('   BATCH 2.4 REMOVE LEGACY OUTPUT FALLBACK — LIVE TESTS        ');
  console.log('================================================================\n');

  const gcsStorage = new GcsStorage({ projectId: PROJECT_ID });
  const client = CloudRunSandboxClient.withAdc(PROJECT_ID, REGION, JOB_NAME, {
    stagingBucket: STAGING_BUCKET,
    storageClient: gcsStorage,
    signingSaEmail: SIGNING_SA,
    maxCodeBytes: 20 * 1024,
    codeTimeoutMs: 30_000,
    orchestrationTimeoutMs: 60_000,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
  });

  // -------------------------------------------------------------
  // TEST A: Declared output ("chart.png")
  // -------------------------------------------------------------
  console.log('>>> TEST A: Declared output ("chart.png")');
  const wsA = await fs.mkdtemp(path.join(os.tmpdir(), 'arcnave-test-a-'));
  await fs.mkdir(path.join(wsA, 'output'), { recursive: true });

  const codeA = `
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [4, 5, 6])
plt.title('Test Chart')
plt.savefig('output/chart.png')
print("CHART_SAVED")
`;

  const resA = await client.runPython(codeA, new AbortController().signal, {
    workspaceDir: wsA,
    expectedOutputs: ['chart.png'],
  });

  console.log('   Container stdout:', resA.outputs[0]?.text);
  const chartPath = path.join(wsA, 'output', 'chart.png');
  const chartExists = await fs.stat(chartPath).then(() => true).catch(() => false);
  if (!chartExists) {
    throw new Error('TEST A FAILED: chart.png was not materialized in workspace!');
  }
  const chartBuf = await fs.readFile(chartPath);
  const isPng = chartBuf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  console.log(`   Generated chart size: ${chartBuf.length} bytes (Valid PNG: ${isPng})`);
  if (!isPng) throw new Error('TEST A FAILED: Invalid PNG header');
  console.log('   TEST A RESULT: PASSED\n');
  await fs.rm(wsA, { recursive: true, force: true });

  // -------------------------------------------------------------
  // TEST B: Undeclared output ("random-uuid.csv")
  // -------------------------------------------------------------
  console.log('>>> TEST B: Undeclared output ("random-uuid.csv" with expectedOutputs=[])');
  const wsB = await fs.mkdtemp(path.join(os.tmpdir(), 'arcnave-test-b-'));
  await fs.mkdir(path.join(wsB, 'output'), { recursive: true });

  const codeB = `
with open('output/random-uuid.csv', 'w') as f:
    f.write('id,value\\n1,100\\n2,200\\n')
print("RANDOM_CSV_SAVED")
`;

  const resB = await client.runPython(codeB, new AbortController().signal, {
    workspaceDir: wsB,
    expectedOutputs: [], // Explicitly no outputs declared
  });

  console.log('   Container output:', resB.outputs[0]?.text);
  console.log('   Undeclared outputs caught:', resB.undeclaredOutputs);

  const undeclaredFile = path.join(wsB, 'output', 'random-uuid.csv');
  const fileExistsB = await fs.stat(undeclaredFile).then(() => true).catch(() => false);
  if (fileExistsB) {
    throw new Error('TEST B FAILED: Undeclared file was materialized in workspace!');
  }
  if (!resB.undeclaredOutputs || !resB.undeclaredOutputs.includes('random-uuid.csv')) {
    throw new Error('TEST B FAILED: undeclaredOutputs list did not include random-uuid.csv!');
  }
  console.log('   TEST B RESULT: PASSED (Undeclared file safely rejected, no upload, metadata only)\n');
  await fs.rm(wsB, { recursive: true, force: true });

  // -------------------------------------------------------------
  // TEST C: Dynamic-looking filename declared before call
  // -------------------------------------------------------------
  console.log('>>> TEST C: Dynamic-looking filename declared before call ("result-abc123.csv")');
  const wsC = await fs.mkdtemp(path.join(os.tmpdir(), 'arcnave-test-c-'));
  await fs.mkdir(path.join(wsC, 'output'), { recursive: true });

  const dynamicFilename = 'result-abc123.csv';
  const codeC = `
with open('output/${dynamicFilename}', 'w') as f:
    f.write('name,score\\nalice,95\\nbob,98\\n')
print("RESULT_CSV_SAVED")
`;

  const resC = await client.runPython(codeC, new AbortController().signal, {
    workspaceDir: wsC,
    expectedOutputs: [dynamicFilename],
  });

  console.log('   Container stdout:', resC.outputs[0]?.text);
  const fileC = path.join(wsC, 'output', dynamicFilename);
  const fileExistsC = await fs.stat(fileC).then(() => true).catch(() => false);
  if (!fileExistsC) {
    throw new Error('TEST C FAILED: result-abc123.csv was not materialized in workspace!');
  }
  const contentC = await fs.readFile(fileC, 'utf-8');
  console.log(`   Materialized file content:\n${contentC}`);
  if (!contentC.includes('alice,95')) {
    throw new Error('TEST C FAILED: File content mismatch');
  }
  console.log('   TEST C RESULT: PASSED\n');
  await fs.rm(wsC, { recursive: true, force: true });

  console.log('================================================================');
  console.log('   ALL BATCH 2.4 LIVE TESTS PASSED (ZERO BINARY IN LOGS)       ');
  console.log('================================================================');
}

runLiveTests().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
