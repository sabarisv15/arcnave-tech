/**
 * The v3 runtime prompt files against the Stage 6 docs mirror (ADR-0075), the tool-name map, the
 * appendix, and the packaging that puts the files next to the compiled code.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import * as definitions from '../../tools/definitions.js';
import * as displayDefinitions from '../../tools/displayDefinitions.js';
import { appendixSectionIds } from '../promptCache/promptAssembly.js';
import { expectedRuntimeFile, renderingCodeBlock } from '../../test/promptV3Source.js';
import { buildScenario } from '../../test/promptKit/scenarios.js';
import { STAGE_TOOLS, TOOL_NAME_MAP, applyToolNameMap, wholeToken } from './toolNameMap.js';
import { APPENDIX_FILE, PROMPTS_V3_DIR, appendixFileText, appendixSections, promptVersion, v3BaseText, type PromptProvider } from './v3Prompt.js';

const BACKEND = path.resolve(__dirname, '../../..');
const PROVIDERS: PromptProvider[] = ['google', 'anthropic'];
const FILE: Record<PromptProvider, string> = { google: 'gemini.md', anthropic: 'claude.md' };

/** Every tool name ArcNave can declare. */
const DECLARABLE = new Set(
  ([...Object.values(definitions), ...Object.values(displayDefinitions), definitions.codeToolDefinitions(true), definitions.codeToolDefinitions(false)] as unknown[])
    .flatMap((v) => (Array.isArray(v) ? (v as unknown[]) : [v]))
    .filter((v): v is { name: string } => Boolean(v && typeof v === 'object' && 'name' in v && 'inputSchema' in v))
    .map((d) => d.name),
);

describe('v3 runtime files: drift from the Stage 6 docs mirror', () => {
  for (const provider of PROVIDERS) {
    it(`${FILE[provider]} is the rendering's code block with the tool-name map applied, byte for byte`, () => {
      const runtime = readFileSync(path.join(PROMPTS_V3_DIR, FILE[provider]), 'utf8');
      // Compared as text and as bytes: a changed byte anywhere (a space, a dash) fails here.
      expect(runtime).toBe(expectedRuntimeFile(provider));
      expect(Buffer.from(runtime, 'utf8').equals(Buffer.from(expectedRuntimeFile(provider), 'utf8'))).toBe(true);
    });
  }

  it('the base text sent is the file without its final newline', () => {
    for (const provider of PROVIDERS) expect(`${v3BaseText(provider)}\n`).toBe(expectedRuntimeFile(provider));
  });

  it('carries no language paragraph (Stage 6 CXD-1)', () => {
    for (const provider of PROVIDERS) {
      expect(v3BaseText(provider)).not.toMatch(/Tanglish|Hinglish|Tamil|reply language|language and script/i);
    }
  });
});

describe('the tool-name map', () => {
  it('covers every Stage 8 tool, each with a target or none, a flag and a reason', () => {
    expect(Object.keys(STAGE_TOOLS).sort()).toEqual(
      ['create_artifact', 'fetch_url', 'file_search', 'get_operation_status', 'load_skill', 'memory_delete', 'memory_read', 'memory_write', 'read_file', 'run_code', 'update_artifact', 'web_search'].sort(),
    );
    for (const [name, t] of Object.entries(STAGE_TOOLS)) expect(t.why.length, name).toBeGreaterThan(5);
  });

  it('every map key occurs in a rendering, and every target is a tool ArcNave declares', () => {
    for (const [from, to] of Object.entries(TOOL_NAME_MAP)) {
      const occurs = PROVIDERS.some((p) => wholeToken(from).test(renderingCodeBlock(p)));
      expect(occurs, `${from} occurs in a v3 rendering`).toBe(true);
      expect(DECLARABLE.has(to), `${to} is a declared tool name`).toBe(true);
      expect(STAGE_TOOLS[from]?.target, `${from} agrees with STAGE_TOOLS`).toBe(to);
    }
    for (const t of Object.values(STAGE_TOOLS)) if (t.target) expect(DECLARABLE.has(t.target), t.target).toBe(true);
  });

  it('leaves no mapped stage name in the runtime files', () => {
    for (const provider of PROVIDERS) {
      const text = v3BaseText(provider);
      for (const from of Object.keys(TOOL_NAME_MAP)) expect(text, `${provider}: ${from}`).not.toMatch(wholeToken(from));
    }
  });

  it('replaces whole tokens only', () => {
    const map = { file_search: 'search_project_files' };
    expect(applyToolNameMap('use file_search now', map)).toBe('use search_project_files now');
    expect(applyToolNameMap('file_search_x my_file_search file_searches xfile_search', map)).toBe('file_search_x my_file_search file_searches xfile_search');
    expect(applyToolNameMap('<file_search> (file_search).', map)).toBe('<search_project_files> (search_project_files).');
  });

  it('the stage names with no equivalent stay as written and their flag exists', () => {
    for (const [name, t] of Object.entries(STAGE_TOOLS)) {
      if (t.target !== null) continue;
      expect(Object.keys(TOOL_NAME_MAP)).not.toContain(name);
    }
    // load_skill is named and left as written; skill_loader says it is off.
    expect(v3BaseText('google')).toMatch(wholeToken('load_skill'));
    expect(STAGE_TOOLS.load_skill?.flag).toBe('skill_loader');
  });
});

describe('the product-tools appendix (transitional, ours)', () => {
  const sections = appendixSections();
  const every = new Set(['ask_user_input_v0', 'bash_tool', 'view', 'create_file', 'str_replace', 'present_files', 'search_project_files', 'show_widget', 'memory_str_replace', 'conversation_search']);

  it('every section the assembler can choose is in the file, and every section in the file can be chosen', () => {
    const chosen = new Set([
      ...appendixSectionIds(every, { persistentSandbox: true, skills: [{ name: 'x', version: '1', description: 'x', path: '/x' }] }),
      ...appendixSectionIds(every, { persistentSandbox: false }),
    ]);
    expect([...chosen].sort()).toEqual([...sections.keys()].sort());
  });

  it('in every real configuration, each tool an appendix section names is declared on that turn', () => {
    // Every combination of the deployment and user switches, built as the turn builds it.
    const keys = ['python', 'skills', 'web', 'liveSearchProvider', 'memory', 'generativeUi', 'project'] as const;
    for (let mask = 0; mask < 1 << keys.length; mask += 1) {
      const options = Object.fromEntries(keys.map((k, i) => [k, Boolean(mask & (1 << i))]));
      const s = buildScenario(options);
      const declared = new Set(s.toolNames);
      for (const id of appendixSectionIds(declared, { skills: s.options.skills && declared.has('view') ? [{ name: 'x', version: '1', description: 'x', path: '/x' }] : [] })) {
        const named = [...DECLARABLE].filter((n) => wholeToken(n).test(sections.get(id)!));
        expect(named.filter((n) => !declared.has(n)), `${JSON.stringify(options)} ${id}`).toEqual([]);
      }
    }
  });

  it('stays inside its own size budget (chars; today + 5 %, removed by Prompt 6)', () => {
    // Measured 2026-10-16 (P07, after review round 2): 16,590 characters with the section markers.
    expect(appendixFileText().length).toBeLessThanOrEqual(Math.ceil(16_590 * 1.05));
  });

  it('carries none of the conflicting legacy text v3 replaced', () => {
    const text = appendixFileText();
    expect(text).not.toContain('cdnjs.cloudflare.com');
    expect(text).not.toContain('The reply is the default.');
    expect(text).not.toContain('every skill that plausibly applies');
    expect(text).not.toContain('these tools are that access');
    // v3 critical rule 7 / ST-7: never assume facts; the legacy clause that said to was cut.
    expect(text).not.toContain('make reasonable assumptions');
  });
});

describe('packaging: the prompt files resolve from tsx and from the compiled output', () => {
  it('resolves to backend/prompts/system/v3 from src (tsx)', () => {
    expect(PROMPTS_V3_DIR).toBe(path.join(BACKEND, 'prompts', 'system', 'v3'));
    for (const f of ['gemini.md', 'claude.md', APPENDIX_FILE]) expect(readFileSync(path.join(PROMPTS_V3_DIR, f), 'utf8').length).toBeGreaterThan(1000);
  });

  it('resolves to the same folder from a compiled module at dist depth', async () => {
    // The module compiled as tsc would, placed where dist puts it (backend/<out>/services/prompt).
    const out = path.join(BACKEND, '.dist-check');
    const dir = path.join(out, 'services', 'prompt');
    mkdirSync(dir, { recursive: true });
    try {
      const source = readFileSync(path.join(__dirname, 'v3Prompt.ts'), 'utf8');
      const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      writeFileSync(path.join(dir, 'v3Prompt.js'), js);
      const compiled = (await import(pathToFileURL(path.join(dir, 'v3Prompt.js')).href)) as typeof import('./v3Prompt.js');
      expect(compiled.PROMPTS_V3_DIR).toBe(PROMPTS_V3_DIR);
      expect(compiled.v3BaseText('google')).toBe(v3BaseText('google'));
      expect(compiled.promptVersion('anthropic')).toBe(promptVersion('anthropic'));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('the image copies the prompts folder next to dist', () => {
    const dockerfile = readFileSync(path.join(BACKEND, 'Dockerfile'), 'utf8');
    const runtime = dockerfile.slice(dockerfile.indexOf('FROM node:22-bookworm-slim AS runtime'));
    expect(runtime).toMatch(/^COPY prompts \.\/prompts$/m);
    expect(runtime).toMatch(/^COPY --from=build \/app\/dist \.\/dist$/m);
  });
});

describe('the prompt version', () => {
  it('is 12 hex, one per rendering, stable across calls', () => {
    for (const provider of PROVIDERS) {
      expect(promptVersion(provider)).toMatch(/^[0-9a-f]{12}$/);
      expect(promptVersion(provider)).toBe(promptVersion(provider));
    }
    expect(promptVersion('google')).not.toBe(promptVersion('anthropic'));
  });
});
