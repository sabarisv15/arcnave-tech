/**
 * Display cards (ADR-0048): native cards the chat draws from the model's arguments, one tool per
 * card, as the reference app has them. Their schemas follow the reference's field for field; the
 * descriptions are ArcNave's. Schemas stay plain JSON Schema (no $ref, anyOf or null types) so
 * both providers accept them. `places_map_display_v0` is not here: it needs a place search and a
 * map service ArcNave does not have.
 */
import type { ToolDefinition } from '../providers/types.js';

const SUMMARY = {
  type: 'string',
  description:
    'One short sentence (under 15 words) naming what the card shows, read when the card cannot be drawn. ' +
    'Do not repeat the card\'s values. Write it last.',
};

const str = (description: string) => ({ type: 'string', description });

const PRODUCT = {
  type: 'object',
  properties: {
    name: str('Product name (a few words).'),
    price: str("Display price with currency, e.g. '$549'. Omit when not applicable or unknown."),
    url: str("Absolute https URL of the product page. Omit when you do not have a real one; never make one up."),
    blurb: str('Up to a paragraph on why it fits and its trade-offs. Do not restate the name or price.'),
  },
  required: ['name'],
  additionalProperties: false,
};

export const CHART_DISPLAY: ToolDefinition = {
  name: 'chart_display_v0',
  description:
    'Draws a simple line, bar or scatter chart in the chat, natively. Use it for a quick standard chart of a small ' +
    'dataset already in the conversation or that you just computed or looked up: a trend over time, a comparison ' +
    'across a few categories, or two numeric variables against each other. Typical asks: "plot", "chart" or "graph" ' +
    'these numbers; a short table that reads better as a chart; how a quantity changed over a period.\n\n' +
    'Prefer it over show_widget for these plain charts: it renders at once and needs no code. Use show_widget or a ' +
    'file instead for anything it cannot draw: pie, donut, stacked or area charts, annotations, several panels, ' +
    'interactivity beyond tooltips, custom styling, maps or diagrams, very large datasets, or a chart the user ' +
    'wants to download. Never draw the same chart with both.\n\n' +
    'Line and bar charts plot each series\' "values" against the labels in "x_axis.data", one label per value, in ' +
    'order. Scatter charts use per-series "points". At most 12 series and 2,000 points per series; ideally 6 series ' +
    'or fewer. "y_axis.scale": "log" is supported; axis min/max bound line and scatter charts (bars start at zero). ' +
    'Give a short title, an axis title for units when it helps, and a name per series when there are several. Never ' +
    'let colour alone carry meaning.\n\n' +
    'Do not use it when a sentence or small table answers, for a single number, or when you would have to invent ' +
    'or estimate the data. After it, state the key takeaway in a sentence or two instead of restating the points.',
  inputSchema: {
    type: 'object',
    properties: {
      style: { type: 'string', enum: ['line', 'bar', 'scatter'], description: 'Required. The kind of chart.' },
      title: str('Optional. Shown above the chart.'),
      series: {
        type: 'array',
        description: 'Required. One or more data series.',
        items: {
          type: 'object',
          properties: {
            name: str('Optional. The series name; given, a legend is drawn.'),
            color: str('Optional hex colour, only when the data has a meaningful colour.'),
            values: {
              type: 'array',
              items: { type: 'number' },
              description: 'The values of a line or bar series, one per x label. Omit for scatter.',
            },
            points: {
              type: 'array',
              description: 'The points of a scatter series. Omit for line and bar.',
              items: {
                type: 'object',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
                required: ['x', 'y'],
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
      x_axis: axis('horizontal'),
      y_axis: axis('vertical'),
    },
    required: ['series', 'style'],
    additionalProperties: false,
  },
};

function axis(which: string) {
  return {
    type: 'object',
    description: `Optional. Settings for the ${which} axis.`,
    properties: {
      data: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional labels, one per value of every series (dates, names, buckets).',
      },
      title: str('Optional. The axis title, usually its units. Only when needed to read the chart.'),
      min: { type: 'number', description: 'Optional lower bound.' },
      max: { type: 'number', description: 'Optional upper bound.' },
      scale: { type: 'string', enum: ['linear', 'log'], description: 'Optional. Defaults to linear.' },
      format: str('Optional format for tick labels. Some views ignore it.'),
    },
    additionalProperties: false,
  };
}

export const COMPARISON_CARD_DISPLAY: ToolDefinition = {
  name: 'comparison_card_display_v0',
  description:
    'Shows 2 or 3 products side by side, with attribute rows lined up. Use it for shopping questions weighing a few ' +
    'named options on the same criteria ("iPad Air vs iPad Pro", "compare these three monitors").\n\n' +
    'Do not use it for one product (featured_card_display_v0) or more than three (product_carousel_display_v0); ' +
    'when the options share no comparable attributes; when the user wants one recommendation with reasoning; or ' +
    'for approaches or plans rather than things to buy.\n\n' +
    'Use the same attribute labels in the same order for every product so the rows line up. Do not repeat the ' +
    'products or values in your text.',
  inputSchema: {
    type: 'object',
    properties: {
      products: {
        type: 'array',
        minItems: 2,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            name: str('Product or option name (a few words).'),
            price: str("Display price with currency, e.g. '$1,099'. Omit when not applicable or unknown."),
            url: str("Absolute https URL of the product page. Omit when you do not have a real one; never make one up."),
            attributes: {
              type: 'array',
              minItems: 2,
              maxItems: 8,
              items: {
                type: 'object',
                properties: {
                  label: str("Short attribute name ('Display', 'Battery'). The same labels, in the same order, for every product."),
                  value: str("This product's value for the attribute."),
                },
                required: ['label', 'value'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'attributes'],
          additionalProperties: false,
        },
      },
      summary: SUMMARY,
    },
    required: ['products', 'summary'],
    additionalProperties: false,
  },
};

export const FEATURED_CARD_DISPLAY: ToolDefinition = {
  name: 'featured_card_display_v0',
  description:
    'Shows your single best product pick as one rich card: name, optional price, and why it is the pick. Use it ' +
    'for shopping questions with one clear answer ("the best entry-level espresso machine", "just tell me which ' +
    'one to get").\n\n' +
    'Do not use it when the user wants several to browse (product_carousel_display_v0), is weighing named options ' +
    'on shared criteria (comparison_card_display_v0), or when the blurb would only restate the name or it is not ' +
    'something to buy.\n\n' +
    'The blurb can run to a paragraph: why this is the pick and its trade-offs. Do not describe the product again ' +
    'in your text. Photos are added for you: never pass image URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      products: { type: 'array', minItems: 1, maxItems: 1, items: PRODUCT },
      summary: SUMMARY,
    },
    required: ['products', 'summary'],
    additionalProperties: false,
  },
};

export const PRODUCT_CAROUSEL_DISPLAY: ToolDefinition = {
  name: 'product_carousel_display_v0',
  description:
    'Shows products one per page, each with photos, name, price and a short blurb. Use it for shopping questions ' +
    'where the user wants to look at a handful of recommendations one at a time ("walk me through 3 good ' +
    'espresso machines", "show me a few standing desks").\n\n' +
    'Do not use it for a single best pick (featured_card_display_v0), for named options weighed on shared ' +
    'criteria (comparison_card_display_v0), or when the blurb would only restate the name or it is not something ' +
    'to buy.\n\n' +
    'Each blurb can run to a paragraph: why it fits and its trade-offs. Do not list the products again in your ' +
    'text. Photos are added for you: never pass image URLs.',
  inputSchema: {
    type: 'object',
    properties: {
      products: { type: 'array', minItems: 1, maxItems: 6, items: PRODUCT },
      summary: SUMMARY,
    },
    required: ['products', 'summary'],
    additionalProperties: false,
  },
};

export const ITINERARY_DISPLAY: ToolDefinition = {
  name: 'itinerary_display_v0',
  description:
    'Shows a day-by-day trip with a tab per day and the stops of each day. Use it for trip planning where the ' +
    'answer is an ordered schedule over one or more days, each with at least one named stop ("3 days in Lisbon", ' +
    '"plan a weekend in Kyoto").\n\n' +
    'Do not use it for a single place or a flat list of places with no days (places_list_display_v0); for more ' +
    'than 7 days or more than 12 stops in a day (summarise in text); for general travel advice (visas, packing, ' +
    'budget); or when the stops have no meaningful order.\n\n' +
    'Keep each blurb to one short line and day labels under about 12 characters. Do not list the itinerary again ' +
    'in your text.',
  inputSchema: {
    type: 'object',
    properties: {
      title: str("Short heading for the trip ('3 days in Tokyo'). One line."),
      days: {
        type: 'array',
        minItems: 1,
        maxItems: 7,
        items: {
          type: 'object',
          properties: {
            day_label: str("Tab label: 'Day 1', 'Sat 14 Jun'. Under 12 characters."),
            stops: {
              type: 'array',
              minItems: 1,
              maxItems: 12,
              items: {
                type: 'object',
                properties: {
                  name: str('The place or activity (a few words).'),
                  time: str("Optional. A time or a rough slot ('9:00 AM', 'Afternoon')."),
                  blurb: str('Optional. One short line on what to do or expect.'),
                },
                required: ['name'],
                additionalProperties: false,
              },
            },
          },
          required: ['day_label', 'stops'],
          additionalProperties: false,
        },
      },
      summary: SUMMARY,
    },
    required: ['days', 'summary'],
    additionalProperties: false,
  },
};

export const LINK_PREVIEW_DISPLAY: ToolDefinition = {
  name: 'link_preview_display_v0',
  description:
    'Shows 1 to 6 web links as preview cards with title, site and an optional snippet. Use it for outside pages ' +
    'the user should open: search results, citations or further reading that back your answer ("find me ' +
    'articles on X", "where can I read more").\n\n' +
    'Do not use it for content in the chat itself, for one incidental link (put it in the text), for more than ' +
    'six (pick the best six), or for any entry without a real absolute http(s) URL: never make up a link; drop ' +
    'that entry.\n\n' +
    'Keep titles to one line and snippets to one or two sentences. Do not list the URLs again in your text.',
  inputSchema: {
    type: 'object',
    properties: {
      links: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            url: str('Absolute http(s) URL the card opens.'),
            title: str('Page title (one line, under about 80 characters).'),
            domain: str("Optional site name ('Wirecutter'). Taken from the URL when omitted."),
            snippet: str('Optional one or two sentences on why the link is relevant.'),
          },
          required: ['url', 'title'],
          additionalProperties: false,
        },
      },
      summary: SUMMARY,
    },
    required: ['links', 'summary'],
    additionalProperties: false,
  },
};

export const MESSAGE_COMPOSE: ToolDefinition = {
  name: 'message_compose_v1',
  description:
    'Drafts a message (email, chat message or text) for the user to send. Work out the situation (a work ' +
    'disagreement, negotiating, following up, bad news, asking, setting a boundary, apologising, declining, ' +
    'feedback, cold outreach, delegating, celebrating) and what is at stake in the relationship.\n\n' +
    'When it is high-stakes, ambiguous or has competing goals, give 2 or 3 variants that lead to different ' +
    'outcomes, not just different tones, each labelled by its goal ("Disagree and commit" vs "Push for ' +
    'alignment", "Gentle nudge" vs "Create urgency"). When it is transactional or needs only wording help, give ' +
    'one. Emails get a subject line. Match the channel: emails longer and more formal, chat short, texts brief.\n\n' +
    'The card shows each draft in full with copy and open buttons, so do not repeat the drafts in your reply; add ' +
    'at most a sentence or two on how the variants differ or what to adjust.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['email', 'textMessage', 'other'],
        description: "'email' shows a subject and an open-in-mail button; 'textMessage' an open-in-messages button; 'other' neither.",
      },
      summary_title: str('A short title for the message.'),
      variants: {
        type: 'array',
        minItems: 1,
        description: 'The drafts, one per approach.',
        items: {
          type: 'object',
          properties: {
            label: str("2 to 4 word goal-oriented label: 'Hold firm', 'Suggest alternative', 'Polite decline'."),
            subject: str("Email subject (only for kind 'email')."),
            body: str('The message.'),
          },
          required: ['label', 'body'],
          additionalProperties: false,
        },
      },
    },
    required: ['kind', 'variants'],
    additionalProperties: false,
  },
};

export const OPTIONS_CARD_DISPLAY: ToolDefinition = {
  name: 'options_card_display_v0',
  description:
    'Shows a set of distinct approaches the user could take, each with concrete next steps. Use it for personal ' +
    'health questions where the answer is 2 to 6 alternatives ("what can I do about mild knee pain"). Every option ' +
    'needs a one or two sentence description and at least two actionable bullets.\n\n' +
    'Do not use it for one nuanced recommendation, for options that need explaining more than doing, for an A-vs-B ' +
    'comparison, for a diagnosis question, or outside health.\n\n' +
    'Keep bullets to one short line. The card carries its own not-medical-advice note: do not add a disclaimer, and ' +
    'do not list the options again in your text.',
  inputSchema: {
    type: 'object',
    properties: {
      title: str('Short heading for the set (one line).'),
      options: {
        type: 'array',
        minItems: 2,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            title: str('Name of the option (a few words).'),
            description: str('One or two sentences on what it is and when it helps. Do not restate the bullets.'),
            bullets: {
              type: 'array',
              minItems: 2,
              maxItems: 8,
              items: { type: 'string' },
              description: 'Concrete next steps, one short line each. At least two.',
            },
          },
          required: ['title', 'description', 'bullets'],
          additionalProperties: false,
        },
      },
      summary: SUMMARY,
    },
    required: ['options', 'summary'],
    additionalProperties: false,
  },
};

export const PLACES_LIST_DISPLAY: ToolDefinition = {
  name: 'places_list_display_v0',
  description:
    'Shows a list of places, each with photos and a short description. Use it when the answer is a set of 2 to 8 ' +
    'specific places to visit (cafes, hikes, neighbourhoods, hotels) and photos help ("good ramen spots in ' +
    'Shibuya", "best beaches near Lisbon"). Only for places you found by web search or already know.\n\n' +
    'Do not use it for a day-by-day plan (itinerary_display_v0) or a single place (write it in text).\n\n' +
    'Pass each place\'s name and description; photos are added from the names, so never pass image URLs. A ' +
    'description can run to a paragraph: what it is like, what to order or do, when to go. Do not list the places ' +
    'again in your text.',
  inputSchema: {
    type: 'object',
    properties: {
      places: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            name: str('Name of the place (a few words).'),
            description: str('Optional. What to do or expect there.'),
            tips: {
              type: 'array',
              maxItems: 3,
              items: { type: 'string' },
              description: "Optional. Up to three very short (2 to 4 word) labels: 'Book ahead', 'Go for sunset'.",
            },
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      summary: SUMMARY,
    },
    required: ['places', 'summary'],
    additionalProperties: false,
  },
};

export const QUIZ_DISPLAY: ToolDefinition = {
  name: 'quiz_display_v0',
  description:
    'Shows an interactive multiple-choice quiz as a card; the same questions can be flipped through as flashcards ' +
    '(question on the front, answer and explanation on the back). Use it when the user asks for a quiz, practice ' +
    'questions or a self-test, including on documents or notes they shared. Each question needs plausible wrong ' +
    'answers, a short explanation of why the right one is right, and optionally a hint. Default to 5 questions ' +
    'unless asked for a number. Give each question its own short correct_feedback and incorrect_feedback labels ' +
    'when you can; defaults cover any that lack them.',
  inputSchema: {
    type: 'object',
    properties: {
      title: str("Quiz title ('Photosynthesis basics')."),
      description: str('Optional one line on what it covers.'),
      initial_mode: {
        type: 'string',
        enum: ['quiz', 'flashcards'],
        description: "Which view opens first: 'quiz' (default, graded one at a time) or 'flashcards'.",
      },
      questions: {
        type: 'array',
        minItems: 1,
        description: 'The questions, in order.',
        items: {
          type: 'object',
          properties: {
            id: str("Unique id within the quiz ('q1')."),
            question_type: { type: 'string', enum: ['multiple_choice'], description: 'Only multiple_choice.' },
            prompt: str('The question.'),
            options: {
              type: 'array',
              minItems: 2,
              description: 'The answer choices.',
              items: {
                type: 'object',
                properties: { id: str("Short id within the question ('a')."), text: str('The answer text.') },
                required: ['id', 'text'],
                additionalProperties: false,
              },
            },
            correct_option_id: str("The correct option's id; must be one of this question's option ids."),
            explanation: str('Why the correct answer is right, shown after answering.'),
            hint: str('Optional hint shown on request, nudging without giving the answer away.'),
            correct_feedback: str("Optional short bold label for a right answer ('Exactly')."),
            incorrect_feedback: str("Optional short bold label for a wrong answer ('Not quite')."),
          },
          required: ['id', 'question_type', 'prompt', 'options', 'correct_option_id', 'explanation'],
          additionalProperties: false,
        },
      },
      summary: str('One short phrase (under 45 characters) naming what the card holds.'),
    },
    required: ['questions', 'summary', 'title'],
    additionalProperties: false,
  },
};

export const RECIPE_DISPLAY: ToolDefinition = {
  name: 'recipe_display_v0',
  description:
    'Shows an interactive recipe whose servings the user can change, scaling every amount. Use it when the user ' +
    'asks for a recipe, cooking instructions or how to prepare a dish.',
  inputSchema: {
    type: 'object',
    properties: {
      title: str("The dish ('Spaghetti alla carbonara')."),
      description: str('Optional short description.'),
      base_servings: { type: 'integer', description: 'Servings at the given amounts. Defaults to 4.' },
      ingredients: {
        type: 'array',
        description: 'The ingredients with amounts.',
        items: {
          type: 'object',
          properties: {
            id: str("4-character id referenced from steps ('0001')."),
            name: str("Display name; put a counting noun here for whole items ('garlic cloves', 'large eggs')."),
            amount: { type: 'number', description: 'The quantity at base_servings.' },
            unit: {
              type: 'string',
              enum: ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz', 'oz', 'lb', 'pinch'],
              description: 'Omit for whole items. Give seasonings a real starting amount in tsp.',
            },
          },
          required: ['amount', 'id', 'name'],
          additionalProperties: false,
        },
      },
      steps: {
        type: 'array',
        description: 'The instructions. Write {ingredient_id} to show an ingredient\'s scaled amount inline.',
        items: {
          type: 'object',
          properties: {
            id: str('Unique id for the step.'),
            title: str("Short summary ('Boil pasta'); also the timer label."),
            content: str("The full instruction, e.g. 'Whisk {0001} and {0002}'."),
            timer_seconds: {
              type: 'integer',
              description: 'Seconds, for any step that involves waiting (cooking, baking, resting, chilling). Omit for hands-on steps.',
            },
          },
          required: ['content', 'id', 'title'],
          additionalProperties: false,
        },
      },
      notes: str('Optional tips or variations.'),
    },
    required: ['ingredients', 'steps', 'title'],
    additionalProperties: false,
  },
};

export const STEP_CARD_DISPLAY: ToolDefinition = {
  name: 'step_card_display_v0',
  description:
    'Shows a numbered walkthrough for fixing or setting something up. Use it for how-to and tech-support questions ' +
    'answered in 3 to 8 ordered steps, each with a short title and a description ("reset my router", "set up ' +
    'two-factor on GitHub").\n\n' +
    'Do not use it for a single step or setting, for advice or background that is not a procedure, for choices ' +
    'between options, when order does not matter or steps would be filler, or for coding tasks where the user ' +
    'wants the code.\n\n' +
    'Step titles are a few imperative words, without "Step 1:"; a description can be a short paragraph, enough to ' +
    'do the step without guessing. Do not list the steps again in your text.',
  inputSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        minItems: 2,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            title: str('The step in a few imperative words.'),
            description: str('How to do it and why, enough to follow without guessing.'),
          },
          required: ['title', 'description'],
          additionalProperties: false,
        },
      },
      view: {
        type: 'string',
        enum: ['stepper', 'list'],
        description: "'stepper' (default) shows one step at a time, for steps done in order; 'list' shows all at once.",
      },
      summary: SUMMARY,
    },
    required: ['steps', 'summary'],
    additionalProperties: false,
  },
};

export const TRANSLATION_DISPLAY: ToolDefinition = {
  name: 'translation_display_v0',
  description:
    'Shows a translation card when the user asks how to say, write or translate a short passage (a message, ' +
    'sentence, phrase or a few lines) into another language: the original and the translation side by side, with ' +
    'copy and edit. Do not repeat the translation in your reply; afterwards add a sentence or two of nuance only ' +
    '(register, a regional note, what to change for another tone). Not for single-word lookups, long documents or ' +
    'files, or grammar explanations.',
  inputSchema: {
    type: 'object',
    properties: {
      source_text: str('The text being translated, as the user gave it (lightly cleaned, no quotes).'),
      source_language: str("The source language's name, in the conversation's language ('English')."),
      source_lang: str("BCP-47 tag of the source ('en')."),
      translation: str('The translation, in the register that fits. Plain text, no romanisation.'),
      target_language: str("The target language's name, in the conversation's language, with region when it matters."),
      target_lang: str("BCP-47 tag of the translation ('ja', 'es-MX')."),
      pronunciation: str('Romanisation (romaji, pinyin with tones) when the target script is not Latin.'),
      summary: SUMMARY,
    },
    required: ['source_language', 'source_text', 'summary', 'target_lang', 'target_language', 'translation'],
    additionalProperties: false,
  },
};

export const DISPLAY_TOOL_DEFINITIONS: ToolDefinition[] = [
  CHART_DISPLAY,
  COMPARISON_CARD_DISPLAY,
  FEATURED_CARD_DISPLAY,
  ITINERARY_DISPLAY,
  LINK_PREVIEW_DISPLAY,
  MESSAGE_COMPOSE,
  OPTIONS_CARD_DISPLAY,
  PLACES_LIST_DISPLAY,
  PRODUCT_CAROUSEL_DISPLAY,
  QUIZ_DISPLAY,
  RECIPE_DISPLAY,
  STEP_CARD_DISPLAY,
  TRANSLATION_DISPLAY,
];

export const DISPLAY_TOOL_NAMES = DISPLAY_TOOL_DEFINITIONS.map((d) => d.name);
