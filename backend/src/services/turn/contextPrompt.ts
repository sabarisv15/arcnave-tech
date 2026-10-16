/**
 * Context build, part 3: the skills listed for the turn and the system instruction. Moved from
 * `services/generation.ts` unchanged but for `this` becoming `svc` (ADR-0067).
 */
import { and, eq, sql } from 'drizzle-orm';
import { messages, toolCalls } from '../../db/schema.js';
import type { ToolDefinition } from '../../providers/types.js';
import { SKILLS_ROOT } from '../../tools/codeExecutionExecutor.js';
import { buildDynamicRuntimeContext, currentDateLine, mobileClientLine } from '../systemPrompt.js';
import { assemblePrompt } from '../promptCache/promptAssembly.js';
import type { PromptAssembly } from '../promptCache/types.js';
import { memoryService } from '../memory/memoryService.js';
import { compactionService } from '../compaction/compactionService.js';
import type { SkillDetail } from '../skills.js';
import { formatContext, formatWholeFiles, projectFileTexts } from '../retrieval.js';
import { resolveStyle } from '../styles.js';
import type { TurnServices } from './services.js';
import type { StreamEvent } from './events.js';
import type { GenerateInput, PreferencesRow } from './input.js';

/** A view of a skill's instructions: /skills/<name>/SKILL.md. */
const SKILL_FILE = /^\/skills\/([^/]+)\/SKILL\.md$/;

/** Characters of a skill given again after a compaction. ArcNave counts no tokens (Invariant 3), so the cap is in characters. */
const REINJECTED_SKILL_MAX_CHARS = 20_000;

/** A turn without tools gets project excerpts instead of the search tool: how many, and their
 *  character budget (the values the former PROJECT_CONTEXT_MAX_* settings had). */
const PROJECT_EXCERPTS_WITHOUT_TOOLS = 8;
const PROJECT_EXCERPT_CHARS_WITHOUT_TOOLS = 12_000;

/**
 * The skills listed for this turn and, after a compaction, the skills read earlier, given again
 * in full (ADR-0027). Moved out of the turn generator unchanged (ADR-0067).
 */
export async function buildSkillsContext(
  svc: TurnServices,
  input: GenerateInput,
  activeToolNames: Set<string>,
  latestCompaction: { throughSeq: number } | null,
): Promise<{ skillsContext: string | undefined; loadedSkills: SkillDetail[]; skillsEnabled: boolean }> {
  let skillsContext: string | undefined;
  const loadedSkills: SkillDetail[] = [];
  const skillsEnabled = svc.cfg.ENABLE_SKILLS && svc.skills !== undefined && activeToolNames.has('view');
  if (skillsEnabled) {
    const availableSkills = svc.skills!.listSkills(activeToolNames).filter((s) => s.missingTools.length === 0);
    const parts: string[] = [];
    if (availableSkills.length > 0) {
      parts.push(
        '<available_skills>\n' +
          availableSkills
            .map(
              (s) =>
                `<skill>\n<name>${s.name}</name>\n<description>${s.description}</description>\n` +
                `<location>${SKILLS_ROOT}/${s.name}/SKILL.md</location>\n</skill>`,
            )
            .join('\n') +
          '\n</available_skills>',
      );
    }
    const reinjected = latestCompaction
      ? await skillsLoadedThrough(svc, input.chatId, latestCompaction.throughSeq)
      : [];
    for (const skillName of reinjected) {
      const detail = svc.skills!.getSkill(skillName);
      if (detail && !loadedSkills.some((s) => s.name === detail.name)) loadedSkills.push(detail);
    }
    if (loadedSkills.length > 0) {
      parts.push(
        loadedSkills
          .map((s) => {
            const body =
              s.content.length > REINJECTED_SKILL_MAX_CHARS
                ? `${s.content.slice(0, REINJECTED_SKILL_MAX_CHARS)}\n[Truncated: view ${SKILLS_ROOT}/${s.name}/SKILL.md for the whole skill.]`
                : s.content;
            return `### Skill read earlier: ${SKILLS_ROOT}/${s.name}/SKILL.md\n\n${body}`;
          })
          .join('\n\n---\n\n'),
      );
    }
    if (parts.length > 0) skillsContext = parts.join('\n\n');
  }
  return { skillsContext, loadedSkills, skillsEnabled };
}

/** Skills a view of /skills/<name>/SKILL.md read in this chat's turns up to `throughSeq`. */
export async function skillsLoadedThrough(svc: TurnServices, chatId: string, throughSeq: number): Promise<string[]> {
  const rows = await svc.db
    .select({ input: toolCalls.input })
    .from(toolCalls)
    .innerJoin(messages, eq(messages.id, toolCalls.messageId))
    .where(
      and(
        eq(messages.chatId, chatId),
        sql`${messages.seq} <= ${throughSeq}`,
        eq(toolCalls.name, 'view'),
        eq(toolCalls.ok, true),
      ),
    )
    .orderBy(messages.seq, toolCalls.ordinal);
  const names = rows
    .map((r) => (r.input as { path?: unknown } | null)?.path)
    .map((p) => (typeof p === 'string' ? SKILL_FILE.exec(p)?.[1] : undefined))
    .filter((n): n is string => typeof n === 'string');
  return [...new Set(names)];
}

export async function buildSystemInstruction(
  svc: TurnServices,
  input: GenerateInput,
  prefs: PreferencesRow,
  project: { id: string; title: string; instructions: string } | null,
  availableTools: ToolDefinition[] = [],
  skillsContext?: string,
  /** Every tool allowed this turn, declared or discoverable; tool policies key on these. */
  allowedToolNames?: string[],
  /** The model's own web search is on this turn (Gemini grounding, the Anthropic adapter's web_search). */
  builtInWebSearch = false,
): Promise<{
  systemInstruction: string;
  contextEvents: StreamEvent[];
  promptAssembly: PromptAssembly;
}> {
  const events: StreamEvent[] = [];

  // 1. Standing preferences: the user's own instructions.
  const combinedStandingPrefs = prefs.instructions.trim();

  // 2. Memory: the listing of every file, and the profile and preferences in full. The same
  // text from turn to turn, so it does not break the prompt cache (ADR-0025, ADR-0047).
  let relevantMemoryText = '';
  if (svc.cfg.ENABLE_MEMORY && allowedToolNames?.includes('memory_read')) {
    relevantMemoryText = await memoryService.memoryPrompt(input.userId, project?.id ?? null, svc.cfg.MEMORY_CONTEXT_MAX_CHARS);
  }

  // 3. Conversation compaction summary
  let compactionText = '';
  if (svc.cfg.ENABLE_CONTEXT_COMPACTION) {
    const latestCompaction = await compactionService.getLatestCompaction(input.chatId, svc.db);
    if (latestCompaction) {
      compactionText = compactionService.formatCompactionForPrompt(latestCompaction);
    }
  }

  // 4. Project knowledge. A project's files stay in context, switching to search only when
  // the project knowledge approaches the context window limit (ADR-0020). So: every file whole while they fit, excerpts by relevance past that.
  let retrievedContextText: string | undefined;
  const wholeFiles = project ? await projectFileTexts(svc.db, project.id, undefined, svc.storage) : [];
  const wholeChars = wholeFiles.reduce((n, f) => n + f.text.length, 0);
  if (
    project &&
    wholeFiles.length > 0 &&
    wholeFiles.every((f) => f.whole) &&
    wholeChars <= svc.cfg.PROJECT_FULL_CONTEXT_MAX_CHARS
  ) {
    retrievedContextText = formatWholeFiles(wholeFiles);
    events.push({
      type: 'research',
      event: {
        stage: 'reading',
        label: `Using all ${String(wholeFiles.length)} project file${wholeFiles.length === 1 ? '' : 's'} in full`,
        detail: wholeFiles.map((f) => f.filename).join(', '),
        at: new Date().toISOString(),
      },
    });
  } else if (project && wholeFiles.length > 0 && allowedToolNames?.includes('search_project_files')) {
    // Past the limit the model searches when it needs to. Chunks
    // picked here by the prompt's words changed the system prompt every turn and broke its
    // cache (audit B9, B10).
    retrievedContextText =
      `<project_knowledge>\nThis project's ${String(wholeFiles.length)} file${wholeFiles.length === 1 ? ' is' : 's are'} ` +
      'too large to include here. Search them with search_project_files and read the parts you need with ' +
      'read_project_file before answering from them.\nFiles: ' +
      wholeFiles.map((f) => f.filename).join(', ') +
      '\n</project_knowledge>';
    events.push({
      type: 'research',
      event: {
        stage: 'reading',
        label: 'Project knowledge is searched as needed',
        detail: `${String(wholeFiles.length)} project file${wholeFiles.length === 1 ? '' : 's'}, too large to include whole.`,
        at: new Date().toISOString(),
      },
    });
  } else if (project && wholeFiles.length > 0) {
    // No tools on this turn, so no search tool: excerpts chosen by the question are the only
    // way the model sees the files.
    const chunks = await svc.retriever.search(svc.db, project.id, input.prompt, PROJECT_EXCERPTS_WITHOUT_TOOLS);
    const context = formatContext(chunks, PROJECT_EXCERPT_CHARS_WITHOUT_TOOLS);
    if (context) {
      retrievedContextText = context;
      events.push({
        type: 'research',
        event: {
          stage: 'reading',
          label: `Retrieved ${String(chunks.length)} excerpt${chunks.length === 1 ? '' : 's'} from project files`,
          detail: `Matched by keyword relevance in: ${[...new Set(chunks.map((c) => c.filename))].join(', ')}.`,
          at: new Date().toISOString(),
        },
      });
    }
  }

  // 5. Mode directive
  const modeDirective =
    input.mode === 'research'
      ? 'Conduct deep, rigorous research using web search and web fetch. Answer with a comprehensive, well-structured research report complete with citations directly in the chat text stream. Do not put the report in a file unless the user asked for one. If live web research fails or search providers are unavailable, state plainly: "Live web research could not be completed at this time due to search provider unavailability."'
      : input.mode === 'search'
        ? 'Answer using the web search results available to you. Cite the sources you actually ' +
          'used. Do not invent citations, and say plainly when the evidence does not settle ' +
          'the question.'
        : undefined;

  // 6. Style instructions (WP-05 / ADR-0033)
  const effectiveStyleId = input.styleId ?? prefs.styleId ?? 'normal';
  const resolvedStyle = await resolveStyle(svc.db, input.userId, effectiveStyleId);
  const styleInstructions = resolvedStyle.instructions.trim() || undefined;

  // 7. Assemble prompt separating stable prefix from dynamic suffix
  const promptAssembly = assemblePrompt(availableTools, {
    currentDate:
      currentDateLine(new Date(), prefs.timezone) +
      (input.clientPlatform === 'mobile' ? '\n' + mobileClientLine(availableTools.some((t) => t.name === 'read_me')) : ''),
    runtimeCapabilities: buildDynamicRuntimeContext(svc.cfg, svc.capabilities, allowedToolNames, builtInWebSearch, availableTools.map((tool) => tool.name)),
    standingPreferences: combinedStandingPrefs || undefined,
    projectInstructions: project?.instructions?.trim() || undefined,
    styleInstructions,
    relevantMemory: relevantMemoryText || undefined,
    compactionSummary: compactionText || undefined,
    retrievedContext: retrievedContextText,
    modePrompt: modeDirective,
    skillsContext,
  }, allowedToolNames);

  return {
    systemInstruction: promptAssembly.fullSystemInstruction,
    contextEvents: events,
    promptAssembly,
  };
}
