import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TextBlock } from './generative-ui/blocks/TextBlock';
import { normalizeMathDelimiters } from './markdownPlugins';

const render = (text: string) => renderToStaticMarkup(<TextBlock block={{ type: 'text', text } as never} />);

describe('math in replies', () => {
  it('typesets single-dollar inline math in mixed prose', () => {
    const html = render('Settings $\\rightarrow$ Usage; அசல் $P$ and $10\\% = 0.10$.');
    expect(html).toContain('katex');
    expect(html).not.toContain('$\\rightarrow$');
    expect(html).toContain('→');
  });

  it('keeps code and escaped dollar symbols inert', () => {
    const html = render('`$\\rightarrow$` and \\$5.\n\n```js\nconst price = "$10";\n```');
    expect(html).not.toContain('katex');
    expect(html).toContain('$');
  });
  it('typesets a $$ display block, including aligned environments', () => {
    const html = render('Net:\n\n$$\n\\begin{aligned} a &= b + c \\\\ d &= e \\end{aligned}\n$$');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('\\begin{aligned}</p>');
  });

  it('leaves single-dollar prices as text', () => {
    const html = render('It costs $5 and $10 today.');
    expect(html).not.toContain('katex');
    expect(html).toContain('$5 and $10');
  });

  it('shows a malformed formula instead of throwing', () => {
    expect(() => render('$$\\frac{1}{$$')).not.toThrow();
  });

  // Stage 6 ST-4: the system prompt asks for \( … \) inline and \[ … \] display.
  it('typesets \\( … \\) inline math', () => {
    const html = render('The area is \\(\\pi r^2\\) for a circle.');
    expect(html).toContain('katex');
    expect(html).not.toContain('\\(');
    expect(html).not.toContain('(\\pi');
  });

  it('typesets a \\[ … \\] block on its own lines as display math, and inside a line as inline math', () => {
    const block = render('Net:\n\n\\[\n\\frac{a}{b}\n\\]\n\nDone.');
    expect(block).toContain('katex-display');
    expect(block).not.toContain('\\[');
    const inline = render('Net: \\[ \\frac{a}{b} \\] done.');
    expect(inline).toContain('katex');
    expect(inline).not.toContain('\\[');
  });

  it('leaves Markdown-escaped brackets as text: no math signal, a list task box, or a paragraph break between', () => {
    expect(normalizeMathDelimiters('See note \\[1\\] and arr\\[i\\].')).toBe('See note \\[1\\] and arr\\[i\\].');
    expect(normalizeMathDelimiters('- \\[ \\] todo')).toBe('- \\[ \\] todo');
    const across = 'Start \\[ x^2 here\n\nmany paragraphs\n\nend \\] there';
    expect(normalizeMathDelimiters(across)).toBe(across);
    const acrossCrlf = 'Start \\[ x^2 here\r\n\r\nmany paragraphs\r\n\r\nend \\] there';
    expect(normalizeMathDelimiters(acrossCrlf)).toBe(acrossCrlf);
  });

  it('treats any non-word body as math, including a bare minus', () => {
    expect(normalizeMathDelimiters('so \\[ x - y \\] holds')).toBe('so $$x - y$$ holds');
    expect(normalizeMathDelimiters('- \\[ x - y \\]')).toBe('- $$x - y$$');
  });

  it('keeps math inline after a code span and after a hard line break', () => {
    expect(normalizeMathDelimiters('`a` \\[x^2\\]')).toBe('`a` $$x^2$$');
    expect(normalizeMathDelimiters('a\\\n\\[x^2\\]')).toBe('a\\\n$$x^2$$');
  });

  it('leaves bracketed prose as text, in any script', () => {
    for (const text of [
      "Dear \\[Recipient's Name\\],",
      '\\[see: docs\\](https://example.com)',
      '\\[Insert company-specific detail\\]',
      '\\[café\\] and \\[குறிப்பு\\]',
    ]) {
      expect(normalizeMathDelimiters(text)).toBe(text);
    }
  });

  it('keeps a list item and a table row intact around \\[ … \\] math', () => {
    expect(normalizeMathDelimiters('- area \\[ \\pi r^2 \\]')).toBe('- area $$\\pi r^2$$');
    expect(normalizeMathDelimiters('| a | \\[x^2\\] |')).toBe('| a | $$x^2$$ |');
    expect(render('| a | b |\n|---|---|\n| 1 | \\[x^2\\] |')).toContain('<table>');
  });

  it('leaves \\( in code spans, fenced code, an open fence and an escaped backslash as written', () => {
    expect(normalizeMathDelimiters('`\\(x\\)` and\n\n```tex\n\\(y\\) \\[z\\]\n```\n')).toBe('`\\(x\\)` and\n\n```tex\n\\(y\\) \\[z\\]\n```\n');
    expect(normalizeMathDelimiters('a \\(x\\)\n```\n\\(y\\)')).toBe('a $x$\n```\n\\(y\\)');
    expect(normalizeMathDelimiters('C:\\\\(dir\\\\)')).toBe('C:\\\\(dir\\\\)');
    expect(normalizeMathDelimiters('no math here (really)')).toBe('no math here (really)');
  });

  it('normalises in linear time on a long reply with many unmatched openers', () => {
    const texts = [
      '\\( '.repeat(50_000) + '\\[ '.repeat(50_000) + '\n```x\n'.repeat(20_000),
      '\\[ a '.repeat(50_000) + '\\]',
      '\\[ x^2\n\n'.repeat(30_000) + '\\]',
      '\\(x\\) ' + '`'.repeat(50_000),
      '\\(x\\) ' + '``a`'.repeat(20_000),
      'Area is \\[ a' + ' '.repeat(80_000) + '^2 \\] here.',
      'Area is \\[ a' + ' \n'.repeat(40_000) + '^2 \\] here.',
    ];
    for (const text of texts) {
      const started = Date.now();
      normalizeMathDelimiters(text);
      expect(Date.now() - started).toBeLessThan(2_000);
    }
  });
});
