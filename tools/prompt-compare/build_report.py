"""Builds the audit report, as Markdown (docs/audits/…md) and as HTML for to_pdf.py, from the
units (split.py) and the three verdict files. The verdicts are judgements, one per unit,
written by reading both texts; this script only counts, sorts and lays them out.

Layout, for a reader who is not an engineer: every table has a one-line "what this shows"
above it; statuses are words, not codes; problems come before matches; rules about features
ArcNave does not have go to an appendix. Nothing is shortened anywhere.

Run after split.py: python3 tools/prompt-compare/build_report.py
"""
import collections
import html
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = HERE / 'work'
MD_OUT = ROOT / 'docs' / 'audits' / '2026-09-28-fable-5.1-prompt-line-by-line.md'
HTML_OUT = WORK / 'report.html'

# Status words. The order is the order rows are shown in: problems first.
STATUS = {
    'X': ('Opposite', 'ArcNave says the opposite of Fable', '#b3261e', '#fff'),
    'M': ('Missing', 'Fable has this rule; ArcNave has the feature but not the rule', '#e8a39d', '#000'),
    'P': ('Partly there', 'ArcNave has some of the rule; the note says which part is missing', '#f6d67a', '#000'),
    'D': ('Different on purpose', 'ArcNave differs, and the reason is recorded (an ADR or the sandbox design)', '#9cc3e6', '#000'),
    'R': ('Same meaning', 'ArcNave says the same thing in its own words', '#b6dfb0', '#000'),
    'S': ('Same words', 'ArcNave has the same sentence', '#6fbf73', '#000'),
    'N': ('Does not apply', 'About a feature ArcNave does not have, or about Claude itself', '#dcdcdc', '#000'),
}
ORDER = list(STATUS)

# Fable line where each topic starts: (line, topic, sub-topic). Plain names, not Fable's tags.
TOPICS = [
    (1, 'How Claude behaves', 'Facts about Claude and Anthropic products'),
    (30, 'How Claude behaves', 'Refusals and safety (children, weapons, drugs, malicious code, copyrighted works)'),
    (91, 'How Claude behaves', 'Legal and financial advice'),
    (96, 'How Claude behaves', 'Tone and formatting'),
    (135, 'How Claude behaves', 'The reply after tool calls'),
    (140, 'How Claude behaves', 'Wellbeing and mental health'),
    (175, 'How Claude behaves', 'Reminders sent by Anthropic'),
    (184, 'How Claude behaves', 'Political and moral balance'),
    (199, 'How Claude behaves', 'Mistakes and criticism'),
    (206, 'How Claude behaves', 'Knowledge cutoff'),
    (223, 'Memory', 'How memory works'),
    (246, 'Memory', 'Reading memory'),
    (320, 'Memory', 'How a memory file is written'),
    (417, 'Memory', 'Which file a fact goes in'),
    (486, 'Memory', 'When to save'),
    (519, 'Memory', 'What is worth saving'),
    (615, 'Memory', 'Editing, deleting, and saves that fail'),
    (791, 'Memory', 'Privacy: what may and may not be saved'),
    (942, 'Memory', 'Preferences that must never be saved'),
    (979, 'Memory', 'Using memory in a reply'),
    (1033, 'Memory', 'Phrases to avoid about memory'),
    (1056, 'Memory', 'Keeping a healthy distance'),
    (1062, 'Memory', 'Worked examples'),
    (1186, 'Memory', 'Memory safety'),
    (1205, 'Ending abusive chats', 'end_conversation tool'),
    (1233, 'Saving data inside artifacts', 'window.storage'),
    (1308, 'Suggesting connected apps', 'Connectors (MCP apps)'),
    (1358, 'Suggesting plugins and skills', 'Catalog'),
    (1378, 'Searching past chats', 'Past chats'),
    (1410, 'Applying the user\'s saved preferences', 'Preferences'),
    (1498, 'Skills, files and artifacts', 'Read the skill first'),
    (1519, 'Skills, files and artifacts', 'When to make a file'),
    (1534, 'Skills, files and artifacts', 'The computer and where files live'),
    (1557, 'Skills, files and artifacts', 'Writing a file and giving it to the user'),
    (1581, 'Skills, files and artifacts', 'Artifacts'),
    (1633, 'Skills, files and artifacts', 'Installing packages'),
    (1641, 'Skills, files and artifacts', 'Example decisions'),
    (1652, 'Skills, files and artifacts', 'Skills reminder'),
    (1659, 'Publishing artifacts as web pages', 'Artifact tool'),
    (1707, 'Charts, diagrams and visuals', 'Choosing the kind of visual'),
    (1737, 'Charts, diagrams and visuals', 'When to draw a visual'),
    (1789, 'Web search, copyright and images', 'When to search'),
    (1827, 'Web search, copyright and images', 'How to search and how to answer'),
    (1850, 'Web search, copyright and images', 'Copyright limits'),
    (1961, 'Web search, copyright and images', 'Search examples'),
    (2028, 'Web search, copyright and images', 'Harmful sources'),
    (2040, 'Web search, copyright and images', 'Search reminders'),
    (2061, 'Web search, copyright and images', 'Image search'),
    (2136, 'Web search, copyright and images', 'Fast search and the tool-call format'),
]

RISK = {'high': ('High', '#b3261e', '#fff'), 'medium': ('Medium', '#f6d67a', '#000'), 'low': ('Low', '#b6dfb0', '#000')}


def load(name):
    rows = {}
    for line in open(HERE / name):
        key, rest = line.rstrip('\n').split('|', 1)
        rows[key] = rest.split('|')
    return rows


def topic(line):
    found = TOPICS[0]
    for t in TOPICS:
        if line >= t[0]:
            found = t
    return found[1], found[2]


def fable_refs(text):
    """F1559 → line 1559 (the verdict files cite Fable units by line)."""
    return re.sub(r'\bF(\d+)\b', r'line \1', text)


# ---------------------------------------------------------------- document model and renderers
# A document is a list of blocks: ('h1'|'h2'|'h3'|'p'|'lead'|'caption', text) or
# ('table', headers, rows, widths). A cell is text, ('badge', code) or ('risk', level).

def badge_md(c):
    if c[0] == 'badge':
        return f'**{STATUS[c[1]][0]}**'
    return f'**{RISK[c[1]][0]}**'


def cell_md(c):
    if isinstance(c, tuple):
        return badge_md(c)
    text = c.strip().replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    for ch in ('\\', '`', '*', '_', '|'):
        text = text.replace(ch, '\\' + ch)
    return '<br>'.join(line.strip() for line in text.split('\n')) or ' '


def render_md(doc):
    out = []
    for b in doc:
        kind = b[0]
        if kind == 'h1':
            out.append(f'# {b[1]}\n')
        elif kind == 'h2':
            out.append(f'## {b[1]}\n')
        elif kind == 'h3':
            out.append(f'### {b[1]}\n')
        elif kind in ('p', 'lead'):
            out.append(b[1] + '\n')
        elif kind == 'caption':
            out.append(f'*{b[1]}*\n')
        elif kind == 'table':
            headers, rows = b[1], b[2]
            out.append('| ' + ' | '.join(headers) + ' |')
            out.append('|' + '---|' * len(headers))
            for r in rows:
                out.append('| ' + ' | '.join(cell_md(c) for c in r) + ' |')
            out.append('')
        elif kind == 'bar':
            out.append(' · '.join(f'{STATUS[k][0]}: {n}' for k, n in b[1]) + '\n')
    return '\n'.join(out)


def cell_html(c):
    if isinstance(c, tuple):
        if c[0] == 'badge':
            label, _, bg, fg = STATUS[c[1]]
        else:
            label, bg, fg = RISK[c[1]]
        return f'<span class="badge" style="background:{bg};color:{fg}">{label}</span>'
    return '<br>'.join(html.escape(line.strip()) for line in c.strip().split('\n'))


def render_html(doc, title):
    out = []
    for b in doc:
        kind = b[0]
        if kind in ('h1', 'h2', 'h3'):
            out.append(f'<{kind}>{html.escape(b[1])}</{kind}>')
        elif kind == 'p':
            out.append(f'<p>{inline(b[1])}</p>')
        elif kind == 'lead':
            out.append(f'<div class="lead">{inline(b[1])}</div>')
        elif kind == 'caption':
            out.append(f'<div class="caption">{inline(b[1])}</div>')
        elif kind == 'table':
            headers, rows, widths = b[1], b[2], b[3]
            keep = ' class="keep"' if len(b) > 4 and b[4] else ''
            cols = ''.join(f'<col style="width:{w}%">' for w in widths) if widths else ''
            head = ''.join(f'<th>{html.escape(h)}</th>' for h in headers)
            body = ''.join('<tr>' + ''.join(f'<td>{cell_html(c)}</td>' for c in r) + '</tr>' for r in rows)
            out.append(f'<table{keep}><colgroup>{cols}</colgroup><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>')
        elif kind == 'bar':
            total = sum(n for _, n in b[1]) or 1
            segs = ''.join(
                f'<div style="width:{100 * n / total:.2f}%;background:{STATUS[k][2]};color:{STATUS[k][3]}">'
                f'{STATUS[k][0] + " " + str(n) if n / total > 0.06 else ""}</div>' for k, n in b[1] if n)
            out.append(f'<div class="bar">{segs}</div>')
    return (f'<!doctype html><html><head><meta charset="utf-8"><title>{html.escape(title)}</title>'
            f'<style>{CSS}</style></head><body>{"".join(out)}</body></html>')


def inline(text):
    """**bold** and `code` in prose blocks (never in table cells, which show source text as written)."""
    t = html.escape(text)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'`(.+?)`', r'<code>\1</code>', t)
    return t.replace('\n', '<br>')


CSS = """
@page { size: A4 landscape; margin: 12mm 11mm 13mm; }
body { font: 9pt/1.45 "DejaVu Sans", Arial, sans-serif; color: #1a1a1a; }
h1 { font-size: 19pt; margin: 0 0 4pt; }
h2 { font-size: 14pt; margin: 18pt 0 4pt; padding-bottom: 2pt; border-bottom: 1.5pt solid #333;
     break-after: avoid; }
h2 { break-before: page; }
h1 + p + h2, .keep h2 { break-before: auto; }
h3 { font-size: 11pt; margin: 12pt 0 2pt; break-after: avoid; }
p { margin: 3pt 0 6pt; }
.lead { font-size: 11pt; background: #f3f3f3; border-left: 4pt solid #333; padding: 6pt 9pt; margin: 6pt 0 8pt; }
.caption { color: #444; font-style: italic; margin: 2pt 0 4pt; break-after: avoid; }
table { width: 100%; border-collapse: collapse; margin: 2pt 0 10pt; table-layout: fixed; }
th, td { border: 0.5pt solid #999; padding: 3pt 4pt; vertical-align: top; text-align: left;
         overflow-wrap: break-word; }
th { background: #333; color: #fff; font-weight: bold; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
table.keep { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #fafafa; }
.badge { display: inline-block; padding: 1pt 5pt; border-radius: 3pt; font-weight: bold; font-size: 8pt;
         }
.bar { display: flex; height: 18pt; margin: 4pt 0 10pt; border: 0.5pt solid #999; font-size: 7.5pt;
       font-weight: bold; }
.bar div { display: flex; align-items: center; justify-content: center; overflow: hidden; white-space: nowrap; }
code { font: 8.5pt "DejaVu Sans Mono", monospace; background: #eee; padding: 0 2pt; }
"""


# ---------------------------------------------------------------- content

TOP10 = [
    ('1', '"Check, fix, rebuild" on every file',
     'Line 1559: a short file (under 100 lines) is written in one step, straight to the output '
     'folder. Review and refine are only for long files.',
     'Line 252: "Open the result to check it, and fix and rebuild when it is wrong", for every '
     'file, with no point at which to stop. The Word skill repeats it ("Fix and save again when '
     'something is wrong").',
     'The 7-step layout loop in the Word request (steps 9 to 15 below).'),
    ('2', 'Re-reading a PDF that is already in view',
     'Lines 1551 to 1553 and 1641: files in the chat are already seen; "decide whether computer '
     'access is actually needed"; "Summarize this attached file → use provided content, do NOT use '
     'view"; reading an image of text needs no computer.',
     'Lines 96 and 281, ArcNave\'s own: "To convert an uploaded file, read it first… then build the '
     'file from what you read" and "converting the file… does [need the computer]". Neither says '
     '"read the content from what you see". Fable\'s example list (line 1641) is missing.',
     'The 4 OCR steps in the Word request (steps 2 to 5 below).'),
    ('3', 'Sensitive facts saved to memory',
     'Memory tools: stated health, sexual orientation, gender identity, race, religion, politics, '
     'union membership, disability and finances are saved only where a save-time consent check '
     'decides; "otherwise leave them out".',
     'No consent check and no such line. The prompt says "save durable facts as the user tells '
     'them".',
     'These facts are saved freely.'),
    ('4', 'Safety rules',
     'Lines 32 to 196: child safety, weapons, drugs, malicious code, wellbeing and self-harm, '
     'legal and financial advice, political balance. 49 rules.',
     'None of them. Only the visuals section has one content line. ADR-0049 lists these as left '
     'for the owner.',
     'The prompt gives the model none of these rules.'),
    ('5', 'Copyright limits',
     'Lines 1793 to 2057: quotes under 15 words, one quote per source, no song lyrics or poems, '
     'no summary that replaces the article, a self-check, harmful sources. About 50 rules.',
     '"Prefer paraphrasing", "keep quotations short", "do not reproduce large portions".',
     'No hard limits.'),
    ('6', 'Saved preferences and memory use',
     'Lines 1410 to 1497: when to apply the user\'s saved preferences, with examples. Lines 980 '
     'to 1199: how to use memory in a reply (answer a direct question at once, phrases to avoid, '
     'boundaries, examples).',
     'Sends the user\'s preferences but no rules for applying them. Most memory-use rules are '
     'missing.',
     'No guidance on when a preference or a memory belongs in the answer.'),
    ('7', 'Progress updates',
     'Line 132: one short sentence every couple of tool calls.',
     'Line 79: update only when something important changes (from the Opus 5 prompting guide, '
     'ADR-0032).',
     'Long silent stretches on long tasks.'),
    ('8', 'Articles and blog posts',
     'Line 1529: a blog post, article, essay or social post, however short, is a file.',
     'Line 248: written in the reply, with a one-line offer to make a file. ADR-0049 took this '
     'from an Opus 5.5 prompt capture that is not in the repo.',
     'Opposite behaviour.'),
    ('9', 'Search rules',
     'Lines 1804 to 2057: one search for a simple fact; search any name it does not recognise; '
     'search the name as the user wrote it; no search operators; use the current year; do not '
     'mention the knowledge cutoff; avoid harmful sources.',
     'Missing, or only partly there.',
     'Search behaviour is less guided.'),
    ('10', 'Smaller differences',
     'Image search: 3 to 4 images. show_widget\'s sendPrompt sends the message. Memory folder '
     '/areas/. Memory saved after the turn by a background pass.',
     'Image search allows 5. sendPrompt fills the message box instead (ADR-0035). Memory folder '
     '/projects/. Memory saved during the turn (ADR-0025).',
     'Small, and three of the four are recorded decisions.'),
]

WORD_TURN = [
    ('1', 'Read the Word skill', 'Yes', 'Needed.'),
    ('2 to 5', 'Read the PDF again with code: text extraction, page to image, OCR twice', 'No',
     'The page image was already in view. Lines 96 and 281 of ArcNave\'s prompt (problem 2).'),
    ('6', 'Wrote the Word file', 'Yes', 'Needed.'),
    ('7 to 8', 'Converted it to PDF to preview it; LibreOffice crashed once, then worked', 'One step wasted',
     'A sandbox problem, not the prompt.'),
    ('9 to 15', 'Rebuilt the file three times to stop a number wrapping in a table cell', 'No',
     'Line 252 of ArcNave\'s prompt and the Word skill (problem 1). Its own code set the column '
     'width twice, so no rebuild fixed it.'),
    ('(end)', 'Hit the 16-step limit before giving the file', '',
     'The file was never presented. A backend bug also hid the Continue button: after the limit, '
     'one more request overwrites "tool_limit" with "stop" (generation.ts).'),
]


def verdict_arcnave(code):
    """Part D verdict codes in words."""
    kinds = {'=': ('R', 'Matches Fable'), 'P': ('P', 'Partly matches Fable'), 'X': ('X', 'Opposite of Fable'),
             'D': ('D', 'Different on purpose from Fable'), 'O': ('M', 'ArcNave\'s own (not in Fable)'),
             'B': ('N', 'Brand line')}
    lead = code[0]
    status, words = kinds[lead]
    ref = code.split('=', 1)[1] if '=' in code else ''
    ref = fable_refs(ref).replace('(X)', ' (opposite)')
    return status, (f'{words}: {ref}' if ref else words)


def build():
    units = json.load(open(WORK / 'units.json'))
    fable, arcnave = units['R'], units['A']
    vf, va, vt = load('verdicts-fable.psv'), load('verdicts-arcnave.psv'), load('verdicts-tools.psv')
    tools = json.load(open(WORK / 'tools.json'))
    assert len(vf) == len(fable) and all(f"L{u['line']}" in vf for u in fable), 'a Fable unit has no verdict'
    assert len(va) == len(arcnave) and all(f"L{u['line']}" in va for u in arcnave), 'an ArcNave unit has no verdict'
    common = [t for t in tools if 'only' not in t]
    fable_only_tools = [t['tool'] for t in tools if t.get('only') == 'fable']

    def v(u):
        return vf[f"L{u['line']}"]

    total = collections.Counter(v(u)[0] for u in fable)
    by_topic = collections.OrderedDict()
    for u in fable:
        by_topic.setdefault(topic(u['line'])[0], collections.Counter())[v(u)[0]] += 1
    ours = collections.Counter(va[f"L{u['line']}"][0][0] for u in arcnave)
    tool_status = collections.Counter(vt[t['tool']][0] for t in common)

    d = []
    d.append(('h1', 'ArcNave vs Claude (Fable 5.1): system prompt, rule by rule'))
    d.append(('p', 'Compared on 2026-09-28. Fable 5.1 = the Claude app prompt captured in '
                   '`tools/Anthropic/claude-fable-5.1.md`. ArcNave = the prompt ArcNave really sends '
                   'to the model on a turn with every feature on, produced from the code. Every rule '
                   'on both sides was read and given one status. Nothing in this report is shortened.'))

    d.append(('h2', 'The answer on one page'))
    d.append(('lead', f'Fable\'s prompt has **{len(fable)} rules**. ArcNave follows **{total["S"] + total["R"]}**, '
                      f'follows **{total["P"]}** only partly, is **missing {total["M"]}**, says **the opposite on '
                      f'{total["X"]}**, and differs **on purpose on {total["D"]}**. The other **{total["N"]}** are about '
                      f'features ArcNave does not have, or about Claude itself.\n'
                      f'So ArcNave differs from Fable on **{total["M"] + total["P"] + total["X"] + total["D"]} rules**. '
                      f'ArcNave also has **{ours["O"]} lines of its own** that Fable does not have.'))
    d.append(('bar', [(k, total[k]) for k in ORDER]))
    d.append(('h3', 'What each status means'))
    d.append(('caption', 'Every rule in this report has one of these seven statuses.'))
    d.append(('table', ['Status', 'Meaning', 'Rules'],
              [[('badge', k), STATUS[k][1], str(total[k])] for k in ORDER], [16, 72, 12], True))
    d.append(('h3', 'Rules by topic'))
    d.append(('caption', 'How many of Fable\'s rules on each topic ArcNave has. Read across a row: the '
                         '"Missing" and "Opposite" columns are the gaps.'))
    rows = []
    for name, c in by_topic.items():
        rows.append([name, str(sum(c.values()))] + [str(c[k]) if c[k] else '·' for k in ORDER])
    d.append(('table', ['Topic', 'Rules'] + [STATUS[k][0] for k in ORDER], rows,
              [27, 7, 9, 9, 10, 10, 10, 9, 9], True))
    d.append(('h3', 'Tools and skills'))
    d.append(('caption', 'The tools the model can call, and the skill list.'))
    d.append(('table', ['What', 'Result'], [
        ['Tools both have', f'{len(common)}: {tool_status["R"]} same meaning, {tool_status["P"]} partly, '
                            f'{tool_status["X"]} opposite, {tool_status["D"]} different on purpose. Details in Part 3.'],
        ['Tools only Fable has', f'{len(fable_only_tools)}: Gmail, Calendar, Drive, Docs, connectors, plugins, '
                                 'weather, sports, places, maps, end_conversation, Artifact publishing.'],
        ['Tools only ArcNave has', '2: search_project_files, read_project_file.'],
        ['Skills', 'All 8 ArcNave skills are in Fable\'s list. 4 descriptions differ in scope (docx, pdf, '
                   'pptx, xlsx). Fable also has product-self-knowledge, docs, import-memory, morning and two '
                   'plugin skills.'],
    ], [22, 78], True))

    d.append(('h2', 'The 10 differences that matter most'))
    d.append(('caption', 'Ranked by how much each one changes what the model does. Line numbers are '
                         'Fable\'s (left) and ArcNave\'s rendered prompt (right).'))
    d.append(('table', ['#', 'Difference', 'Fable says', 'ArcNave says', 'What it causes'],
              [list(r) for r in TOP10], [4, 14, 30, 32, 20]))

    d.append(('h3', 'Why the Word request took 15 steps'))
    d.append(('caption', 'The turn log of "Word ah maathi intha file ah" (a one-page scanned PDF). '
                         'Problems 1 and 2 above caused 11 of the 15 steps. Neither line is in Fable.'))
    d.append(('table', ['Steps', 'What the model did', 'Needed?', 'Why'], [list(r) for r in WORD_TURN],
              [9, 36, 10, 45]))

    d.append(('h2', 'Part 1: Fable\'s rules, topic by topic'))
    d.append(('p', 'Each table is one topic. The line above it counts the statuses. Rows are sorted '
                   'with problems first (Opposite, Missing, Partly there), then matches. "Line" is the '
                   'line in the Fable file. "In ArcNave" says where ArcNave has it and what is missing. '
                   'Topics that do not apply to ArcNave at all are in Appendix A.'))
    na_rows = []
    groups = collections.OrderedDict()
    for u in fable:
        main, sub = topic(u['line'])
        groups.setdefault(main, collections.OrderedDict()).setdefault(sub, []).append(u)
    for main, subs in groups.items():
        all_units = [u for us in subs.values() for u in us]
        if all(v(u)[0] == 'N' for u in all_units):
            for sub, us in subs.items():
                na_rows += [[main, str(u['line']), u['text'], fable_refs(v(u)[2])] for u in us]
            continue
        d.append(('h3', main))
        for sub, us in subs.items():
            shown = [u for u in us if v(u)[0] != 'N']
            na_rows += [[f'{main}: {sub}', str(u['line']), u['text'], fable_refs(v(u)[2])] for u in us if v(u)[0] == 'N']
            if not shown:
                continue
            c = collections.Counter(v(u)[0] for u in shown)
            tally = ', '.join(f'{c[k]} {STATUS[k][0].lower()}' for k in ORDER if c[k])
            extra = sum(1 for u in us if v(u)[0] == 'N')
            d.append(('caption', f'{sub}: {len(shown)} rules ({tally}).'
                                 + (f' {extra} more do not apply (Appendix A).' if extra else '')))
            shown.sort(key=lambda u: (ORDER.index(v(u)[0]), u['line']))
            rows = []
            for u in shown:
                status, where, note = v(u)
                text = (f'Where: {fable_refs(where)}\n' if where else '') + fable_refs(note)
                rows.append([str(u['line']), u['text'], ('badge', status), text])
            d.append(('table', ['Line', 'What Fable says', 'Status', 'In ArcNave'], rows, [6, 49, 13, 32]))

    d.append(('h2', 'Part 2: ArcNave\'s prompt, read back against Fable'))
    d.append(('p', f'All {len(arcnave)} of ArcNave\'s lines. "Line" is the line in the rendered ArcNave '
                   'prompt. The first table is the lines Fable does not have, with how risky each is '
                   '(can it make the model do more than asked?). The second is the lines that match, '
                   'partly match, or contradict Fable.'))
    own = [u for u in arcnave if va[f"L{u['line']}"][0] == 'O']
    risk_order = {'high': 0, 'medium': 1, 'low': 2}

    def risk(u):
        text = (va[f"L{u['line']}"] + ['', ''])[2]
        level = text.split(':')[0].strip().lower() or 'low'
        return level if level in RISK else 'low', text

    own.sort(key=lambda u: (risk_order[risk(u)[0]], u['line']))
    d.append(('h3', f'Lines only ArcNave has ({len(own)})'))
    c = collections.Counter(risk(u)[0] for u in own)
    d.append(('caption', f'Risk: {c["high"]} high, {c["medium"]} medium, {c["low"]} low. High and medium first. '
                         '"Ours" means ArcNave\'s own idea, with no source in Fable.'))
    rows = []
    for u in own:
        level, text = risk(u)
        why = text.split(':', 1)[1].strip() if ':' in text else ''
        rows.append([str(u['line']), u['text'], ('risk', level),
                     fable_refs(va[f"L{u['line']}"][1]) + (f'\nRisk: {why}' if why else '')])
    d.append(('table', ['Line', 'What ArcNave says', 'Risk', 'Where it came from'], rows, [6, 52, 9, 33]))

    rest = [u for u in arcnave if va[f"L{u['line']}"][0] != 'O']
    rest.sort(key=lambda u: (ORDER.index(verdict_arcnave(va[f"L{u['line']}"][0])[0]), u['line']))
    d.append(('h3', f'Lines that match, partly match, or contradict Fable ({len(rest)})'))
    c = collections.Counter(verdict_arcnave(va[f"L{u['line']}"][0])[0] for u in rest)
    d.append(('caption', f'{c["X"]} opposite, {c["P"]} partly, {c["D"]} different on purpose, {c["R"]} match, '
                         f'{c["N"]} brand line. Opposite first.'))
    rows = []
    for u in rest:
        fields = va[f"L{u['line']}"] + ['', '']
        status, words = verdict_arcnave(fields[0])
        note = '\n'.join(x for x in (fable_refs(fields[1]), f'Risk: {fable_refs(fields[2])}' if fields[2] else '') if x)
        rows.append([str(u['line']), u['text'], ('badge', status), words + (f'\n{note}' if note else '')])
    d.append(('table', ['Line', 'What ArcNave says', 'Status', 'Fable'], rows, [6, 50, 13, 31]))

    d.append(('h2', 'Part 3: tools, skills and settings'))
    d.append(('h3', 'Tools both have'))
    d.append(('caption', 'One row per tool. "What differs" is the gist; the full texts of both sides are in '
                         'Appendix B.'))
    common_sorted = sorted(common, key=lambda t: (ORDER.index(vt[t['tool']][0]), t['tool']))
    d.append(('table', ['Tool', 'Status', 'What differs'],
              [[t['tool'], ('badge', vt[t['tool']][0]), vt[t['tool']][1]] for t in common_sorted], [20, 13, 67]))
    d.append(('h3', 'Skills, sandbox and injected context'))
    d.append(('caption', 'The other parts of Fable\'s prompt: the skill list, the sandbox settings, and what is '
                         'sent along with each message.'))
    d.append(('table', ['Fable part', 'Line', 'Status', 'In ArcNave'], PART_C, [24, 8, 13, 55]))

    d.append(('h2', 'Appendix A: rules that do not apply to ArcNave'))
    d.append(('p', f'{len(na_rows)} rules about features ArcNave does not have (connectors, hosted artifacts, '
                   'end_conversation, plugins, Google data) or about Claude itself. Listed in full so '
                   'nothing is left out.'))
    d.append(('table', ['Topic', 'Line', 'What Fable says', 'Why it does not apply'], na_rows, [16, 6, 56, 22]))

    d.append(('h2', 'Appendix B: every shared tool, both texts in full'))
    d.append(('p', 'For each tool: its whole description in Fable and in ArcNave, then every setting that '
                   'differs (Fable value, ArcNave value). Settings that differ only in being optional '
                   '("null" allowed) are Fable\'s notation and do not change behaviour.'))
    for t in common:
        d.append(('h3', f'{t["tool"]} (Fable line {t["ref_line"]})'))
        d.append(('table', ['Fable', 'ArcNave'], [[t['ref_desc'], t['arcnave_desc']]], [50, 50]))
        if t['schema_diffs']:
            d.append(('table', ['Setting', 'Fable', 'ArcNave'],
                      [[k, 'not set' if a is None else str(a), 'not set' if b is None else str(b)]
                       for k, (a, b) in t['schema_diffs'].items()], [24, 38, 38]))

    d.append(('h2', 'Appendix C: how this was done, and its limits'))
    d.append(('table', ['Question', 'Answer'], METHOD, [22, 78]))
    return d


PART_C = [
    ['Calling a model from inside an artifact (all of it)', '8304 to 8619', ('badge', 'N'),
     'ArcNave artifacts cannot call a model.'],
    ['Skill list: docx, pdf, pptx, xlsx, frontend-design, file-reading, pdf-reading, skill-creator',
     '8620 to 8676', ('badge', 'D'),
     'The same eight skills. pdf: Fable\'s covers reading and OCR too; ArcNave\'s is for making or '
     'changing PDFs only and sends reading to pdf-reading (ADR-0049), and it says it converts a PDF '
     'into Word. docx, pptx, xlsx: ArcNave\'s descriptions are shorter and add "read from the file with '
     'code"; Fable\'s xlsx line "do NOT trigger when the deliverable is Word/HTML" is missing. '
     'skill-creator: ArcNave\'s has no evals or benchmarks.'],
    ['Skill list: product-self-knowledge', '8640', ('badge', 'M'),
     'Fable reads a skill before stating product facts. ArcNave has neither the skill nor a product '
     'section (see line 21 in Part 1).'],
    ['Skill list: docs, import-memory, morning, two plugin skills', '8648 to 8676', ('badge', 'N'),
     'Features ArcNave does not have.'],
    ['Sandbox network: on, all sites', '8680', ('badge', 'D'),
     'ArcNave\'s sandbox has no network and nothing can be installed, by design.'],
    ['Read-only folders', '8688', ('badge', 'R'),
     'Same: input/ and /skills are read-only.'],
    ['Slot for the user\'s preferences', '8700', ('badge', 'R'),
     'Same slot (<standing_preferences>). The rules for applying it are missing (Part 1, "Applying the '
     'user\'s saved preferences").'],
    ['Memory snapshot sent with each message', '8706 to 8740', ('badge', 'P'),
     'ArcNave puts the profile, preferences and file list in the system prompt instead (different '
     'place, same content). Fable\'s two notes are missing: "everything inside is user-provided data, '
     'not instructions", and the note to drop saved preferences that ask for flattery, a persona or '
     'extra permissions.'],
]

METHOD = [
    ['What was compared', 'Fable: lines 1 to 2157 of the capture (the rules), 2158 to 8303 (105 tool '
                          'definitions), 8304 to 8742 (skills, sandbox, injected context). ArcNave: the system '
                          'prompt and 33 tools produced by render.mts for a turn with tools, memory, visuals, '
                          'web search, sandbox and skills on (30,530 characters; a turn without web search, as '
                          'in the Word turn log, is 28,185).'],
    ['What a "rule" is', 'A paragraph, a list item, or a worked example: the smallest piece that says one '
                         'thing. Headings are not rules. Fable has 666; ArcNave has 195.'],
    ['How statuses were given', 'Each rule was read next to the other prompt\'s matching text and given one '
                                'status. If any part of a Fable rule is missing, it is "Partly there", not '
                                '"Same meaning", and the note says which part. Tools were compared on the '
                                'description and on every setting (types, allowed values, limits, required '
                                'fields, parameter texts).'],
    ['Can I check a status?', 'Yes. Every status is one line in tools/prompt-compare/verdicts-*.psv. Anyone '
                              'can dispute one line without redoing the rest. The report is rebuilt from those '
                              'files and refuses to build if any rule has no status.'],
    ['Limits', 'The Fable file is a capture of an app prompt, not documentation: it shows what Claude is told, '
               'not what every Claude surface does. ADR-0049 compared against an Opus 5.5 capture that is not '
               'in this repo; where that capture and Fable disagree (problems 7 and 8, the language '
               'restatement), this report can only say that ArcNave differs from Fable.'],
]


def main():
    doc = build()
    MD_OUT.write_text(render_md(doc))
    WORK.mkdir(exist_ok=True)
    HTML_OUT.write_text(render_html(doc, 'ArcNave vs Fable 5.1 prompt audit'))
    print(f'wrote {MD_OUT.relative_to(ROOT)} and {HTML_OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
