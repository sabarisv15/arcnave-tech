"""Renders the audit Markdown to a PDF with Chromium, every table cell whole (cells wrap, never
clip). Run after build_report.py:

    pip install markdown   # once
    python3 tools/prompt-compare/to_pdf.py [output.pdf]
"""
import subprocess
import sys
from pathlib import Path

import markdown

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SRC = ROOT / 'docs' / 'audits' / '2026-09-28-fable-5.1-prompt-line-by-line.md'
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

CSS = """
@page { size: A4 landscape; margin: 12mm 10mm 14mm; }
body { font: 8.5pt/1.4 "DejaVu Sans", Arial, sans-serif; color: #1a1a1a; }
h1 { font-size: 17pt; margin: 0 0 6pt; }
h2 { font-size: 13pt; margin: 16pt 0 6pt; border-bottom: 1px solid #999; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 12pt 0 4pt; page-break-after: avoid; }
h4 { font-size: 9.5pt; margin: 10pt 0 3pt; page-break-after: avoid; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; }
th, td { border: 0.5pt solid #888; padding: 2pt 3pt; vertical-align: top; text-align: left;
         overflow-wrap: break-word; word-break: normal; }
th { background: #e8e8e8; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
code { font: 8pt "DejaVu Sans Mono", monospace; background: #f2f2f2; }
li { margin: 1pt 0; }
"""


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'docs' / 'audits' / SRC.with_suffix('.pdf').name
    body = markdown.markdown(SRC.read_text(), extensions=['tables'])
    html = out.with_suffix('.html')
    html.write_text(f'<!doctype html><html><head><meta charset="utf-8"><title>{SRC.stem}</title>'
                    f'<style>{CSS}</style></head><body>{body}</body></html>')
    subprocess.run([CHROME, '--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer',
                    f'--print-to-pdf={out}', html.as_uri()], check=True, capture_output=True)
    html.unlink()
    print(out)


if __name__ == '__main__':
    main()
