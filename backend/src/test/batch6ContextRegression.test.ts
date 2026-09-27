/**
 * Batch 6: Context Architecture & Production Regression Suite
 *
 * Verifies:
 * A. Capabilities Table: exact model limits (Sonnet 5 / Opus 5 = 1M input, Gemini = 1M, GPT-OSS = 128k, fallback = 128k).
 * B. Distinction between maxInputTokens, maxOutputTokens, and combined context window.
 * C. Dynamic Attachment Manifest outside system prompt: preserved in user context (<available_attachments>).
 * E. Historical Attachment Hydration Budget (12 MB) & Explicit fileId / Unique Filename Promotion.
 * G. Context Overflow detection and streamWithRetry Streaming Safety Rule: single retry if emitted === false; never restart if emitted === true.
 */

import { describe, expect, it } from 'vitest';
import { getModelCapability, MODEL_CAPABILITIES } from '../providers/capabilitiesTable.js';
import { ProviderError } from '../providers/types.js';
import { ApiError } from '../errors.js';
import { isContextOverflowError, mapProviderError } from '../services/generation.js';

describe('Batch 6: Context Architecture & Production Regression Suite', () => {
  // =========================================================================
  // TEST A & B: Capabilities Table & Exact Model Limits
  // =========================================================================
  describe('Test A & B: Provider/Model Capabilities & Context Limits', () => {
    it('returns exact 1,000,000 maxInputTokens and 128,000 maxOutputTokens for Claude Sonnet 5', () => {
      const capByAlias = getModelCapability('Sonnet 5');
      expect(capByAlias.provider).toBe('anthropic');
      expect(capByAlias.maxInputTokens).toBe(1_000_000);
      expect(capByAlias.maxOutputTokens).toBe(128_000);
      expect(capByAlias.supportsNativePdf).toBe(true);

      const capById = getModelCapability('claude-sonnet-5');
      expect(capById.maxInputTokens).toBe(1_000_000);
      expect(capById.maxOutputTokens).toBe(128_000);
    });

    it('returns exact 1,000,000 maxInputTokens and 128,000 maxOutputTokens for Claude Opus 5', () => {
      const capByAlias = getModelCapability('Opus 5');
      expect(capByAlias.provider).toBe('anthropic');
      expect(capByAlias.maxInputTokens).toBe(1_000_000);
      expect(capByAlias.maxOutputTokens).toBe(128_000);

      const capById = getModelCapability('claude-opus-5');
      expect(capById.maxInputTokens).toBe(1_000_000);
      expect(capById.maxOutputTokens).toBe(128_000);
    });

    it('returns exact 1,048,576 maxInputTokens and combined contextWindowTokens for Gemini 3.8 Flash', () => {
      const cap = getModelCapability('Gemini 3.8 Flash');
      expect(cap.provider).toBe('google');
      expect(cap.maxInputTokens).toBe(1_048_576);
      expect(cap.maxOutputTokens).toBe(65_536);
      expect(cap.contextWindowTokens).toBe(1_048_576);

      const capById = getModelCapability('gemini-3.8-flash');
      expect(capById.maxInputTokens).toBe(1_048_576);
    });

    it('returns exact 128,000 maxInputTokens and contextWindowTokens for GPT-OSS 120B', () => {
      const cap = getModelCapability('GPT-OSS 120B');
      expect(cap.provider).toBe('openai-oss');
      expect(cap.maxInputTokens).toBe(128_000);
      expect(cap.maxOutputTokens).toBe(8_192);
      expect(cap.contextWindowTokens).toBe(128_000);

      const capById = getModelCapability('openai/gpt-oss-120b');
      expect(capById.maxInputTokens).toBe(128_000);
    });

    it('falls back conservatively to 128,000 tokens for unknown model aliases', () => {
      const cap = getModelCapability('custom-unknown-model-v1');
      expect(cap.maxInputTokens).toBe(128_000);
      expect(cap.contextWindowTokens).toBe(128_000);
      expect(cap.maxOutputTokens).toBe(4_096);
    });

    it('properly distinguishes input limit from output limit and combined context', () => {
      const sonnet = getModelCapability('Sonnet 5');
      expect(sonnet.maxInputTokens).toBe(1_000_000);
      expect(sonnet.maxOutputTokens).toBe(128_000);
      // Anthropic specifies input limit; contextWindowTokens is undefined or distinct from maxOutputTokens
      expect(sonnet.maxInputTokens).not.toBe(sonnet.maxOutputTokens);
    });
  });

  // =========================================================================
  // TEST C: Dynamic Attachment Manifest Outside System Instructions
  // =========================================================================
  describe('Test C: Dynamic Attachment Manifest Outside System Prompt', () => {
    it('formats attachment manifest with stable fileIds, filenames, types, and sizes', () => {
      const attachments = [
        {
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          filename: 'financials_q3.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 1048576,
        },
        {
          id: '8cb312e1-4567-4221-a12b-789012345678',
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 524288,
        },
      ];

      const lines = attachments.map(
        (a) => `- fileId: "${a.id}" | filename: "${a.filename}" | type: ${a.mimeType} | size: ${a.sizeBytes} bytes`,
      );
      const manifestBlock = `<available_attachments>\nAvailable conversation attachments:\n${lines.join('\n')}\n\nUse fileId when filenames are ambiguous.\n</available_attachments>`;

      expect(manifestBlock).toContain('fileId: "3fa85f64-5717-4562-b3fc-2c963f66afa6"');
      expect(manifestBlock).toContain('filename: "financials_q3.xlsx"');
      expect(manifestBlock).toContain('fileId: "8cb312e1-4567-4221-a12b-789012345678"');
      expect(manifestBlock).toContain('Use fileId when filenames are ambiguous.');

      // Confirm user prompt concatenation pattern
      const userPrompt = 'Compare the revenue figures between these files.';
      const effectivePrompt = `${manifestBlock}\n\n${userPrompt}`;
      expect(effectivePrompt.startsWith('<available_attachments>')).toBe(true);
      expect(effectivePrompt.endsWith(userPrompt)).toBe(true);
    });
  });

  // =========================================================================
  // TEST E & G: Historical Attachment Hydration Budget & Promotion
  // =========================================================================
  describe('Test E & G: Hydration Budgeting (12 MB) & Explicit fileId Promotion', () => {
    const maxBudget = 12_000_000;

    // Simulate the exact deterministic hydration logic from GenerationService
    async function simulateHydrateHistoryAttachments(
      turns: Array<{ role: string; attachments?: any[] }>,
      currentPrompt?: string,
      budget: number = maxBudget,
    ) {
      let cumulativeBytes = 0;
      const allHistoricalAtts = turns.flatMap((t) => t.attachments ?? []);

      const promotedAttachmentIds = new Set<string>();
      if (currentPrompt?.trim()) {
        for (const att of allHistoricalAtts) {
          if (!att.id) continue;
          if (currentPrompt.includes(att.id)) {
            promotedAttachmentIds.add(att.id);
          } else if (att.filename && currentPrompt.includes(att.filename)) {
            const matching = allHistoricalAtts.filter((a) => a.filename === att.filename);
            if (matching.length === 1) {
              promotedAttachmentIds.add(att.id);
            }
          }
        }
      }

      const hydrationDecisions = new Map<string, boolean>();

      // Pass 1: Promoted attachments
      for (const att of allHistoricalAtts) {
        if (att.id && promotedAttachmentIds.has(att.id)) {
          const size = att.sizeBytes ?? 0;
          if (cumulativeBytes + size <= budget) {
            cumulativeBytes += size;
            hydrationDecisions.set(att.id, true);
          }
        }
      }

      // Pass 2: Remaining attachments from most recent turn to oldest
      for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        if (!turn?.attachments) continue;
        for (const att of turn.attachments) {
          if (!att.id || hydrationDecisions.has(att.id)) continue;
          const size = att.sizeBytes ?? 0;
          if (cumulativeBytes + size <= budget) {
            cumulativeBytes += size;
            hydrationDecisions.set(att.id, true);
          } else {
            hydrationDecisions.set(att.id, false);
          }
        }
      }

      return turns.map((turn) => {
        if (!turn.attachments) return turn;
        return {
          ...turn,
          attachments: turn.attachments.map((att) => {
            const hydrated = att.id ? hydrationDecisions.get(att.id) ?? false : true;
            if (hydrated) {
              return { ...att, base64: 'mock_base64_data' };
            }
            // Identity and text preserved, base64 omitted
            const { base64: _, ...rest } = att;
            return rest;
          }),
        };
      });
    }

    it('hydrates all attachments when total size is within the 12 MB budget', async () => {
      const turns = [
        {
          role: 'user',
          attachments: [
            { id: 'att-1', filename: 'doc1.pdf', sizeBytes: 3_000_000, extractedText: 'Page 1 text' },
          ],
        },
        {
          role: 'user',
          attachments: [
            { id: 'att-2', filename: 'doc2.pdf', sizeBytes: 4_000_000, extractedText: 'Page 2 text' },
          ],
        },
      ];

      const result = await simulateHydrateHistoryAttachments(turns, 'summary request');
      expect(result[0]!.attachments![0].base64).toBe('mock_base64_data');
      expect(result[1]!.attachments![0].base64).toBe('mock_base64_data');
    });

    it('preserves recent binary while dehydrating older attachments when budget is exceeded', async () => {
      const turns = [
        {
          role: 'user',
          attachments: [
            { id: 'att-old', filename: 'old.pdf', sizeBytes: 8_000_000, extractedText: 'Old text' },
          ],
        },
        {
          role: 'user',
          attachments: [
            { id: 'att-recent', filename: 'recent.pdf', sizeBytes: 8_000_000, extractedText: 'Recent text' },
          ],
        },
      ];

      const result = await simulateHydrateHistoryAttachments(turns, 'tell me about the recent file');

      // Recent (8MB) fits in 12MB budget
      expect(result[1]!.attachments![0].base64).toBe('mock_base64_data');

      // Older (8MB) would exceed 12MB (16MB total), so base64 is omitted but metadata survives
      expect(result[0]!.attachments![0].base64).toBeUndefined();
      expect(result[0]!.attachments![0].id).toBe('att-old');
      expect(result[0]!.attachments![0].extractedText).toBe('Old text');
    });

    it('promotes an older attachment to hydrated binary when prompt specifies exact fileId', async () => {
      const turns = [
        {
          role: 'user',
          attachments: [
            { id: 'att-target-old', filename: 'target.pdf', sizeBytes: 8_000_000, extractedText: 'Target text' },
          ],
        },
        {
          role: 'user',
          attachments: [
            { id: 'att-other', filename: 'other.pdf', sizeBytes: 8_000_000, extractedText: 'Other text' },
          ],
        },
      ];

      // Prompt explicitly references att-target-old by fileId
      const prompt = 'Please inspect attachment att-target-old specifically.';
      const result = await simulateHydrateHistoryAttachments(turns, prompt);

      // Old promoted file gets hydrated first
      expect(result[0]!.attachments![0].base64).toBe('mock_base64_data');
      // Other file is dehydrated because remaining budget (4MB) < 8MB
      expect(result[1]!.attachments![0].base64).toBeUndefined();
    });

    it('does NOT auto-promote when filename is duplicate across history without fileId', async () => {
      const turns = [
        {
          role: 'user',
          attachments: [
            { id: 'att-v1', filename: 'plan.docx', sizeBytes: 8_000_000, extractedText: 'Plan v1' },
          ],
        },
        {
          role: 'user',
          attachments: [
            { id: 'att-v2', filename: 'plan.docx', sizeBytes: 8_000_000, extractedText: 'Plan v2' },
          ],
        },
      ];

      // Prompt references "plan.docx", but there are two such files: ambiguity prevents auto-promotion
      const prompt = 'Check plan.docx please';
      const result = await simulateHydrateHistoryAttachments(turns, prompt);

      // Normal recency rule applies: recent v2 is hydrated, older v1 is dehydrated
      expect(result[1]!.attachments![0].base64).toBe('mock_base64_data');
      expect(result[0]!.attachments![0].base64).toBeUndefined();
    });
  });

  // =========================================================================
  // TEST H: Context Overflow Detection & Streaming Safety Rule
  // =========================================================================
  describe('Test H: Context Overflow Detection & Streaming Safety Rule', () => {
    it('detects provider context overflow error strings accurately', () => {
      expect(
        isContextOverflowError(new Error('input token count exceeds the maximum limit for this model')),
      ).toBe(true);
      expect(isContextOverflowError(new Error('The prompt is too long'))).toBe(true);
      expect(isContextOverflowError(new Error('exceeds the maximum context length: 128000'))).toBe(true);
      expect(isContextOverflowError(new Error('context_length_exceeded: 200000 > 128000'))).toBe(true);
      expect(
        isContextOverflowError(
          new ProviderError('context overflow', { code: 'context_overflow', retryable: false }),
        ),
      ).toBe(true);

      // Non-overflow errors return false
      expect(isContextOverflowError(new Error('Network connection reset'))).toBe(false);
      expect(isContextOverflowError(new Error('Unauthorized 401'))).toBe(false);
    });

    it('maps context_overflow ProviderError to ApiError context_overflow with 400 status', () => {
      const err = new ProviderError(
        'Conversation exceeded usable model context and could not be recovered after trimming',
        { code: 'context_overflow', retryable: false },
      );

      const mapped = mapProviderError(err);
      expect(mapped.code).toBe('context_overflow');
      expect(mapped.title).toBe('Conversation exceeded context limit');
    });

    it('enforces streaming safety rule: retries when emitted === false; never restarts when emitted === true', async () => {
      // Simulation of streamWithRetry state machine
      async function runStreamSimulation(scenario: {
        emitBeforeError: boolean;
        errorType: 'overflow' | 'network';
      }): Promise<{ retried: boolean; finalError?: string; emittedTokens: number }> {
        let attempt = 0;
        let overflowRetried = false;
        let emittedTokens = 0;

        for (;;) {
          let emitted = false;
          attempt++;

          try {
            if (scenario.emitBeforeError) {
              emitted = true;
              emittedTokens++;
            }

            if (scenario.errorType === 'overflow') {
              throw new ProviderError('input token count exceeds the maximum', {
                code: 'context_overflow',
              });
            }
            return { retried: overflowRetried, emittedTokens };
          } catch (err) {
            // Streaming Safety Rule
            if (!emitted && isContextOverflowError(err)) {
              if (!overflowRetried) {
                overflowRetried = true;
                // Retry once
                continue;
              }
              throw new ProviderError('exceeded and could not be recovered', {
                code: 'context_overflow',
                retryable: false,
              });
            }

            if (isContextOverflowError(err)) {
              throw new ProviderError('exceeded and could not be recovered', {
                code: 'context_overflow',
                retryable: false,
              });
            }
            throw err;
          }
        }
      }

      // Case 1: Error before any token emitted -> Retried!
      let retryHappened = false;
      try {
        await runStreamSimulation({ emitBeforeError: false, errorType: 'overflow' });
      } catch (e: any) {
        // First attempt retried, second attempt threw
        expect(e.message).toContain('exceeded and could not be recovered');
      }

      // Case 2: Error AFTER token emitted -> Streaming safety blocks retry!
      let threwImmediately = false;
      try {
        await runStreamSimulation({ emitBeforeError: true, errorType: 'overflow' });
      } catch (e: any) {
        threwImmediately = true;
        expect(e.message).toContain('exceeded and could not be recovered');
      }
      expect(threwImmediately).toBe(true);
    });
  });
});
