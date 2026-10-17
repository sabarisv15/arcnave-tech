import { execSync } from 'node:child_process';

const token = execSync('gcloud auth print-access-token --impersonate-service-account=arcnave-sandbox-runtime@project-8bcf740a-a7bd-4aea-974.iam.gserviceaccount.com', { encoding: 'utf8' }).trim().split('\n').pop()!.trim();

async function testAccess() {
  const bucket = 'arcnave-sandbox-staging-project-8bcf740a-a7bd-4aea-974';
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/runs%2Ftest-run-b%2Fsecret.txt?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  console.log('Access status with runtime SA token:', res.status);
  const text = await res.text();
  console.log('Response body:', text);
}

testAccess().catch(console.error);
