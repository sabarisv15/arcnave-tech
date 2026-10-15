/**
 * Units of the ingest path (tech-build.2): OCR need detection and answer parsing, the 3-hour
 * audio check, text decoding, the HEIC / UTF-16 sniff, and the chunker's token sizing.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Provider } from '../../providers/types.js';
import { transcribe } from './audio.js';
import { chunkLines, chunkSize, planChunks } from './derivatives.js';
import { FileFailure } from './fileErrors.js';
import { pageNeedsOcr, parseOcrAnswer } from './ocr.js';
import { detectKind } from './sniff.js';
import { decodeTextFile } from './textDecode.js';

const run = promisify(execFile);
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ingest-units-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('pageNeedsOcr', () => {
  it('sends a page with no real text to OCR', () => {
    expect(pageNeedsOcr('')).toBe('empty');
    expect(pageNeedsOcr('  3  ')).toBe('empty');
  });
  it('sends a page of unmapped glyph ids to OCR', () => {
    expect(pageNeedsOcr('(cid:12)(cid:45)(cid:77) Total (cid:9) amount due 4500')).toBe('cid');
  });
  it('sends a page of private-use and replacement characters to OCR', () => {
    expect(pageNeedsOcr(' �� ab cd ef gh ij')).toBe('garbage');
  });
  it('sends a legacy Tamil font page (Latin-1 symbols) to OCR', () => {
    // TSCII-style: Tamil glyphs mapped onto Latin-1 symbols.
    expect(pageNeedsOcr('¾Á¢ú ¸¨Ä¢ ¿¡ðÎ ¦¾¡Æ¢ø ¬ö× ±ýÚ ÌÈ¢ôÒ ¯ñ§¼')).toBe('garbage');
  });
  it('sends a legacy Tamil font page (Bamini-style ASCII) to OCR', () => {
    expect(pageNeedsOcr('jkpo;ehL muR ghlj;jpl;lk; nghJ kf;fs; tsh;r;rp jpl;lq;fs; Nkk;ghL')).toBe('garbage');
  });
  it('keeps real text of any script', () => {
    expect(pageNeedsOcr('Opening balance 12,34,567.00 carried forward to the next statement')).toBeNull();
    expect(pageNeedsOcr('தமிழ்நாடு அரசு கல்வித் துறை அறிவிப்பு எண் 45')).toBeNull();
    expect(pageNeedsOcr('Café crème brûlée à la française, déjà vu')).toBeNull();
  });
});

describe('parseOcrAnswer', () => {
  it('splits the answer at the page markers, and leaves out pages it did not ask for', () => {
    const out = parseOcrAnswer('=== PAGE 3 ===\nthree\n=== PAGE 4 ===\nfour lines\nmore\n=== PAGE 9 ===\nnot asked', [3, 4]);
    expect(out).toEqual([
      { num: 3, text: 'three' },
      { num: 4, text: 'four lines\nmore' },
    ]);
  });
  it('returns no page when the markers are missing', () => {
    expect(parseOcrAnswer('just text', [1])).toEqual([]);
  });
});

describe('audio duration (N-10: ≤ 3 h)', () => {
  it('refuses a recording longer than the limit before any transcription', async () => {
    const file = path.join(dir, 'long.wav');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '12', file]);
    let calls = 0;
    const provider = { readMedia: async () => ({ text: 'x', finishReason: 'STOP', model: 'm' }) } as unknown as Provider & Required<Pick<Provider, 'readMedia'>>;
    provider.readMedia = async () => {
      calls += 1;
      return { text: 'x', finishReason: 'STOP', model: 'm' };
    };
    await expect(
      transcribe(file, provider, { maxSeconds: 10, segmentSeconds: 90, overlapSeconds: 2, deadlineMs: 5000, concurrency: 1 }),
    ).rejects.toMatchObject({ code: 'too_large' });
    expect(calls).toBe(0);
  });
  it('reads a file ffprobe cannot as corrupt', async () => {
    const file = path.join(dir, 'junk.mp3');
    await writeFile(file, Buffer.from('not audio at all'));
    const provider = {} as Provider & Required<Pick<Provider, 'readMedia'>>;
    await expect(transcribe(file, provider, { maxSeconds: 10, segmentSeconds: 90, overlapSeconds: 2, deadlineMs: 5000, concurrency: 1 })).rejects.toBeInstanceOf(FileFailure);
  });
});

describe('text decoding (D1 #31)', () => {
  const decode = async (name: string, bytes: Buffer) => {
    const p = path.join(dir, name);
    await writeFile(p, bytes);
    const out = path.join(dir, `${name}.out`);
    const r = await decodeTextFile(p, out, 1000);
    return { ...r, written: await readFile(out, 'utf8') };
  };
  it('reads UTF-16 LE with a BOM', async () => {
    const r = await decode('a.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('name,ஊர்\nA,சென்னை\n', 'utf16le')]));
    expect(r).toMatchObject({ encoding: 'utf-16le', text: 'name,ஊர்\nA,சென்னை\n', warnings: [] });
  });
  it('reads UTF-16 BE with a BOM, across chunk boundaries', async () => {
    const le = Buffer.from('x,y\n'.repeat(300_000), 'utf16le');
    const r = await decode('b.csv', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(le).swap16()]));
    expect(r.encoding).toBe('utf-16be');
    expect(r.chars).toBe(1_200_000);
    expect(r.written.startsWith('x,y\nx,y\n')).toBe(true);
    expect(r.text).toBeNull(); // longer than keepChars: only the head is held
  });
  it('reads UTF-16 LE without a BOM', async () => {
    const r = await decode('c.txt', Buffer.from('plain words here\n', 'utf16le'));
    expect(r).toMatchObject({ encoding: 'utf-16le', text: 'plain words here\n' });
  });
  it('reads Windows-1252 when it is not UTF-8, and says so', async () => {
    const r = await decode('d.csv', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x2c, 0x80, 0x0a]));
    expect(r).toMatchObject({ encoding: 'windows-1252', text: 'café,€\n' });
    expect(r.warnings.map((w) => w.code)).toEqual(['encoding_guess']);
  });
  it('fails a NUL in the text as corrupt (binary under a text name)', async () => {
    await expect(decode('e.txt', Buffer.from('abc\0def'))).rejects.toMatchObject({ code: 'corrupt' });
  });
});

describe('sniff', () => {
  it('knows a HEIC still by its ftyp brand, and UTF-16 text without a BOM', () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(16)]);
    expect(detectKind(heic)).toBe('heic');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(16)]);
    expect(detectKind(mp4)).toBe('media');
    expect(detectKind(Buffer.from('a,b\n1,2\nthree,four\n', 'utf16le'))).toBe('text');
  });
});

describe('chunks of ~800 tokens (N-14)', () => {
  it('sizes chunks from the file’s own count, and by characters with none', () => {
    expect(chunkSize({ gemini: { tokens: 1000, exact: true, model: 'm' } }, 5000)).toEqual({ target: 4000, overlap: 600, sizedBy: 'tokens' });
    expect(chunkSize({ gemini: { tokens: null, exact: false, model: '', reason: 'too_large' } }, 5000)).toMatchObject({ sizedBy: 'chars' });
  });
  it('repeats a CSV header at the top of every chunk, and overlaps by whole lines', () => {
    const rows = Array.from({ length: 50 }, (_, i) => `row${String(i)},${'v'.repeat(30)}`).join('\n');
    const chunks = chunkLines(rows, 400, 60, 'name,value');
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks.slice(1)) expect(c.text.startsWith('name,value\n')).toBe(true);
    expect(chunks[1]!.first).toBeLessThanOrEqual(chunks[0]!.last); // the last line repeats (overlap)
  });
  it('gives each chunk a locator: a page, a sheet range, or lines', () => {
    const plan = planChunks({
      kind: 'pdf',
      units: [
        { kind: 'page', label: 'p. 1', text: 'first page', source: 'text' },
        { kind: 'page', label: 'p. 2', text: 'second page', source: 'ocr' },
      ],
      markdown: '',
      markdownChars: 21,
      sidecar: {},
    });
    expect(plan.chunks.map((c) => [c.page, c.locator])).toEqual([
      [1, 'p. 1'],
      [2, 'p. 2'],
    ]);
  });
});
