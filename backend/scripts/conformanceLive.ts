/**
 * Live provider conformance (tech-p03, E15). OWNER/DEV-RUN ONLY: a handful of real calls per
 * provider, so it refuses unless LIVE=1 and asks before spending (or takes --yes). Never in CI.
 *
 *   $env:LIVE="1"; npm run conformance:live -- --yes
 *   $env:LIVE="1"; npm run conformance:live -- --providers gemini --yes
 *
 * The checks and what each proves are in evals/conformance.ts. The adapters are the existing
 * ones; no new SDK call is made here, SDK retries stay off, and there is no retry. The output is
 * a table of pass / fail / skip with a short code: no model text is printed or written.
 */
import { createInterface } from 'node:readline/promises';

import { loadConfig } from '../src/config.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { buildEntries } from '../src/providers/registry.js';
import { formatConformance, runConformance } from '../evals/conformance.js';
import type { CheckRow, ConformanceTarget } from '../evals/conformance.js';
import { liveGuardMessage } from '../evals/prompt-kit/runner.js';

async function main(): Promise<number> {
  const guard = liveGuardMessage(process.env);
  if (guard) {
    console.error(guard.replace('eval:prompt -- --models gemini-flash --runs 1 --cases S1,T3 --yes', 'conformance:live -- --yes'));
    return 2;
  }

  const argv = process.argv.slice(2);
  const yes = argv.includes('--yes');
  const at = argv.indexOf('--providers');
  const wanted = at >= 0 ? (argv[at + 1] ?? '').split(',').map((p) => p.trim()) : ['gemini', 'claude'];
  const unknown = wanted.filter((p) => p !== 'gemini' && p !== 'claude');
  if (unknown.length > 0 || wanted.length === 0) {
    console.error('conformance:live: --providers takes gemini, claude or gemini,claude');
    return 2;
  }

  const cfg = loadConfig(process.env);
  const entries = buildEntries(cfg);
  const targets: ConformanceTarget[] = [];
  const rows: CheckRow[] = [];
  for (const label of wanted) {
    const alias = label === 'gemini' ? 'Gemini 3.8 Flash' : 'Sonnet 5.5';
    const entry = entries.find((e) => e.alias === alias)!;
    const configured = label === 'gemini' ? cfg.vertexConfigured : cfg.anthropicConfigured;
    if (!configured || !entry.providerModelId) {
      rows.push({ provider: label, check: 'configured', status: 'fail', code: label === 'gemini' ? 'vertex_not_configured' : 'anthropic_not_configured', latencyMs: 0 });
      continue;
    }
    targets.push({
      label,
      provider: label === 'gemini' ? new GeminiProvider(cfg) : new AnthropicProvider(cfg),
      providerModelId: entry.providerModelId,
      effort: 'medium',
    });
  }

  console.log(`${String(targets.length)} provider(s), about 6 real requests each (small outputs). Model ids come from configuration; nothing is substituted.`);
  if (targets.length > 0 && !yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const closed = new Promise<string>((resolve) => rl.once('close', () => resolve('')));
    const reply = (await Promise.race([rl.question('This spends provider quota. Type "yes" to continue: '), closed])).trim().toLowerCase();
    rl.close();
    if (reply !== 'yes') {
      console.log('Not confirmed; nothing was run.');
      return 1;
    }
  }

  for (const target of targets) rows.push(...(await runConformance(target)));
  console.log('\n' + formatConformance(rows));
  const failed = rows.filter((r) => r.status === 'fail').length;
  console.log(`\n${String(rows.filter((r) => r.status === 'pass').length)} pass, ${String(failed)} fail, ${String(rows.filter((r) => r.status === 'skip').length)} skip`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`conformance:live failed: ${err instanceof Error ? err.name : 'error'}`);
    process.exit(1);
  },
);
