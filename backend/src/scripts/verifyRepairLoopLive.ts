/**
 * Live Gemini Multi-Turn Tool Repair Loop Verification
 *
 * Verifies the exact sequence:
 * MODEL -> tool call #1 -> warning tool result -> MODEL -> tool call #2 (corrective) -> pass result -> final response
 */
import { loadConfig } from '../config.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest, ToolCall, ToolResult, ToolDefinition } from '../providers/types.js';

interface CapturedStep {
  round: number;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  text?: string;
}

async function main() {
  console.log('================================================================');
  console.log('   LIVE GEMINI MULTI-TURN TOOL REPAIR LOOP VERIFICATION        ');
  console.log('================================================================\n');

  const cfg = loadConfig();
  const provider = new GeminiProvider(cfg);
  const modelId = cfg.MODEL_GEMINI_FLASH ?? 'gemini-3.8-flash';

  const callsHistory: Array<{ call: ToolCall; result: ToolResult }> = [];

  const validateToolDef: ToolDefinition = {
    name: 'validate_ledger_schema',
    description: 'Validates columns of a financial ledger against compliance rules. Returns a warning if any required column is missing, or status pass if valid.',
    inputSchema: {
      type: 'object',
      properties: {
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'The list of column names in the ledger.',
        },
      },
      required: ['columns'],
    },
  };

  const repairExecutor = {
    execute: async (call: ToolCall): Promise<ToolResult> => {
      const input = call.input as { columns?: string[] };
      const columns = input.columns ?? [];

      if (!columns.includes('tax_id')) {
        const res: ToolResult = {
          toolCallId: call.id,
          ok: true,
          content: [
            {
              type: 'json',
              data: {
                status: 'warning',
                warnings: [
                  {
                    type: 'missing_required_column',
                    message: 'Validation warning: column "tax_id" is required for corporate ledger compliance.',
                    repairable: true,
                  },
                ],
                recommendation: 'Add "tax_id" to columns and re-call validate_ledger_schema.',
              },
            },
          ],
        };
        callsHistory.push({ call, result: res });
        return res;
      }

      const res: ToolResult = {
        toolCallId: call.id,
        ok: true,
        content: [
          {
            type: 'json',
            data: {
              status: 'pass',
              message: 'All required columns (including tax_id) are present and verified.',
              columns,
            },
          },
        ],
      };
      callsHistory.push({ call, result: res });
      return res;
    },
  };

  const req: GenerationRequest = {
    prompt: 'Validate our initial ledger columns: ["date", "description", "amount"]. If validate_ledger_schema returns any warning about missing columns, you must immediately call validate_ledger_schema again with the corrected list of columns until you obtain a pass result. After obtaining the pass result, summarize the final compliant schema.',
    history: [],
    systemInstruction: 'You are an autonomous accounting compliance assistant. When validating schemas, if validate_ledger_schema returns a warning or recommendation, you MUST invoke validate_ledger_schema again with the repaired columns list. Do not stop until you receive status pass.',
    mode: 'chat',
    maxOutputTokens: 2000,
    providerModelId: modelId,
    grounded: false,
    codeExecution: false,
    tools: [validateToolDef],
    toolExecutor: repairExecutor,
    signal: new AbortController().signal,
  };

  console.log(`Starting stream with model: ${modelId}`);
  let finalResponse = '';
  const events: any[] = [];

  for await (const ev of provider.stream(req)) {
    events.push(ev);
    if (ev.type === 'tool_use') {
      console.log(`\n[EVENT: tool_use] ${ev.name} | callId: ${ev.toolCallId}`);
      console.log(`Args:`, JSON.stringify(ev.input));
    } else if (ev.type === 'tool_result') {
      console.log(`[EVENT: tool_result] ${ev.name} | callId: ${ev.toolCallId}`);
      console.log(`Result:`, JSON.stringify(ev.result.content));
    } else if (ev.type === 'delta') {
      finalResponse += ev.text;
    }
  }

  console.log('\n================================================================');
  console.log('   CAPTURED MULTI-TURN TRACE                                    ');
  console.log('================================================================\n');

  console.log(`Total tool calls executed: ${callsHistory.length}`);

  if (callsHistory.length >= 2) {
    console.log('\n--- 1. FIRST TOOL CALL ---');
    console.log(`Name: ${callsHistory[0]!.call.name}`);
    console.log(`Args: ${JSON.stringify(callsHistory[0]!.call.input)}`);

    console.log('\n--- 2. WARNING TOOL RESULT ---');
    console.log(JSON.stringify(callsHistory[0]!.result.content, null, 2));

    console.log('\n--- 3 & 4. SECOND (CORRECTIVE) TOOL CALL ---');
    console.log(`Name: ${callsHistory[1]!.call.name}`);
    console.log(`Args: ${JSON.stringify(callsHistory[1]!.call.input)}`);

    console.log('\n--- 5. SECOND TOOL RESULT ---');
    console.log(JSON.stringify(callsHistory[1]!.result.content, null, 2));

    console.log('\n--- 6. FINAL MODEL RESPONSE ---');
    console.log(finalResponse.trim());

    const hasTaxIdInSecondCall = JSON.stringify(callsHistory[1]!.call.input).includes('tax_id');
    const secondCallPassed = JSON.stringify(callsHistory[1]!.result.content).includes('"status":"pass"');

    if (hasTaxIdInSecondCall && secondCallPassed) {
      console.log('\n>>> REPAIR LOOP TEST: SUCCESSFUL MULTI-TURN REPAIR CONFIRMED <<<');
      process.exit(0);
    } else {
      console.error('\n>>> REPAIR LOOP TEST FAILED: Second call did not include tax_id or did not pass <<<');
      process.exit(1);
    }
  } else {
    console.error(`\n>>> REPAIR LOOP TEST FAILED: Expected at least 2 tool calls, got ${callsHistory.length} <<<`);
    console.log('Final text received:', finalResponse);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
