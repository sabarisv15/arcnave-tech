import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest, ToolCall, ToolExecutor, ToolResult } from '../providers/types.js';

interface FakeChunk {
  text?: string;
  functionCalls?: { id?: string; name: string; args?: Record<string, unknown> }[];
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
  candidates?: {
    finishReason?: string;
    content?: { parts?: { functionCall?: unknown }[] };
  }[];
}

function fakeStream(chunks: FakeChunk[]): AsyncIterable<FakeChunk> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: () =>
          Promise.resolve(
            i < chunks.length
              ? { value: chunks[i++]!, done: false }
              : { value: undefined, done: true },
          ),
      };
    },
  };
}

class FakeGeminiClient {
  calls: unknown[] = [];
  responses: AsyncIterable<FakeChunk>[] = [];
  models = {
    generateContentStream: vi.fn(async (req: unknown) => {
      this.calls.push(req);
      const next = this.responses.shift();
      if (!next) throw new Error('FakeGeminiClient: no scripted response left');
      return next;
    }),
  };
}

describe('Repair-Loop Compatibility (Model -> Tool Warning -> Corrective Second Tool Call)', () => {
  it('executes a multi-turn tool loop where model makes a corrective second tool call after warning', async () => {
    const fakeClient = new FakeGeminiClient();

    // Turn 1: Model calls validate_table with incomplete columns
    fakeClient.responses.push(
      fakeStream([
        {
          functionCalls: [
            {
              id: 'call-1',
              name: 'validate_statement_table',
              args: { columns: ['date', 'amount'] }, // missing balance
            },
          ],
        },
      ]),
    );

    // Turn 2: After receiving warning from tool, Model issues a CORRECTIVE SECOND TOOL CALL
    fakeClient.responses.push(
      fakeStream([
        {
          text: 'The table validation reported a missing balance column. Repairing and re-validating...',
        },
        {
          functionCalls: [
            {
              id: 'call-2',
              name: 'validate_statement_table',
              args: { columns: ['date', 'amount', 'balance'] }, // Corrected columns!
            },
          ],
        },
      ]),
    );

    // Turn 3: After tool succeeds, Model finalizes
    fakeClient.responses.push(
      fakeStream([
        {
          text: 'Table successfully validated with all required columns including balance.',
          candidates: [{ finishReason: 'STOP' }],
        },
      ]),
    );

    // Tool Executor that returns warning on call 1 and success on call 2
    const executedCalls: ToolCall[] = [];
    const toolExecutor: ToolExecutor = {
      async execute(call: ToolCall): Promise<ToolResult> {
        executedCalls.push(call);
        const cols = (call.input as any).columns || [];
        if (!cols.includes('balance')) {
          return {
            toolCallId: call.id,
            ok: true,
            content: [
              {
                type: 'json',
                data: {
                  status: 'warning',
                  warnings: [
                    {
                      severity: 'warning',
                      type: 'missing_content',
                      message: 'Required column "balance" is missing from table',
                      repairable: true,
                    },
                  ],
                  recommendation: 'Add the balance column to the columns array and retry validation.',
                },
              },
            ],
          };
        }

        return {
          toolCallId: call.id,
          ok: true,
          content: [
            {
              type: 'json',
              data: {
                status: 'success',
                summary: { valid: true, columnsValidated: cols },
              },
            },
          ],
        };
      },
    };

    const cfg = loadConfig({ NODE_ENV: 'test' });
    const provider = new GeminiProvider(cfg, fakeClient as never);

    const request: GenerationRequest = {
      prompt: 'Please validate our statement table structure.',
      history: [],
      systemInstruction: 'You are ArcNave assistant.',
      mode: 'chat',
      maxOutputTokens: 1024,
      providerModelId: 'gemini-3.8-flash',
      grounded: false,
      codeExecution: false,
      signal: new AbortController().signal,
      tools: [
        {
          name: 'validate_statement_table',
          description: 'Validates tabular statement columns',
          inputSchema: {
            type: 'object',
            properties: {
              columns: { type: 'array', items: { type: 'string' } },
            },
            required: ['columns'],
          },
        },
      ],
      toolExecutor,
    };

    const events: any[] = [];
    for await (const event of provider.stream(request)) {
      events.push(event);
    }

    // Verification 1: Exactly 2 tool calls were executed in sequence
    expect(executedCalls).toHaveLength(2);
    expect(executedCalls[0]?.input).toEqual({ columns: ['date', 'amount'] });
    expect(executedCalls[1]?.input).toEqual({ columns: ['date', 'amount', 'balance'] });

    // Verification 2: Second call was a genuine repair turn
    expect((executedCalls[1]?.input as any).columns).toContain('balance');

    // Verification 3: Event stream captured full cycle
    const textEvents = events.filter((e) => e.type === 'delta').map((e) => (e as any).text);
    const fullText = textEvents.join('');
    expect(fullText).toContain('Table successfully validated');
  });
});
