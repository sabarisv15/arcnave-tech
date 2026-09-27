import { describe, expect, it, vi } from 'vitest';
import { UIToolExecutor } from './uiExecutor.js';
import { DISPLAY_TOOL_NAMES } from './displayDefinitions.js';
import type { UIAuthorizer } from '../services/ui/authorizer.js';
import type { UIBlock, UIResponseV1 } from '../services/ui/types.js';
import { VISUAL_MAX_HTML_BYTES } from '../services/ui/validator.js';
import type { WebSearchAdapter } from '../services/webSearch.js';

const authorizer = { filterAuthorizedUI: vi.fn(async (res: UIResponseV1) => res) } as unknown as UIAuthorizer;
const authCtx = { userId: '00000000-0000-0000-0000-000000000001', chatId: '00000000-0000-0000-0000-000000000002' };
const signal = () => new AbortController().signal;
const textOf = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;
const dataOf = <T>(r: { content: unknown[] }) => (r.content[0] as { data: T }).data;

function executor(images?: WebSearchAdapter) {
  const blocks: UIBlock[] = [];
  const ex = new UIToolExecutor(authorizer, authCtx, 100_000, (b) => blocks.push(b), images);
  const run = (name: string, input: unknown, id = 'c1') => ex.execute({ id, name, input: input as Record<string, unknown> }, signal());
  return { run, blocks };
}

describe('show_widget (ADR-0048)', () => {
  it('streams the code to the client as a visual, and sends the model only its size', async () => {
    const { run, blocks } = executor();
    const html = '<svg viewBox="0 0 10 10"><rect class="node"/></svg>';
    const res = await run('show_widget', { title: 'box', loading_messages: ['Drawing'], widget_code: html });
    expect(res.ok).toBe(true);
    expect(blocks).toMatchObject([{ type: 'visual', title: 'box', html }]);
    const block = dataOf<UIResponseV1>(res).blocks[0] as { html?: string; htmlBytes?: number };
    expect(block.html).toBeUndefined();
    expect(block.htmlBytes).toBe(Buffer.byteLength(html));
  });

  it('refuses a call without code or over the size limit, drawing nothing', async () => {
    const { run, blocks } = executor();
    expect((await run('show_widget', { title: 'x', loading_messages: ['a'] })).ok).toBe(false);
    const big = await run('show_widget', { title: 'x', loading_messages: ['a'], widget_code: 'x'.repeat(VISUAL_MAX_HTML_BYTES + 1) });
    expect(big.ok).toBe(false);
    expect(textOf(big)).toContain('visual_too_large');
    expect(blocks).toEqual([]);
  });
});

describe('read_me', () => {
  it('returns the core rules, and each module asked for', async () => {
    const { run } = executor();
    const core = textOf(await run('read_me', {}));
    expect(core).toContain('sendPrompt(text)');
    expect(core).toContain('--c1 to --c6');
    expect(core).not.toContain('## Module: chart');
    const more = textOf(await run('read_me', { modules: ['chart', 'diagram'], platform: 'mobile' }));
    expect(more).toContain('## Module: chart');
    expect(more).toContain('## Module: diagram');
    expect(more).toContain('## Platform: mobile');
  });
});

describe('display cards', () => {
  const valid: Record<string, unknown> = {
    chart_display_v0: { style: 'bar', series: [{ values: [1, 2] }], x_axis: { data: ['a', 'b'] } },
    comparison_card_display_v0: {
      products: [
        { name: 'A', attributes: [{ label: 'x', value: '1' }, { label: 'y', value: '2' }] },
        { name: 'B', attributes: [{ label: 'x', value: '3' }, { label: 'y', value: '4' }] },
      ],
      summary: 'A vs B',
    },
    featured_card_display_v0: { products: [{ name: 'Espresso One', blurb: 'Why.' }], summary: 'Best pick' },
    itinerary_display_v0: { days: [{ day_label: 'Day 1', stops: [{ name: 'Museum' }] }], summary: 'Trip' },
    link_preview_display_v0: { links: [{ url: 'https://example.com', title: 'Example' }], summary: 'Reading' },
    message_compose_v1: { kind: 'email', variants: [{ label: 'Polite decline', subject: 'Re: x', body: 'No, thanks.' }] },
    options_card_display_v0: {
      options: [
        { title: 'Rest', description: 'd', bullets: ['a', 'b'] },
        { title: 'Ice', description: 'd', bullets: ['a', 'b'] },
      ],
      summary: 'Knee options',
    },
    places_list_display_v0: { places: [{ name: 'Cafe Uno' }], summary: 'Cafes' },
    product_carousel_display_v0: { products: [{ name: 'Desk A' }, { name: 'Desk B' }], summary: 'Desks' },
    quiz_display_v0: {
      title: 'Quiz',
      summary: 'Quiz',
      questions: [
        { id: 'q1', question_type: 'multiple_choice', prompt: '1+1?', options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }], correct_option_id: 'a', explanation: 'Sum.' },
      ],
    },
    recipe_display_v0: {
      title: 'Toast',
      ingredients: [{ id: '0001', name: 'bread slices', amount: 2 }],
      steps: [{ id: 's1', title: 'Toast', content: 'Toast {0001}.', timer_seconds: 120 }],
    },
    step_card_display_v0: { steps: [{ title: 'Unplug', description: 'd' }, { title: 'Wait', description: 'd' }], summary: 'Reset' },
    translation_display_v0: {
      source_text: 'Hello',
      source_language: 'English',
      translation: 'Hola',
      target_language: 'Spanish',
      target_lang: 'es',
      summary: 'Hello in Spanish',
    },
  };

  it('has a valid example for every card, and draws each as a display block keyed by its call', async () => {
    expect(Object.keys(valid).sort()).toEqual([...DISPLAY_TOOL_NAMES].sort());
    for (const [name, input] of Object.entries(valid)) {
      const { run, blocks } = executor();
      const res = await run(name, input, `id-${name}`);
      expect(res.ok, `${name}: ${JSON.stringify(res.content)}`).toBe(true);
      expect(dataOf(res)).toEqual({ status: 'shown' });
      expect(blocks).toEqual([{ blockId: `display_id-${name}`, sequence: 1, type: 'display', tool: name, data: input }]);
    }
  });

  it('refuses a card it cannot draw truthfully, with the reason', async () => {
    const { run, blocks } = executor();
    const cases: Array<[string, unknown, string]> = [
      ['chart_display_v0', { style: 'scatter', series: [{ values: [1] }] }, 'needs points'],
      ['quiz_display_v0', { ...(valid.quiz_display_v0 as object), questions: [{ ...(valid.quiz_display_v0 as { questions: object[] }).questions[0], correct_option_id: 'z' }] }, 'correct_option_id'],
      ['recipe_display_v0', { ...(valid.recipe_display_v0 as object), steps: [{ id: 's', title: 't', content: 'Add {0009}.' }] }, '{0009}'],
      ['link_preview_display_v0', { links: [{ url: 'javascript:alert(1)', title: 'x' }], summary: 's' }, 'http(s)'],
      ['featured_card_display_v0', { products: [{ name: 'A', url: 'ftp://x' }], summary: 's' }, 'http(s)'],
      ['comparison_card_display_v0', { products: [(valid.comparison_card_display_v0 as { products: object[] }).products[0]], summary: 's' }, 'products'],
    ];
    for (const [name, input, reason] of cases) {
      const res = await run(name, input);
      expect(res.ok, name).toBe(false);
      expect(textOf(res), name).toContain(reason);
    }
    expect(blocks).toEqual([]);
  });

  it('adds photos found by each item\'s name when image search is live, and keeps the card when it fails', async () => {
    const searched: string[] = [];
    const images: WebSearchAdapter = {
      name: 'fake',
      isLive: true,
      search: async () => [],
      searchImages: async (q, n) => {
        searched.push(`${q}:${n}`);
        if (q === 'Desk B') throw new Error('quota');
        return [{ title: q, imageUrl: `https://img/${q}`, thumbnailUrl: `https://t/${q}`, sourceUrl: `https://s/${q}` }];
      },
    };
    const { run, blocks } = executor(images);
    const res = await run('product_carousel_display_v0', valid.product_carousel_display_v0);
    expect(searched).toEqual(['Desk A:3', 'Desk B:3']);
    const photos = [[{ title: 'Desk A', imageUrl: 'https://img/Desk A', thumbnailUrl: 'https://t/Desk A', sourceUrl: 'https://s/Desk A' }], []];
    expect(dataOf(res)).toEqual({ status: 'shown', photos });
    expect((blocks[0] as unknown as { data: { photos: unknown } }).data.photos).toEqual(photos);

    // No live provider: the card is drawn without photos, and nothing is searched.
    const off = executor({ ...images, isLive: false });
    await off.run('places_list_display_v0', valid.places_list_display_v0);
    expect(searched).toHaveLength(2);
    expect((off.blocks[0] as unknown as { data: Record<string, unknown> }).data.photos).toBeUndefined();
  });
});
