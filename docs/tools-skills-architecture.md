# Tools & skills architecture — as built

Traced from code on 2026-09-24 (`backend/src`). Describes what runs today, not the intended
design. Line refs are to `services/generation.ts` unless noted.

## One turn, start to finish

```mermaid
flowchart TD
    U["User message<br/>POST /chats/:id/generate<br/>(routes/chats.ts)"] --> G["GenerationService.stream"]
    G --> M["resolveModel + capability checks<br/>grounding / code-exec / vision<br/>→ ApiError capability_unavailable"]
    M --> R["routeTurn()<br/>services/routing/turnRouter.ts<br/>regex intent detection"]

    R --> RD["TurnRoutingDecision<br/>• detectedIntent<br/>• allowedTools (policy catalog names)<br/>• exposedTools ([] or ['search_tools'])<br/>• pythonExposed (capabilityPolicy.ts)"]

    subgraph SK["Skills (backend/skills/*/SKILL.md)"]
        SS["SkillService<br/>frontmatter: requires.tools,<br/>capabilities, autoload"]
        SC["skillsContext in system prompt<br/>&lt;available_skills&gt; name: description<br/>+ 'call load_skill'"]
        SS --> SC
    end

    subgraph TR["Tool resolution"]
        PTR["ProjectToolRegistry<br/>ENABLE_* flags"]
        PC["policyCatalog<br/>getPolicyCatalog ∩ allowedTools"]
        IT["initial tools (Round 0)<br/>search_tools + load_skill<br/>only if exposedTools non-empty"]
        PTR --> PC
        PTR --> IT
    end

    RD --> SK
    RD --> TR

    SC --> SP["buildSystemInstruction<br/>(systemPrompt.ts)"]
    IT --> SP

    SP --> AL{"shouldRouteToAgentLoop?<br/>research mode, or python+codeExec+attachments,<br/>or compare/synthesize…across/sources"}
    AL -- yes --> AG["AgentLoop.stream<br/>services/agentLoop.ts<br/>own registry + goal tools<br/>AGENT_MAX_STEPS=12, MAX_TOOL_CALLS=30"]
    AL -- no --> TM["Build toolMap: name → executor"]

    TM --> DX["DispatchingToolExecutor"]
    DX --> PV["Provider adapter round loop<br/>gemini.ts / anthropicVertex.ts<br/>TOOL_MAX_ROUNDS=8, 1 tool call per round"]

    PV -- "tool call" --> DX
    DX --> EX

    subgraph EX["Executors (tools/*)"]
        E1["SearchToolsExecutor<br/>search_tools"]
        E2["SkillToolExecutor<br/>load_skill, list/search/read_skill"]
        E3["Artifact · Upload · Web · Memory · UI<br/>Project · Image · Deliverable"]
        E4["CodeExecutionToolExecutor<br/>run_python (only if allowPython)"]
        E5["FileOperationExecutor<br/>12 pdf/xlsx/docx/pptx ops"]
    end

    E1 -. "onToolDiscovered: push schema<br/>into availableTools" .-> PV
    E2 -. "returns full SKILL.md body<br/>as tool result" .-> PV
    PV --> OUT["SSE stream: delta / sources / tool events<br/>artifact_created / ui_block → persist + usage"]
```

## Progressive disclosure, in one line

Round 0 the model sees only `search_tools` (+ `load_skill`). It calls `load_skill` for domain
rules, then `search_tools` to pull matching schemas from the policy catalog into the active tool
list, then calls the real tool on a later round.

## Tool inventory

| Group | Tools | Gate |
|---|---|---|
| Discovery | `search_tools` | `ENABLE_TOOL_USE` |
| Skills | `load_skill`, `list_skills`, `search_skills`, `read_skill` | `ENABLE_SKILLS` + ≥1 skill |
| Artifacts | `create_artifact`, `read_artifact`, `update_artifact` | tool use |
| Uploads | `read_uploaded_file` | tool use + attachments (router) |
| Deliverable | `generate_deliverable` | tool use (router always allows) |
| File ops | `inspectPdf`, `mergePdfFiles`, `splitPdfFile`, `inspectSpreadsheet`, `editSpreadsheetCells`, `combineWorkbooks`, `inspectDocxStructure`, `editDocxContent`, `appendDocxSection`, `inspectPptxStructure`, `reorderPptxSlides`, `editPptxSlideText` | tool use |
| Web | `web_search`, `web_fetch` | `ENABLE_WEB` |
| Memory | `search_memory`, `read_memory`, `update_memory`, `forget_memory` | `ENABLE_MEMORY` |
| Image | `generate_image` | `ENABLE_IMAGE_GENERATION` |
| Project | `search_project_files`, `read_project_file` | project attached |
| Code | `run_python` | `ENABLE_RUN_PYTHON` + sandbox + `evaluateRunPythonPolicy` |
| UI | `render_ui` | `ENABLE_GENERATIVE_UI` — see gaps |
| Goals (AgentLoop only) | `get_goal`, `update_goal`, `get_context_remaining` | `ENABLE_AGENT_LOOP` + active goal |

Built-in skills: `artifact-design`, `dashboard-design`, `data-analysis`, `data-quality`,
`dataviz`, `docx`, `pdf`, `pptx`, `python-sandbox-patterns`, `research-deep-dive`,
`skill-creator`, `xlsx`.

## Gaps found while tracing

1. **`render_ui` is unreachable in the chat path.** `computeAllowedTools` never adds it, and the
   policy catalog is filtered by `allowedTools`, so `search_tools` can never surface it.
2. **Skills are advertised when `load_skill` is not sent.** On `EXPLANATION` and `ORDINARY_CHAT`
   intents `exposedTools` is `[]`, so no tools go to the provider — but `skillsContext` still
   tells the model to call `load_skill`.
3. **`evaluateDeliverablePolicy` is dead.** `shouldExposeGenerateDeliverable` is imported but
   unused; `allowDeliverable` is always true because the router always allows
   `generate_deliverable`.
4. **"Summarize this PDF" gets no tools.** It matches `EXPLANATION`, so `read_uploaded_file` is
   not reachable; only inlined `attachmentText` is available.
5. **Agent-loop routing is duplicated.** `isAgentMode` and `shouldRouteToAgentLoop` repeat the
   same heuristic separately and can drift.
