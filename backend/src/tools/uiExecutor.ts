/**
 * show_widget, read_me and the display cards (ADR-0048).
 *
 * show_widget's code becomes one visual block, drawn only in the client's script-only sandbox
 * (ADR-0035). A display card becomes a `display` block the client draws natively from the call's
 * arguments. Both stream as `ui_block` events through `onBlock`, so they sit in the reply where
 * the call was made.
 */
import { z } from 'zod';

import type { ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';
import type { AuthorizationContext, UIAuthorizer } from '../services/ui/authorizer.js';
import type { UIBlock, UIResponseV1 } from '../services/ui/types.js';
import { validateAndNormalizeUI } from '../services/ui/validator.js';
import { visualizeGuide, type VisualizeModule } from '../services/ui/visualizeGuide.js';
import type { ImageSearchResultItem, WebSearchAdapter } from '../services/webSearch.js';
import { DISPLAY_TOOL_NAMES } from './displayDefinitions.js';

const text = (toolCallId: string, ok: boolean, t: string): ToolResult => ({ toolCallId, ok, content: [{ type: 'text', text: t }] });

const showWidgetInput = z.object({
  title: z.string().trim().min(1),
  widget_code: z.string().min(1),
  loading_messages: z.array(z.string()).max(4).optional(),
});

const readMeInput = z.object({
  modules: z.array(z.string()).optional(),
  platform: z.string().optional(),
});

/* ----------------------------------------------------------------------- display card checks */

const https = z.string().regex(/^https?:\/\//i, 'must be an absolute http(s) URL');
const product = z.object({ name: z.string().min(1), price: z.string().optional(), url: https.optional(), blurb: z.string().optional() });
const summary = z.string().min(1);

/** What each card needs to be drawn. The declared schemas say the same; this is the server's check. */
const DISPLAY_INPUTS: Record<string, z.ZodType> = {
  chart_display_v0: z
    .object({
      style: z.enum(['line', 'bar', 'scatter']),
      title: z.string().optional(),
      series: z
        .array(
          z.object({
            name: z.string().optional(),
            color: z.string().optional(),
            values: z.array(z.number()).max(2000).optional(),
            points: z.array(z.object({ x: z.number(), y: z.number() })).max(2000).optional(),
          }),
        )
        .min(1)
        .max(12),
      x_axis: z.record(z.string(), z.unknown()).optional(),
      y_axis: z.record(z.string(), z.unknown()).optional(),
    })
    .superRefine((v, ctx) => {
      for (const [i, s] of v.series.entries()) {
        const ok = v.style === 'scatter' ? !!s.points?.length : !!s.values?.length;
        if (!ok) ctx.addIssue({ code: 'custom', message: `series[${i}] needs ${v.style === 'scatter' ? 'points' : 'values'} for a ${v.style} chart` });
      }
    }),
  comparison_card_display_v0: z.object({
    products: z
      .array(product.omit({ blurb: true }).extend({ attributes: z.array(z.object({ label: z.string(), value: z.string() })).min(2).max(8) }))
      .min(2)
      .max(3),
    summary,
  }),
  featured_card_display_v0: z.object({ products: z.array(product).length(1), summary }),
  product_carousel_display_v0: z.object({ products: z.array(product).min(1).max(6), summary }),
  itinerary_display_v0: z.object({
    title: z.string().optional(),
    days: z
      .array(
        z.object({
          day_label: z.string().min(1),
          stops: z.array(z.object({ name: z.string().min(1), time: z.string().optional(), blurb: z.string().optional() })).min(1).max(12),
        }),
      )
      .min(1)
      .max(7),
    summary,
  }),
  link_preview_display_v0: z.object({
    links: z
      .array(z.object({ url: https, title: z.string().min(1), domain: z.string().optional(), snippet: z.string().optional() }))
      .min(1)
      .max(6),
    summary,
  }),
  message_compose_v1: z.object({
    kind: z.enum(['email', 'textMessage', 'other']),
    summary_title: z.string().optional(),
    variants: z.array(z.object({ label: z.string().min(1), subject: z.string().optional(), body: z.string().min(1) })).min(1),
  }),
  options_card_display_v0: z.object({
    title: z.string().optional(),
    options: z
      .array(z.object({ title: z.string().min(1), description: z.string().min(1), bullets: z.array(z.string()).min(2).max(8) }))
      .min(2)
      .max(8),
    summary,
  }),
  places_list_display_v0: z.object({
    places: z
      .array(z.object({ name: z.string().min(1), description: z.string().optional(), tips: z.array(z.string()).max(3).optional() }))
      .min(1)
      .max(8),
    summary,
  }),
  quiz_display_v0: z
    .object({
      title: z.string().min(1),
      description: z.string().optional(),
      initial_mode: z.enum(['quiz', 'flashcards']).optional(),
      questions: z
        .array(
          z.object({
            id: z.string().min(1),
            question_type: z.literal('multiple_choice'),
            prompt: z.string().min(1),
            options: z.array(z.object({ id: z.string().min(1), text: z.string().min(1) })).min(2),
            correct_option_id: z.string().min(1),
            explanation: z.string().min(1),
            hint: z.string().optional(),
            correct_feedback: z.string().optional(),
            incorrect_feedback: z.string().optional(),
          }),
        )
        .min(1),
      summary,
    })
    .superRefine((v, ctx) => {
      for (const q of v.questions) {
        if (!q.options.some((o) => o.id === q.correct_option_id)) {
          ctx.addIssue({ code: 'custom', message: `question ${q.id}: correct_option_id "${q.correct_option_id}" is not one of its option ids` });
        }
      }
    }),
  recipe_display_v0: z
    .object({
      title: z.string().min(1),
      description: z.string().optional(),
      base_servings: z.number().int().positive().optional(),
      ingredients: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            amount: z.number(),
            unit: z.enum(['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz', 'oz', 'lb', 'pinch']).optional(),
          }),
        )
        .min(1),
      steps: z
        .array(z.object({ id: z.string().min(1), title: z.string().min(1), content: z.string().min(1), timer_seconds: z.number().int().positive().optional() }))
        .min(1),
      notes: z.string().optional(),
    })
    .superRefine((v, ctx) => {
      const ids = new Set(v.ingredients.map((i) => i.id));
      for (const s of v.steps) {
        for (const m of s.content.matchAll(/\{([^{}]+)\}/g)) {
          if (!ids.has(m[1]!)) ctx.addIssue({ code: 'custom', message: `step ${s.id} refers to {${m[1]}}, which is no ingredient id` });
        }
      }
    }),
  step_card_display_v0: z.object({
    steps: z.array(z.object({ title: z.string().min(1), description: z.string().min(1) })).min(2).max(8),
    view: z.enum(['stepper', 'list']).optional(),
    summary,
  }),
  translation_display_v0: z.object({
    source_text: z.string().min(1),
    source_language: z.string().min(1),
    source_lang: z.string().optional(),
    translation: z.string().min(1),
    target_language: z.string().min(1),
    target_lang: z.string().min(1),
    pronunciation: z.string().optional(),
    summary,
  }),
};

/** Cards whose items get photos found by name, and how many each (the reference adds them itself). */
const PHOTOS: Record<string, { list: string; per: number }> = {
  featured_card_display_v0: { list: 'products', per: 3 },
  product_carousel_display_v0: { list: 'products', per: 3 },
  places_list_display_v0: { list: 'places', per: 3 },
};

export type Photo = Pick<ImageSearchResultItem, 'thumbnailUrl' | 'imageUrl' | 'sourceUrl' | 'title'>;

export class UIToolExecutor implements ToolExecutor {
  constructor(
    private readonly authorizer: UIAuthorizer,
    private readonly authCtx: AuthorizationContext,
    private readonly maxResponseBytes: number,
    private readonly onBlock?: (block: UIBlock) => void,
    /** The configured image search, for the photos of product and place cards. */
    private readonly images?: WebSearchAdapter,
  ) {}

  async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    if (call.name === 'read_me') return this.readMe(call);
    if (call.name === 'show_widget') return this.showWidget(call);
    if (DISPLAY_TOOL_NAMES.includes(call.name)) return this.display(call, signal);
    return text(call.id, false, `Unknown tool "${call.name}".`);
  }

  private readMe(call: ToolCall): ToolResult {
    const parsed = readMeInput.safeParse(call.input ?? {});
    if (!parsed.success) return text(call.id, false, `Invalid input: ${parsed.error.message}`);
    return text(call.id, true, visualizeGuide(parsed.data.modules as VisualizeModule[] | undefined, parsed.data.platform));
  }

  private async showWidget(call: ToolCall): Promise<ToolResult> {
    const parsed = showWidgetInput.safeParse(call.input);
    if (!parsed.success) return text(call.id, false, `Invalid show_widget input: ${parsed.error.message}`);
    const result = validateAndNormalizeUI(
      { blocks: [{ type: 'visual', title: parsed.data.title, html: parsed.data.widget_code }] },
      this.maxResponseBytes,
    );
    if (!result.ok) {
      return text(call.id, false, `The visual could not be drawn${result.code ? ` (${result.code})` : ''}: ${result.error}`);
    }
    const authorized = await this.authorizer.filterAuthorizedUI(result.data, this.authCtx);
    for (const block of authorized.blocks) this.onBlock?.(block);
    return { toolCallId: call.id, ok: true, content: [{ type: 'json', data: withoutVisualHtml(authorized) }] };
  }

  private async display(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const parsed = DISPLAY_INPUTS[call.name]!.safeParse(call.input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
      return text(call.id, false, `Invalid ${call.name} input: ${issues}`);
    }
    const data = parsed.data as Record<string, unknown>;
    const photos = await this.photosFor(call.name, data, signal);
    this.onBlock?.(displayBlock(call.id, call.name, data, photos));
    return { toolCallId: call.id, ok: true, content: [{ type: 'json', data: { status: 'shown', ...(photos ? { photos } : {}) } }] };
  }

  /** One list of photos per item, found by the item's name. None when there is no live provider. */
  private async photosFor(tool: string, data: Record<string, unknown>, signal: AbortSignal): Promise<Photo[][] | undefined> {
    const spec = PHOTOS[tool];
    if (!spec || !this.images?.isLive || !this.images.searchImages) return undefined;
    const items = data[spec.list] as { name: string }[];
    const found = await Promise.all(
      items.map((item) =>
        this.images!.searchImages!(item.name, spec.per, signal)
          .then((imgs) => imgs.slice(0, spec.per).map(({ thumbnailUrl, imageUrl, sourceUrl, title }) => ({ thumbnailUrl, imageUrl, sourceUrl, title })))
          // benign: A card without photos is still the answer; a failed photo search is not the model's to handle.
          .catch(() => [] as Photo[]),
      ),
    );
    return found;
  }
}

/** The block a display call draws. A reload builds the same block from the stored call and result. */
export function displayBlock(toolCallId: string, tool: string, data: Record<string, unknown>, photos?: Photo[][]): UIBlock {
  return { blockId: `display_${toolCallId}`, sequence: 1, type: 'display', tool, data: photos ? { ...data, photos } : data };
}

/**
 * The result the model gets back, and history replays: a visual's HTML is already in the
 * model's own call, so the result carries only its size (ADR-0035). The client restores the
 * HTML from the call input on reload.
 */
export function withoutVisualHtml(response: UIResponseV1): UIResponseV1 {
  return {
    ...response,
    blocks: response.blocks.map((b) =>
      b.type === 'visual' && typeof b.html === 'string'
        ? { blockId: b.blockId, sequence: b.sequence, type: b.type, title: b.title, htmlBytes: Buffer.byteLength(b.html, 'utf8') }
        : b,
    ),
  };
}
