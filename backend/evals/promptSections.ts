/**
 * Measuring the prompt (tech-p03): sizes by section and by tool declaration, in characters.
 * Characters, because the provider's own token count needs a live call (Invariant 3: no
 * estimator). Used by `src/test/promptBudgets.test.ts`.
 */
import type { ToolDefinition } from '../src/providers/types.js';

/** Top-level `<tag> … </tag>` blocks of a prompt, in order, with their size in characters. */
export function topLevelSections(text: string): Array<{ tag: string; chars: number }> {
  const out: Array<{ tag: string; chars: number }> = [];
  const open = /^<([A-Za-z][A-Za-z_]*)>[ \t]*$/gm;
  let m: RegExpExecArray | null;
  let from = 0;
  while ((m = open.exec(text.slice(from))) !== null) {
    const start = from + m.index;
    const tag = m[1]!;
    const close = text.indexOf(`\n</${tag}>`, start);
    if (close === -1) {
      from = start + m[0].length;
      open.lastIndex = 0;
      continue;
    }
    const end = close + `\n</${tag}>`.length;
    out.push({ tag, chars: end - start });
    from = end;
    open.lastIndex = 0;
  }
  return out;
}

/** The size of a tool declaration as sent: name, description and input schema. */
export function toolChars(tool: ToolDefinition): number {
  return JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }).length;
}
