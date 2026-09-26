import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { buildCapabilityRegistry } from '../capabilities/factory.js';
import { buildDynamicRuntimeContext } from '../services/systemPrompt.js';
import type { ToolDefinition } from '../providers/types.js';
import {
  DISCOVERY_TOOL_DEFINITIONS,
  GENERATE_DELIVERABLE,
  GET_CONTEXT_REMAINING,
  GET_GOAL,
  LOAD_SKILL,
  RUN_PYTHON,
  SEARCH_TOOLS,
  UPDATE_GOAL,
} from './definitions.js';
import { ProjectToolRegistry } from './registry.js';
import { SearchToolsExecutor } from './searchToolsExecutor.js';

describe('Batch 1: Deferred Tool Discovery Architecture', () => {
  const fullRegistry = new ProjectToolRegistry(
    true,  // enabled
    true,  // runPythonEnabled
    true,  // agentLoopEnabled
    true,  // skillsEnabled
    true,  // webEnabled
    true,  // memoryEnabled
    true,  // generativeUiEnabled
    true,  // imageEnabled
  );

  describe('1. Initial Provider Schemas Strictness (Round 0)', () => {
    it('standard chat declares discovery plus the allowed every-turn tools in Round 0, nothing else (ADR-0022)', () => {
      const initialTools = fullRegistry.getInitialTools({
        projectId: null,
        allowPython: true,
        allowDeliverable: true,
      });

      const initialNames = initialTools.map((t) => t.name);

      // Claude docs, Tool search: "Keep your 3–5 most frequently used tools non-deferred".
      expect(initialNames).toEqual([
        'search_tools',
        'load_skill',
        'read_uploaded_file',
        'generate_deliverable',
        // Memory is saved as the user chats (ADR-0025), so its tools are in hand.
        'save_memory',
        'search_chats',
        'forget_memory',
        'run_python',
      ]);

      // Everything else stays discoverable
      expect(initialNames).not.toContain('web_search');
      expect(initialNames).not.toContain('web_fetch');
      expect(initialNames).not.toContain('generate_image');
      expect(initialNames).not.toContain('create_artifact');
      expect(initialNames).not.toContain('search_project_files');
      expect(initialNames).not.toContain('render_ui');
      expect(initialNames).not.toContain('search_memory');

      // Goal tools must NOT be present without an active goal
      expect(initialNames).not.toContain('get_goal');
      expect(initialNames).not.toContain('update_goal');
      expect(initialNames).not.toContain('get_context_remaining');
    });

    it('AgentLoop mode exposes goal bookkeeping tools alongside search_tools and load_skill', () => {
      const initialTools = fullRegistry.getInitialTools({
        projectId: null,
        activeGoalId: 'goal-123',
        allowPython: true,
        allowDeliverable: true,
      });

      const initialNames = initialTools.map((t) => t.name);

      expect(initialNames).toEqual([
        'search_tools',
        'load_skill',
        'get_goal',
        'update_goal',
        'get_context_remaining',
        'read_uploaded_file',
        'generate_deliverable',
        'save_memory',
        'search_chats',
        'forget_memory',
        'run_python',
      ]);

      // Everything else is still discovered, not declared
      expect(initialNames).not.toContain('web_search');
    });

    it('returns empty array when tool use is disabled', () => {
      const disabledRegistry = new ProjectToolRegistry(false, true, true, true, true);
      expect(disabledRegistry.getInitialTools({ projectId: 'p1', activeGoalId: 'g1' })).toEqual([]);
    });
  });

  describe('2. Policy Catalog Gating', () => {
    it('strictly excludes unauthorized tools from the discoverable policy catalog', () => {
      // allowPython is false: run_python must NOT be discoverable in policy catalog
      const catalogWithoutPython = fullRegistry.getPolicyCatalog({
        projectId: 'p1',
        allowPython: false,
        allowDeliverable: true,
      });
      const names = catalogWithoutPython.map((t) => t.name);
      expect(names).not.toContain('run_python');
      expect(names).toContain('generate_deliverable');
      expect(names).toContain('search_project_files');

      // Without project: project search tools must NOT be discoverable
      const catalogWithoutProject = fullRegistry.getPolicyCatalog({
        projectId: null,
        allowPython: true,
        allowDeliverable: true,
      });
      expect(catalogWithoutProject.map((t) => t.name)).not.toContain('search_project_files');
    });

    it('includes all policy-approved execution tools in policy catalog when authorized', () => {
      const catalog = fullRegistry.getPolicyCatalog({
        projectId: 'p1',
        activeGoalId: 'g1',
        allowPython: true,
        allowDeliverable: true,
      });
      const names = catalog.map((t) => t.name);

      expect(names).toContain('run_python');
      expect(names).toContain('generate_deliverable');
      expect(names).toContain('read_uploaded_file');
      expect(names).toContain('web_search');
      expect(names).toContain('web_fetch');
      expect(names).toContain('generate_image');
      expect(names).toContain('create_artifact');
      expect(names).toContain('search_project_files');
      expect(names).toContain('render_ui');
      expect(names).toContain('search_memory');
    });
  });

  describe('3. Dynamic Deferred Tool Discovery via search_tools', () => {
    it('discovers run_python for "python/data analysis" queries and notifies callback', async () => {
      const catalog = fullRegistry.getPolicyCatalog({
        projectId: null,
        allowPython: true,
        allowDeliverable: true,
      });

      const discovered: ToolDefinition[] = [];
      const executor = new SearchToolsExecutor(catalog, (tool) => {
        discovered.push(tool);
      });

      const result = await executor.execute(
        { id: 'c1', name: 'search_tools', input: { query: 'python/data analysis' } },
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      const data = (result.content[0] as any).data;
      expect(data.tools.some((t: any) => t.name === 'run_python')).toBe(true);
      expect(discovered.some((t) => t.name === 'run_python')).toBe(true);

      const pythonTool = data.tools.find((t: any) => t.name === 'run_python');
      expect(pythonTool.inputSchema.properties).toHaveProperty('code');
    });

    it('discovers generate_deliverable for "excel spreadsheet" query', async () => {
      const catalog = fullRegistry.getPolicyCatalog({
        projectId: null,
        allowPython: true,
        allowDeliverable: true,
      });

      const executor = new SearchToolsExecutor(catalog);
      const result = await executor.execute(
        { id: 'c2', name: 'search_tools', input: { query: 'excel spreadsheet' } },
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      const data = (result.content[0] as any).data;
      expect(data.tools.some((t: any) => t.name === 'generate_deliverable')).toBe(true);
    });

    it('discovers web_search and web_fetch for "web research" query', async () => {
      const catalog = fullRegistry.getPolicyCatalog({
        projectId: null,
        allowPython: true,
        allowDeliverable: true,
      });

      const executor = new SearchToolsExecutor(catalog);
      const result = await executor.execute(
        { id: 'c3', name: 'search_tools', input: { query: 'web research' } },
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      const data = (result.content[0] as any).data;
      expect(data.tools.some((t: any) => t.name === 'web_search')).toBe(true);
    });

    it('discovers read_uploaded_file for "read file" query', async () => {
      const catalog = fullRegistry.getPolicyCatalog({
        projectId: null,
        allowPython: true,
        allowDeliverable: true,
      });

      const executor = new SearchToolsExecutor(catalog);
      const result = await executor.execute(
        { id: 'c4', name: 'search_tools', input: { query: 'read file attachment' } },
        new AbortController().signal,
      );

      expect(result.ok).toBe(true);
      const data = (result.content[0] as any).data;
      expect(data.tools.some((t: any) => t.name === 'read_uploaded_file')).toBe(true);
    });
  });

  describe('4. Dynamic Injection into Next Round and Multi-Step Retention', () => {
    it('mutates active tools array so subsequent rounds immediately receive discovered schema', async () => {
      const context = { projectId: null, allowPython: true, allowDeliverable: true };
      const policyCatalog = fullRegistry.getPolicyCatalog(context);
      const availableTools: ToolDefinition[] = [...fullRegistry.getInitialTools(context)];

      // Initial state: only Round 0 core tools
      expect(availableTools.map((t) => t.name)).toEqual([
        'search_tools',
        'load_skill',
        'read_uploaded_file',
        'generate_deliverable',
        'save_memory',
        'search_chats',
        'forget_memory',
        'run_python',
      ]);

      const executor = new SearchToolsExecutor(policyCatalog, (discovered) => {
        if (!availableTools.some((t) => t.name === discovered.name)) {
          availableTools.push(discovered);
        }
      });

      // Round 0: model calls search_tools
      await executor.execute(
        { id: 'call-1', name: 'search_tools', input: { query: 'excel sheet generation' } },
        new AbortController().signal,
      );

      // Round 1: availableTools array now has generate_deliverable injected
      expect(availableTools.some((t) => t.name === 'generate_deliverable')).toBe(true);
      expect(availableTools.map((t) => t.name)).toContain('generate_deliverable');

      // Round 1 tool call: model can now invoke generate_deliverable with valid schema
      const deliverableTool = availableTools.find((t) => t.name === 'generate_deliverable');
      expect(deliverableTool).toBeDefined();
      expect(deliverableTool?.inputSchema.properties).toHaveProperty('title');
      expect(deliverableTool?.inputSchema.properties).toHaveProperty('format');

      // In step 2 / subsequent rounds: tool is retained without losing state
      expect(availableTools.some((t) => t.name === 'generate_deliverable')).toBe(true);
    });
  });

  describe('5. Truthful Base System Prompt & Phantom Capability Elimination', () => {
    it('omits goal tools from system instruction in chat mode (no phantom capabilities)', () => {
      const cfg = loadConfig({
        ENABLE_TOOL_USE: 'true',
        ENABLE_RUN_PYTHON: 'true',
        ENABLE_AGENT_LOOP: 'true',
      });
      const caps = buildCapabilityRegistry(cfg);

      // Chat mode: isAgentMode = false
      const chatPrompt = buildDynamicRuntimeContext(cfg, caps, false);
      expect(chatPrompt).not.toContain('get_goal');
      expect(chatPrompt).not.toContain('update_goal');
      expect(chatPrompt).not.toContain('get_context_remaining');

      // Truthfully describes search_tools deferred discovery
      expect(chatPrompt).toContain('search_tools');
    });

    it('includes goal tools in system instruction ONLY when isAgentMode is true', () => {
      const cfg = loadConfig({
        ENABLE_TOOL_USE: 'true',
        ENABLE_RUN_PYTHON: 'true',
        ENABLE_AGENT_LOOP: 'true',
      });
      const caps = buildCapabilityRegistry(cfg);

      // Agent mode: isAgentMode = true
      const agentPrompt = buildDynamicRuntimeContext(cfg, caps, true);
      expect(agentPrompt).toContain('get_goal');
      expect(agentPrompt).toContain('update_goal');
      expect(agentPrompt).toContain('get_context_remaining');
      expect(agentPrompt).toContain('search_tools');
    });
  });
});
