import { describe, expect, it } from 'vitest';

import { errorLogFields } from './errorLog.js';

describe('errorLogFields', () => {
  it('reads type and codes along the cause chain and never the text', () => {
    const root = Object.assign(new Error('Key (email)=(a@b.test) already exists'), { code: '23505' });
    class QueryFailure extends Error {
      constructor(cause: Error) {
        super('Failed query: insert ... params: a@b.test', { cause });
      }
    }
    const fields = errorLogFields(new QueryFailure(root));
    expect(fields).toMatchObject({ errorType: 'QueryFailure', rootType: 'Error', rootCode: '23505' });
    expect(JSON.stringify(fields)).not.toContain('a@b.test');
    expect(fields.messageLength).toBeGreaterThan(0);
  });

  it('drops a code that is not identifier-shaped, and survives non-errors and cause cycles', () => {
    expect(errorLogFields(Object.assign(new Error('x'), { code: 'a@b.test has spaces' }))).not.toHaveProperty('errorCode');
    expect(errorLogFields('a@b.test')).toEqual({ errorType: 'string' });
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(() => errorLogFields(loop)).not.toThrow();
  });
});
