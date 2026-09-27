import { z } from 'zod';
import type { ToolDefinition, ToolExecutor } from '../providers/types.js';

export const nextActionsSchema = z.object({
  actions: z.array(z.string().trim().min(4).max(180)).max(3),
  composer: z.string().trim().max(180),
});

export const NEXT_ACTIONS: ToolDefinition = {
  name: 'suggest_next_actions',
  description:
    "Offer optional useful next user actions grounded in the current request and your actual answer, in the user's language and script. Call before your closing answer only when there is a meaningful next step. actions are up to 3 distinct user prompts for Keep exploring. composer is a separate natural next user message, not a copy of an action or a question addressed to the user. Use an empty composer if no helpful hint exists. Do not offer generic evidence questions, greetings, or completed tasks with nothing further to do. This only proposes prompts; it never sends them.",
  inputSchema: {
    type: 'object',
    properties: {
      actions: { type: 'array', maxItems: 3, items: { type: 'string' } },
      composer: { type: 'string' },
    },
    required: ['actions', 'composer'],
  },
};

export function nextActionsExecutor(
  onActions: (actions: string[]) => void,
): ToolExecutor {
  return {
    async execute(call) {
      const parsed = nextActionsSchema.safeParse(call.input);
      if (!parsed.success)
        return {
          toolCallId: call.id,
          ok: false,
          content: [
            {
              type: 'json',
              data: {
                code: 'validation_error',
                detail: 'Use up to 3 short actions and a short composer hint.',
              },
            },
          ],
        };
      const actions = [...new Set(parsed.data.actions)];
      onActions(actions);
      return {
        toolCallId: call.id,
        ok: true,
        content: [
          { type: 'json', data: { actions, composer: parsed.data.composer } },
        ],
      };
    },
  };
}
