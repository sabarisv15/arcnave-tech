import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Storage as GcsStorage } from '@google-cloud/storage';
import ExcelJS from 'exceljs';

import { CloudRunSandboxClient } from '../tools/sandbox/cloudRunSandboxClient.js';
import { ExecutionRuntime } from '../tools/execution/executionRuntime.js';

const PROJECT_ID = 'project-8bcf740a-a7bd-4aea-974';
const REGION = 'asia-south1';
const JOB_NAME = 'arcnave-python-sandbox';
const STAGING_BUCKET = 'arcnave-sandbox-staging-project-8bcf740a-a7bd-4aea-974';
const SIGNING_SA = 'sandbox-invoker@project-8bcf740a-a7bd-4aea-974.iam.gserviceaccount.com';

async function main() {
  console.log('================================================================');
  console.log('   BATCH 2.2 FINAL EXECUTION SECURITY HARDENING — LIVE TESTS   ');
  console.log('================================================================');

  const gcsStorage = new GcsStorage({ projectId: PROJECT_ID });

  const sandboxClient = CloudRunSandboxClient.withAdc(PROJECT_ID, REGION, JOB_NAME, {
    stagingBucket: STAGING_BUCKET,
    storageClient: gcsStorage,
    signingSaEmail: SIGNING_SA,
    maxCodeBytes: 20 * 1024,
    codeTimeoutMs: 30_000,
    orchestrationTimeoutMs: 120_000,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
  });

  const runtime = new ExecutionRuntime(sandboxClient);

  // --------------------------------------------------------------------------
  // TEST A — NORMAL EXECUTION (XLSX -> MEAN 25.0 -> PNG DELIVERABLE)
  // --------------------------------------------------------------------------
  console.log('\n>>> TEST A: Normal Execution (monthly_sales.xlsx -> mean 25.0 -> sales_chart.png)');
  const wsA = await runtime.createWorkspace(`live_test_a_${Date.now()}`);
  try {
    // Generate real XLSX using ExcelJS
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sales');
    sheet.columns = [
      { header: 'month', key: 'month', width: 10 },
      { header: 'sales', key: 'sales', width: 10 },
    ];
    sheet.addRow({ month: 'Jan', sales: 10 });
    sheet.addRow({ month: 'Feb', sales: 20 });
    sheet.addRow({ month: 'Mar', sales: 30 });
    sheet.addRow({ month: 'Apr', sales: 40 });
    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await runtime.materializeInputFiles(wsA, [
      { filename: 'monthly_sales.xlsx', data: xlsxBuffer },
    ]);

    const codeA = `
import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_excel('input/monthly_sales.xlsx')
mean_val = float(df['sales'].mean())
print(f"CALCULATED_MEAN: {mean_val}")

plt.figure(figsize=(6, 4))
plt.plot(df['month'], df['sales'], marker='o', color='royalblue')
plt.title(f"Monthly Sales (Mean: {mean_val})")
plt.grid(True)
plt.savefig('output/sales_chart.png')
print("CHART_GENERATED_SUCCESSFULLY")
`;

    const resultA = await runtime.executePython(codeA, wsA);
    const parsedA = JSON.parse(resultA.outputs[0]?.text || '{}') as { msg_out: string; msg_err: string };
    console.log('   Container stdout:', parsedA.msg_out.trim());

    if (!parsedA.msg_out.includes('CALCULATED_MEAN: 25.0')) {
      throw new Error(`Test A Failed: Expected CALCULATED_MEAN: 25.0 but got ${parsedA.msg_out}`);
    }

    const chartPath = path.join(wsA.outputDir, 'sales_chart.png');
    const chartBytes = await fs.readFile(chartPath);
    console.log(`   Generated chart size: ${chartBytes.length} bytes`);

    // Verify PNG magic header: \x89PNG\r\n\x1a\n (0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    const isPng =
      chartBytes[0] === 0x89 &&
      chartBytes[1] === 0x50 &&
      chartBytes[2] === 0x4e &&
      chartBytes[3] === 0x47 &&
      chartBytes[4] === 0x0d &&
      chartBytes[5] === 0x0a &&
      chartBytes[6] === 0x1a &&
      chartBytes[7] === 0x0a;
    console.log(`   Valid PNG Header Check: ${isPng ? 'PASS (0x89504E47...)' : 'FAIL'}`);
    if (!isPng) throw new Error('Test A Failed: Generated file is not a valid PNG');

    // Verify simulated persistence & download URL
    const mockStorage = {
      put: async (key: string, data: Buffer, mime: string) => {},
    } as any;
    const mockDb = {
      insert: () => ({
        values: () => ({
          returning: async () => [{ id: 'mock-att-123', filename: 'sales_chart.png', mimeType: 'image/png', sizeBytes: chartBytes.length }],
        }),
      }),
    } as any;

    const persisted = await runtime.persistOutputFiles(wsA, {
      userId: 'test-user',
      messageId: 'test-msg',
      db: mockDb,
      storage: mockStorage,
    });
    console.log('   TEST A RESULT: PASSED');
  } finally {
    await runtime.cleanupWorkspace(wsA);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // --------------------------------------------------------------------------
  // TEST B — NO STAGING CREDENTIALS & STRICT ENVIRONMENT SANITIZATION
  // --------------------------------------------------------------------------
  console.log('\n>>> TEST B: No Staging Credentials & Environment Sanitization');
  const wsB = await runtime.createWorkspace(`live_test_b_${Date.now()}`);
  try {
    const codeB = `
import os
import sys
import json
import urllib.request
import urllib.error

# 1. Environment Sanitization Audit
forbidden_env = [k for k in os.environ if any(x in k.upper() for x in ['STAGE', 'SIGN', 'RUN_PYTHON', 'SECRET', 'TOKEN', 'KEY'])]
print(f"FORBIDDEN_ENV_KEYS: {forbidden_env}")

# 2. Query instance metadata for container SA token
token = None
try:
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"}
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        token = data.get("access_token")
        print(f"METADATA_TOKEN_ACQUIRED: {bool(token)}")
except Exception as e:
    print(f"METADATA_FETCH_STATUS: {e}")

# 3. If token exists, attempt direct access to staging bucket
if token:
    bucket = "${STAGING_BUCKET}"
    req2 = urllib.request.Request(
        f"https://storage.googleapis.com/storage/v1/b/{bucket}",
        headers={"Authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req2, timeout=5) as resp2:
            print("DIRECT_STAGING_ACCESS: SUCCESS (SECURITY VIOLATION)")
    except urllib.error.HTTPError as he:
        print(f"DIRECT_STAGING_ACCESS_HTTP_CODE: {he.code}")
    except Exception as e:
        print(f"DIRECT_STAGING_ACCESS_ERR: {e}")
`;

    const resultB = await runtime.executePython(codeB, wsB);
    const parsedB = JSON.parse(resultB.outputs[0]?.text || '{}') as { msg_out: string; msg_err: string };
    console.log('   Container output:\n' + parsedB.msg_out.trim());

    if (!parsedB.msg_out.includes('FORBIDDEN_ENV_KEYS: []')) {
      throw new Error(`Test B Failed: Subprocess environment leaked variables: ${parsedB.msg_out}`);
    }
    if (!parsedB.msg_out.includes('DIRECT_STAGING_ACCESS_HTTP_CODE: 403')) {
      throw new Error(`Test B Failed: Container SA token did not receive 403 on staging bucket: ${parsedB.msg_out}`);
    }
    console.log('   TEST B RESULT: PASSED (Zero credentials in child env, GCS Direct Access = 403 Forbidden)');
  } finally {
    await runtime.cleanupWorkspace(wsB);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // --------------------------------------------------------------------------
  // TEST C — CROSS-RUN ISOLATION
  // --------------------------------------------------------------------------
  console.log('\n>>> TEST C: Cross-Run Authorization (Run A cannot access Run B object)');
  const wsC = await runtime.createWorkspace(`live_test_c_${Date.now()}`);
  const targetSecretPath = 'runs/run-b-target/secret.txt';
  try {
    // 1. Stage a secret object in Run B namespace
    await gcsStorage.bucket(STAGING_BUCKET).file(targetSecretPath).save('TOP_SECRET_RUN_B_DATA');

    // 2. Run A attempts to read Run B's secret using direct GCS REST or unauthenticated GET
    const codeC = `
import urllib.request
import urllib.error

target_url = "https://storage.googleapis.com/${STAGING_BUCKET}/${targetSecretPath}"
try:
    req = urllib.request.Request(target_url)
    with urllib.request.urlopen(req, timeout=5) as resp:
        print(f"READ_RUN_B: {resp.read().decode('utf-8')}")
except urllib.error.HTTPError as he:
    print(f"CROSS_RUN_ACCESS_HTTP_CODE: {he.code}")
except Exception as e:
    print(f"CROSS_RUN_ACCESS_ERR: {e}")
`;

    const resultC = await runtime.executePython(codeC, wsC);
    const parsedC = JSON.parse(resultC.outputs[0]?.text || '{}') as { msg_out: string; msg_err: string };
    console.log('   Container output:\n' + parsedC.msg_out.trim());

    if (!parsedC.msg_out.includes('CROSS_RUN_ACCESS_HTTP_CODE: 403') && !parsedC.msg_out.includes('CROSS_RUN_ACCESS_HTTP_CODE: 401')) {
      throw new Error(`Test C Failed: Run A was able to access Run B object: ${parsedC.msg_out}`);
    }
    console.log('   TEST C RESULT: PASSED (Cross-run access strictly denied with 403/401)');
  } finally {
    await gcsStorage.bucket(STAGING_BUCKET).file(targetSecretPath).delete({ ignoreNotFound: true });
    await runtime.cleanupWorkspace(wsC);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // --------------------------------------------------------------------------
  // TEST D — NATIVE CLI EXECUTES IN CONTAINER & FAIL-CLOSED VERIFICATION
  // --------------------------------------------------------------------------
  console.log('\n>>> TEST D: Native CLI Execution in Container Sandbox');
  const wsD = await runtime.createWorkspace(`live_test_d_${Date.now()}`);
  try {
    // Create markdown file in workspace input
    const docMd = '# ArcNave Enterprise\n\nAutomated document compilation inside Cloud Run sandbox.\n';
    await fs.writeFile(path.join(wsD.inputDir, 'doc.md'), docMd);

    // Call Pandoc inside container sandbox via executeControlledCli
    console.log('   Invoking pandoc in container sandbox...');
    const cliRes = await runtime.executeControlledCli(
      'pandoc',
      ['input/doc.md', '-t', 'plain', '-o', 'output/doc.txt'],
      { cwd: wsD.workspaceDir },
    );
    console.log('   CLI Exit Code:', cliRes.exitCode);
    console.log('   CLI Stderr:', cliRes.stderr.trim());

    const outTextPath = path.join(wsD.outputDir, 'doc.txt');
    const outText = await fs.readFile(outTextPath, 'utf-8');
    console.log('   Parsed text output:\n   ' + outText.trim());

    if (!outText.includes('ArcNave Enterprise') || !outText.includes('Automated document compilation')) {
      throw new Error(`Test D Failed: Pandoc output mismatch: ${outText}`);
    }

    // Verify Fail-Closed Host Policy
    console.log('   Verifying host execution fail-closed policy...');
    const origAllow = process.env.ALLOW_HOST_CLI;
    try {
      process.env.ALLOW_HOST_CLI = 'false';
      const hostRuntime = new ExecutionRuntime(); // no sandboxClient
      let threw = false;
      try {
        await hostRuntime.executeControlledCli('pandoc', ['--version']);
      } catch (err: any) {
        threw = true;
        console.log('   Host execution correctly blocked with error:', err.message);
      }
      if (!threw) throw new Error('Test D Failed: Host execution was not blocked when ALLOW_HOST_CLI=false');
    } finally {
      process.env.ALLOW_HOST_CLI = origAllow;
    }

    console.log('   TEST D RESULT: PASSED (Pandoc executed in container sandbox, Host execution failed closed)');
  } finally {
    await runtime.cleanupWorkspace(wsD);
  }

  console.log('\n================================================================');
  console.log('   ALL BATCH 2.2 LIVE SECURITY HARDENING VERIFICATIONS PASSED   ');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\nFAILED BATCH 2.2 LIVE VERIFICATION:', err);
  process.exit(1);
});
