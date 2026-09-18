/**
 * Artifacts: version history, restore, and the two different meanings of "version".
 *
 * `currentVersion` is the pointer into the history; `version` is the optimistic-concurrency
 * counter. Conflating them is the mistake this file is here to catch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp();
  user = await signUp(ctx);
});

afterAll(async () => {
  await ctx.close();
});

const auth = (): { cookie: string } => ({ cookie: user.cookie });

async function createArtifact(content = 'v1 body'): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/artifacts',
    headers: auth(),
    payload: { title: 'Plan', kind: 'document', content },
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function appendVersion(id: string, content: string): Promise<Record<string, unknown>> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/v1/artifacts/${id}/versions`,
    headers: auth(),
    payload: { content },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Record<string, unknown>;
}

describe('versioning', () => {
  it('creates at version 1 with its content readable', async () => {
    const id = await createArtifact('first draft');
    const response = await ctx.app.inject({ url: `/v1/artifacts/${id}`, headers: auth() });

    expect(response.json()).toMatchObject({
      currentVersion: 1,
      readVersion: 1,
      content: 'first draft',
      kind: 'document',
    });
  });

  it('appends rather than overwrites, moving the pointer forward', async () => {
    const id = await createArtifact('v1 body');
    expect(await appendVersion(id, 'v2 body')).toMatchObject({
      currentVersion: 2,
      content: 'v2 body',
    });

    // The old version is still readable, which is the whole point of appending.
    const old = await ctx.app.inject({
      url: `/v1/artifacts/${id}?version=1`,
      headers: auth(),
    });
    expect(old.json()).toMatchObject({ readVersion: 1, content: 'v1 body', currentVersion: 2 });
  });

  it('restores by appending a copy, so the restore is itself undoable', async () => {
    const id = await createArtifact('v1 body');
    await appendVersion(id, 'v2 body');

    const restored = await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${id}/restore`,
      headers: auth(),
      payload: { restoreVersion: 1 },
    });

    expect(restored.statusCode).toBe(201);
    expect(restored.json()).toMatchObject({ currentVersion: 3, content: 'v1 body' });

    const history = await ctx.app.inject({
      url: `/v1/artifacts/${id}/versions`,
      headers: auth(),
    });
    const body = history.json() as {
      currentVersion: number;
      items: Array<{ version: number; charCount: number }>;
    };
    expect(body.currentVersion).toBe(3);
    expect(body.items.map((v) => v.version)).toEqual([3, 2, 1]);
    // Nothing was truncated: v2 is still there even though we restored past it.
    expect(body.items.find((v) => v.version === 2)!.charCount).toBe('v2 body'.length);
  });

  it('404s a version that was never written', async () => {
    const id = await createArtifact();
    const read = await ctx.app.inject({ url: `/v1/artifacts/${id}?version=99`, headers: auth() });
    expect(read.statusCode).toBe(404);

    const restore = await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${id}/restore`,
      headers: auth(),
      payload: { restoreVersion: 99 },
    });
    expect(restore.statusCode).toBe(404);
  });

  it('keeps currentVersion and the concurrency counter distinct', async () => {
    const id = await createArtifact();
    // A rename bumps the concurrency counter but must not move the content pointer.
    await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/artifacts/${id}`,
      headers: auth(),
      payload: { title: 'Renamed' },
    });

    const read = await ctx.app.inject({ url: `/v1/artifacts/${id}`, headers: auth() });
    expect(read.json()).toMatchObject({ title: 'Renamed', currentVersion: 1, version: 2 });
  });
});

describe('optimistic concurrency', () => {
  it('refuses a write carrying a stale version', async () => {
    const id = await createArtifact();
    await appendVersion(id, 'v2');

    const stale = await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${id}/versions`,
      headers: auth(),
      payload: { content: 'v3', version: 1 },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: 'conflict', meta: { expectedVersion: 1, actualVersion: 2 } },
    });
  });

  it('allows a write with no version, keeping concurrency control opt-in', async () => {
    const id = await createArtifact();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${id}/versions`,
      headers: auth(),
      payload: { content: 'no version sent' },
    });
    expect(response.statusCode).toBe(201);
  });

  it('survives concurrent appends without colliding on the version index', async () => {
    const id = await createArtifact();
    // Both omit `version`, so neither is refused by the concurrency check — the next number
    // has to come from max(version)+1 inside the transaction or one of these fails.
    const results = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: `/v1/artifacts/${id}/versions`,
        headers: auth(),
        payload: { content: 'a' },
      }),
      ctx.app.inject({
        method: 'POST',
        url: `/v1/artifacts/${id}/versions`,
        headers: auth(),
        payload: { content: 'b' },
      }),
    ]);

    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);

    const history = await ctx.app.inject({
      url: `/v1/artifacts/${id}/versions`,
      headers: auth(),
    });
    const versions = (history.json() as { items: Array<{ version: number }> }).items.map(
      (v) => v.version,
    );
    expect(versions).toEqual([3, 2, 1]);
  });
});

describe('export', () => {
  const TABLE_MARKDOWN =
    '# Headcount\n\n' +
    '| Team | Hires |\n' +
    '| --- | --- |\n' +
    '| Platform | wrenfeather |\n';

  const SLIDES_MARKDOWN =
    '# Kickoff\n' +
    '- welcome\n' +
    '- agenda\n\n' +
    '# Next steps\n' +
    '- follow up with quillhollow team\n';

  async function exportVersion(
    id: string,
    format: 'xlsx' | 'docx' | 'pptx',
    fromVersion?: number,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${id}/export`,
      headers: auth(),
      payload: { format, ...(fromVersion ? { fromVersion } : {}) },
    });
    return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
  }

  it('exports a markdown table as a downloadable xlsx, added as a new binary version', async () => {
    const id = await createArtifact(TABLE_MARKDOWN);
    const { statusCode, body } = await exportVersion(id, 'xlsx');

    expect(statusCode).toBe(201);
    expect(body).toMatchObject({ version: 2, format: 'xlsx' });
    expect(body['sizeBytes']).toBeGreaterThan(0);

    const download = await ctx.app.inject({
      url: `/v1/artifacts/${id}/versions/2/download`,
      headers: auth(),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(download.headers['content-disposition']).toContain('.xlsx');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(download.rawPayload).length).toBe(body['sizeBytes']);

    // The current (editable) version is still the markdown draft — an export is filed into
    // history and is downloadable, but it never becomes what the editor shows by default.
    const read = await ctx.app.inject({ url: `/v1/artifacts/${id}`, headers: auth() });
    expect(read.json()).toMatchObject({ currentVersion: 1, content: TABLE_MARKDOWN });
  });

  it('exports headings and bullets as a downloadable pptx', async () => {
    const id = await createArtifact(SLIDES_MARKDOWN);
    const { statusCode, body } = await exportVersion(id, 'pptx');
    expect(statusCode).toBe(201);
    expect(body).toMatchObject({ format: 'pptx' });

    const download = await ctx.app.inject({
      url: `/v1/artifacts/${id}/versions/${String(body['version'])}/download`,
      headers: auth(),
    });
    expect(download.statusCode).toBe(200);
  });

  it('refuses to export a table-less version as a spreadsheet, with a typed reason', async () => {
    const id = await createArtifact('just some prose, no table here');
    const { statusCode, body } = await exportVersion(id, 'xlsx');

    expect(statusCode).toBe(422);
    expect(body).toMatchObject({ error: { code: 'export_unsupported' } });
  });

  it('refuses to download a markdown version as a file', async () => {
    const id = await createArtifact('plain text');
    const response = await ctx.app.inject({
      url: `/v1/artifacts/${id}/versions/1/download`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(422);
  });

  it('refuses to export an already-exported (binary) version again', async () => {
    const id = await createArtifact(TABLE_MARKDOWN);
    await exportVersion(id, 'xlsx');
    const { statusCode, body } = await exportVersion(id, 'docx', 2);

    expect(statusCode).toBe(422);
    expect(body).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('hides another users artifact export and download behind a 404', async () => {
    const id = await createArtifact(TABLE_MARKDOWN);
    await exportVersion(id, 'xlsx');
    const intruder = await signUp(ctx);
    const headers = { cookie: intruder.cookie };

    const exportAttempt = await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${id}/export`,
      headers,
      payload: { format: 'xlsx' },
    });
    expect(exportAttempt.statusCode).toBe(404);

    const downloadAttempt = await ctx.app.inject({
      url: `/v1/artifacts/${id}/versions/2/download`,
      headers,
    });
    expect(downloadAttempt.statusCode).toBe(404);
  });
});

describe('references and filtering', () => {
  it('refuses to file an artifact into a project the caller does not own', async () => {
    const other = await signUp(ctx);
    const theirProject = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: other.cookie },
      payload: { title: 'theirs' },
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers: auth(),
      payload: { title: 'x', projectId: (theirProject.json() as { id: string }).id },
    });

    expect(response.statusCode).toBe(404);
  });

  it('filters the list by project and by kind', async () => {
    const owner = await signUp(ctx);
    const headers = { cookie: owner.cookie };
    const project = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers,
      payload: { title: 'filterable' },
    });
    const projectId = (project.json() as { id: string }).id;

    await ctx.app.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers,
      payload: { title: 'in project', kind: 'code', projectId },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers,
      payload: { title: 'loose', kind: 'document' },
    });

    const byProject = await ctx.app.inject({
      url: `/v1/artifacts?projectId=${projectId}`,
      headers,
    });
    expect((byProject.json() as { items: Array<{ title: string }> }).items.map((a) => a.title)).toEqual([
      'in project',
    ]);

    const byKind = await ctx.app.inject({ url: '/v1/artifacts?kind=document', headers });
    expect((byKind.json() as { items: Array<{ title: string }> }).items.map((a) => a.title)).toEqual([
      'loose',
    ]);
  });
});

describe('deletion and isolation', () => {
  it('deletes the artifact and its whole history', async () => {
    const id = await createArtifact();
    await appendVersion(id, 'v2');

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/v1/artifacts/${id}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);

    expect((await ctx.app.inject({ url: `/v1/artifacts/${id}`, headers: auth() })).statusCode).toBe(
      404,
    );
    expect(
      (await ctx.app.inject({ url: `/v1/artifacts/${id}/versions`, headers: auth() })).statusCode,
    ).toBe(404);
  });

  it('hides another users artifact behind a 404 on every route', async () => {
    const id = await createArtifact();
    const intruder = await signUp(ctx);
    const headers = { cookie: intruder.cookie };

    const attempts = [
      { method: 'GET' as const, url: `/v1/artifacts/${id}` },
      { method: 'GET' as const, url: `/v1/artifacts/${id}/versions` },
      { method: 'PATCH' as const, url: `/v1/artifacts/${id}`, payload: { title: 'mine' } },
      {
        method: 'POST' as const,
        url: `/v1/artifacts/${id}/versions`,
        payload: { content: 'mine' },
      },
      {
        method: 'POST' as const,
        url: `/v1/artifacts/${id}/restore`,
        payload: { restoreVersion: 1 },
      },
      { method: 'DELETE' as const, url: `/v1/artifacts/${id}` },
    ];

    for (const attempt of attempts) {
      const response = await ctx.app.inject({ ...attempt, headers });
      expect(response.statusCode, `${attempt.method} ${attempt.url} leaked`).toBe(404);
    }
  });
});
