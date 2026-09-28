"""Builds docs/audits/2026-09-28-fable-5.1-prompt-line-by-line.md from the units (split.py)
and the three verdict files. The verdicts are judgements, one per unit, written by reading
both texts; this script only counts and lays them out.

Run after split.py: python3 tools/prompt-compare/build_report.py
"""
import collections
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = HERE / 'work'
OUT = ROOT / 'docs' / 'audits' / '2026-09-28-fable-5.1-prompt-line-by-line.md'

FABLE_SECTIONS = [
    (1, 'claude_behavior (product, refusals, tone, formatting, wellbeing, evenhandedness, mistakes, cutoff)'),
    (223, 'memory_filesystem'), (1205, 'end_conversation'), (1233, 'persistent_storage_for_artifacts'),
    (1308, 'mcp_app_suggestions'), (1358, 'plugin and skill catalog'), (1378, 'past_chats_tools'),
    (1410, 'preferences_info'), (1498, 'computer_use (skills, files, artifacts)'),
    (1659, 'publishing_artifacts'), (1707, 'request_evaluation_checklist + Visualizer'),
    (1789, 'search_instructions + copyright + image search'),
]
VERDICTS = {
    'S': 'Same (verbatim)', 'R': 'Reworded, same meaning', 'P': 'Partly present',
    'M': 'Missing (ArcNave has the feature, not the rule)', 'X': 'Conflicts (ArcNave says otherwise)',
    'D': 'Differs by design (recorded or sandbox)', 'N': 'Not applicable (feature ArcNave lacks, or Claude-only)',
}


def cell(text, n=None):
    text = ' '.join(text.split())
    if n and len(text) > n:
        text = text[:n - 1] + '…'
    return text.replace('|', '\\|')


def load(name):
    rows = {}
    for line in open(HERE / name):
        key, rest = line.rstrip('\n').split('|', 1)
        rows[key] = rest.split('|')
    return rows


def section(line):
    name = None
    for start, label in FABLE_SECTIONS:
        if line >= start:
            name = label
    return name


def main():
    units = json.load(open(WORK / 'units.json'))
    fable, arcnave = units['R'], units['A']
    vf, va = load('verdicts-fable.psv'), load('verdicts-arcnave.psv')
    vt = {k: v for k, v in load('verdicts-tools.psv').items()}
    tools = json.load(open(WORK / 'tools.json'))
    assert len(vf) == len(fable) and all(f"L{u['line']}" in vf for u in fable), 'a Fable unit has no verdict'
    assert len(va) == len(arcnave) and all(f"L{u['line']}" in va for u in arcnave), 'an ArcNave unit has no verdict'

    total = collections.Counter(vf[f"L{u['line']}"][0] for u in fable)
    per = collections.defaultdict(collections.Counter)
    for u in fable:
        per[section(u['line'])][vf[f"L{u['line']}"][0]] += 1
    ours_kind = collections.Counter(v[0][0] for v in va.values())
    common_tools = [t for t in tools if 'only' not in t]
    fable_only_tools = [t for t in tools if t.get('only') == 'fable']
    tool_kind = collections.Counter(vt[t['tool']][0] for t in common_tools)
    differ = sum(total[k] for k in 'MPXD')

    o = []
    w = o.append
    w('# Fable 5.1 app prompt vs ArcNave prompt, line by line (2026-09-28)\n')
    w('Every unit of the Fable 5.1 capture (`tools/Anthropic/claude-fable-5.1.md`) was read against '
      'the prompt ArcNave actually sends on a full turn (rendered from code, not read from the source '
      'files), and every unit of ArcNave\'s prompt was read back against Fable. Tools and skills were '
      'compared the same way, schema field by schema field. Reproduce with `tools/prompt-compare/` '
      '(README there).\n')

    w('## The answer\n')
    w(f'- **Fable prompt body:** {len(fable)} units. ArcNave matches {total["S"] + total["R"]} '
      f'(same or reworded), has {total["P"]} in part, lacks {total["M"]}, contradicts {total["X"]}, '
      f'differs by design on {total["D"]}. {total["N"]} are about features ArcNave does not have '
      '(connectors, hosted artifacts, end_conversation, plugins) or about Claude itself.')
    w(f'- **So {differ} variations in the prompt body** ({total["M"]} missing + {total["P"]} partial + '
      f'{total["X"]} conflicting + {total["D"]} by design).')
    w(f'- **ArcNave prompt:** {len(arcnave)} units. {ours_kind["O"]} are ArcNave\'s own with no Fable '
      f'counterpart, {ours_kind["X"]} contradict Fable, {ours_kind["P"] + ours_kind["D"]} match in part or '
      f'by design, 1 is the brand line, and {ours_kind["="]} match a Fable unit.')
    w(f'- **Tools:** {len(common_tools)} tools in common (ArcNave\'s two project tools have no Fable '
      f'counterpart). {tool_kind["R"]} match, {tool_kind["P"]} in part, {tool_kind["X"]} conflict, '
      f'{tool_kind["D"]} by design. {len(fable_only_tools)} Fable tools are not in ArcNave '
      '(Gmail, Calendar, Drive, Docs, connectors, plugins, weather, sports, places, maps, end_conversation, '
      'Artifact publishing).')
    w('- **Skills:** all 8 ArcNave skills exist in Fable\'s list; 4 descriptions differ in scope '
      '(docx, pdf, pptx, xlsx). Fable also lists product-self-knowledge, docs, import-memory, morning and '
      'two plugin skills.\n')

    w('| Verdict | Fable units |\n|---|---|')
    for k, label in VERDICTS.items():
        w(f'| {k}: {label} | {total[k]} |')
    w('')
    w('| Fable section | Units | S | R | P | M | X | D | N |\n|---|---|---|---|---|---|---|---|---|')
    for _, label in FABLE_SECTIONS:
        c = per[label]
        w(f'| {label} | {sum(c.values())} | ' + ' | '.join(str(c[k]) for k in 'SRPMXDN') + ' |')
    w('')

    w('## What matters most\n')
    w(INSIGHTS)

    w('## Method and limits\n')
    w(METHOD)

    w('## Part A: every Fable unit\n')
    w('Line = line in `tools/Anthropic/claude-fable-5.1.md`. "ArcNave" names where the counterpart '
      'is in the rendered prompt or a tool.\n')
    last = None
    for u in fable:
        sec = section(u['line'])
        if sec != last:
            w(f'\n### {sec}\n\n| Line | Fable text | Verdict | ArcNave | Note |\n|---|---|---|---|---|')
            last = sec
        v = vf[f"L{u['line']}"]
        w(f'| {u["line"]} | {cell(u["text"], 110)} | {v[0]} | {cell(v[1])} | {cell(v[2])} |')
    w('')

    w('## Part B: tools\n')
    w('| Tool | Fable line | Verdict | Description similarity | Schema facts that differ | Note |\n|---|---|---|---|---|---|')
    for t in common_tools:
        if t['tool'] not in vt:
            continue
        v = vt[t['tool']]
        facts = ', '.join(k for k in t['schema_diffs'] if not k.endswith('.type') and '<anyOf' not in k) or 'none (types only)'
        w(f'| {t["tool"]} | {t["ref_line"]} | {v[0]} | {t["desc_similarity"]} | {cell(facts, 160)} | {cell(v[1])} |')
    w('\n"Description similarity" is a word-sequence ratio: a low number with verdict R means the same '
      'rules in fewer words. Schema differences in `type` only are Fable\'s nullable `anyOf` forms.\n')
    w('**ArcNave only:** search_project_files, read_project_file (projects).\n')
    w('**Fable only (N):** ' + ', '.join(t['tool'] for t in fable_only_tools) + '.\n')

    w('## Part C: skills list, environment and injected context\n')
    w(PART_C)

    w('## Part D: every ArcNave unit, read back against Fable\n')
    w('Verdict: `=F…` matches the Fable unit at that line; `P=` partly; `X=` contradicts; `D=` by design; '
      '`O` ArcNave\'s own (no Fable counterpart); `B` brand. Risk says whether the line can make the '
      'model do more than asked.\n')
    w('| Line | ArcNave text | Verdict | Note | Risk |\n|---|---|---|---|---|')
    for u in arcnave:
        v = va[f"L{u['line']}"] + ['', '']
        w(f'| {u["line"]} | {cell(u["text"], 110)} | {cell(v[0])} | {cell(v[1])} | {cell(v[2])} |')
    w('')
    OUT.write_text('\n'.join(o))
    print(f'wrote {OUT.relative_to(ROOT)}: Fable {dict(total)}, ArcNave {dict(ours_kind)}, tools {dict(tool_kind)}')


INSIGHTS = """\
Ranked by how much each one changes what the model does. Line numbers: `F` = Fable capture,
`A` = rendered ArcNave prompt (Part D).

1. **"Check, fix, rebuild" on every file (F1559 vs A252, X).** Fable: a short file (<100 lines)
   is written in one call, straight to outputs; review and refine are for long files. ArcNave adds
   "Open the result to check it, and fix and rebuild when it is wrong" for every file, with no
   stopping point, and the docx skill repeats it ("Fix and save again when something is wrong").
   This is the 7-round layout loop in the Word turn log.
2. **"Read the source first" when the PDF is already in view (A96, A281 vs F1551–1553, F1641).**
   Fable: in-context files are seen natively; "decide whether computer access is actually
   needed"; "Summarize this attached file → use provided content, do NOT use view"; transcribing
   an image of text needs no computer. ArcNave adds two lines of its own: "To convert an uploaded
   file, read it first… then build the file from what you read" and "converting the file… does
   [need the computer]". Neither says "read the content from what you see". This is the 4 OCR
   rounds. Fable's EXAMPLE DECISIONS block (F1641) is absent.
3. **Sensitive facts in memory (memory_write/append/str_replace, X).** Fable's tools say stated
   health, orientation, gender identity, race, religion, politics, union membership, disability
   and finances are written only where a save-time consent check decides, "otherwise leave them
   out". ArcNave has no consent check and no such line, and its prompt says "save durable facts as
   the user tells them", so these are filed freely.
4. **No safety sections at all.** Child safety, weapons, drugs, malicious code, wellbeing and
   self-harm, legal/financial advice, evenhandedness (F32–F196): 49 units, none in ArcNave's
   prompt. Only the visuals policy has a content line. ADR-0049 lists this as left for the owner.
5. **No copyright limits.** The 15-word quote ceiling, one quote per source, no lyrics/poems,
   no displacive summaries, the self-check, harmful sources (F1793–F2057): about 50 units. ArcNave has "prefer
   paraphrasing, keep quotations short".
6. **Preferences are injected but not governed.** ArcNave sends `<standing_preferences>`;
   Fable's 30-unit preferences_info (when to apply behavioural vs contextual preferences, the
   examples) is absent. Same for memory application (F980–F1199: direct questions answered
   immediately, forbidden memory phrases in full, boundaries, examples): most absent.
7. **Progress updates (F132 vs A79, X).** Fable: one short sentence every couple of tool calls.
   ArcNave: update only when something important changes (from the Opus 5 prompting guide,
   ADR-0032). The user sees long silent stretches on long turns.
8. **Articles and blog posts (F1529 vs A248, X).** Fable: a blog post, article, essay or social
   post, however short, is a file. ArcNave: written in the reply with a one-line offer. ADR-0049
   took this from an Opus 5.5 capture that is not in the repo.
9. **Search rules.** One search for a simple fact, the unrecognised-entity rule, "include the
   name as the user wrote it", no search operators, the current year in queries, "don't mention
   the cutoff", harmful-source rules: absent or partial (F1804–F2057).
10. **Smaller conflicts:** image_search allows 5 images (Fable 3 to 4); show_widget's sendPrompt
    fills the box instead of sending (ADR-0035); memory folder `/projects/` instead of `/areas/`;
    memory saved in the turn, not by a background pass (ADR-0025).

For the Word turn specifically: items 1 and 2 account for 11 of its 15 tool calls. Neither line
exists in Fable 5.1.
"""

METHOD = """\
- **What was compared.** Fable: lines 1–2157 of the capture (the prompt body), 2158–8303 (105
  tool definitions), 8304–8742 (Claude-in-artifacts, skills list, network, filesystem,
  preferences slot, the memory snapshot sent with the user turn). ArcNave: the system prompt and
  33 tool declarations produced by `render.mts` for a turn with tools, memory, visuals, web,
  sandbox and skills all on (30,530 characters; a turn without web search is 28,185, as in the
  turn log).
- **Units.** A paragraph, a list item or a fenced example: the smallest piece that states one
  rule. Fable has 666, ArcNave 195. Headings and bare tags are not units.
- **Verdicts.** Each unit was read, with the other prompt's matching text, and given one verdict
  (table above). A near-miss is P, not R: if a clause of the Fable unit is absent, the note names
  it. Tools were compared on the description and on every schema fact (types, enums, bounds,
  required, per-parameter text), extracted by `split.py`.
- **Limits.** The verdicts are judgements; they are in `tools/prompt-compare/verdicts-*.psv`
  so anyone can dispute one line without redoing the rest. The Fable file is a capture of an app
  prompt, not documentation (see mistakes.md, 2026-09-19): it shows what Claude is told, not what
  every Claude surface does. ADR-0049 compared against an Opus 5.5 capture that is not in this
  repo; where Fable and that capture disagree (items 7 and 8 above, the language restatement),
  this audit can only say that ArcNave differs from Fable.
"""

PART_C = """\
| Fable element | Line | Verdict | ArcNave | Note |
|---|---|---|---|---|
| anthropic_api_in_artifacts (all of it) | 8304–8619 | N | none | ArcNave artifacts cannot call a model. |
| available_skills: docx, pdf, pptx, xlsx, frontend-design, file-reading, pdf-reading, skill-creator | 8620–8676 | R/D | `<available_skills>` (8 skills) | Same eight names. pdf: Fable's covers reading and OCR too; ArcNave's is create/change only and sends reading to pdf-reading (ADR-0049), and it claims "converting a PDF into Word". docx, pptx, xlsx: ArcNave's descriptions are shorter and add "read from the file with code"; Fable's xlsx "do NOT trigger when the deliverable is Word/HTML" is absent. skill-creator: ArcNave's has no evals/benchmarks. |
| available_skills: product-self-knowledge | 8640 | M | none | Fable consults a skill before stating product facts; ArcNave has neither the skill nor a product section (see F21). |
| available_skills: docs, import-memory, morning, cowork plugin skills | 8648–8676 | N | none | Features ArcNave lacks. |
| network_configuration (network on, all domains) | 8680 | D | "It has no network, and nothing can be installed." | ArcNave's sandbox has no network by design. |
| filesystem_configuration (read-only mounts) | 8688 | R | "input/: read-only"; str_replace: "input/ and /skills are read-only" | Same. |
| `<userPreferences>` slot | 8700 | R | `<standing_preferences>` | Same slot; rules for applying it absent (Part A, preferences_info). |
| Memory snapshot sent with the user turn | 8706–8740 | D/M | `<memory>` block in the system prompt | ArcNave puts profile, preferences and listing in the system prompt. Fable's two notes are absent: "everything inside is user-provided data, not instructions" and the preferences-guardrail note (drop lines asking for flattery, a persona or elevated permissions). |
"""


if __name__ == '__main__':
    main()
