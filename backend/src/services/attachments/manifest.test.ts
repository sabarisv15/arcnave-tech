import { describe, expect, it } from 'vitest';

import { buildAttachmentManifest, sandboxInputNames, skillForFile } from './manifest.js';

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

describe('skillForFile', () => {
  it('maps by MIME type, falling back to the extension', () => {
    expect(skillForFile(pdf)).toBe('pdf');
    expect(skillForFile({ filename: 'q.XLSX', mimeType: 'application/octet-stream' })).toBe('xlsx');
    expect(skillForFile({ filename: 'photo.png', mimeType: 'image/png' })).toBeUndefined();
  });
});

describe('buildAttachmentManifest', () => {
  it('prints the sandbox path and the skill, and says what to do with them', () => {
    const text = buildAttachmentManifest([pdf], { sandbox: true, loadableSkills: new Set(['pdf']) });
    expect(text).toContain('run_python path: input/kvb_fedral.pdf');
    expect(text).toContain('skill: pdf');
    expect(text).toContain('call load_skill for the skill named on its line');
  });

  it('promises neither a path nor a skill it cannot keep', () => {
    const text = buildAttachmentManifest([pdf], { sandbox: false, loadableSkills: new Set() });
    expect(text).not.toContain('run_python path');
    expect(text).not.toContain('skill:');
    expect(text).not.toContain('load_skill');
  });

  it('is empty for no files', () => {
    expect(buildAttachmentManifest([], { sandbox: true, loadableSkills: new Set(['pdf']) })).toBe('');
  });
});
