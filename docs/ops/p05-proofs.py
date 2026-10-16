"""P05 step 0: break each branch a path scenario claims to cover, in a scratch copy, and show it fails.

Usage: copy backend/ to a scratch directory (hardlink node_modules), then
  python3 -I docs/ops/p05-proofs.py <scratch backend dir> [proof id ...]
Each proof replaces one exact text (it must occur once), runs the one scenario against the database
arcnave_test_proof, and restores the file. A control run per scenario (nothing broken) comes first.
Results: proofs.json next to this script, and docs/ops/p05-result.md.
"""
import json
import os
import re
import subprocess
import sys

ROOT = sys.argv[1]
ONLY = set(sys.argv[2:])
GEN = 'src/services/generation.ts'
LOOP = 'src/services/turn/providerLoop.ts'
TEST = 'src/test/turnCharacterizationPaths.integration.test.ts'

PROOFS = [
    ('1', r'\(1\)', GEN, "        status = 'cancelled';\n", "        // status = 'cancelled';\n", "the stop branch does not set status cancelled"),
    ('1-release', r'\(1\)', GEN, "    } finally {\n      await releaseReservation();\n    }", "    } finally {\n    }", "the stream's finally does not release the reservation"),
    ('1-cleanup', r'\(1\)', GEN, "      await this.executionRuntime.cleanupWorkspace(workspace);", "      // cleanup skipped", "the outer finally does not clean the workspace"),
    ('2', r'\(2\)', GEN, "      const deadlineHit = isTurnDeadline(input.signal.reason);", "      const deadlineHit = false;", "the deadline is not recognised"),
    ('3', r'\(3\)', GEN, "        ({ turns: history } = await loadHistory(this.svc, input.chatId, input.messageId, latestCompaction?.throughSeq, entry.alias));\n      }\n    }", "      }\n    }", "the history is not reloaded after a compaction"),
    ('4', r'\(4\)', LOOP, "              history: reducedHistory,\n            };\n            continue;", "              history: reducedHistory,\n            };\n            // continue;", "the overflow retry does not retry"),
    ('5', r'\(5\)', GEN, "            yield {\n              type: 'sources',", "            if (0) yield {\n              type: 'sources',", "the sources event is not yielded"),
    ('6', r'\(6\)', GEN, "          case 'code':\n            yield {", "          case 'code':\n            if (0) yield {", "the code event is not yielded"),
    ('7-draft', r'\(7\)', GEN, "              yield { type: 'ui_draft',", "              if (0) yield { type: 'ui_draft',", "the ui_draft event is not yielded"),
    ('7-drain', r'\(7\)', GEN, "              yield pendingUiEvents.shift()!;", "              pendingUiEvents.shift();", "the pending UI events are not drained"),
    ('8a', r'\(8a\)', GEN, "if (synthErr instanceof ApiError && synthErr.code === 'tool_protocol_in_text') {", "if (false) {", "the forced answer's tool_protocol_in_text branch is skipped"),
    ('8b', r'\(8b\)', GEN, "      } catch (synthErr) {\n", "      } catch (synthErr) {\n        throw synthErr;\n", "the forced answer's failure is not caught"),
    ('8c', r'\(8c\)', GEN, "      if (status !== 'error' && text.trim().length === 0) {", "      if (false) {", "the empty_response branch is skipped"),
    ('9', r'\(9\)', GEN, "        this.registry.recordOutcome(entry.alias, { available: false, detail: err.message });", "        // recordOutcome skipped", "ModelNotFoundError does not mark the model unavailable"),
    ('10', r'\(10\)', GEN, "    await this.usage.reserve(input.userId, prefs, maxOutputTokens);", "    await this.usage.reserve(input.userId, prefs, maxOutputTokens).catch(() => undefined);", "a budget refusal at reserve is swallowed"),
    ('11', r'\(11\)', GEN, "    const { pendingUiEvents, toolMap, codeExecutor, toolExecutor } = buildToolExecutors(this.svc, {\n      input,\n      project,", "    const { pendingUiEvents, toolMap, codeExecutor, toolExecutor } = buildToolExecutors(this.svc, {\n      input,\n      project: null,", "the project is not given to the tool executors"),
    ('12', r'\(12\)', GEN, "        loadedSkills: loadedSkills.map((s) => s.name),", "        loadedSkills: [],", "the skills read are not reported"),
    ('13', r'\(13\)', GEN, "    for (const event of contextEvents) {\n      yield event;", "    for (const event of contextEvents) {\n      if (0) yield event;", "the context events are not yielded"),
    ('13-ordinal', r'\(13\)', GEN, "    let eventOrdinal = contextEvents.length;", "    let eventOrdinal = 0;", "tool calls are numbered from 0, not after the context events"),
    ('14', r'\(14\)', GEN, "    const requestedEffort =\n      input.effort ??", "    const requestedEffort =\n      undefined ??", "the turn's effort is ignored"),
    ('15', r'\(15\)', GEN, "    if (!provider) {\n      throw new ApiError('model_unavailable',", "    if (false) {\n      throw new ApiError('model_unavailable',", "no adapter does not refuse"),
    ('16', r'\(16\)', GEN, "    if (requiresGrounding && !grounded) {", "    if (false) {", "search without grounding is not refused"),
]

env = dict(os.environ, TEST_DATABASE_URL='postgres://arcnave:arcnave@localhost:5432/arcnave_test_proof')
results = []
_first = {}
for p in PROOFS:
    _first.setdefault(p[1], p)
PROOFS = [('control-' + p[0].split('-')[0], p[1], p[2], p[3], p[3], 'nothing broken: the scenario passes') for p in _first.values()] + PROOFS
for pid, pattern, path, old, new, what in PROOFS:
    if ONLY and pid not in ONLY:
        continue
    full = os.path.join(ROOT, path)
    original = open(full).read()
    if original.count(old) != 1:
        results.append({'id': pid, 'what': what, 'result': f'PATCH NOT FOUND ({original.count(old)} matches)'})
        continue
    open(full, 'w').write(original.replace(old, new))
    try:
        proc = subprocess.run(['npx', 'vitest', 'run', TEST, '-t', pattern], cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
    finally:
        open(full, 'w').write(original)
    out = proc.stdout + proc.stderr
    summary = re.search(r'Tests\s+(.*)', out)
    # The first line the broken run changed: a snapshot diff line, or an assertion.
    first = re.search(r'^\s*(?:\x1b\[[0-9;]*m)*([-+] (?!Expected|Received)[^\n]*)', out, re.M) or re.search(r'(AssertionError: [^\n]*)', out)
    results.append({
        'id': pid,
        'what': what,
        'exit': proc.returncode,
        'tests': summary.group(1).strip() if summary else '?',
        'first_failure': first.group(1).strip()[:220] if first else None,
    })
    print(json.dumps(results[-1]), flush=True)

json.dump(results, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'proofs.json'), 'w'), indent=1)
