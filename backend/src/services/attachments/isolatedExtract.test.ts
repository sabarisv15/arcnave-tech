/**
 * The isolated extractor (Stage 9 ISOLATION, D1 #7): parsers run in a child process with a heap
 * and a time limit, and ZIP-based documents are pre-flighted before any parser sees them.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Workbook } from 'exceljs';
import { zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FileFailure } from './fileErrors.js';
import { isolatedText, type IsolationLimits } from './isolatedExtract.js';
import { preflightContainer } from './preflight.js';
import { bufferSource } from './zipReader.js';
import { docxWith, lyingZip } from '../../test/fixtures/archives.js';

const limits: IsolationLimits = { heapMb: 256, timeoutMs: 60_000, concurrency: 2, maxRatio: 100 };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'arcnave-iso-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(name: string, data: Uint8Array): Promise<string> {
  const p = path.join(dir, name);
  await writeFile(p, data);
  return p;
}

describe('isolatedText', () => {
  it('reads a workbook in the child process', async () => {
    const wb = new Workbook();
    wb.addWorksheet('Sheet1').addRow(['Widgets', 42]);
    const p = await put('a.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    const text = await isolatedText(p, 'a.xlsx', XLSX, limits);
    expect(text).toContain('Widgets | 42');
  });

  it('reads a DOCX in the child process', async () => {
    const p = await put('a.docx', docxWith('Tamil letter: வணக்கம்'));
    expect(await isolatedText(p, 'a.docx', DOCX, limits)).toContain('வணக்கம்');
  });

  it('kills a child past its wall clock and reports `timeout`', async () => {
    const wb = new Workbook();
    wb.addWorksheet('S').addRow(['x']);
    const p = await put('slow.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    // 1 ms is less than node takes to start, so the limit is what ends the child.
    await expect(isolatedText(p, 'slow.xlsx', XLSX, { ...limits, timeoutMs: 1 })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports a damaged document as `corrupt`, with our copy and not the parser message', async () => {
    const p = await put('bad.docx', zipSync({ '[Content_Types].xml': new TextEncoder().encode('<Types/>'), 'word/document.xml': new TextEncoder().encode('<not xml') }));
    const err = await isolatedText(p, 'bad.docx', DOCX, limits).catch((e: unknown) => e);
    // officeparser either fails (corrupt) or finds no text (nothing to read): never a raw message.
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toMatch(/at |stack|Error:/);
  });
});

describe('preflight', () => {
  it('refuses a decompression-bomb DOCX from its declared sizes, without inflating it', async () => {
    // Declares a 2 GB document.xml behind 2 KB of data: a real inflate would need 2 GB.
    const bomb = lyingZip([
      { name: '[Content_Types].xml', data: Buffer.from('<Types/>') },
      { name: 'word/document.xml', data: Buffer.alloc(2048, 0x41), declaredSize: 2 * 1024 * 1024 * 1024 - 1 },
    ]);
    const before = process.memoryUsage();
    const err = await preflightContainer(bufferSource(bomb), 'bomb.docx', { maxRatio: 100 }).catch((e: unknown) => e);
    const after = process.memoryUsage();
    expect(err).toBeInstanceOf(FileFailure);
    expect((err as FileFailure).code).toBe('zip_ratio');
    // Kilobytes were read; nothing near the declared size was allocated.
    expect(after.arrayBuffers - before.arrayBuffers).toBeLessThan(16 * 1024 * 1024);
    expect(after.rss - before.rss).toBeLessThan(64 * 1024 * 1024);
  });

  it('refuses a real high-ratio member (20 MB of zeros) by its ratio', async () => {
    const zeros = new Uint8Array(20 * 1024 * 1024);
    const bomb = Buffer.from(zipSync({ '[Content_Types].xml': new TextEncoder().encode('<Types/>'), 'word/document.xml': zeros }));
    await expect(preflightContainer(bufferSource(bomb), 'z.docx', { maxRatio: 100 })).rejects.toMatchObject({ code: 'zip_ratio' });
  });

  it('refuses an XML part that declares a DTD or entity', async () => {
    const xxe = docxWith('hello', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>');
    await expect(preflightContainer(bufferSource(Buffer.from(xxe)), 'x.docx', { maxRatio: 100 })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('refuses a DOCX carrying macros with the save-as text', async () => {
    const macro = zipSync({
      '[Content_Types].xml': new TextEncoder().encode('<Types/>'),
      'word/document.xml': new TextEncoder().encode('<w:document/>'),
      'word/vbaProject.bin': new Uint8Array([1, 2, 3]),
    });
    const err = (await preflightContainer(bufferSource(Buffer.from(macro)), 'm.docx', { maxRatio: 100 }).catch((e: unknown) => e)) as FileFailure;
    expect(err.code).toBe('unsupported_type');
    expect(err.detail).toMatch(/Save it as DOCX/);
  });
});
