import { describe, expect, it } from 'vitest';

import type { AttachmentBlock, GenerationRequest } from '../providers/types.js';
import { firstTokenBudgetMs } from './generation.js';

const cfg = { PROVIDER_TTFT_BUDGET_MS: 12_000, PROVIDER_TTFT_MS_PER_10K_CONTEXT: 1_000 };
const request = (history: GenerationRequest['history'], attachments: GenerationRequest['attachments'] = []) => ({
  mode: 'chat' as const,
  history,
  attachments,
});
const pdfPages: AttachmentBlock = { filename: 's.pdf', mimeType: 'application/pdf', pages: [{ num: 1, text: 'p1', image: { mimeType: 'image/jpeg', base64: 'x' } }] };

describe('first-token budget', () => {
  it('a plain chat gets the base budget', () => {
    expect(firstTokenBudgetMs(cfg, request([]), null)).toBe(12_000);
  });

  it('a follow-up whose history carries a PDF as rendered pages counts as media (the live 12 s failure)', () => {
    const history = [{ role: 'user' as const, text: 'count', attachments: [pdfPages] }];
    expect(firstTokenBudgetMs(cfg, request(history), null)).toBe(36_000);
  });

  it('adds the per-10k allowance for the size of the chat\'s last request', () => {
    const history = [{ role: 'user' as const, text: 'count', attachments: [pdfPages] }];
    expect(firstTokenBudgetMs(cfg, request(history), 300_000)).toBe(36_000 + 30_000);
    expect(firstTokenBudgetMs(cfg, request([]), 5_000)).toBe(13_000);
  });
});
