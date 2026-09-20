import { config } from '../../config.js';
import { memoryService } from './memoryService.js';
import { checkPrivacy } from './privacy.js';

export interface DistillOptions {
  userId: string;
  userMessage: string;
  chatId?: string;
  messageId?: string;
  projectId?: string | null;
}

/**
 * Heuristic pattern detector for explicit and strong implicit user preferences/facts.
 * Can be augmented with an LLM distillation call.
 */
const PREFERENCE_PATTERNS: Array<{ regex: RegExp; keyPrefix: string; isStanding: boolean }> = [
  { regex: /(?:i always prefer|i prefer|always use)\s+([^.\n]+)/i, keyPrefix: 'preference_preferred_tool', isStanding: true },
  { regex: /(?:never use|do not use|don't use)\s+([^.\n]+)/i, keyPrefix: 'constraint_forbidden', isStanding: true },
  { regex: /(?:my company is|i work at|our company is)\s+([^.\n]+)/i, keyPrefix: 'profile_company', isStanding: false },
  { regex: /(?:my role is|i am a|i work as a)\s+([^.\n]+)/i, keyPrefix: 'profile_role', isStanding: false },
  { regex: /(?:remember that|note that)\s+([^.\n]+)/i, keyPrefix: 'user_note', isStanding: false },
];

/**
 * Evaluates a user message asynchronously for durable memory distillation.
 * Invariant: Only runs on user statements; never distills assistant responses as user preferences.
 */
export async function distillUserStatement(opts: DistillOptions): Promise<void> {
  const cfg = config();
  if (!cfg.ENABLE_MEMORY || !cfg.ENABLE_MEMORY_BACKGROUND_DISTILL) {
    return;
  }

  const { userId, userMessage, chatId, messageId, projectId } = opts;
  if (!userMessage || userMessage.trim().length < 10) return;

  // Enforce privacy check before doing any distillation
  const privacyCheck = checkPrivacy(userMessage);
  if (privacyCheck.hasSecret) {
    return; // Silently skip distillation when user message contains secrets
  }

  try {
    for (const { regex, keyPrefix, isStanding } of PREFERENCE_PATTERNS) {
      const match = regex.exec(userMessage);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.length >= 3 && extracted.length <= 300) {
          const key = `${keyPrefix}_${extracted.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40)}`;
          
          await memoryService.createMemory({
            userId,
            scope: projectId ? 'project' : 'global',
            projectId: projectId ?? null,
            kind: isStanding ? 'preference' : 'fact',
            key,
            content: extracted,
            summary: extracted.slice(0, 100),
            isStanding,
            sourceType: 'user_statement',
            sourceChatId: chatId ?? null,
            sourceMessageId: messageId ?? null,
          });
        }
      }
    }
  } catch (err) {
    // Distillation is non-blocking background task; do not fail caller
  }
}
