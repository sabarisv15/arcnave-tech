/**
 * G15 / G17 on both providers: an attachment whose content is not in the request is described,
 * never sent as an empty block or as binary bytes posing as text.
 */
import { describe, expect, it } from 'vitest';

import { readOfficeFilesWithCode } from '../services/generation.js';
import { buildAnthropicMessages } from './anthropic.js';
import { HOSTILE_NAME, HOSTILE_NAME_SHOWN, expectHostileNameNeutralised } from '../test/untrustedNames.js';
import { asReadWithCode, nameForModel, pageLabel, unavailableAttachmentNote } from './attachmentContent.js';
import { buildGeminiContents } from './gemini.js';
import type { AttachmentBlock, GenerationRequest, Turn } from './types.js';

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
      expect(out).toContain('input/');
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

describe('Office files are read with code when the turn has a sandbox (ADR-0045)', () => {
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const sheet: AttachmentBlock = { id: FILE_ID, filename: 'ledger.xlsx', mimeType: XLSX, extractedText: 'A | 100' };

  it.each([
    ['ledger.xlsx', XLSX],
    ['notes.docx', cases[2]![1].mimeType],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['old.xls', 'application/vnd.ms-excel'],
  ])('%s is sent as a pointer to its file, never as flattened text', (filename, mimeType) => {
    const att = asReadWithCode({ id: FILE_ID, filename, mimeType, extractedText: 'A | 100', base64: ZIP_BYTES });
    for (const out of [claudeWire(att), geminiWire(att)]) {
      expect(out).not.toContain('A | 100');
      expect(out).not.toContain(ZIP_BYTES);
      expect(out).toContain('input/');
      expect(out).toContain(FILE_ID);
    }
  });

  it.each([
    ['bank.pdf', 'application/pdf'],
    ['data.csv', 'text/csv'],
    ['photo.png', 'image/png'],
  ])('%s stays in the conversation', (filename, mimeType) => {
    const att: AttachmentBlock = { id: FILE_ID, filename, mimeType, extractedText: 'kept' };
    expect(asReadWithCode(att)).toBe(att);
  });

  it('a file already left out keeps its own reason', () => {
    const att: AttachmentBlock = { ...sheet, omittedReason: 'history_budget' };
    expect(asReadWithCode(att)).toBe(att);
  });

  it('without a sandbox the text stays, because nothing else could read the file', () => {
    const history: Turn[] = [{ role: 'user', text: 'q', attachments: [sheet] }];
    expect(readOfficeFilesWithCode(false, [sheet], history)).toEqual({ current: [sheet], history });
    const withSandbox = readOfficeFilesWithCode(true, [sheet], history);
    expect(withSandbox.current[0]!.omittedReason).toBe('read_with_code');
    expect(withSandbox.history[0]!.attachments![0]!.omittedReason).toBe('read_with_code');
  });
});

describe('a user-controlled name as the model sees it: one spelling, no markup, no new line (ADR-0069)', () => {
  const stored = "R&D John's notes.pdf";

  it('leaves an ordinary name exactly as stored, & and apostrophes included', () => {
    for (const name of [stored, 'plain report.pdf', 'Q3 (final) [v2] ~draft~.xlsx', '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd \u0b85\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0bc8.pdf', 'r\u00e9sum\u00e9 \u00ab2026\u00bb.docx']) {
      expect(nameForModel(name)).toBe(name);
    }
  });

  it('writes <, >, " and | as character references, so a name cannot open a tag, end its quotes or start a field', () => {
    expect(nameForModel('<a>"b"|c')).toBe('&lt;a&gt;&quot;b&quot;&#124;c');
    expect(nameForModel(HOSTILE_NAME)).toBe(HOSTILE_NAME_SHOWN);
  });

  it('turns line breaks and every other control character into a space', () => {
    expect(nameForModel('a\tb\u0000c\u007fd\u0085e\u009ff')).toBe('a b c d e f');
    expect(nameForModel('x\r\ny\u2028z\u2029w')).toBe('x  y z w');
  });

  it.each([
    ['U+061C Arabic letter mark', '\u061c'],
    ['U+200E left-to-right mark', '\u200e'],
    ['U+200F right-to-left mark', '\u200f'],
    ['U+202A-202E embeddings and overrides', '\u202a\u202b\u202c\u202d\u202e'],
    ['U+2066-2069 isolates', '\u2066\u2067\u2068\u2069'],
  ])('drops bidi controls: %s', (_label, chars) => {
    expect(nameForModel(`in${chars}voice.pdf`)).toBe('invoice.pdf');
  });

  it.each([
    ['U+200B-200D zero-width space, non-joiner, joiner', '\u200b\u200c\u200d'],
    ['U+2060 word joiner', '\u2060'],
    ['U+FEFF byte order mark', '\ufeff'],
    ['U+E0000-E007F tag characters', '\u{E0001}\u{E0069}\u{E007F}'],
    ['U+00AD soft hyphen', '\u00ad'],
    ['U+034F combining grapheme joiner', '\u034f'],
    ['U+FE00-FE0F variation selectors', '\ufe00\ufe0f'],
    ['U+E0100-E01EF variation selectors supplement', '\u{E0100}\u{E01EF}'],
    ['Hangul fillers', '\u115f\u1160\u3164\uffa0'],
  ])('drops invisible characters: %s', (_label, chars) => {
    expect(nameForModel(`in${chars}voice.pdf`)).toBe('invoice.pdf');
  });

  it.each([
    ['fullwidth', '\uff1c', '\uff1e'],
    ['small form', '\ufe64', '\ufe65'],
    ['single angle quotation marks', '\u2039', '\u203a'],
    ['angle brackets', '\u2329', '\u232a'],
    ['CJK angle brackets', '\u3008', '\u3009'],
    ['mathematical angle brackets', '\u27e8', '\u27e9'],
    ['ornaments', '\u276c\u276e', '\u276d\u276f'],
    ['modifier arrowheads', '\u02c2', '\u02c3'],
    ['syllabics', '\u1438', '\u1433'],
    ['heavy angle ornaments', '\u2770', '\u2771'],
    ['double angle brackets', '\u27ea\u300a', '\u27eb\u300b'],
    ['curved angle brackets', '\u29fc', '\u29fd'],
  ])('maps bracket lookalikes to &lt; / &gt;: %s', (_label, open, close) => {
    expect(nameForModel(`${open}system${close}.pdf`)).toBe(`${'&lt;'.repeat(open.length)}system${'&gt;'.repeat(close.length)}.pdf`);
  });

  it.each([
    ['fullwidth quote', '\uff02', '&quot;'],
    ['curly quotes', '\u201c\u201d\u201e\u201f', '&quot;&quot;&quot;&quot;'],
    ['double prime and modifier quote', '\u2033\u02ba', '&quot;&quot;'],
    ['fullwidth bar', '\uff5c', '&#124;'],
    ['divides, dental click, box line', '\u2223\u01c0\u2502', '&#124;&#124;&#124;'],
    ['vertical line extension and light bar', '\u23d0\u2758', '&#124;&#124;'],
  ])('maps quote and bar lookalikes so no field can be forged: %s', (_label, chars, shown) => {
    expect(nameForModel(`a${chars}b`)).toBe(`a${shown}b`);
  });

  it('is linear: a 1 MB name of every special character is written in well under a second', () => {
    const chars = '<>"|\n\u202e\u200b\uff1c\u{E0001}a';
    const name = chars.repeat(Math.ceil((1024 * 1024) / chars.length));
    const started = performance.now();
    const shown = nameForModel(name);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(shown).not.toMatch(/[<>"|\n\u202e\u200b\uff1c]/u);
  });

  it('names the file as stored in the page label and the attachment note', () => {
    expect(pageLabel({ filename: stored, mimeType: 'application/pdf', pageCount: 3 }, 2)).toBe(`"${stored}" page 2 of 3`);
    const note = unavailableAttachmentNote({ id: 'f1', filename: stored, mimeType: 'application/pdf', omittedReason: 'storage_unavailable' });
    expect(note).toContain(`"${stored}"`);
  });

  it('the page label and every attachment note show a hostile name neutralised', () => {
    expectHostileNameNeutralised(pageLabel({ filename: HOSTILE_NAME, mimeType: 'application/pdf', pageCount: 3 }, 2));
    for (const omittedReason of ['read_with_code', 'history_budget', 'model_limit', 'unreadable', 'storage_unavailable', undefined] as const) {
      expectHostileNameNeutralised(
        unavailableAttachmentNote({ id: 'f1', filename: HOSTILE_NAME, mimeType: 'application/pdf', ...(omittedReason ? { omittedReason } : {}) }),
      );
    }
  });

  // F10: Gemini read one file as `filename="R&amp;D\u2026"` and as `R&D\u2026` in the attachment list.
  it("Gemini's <document filename> attribute spells the name as the rest of the prompt does", () => {
    const textOf = (filename: string) => String(buildGeminiContents(request({ filename, mimeType: 'text/plain', extractedText: 'BODY' }))[0]!.parts![0]!.text);
    expect(textOf(stored).startsWith(`<document filename="${stored}">\nBODY\n</document>`)).toBe(true);
    const hostile = textOf(HOSTILE_NAME);
    expect(hostile.startsWith(`<document filename="${HOSTILE_NAME_SHOWN}">\nBODY\n</document>`)).toBe(true);
    expectHostileNameNeutralised(hostile);
  });

  it("the Claude adapter's document title is the same spelling", () => {
    const atts: AttachmentBlock[] = [
      { filename: HOSTILE_NAME, mimeType: 'text/plain', extractedText: 'BODY' },
      { filename: HOSTILE_NAME, mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.4').toString('base64') },
    ];
    for (const att of atts) {
      const blocks = buildAnthropicMessages(request(att))[0]!.content as Array<{ type: string; title?: string }>;
      expect(blocks.find((b) => b.type === 'document')!.title).toBe(HOSTILE_NAME_SHOWN);
    }
  });
});
