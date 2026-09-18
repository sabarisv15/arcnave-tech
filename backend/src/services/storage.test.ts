/**
 * Storage keys, upload policy, and path-traversal rejection.
 *
 * The traversal tests are the point of this file. Keys are server-generated, so a key that does
 * not match the generated shape means tampering or corruption — the local backend must refuse
 * it rather than join it onto a root directory and find out.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../config.js';
import type { ObjectStorage } from './storage.js';
import {
  checkUpload,
  extensionOf,
  generateStorageKey,
  LocalObjectStorage,
  safeDownloadName,
  sha256,
} from './storage.js';

const cfg = loadConfig({ NODE_ENV: 'test', MAX_UPLOAD_BYTES: '1000' });
const owner = '11111111-2222-3333-4444-555555555555';

describe('generateStorageKey', () => {
  it('contains no part of any client filename', () => {
    const key = generateStorageKey(owner);
    expect(key).toMatch(/^[a-f0-9]{4}\/\d{4}\/\d{2}\/[0-9a-f-]{36}\/[a-f0-9]{16}$/);
    expect(key).toContain(owner);
  });

  it('is unique per call', () => {
    expect(generateStorageKey(owner)).not.toBe(generateStorageKey(owner));
  });
});

describe('safeDownloadName', () => {
  it('strips directory separators', () => {
    expect(safeDownloadName('../../etc/passwd')).not.toContain('/');
    expect(safeDownloadName('..\\..\\windows\\system32')).not.toContain('\\');
  });

  it('never returns an empty name', () => {
    expect(safeDownloadName('...')).toBe('download');
    expect(safeDownloadName('')).toBe('download');
  });

  it('keeps an ordinary filename readable', () => {
    expect(safeDownloadName('Q3 report.pdf')).toBe('Q3 report.pdf');
  });
});

describe('extensionOf', () => {
  it('lowercases and handles a missing extension', () => {
    expect(extensionOf('Report.PDF')).toBe('.pdf');
    expect(extensionOf('Makefile')).toBe('');
  });
});

describe('checkUpload', () => {
  it('rejects a file over the configured ceiling', () => {
    const result = checkUpload('a.pdf', 'application/pdf', 2000, cfg);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('payload_too_large');
  });

  it('rejects an empty file', () => {
    expect(checkUpload('a.pdf', 'application/pdf', 0, cfg).ok).toBe(false);
  });

  it('accepts an allowed MIME with a matching extension', () => {
    expect(checkUpload('a.pdf', 'application/pdf', 100, cfg).ok).toBe(true);
  });

  it('rejects an allowed MIME with a contradicting extension', () => {
    const result = checkUpload('a.exe', 'application/pdf', 100, cfg);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unsupported_media_type');
  });

  it('falls back to the extension when the browser sends octet-stream, and records the corrected type', () => {
    const result = checkUpload('main.py', 'application/octet-stream', 100, cfg);
    expect(result.ok).toBe(true);
    expect(result.mimeType).toBe('text/plain');
  });

  it('rejects an executable regardless of the claimed type', () => {
    expect(checkUpload('setup.exe', 'application/octet-stream', 100, cfg).ok).toBe(false);
    expect(checkUpload('setup.exe', 'text/plain', 100, cfg).ok).toBe(false);
  });

  it('ignores charset parameters on the content type', () => {
    expect(checkUpload('a.csv', 'text/csv; charset=utf-8', 100, cfg).ok).toBe(true);
  });

  it('accepts a .xlsx upload when the browser sends the canonical MIME type', () => {
    const result = checkUpload(
      'report.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      100,
      cfg,
    );
    expect(result.ok).toBe(true);
  });

  it('falls back to the extension for a .xlsx upload the browser sent as octet-stream', () => {
    const result = checkUpload('report.xlsx', 'application/octet-stream', 100, cfg);
    expect(result.ok).toBe(true);
    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('falls back to the extension for a .xlsx upload with no claimed type at all', () => {
    expect(checkUpload('report.xlsx', '', 100, cfg).ok).toBe(true);
  });

  it('does not extension-fallback a .xlsx upload the browser actively claims is text', () => {
    // Unlike octet-stream (a browser being vague), an active text/* claim on a binary office
    // format means the browser is very likely wrong about the file itself, not just its type.
    expect(checkUpload('report.xlsx', 'text/plain', 100, cfg).ok).toBe(false);
  });
});

describe('LocalObjectStorage', () => {
  let root: string;
  // Typed as the interface, not the class: callers only ever hold an `ObjectStorage`, and the
  // local backend's `put` legitimately ignores the content type it has nowhere to store.
  let storage: ObjectStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'arcnave-storage-'));
    storage = new LocalObjectStorage(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips bytes under a generated key', async () => {
    const key = generateStorageKey(owner);
    const data = Buffer.from('hello');
    await storage.put(key, data, 'text/plain');
    expect(await storage.exists(key)).toBe(true);
    expect((await storage.get(key)).toString()).toBe('hello');
    expect(sha256(data)).toHaveLength(64);
  });

  it('deletes without complaining about a key that is already gone', async () => {
    const key = generateStorageKey(owner);
    await storage.put(key, Buffer.from('x'), 'text/plain');
    await storage.delete(key);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it.each([
    '../../../etc/passwd',
    'aaaa/2026/01/' + owner + '/../../../../../../etc/passwd',
    '/etc/passwd',
    'aaaa/2026/01/' + owner + '/not-hex-at-all',
    '',
  ])('refuses the malformed key %j', async (key) => {
    await expect(storage.put(key, Buffer.from('x'), 'text/plain')).rejects.toMatchObject({
      code: 'storage_error',
    });
    await expect(storage.get(key)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('reports a missing object as not_found rather than a 500', async () => {
    await expect(storage.get(generateStorageKey(owner))).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
