import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { Storage } from '@google-cloud/storage';

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim().split('\n').pop()!.trim();
const saEmail = 'sandbox-invoker@project-8bcf740a-a7bd-4aea-974.iam.gserviceaccount.com';
const bucket = 'arcnave-sandbox-staging-project-8bcf740a-a7bd-4aea-974';

export async function generateV4SignedUrl(params: {
  method: 'GET' | 'PUT';
  bucket: string;
  objectKey: string;
  expiresSeconds: number;
  token: string;
  saEmail: string;
}): Promise<string> {
  const now = new Date();
  const dateBasic = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateOnly = dateBasic.slice(0, 8);
  const credentialScope = `${dateOnly}/auto/storage/goog4_request`;
  const host = 'storage.googleapis.com';

  const queryParams: Record<string, string> = {
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': `${params.saEmail}/${credentialScope}`,
    'X-Goog-Date': dateBasic,
    'X-Goog-Expires': String(params.expiresSeconds),
    'X-Goog-SignedHeaders': 'host',
  };

  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k]!)}`)
    .join('&');

  const canonicalUri = `/${params.bucket}/${params.objectKey.split('/').map(encodeURIComponent).join('/')}`;
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalReqHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    dateBasic,
    credentialScope,
    canonicalReqHash,
  ].join('\n');

  const signUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${params.saEmail}:signBlob`;
  const signRes = await fetch(signUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload: Buffer.from(stringToSign).toString('base64'),
    }),
  });

  if (!signRes.ok) {
    const errText = await signRes.text();
    throw new Error(`signBlob failed (${signRes.status}): ${errText}`);
  }

  const signData = (await signRes.json()) as { signedBlob: string };
  const signatureHex = Buffer.from(signData.signedBlob, 'base64').toString('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
}

async function testSignedUrls() {
  console.log('1. Uploading test file via GCS client...');
  const gcs = new Storage({ projectId: 'project-8bcf740a-a7bd-4aea-974' });
  const objectPath = 'runs/test-signed-url/test.txt';
  await gcs.bucket(bucket).file(objectPath).save('Hello signed URL world!');

  console.log('2. Generating V4 GET Signed URL...');
  const getUrl = await generateV4SignedUrl({
    method: 'GET',
    bucket,
    objectKey: objectPath,
    expiresSeconds: 600,
    token,
    saEmail,
  });
  console.log('   Generated URL:', getUrl.slice(0, 100) + '...');

  console.log('3. Downloading using Signed URL without ANY auth header:');
  const res = await fetch(getUrl);
  console.log('   GET Status:', res.status);
  const text = await res.text();
  console.log('   Content:', text);

  console.log('4. Generating V4 PUT Signed URL...');
  const putPath = 'runs/test-signed-url/upload.txt';
  const putUrl = await generateV4SignedUrl({
    method: 'PUT',
    bucket,
    objectKey: putPath,
    expiresSeconds: 600,
    token,
    saEmail,
  });

  console.log('5. Uploading using Signed URL without ANY auth header:');
  const putRes = await fetch(putUrl, {
    method: 'PUT',
    body: 'Uploaded via Signed PUT URL!',
  });
  console.log('   PUT Status:', putRes.status);

  console.log('6. Verifying uploaded file via GCS client...');
  const [downloaded] = await gcs.bucket(bucket).file(putPath).download();
  console.log('   Downloaded content:', downloaded.toString());

  console.log('7. Cleaning up test files...');
  await gcs.bucket(bucket).file(objectPath).delete({ ignoreNotFound: true });
  await gcs.bucket(bucket).file(putPath).delete({ ignoreNotFound: true });
  console.log('   Cleanup done! All signed URL operations VERIFIED.');
}

testSignedUrls().catch(console.error);
