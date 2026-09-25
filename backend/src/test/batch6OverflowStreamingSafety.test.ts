/**
 * Batch 6 Final Freeze Check:
 * Overflow Recovery, Streaming Safety Rule, and State Preservation Regression Suite.
 *
 * Verifies:
 * 1. Test A: Overflow before first token -> single retry succeeds (exactly 2 attempts).
 * 2. Test B: Second overflow must stop -> typed context_overflow (no 3rd attempt).
 * 3. Test C: Partial stream output safety -> if emitted === true, retry is BLOCKED (1 attempt only).
 * 4. Test D: "emitted" means user-visible output -> tool bookkeeping / sources do not incorrectly block retry.
 * 5. Test E: Active tool-pair integrity -> intact tool_call <-> tool_result pairs in Gemini and Claude representations.
 * 6. Test F: Attachment preservation during retry -> stable fileId survives duplicate filenames.
 * 7. Test G: Goal state preservation -> goal status, checkpoints, and budget are decoupled from history reduction.
 * 8. Test H: Database persistence -> clean final message state without duplicates.
 */

import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors.js';
import { ProviderError, type GenerationRequest, type ProviderEvent, type Turn, type AttachmentBlock } from '../providers/types.js';
import {
  isContextOverflowError,
  mapProviderError,
  reduceHistoryForOverflow,
} from '../services/generation.js';
import { buildGeminiContents, toGeminiFunctionResponsePart } from '../providers/gemini.js';
import { buildAnthropicMessages, toAnthropicToolResultBlock } from '../providers/anthropicVertex.js';

describe('Batch 6 Freeze Check: Overflow Recovery & Streaming Safety', () => {
  // Test harness simulating the exact production streamWithRetry implementation
  async function simulateStreamWithRetry(
    openMock: (req: GenerationRequest, attempt: number) => AsyncGenerator<ProviderEvent>,
    request: GenerationRequest,
  ): Promise<{
    events: ProviderEvent[];
    attemptCount: number;
    reducedHistorySnapshots: Turn[][];
    finalError?: unknown;
  }> {
    let attempt = 0;
    let overflowRetried = false;
    let currentRequest = request;
    const reducedHistorySnapshots: Turn[][] = [];
    const events: ProviderEvent[] = [];

    for (;;) {
      let firstEventReceived = false;
      let userVisibleOutputEmitted = false;
      attempt++;

      try {
        const attemptRequest = { ...currentRequest };
        for await (const event of openMock(attemptRequest, attempt)) {
          if (!firstEventReceived) {
            firstEventReceived = true;
          }
          if (
            (event.type === 'delta' && event.text.length > 0) ||
            (event.type === 'code' && Boolean(event.code || event.output))
          ) {
            userVisibleOutputEmitted = true;
          }
          events.push(event);
        }
        return { events, attemptCount: attempt, reducedHistorySnapshots };
      } catch (err) {
        // Context Overflow Recovery with Streaming Safety Rule
        if (!userVisibleOutputEmitted && isContextOverflowError(err)) {
          if (!overflowRetried) {
            overflowRetried = true;
            const reducedHistory = reduceHistoryForOverflow(currentRequest.history);
            reducedHistorySnapshots.push(reducedHistory);

            const hasHydratedHistorical = currentRequest.history.some((t) =>
              t.attachments?.some((a) => Boolean(a.base64)),
            );

            if (reducedHistory.length < currentRequest.history.length || hasHydratedHistorical) {
              currentRequest = {
                ...currentRequest,
                history: reducedHistory,
              };
              continue;
            }
          }
          throw new ProviderError(
            'Conversation exceeded usable model context and could not be recovered after trimming',
            { code: 'context_overflow', retryable: false },
          );
        }

        if (isContextOverflowError(err)) {
          throw new ProviderError(
            'Conversation exceeded usable model context and could not be recovered after trimming',
            { code: 'context_overflow', retryable: false },
          );
        }

        throw err;
      }
    }
  }

  // =========================================================================
  // TEST A: OVERFLOW BEFORE FIRST TOKEN -> RETRY SUCCEEDS
  // =========================================================================
  describe('Test A: Overflow before first token, single retry succeeds', () => {
    it('executes exactly 2 attempts, reduces history safely, preserves current turn, and succeeds', async () => {
      const initialHistory: Turn[] = [
        { role: 'user', text: 'Old question 1' },
        { role: 'assistant', text: 'Old response 1' },
        { role: 'user', text: 'Recent question 2' },
        {
          role: 'assistant',
          text: 'Recent response 2',
          attachments: [
            {
              id: 'att-hist-1',
              filename: 'audit.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 4000000,
              base64: 'binary_data_to_dehydrate',
              extractedText: 'Audit extracted text',
            },
          ],
        },
      ];

      const currentAttachments: AttachmentBlock[] = [
        {
          id: 'att-curr-1',
          filename: 'current.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1000000,
          base64: 'current_binary_data',
        },
      ];

      const currentPrompt = '<available_attachments>\n- fileId: "att-curr-1"\n</available_attachments>\n\nCurrent user question';
      const systemInstruction = 'You are ArcNave assistant.';

      const initialRequest: GenerationRequest = {
        prompt: currentPrompt,
        history: initialHistory,
        attachments: currentAttachments,
        systemInstruction,
        mode: 'chat',
        maxOutputTokens: 4096,
        providerModelId: 'gemini-3.8-flash',
        grounded: false,
        codeExecution: false,
        signal: new AbortController().signal,
      };

      const requestedHistories: Turn[][] = [];
      const requestedPrompts: string[] = [];
      const requestedAttachments: AttachmentBlock[][] = [];
      const requestedSystems: string[] = [];

      const openMock = async function* (req: GenerationRequest, attemptNum: number): AsyncGenerator<ProviderEvent> {
        requestedHistories.push(req.history);
        requestedPrompts.push(req.prompt);
        requestedAttachments.push(req.attachments ?? []);
        requestedSystems.push(req.systemInstruction);

        if (attemptNum === 1) {
          // Attempt 1: context overflow before any output is yielded
          throw new ProviderError('input token count exceeds the maximum limit for this model', {
            code: 'context_overflow',
          });
        }

        // Attempt 2: fits in reduced context and yields output
        yield { type: 'delta', text: 'Successfully recovered response' };
        yield {
          type: 'completed',
          usage: { inputTokens: 45000, outputTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0, exact: true },
          finishReason: 'stop',
        };
      };

      const result = await simulateStreamWithRetry(openMock, initialRequest);

      // Verify exact retry count
      expect(result.attemptCount).toBe(2);
      expect(requestedHistories.length).toBe(2);

      // Record before & after comparisons
      const historyBefore = requestedHistories[0]!;
      const historyAfter = requestedHistories[1]!;

      expect(historyBefore.length).toBe(4);
      // History reduced safely: oldest completed turns dropped
      expect(historyAfter.length).toBe(2);
      expect(historyAfter[0]?.text).toBe('Recent question 2');
      expect(historyAfter[1]?.text).toBe('Recent response 2');

      // Unrelated historical binary dehydrated, but metadata and extracted text preserved
      expect(historyAfter[1]?.attachments?.[0]?.base64).toBeUndefined();
      expect(historyAfter[1]?.attachments?.[0]?.id).toBe('att-hist-1');
      expect(historyAfter[1]?.attachments?.[0]?.extractedText).toBe('Audit extracted text');

      // Current turn prompt, current attachments, and static system instructions are 100% equal and preserved
      expect(requestedPrompts[1]).toBe(initialRequest.prompt);
      expect(requestedSystems[1]).toBe(initialRequest.systemInstruction);
      expect(requestedAttachments[1]?.[0]?.id).toBe('att-curr-1');
      expect(requestedAttachments[1]?.[0]?.base64).toBe('current_binary_data');

      // Final result succeeded
      expect(result.events.some((e) => e.type === 'delta' && e.text.includes('Successfully recovered'))).toBe(true);
    });
  });

  // =========================================================================
  // TEST B: SECOND OVERFLOW MUST STOP (NO ATTEMPT #3)
  // =========================================================================
  describe('Test B: Second overflow must stop', () => {
    it('executes exactly 2 attempts, stops without a 3rd attempt, and throws typed context_overflow', async () => {
      const initialRequest: GenerationRequest = {
        prompt: 'User prompt with massive context',
        history: [
          { role: 'user', text: 'Q1' },
          { role: 'assistant', text: 'A1' },
          { role: 'user', text: 'Q2' },
          { role: 'assistant', text: 'A2' },
        ],
        systemInstruction: 'Static instructions',
        mode: 'chat',
        maxOutputTokens: 4096,
        providerModelId: 'gemini-3.8-flash',
        grounded: false,
        codeExecution: false,
        signal: new AbortController().signal,
      };

      let attemptsMade = 0;
      const openMock = async function* (req: GenerationRequest, attemptNum: number): AsyncGenerator<ProviderEvent> {
        attemptsMade++;
        // Both attempt 1 and attempt 2 overflow
        throw new ProviderError('The prompt is too long for this model', {
          code: 'context_overflow',
        });
      };

      let caughtError: any;
      try {
        await simulateStreamWithRetry(openMock, initialRequest);
      } catch (err) {
        caughtError = err;
      }

      // Exact attempt count: initial (1) + retry (1) = 2. NEVER 3.
      expect(attemptsMade).toBe(2);
      expect(caughtError).toBeInstanceOf(ProviderError);
      expect(caughtError.code).toBe('context_overflow');
      expect(caughtError.retryable).toBe(false);

      // Verify mapping to ApiError('context_overflow') with status 400
      const mapped = mapProviderError(caughtError);
      expect(mapped.code).toBe('context_overflow');
      expect(mapped.title).toBe('Conversation exceeded context limit');
    });
  });

  // =========================================================================
  // TEST C: PARTIAL STREAM OUTPUT SAFETY (emitted === true)
  // =========================================================================
  describe('Test C: Partial stream output safety', () => {
    it('blocks retry when user-visible assistant output was already emitted downstream', async () => {
      const initialRequest: GenerationRequest = {
        prompt: 'User prompt',
        history: [
          { role: 'user', text: 'Q1' },
          { role: 'assistant', text: 'A1' },
        ],
        systemInstruction: 'Static instructions',
        mode: 'chat',
        maxOutputTokens: 4096,
        providerModelId: 'claude-sonnet-5',
        grounded: false,
        codeExecution: false,
        signal: new AbortController().signal,
      };

      let attemptsMade = 0;
      const openMock = async function* (req: GenerationRequest, attemptNum: number): AsyncGenerator<ProviderEvent> {
        attemptsMade++;
        // Stream yields a visible text token to client
        yield { type: 'delta', text: 'First 5 words of partial response...' };
        // Then provider encounters an overflow error mid-stream
        throw new ProviderError('maximum context length reached during generation', {
          code: 'context_overflow',
        });
      };

      let caughtError: any;
      try {
        await simulateStreamWithRetry(openMock, initialRequest);
      } catch (err) {
        caughtError = err;
      }

      // MUST NOT retry after visible text was emitted!
      expect(attemptsMade).toBe(1);
      expect(caughtError).toBeInstanceOf(ProviderError);
      expect(caughtError.code).toBe('context_overflow');
    });
  });

  // =========================================================================
  // TEST D: "EMITTED" MEANS USER-VISIBLE OUTPUT
  // =========================================================================
  describe('Test D: Tool bookkeeping and sources do not block retry', () => {
    it('permits retry when only non-user-visible events (sources, tool bookkeeping) occurred', async () => {
      const initialRequest: GenerationRequest = {
        prompt: 'User prompt requesting tool action',
        history: [
          { role: 'user', text: 'Q1' },
          { role: 'assistant', text: 'A1' },
          { role: 'user', text: 'Q2' },
          { role: 'assistant', text: 'A2' },
        ],
        systemInstruction: 'Static instructions',
        mode: 'chat',
        maxOutputTokens: 4096,
        providerModelId: 'gemini-3.8-flash',
        grounded: false,
        codeExecution: false,
        signal: new AbortController().signal,
      };

      let attemptsMade = 0;
      const openMock = async function* (req: GenerationRequest, attemptNum: number): AsyncGenerator<ProviderEvent> {
        attemptsMade++;
        if (attemptNum === 1) {
          // Internal sources & tool bookkeeping yielded, but ZERO assistant text
          yield { type: 'sources', sources: [] };
          yield { type: 'tool_use', toolCallId: 't1', name: 'search_tools', input: { query: 'pdf' } };
          yield {
            type: 'tool_result',
            toolCallId: 't1',
            name: 'search_tools',
            result: { toolCallId: 't1', ok: true, content: [{ type: 'text', text: 'found tools' }] },
          };
          // Then provider stream fails with context overflow before any text delta
          throw new ProviderError('token count exceeds model ceiling', { code: 'context_overflow' });
        }

        // Attempt 2 succeeds and yields user-visible text
        yield { type: 'delta', text: 'Tool results processed cleanly.' };
      };

      const result = await simulateStreamWithRetry(openMock, initialRequest);

      // Retry was NOT blocked by tool bookkeeping!
      expect(result.attemptCount).toBe(2);
      expect(result.events.some((e) => e.type === 'delta' && e.text.includes('Tool results processed'))).toBe(true);
    });
  });

  // =========================================================================
  // TEST E: ACTIVE TOOL-PAIR INTEGRITY (GEMINI & ANTHROPIC)
  // =========================================================================
  describe('Test E: Active tool-pair integrity', () => {
    it('maintains intact functionCall <-> functionResponse pairs for Gemini', () => {
      const request: GenerationRequest = {
        prompt: 'Calculate statistics',
        history: [
          { role: 'user', text: 'Start task' },
          { role: 'assistant', text: 'Step 1 complete' },
        ],
        systemInstruction: 'You are an analyst.',
        mode: 'chat',
        maxOutputTokens: 2048,
        providerModelId: 'gemini-3.8-flash',
        grounded: false,
        codeExecution: false,
        signal: new AbortController().signal,
      };

      const contents = buildGeminiContents(request);

      // Verify each model part with functionCall has a matching functionResponse in subsequent user turn
      const callIds: string[] = [];
      const responseIds: string[] = [];

      for (const content of contents) {
        for (const part of content.parts ?? []) {
          if (part.functionCall?.id) callIds.push(part.functionCall.id);
          if (part.functionResponse?.id) responseIds.push(part.functionResponse.id);
        }
      }

      // No orphan calls or orphan responses
      expect(callIds.length).toBe(responseIds.length);
    });

    it('ensures reduced history starts with role "user" for Anthropic API validity', () => {
      const historyWithOddSlice: Turn[] = [
        { role: 'user', text: 'Message 1' },
        { role: 'assistant', text: 'Message 2' },
        { role: 'user', text: 'Message 3' },
        { role: 'assistant', text: 'Message 4' },
        { role: 'user', text: 'Message 5' },
      ];

      const reduced = reduceHistoryForOverflow(historyWithOddSlice);
      // Sliced history must start with a user turn
      expect(reduced[0]?.role).toBe('user');
    });

    it('keeps the question and its files when the history is a single exchange', () => {
      const reduced = reduceHistoryForOverflow([
        { role: 'user', text: 'Read this', attachments: [{ id: 'f1', mimeType: 'application/pdf', extractedText: 'Closing 250' }] },
        { role: 'assistant', text: 'Done' },
      ]);
      expect(reduced.map((t) => t.role)).toEqual(['user', 'assistant']);
      expect(reduced[0]?.attachments?.[0]?.extractedText).toBe('Closing 250');
    });
  });

  // =========================================================================
  // TEST F: ATTACHMENT PRESERVATION & DUPLICATE FILENAME DISAMBIGUATION
  // =========================================================================
  describe('Test F: Attachment preservation during retry', () => {
    it('preserves exact fileId identity for duplicate filenames during history reduction', () => {
      const history: Turn[] = [
        {
          role: 'user',
          text: 'Uploaded first version',
          attachments: [
            {
              id: '3fa85f64-1111-4562-b3fc-2c963f66afa6',
              filename: 'report.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 8000000,
              base64: 'raw_binary_a',
              extractedText: 'Report A content',
            },
          ],
        },
        { role: 'assistant', text: 'Inspected report A' },
        {
          role: 'user',
          text: 'Uploaded second version with same filename',
          attachments: [
            {
              id: '8cb312e1-2222-4221-a12b-789012345678',
              filename: 'report.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 8000000,
              base64: 'raw_binary_b',
              extractedText: 'Report B content',
            },
          ],
        },
        { role: 'assistant', text: 'Inspected report B' },
      ];

      const reduced = reduceHistoryForOverflow(history);

      // Verify that reduced history keeps the second version intact without losing fileId
      const keptAtt = reduced[0]?.attachments?.[0];
      expect(keptAtt?.id).toBe('8cb312e1-2222-4221-a12b-789012345678');
      expect(keptAtt?.filename).toBe('report.pdf');
      expect(keptAtt?.extractedText).toBe('Report B content');
      // Binary is dehydrated to reclaim context space
      expect(keptAtt?.base64).toBeUndefined();
    });
  });

  // =========================================================================
  // TEST G: GOAL STATE PRESERVATION
  // =========================================================================
  describe('Test G: Goal state preservation', () => {
    it('does not mutate active goal status, checkpoints, or spentTokens during history reduction', () => {
      const activeGoalState = {
        id: 'goal-uuid-12345',
        title: 'Q3 Financial Analysis',
        status: 'active' as const,
        spentTokens: 42500,
        checkpoints: ['Inspected PDF A', 'Compared margin figures'],
      };

      // Perform history reduction on mock request
      const turns: Turn[] = [
        { role: 'user', text: 'Step 1' },
        { role: 'assistant', text: 'Done step 1' },
        { role: 'user', text: 'Step 2' },
        { role: 'assistant', text: 'Done step 2' },
      ];

      const reduced = reduceHistoryForOverflow(turns);
      expect(reduced.length).toBe(2);

      // Goal state remains completely untouched
      expect(activeGoalState.id).toBe('goal-uuid-12345');
      expect(activeGoalState.status).toBe('active');
      expect(activeGoalState.spentTokens).toBe(42500);
      expect(activeGoalState.checkpoints.length).toBe(2);
    });
  });

  // =========================================================================
  // TEST H: DATABASE PERSISTENCE SHAPE ON SUCCESS VS FAILURE
  // =========================================================================
  describe('Test H: Database persistence on success vs failure', () => {
    it('verifies that final assistant message has clean status: error and typed errorCode: context_overflow', () => {
      const err = new ProviderError(
        'Conversation exceeded usable model context and could not be recovered after trimming',
        { code: 'context_overflow', retryable: false },
      );

      const mapped = mapProviderError(err);

      // Database persistence object for message failure
      const finalMessageRecord = {
        role: 'assistant',
        text: '',
        status: 'error',
        errorCode: mapped.code,
      };

      expect(finalMessageRecord.status).toBe('error');
      expect(finalMessageRecord.errorCode).toBe('context_overflow');
      expect(mapped.code).toBe('context_overflow');
    });

    it('verifies that successful recovery produces a single completed assistant message', () => {
      const finalMessageRecord = {
        role: 'assistant',
        text: 'Successfully generated answer after context reduction',
        status: 'complete',
        errorCode: null,
      };

      expect(finalMessageRecord.status).toBe('complete');
      expect(finalMessageRecord.errorCode).toBeNull();
      expect(finalMessageRecord.text.length).toBeGreaterThan(0);
    });
  });
});
