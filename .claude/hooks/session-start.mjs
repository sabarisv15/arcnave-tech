#!/usr/bin/env node
/**
 * SessionStart hook: put the learning log in front of the model.
 *
 * This is the piece that turns `mistakes.md` from documentation into memory. A file nothing
 * loads is a file nobody reads — that was recorded as the file's own opening caveat until this
 * hook existed.
 *
 * Only the entry headings are injected, not the whole file. Full text would grow without
 * bound and crowd out the task; the headings are enough to recognise a situation, and the
 * model can open the file when one of them is relevant.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function read(relativePath) {
  try {
    return readFileSync(resolve(ROOT, relativePath), 'utf8');
  } catch {
    return null;
  }
}

const mistakes = read('mistakes.md');
const lines = [];

if (mistakes) {
  // `### <date> — <lesson>` is the entry format documented in the file itself.
  const headings = [...mistakes.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());

  if (headings.length > 0) {
    lines.push(
      `This project keeps a learning log at mistakes.md — ${headings.length} entries, ` +
        'each one a mistake already made here. Read the file before writing code, and add ' +
        'to it before you finish.',
      '',
      'Entries:',
      ...headings.map((h) => `  - ${h}`),
    );
  }

  // Anything still open is worth surfacing louder than a heading.
  const open = [...mistakes.matchAll(/^- \*\*Status:\*\* ⚠️ (.+)$/gm)].map((m) => m[1].trim());
  if (open.length > 0) {
    lines.push('', 'Still open:', ...open.map((o) => `  - ${o}`));
  }
} else {
  lines.push('mistakes.md is missing. It is the project learning log and should exist.');
}

// A checkpoint that is weeks stale is worse than none, so say how old it is rather than
// implying it is current.
const checkpoint = read('docs/checkpoints/CURRENT.md');
if (checkpoint) {
  const updated = /\*\*Last updated:\*\* (\d{4}-\d{2}-\d{2})/.exec(checkpoint)?.[1];
  const status = /\*\*Status:\*\* (.+)/.exec(checkpoint)?.[1];
  if (updated && status) {
    const days = Math.floor((Date.now() - Date.parse(updated)) / 86_400_000);
    lines.push(
      '',
      `Checkpoint (docs/checkpoints/CURRENT.md, updated ${updated}, ${days} day(s) ago): ` +
        status.trim(),
    );
  }
}

// additionalContext is injected into the session; anything on stdout that is not this JSON
// would just be noise in the transcript.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lines.join('\n'),
    },
  }),
);
