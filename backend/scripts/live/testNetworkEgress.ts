import { CloudRunSandboxClient } from '../../src/tools/sandbox/cloudRunSandboxClient.js';
import { Storage as GcsStorage } from '@google-cloud/storage';

const PROJECT_ID = 'project-8bcf740a-a7bd-4aea-974';
const REGION = 'asia-south1';
const JOB_NAME = 'arcnave-python-sandbox';
const STAGING_BUCKET = 'arcnave-sandbox-staging-project-8bcf740a-a7bd-4aea-974';
const SIGNING_SA = 'sandbox-invoker@project-8bcf740a-a7bd-4aea-974.iam.gserviceaccount.com';

async function testNetwork() {
  const gcsStorage = new GcsStorage({ projectId: PROJECT_ID });

  const client = CloudRunSandboxClient.withAdc(PROJECT_ID, REGION, JOB_NAME, {
    stagingBucket: STAGING_BUCKET,
    storageClient: gcsStorage,
    signingSaEmail: SIGNING_SA,
    maxCodeBytes: 20 * 1024,
    codeTimeoutMs: 60_000,
    orchestrationTimeoutMs: 120_000,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
  });

  const code = `
import socket
import urllib.request
import urllib.error
import json
import sys

socket.setdefaulttimeout(3.0)

def report(key, val):
    print(f"PROBE:{key}={val}", flush=True)

# A. Non-Google public HTTPS endpoint (e.g. httpbin.org or github.com)
try:
    req = urllib.request.Request("https://httpbin.org/get", headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=3) as resp:
        report("non_google_https", f"CONNECTED ({resp.status})")
except Exception as e:
    report("non_google_https", f"BLOCKED ({type(e).__name__}: {e})")

# B. Arbitrary public IP TCP connection (bypasses DNS)
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2.0)
    s.connect(("1.1.1.1", 53))
    s.close()
    report("public_ip_tcp_1_1_1_1", "CONNECTED")
except Exception as e:
    report("public_ip_tcp_1_1_1_1", f"BLOCKED ({type(e).__name__}: {e})")

# C. DNS resolution
try:
    ip = socket.gethostbyname("example.com")
    report("dns_resolution", f"RESOLVED ({ip})")
except Exception as e:
    report("dns_resolution", f"BLOCKED ({type(e).__name__}: {e})")

# D. Metadata server
try:
    req = urllib.request.Request("http://metadata.google.internal/computeMetadata/v1/", headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(req, timeout=2) as resp:
        report("metadata_server", f"REACHABLE ({resp.status})")
except Exception as e:
    report("metadata_server", f"BLOCKED ({type(e).__name__}: {e})")

# E. Private RFC1918 addresses
try:
    s2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s2.settimeout(2.0)
    s2.connect(("10.0.0.1", 80))
    s2.close()
    report("rfc1918_10_0_0_1", "CONNECTED")
except Exception as e:
    report("rfc1918_10_0_0_1", f"BLOCKED ({type(e).__name__}: {e})")

print("ALL_PROBES_COMPLETED", flush=True)
`;

  console.log('Launching Network Audit in Cloud Run Sandbox...');
  const res = await client.runPython(code, new AbortController().signal);
  console.log('Result:', res.outputs[0]?.text);
}

testNetwork().catch(console.error);
