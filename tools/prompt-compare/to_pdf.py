"""Renders the audit (work/report.html, written by build_report.py) to a PDF with Chromium.
Every table cell is whole: cells wrap, never clip, and rows never split across pages.

    python3 tools/prompt-compare/to_pdf.py [output.pdf]
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SRC = HERE / 'work' / 'report.html'
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'docs' / 'audits' / '2026-09-28-fable-5.1-prompt-line-by-line.pdf'
    subprocess.run([CHROME, '--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer',
                    f'--print-to-pdf={out}', SRC.as_uri()], check=True, capture_output=True)
    print(out)


if __name__ == '__main__':
    main()
