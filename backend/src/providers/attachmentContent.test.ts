/**
 * G15 / G17 on both providers: an attachment whose content is not in the request is described,
 * never sent as an empty block or as binary bytes posing as text.
 */
import { describe, expect, it } from 'vitest';

import { buildAnthropicMessages } from './anthropicVertex.js';
import { buildGeminiContents } from './gemini.js';
import type { AttachmentBlock, GenerationRequest } from './types.js';

const FILE_ID = '11111111-2222-3333-4444-555555555555';
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0xff, 0xfe]).toString('base64');

function request(att: AttachmentBlock): GenerationRequest {
  return {
    prompt: 'use it',
    history: [],
    attachments: [att],
    systemInstruction: '',
    mode: 'chat',
    maxOutputTokens: 100,
    providerModelId: 'm',
    grounded: false,
    codeExecution: false,
    signal: new AbortController().signal,
  } as GenerationRequest;
}

function claudeWire(att: AttachmentBlock): string {
  return JSON.stringify(buildAnthropicMessages(request(att)));
}
function geminiWire(att: AttachmentBlock): string {
  return JSON.stringify(buildGeminiContents(request(att)));
}

const cases: Array<[string, AttachmentBlock]> = [
  [
    'PDF left out by the history budget',
    { id: FILE_ID, filename: 'bank.pdf', mimeType: 'application/pdf', sizeBytes: 3_000_000, omittedReason: 'history_budget' },
  ],
  [
    'PDF whose bytes storage could not return',
    { id: FILE_ID, filename: 'bank.pdf', mimeType: 'application/pdf', sizeBytes: 3_000_000, omittedReason: 'storage_unavailable' },
  ],
  [
    'Office file whose extraction failed, raw ZIP bytes present',
    {
      id: FILE_ID,
      filename: 'report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      base64: ZIP_BYTES,
      extractedText: null,
    },
  ],
];

describe.each([
  ['Claude', claudeWire],
  ['Gemini', geminiWire],
] as const)('%s adapter', (_provider, wire) => {
  for (const [label, att] of cases) {
    it(`${label}: names the fileId and sends no empty or binary content`, () => {
      const out = wire(att);
      expect(out).toContain(FILE_ID);
      expect(out).toContain('read_uploaded_file');
      expect(out).not.toContain('"data":""');
      expect(out).not.toContain('Empty or unreadable');
      expect(out).not.toContain(ZIP_BYTES);
      expect(out).not.toContain('PK\\u0003\\u0004');
      expect(out).not.toContain('inlineData');
    });
  }

  it('says which reason applies', () => {
    expect(wire(cases[0]![1])).toContain('per-request size budget');
    expect(wire(cases[1]![1])).toContain('could not be loaded from storage');
    expect(wire(cases[2]![1])).toContain('text extraction failed');
  });

  it('a textual file with only its bytes is sent as its text', () => {
    const csv = Buffer.from('a,b\n1,2').toString('base64');
    expect(wire({ id: FILE_ID, filename: 'x.csv', mimeType: 'text/csv', base64: csv })).toContain('a,b\\n1,2');
  });

  it('an old PDF with genuine extracted text sends that text, and says the file itself was left out', () => {
    const out = wire({ ...cases[0]![1], extractedText: 'Opening balance 100' });
    expect(out).toContain('Opening balance 100');
    expect(out).toContain('per-request size budget');
    expect(out).toContain(FILE_ID);
  });

  it('a normal Office file with extracted text carries no omission note', () => {
    const out = wire({ id: FILE_ID, filename: 'r.docx', mimeType: cases[2]![1].mimeType, extractedText: 'Hello' });
    expect(out).toContain('Hello');
    expect(out).not.toContain('not included');
  });
});
