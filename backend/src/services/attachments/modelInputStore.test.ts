/**
 * Page images stored for Gemini to read by URI (ADR-0016): named by content, written once, and
 * written again before the bucket's lifecycle rule could delete one a conversation still uses.
 */
import { describe, expect, it } from 'vitest';

import { GcsModelInputStore, type InputBucket, LIFECYCLE_DAYS } from './modelInputStore.js';

const DAY = 86_400_000;

function fakeBucket(): InputBucket & { objects: Map<string, number>; saves: number } {
  const objects = new Map<string, number>();
  let now = 0;
  const bucket = {
    name: 'model-inputs',
    objects,
    saves: 0,
    setNow: (t: number) => (now = t),
    file: (name: string) => ({
      getMetadata: async (): Promise<[{ timeCreated?: string }]> => {
        const created = objects.get(name);
        if (created === undefined) throw Object.assign(new Error('Not Found'), { code: 404 });
        return [{ timeCreated: new Date(created).toISOString() }];
      },
      save: async () => {
        bucket.saves += 1;
        objects.set(name, now);
      },
    }),
  };
  return bucket as unknown as InputBucket & { objects: Map<string, number>; saves: number };
}

describe('GcsModelInputStore', () => {
  it('names an image by its content and stores it once however often it is sent', async () => {
    const bucket = fakeBucket();
    let now = Date.parse('2026-09-25T00:00:00Z');
    (bucket as unknown as { setNow: (t: number) => void }).setNow(now);
    const store = new GcsModelInputStore(bucket, () => now);
    const page = Buffer.from('jpeg bytes');
    const uri = await store.uriFor(page, 'image/jpeg');
    expect(uri).toMatch(/^gs:\/\/model-inputs\/pages\/[a-f0-9]{64}\.jpg$/);
    now += DAY;
    expect(await store.uriFor(page, 'image/jpeg')).toBe(uri);
    // A second instance finds it in the bucket rather than writing it again.
    expect(await new GcsModelInputStore(bucket, () => now).uriFor(page, 'image/jpeg')).toBe(uri);
    expect(bucket.saves).toBe(1);
  });

  it('writes an image again once it is within a day of the lifecycle deletion', async () => {
    const bucket = fakeBucket();
    let now = Date.parse('2026-09-25T00:00:00Z');
    (bucket as unknown as { setNow: (t: number) => void }).setNow(now);
    const store = new GcsModelInputStore(bucket, () => now);
    await store.uriFor(Buffer.from('p'), 'image/jpeg');
    now += (LIFECYCLE_DAYS - 1) * DAY + 1;
    (bucket as unknown as { setNow: (t: number) => void }).setNow(now);
    await store.uriFor(Buffer.from('p'), 'image/jpeg');
    expect(bucket.saves).toBe(2);
  });
});
