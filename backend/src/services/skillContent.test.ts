/**
 * The skills describe the ArcNave that exists. Claude's guidance: a Skill's description says
 * what it does and when to use it, and its instructions are tested against real usage. Here the
 * checkable part is checked: every tool a skill tells the model to call exists, every library it
 * names is in the sandbox image, and wording from before the warm sandbox (2026-09-25 audit:
 * "no files persist", `inspectPdf(inputBuffer)`, "ArcNave does NOT use Pandoc") cannot return.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { routeTurn } from './routing/turnRouter.js';
import { SkillService } from './skills.js';

const ROOT = path.resolve(__dirname, '../..');
const TOOLS = new Set(routeTurn({ hasProject: true, codeEnabled: true, webEnabled: true, memoryEnabled: true, generativeUiEnabled: true }).allowedTools);
const CAPABILITIES = new Set(
  [...readFileSync(path.join(ROOT, 'src/capabilities/factory.ts'), 'utf8').matchAll(/id: '([a-z.]+)'/g)].map((m) => m[1]!),
);
const IMAGE = readFileSync(path.join(ROOT, 'sandbox/Dockerfile.service'), 'utf8');

/** A library a skill may name, and what the sandbox image must contain for it to be there. */
const LIBRARIES: Record<string, string> = {
  'python-docx': 'python-docx',
  'python-pptx': 'python-pptx',
  openpyxl: 'openpyxl',
  xlsxwriter: 'xlsxwriter',
  xlrd: 'xlrd',
  pdfplumber: 'pdfplumber',
  pypdf: 'pypdf',
  pymupdf: 'pymupdf',
  pytesseract: 'pytesseract',
  // Not in the image: a skill that names them fails here until the image has them.
  reportlab: 'reportlab',
  qpdf: 'qpdf',
  pandas: 'pandas',
  matplotlib: 'matplotlib',
  pandoc: 'pandoc',
  LibreOffice: 'libreoffice',
  soffice: 'libreoffice',
  pdftoppm: 'poppler-utils',
  tesseract: 'tesseract-ocr',
};

/** Wording that described an ArcNave that no longer exists. */
const STALE = [
  'inputBuffer',
  'No state or files persist',
  'does NOT use `Pandoc`',
  'does NOT use `pdftoppm`',
  'datasetHandle',
  'data URI',
  'materializeInputFiles',
  // Tools the computer replaced (ADR-0047).
  'run_python',
  'load_skill',
  'read_skill',
  // Tools replaced by files, ask_user_input_v0 and show_widget (ADR-0048).
  'render_ui',
  'create_artifact',
  'update_artifact',
  'ask_user_options',
];

const skills = readdirSync(path.join(ROOT, 'skills'))
  .map((dir) => ({ dir, file: path.join(ROOT, 'skills', dir, 'SKILL.md') }))
  .filter(({ file }) => {
    try {
      readFileSync(file);
      return true;
    } catch {
      return false;
    }
  })
  .map(({ dir, file }) => ({ dir, text: readFileSync(file, 'utf8') }));

describe('skill content matches the code', () => {
  let service: SkillService;
  beforeAll(async () => {
    service = new SkillService(ROOT, 'skills');
    await service.load();
  });

  it('reads every bundled skill', () => {
    expect(skills.length).toBeGreaterThanOrEqual(7);
  });

  it.each(skills)('$dir: requires only tools and capabilities that exist', ({ dir }) => {
    const raw = service.getSkill(dir);
    expect(raw).not.toBeNull();
    const text = skills.find((s) => s.dir === dir)!.text;
    const front = text.replace(/\r\n/g, '\n').split('\n---\n')[0]!;
    const tools = [...front.matchAll(/^ {4}- ([a-z_A-Z]+)$/gm)].map((m) => m[1]!);
    for (const t of tools) {
      if (t.includes('.')) continue;
      expect(TOOLS.has(t) || CAPABILITIES.has(t), `${dir} requires unknown "${t}"`).toBe(true);
    }
    const caps = [...front.matchAll(/^ {4}- ([a-z]+\.[a-z.]+)$/gm)].map((m) => m[1]!);
    for (const c of caps) expect(CAPABILITIES.has(c), `${dir} requires unknown capability "${c}"`).toBe(true);
  });

  it.each(skills)('$dir: every tool it tells the model to call exists', ({ dir, text }) => {
    const body = dir === 'skill-creator' ? text.replace(/```[\s\S]*?```/g, '') : text;
    const named = [
      ...body.matchAll(/the `([A-Za-z_]+)` tool/g),
      ...body.matchAll(/[Cc]all `([A-Za-z_]+)`/g),
    ].map((m) => m[1]!);
    for (const name of named) expect(TOOLS.has(name), `${dir} names tool "${name}"`).toBe(true);
  });

  it.each(skills)('$dir: every sandbox library it names is in the image', ({ dir, text }) => {
    for (const [lib, token] of Object.entries(LIBRARIES)) {
      if (new RegExp(`\\b${lib}\\b`).test(text)) expect(IMAGE, `${dir} names ${lib}`).toContain(token);
    }
  });

  it.each(skills)('$dir: none of the retired wording', ({ text }) => {
    for (const phrase of STALE) expect(text).not.toContain(phrase);
  });

  it.each(skills)('$dir: names no other assistant as what ArcNave is or follows (ADR-0044)', ({ text }) => {
    expect(text).not.toMatch(/\b(claude|opus|sonnet|anthropic|fable)\b/i);
  });

  it.each(skills)('$dir: description says when to use it', ({ dir }) => {
    const description = service.getSkill(dir)?.description ?? '';
    expect(description).toMatch(/\bUse (when|whenever|for)\b|Applied automatically/);
  });
});
