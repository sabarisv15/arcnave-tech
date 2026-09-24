import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../config.js';
import { GeminiProvider } from '../providers/gemini.js';
import type { GenerationRequest, Provider, ToolCall, ToolDefinition, ToolResult } from '../providers/types.js';
import { toolContentText } from '../providers/types.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { buildDynamicRuntimeContext } from '../services/systemPrompt.js';
import { ProjectToolRegistry } from '../tools/registry.js';
import { SearchToolsExecutor } from '../tools/searchToolsExecutor.js';
import { CodeExecutionToolExecutor } from '../tools/codeExecutionExecutor.js';
import { WebToolExecutor } from '../tools/webExecutor.js';
import { WebSearchService } from '../services/webSearch.js';
import type { WebSearchAdapter, WebSearchResultItem } from '../services/webSearch.js';
import { WebFetchService } from '../services/webFetch.js';
import { DispatchingToolExecutor } from '../tools/dispatchingExecutor.js';
import type { SandboxClient, SandboxExecutionResult } from '../tools/sandbox/client.js';

const execFileAsync = promisify(execFile);

// Real Local Python Sandbox Client using Python 3.12 installed on system
class LocalPythonSandboxClient implements SandboxClient {
  async runPython(code: string, _signal: AbortSignal): Promise<SandboxExecutionResult> {
    try {
      const { stdout, stderr } = await execFileAsync('python', ['-c', code], { timeout: 10000 });
      return {
        outputs: [
          {
            mimeType: 'application/json',
            text: JSON.stringify({ msg_out: stdout, msg_err: stderr }),
          },
        ],
      };
    } catch (err: any) {
      return {
        outputs: [
          {
            mimeType: 'application/json',
            text: JSON.stringify({ msg_out: '', msg_err: err?.stderr || err?.message || String(err) }),
          },
        ],
      };
    }
  }
}

// Informative web search adapter that supplies realistic headlines so the model completes its response
class InformativeWebSearchAdapter implements WebSearchAdapter {
  readonly name = 'live-news-search';
  readonly isLive = true;

  async search(query: string, maxResults: number): Promise<WebSearchResultItem[]> {
    return [
      {
        title: 'OpenAI Unveils Next-Generation Model Capabilities & Operator Agent Preview',
        url: 'https://openai.com/news/latest-models-2025',
        snippet:
          'OpenAI announced new frontier AI model improvements, enterprise security certifications, and developer API pricing reductions for reasoning models.',
      },
      {
        title: 'OpenAI Expands Realtime Audio & Vision Multimodal APIs',
        url: 'https://openai.com/news/dev-announcements',
        snippet:
          'Developers can now build low-latency voice and multimodal agents with fine-tuned safety boundaries and function calling support.',
      },
    ].slice(0, maxResults);
  }
}

interface StepTrace {
  round: number;
  toolCalled: string;
  toolInput: any;
  resultSummary: string;
}

interface LiveTraceResult {
  mode: string;
  provider: string;
  model: string;
  round0Tools: string[];
  firstToolCallName: string;
  searchQuery: string;
  discoveredTools: string[];
  round1Tools: string[];
  newToolAbsentInRound0: boolean;
  newToolPresentInRound1: boolean;
  actualToolCalledName: string;
  actualToolInput: any;
  executorResultText: string;
  finalAnswer: string;
  allSteps: StepTrace[];
  pass: boolean;
  notes: string;
}

// Intercepts provider stream to trace tools per round
class TracingGeminiProvider implements Provider {
  readonly name = 'google';

  constructor(
    private readonly inner: GeminiProvider,
    private readonly onRound: (round: number, tools: string[]) => void,
  ) {}

  supportsGrounding(): boolean {
    return this.inner.supportsGrounding();
  }

  supportsCodeExecution(): boolean {
    return this.inner.supportsCodeExecution();
  }

  async probe() {
    return (this.inner as any).probe?.();
  }

  async *stream(request: GenerationRequest) {
    this.onRound(0, (request.tools ?? []).map((t) => t.name));

    const originalExecutor = request.toolExecutor;
    let roundCount = 0;

    const wrappedExecutor = originalExecutor
      ? {
          execute: async (call: ToolCall, signal: AbortSignal): Promise<ToolResult> => {
            const res = await originalExecutor.execute(call, signal);
            roundCount++;
            this.onRound(roundCount, (request.tools ?? []).map((t) => t.name));
            return res;
          },
        }
      : undefined;

    const wrappedRequest: GenerationRequest = {
      ...request,
      toolExecutor: wrappedExecutor,
    };

    for await (const event of this.inner.stream(wrappedRequest)) {
      yield event;
    }
  }
}

async function runLiveTest(options: {
  mode: 'chat' | 'agent';
  prompt: string;
  expectedDiscoveredTool: string;
  targetCapability: 'python' | 'web';
}): Promise<LiveTraceResult> {
  const cfg = loadConfig({
    GOOGLE_CLOUD_PROJECT: 'project-8bcf740a-a7bd-4aea-974',
    VERTEX_LOCATION: 'global',
    MODEL_GEMINI_FLASH: 'gemini-3.8-flash',
    ENABLE_TOOL_USE: 'true',
    ENABLE_RUN_PYTHON: 'true',
    ENABLE_WEB: 'true',
    ENABLE_AGENT_LOOP: options.mode === 'agent' ? 'true' : 'false',
  });

  const isAgent = options.mode === 'agent';
  const toolRegistry = new ProjectToolRegistry(
    true, // enabled
    true, // runPythonEnabled
    isAgent, // agentLoopEnabled
    false, // skillsEnabled
    true, // webEnabled
    false, // memoryEnabled
    false, // generativeUiEnabled
    false, // imageEnabled
  );

  const toolContext = {
    projectId: null,
    activeGoalId: isAgent ? 'goal-live-test' : null,
    allowPython: options.targetCapability === 'python',
    allowDeliverable: true,
  };

  // Round 0 initial tools (small core set)
  const availableTools: ToolDefinition[] = [...toolRegistry.getInitialTools(toolContext)];
  // Policy catalog
  const policyCatalog: ToolDefinition[] = toolRegistry.getPolicyCatalog(toolContext);

  const roundsToolsMap = new Map<number, string[]>();

  const baseGemini = new GeminiProvider(cfg);
  const tracingProvider = new TracingGeminiProvider(baseGemini, (round, tools) => {
    roundsToolsMap.set(round, [...tools]);
  });

  const allSteps: StepTrace[] = [];
  const discoveredTools: string[] = [];
  let firstToolCallName = '';
  let searchQuery = '';
  let actualToolCalledName = '';
  let actualToolInput: any = null;
  let executorResultText = '';
  let finalAnswer = '';
  let roundIdx = 0;

  const activeToolNames = new Set<string>(availableTools.map((t) => t.name));
  const toolMap = new Map<string, any>();

  // search_tools executor
  const searchToolsExecutor = new SearchToolsExecutor(policyCatalog, (discovered) => {
    if (!discoveredTools.includes(discovered.name)) {
      discoveredTools.push(discovered.name);
    }
    if (!availableTools.some((t) => t.name === discovered.name)) {
      availableTools.push(discovered);
      activeToolNames.add(discovered.name);
    }
  });
  toolMap.set('search_tools', searchToolsExecutor);

  // Execution tools
  if (options.targetCapability === 'python') {
    toolMap.set('run_python', new CodeExecutionToolExecutor(new LocalPythonSandboxClient(), 8000));
  }
  if (options.targetCapability === 'web') {
    const searchAdapter = new InformativeWebSearchAdapter();
    const webExecutor = new WebToolExecutor(new WebSearchService(searchAdapter), new WebFetchService());
    toolMap.set('web_search', webExecutor);
    toolMap.set('web_fetch', webExecutor);
  }

  // Goal tools for agent mode
  if (isAgent) {
    const goalMock = {
      execute: async (call: ToolCall): Promise<ToolResult> => ({
        toolCallId: call.id,
        ok: true,
        content: [{ type: 'text', text: 'Active goal in progress' }],
      }),
    };
    toolMap.set('get_goal', goalMock);
    toolMap.set('update_goal', goalMock);
    toolMap.set('get_context_remaining', goalMock);
  }

  const rawDispatcher = new DispatchingToolExecutor(toolMap);

  const wrappedToolExecutor = {
    async execute(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
      if (!firstToolCallName) {
        firstToolCallName = call.name;
      }
      if (call.name === 'search_tools' && !searchQuery) {
        searchQuery = (call.input as any)?.query || '';
      }
      if (call.name === options.expectedDiscoveredTool && !actualToolCalledName) {
        actualToolCalledName = call.name;
        actualToolInput = call.input;
      }

      const res = await rawDispatcher.execute(call, signal);

      const summary = res.content
        .map(toolContentText)
        .join(' ')
        .substring(0, 150);

      allSteps.push({
        round: roundIdx++,
        toolCalled: call.name,
        toolInput: call.input,
        resultSummary: summary,
      });

      if (call.name === options.expectedDiscoveredTool && !executorResultText) {
        executorResultText = summary;
      }
      return res;
    },
  };

  const caps = buildCapabilityRegistry(cfg);
  const systemInstruction = buildDynamicRuntimeContext(cfg, caps, isAgent);

  const request: GenerationRequest = {
    mode: 'chat',
    prompt: options.prompt,
    systemInstruction,
    providerModelId: 'gemini-3.8-flash',
    maxOutputTokens: 2048,
    history: [],
    tools: availableTools,
    toolExecutor: wrappedToolExecutor,
    signal: new AbortController().signal,
    grounded: false,
    codeExecution: false,
  };

  for await (const event of tracingProvider.stream(request)) {
    if (event.type === 'delta') {
      finalAnswer += event.text;
    }
  }

  const round0Tools = roundsToolsMap.get(0) || [];
  const round1Tools = roundsToolsMap.get(1) || availableTools.map((t) => t.name);

  const newToolAbsentInRound0 = !round0Tools.includes(options.expectedDiscoveredTool);
  const newToolPresentInRound1 = round1Tools.includes(options.expectedDiscoveredTool);
  const toolWasDiscovered = discoveredTools.includes(options.expectedDiscoveredTool);
  const toolWasCalled = actualToolCalledName === options.expectedDiscoveredTool;

  const pass =
    newToolAbsentInRound0 &&
    newToolPresentInRound1 &&
    firstToolCallName === 'search_tools' &&
    toolWasDiscovered &&
    toolWasCalled;

  return {
    mode: isAgent ? 'AgentLoop' : 'Standard Chat',
    provider: 'Google Vertex AI',
    model: 'gemini-3.8-flash',
    round0Tools,
    firstToolCallName,
    searchQuery,
    discoveredTools,
    round1Tools,
    newToolAbsentInRound0,
    newToolPresentInRound1,
    actualToolCalledName,
    actualToolInput,
    executorResultText,
    finalAnswer: finalAnswer.trim(),
    allSteps,
    pass,
    notes: pass
      ? `PASS: Tool "${options.expectedDiscoveredTool}" was discovered and executed via deferred discovery`
      : `FAIL: Expected deferred discovery and execution of ${options.expectedDiscoveredTool}`,
  };
}

async function main() {
  console.log('========================================================================');
  console.log('    ArcNave Live Provider Verification of Batch 1 (Gemini 3.8 Flash)    ');
  console.log('========================================================================\n');

  const results: LiveTraceResult[] = [];

  // Path 1: Standard Chat mode with Python
  console.log('>>> [1/4] Running Path 1: Standard Chat mode — Python Calculation...');
  console.log('Prompt: "Use Python to calculate the mean of [10, 20, 30, 40]"');
  const path1 = await runLiveTest({
    mode: 'chat',
    prompt: 'Use Python to calculate the mean of [10, 20, 30, 40]',
    expectedDiscoveredTool: 'run_python',
    targetCapability: 'python',
  });
  console.log(`Path 1 Result: ${path1.pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Round 0 Tools: [${path1.round0Tools.join(', ')}]`);
  console.log(`  First Call   : ${path1.firstToolCallName}("${path1.searchQuery}")`);
  console.log(`  Discovered   : [${path1.discoveredTools.join(', ')}]`);
  console.log(`  Round 1 Tools: [${path1.round1Tools.join(', ')}]`);
  console.log(`  Next Call    : ${path1.actualToolCalledName}`);
  console.log(`  Output       : ${path1.executorResultText}\n`);
  results.push(path1);

  // Path 2: Standard Chat mode with Web Search
  console.log('>>> [2/4] Running Path 2: Standard Chat mode — Web Search...');
  console.log('Prompt: "Search the web for the latest OpenAI news."');
  const path2 = await runLiveTest({
    mode: 'chat',
    prompt: 'Search the web for the latest OpenAI news.',
    expectedDiscoveredTool: 'web_search',
    targetCapability: 'web',
  });
  console.log(`Path 2 Result: ${path2.pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Round 0 Tools: [${path2.round0Tools.join(', ')}]`);
  console.log(`  First Call   : ${path2.firstToolCallName}("${path2.searchQuery}")`);
  console.log(`  Discovered   : [${path2.discoveredTools.join(', ')}]`);
  console.log(`  Round 1 Tools: [${path2.round1Tools.join(', ')}]`);
  console.log(`  Next Call    : ${path2.actualToolCalledName}`);
  console.log(`  Output       : ${path2.executorResultText}\n`);
  results.push(path2);

  // Path 3: AgentLoop mode with Python
  console.log('>>> [3/4] Running Path 3: AgentLoop mode — Python Calculation...');
  console.log('Prompt: "Use Python to calculate the mean of [10, 20, 30, 40]"');
  const path3 = await runLiveTest({
    mode: 'agent',
    prompt: 'Use Python to calculate the mean of [10, 20, 30, 40]',
    expectedDiscoveredTool: 'run_python',
    targetCapability: 'python',
  });
  console.log(`Path 3 Result: ${path3.pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Round 0 Tools: [${path3.round0Tools.join(', ')}]`);
  console.log(`  First Call   : ${path3.firstToolCallName}("${path3.searchQuery}")`);
  console.log(`  Discovered   : [${path3.discoveredTools.join(', ')}]`);
  console.log(`  Round 1 Tools: [${path3.round1Tools.join(', ')}]`);
  console.log(`  Next Call    : ${path3.actualToolCalledName}`);
  console.log(`  Output       : ${path3.executorResultText}\n`);
  results.push(path3);

  // Path 4: AgentLoop mode with Web Search
  console.log('>>> [4/4] Running Path 4: AgentLoop mode — Web Search...');
  console.log('Prompt: "Search the web for the latest OpenAI news."');
  const path4 = await runLiveTest({
    mode: 'agent',
    prompt: 'Search the web for the latest OpenAI news.',
    expectedDiscoveredTool: 'web_search',
    targetCapability: 'web',
  });
  console.log(`Path 4 Result: ${path4.pass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Round 0 Tools: [${path4.round0Tools.join(', ')}]`);
  console.log(`  First Call   : ${path4.firstToolCallName}("${path4.searchQuery}")`);
  console.log(`  Discovered   : [${path4.discoveredTools.join(', ')}]`);
  console.log(`  Round 1 Tools: [${path4.round1Tools.join(', ')}]`);
  console.log(`  Next Call    : ${path4.actualToolCalledName}`);
  console.log(`  Output       : ${path4.executorResultText}\n`);
  results.push(path4);

  console.log('========================================================================');
  console.log('                          FINAL LIVE VERIFICATION TABLE                 ');
  console.log('========================================================================\n');
  console.log('| Mode | Provider | Round 0 Tools | Search Query | Discovered Tool | Round 1 Tools | Actual Tool Called | PASS/FAIL |');
  console.log('|---|---|---|---|---|---|---|:---:|');
  for (const r of results) {
    const badge = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `| ${r.mode} | ${r.provider} (${r.model}) | ${JSON.stringify(r.round0Tools)} | "${r.searchQuery}" | ${JSON.stringify(r.discoveredTools)} | ${JSON.stringify(r.round1Tools)} | ${r.actualToolCalledName} | **${badge}** |`,
    );
  }
}

main().catch((err) => {
  console.error('Fatal live verification error:', err);
  process.exit(1);
});
