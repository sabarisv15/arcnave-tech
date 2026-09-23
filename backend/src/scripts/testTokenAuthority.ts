import { CloudRunSandboxClient } from '../tools/sandbox/cloudRunSandboxClient.js';
import { Storage as GcsStorage } from '@google-cloud/storage';

const PROJECT_ID = 'project-8bcf740a-a7bd-4aea-974';
const REGION = 'asia-south1';
const JOB_NAME = 'arcnave-python-sandbox';
const STAGING_BUCKET = 'arcnave-sandbox-staging-project-8bcf740a-a7bd-4aea-974';
const SIGNING_SA = 'sandbox-invoker@project-8bcf740a-a7bd-4aea-974.iam.gserviceaccount.com';

async function testAuthority() {
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

  const code = `
import urllib.request
import urllib.error
import json

# 1. Fetch metadata token
req = urllib.request.Request(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    headers={"Metadata-Flavor": "Google"}
)
with urllib.request.urlopen(req, timeout=5) as resp:
    token = json.loads(resp.read().decode('utf-8'))['access_token']

def check_api(name, url, method="GET", body=None):
    headers = {"Authorization": f"Bearer {token}"}
    if body:
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, headers=headers, method=method, data=body)
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return f"ALLOWED ({resp.status})"
    except urllib.error.HTTPError as e:
        return f"DENIED ({e.code})"
    except Exception as e:
        return f"FAILED ({type(e).__name__}: {e})"

report = {
    "permanent_bucket_access": check_api("permanent_bucket", "https://storage.googleapis.com/storage/v1/b/arcnave-attachments"),
    "staging_bucket_access": check_api("staging_bucket", "https://storage.googleapis.com/storage/v1/b/${STAGING_BUCKET}"),
    "cloud_run_jobs_list": check_api("cloud_run_jobs", "https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs"),
    "cloud_sql_instances_list": check_api("cloud_sql", "https://sqladmin.googleapis.com/sql/v1beta4/projects/${PROJECT_ID}/instances"),
    "iam_sign_blob_impersonate": check_api("sign_blob", f"https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SIGNING_SA}:signBlob", method="POST", body=b'{"payload":"dGVzdA=="}'),
    "secret_manager_list": check_api("secret_manager", "https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets"),
}

print("TOKEN_AUTHORITY_REPORT:" + json.dumps(report))
`;

  console.log('Testing Token Authority in Cloud Run Sandbox...');
  const res = await client.runPython(code, new AbortController().signal);
  console.log('Result:', res.outputs[0]?.text);
}

testAuthority().catch(console.error);
