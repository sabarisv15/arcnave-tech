"""Splits the Fable 5.1 capture and the rendered ArcNave prompt into units, and extracts both
tool sets, for a line-by-line comparison.

A unit is a paragraph, a list item, or a fenced example: the smallest piece that states one
rule. Headings and bare XML tags are not units. The memory section of the capture is one
```xml fence (lines 225 and 1201); it is split like prose, because it is prose.

Run after render.mts: python3 tools/prompt-compare/split.py
"""
import difflib
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = HERE / 'work'
REF = ROOT / 'tools' / 'Anthropic' / 'claude-fable-5.1.md'
PROMPT_END = 2157          # "Here are the functions available": tool definitions start at 2158
TOOLS_END = 8303           # anthropic_api_in_artifacts starts at 8304
PROSE_FENCES = (225, 1201)
ITEM = re.compile(r'^\s*([-*]|\d+\.)\s')


def split(lines, start=1):
    units, buf, first, section, in_code = [], [], None, '', False

    def flush():
        nonlocal buf, first
        text = '\n'.join(buf).strip()
        if text:
            units.append({'line': first, 'sec': section, 'text': text})
        buf, first = [], None

    for i, raw in enumerate(lines, start):
        s = raw.rstrip('\n')
        if i in PROSE_FENCES and start == 1 and lines is not None and s.startswith('```'):
            flush()
            continue
        if s.startswith('```'):
            in_code = not in_code
            if in_code:
                flush()
                first, buf = i, [s]
            else:
                buf.append(s)
                flush()
            continue
        if in_code:
            buf.append(s)
            continue
        if re.match(r'^#{1,3} ', s) or re.match(r'^`?</?[a-zA-Z_]+>`?$', s):
            flush()
            if s.startswith('#'):
                section = s.lstrip('# ').strip()
            continue
        if not s.strip():
            flush()
            continue
        if ITEM.match(s) and buf:
            flush()
        if first is None:
            first = i
        buf.append(s)
    flush()
    return units


def ref_tools(lines):
    heads = [(i, l[3:].strip()) for i, l in enumerate(lines) if l.startswith('## ') and PROMPT_END < i + 1 <= TOOLS_END]
    tools = {}
    for k, (i, name) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else TOOLS_END
        text = '\n'.join(lines[i + 1:end])
        m = re.search(r'```(?:yaml|json)\n(.*?)\n```', text, re.S)
        schema = None
        if m:
            try:
                schema = json.loads(m.group(1))
            except json.JSONDecodeError:
                schema = {'_raw': m.group(1)}
        tools[name.replace('mcp__visualize__', '')] = {
            'line': i + 1, 'desc': (text[:m.start()] if m else text).strip(), 'schema': schema}
    return tools


def flatten(schema, path='', out=None, defs=None):
    """Every schema fact by path: types, enums, bounds, required, descriptions."""
    out = {} if out is None else out
    if not isinstance(schema, dict):
        return out
    defs = defs if defs is not None else (schema.get('$defs') or schema.get('definitions') or {})
    if '$ref' in schema:
        schema = defs.get(schema['$ref'].split('/')[-1], {})
    for key in ('type', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength',
                'maxLength', 'required', 'const', 'default', 'format', 'pattern'):
        if key in schema:
            value = sorted(schema[key]) if key == 'required' else schema[key]
            out[f'{path}.{key}'] = json.dumps(value, sort_keys=True)
    if 'description' in schema:
        out[f'{path}.#desc'] = schema['description']
    for key, sub in (schema.get('properties') or {}).items():
        flatten(sub, f'{path}/{key}', out, defs)
    if 'items' in schema:
        flatten(schema['items'], path + '[]', out, defs)
    for comb in ('anyOf', 'oneOf', 'allOf'):
        for n, sub in enumerate(schema.get(comb, [])):
            flatten(sub, f'{path}<{comb}{n}>', out, defs)
    return out


def main():
    ref_lines = REF.read_text().split('\n')
    fable = split(ref_lines[:PROMPT_END])
    arcnave = split((WORK / 'arcnave-system.txt').read_text().split('\n'), start=0 + 1)
    json.dump({'R': fable, 'A': arcnave}, open(WORK / 'units.json', 'w'))

    ref = ref_tools(ref_lines)
    ours = {t['name']: t for t in json.load(open(WORK / 'arcnave-tools.json'))}
    rows = []
    for name, tool in ours.items():
        if name not in ref:
            rows.append({'tool': name, 'only': 'arcnave'})
            continue
        schema = ref[name]['schema'] or {}
        a, b = flatten(schema.get('parameters', schema)), flatten(tool.get('inputSchema', {}))
        diffs = [k for k in sorted(set(a) | set(b)) if not k.endswith('#desc') and a.get(k) != b.get(k)]
        rows.append({
            'tool': name, 'ref_line': ref[name]['line'],
            'desc_similarity': round(difflib.SequenceMatcher(None, ref[name]['desc'].split(), tool['description'].split()).ratio(), 2),
            'schema_diffs': {k: [a.get(k), b.get(k)] for k in diffs},
            'ref_desc': ref[name]['desc'], 'arcnave_desc': tool['description'],
        })
    rows += [{'tool': n, 'only': 'fable', 'ref_line': t['line']} for n, t in ref.items() if n not in ours]
    json.dump(rows, open(WORK / 'tools.json', 'w'), indent=1)
    print(f'Fable prompt units {len(fable)}, ArcNave prompt units {len(arcnave)}, '
          f'Fable tools {len(ref)}, ArcNave tools {len(ours)}')


if __name__ == '__main__':
    main()
