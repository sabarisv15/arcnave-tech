import crypto from 'node:crypto';

export interface GenerateV4SignedUrlOptions {
  method: 'GET' | 'PUT';
  bucket: string;
  objectKey: string;
  expiresSeconds: number;
  token: string;
  saEmail: string;
}

/**
 * Generates a V4 Signed URL for GCS using IAM Credentials API signBlob.
 * This works with Application Default Credentials (ADC) without requiring
 * service account private keys on disk.
 */
export async function generateV4SignedUrl(params: GenerateV4SignedUrlOptions): Promise<string> {
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
  let signRes: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      signRes = await fetch(signUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload: Buffer.from(stringToSign).toString('base64'),
        }),
      });
      break;
    } catch (err: any) {
      if (attempt === 2) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  if (!signRes || !signRes.ok) {
    const errText = signRes ? await signRes.text() : 'No response';
    throw new Error(`signBlob failed (${signRes?.status}): ${errText}`);
  }

  const signData = (await signRes.json()) as { signedBlob: string };
  const signatureHex = Buffer.from(signData.signedBlob, 'base64').toString('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signatureHex}`;
}
