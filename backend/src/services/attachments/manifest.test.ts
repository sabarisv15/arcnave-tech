import { describe, expect, it } from 'vitest';

import { buildAttachmentManifest, sandboxInputNames } from './manifest.js';

const pdf = { id: '970b76e7-2f4e-44bd-9d35-ef7b9f221e56', filename: 'kvb fedral.pdf', mimeType: 'application/pdf', sizeBytes: 10 };
const csv = { id: 'aaaaaaaa-0000-0000-0000-000000000000', filename: 'data.csv', mimeType: 'text/csv', sizeBytes: 5 };
const csv2 = { id: 'bbbbbbbb-1111-0000-0000-000000000000', filename: 'data.csv', mimeType: 'text/csv', sizeBytes: 6 };

describe('sandboxInputNames', () => {
  it('sanitises, and suffixes a repeated name with the fileId, in list order', () => {
    expect([...sandboxInputNames([pdf, csv, csv2]).values()]).toEqual(['kvb_fedral.pdf', 'data.csv', 'data_bbbbbbbb.csv']);
  });

  it('never yields a name that escapes input/', () => {
    const names = sandboxInputNames([{ id: 'x1', filename: '../../etc/passwd' }, { id: 'x2', filename: '..' }]);
    for (const n of names.values()) expect(n).not.toContain('/');
    expect(names.get('x2')).not.toBe('..');
  });
});

describe('buildAttachmentManifest', () => {
  it('prints the path on the computer, and names no skill: the prompt maps work to skills after the model has looked (ADR-0047)', () => {
    const text = buildAttachmentManifest([pdf], { sandbox: true });
    expect(text).toContain('path: input/kvb_fedral.pdf');
    expect(text).not.toContain('skill');
    expect(text).not.toContain('load_skill');
  });

  it('promises no path it cannot keep', () => {
    expect(buildAttachmentManifest([pdf], { sandbox: false })).not.toContain('path:');
  });

  it('is empty for no files', () => {
    expect(buildAttachmentManifest([], { sandbox: true })).toBe('');
  });
});

describe('Office files are read with code only where the sandbox has the readers (ADR-0045)', () => {
  it('warm service and local process engines read them; the Cloud Run Job image does not', async () => {
    const { sandboxReadsOfficeFiles } = await import('../../tools/catalog.js');
    const cfg = (v: Record<string, unknown>) => v as unknown as Parameters<typeof sandboxReadsOfficeFiles>[0];
    expect(sandboxReadsOfficeFiles(cfg({ SANDBOX_ENGINE: 'warm' }))).toBe(true);
    expect(sandboxReadsOfficeFiles(cfg({ SANDBOX_ENGINE: 'auto', SANDBOX_SERVICE_URL: 'https://s' }))).toBe(true);
    expect(sandboxReadsOfficeFiles(cfg({ SANDBOX_ENGINE: 'process' }))).toBe(true);
    // sandbox/Dockerfile (the Job) has no xlrd, python-docx or python-pptx.
    expect(sandboxReadsOfficeFiles(cfg({ SANDBOX_ENGINE: 'cloud-run' }))).toBe(false);
    expect(sandboxReadsOfficeFiles(cfg({ SANDBOX_ENGINE: 'auto' }))).toBe(false);
  });
});
