/**
 * Where a model reads large inputs from, instead of the request body (ADR-0016).
 *
 * A large PDF is uploaded once and referenced, to keep request payloads small. Gemini on Vertex
 * takes a `fileData` part with a `gs://` URI. The Anthropic adapter on Vertex takes base64
 * sources only, so this is used for Gemini only.
 *
 * Page images go to their own bucket, not the attachments bucket, so Vertex's read access
 * reaches rendered pages and nothing a user uploaded. Objects are named by content hash:
 * a conversation resends its files every turn, and the same page is stored once. The bucket
 * deletes objects after LIFECYCLE_DAYS; an object is trusted for a day less than that from its
 * creation, and is written again after.
 */
import { createHash } from 'node:crypto';

export interface ModelInputStore {
  /** A `gs://` URI a model can read `data` from. */
  uriFor(data: Buffer, mimeType: string): Promise<string>;
}

/** The bucket's lifecycle rule (runbook): objects are deleted this many days after creation. */
export const LIFECYCLE_DAYS = 7;
const TRUST_MS = (LIFECYCLE_DAYS - 1) * 86_400_000;

/** The slice of @google-cloud/storage's Bucket this uses, so tests need no GCS. */
export interface InputBucket {
  name: string;
  file(name: string): {
    getMetadata(): Promise<[{ timeCreated?: string }, ...unknown[]]>;
    save(data: Buffer, options: { contentType: string; resumable: boolean }): Promise<unknown>;
  };
}

export class GcsModelInputStore implements ModelInputStore {
  /** Object name -> when it was created, for objects this instance has seen. */
  private readonly created = new Map<string, number>();

  constructor(
    private readonly bucket: InputBucket,
    private readonly now: () => number = Date.now,
  ) {}

  async uriFor(data: Buffer, mimeType: string): Promise<string> {
    const ext = mimeType === 'image/jpeg' ? 'jpg' : 'bin';
    const name = `pages/${createHash('sha256').update(data).digest('hex')}.${ext}`;
    const uri = `gs://${this.bucket.name}/${name}`;
    const seen = this.created.get(name) ?? (await this.createdAt(name));
    if (seen !== null && this.now() - seen < TRUST_MS) {
      this.created.set(name, seen);
      return uri;
    }
    // Absent, or old enough that the lifecycle rule may delete it mid-conversation: writing
    // it again resets its creation time.
    await this.bucket.file(name).save(data, { contentType: mimeType, resumable: false });
    this.created.set(name, this.now());
    return uri;
  }

  private async createdAt(name: string): Promise<number | null> {
    try {
      const [meta] = await this.bucket.file(name).getMetadata();
      return meta.timeCreated ? Date.parse(meta.timeCreated) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }
}
