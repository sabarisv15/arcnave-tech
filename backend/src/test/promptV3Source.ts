/**
 * The docs mirror of the Stage 6 renderings, and the runtime text it must produce. Test-only: the
 * drift test and the snapshot of what the base files must hold read the stage docs from here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { applyToolNameMap } from '../services/prompt/toolNameMap.js';
import type { PromptProvider } from '../services/prompt/v3Prompt.js';

export const STAGE6_DIR = path.resolve(__dirname, '../../../docs/architecture/Stage-06-Context-Prompt-Assembly');

export const RENDERING_DOC: Record<PromptProvider, string> = {
  anthropic: path.join(STAGE6_DIR, '06-system-prompt-v3-claude.md'),
  google: path.join(STAGE6_DIR, '06-system-prompt-v3-gemini.md'),
};

/** The one ```xml code block of a rendering doc, exactly as written ("Runtime text = the code block only"). */
export function renderingCodeBlock(provider: PromptProvider): string {
  const doc = readFileSync(RENDERING_DOC[provider], 'utf8');
  const blocks = [...doc.matchAll(/^```xml\n([\s\S]*?)\n```$/gm)];
  if (blocks.length !== 1) throw new Error(`${RENDERING_DOC[provider]}: expected one xml code block, found ${String(blocks.length)}`);
  return blocks[0]![1]!;
}

/** What the runtime base file must hold: the code block with the tool-name map applied, plus a final newline. */
export function expectedRuntimeFile(provider: PromptProvider): string {
  return applyToolNameMap(renderingCodeBlock(provider)) + '\n';
}
