import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CloudRunSandboxClient } from '../tools/sandbox/cloudRunSandboxClient.js';
import { Storage as GcsStorage } from '@google-cloud/storage';

const PROJECT_ID = 'project-8bcf740a-a7bd-4aea-974';
const REGION = 'asia-south1';
const JOB_NAME = 'arcnave-python-sandbox';
const STAGING_BUCKET = 'arcnave-sandbox-staging-project-8bcf740a-a7bd-4aea-974';
const SIGNING_SA = 'sandbox-invoker@project-8bcf740a-a7bd-4aea-974.iam.gserviceaccount.com';

async function testDynamicOutput() {
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

  const tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'arcnave-dynamic-test-'));
  await fs.mkdir(path.join(tempWorkspace, 'output'), { recursive: true });

  const code = `
import uuid
import os

u = str(uuid.uuid4())[:8]
filename = f"output/result-{u}.csv"
with open(filename, "w") as f:
    f.write("id,value\\n1,100\\n2,200\\n")
print(f"CREATED_FILE:result-{u}.csv")
`;

  console.log(`Starting Dynamic Output test with workspace: ${tempWorkspace}`);
  const res = await client.runPython(code, new AbortController().signal, {
    workspaceDir: tempWorkspace,
  });

  console.log('Execution output:', res.outputs[0]?.text);

  const localOutputFiles = await fs.readdir(path.join(tempWorkspace, 'output'));
  console.log('Files materialized in local workspace output/:', localOutputFiles);

  for (const f of localOutputFiles) {
    const content = await fs.readFile(path.join(tempWorkspace, 'output', f), 'utf-8');
    console.log(`File [${f}] content:\n${content}`);
  }

  // Clean up
  await fs.rm(tempWorkspace, { recursive: true, force: true });
}

testDynamicOutput().catch(console.error);
