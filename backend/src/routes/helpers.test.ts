/**
 * Pagination cursors, optimistic concurrency, and CSV escaping.
 */
import { describe, expect, it } from 'vitest';

import { assertVersion, decodeCursor, encodeCursor, fingerprint } from './helpers.js';
import { csvCell } from './usage.js';

describe('cursors', () => {
  it('round-trips a timestamp and an id', () => {
    const at = new Date('2026-03-14T10:00:00Z');
    const decoded = decodeCursor(encodeCursor(at, 'abc-123'));
    expect(decoded).toEqual({ at: at.getTime(), id: 'abc-123' });
  });

  it('treats a malformed cursor as "start from the beginning" rather than an error', () => {
    // Clients paste these into URLs; a 500 on a mangled one would be our bug, not theirs.
    expect(decodeCursor('not-base64-!!!')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(Buffer.from('no-separator').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('notanumber:abc').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from('123:').toString('base64url'))).toBeNull();
  });
});

describe('assertVersion', () => {
  it('passes when the caller sent no version, so concurrency control stays opt-in', () => {
    expect(() => assertVersion(undefined, 7, 'project')).not.toThrow();
  });

  it('passes on a match', () => {
    expect(() => assertVersion(7, 7, 'project')).not.toThrow();
  });

  it('raises a conflict carrying both versions on a mismatch', () => {
    try {
      assertVersion(6, 7, 'project');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toMatchObject({
        code: 'conflict',
        status: 409,
        meta: { expectedVersion: 6, actualVersion: 7 },
      });
    }
  });
});

describe('fingerprint', () => {
  it('is stable for the same body and different for a changed one', () => {
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });

  it('handles an absent body without throwing', () => {
    expect(fingerprint(undefined)).toBe(fingerprint(null));
  });
});

describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('claude-opus-5')).toBe('claude-opus-5');
    expect(csvCell(42)).toBe('42');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\r\nbreak')).toBe('"line\r\nbreak"');
  });

  it.each(['=cmd|calc', '+1', '-1+1', '@SUM(A1)'])(
    'neutralises the spreadsheet formula %j',
    (value) => {
      expect(csvCell(value).startsWith("'")).toBe(true);
    },
  );
});
