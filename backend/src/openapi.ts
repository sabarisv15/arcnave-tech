/**
 * Emit the OpenAPI document.
 *
 * Referenced by `npm run openapi`. The point is that the contract is *generated* from the same
 * Zod schemas that validate requests at runtime, so it cannot drift from the server the way a
 * hand-maintained spec does. The frontend generates its types from this file.
 *
 * It also doubles as a database-free smoke test: building the app registers every route and
 * compiles every schema, so a duplicate path, a broken response schema, or a plugin registered
 * in the wrong scope fails here rather than at the first request.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const OUTPUT = resolve(process.cwd(), '../docs/openapi.json');

async function main(): Promise<void> {
  // Never read process.env here: generating a contract must not depend on which credentials
  // happen to be present, or the document would differ between machines.
  const cfg = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const app = await createApp(cfg);
  await app.ready();

  const document = app.swagger();
  const paths = Object.keys(document.paths ?? {}).sort();

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(document, null, 2) + '\n', 'utf8');

  // Closing tears down the database pool, which is otherwise the only thing holding the
  // process open — no explicit process.exit, which would truncate the file write on Windows.
  await app.close();

  process.stdout.write(`${paths.length} paths written to ${OUTPUT}\n`);
  for (const path of paths) {
    const methods = Object.keys(document.paths?.[path] ?? {})
      .map((m) => m.toUpperCase())
      .join(' ');
    process.stdout.write(`  ${methods.padEnd(22)} ${path}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exitCode = 1;
});
