/**
 * P21 exit test (S21-10, D3 A-17, ADR-0082): a number with an id in the numbers register lives in
 * `config/numbers.ts`, beside its id, and everything else reads it from `NUMBERS` or `cfg`.
 *
 * (a) the literals the numbers sweep found (`docs/ops/audit/numbers-diff.md` §3) stay gone, and a
 *     config key that has a NUMBERS entry of the same name reads it;
 * (b) no NUMBERS value of 1,000 or more appears as a literal in the shipped tree (underscores
 *     normalised, `a * b * c` products evaluated), except the allowlist below, each with its reason;
 * (c) a code line carrying an `N-nn` comment reads NUMBERS or cfg on that line;
 * (d) each detector catches a planted literal, so a green run means something.
 */
import { describe, expect, it } from 'vitest';

import { NUMBERS } from '../config/numbers.js';
import { codeOf, isCommentLine, shippedSources, type SourceFile } from './sourceWalk.js';

/* ------------------------------------------------------------------ (a) known literals */

interface KnownRow {
  nId: string;
  file: string;
  pattern: RegExp;
}

/** Each row is a literal P21 (or an earlier package) moved into numbers.ts; it must not come back. */
export const KNOWN: KnownRow[] = [
  { nId: 'N-02', file: 'routes/chats.ts', pattern: /prompt: z\.string\(\)\.min\(1\)\.max\(\d/ },
  { nId: 'N-73', file: 'routes/chats.ts', pattern: /title: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(\d|\.slice\(0, 200\)/ },
  { nId: 'N-10', file: 'routes/chats.ts', pattern: /attachmentIds: z\.array\([^)]*\)\)\.max\(\d/ },
  { nId: 'N-24', file: 'routes/chats.ts', pattern: /\b15_?000\b/ },
  { nId: 'N-07', file: 'providers/anthropic.ts', pattern: /max_uses:\s*\d/ },
  { nId: 'N-10', file: 'app.ts', pattern: /files:\s*\d/ },
  { nId: 'N-14', file: 'services/retrieval.ts', pattern: /CHUNK_(TARGET|OVERLAP)_CHARS = \d/ },
  { nId: 'N-35', file: 'routes/preferences.ts', pattern: /instructions: z\.string\(\)\.max\(\d/ },
  { nId: 'N-35', file: 'routes/projects.ts', pattern: /instructions: z\.string\(\)\.max\(\d/ },
  { nId: 'N-39', file: 'routes/artifacts.ts', pattern: /MAX_CONTENT_CHARS = \d/ },
  { nId: 'N-73', file: 'services/runHub.ts', pattern: /MAX_BUFFERED_EVENTS = \d/ },
  { nId: 'N-24', file: 'services/runHub.ts', pattern: /FINISHED_RETENTION_MS = \d/ },
  { nId: 'N-41', file: 'services/documents/sheetPreview.ts', pattern: /PREVIEW_MAX_(ROWS|COLUMNS) = \d/ },
  { nId: 'N-41', file: 'routes/sheetPreview.ts', pattern: /PREVIEW_MAX_BYTES = \d/ },
  { nId: 'N-73', file: 'routes/helpers.ts', pattern: /\.max\(\d+\)\.default\(\d+\)/ },
  { nId: 'N-17', file: 'services/memory/memoryService.ts', pattern: /MEMORY_(LIST_LIMIT|FILE_MAX_BYTES) = \d/ },
  { nId: 'N-17', file: 'services/memory/memoryTransfer.ts', pattern: /MAX_IMPORT_ITEMS = \d/ },
  { nId: 'N-17', file: 'routes/memory.ts', pattern: /content: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(\d/ },
  { nId: 'N-08', file: 'tools/sandbox/warmSandboxClient.ts', pattern: /CHUNK_BYTES = \d/ },
  { nId: 'N-68', file: 'tools/sandbox/warmSandboxClient.ts', pattern: /TRANSFER_FLOOR_MS = \d/ },
  { nId: 'N-09', file: 'services/webFetch.ts', pattern: /maxChars: number = \d/ },
  { nId: 'N-13', file: 'services/attachments/pipeline.ts', pattern: /pdfVisualMaxPages: \d/ },
  { nId: 'N-10', file: 'services/attachments/pipeline.ts', pattern: /imageMaxDimension: \d/ },
  { nId: 'N-16', file: 'services/compaction/autoCompact.ts', pattern: /MIN_TRIGGER = \d/ },
  { nId: 'N-16', file: 'services/compaction/compactionService.ts', pattern: /\?\? (8192|0\.15)/ },
  { nId: 'N-13', file: 'services/turn/contextAttachments.ts', pattern: /\?\? 12_?000_?000/ },
  { nId: 'N-74', file: 'db/schema.ts', pattern: /max_output_tokens'\)\.notNull\(\)\.default\(\d/ },
  { nId: 'N-77', file: 'db/schema.ts', pattern: /<= 6000/ },
];

export function knownHits(files: SourceFile[], rows = KNOWN): string[] {
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const hits: string[] = [];
  for (const row of rows) {
    const file = byRel.get(row.file);
    if (!file) {
      hits.push(`${row.nId} ${row.file}: file not found (move the row with the code)`);
      continue;
    }
    file.text.split('\n').forEach((line, i) => {
      if (!isCommentLine(line) && row.pattern.test(line)) hits.push(`${row.nId} ${row.file}:${String(i + 1)}: ${line.trim()}`);
    });
  }
  return hits;
}

/** A config key named like a NUMBERS entry takes its default from that entry. */
export function configKeyHits(configText: string): string[] {
  const hits: string[] = [];
  for (const key of Object.keys(NUMBERS)) {
    const m = new RegExp(`^\\s*${key}: (.*)$`, 'm').exec(configText);
    if (m && !m[1]!.includes(`NUMBERS.${key}.value`)) hits.push(`config.ts ${key}: ${m[1]!.trim()}`);
  }
  return hits;
}

/* ------------------------------------------------------------------ (b) values */

/**
 * Values that many unrelated quantities share: unit conversions and round limits. A NUMBERS entry
 * with one of these values is pinned by rule (a) and the config-key rule instead.
 */
const COMMON_VALUES: Record<number, string> = {
  1_000: 'milliseconds per second; also round caps (poll intervals, sweep batch, UI string limits)',
  1_024: 'bytes per KiB; also password / filename length caps',
  2_000: 'round caps (chunks per file, chart points, UI strings, image edge px)',
  5_000: 'round timers (grounding redirect, poll hold)',
  10_000: 'round caps (style sample, zip entries, transfer rate, error output) and timers',
  20_000: 'round caps (skill re-injection, UI text)',
  30_000: 'round timers (file-ingest count, warm sandbox list / checkpoint requests)',
  60_000: 'milliseconds per minute; also tool-process timers (pdfinfo, ffprobe)',
};

/** Sites whose literal equals a NUMBERS value by coincidence. */
const SITE_ALLOWLIST: Array<{ file: string; value: number; reason: string }> = [
  { file: 'config.ts', value: 100_000, reason: 'UI_MAX_RESPONSE_BYTES, a generative-UI payload cap (ours), not the prompt size' },
  { file: 'services/ui/validator.ts', value: 100_000, reason: 'the same UI payload cap as the validator default' },
  { file: 'config/priceBook.ts', value: 100_000, reason: 'Haiku 5.5 long-prompt price tier boundary (tokens), a price-book fact' },
  { file: 'config.ts', value: 300_000, reason: 'EXTRACTION_TIMEOUT_MS, the isolated parser deadline (ours)' },
  { file: 'services/attachments/pdfPages.ts', value: 300_000, reason: 'pdftoppm render timeout for one page batch' },
  { file: 'config.ts', value: 100 * 1024 * 1024, reason: 'FILE_LARGE_JOB_BYTES, the large-file lane threshold (ours)' },
  { file: 'routes/memory.ts', value: 200_000, reason: 'memory import as text, characters (ours), not project context' },
  { file: 'services/ui/validator.ts', value: 200_000, reason: 'VISUAL_MAX_HTML_BYTES, a visual block cap (ours)' },
  { file: 'services/attachments/isolatedExtract.ts', value: 16_384, reason: 'stderr bytes kept from a parser child' },
  { file: 'services/attachments/zipExpand.ts', value: 16_384, reason: 'ZIP member read chunk' },
  { file: 'services/documents/verify/pptxVerify.ts', value: 1_400, reason: 'OOXML font size floor (hundredths of a point)' },
  { file: 'tools/sandbox/cloudRunSandboxClient.ts', value: 1_800, reason: 'signed URL lifetime, seconds' },
  { file: 'tools/sandbox/processSandboxClient.ts', value: 15_000, reason: 'local development sandbox default code timeout' },
  { file: 'services/attachments/fileJobs.ts', value: 6_000, reason: 'test-only idle() loop bound' },
];

/** A decimal literal, or a product of them (`16 * 1024 * 1024`). */
const LITERAL = /(?<![\w.$])\d[\d_]*(?:\s*\*\s*\d[\d_]*)*(?![\w.])/g;

export function valueHits(files: SourceFile[]): string[] {
  const values = new Map<number, string[]>();
  for (const [key, entry] of Object.entries(NUMBERS)) {
    if (entry.value >= 1_000) values.set(entry.value, [...(values.get(entry.value) ?? []), key]);
  }
  const hits: string[] = [];
  for (const file of files) {
    if (file.rel === 'config/numbers.ts') continue;
    file.text.split('\n').forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const m of codeOf(line).matchAll(LITERAL)) {
        const value = m[0].split('*').reduce((acc, part) => acc * Number(part.trim().replace(/_/g, '')), 1);
        if (!values.has(value) || value in COMMON_VALUES) continue;
        if (SITE_ALLOWLIST.some((a) => a.file === file.rel && a.value === value)) continue;
        hits.push(`${file.rel}:${String(i + 1)} ${String(value)} (= ${values.get(value)!.join(', ')}): ${line.trim()}`);
      }
    });
  }
  return hits;
}

/* ------------------------------------------------------------------ (c) N-id comments */

/** Code lines whose comment names an N-id but whose value is not a number from the register. */
const NID_COMMENT_ALLOWLIST: Array<{ file: string; pattern: RegExp; reason: string }> = [
  { file: 'services/routing/routerShadow.ts', pattern: /reasoningEffort: 'low'/, reason: 'N-69 sets thinking off; the effort is a word, not a number' },
];

export function nIdCommentHits(files: SourceFile[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    if (file.rel === 'config/numbers.ts') continue;
    file.text.split('\n').forEach((line, i) => {
      if (isCommentLine(line)) return;
      const withoutStrings = line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
      if (!/\bN-\d\d\b/.test(withoutStrings)) return;
      if (/\bNUMBERS\.|\bcfg\.|\bconfig\(\)\./.test(withoutStrings)) return;
      if (NID_COMMENT_ALLOWLIST.some((a) => a.file === file.rel && a.pattern.test(line))) return;
      hits.push(`${file.rel}:${String(i + 1)}: ${line.trim()}`);
    });
  }
  return hits;
}

/* ------------------------------------------------------------------ tests */

describe('numbers guard (P21)', () => {
  const files = shippedSources();

  it('reads the whole shipped tree, storage.ts included', () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files.some((f) => f.rel === 'services/storage.ts')).toBe(true);
    expect(files.some((f) => f.rel.endsWith('.test.ts') || f.rel.startsWith('test/'))).toBe(false);
  });

  it('(a) the literals the sweep found stay in numbers.ts', () => {
    expect(knownHits(files)).toEqual([]);
    expect(configKeyHits(files.find((f) => f.rel === 'config.ts')!.text)).toEqual([]);
  });

  it('(b) no registered value of 1,000 or more is written as a literal outside numbers.ts', () => {
    expect(valueHits(files)).toEqual([]);
  });

  it('(b) every allowlisted site still exists (an entry nothing matches is removed)', () => {
    for (const entry of SITE_ALLOWLIST) {
      const file = files.find((f) => f.rel === entry.file);
      expect(file, entry.file).toBeDefined();
      const found = file!.text.split('\n').some((line) =>
        [...codeOf(line).matchAll(LITERAL)].some(
          (m) => m[0].split('*').reduce((acc, p) => acc * Number(p.trim().replace(/_/g, '')), 1) === entry.value,
        ),
      );
      expect(found, `${entry.file} ${String(entry.value)}`).toBe(true);
    }
  });

  it('(c) a code line with an N-id comment reads NUMBERS or cfg', () => {
    expect(nIdCommentHits(files)).toEqual([]);
  });

  it('(d) each detector catches a planted literal', () => {
    const planted: SourceFile[] = [
      { rel: 'routes/chats.ts', text: "        prompt: z.string().min(1).max(100_000),\n" },
      { rel: 'services/planted.ts', text: 'const DEADLINE = 3_540_000;\nconst BYTES = 30 * 1024 * 1024;\n// const ignored = 3_540_000;\n' },
      { rel: 'services/other.ts', text: "  const uses = 5; // N-07 per turn\n  const ok = NUMBERS.WEB_SEARCH_MAX_USES.value; // N-07\n" },
    ];
    expect(knownHits(planted, KNOWN.filter((r) => r.file === 'routes/chats.ts' && r.nId === 'N-02'))).toHaveLength(1);
    const values = valueHits(planted);
    expect(values).toHaveLength(3);
    expect(values[0]).toContain('PROMPT_MAX_CHARS');
    expect(values[1]).toContain('TURN_DEADLINE_MS');
    expect(values[2]).toContain('MAX_UPLOAD_BYTES');
    expect(nIdCommentHits(planted)).toEqual(['services/other.ts:1: const uses = 5; // N-07 per turn']);
    expect(configKeyHits('  TOOL_MAX_ROUNDS: int(16),\n  DB_POOL_MAX: int(NUMBERS.DB_POOL_MAX.value),\n')).toEqual([
      'config.ts TOOL_MAX_ROUNDS: int(16),',
    ]);
  });
});
