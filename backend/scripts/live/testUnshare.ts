import { CloudRunSandboxClient } from '../../src/tools/sandbox/cloudRunSandboxClient.js';

async function main() {
  const c = CloudRunSandboxClient.withAdc('project-8bcf740a-a7bd-4aea-974', 'asia-south1', 'arcnave-python-sandbox', {
    maxCodeBytes: 20480,
    codeTimeoutMs: 15000,
    orchestrationTimeoutMs: 45000,
    maxStdoutBytes: 65536,
    maxStderrBytes: 65536,
  });

  const code = `
import subprocess
import sys

res = subprocess.run(["unshare", "-n", sys.executable, "-c", "print('NETNS_OK')"], capture_output=True, text=True)
print(f"UNSHARE_RES: code={res.returncode}, out={res.stdout.strip()}, err={res.stderr.strip()}")
`;

  const res = await c.runPython(code, new AbortController().signal);
  console.log('OUTPUT:', res.outputs[0]?.text);
}

main().catch(console.error);
