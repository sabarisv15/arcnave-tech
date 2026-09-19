# GPT-6-Astra — functions/tools namespaces + shared MCP types
Source: OpenAI/Codex/gpt-6-astra.md

## Namespace: functions

### exec

Run JavaScript code to orchestrate/compose tool calls
- Evaluates the provided JavaScript code in a fresh V8 isolate as an async module.
- All nested tools are available on the global `tools` object, for example `await tools.exec_command(...)`. Tool names are exposed as normalized JavaScript identifiers, for example `await tools.mcp__ologs__get_profile(...)`.
- Nested tool methods take either a string or an object as their input argument.
- Nested tools return either an object or a string, based on the description.
- Runs raw JavaScript -- no Node, no file system, no network access, no console.
- Accepts raw JavaScript source text, not JSON, quoted strings, or markdown code fences.
- You may optionally start the tool input with a first-line pragma like `// @exec: {"yield_time_ms": 10000, "max_output_tokens": 1000}`.
- `yield_time_ms` asks `exec` to yield early if the script is still running. Defaults to 30000 ms.
- `max_output_tokens` sets the token budget for direct `exec` results. Defaults to 10000 tokens.
- When the JS code is fully evaluated, the isolate's lifetime ends and unawaited promises are silently discarded.

- Global helpers:
- `exit()`: Immediately ends the current script successfully (like an early return from the top level).
- `text(value: string | number | boolean | undefined | null)`: Appends a text item. Non-string values are stringified with `JSON.stringify(...)` when possible.
- `image(imageUrlOrItem: string | { image_url: string; detail?: "auto" | "low" | "high" | "original" | null } | ImageContent, detail?: "auto" | "low" | "high" | "original" | null)`: Appends an image item. `image_url` should be a base64-encoded `data:` URL. To forward an MCP tool image, pass an individual `ImageContent` block from `result.content`, for example `image(result.content[0])`. MCP image blocks may request detail with `_meta: { "codex/imageDetail": "original" }`. When provided, the second `detail` argument overrides any detail embedded in the first argument.
- `audio(audioUrlOrItem: string | { audio_url: string } | AudioContent)`: Appends an audio item. `audio_url` should be a base64-encoded `data:` URL. To forward an MCP tool audio block, pass an individual `AudioContent` block from `result.content`, for example `audio(result.content[0])`.
- `generatedImage(result: { image_url: string; output_hint?: string })`: Appends an image-generation result and its optional output hint. HTTP(S) URLs are not supported.
- `store(key: string, value: any)`: stores a serializable value under a string key for later `exec` calls in the same session.
- `load(key: string)`: returns the stored value for a string key, or `undefined` if it is missing.
- `notify(value: string | number | boolean | undefined | null)`: immediately injects an extra `custom_tool_call_output` for the current `exec` call. Values are stringified like `text(...)`.
- `setTimeout(callback: () => void, delayMs?: number)`: schedules a callback to run later and returns a timeout id. Pending timeouts do not keep `exec` alive by themselves; await an explicit promise if you need to wait for one.
- `clearTimeout(timeoutId?: number)`: cancels a timeout created by `setTimeout`.
- `ALL_TOOLS`: metadata for the enabled nested tools as `{ name, description }` entries.
- `yield_control()`: yields the accumulated output to the model immediately while the script keeps running.


```ts
declare const functions: { exec(input: string): Promise<any>; };
```

```lark
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
```

### wait

Waits on a yielded `exec` cell and returns new output or completion.
- Use `wait` only after `exec` returns `Script running with cell ID ...`.
- `cell_id` identifies the running `exec` cell to resume.
- `yield_time_ms` controls how long to wait for more output before yielding again. Defaults to 10000 ms.
- `max_tokens` limits how much new output this wait call returns. Defaults to 10000 tokens.
- `terminate: true` stops the running cell; false or omitted waits for output.
- `wait` returns only the new output since the last yield, or the final completion or termination result for that cell.
- If the cell is still running, `wait` may yield again with the same `cell_id`.
- If the cell has already finished, `wait` returns the completed result and closes the cell.

```ts
declare const functions: { wait(args: {
  // Identifier of the running exec cell.
  cell_id: string;
  // Output token budget for this wait call. Defaults to 10000 tokens.
  max_tokens?: number;
  // True stops the running exec cell; false or omitted waits for output.
  terminate?: boolean;
  // Wait before yielding more output. Defaults to 10000 ms.
  yield_time_ms?: number;
}): Promise<any>; };
```

### request_user_input

Request user input for one to three short questions and wait for the response. This tool is only available in Plan mode.

```ts
declare const functions: { request_user_input(args: {
  // Questions to show the user. Prefer 1 and do not exceed 3
  questions: Array<{
    // Short header label shown in the UI (12 or fewer chars).
    header: string;
    // Stable identifier for mapping answers (snake_case).
    id: string;
    // Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client will add a free-form "Other" option automatically.
    options: Array<{
      // One short sentence explaining impact/tradeoff if selected.
      description: string;
      // User-facing label (1-5 words).
      label: string;
    }>;
    // Single-sentence prompt shown to the user.
    question: string;
  }>;
}): Promise<any>; };
```

### request_user_input_async

Ask the user one or more questions during ongoing work. Use this tool only to request missing information, preferences, constraints, clarification, or approval. The tool returns immediately without ending the turn or waiting for a reply; any reply arrives asynchronously as a new user message. Keep questions concise, self-contained, and easy to understand, using a level of detail appropriate to the user and task. The UI always allows a free-text answer, including when suggested options are provided. A preselected option is not submitted automatically.

```ts
declare const functions: { request_user_input_async(args: {
  // One or more self-contained questions to present together, in display order.
  // minItems: 1
  questions: Array<{
    // Suggested answers, in display order. Put the recommended answer first; the first option is preselected by default. The user can select one option or enter a free-text answer. Do not include an Other option or a free-text placeholder; the UI provides free-text input automatically. Omit options for a free-text-only question.
    // minItems: 1
    options?: Array<string>;
    // The complete question shown to the user, including any context needed to answer it.
    title: string;
  }>;
}): Promise<any>; };
```


## Shared MCP types

```ts
type Role = "user" | "assistant";
type MetaObject = Record<string, unknown>;
type Annotations = {
  audience?: Role[];
  priority?: number;
  lastModified?: string;
};
type Icon = {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
};
type TextResourceContents = {
  uri: string;
  mimeType?: string;
  _meta?: MetaObject;
  text: string;
};
type BlobResourceContents = {
  uri: string;
  mimeType?: string;
  _meta?: MetaObject;
  blob: string;
};
type TextContent = {
  type: "text";
  text: string;
  annotations?: Annotations;
  _meta?: MetaObject;
};
type ImageContent = {
  type: "image";
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: MetaObject;
};
type AudioContent = {
  type: "audio";
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: MetaObject;
};
type ResourceLink = {
  icons?: Icon[];
  name: string;
  title?: string;
  uri: string;
  description?: string;
  mimeType?: string;
  annotations?: Annotations;
  size?: number;
  _meta?: MetaObject;
  type: "resource_link";
};
type EmbeddedResource = {
  type: "resource";
  resource: TextResourceContents | BlobResourceContents;
  annotations?: Annotations;
  _meta?: MetaObject;
};
type ContentBlock =
  | TextContent
  | ImageContent
  | AudioContent
  | ResourceLink
  | EmbeddedResource;
type CallToolResult<TStructured = { [key: string]: unknown }> = {
  _meta?: MetaObject;
  content: ContentBlock[];
  isError?: boolean;
  structuredContent?: TStructured;
  [key: string]: unknown;
};
```

## Namespace: tools

### apply_patch

The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.

exec tool declaration:  
```ts
declare const tools: { apply_patch(input: string): Promise<unknown>; };
```

### create_goal

Create a goal only when explicitly requested by the user or system/developer instructions; do not infer goals from ordinary tasks.  
Set token_budget only when an explicit token budget is requested. Fails if an unfinished goal exists; use update_goal only for status.

exec tool declaration:  
```ts
declare const tools: { create_goal(args: {
  // Required. The concrete objective to start pursuing. This starts a new active goal when no goal exists or replaces the current goal when it is complete.
  objective: string;
  // Positive token budget for the new goal. Omit unless explicitly requested.
  token_budget?: number;
}): Promise<unknown>; };
```

### exec_command

Runs a command in a PTY, returning output or a session ID for ongoing interaction.

exec tool declaration:  
```ts
declare const tools: { exec_command(args: {
  // Shell command to execute.
  cmd: string;
  // User-facing approval question for `require_escalated`; omit otherwise.
  justification?: string;
  // True runs the shell with -l/-i semantics; false disables them. Defaults to true.
  login?: boolean;
  // Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.
  max_output_tokens?: number;
  // Reusable approval prefix for `cmd`, only with `sandbox_permissions: "require_escalated"`; for example ["git", "pull"].
  prefix_rule?: Array<string>;
  // Per-command sandbox override. Defaults to `use_default`; use `require_escalated` for unsandboxed execution.
  sandbox_permissions?: "use_default" | "require_escalated";
  // Shell binary to launch. Defaults to the user's default shell.
  shell?: string;
  // True allocates a PTY for the command; false or omitted uses plain pipes.
  tty?: boolean;
  // Working directory for the command. Defaults to the turn cwd.
  workdir?: string;
  // Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms.
  yield_time_ms?: number;
}): Promise<{
  // Chunk identifier included when the response reports one.
  chunk_id?: string;
  // Process exit code when the command finished during this call.
  exit_code?: number;
  // Approximate token count before output truncation.
  original_token_count?: number;
  // Command output text, possibly truncated.
  output: string;
  // Session identifier to pass to write_stdin when the process is still running.
  session_id?: number;
  // Elapsed wall time spent waiting for output in seconds.
  wall_time_seconds: number;
}>; };
```

### get_context_remaining

Get the remaining tokens in the current context window.

exec tool declaration:  
```ts
declare const tools: { get_context_remaining(args: {}): Promise<{
  // Remaining tokens in the current context window, or null when unavailable.
  tokens_left: number | null;
}>; };
```

### get_goal

Get the current goal for this thread, including status, budgets, token and elapsed-time usage, and remaining token budget.

exec tool declaration:  
```ts
declare const tools: { get_goal(args: {}): Promise<unknown>; };
```

### list_mcp_resource_templates

Lists resource templates provided by MCP servers. Parameterized resource templates allow servers to share data that takes parameters and provides context to language models, such as files, database schemas, or application-specific information. Prefer resource templates over web search when possible.

exec tool declaration:  
```ts
declare const tools: { list_mcp_resource_templates(args: {
  // Opaque cursor from a previous list_mcp_resource_templates call; omit for the first page.
  cursor?: string;
  // MCP server name. Omit to list resource templates from every configured server.
  server?: string;
}): Promise<unknown>; };
```

### list_mcp_resources

Lists resources provided by MCP servers. Resources allow servers to share data that provides context to language models, such as files, database schemas, or application-specific information. Prefer resources over web search when possible.

exec tool declaration:  
```ts
declare const tools: { list_mcp_resources(args: {
  // Opaque cursor from a previous list_mcp_resources call; omit for the first page.
  cursor?: string;
  // MCP server name. Omit to list resources from every configured server.
  server?: string;
}): Promise<unknown>; };
```

### read_mcp_resource

Read a specific resource from an MCP server given the server name and resource URI.

exec tool declaration:  
```ts
declare const tools: { read_mcp_resource(args: {
  // MCP server name exactly as configured. Must match the 'server' field returned by list_mcp_resources.
  server: string;
  // Resource URI to read. Must be one of the URIs returned by list_mcp_resources.
  uri: string;
}): Promise<unknown>; };
```

### request_plugin_install

#### Suggest a recommended plugin installation

Use this tool only when all of the following are true:
- The user explicitly asks to use a specific plugin that is not already available in the current context or active `tools` list.
- Tool search has already been exhausted and did not find or make the requested tool callable.
- The plugin is listed in `<recommended_plugins>`.

Do not use it for adjacent capabilities, broad recommendations, or plugins that merely seem useful. Briefly explain why the plugin can help with the current request in `suggest_reason`.

IMPORTANT: DO NOT call this tool in parallel with other tools.

exec tool declaration:  
```ts
declare const tools: { request_plugin_install(args: {
  // The parenthesized plugin ID from the `<recommended_plugins>` list.
  plugin_id: string;
  // Concise one-line user-facing reason why this plugin can help with the current request.
  suggest_reason: string;
}): Promise<unknown>; };
```

### update_goal

Update the existing goal.  
Use this tool only to mark the goal achieved or genuinely blocked.  
Set status to `complete` only when the objective has actually been achieved and no required work remains.  
Set status to `blocked` only when the same blocking condition has repeated for at least three consecutive goal turns, counting the original/user-triggered turn and any automatic continuations, and the agent cannot make meaningful progress without user input or an external-state change.  
If the user resumes a goal that was previously marked `blocked`, treat the resumed run as a fresh blocked audit. If the same blocking condition then repeats for at least three consecutive resumed goal turns, set status to `blocked` again.  
Once the blocked threshold is satisfied, do not keep reporting that you are still blocked while leaving the goal active; set status to `blocked`.  
Do not use `blocked` merely because the work is hard, slow, uncertain, incomplete, or would benefit from clarification.  
Do not mark a goal complete merely because its budget is nearly exhausted or because you are stopping work.  
You cannot use this tool to pause, resume, budget-limit, or usage-limit a goal; those status changes are controlled by the user or system.  
When marking a budgeted goal achieved with status `complete`, report the final token usage from the tool result to the user.

exec tool declaration:  
```ts
declare const tools: { update_goal(args: {
  // Required. Set to `complete` only when the objective is achieved and no required work remains. Set to `blocked` only after the same blocking condition has recurred for at least three consecutive goal turns and the agent is at an impasse. After a previously blocked goal is resumed, the resumed run starts a fresh blocked audit.
  status: "complete" | "blocked";
}): Promise<unknown>; };
```

### view_image

View a local image file from the filesystem when visual inspection is needed. Use this for images already available on disk.

exec tool declaration:  
```ts
declare const tools: { view_image(args: {
  // Image detail level. Defaults to `high`; use `original` to preserve exact resolution.
  detail?: "high" | "original";
  // Local filesystem path to an image file.
  path: string;
}): Promise<{
  // Image detail hint returned by view_image. Returns `high` for default resized behavior or `original` when original resolution is preserved.
  detail: "high" | "original";
  // Data URL for the loaded image.
  image_url: string;
}>; };
```

### write_stdin

Writes characters to an existing unified exec session and returns recent output.

exec tool declaration:  
```ts
declare const tools: { write_stdin(args: {
  // Bytes to write to stdin. Defaults to empty, which polls without writing.
  chars?: string;
  // Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.
  max_output_tokens?: number;
  // Identifier of the running unified exec session.
  session_id: number;
  // Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms; empty polls wait 5000-300000 ms by default.
  yield_time_ms?: number;
}): Promise<{
  // Chunk identifier included when the response reports one.
  chunk_id?: string;
  // Process exit code when the command finished during this call.
  exit_code?: number;
  // Approximate token count before output truncation.
  original_token_count?: number;
  // Command output text, possibly truncated.
  output: string;
  // Session identifier to pass to write_stdin when the process is still running.
  session_id?: number;
  // Elapsed wall time spent waiting for output in seconds.
  wall_time_seconds: number;
}>; };
```

