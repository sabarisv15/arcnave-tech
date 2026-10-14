import { describe, expect, it } from 'vitest';

import { sizeReport } from '../../tools/memoryExecutor.js';
import { fileAliases, MEMORY_FILE_MAX_BYTES } from './memoryService.js';

describe('memory file aliases (ADR-0052)', () => {
  it('reads a bracketed or a bare aliases line from the frontmatter', () => {
    expect(fileAliases('---\nname: auth-redesign\ndescription: d\naliases: [the auth thing, "auth v2"]\n---\n- (stated) x')).toEqual([
      'the auth thing',
      'auth v2',
    ]);
    expect(fileAliases('---\r\nname: sam\r\naliases: Sammy, S\r\n---\r\n- (stated) x')).toEqual(['Sammy', 'S']);
  });

  it('gives none for a file without frontmatter or aliases, and at most 8', () => {
    expect(fileAliases('- (stated) likes tea')).toEqual([]);
    expect(fileAliases('---\nname: x\n---\n')).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => `a${String(i)}`).join(', ');
    expect(fileAliases(`---\naliases: [${many}]\n---\n`)).toHaveLength(8);
  });
});

describe('memory tool results report size against the cap (ADR-0052)', () => {
  it('reports free space, and a consolidate note only near the cap', () => {
    const small = sizeReport(100);
    expect(small).toEqual({ sizeBytes: 100, capBytes: MEMORY_FILE_MAX_BYTES, freeBytes: MEMORY_FILE_MAX_BYTES - 100 });
    const near = sizeReport(Math.ceil(MEMORY_FILE_MAX_BYTES * 0.9));
    expect(near.note).toContain('consolidate');
    expect(sizeReport(MEMORY_FILE_MAX_BYTES + 10).freeBytes).toBe(0);
  });
});
