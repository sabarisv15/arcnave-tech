/**
 * `ProjectToolExecutor` against a real project's indexed files.
 *
 * Runs against real Postgres via the shared test harness — this executor's whole job is running
 * database queries, so a mock would prove nothing about whether the queries are actually right.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { chunkText, LexicalRetriever } from '../services/retrieval.js';
import { createTestApp, signUp } from '../test/harness.js';
import type { TestContext } from '../test/harness.js';
import type { ToolContent } from '../providers/types.js';
import { ProjectToolExecutor } from './executor.js';

let ctx: TestContext;
let projectId: string;
let fileId: string;

function jsonContent(content: ToolContent[]): Record<string, unknown> {
  const block = content[0];
  if (!block || block.type !== 'json') throw new Error('expected a json content block');
  return block.data as Record<string, unknown>;
}

beforeAll(async () => {
  ctx = await createTestApp();
  const user = await signUp(ctx);
  const project = await ctx.app.inject({
    method: 'POST',
    url: '/v1/projects',
    headers: { cookie: user.cookie },
    payload: { title: 'Tool executor fixture' },
  });
  projectId = (project.json() as { id: string }).id;

  const schema = await import('../db/schema.js');
  const [row] = await ctx.db
    .insert(schema.projectFiles)
    .values({
      projectId,
      userId: user.id,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 20,
      // Unique per run: the test database persists across `vitest run` invocations (see
      // harness.ts's isolation-by-ownership comment), and a hardcoded key would collide with
      // the row this same test left behind last time.
      storageKey: `fixture/notes-${String(Date.now())}-${String(Math.random()).slice(2)}.txt`,
      status: 'ready',
    })
    .returning({ id: schema.projectFiles.id });
  fileId = row!.id;

  // Long enough to produce multiple chunks, so pagination has something to page through.
  const paragraphs = Array.from(
    { length: 20 },
    (_, i) => `Paragraph ${String(i)} about the quarterly cooling budget review.`,
  ).join('\n\n');
  // Chunks as the project ingest writes them (fileJobs.ts); this test is about the tool, not ingest.
  await ctx.db.insert(schema.fileChunks).values(
    chunkText(paragraphs).map((text, ordinal) => ({ projectFileId: fileId, projectId, ordinal, text, charCount: text.length, page: null })),
  );
});

afterAll(async () => {
  await ctx.close();
});

function executor(pid = projectId, maxChars = 6000): ProjectToolExecutor {
  return new ProjectToolExecutor(ctx.db, new LexicalRetriever(), pid, maxChars);
}

describe('ProjectToolExecutor.search_project_files', () => {
  it('finds an indexed chunk by keyword, as structured json', async () => {
    const result = await executor().execute(
      { id: 'call-1', name: 'search_project_files', input: { query: 'cooling budget' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    const data = jsonContent(result.content) as { results: Array<{ fileId: string; text: string }> };
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0]!.fileId).toBe(fileId);
    expect(data.results[0]!.text).toContain('cooling budget');
  });

  it('honours the limit argument', async () => {
    const result = await executor().execute(
      { id: 'call-1b', name: 'search_project_files', input: { query: 'paragraph cooling', limit: 2 } },
      new AbortController().signal,
    );
    const data = jsonContent(result.content) as { results: unknown[] };
    expect(data.results.length).toBeLessThanOrEqual(2);
  });

  it('reports no match as explicit text, not an empty structure', async () => {
    const result = await executor().execute(
      { id: 'call-2', name: 'search_project_files', input: { query: 'spacecraft telemetry' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'No matching excerpts were found for that query.' },
    ]);
  });

  it('rejects a missing query rather than throwing', async () => {
    const result = await executor().execute(
      { id: 'call-3', name: 'search_project_files', input: {} },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('Invalid input');
  });

  it('only searches the current project', async () => {
    const otherUser = await signUp(ctx, 'Other');
    const otherProject = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: otherUser.cookie },
      payload: { title: 'Other project' },
    });
    const otherProjectId = (otherProject.json() as { id: string }).id;
    const result = await executor(otherProjectId).execute(
      { id: 'call-1c', name: 'search_project_files', input: { query: 'cooling budget' } },
      new AbortController().signal,
    );
    expect(result.content).toEqual([
      { type: 'text', text: 'No matching excerpts were found for that query.' },
    ]);
  });
});

describe('ProjectToolExecutor.read_project_file', () => {
  it('returns ordered content and reports truncation with a hard char cap', async () => {
    const result = await executor(projectId, 50).execute(
      { id: 'call-4', name: 'read_project_file', input: { fileId } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    const data = jsonContent(result.content) as {
      filename: string;
      content: string;
      truncated: boolean;
      nextCursor: number | null;
    };
    expect(data.filename).toBe('notes.txt');
    expect(data.content.length).toBeLessThanOrEqual(50);
    expect(data.truncated).toBe(true);
    expect(data.nextCursor).not.toBeNull();
  });

  it('resumes from the cursor returned by a previous call', async () => {
    const first = jsonContent(
      (
        await executor(projectId, 50).execute(
          { id: 'call-5a', name: 'read_project_file', input: { fileId } },
          new AbortController().signal,
        )
      ).content,
    ) as { content: string; nextCursor: number };

    const second = jsonContent(
      (
        await executor(projectId, 50).execute(
          { id: 'call-5b', name: 'read_project_file', input: { fileId, cursor: first.nextCursor } },
          new AbortController().signal,
        )
      ).content,
    ) as { content: string };

    expect(second.content).not.toBe(first.content);
  });

  it('never exceeds the server hard cap even if maxChars asks for more', async () => {
    const result = await executor(projectId, 50).execute(
      { id: 'call-6', name: 'read_project_file', input: { fileId, maxChars: 1_000_000 } },
      new AbortController().signal,
    );
    const data = jsonContent(result.content) as { content: string };
    expect(data.content.length).toBeLessThanOrEqual(50);
  });

  it('reports no further content once the file is exhausted', async () => {
    let cursor: number | undefined;
    let lastTruncated = true;
    for (let i = 0; i < 50 && lastTruncated; i += 1) {
      const data = jsonContent(
        (
          await executor(projectId, 6000).execute(
            { id: `call-7-${String(i)}`, name: 'read_project_file', input: { fileId, cursor } },
            new AbortController().signal,
          )
        ).content,
      ) as { truncated: boolean; nextCursor: number | null };
      lastTruncated = data.truncated;
      cursor = data.nextCursor ?? undefined;
    }
    expect(lastTruncated).toBe(false);
  });

  it('refuses a file id from a different project', async () => {
    const otherUser = await signUp(ctx, 'Other2');
    const otherProject = await ctx.app.inject({
      method: 'POST',
      url: '/v1/projects',
      headers: { cookie: otherUser.cookie },
      payload: { title: 'Other project 2' },
    });
    const otherProjectId = (otherProject.json() as { id: string }).id;
    const result = await executor(otherProjectId).execute(
      { id: 'call-8', name: 'read_project_file', input: { fileId } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('No indexed file');
  });

  it('rejects an invalid fileId without throwing', async () => {
    const result = await executor().execute(
      { id: 'call-9', name: 'read_project_file', input: { fileId: 'not-a-uuid' } },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
  });
});

describe('ProjectToolExecutor unknown tool', () => {
  it('returns an explicit failed result without throwing', async () => {
    const result = await executor().execute(
      { id: 'call-10', name: 'delete_everything', input: {} },
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'Unknown tool "delete_everything".' }]);
  });
});

describe('ProjectToolExecutor abort', () => {
  it('refuses to execute when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await executor().execute(
      { id: 'call-11', name: 'search_project_files', input: { query: 'cooling' } },
      controller.signal,
    );
    expect(result.ok).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('aborted');
  });
});
