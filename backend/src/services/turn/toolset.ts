/**
 * The tool executors a turn runs its declared tools with. Cut from the turn generator
 * unchanged (ADR-0067).
 */
import type { ToolDefinition, ToolExecutor, Turn } from '../../providers/types.js';
import { CodeExecutionToolExecutor } from '../../tools/codeExecutionExecutor.js';
import { DispatchingToolExecutor, toolTimeouts } from '../../tools/dispatchingExecutor.js';
import { ProjectToolExecutor } from '../../tools/executor.js';
import { WebToolExecutor } from '../../tools/webExecutor.js';
import { WebFetchService } from '../webFetch.js';
import { WebSearchService, buildWebSearchAdapter } from '../webSearch.js';
import type { MessageSegment } from '../../db/schema.js';
import { memoryService } from '../memory/memoryService.js';
import { MemoryToolExecutor } from '../../tools/memoryExecutor.js';
import { ChatToolExecutor } from '../../tools/chatExecutor.js';
import { CHAT_TOOL_DEFINITIONS, CODE_TOOL_NAMES, MEMORY_TOOL_DEFINITIONS, UI_TOOL_DEFINITIONS } from '../../tools/definitions.js';
import { UIToolExecutor } from '../../tools/uiExecutor.js';
import { AskUserInputExecutor } from '../../tools/optionsExecutor.js';
import { UIAuthorizer } from '../ui/authorizer.js';
import type { WorkspaceFiles } from '../../tools/execution/executionRuntime.js';
import type { TurnServices } from './services.js';
import type { StreamEvent } from './events.js';
import type { GenerateInput } from './input.js';

/** What the turn hands the toolset: every value the executors are built from. */
export interface ToolsetInput {
  input: GenerateInput;
  project: { id: string; title: string; instructions: string } | null;
  availableTools: ToolDefinition[];
  history: Turn[];
  webEnabled: boolean;
  webSearchAdapter: ReturnType<typeof buildWebSearchAdapter>;
  memoryEnabled: boolean;
  chatSearchEnabled: boolean;
  generativeUiEnabled: boolean;
  allowCode: boolean;
  workspace: WorkspaceFiles;
  /** The answer's timeline: a visual shown by a tool joins it as a `ui` segment. */
  segments: MessageSegment[];
}

/**
 * The executors behind this turn's declared tools, keyed by tool name. Moved out of the turn
 * generator unchanged (ADR-0067; D3 A-13 "buildToolset").
 */
export function buildToolExecutors(
  svc: TurnServices,
  turn: ToolsetInput,
): {
  pendingUiEvents: StreamEvent[];
  toolMap: Map<string, ToolExecutor>;
  codeExecutor: CodeExecutionToolExecutor | undefined;
  toolExecutor: DispatchingToolExecutor | undefined;
} {
  const {
    input,
    project,
    availableTools,
    history,
    webEnabled,
    webSearchAdapter,
    memoryEnabled,
    chatSearchEnabled,
    generativeUiEnabled,
    allowCode,
    workspace,
    segments,
  } = turn;
  const projectToolExecutor =
    availableTools.length > 0 && project !== null && svc.cfg.ENABLE_TOOL_USE
      ? new ProjectToolExecutor(svc.db, svc.retriever, project.id, svc.cfg.READ_PROJECT_FILE_MAX_CHARS)
      : undefined;

  const webToolExecutor = webEnabled
    ? new WebToolExecutor(new WebSearchService(webSearchAdapter), new WebFetchService(), webSearchAdapter)
    : undefined;
  // web_fetch opens only URLs already in the conversation: the user's, or a search's.
  webToolExecutor?.allowUrlsIn(input.prompt, JSON.stringify(history));

  const memoryToolExecutor = memoryEnabled
    ? new MemoryToolExecutor(memoryService, input.userId, project?.id ?? null)
    : undefined;
  const chatToolExecutor = chatSearchEnabled
    ? new ChatToolExecutor(input.userId, project?.id ?? null, input.chatId)
    : undefined;

  const pendingUiEvents: StreamEvent[] = [];
  const uiAuthorizer = new UIAuthorizer(svc.db);
  const uiToolExecutor = generativeUiEnabled
    ? new UIToolExecutor(
        uiAuthorizer,
        { userId: input.userId, chatId: input.chatId, projectId: project?.id ?? null },
        svc.cfg.UI_MAX_RESPONSE_BYTES,
        (block) => {
          const last = segments.at(-1);
          if (last?.type === 'ui') last.blockIds.push(block.blockId);
          else segments.push({ type: 'ui', blockIds: [block.blockId] });
          pendingUiEvents.push({
            type: 'ui_block',
            block,
          });
        },
        webSearchAdapter,
      )
    : undefined;

  const toolMap = new Map<string, ToolExecutor>();
  if (svc.cfg.ENABLE_TOOL_USE) {
    toolMap.set('ask_user_input_v0', new AskUserInputExecutor());
  }
  if (uiToolExecutor) {
    for (const d of UI_TOOL_DEFINITIONS) toolMap.set(d.name, uiToolExecutor);
  }
  if (webToolExecutor) {
    for (const name of ['web_search', 'web_fetch', 'image_search']) toolMap.set(name, webToolExecutor);
  }
  if (memoryToolExecutor) {
    for (const d of MEMORY_TOOL_DEFINITIONS) toolMap.set(d.name, memoryToolExecutor);
  }
  if (chatToolExecutor) {
    for (const d of CHAT_TOOL_DEFINITIONS) toolMap.set(d.name, chatToolExecutor);
  }
  if (projectToolExecutor) {
    toolMap.set('search_project_files', projectToolExecutor);
    toolMap.set('read_project_file', projectToolExecutor);
  }
  let codeExecutor: CodeExecutionToolExecutor | undefined;
  if (allowCode) {
    codeExecutor = new CodeExecutionToolExecutor(svc.executionRuntime, svc.cfg.RUN_PYTHON_MAX_OUTPUT_CHARS, {
      workspace,
      userId: input.userId,
      messageId: input.messageId,
      chatId: input.chatId,
      db: svc.db,
      storage: svc.storage,
      skills: svc.skills,
    });
    for (const name of CODE_TOOL_NAMES) toolMap.set(name, codeExecutor);
  }

  // P11 (ER-4c): N-43 tool timers.
  const toolExecutor = toolMap.size > 0 ? new DispatchingToolExecutor(toolMap, toolTimeouts(svc.cfg)) : undefined;
  return { pendingUiEvents, toolMap, codeExecutor, toolExecutor };
}
