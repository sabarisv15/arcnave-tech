/**
 * Project files reach the model whole while they fit, as Claude keeps project knowledge in
 * context, and as excerpts past that, as Claude switches to search (ADR-0020). The limit is
 * shrunk so a small fixture crosses it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { TestContext, TestUser } from '../test/harness.js';
import { createTestApp, multipart, parseSse, signUp } from '../test/harness.js';

let ctx: TestContext;
let user: TestUser;

beforeAll(async () => {
  ctx = await createTestApp({ PROJECT_FULL_CONTEXT_MAX_CHARS: '20000' });
  user = await signUp(ctx);
});
afterAll(async () => {
  await ctx.close();
});

const headers = () => ({ cookie: user.cookie });

async function projectWith(files: Record<string, string>): Promise<string> {
  const project = await ctx.app.inject({ method: 'POST', url: '/v1/projects', headers: headers(), payload: { title: 'p' } });
  const projectId = (project.json() as { id: string }).id;
  for (const [name, body] of Object.entries(files)) {
    const part = multipart(name, Buffer.from(body), 'text/plain');
    const res = await ctx.app.inject({ method: 'POST', url: `/v1/projects/${projectId}/files`, headers: { ...part.headers, ...headers() }, payload: part.payload });
    expect(res.statusCode).toBe(201);
  }
  return projectId;
}

async function ask(projectId: string, prompt: string) {
  const chat = await ctx.app.inject({ method: 'POST', url: '/v1/chats', headers: headers(), payload: { title: 'c', projectId } });
  const chatId = (chat.json() as { id: string }).id;
  const res = await ctx.app.inject({ method: 'POST', url: `/v1/chats/${chatId}/generate`, headers: headers(), payload: { prompt } });
  return { frames: parseSse(res.body), request: ctx.provider.seen.at(-1)! };
}

// Paragraphs of distinct words, so the chunker splits it and every part is checkable.
const doc = (tag: string, paragraphs: number) =>
  Array.from({ length: paragraphs }, (_, i) => `${tag} paragraph ${String(i)}: ${'lorem ipsum dolor '.repeat(12).trim()}`).join('\n\n');

describe('project knowledge (ADR-0020)', () => {
  it('puts every file in whole while they fit, whatever the question', async () => {
    const plan = `${doc('plan', 30)}\n\nPLAN-END-MARKER`;
    const projectId = await projectWith({ 'plan.txt': plan, 'notes.txt': 'Notes: budget is 4200.' });
    const { frames, request } = await ask(projectId, 'hello');

    expect(request.systemInstruction).toContain('They are whole documents, not excerpts.');
    // The whole text, once: no chunk overlap repeated, nothing cut.
    expect(request.systemInstruction).toContain(plan);
    expect(request.systemInstruction.split('plan paragraph 17:').length).toBe(2);
    expect(request.systemInstruction).toContain('Notes: budget is 4200.');
    const labels = frames.filter((f) => f.event === 'research').map((f) => (f.data.event as { label: string }).label);
    expect(labels).toContain('Using all 2 project files in full');
  });

  it('sends excerpts by relevance once the files are past the limit', async () => {
    const projectId = await projectWith({ 'big.txt': `${doc('big', 150)}\n\nThe budget figure is 4200.` });
    const { request } = await ask(projectId, 'what is the budget figure');

    expect(request.systemInstruction).not.toContain('They are whole documents');
    expect(request.systemInstruction).toContain('These are partial extracts, not whole documents.');
    expect(request.systemInstruction).toContain('The budget figure is 4200.');
    expect(request.systemInstruction).not.toContain('big paragraph 3:');
  });
});
