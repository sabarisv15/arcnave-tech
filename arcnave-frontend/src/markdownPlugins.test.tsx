import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TextBlock } from './generative-ui/blocks/TextBlock';

const render = (text: string) => renderToStaticMarkup(<TextBlock block={{ type: 'text', text } as never} />);

describe('math in replies', () => {
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
});
