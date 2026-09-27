/**
 * Slides artifacts (ADR-0041): stored as Markdown with one heading per slide, exported through
 * the same PowerPoint path as any Markdown version.
 */
import JSZip from 'jszip';
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

const DECK = '# Quarterly review\n\nSeptember 2026\n\n## Revenue\n\n- Up 12%\n- New region: Chennai\n\nNotes: say the number first\n\n## Costs\n\n| Item | Q1 |\n|---|---|\n| Staff | 10 |\n';

describe('slides artifacts', () => {
  it('are stored as a kind of their own and export to one PowerPoint slide per heading', async () => {
    const auth = { cookie: user.cookie };
    const made = await ctx.app.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers: auth,
      payload: { title: 'Review', kind: 'slides', content: DECK },
    });
    expect(made.statusCode).toBe(201);
    const artifact = made.json() as { id: string; kind: string };
    expect(artifact.kind).toBe('slides');

    const exported = await ctx.app.inject({
      method: 'POST',
      url: `/v1/artifacts/${artifact.id}/export`,
      headers: auth,
      payload: { format: 'pptx', fromVersion: 1 },
    });
    expect(exported.statusCode).toBe(201);
    const { version } = exported.json() as { version: number };
    const file = await ctx.app.inject({ url: `/v1/artifacts/${artifact.id}/versions/${version}/download`, headers: auth });
    const zip = await JSZip.loadAsync(file.rawPayload);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(3);
    const second = await zip.file('ppt/slides/slide2.xml')!.async('string');
    expect(second).toContain('Revenue');
    const notes = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
    const notesText = (await Promise.all(notes.map((n) => zip.file(n)!.async('string')))).join('');
    expect(notesText).toContain('say the number first');
  });
});
