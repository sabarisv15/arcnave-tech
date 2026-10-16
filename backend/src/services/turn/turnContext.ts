/**
 * The turn's context, from the tools it may use to the request it sends: routing and tools,
 * skills, the system instruction and its context events, effort, the budget reservation and its
 * release, the tool executors, the attachments, and the request. Cut from the turn generator
 * unchanged (ADR-0073); `this` became `svc`, and what the later stages read is returned.
 *
 * It yields the context events (a project's files, read whole or searched), each saved as it goes.
 * The reservation's release is a closure over this function's `reservationHeld`: the stream calls
 * it, and so does `limitToModel` here when a model limit refuses the turn; it acts once.
 */
import { sandboxReadsOfficeFiles, usesWarmSandbox } from '../../tools/catalog.js';
import type { MessageSegment } from '../../db/schema.js';
import { logger } from '../../logger.js';
import { effortFor, getModelCapability } from '../../providers/capabilitiesTable.js';
import type { ModelEntry } from '../../providers/registry.js';
import type { AttachmentBlock, GenerationRequest, ReasoningEffort, Turn } from '../../providers/types.js';
import { ProjectToolRegistry } from '../../tools/registry.js';
import { WEB_FETCH_WITH_BUILT_IN_SEARCH } from '../../tools/definitions.js';
import type { WorkspaceFiles } from '../../tools/execution/executionRuntime.js';
import { buildAttachmentManifest, contextNote } from '../attachments/manifest.js';
import { applyFileBudget, applyManyImagesRule, familyOf, useNormalisedImages } from '../attachments/fileBudget.js';
import { routeTurn, type TurnRoutingDecision } from '../routing/turnRouter.js';
import type { SkillDetail } from '../skills.js';
import type { TurnLog } from '../turnLog.js';
import type { TurnTiming } from '../turnTiming.js';
import { buildWebSearchAdapter } from '../webSearch.js';
import { previousContextTokens as previousContextTokensOf } from './context.js';
import { readOfficeFilesWithCode, chatFilesOf, hydrateAttachmentBytes, limitToModel, hydrateHistoryAttachments } from './contextAttachments.js';
import { buildSkillsContext, buildSystemInstruction } from './contextPrompt.js';
import type { StreamEvent } from './events.js';
import type { GenerateInput, PreferencesRow } from './input.js';
import { persistEvent } from './persistence.js';
import type { TurnServices } from './services.js';
import { buildToolExecutors } from './toolset.js';
import { neutraliseReservedTags } from '../prompt/sessionState.js';

// The module tag the turn's log lines had before the split (ADR-0067).
const log = logger.child({ module: 'generation' });

/** What the context build reads from the turn so far. */
export interface TurnContextInput {
  prefs: PreferencesRow;
  project: { id: string; title: string; instructions: string } | null;
  /** The history as loaded for the resolved model, and reloaded after a compaction. */
  history: Turn[];
  entry: ModelEntry;
  grounded: boolean;
  compactedNow: boolean;
  latestCompaction: { throughSeq: number } | null;
  workspace: WorkspaceFiles;
  timing: TurnTiming;
  turnLog: TurnLog;
}

/** What the later stages of the turn read from its context. */
export interface TurnContext {
  request: GenerationRequest;
  routingDecision: TurnRoutingDecision;
  loadedSkills: SkillDetail[];
  contextEvents: StreamEvent[];
  reasoningEffort: ReasoningEffort | undefined;
  releaseReservation: () => Promise<void>;
  segments: MessageSegment[];
  pendingUiEvents: StreamEvent[];
}

export async function* buildTurnContext(
  svc: TurnServices,
  input: GenerateInput,
  turn: TurnContextInput,
): AsyncGenerator<StreamEvent, TurnContext> {
  const { prefs, project, history, entry, grounded, compactedNow, latestCompaction, workspace, timing, turnLog } = turn;
  // --- tools this turn may use (ADR-0006, ADR-0047) ---------------------
  const codeEnabled = svc.cfg.ENABLE_RUN_PYTHON && svc.sandboxClient !== undefined;
  const webEnabled = Boolean(svc.cfg.ENABLE_WEB);
  const webSearchAdapter = buildWebSearchAdapter(svc.cfg);
  // The deployment allows memory; each user turns memory and past-chat search on or off in
  // Settings (ADR-0052). Off means no tool and no memory text is sent, not just a promise.
  const memoryEnabled = Boolean(svc.cfg.ENABLE_MEMORY) && prefs.memoryEnabled;
  const chatSearchEnabled = Boolean(svc.cfg.ENABLE_MEMORY) && prefs.chatSearchEnabled;
  const generativeUiEnabled = Boolean(svc.cfg.ENABLE_GENERATIVE_UI);
  const routingDecision = routeTurn({
    hasProject: project !== null,
    codeEnabled,
    generativeUiEnabled,
    webEnabled,
    searchProviderLive: webSearchAdapter.isLive,
    builtInSearch: grounded,
    memoryEnabled,
    chatSearchEnabled,
  });
  const toolRegistry = new ProjectToolRegistry(svc.cfg.ENABLE_TOOL_USE, {
    codeEnabled,
    persistentSandbox: usesWarmSandbox(svc.cfg),
    webEnabled,
    memoryEnabled,
    chatSearchEnabled,
    generativeUiEnabled,
  });
  const allowCode = routingDecision.allowedTools.includes('bash_tool');
  const availableTools = toolRegistry
    .getAvailableTools({ userId: input.userId, projectId: project?.id ?? null, allowCode })
    .filter((t) => routingDecision.allowedTools.includes(t.name))
    .map((t) => (t.name === 'web_fetch' && grounded ? WEB_FETCH_WITH_BUILT_IN_SEARCH : t));
  const activeToolNames = new Set<string>(availableTools.map((t) => t.name));
  turnLog.stage('routing', {
    code: codeEnabled,
    web: webEnabled,
    searchProviderLive: webSearchAdapter.isLive,
    memory: memoryEnabled,
    chatSearch: chatSearchEnabled,
    generativeUi: generativeUiEnabled,
    project: project !== null,
    declared: availableTools.map((t) => t.name),
  });

  // --- skills: names and descriptions up front, each read with view when needed ---------
  // Skills are listed only when view can read them (Invariant 1). After a compaction, the
  // skills read in the summarised turns come back in full (ADR-0027): the summary alone would
  // leave a skill the model believes it has read.
  const { skills, skillsReadEarlier, loadedSkills, skillsEnabled } = await buildSkillsContext(svc, input, activeToolNames, latestCompaction);

  // Effort before the prompt: `<profile>` in the session state is read from it (RT-4).
  const modelSpec = getModelCapability(entry.alias);
  const maxOutputTokens = Math.min(
    prefs.maxOutputTokens || svc.cfg.DEFAULT_MAX_OUTPUT_TOKENS,
    svc.cfg.MAX_OUTPUT_TOKENS_CEILING,
    modelSpec.maxOutputTokens ?? Number.POSITIVE_INFINITY,
  );
  const requestedEffort =
    input.effort ?? (prefs.effort as ReasoningEffort | undefined) ?? svc.cfg.REASONING_EFFORT;
  const reasoningEffort = effortFor(modelSpec, requestedEffort);
  timing.note('effort', reasoningEffort ?? null);
  if (input.effort) timing.note('requestedEffort', input.effort);

  // --- assemble context -------------------------------------------------
  timing.mark('skills_tools');
  turnLog.stage('skills', {
    enabled: skillsEnabled,
    listed: skills.map((s) => s.name),
    reinjectedAfterCompaction: loadedSkills.map((s) => s.name),
  });
  const { systemInstruction, turnPreamble, contextEvents, promptAssembly } = await buildSystemInstruction(
    svc,
    input,
    prefs,
    project,
    // Every allowed tool is declared (ADR-0047); with tool use off, none is.
    availableTools,
    { skills, ...(skillsReadEarlier ? { skillsReadEarlier } : {}) },
    grounded,
    entry,
    reasoningEffort,
  );
  for (const event of contextEvents) {
    yield event;
    await persistEvent(svc, input.messageId, event);
  }

  timing.mark('system_prompt');
  // The prompt version is a hash of the prompt files, never their text (Stage 17 NO_CONTENT).
  timing.note('promptVersion', promptAssembly.promptVersion);
  turnLog.stage('system prompt', {
    promptVersion: promptAssembly.promptVersion,
    characters: systemInstruction.length,
    parts: Object.entries(promptAssembly.blockSizes).map(([k, v]) => `${k} ${String(v)}`),
  });

  // --- reserve budget ---------------------------------------------------
  // The reservation is the worst case for this request; it is released as soon as the real
  // numbers land, so a large ceiling does not lock out the rest of the day.
  await svc.usage.reserve(input.userId, prefs, maxOutputTokens);
  turnLog.stage('budget', { maxOutputTokens, effortRequested: requestedEffort ?? null, effortUsed: reasoningEffort ?? null });
  let reservationHeld = true;
  const releaseReservation = async (): Promise<void> => {
    if (!reservationHeld) return;
    reservationHeld = false;
    await svc.usage.release(input.userId, prefs, maxOutputTokens).catch((err: unknown) => {
      log.error({ err, userId: input.userId }, 'failed to release budget reservation');
    });
  };

  // The answer in the order it happened: thinking, text and tool steps
  // interleaved. Kept on the message so a reload shows the same timeline.
  const segments: MessageSegment[] = [];
  const { pendingUiEvents, toolMap, codeExecutor, toolExecutor } = buildToolExecutors(svc, {
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
  });
  timing.mark('tools_setup');
  turnLog.stage('tool executors', { executors: [...new Set([...toolMap.values()].map((e) => e.constructor.name))] });

  // Images go as their normalised copy (D1 #21); then each file whole or by excerpt, and a
  // PDF's pages by the N-13 budget, for this model family (ADR-0063).
  const normalised = await useNormalisedImages(svc.db, input.attachments, history);
  const budgeted = await applyFileBudget(
    svc.db,
    familyOf(entry.provider),
    input.prompt,
    await hydrateAttachmentBytes(svc, normalised.current),
    await hydrateHistoryAttachments(svc, normalised.history, input.prompt, entry.alias),
  );
  const sized = await applyManyImagesRule(svc.cfg, budgeted.current, budgeted.history);
  const { current: wireAttachments, history: wireHistory } = await limitToModel(svc, entry.alias, sized.current, sized.history, releaseReservation);
  timing.mark('attachments');
  {
    const all = [...wireAttachments, ...wireHistory.flatMap((t) => t.attachments ?? [])];
    turnLog.stage('attachments', {
      current: wireAttachments.length,
      fromHistory: all.length - wireAttachments.length,
      pdfsAsPages: all.filter((a) => a.pages).length,
      pageImages: all.reduce((n, a) => n + (a.pages?.filter((p) => p.image?.fileUri || p.image?.base64).length ?? 0), 0),
      leftOut: all.filter((a) => a.omittedReason).map((a) => `${a.filename ?? a.id}: ${a.omittedReason!}`),
    });
  }

  const allAttachmentsMap = new Map<string, AttachmentBlock>();
  for (const h of wireHistory) {
    if (h.attachments) {
      for (const att of h.attachments) {
        if (att.id) allAttachmentsMap.set(att.id, att);
      }
    }
  }
  for (const att of wireAttachments) {
    if (att.id) allAttachmentsMap.set(att.id, att);
  }

  const chatFiles = await chatFilesOf(svc, input.chatId, allAttachmentsMap);
  codeExecutor?.setChatFiles(chatFiles);
  const wire = readOfficeFilesWithCode(
    codeExecutor !== undefined && sandboxReadsOfficeFiles(svc.cfg),
    wireAttachments,
    wireHistory,
  );
  // Each line says whether the model already sees the file, from what this request carries.
  const sent = new Map<string, AttachmentBlock>();
  for (const a of [...wire.history.flatMap((t) => t.attachments ?? []), ...wire.current]) if (a.id) sent.set(a.id, a);
  const attachmentManifestBlock = buildAttachmentManifest(
    chatFiles.map((f) => {
      const block = sent.get(f.id);
      return block ? { ...f, inContext: contextNote(block) } : f;
    }),
    { sandbox: codeExecutor !== undefined },
  );

  const promptParts: string[] = [];
  if (attachmentManifestBlock) promptParts.push(attachmentManifestBlock);
  promptParts.push(neutraliseReservedTags(input.prompt));
  const effectivePrompt = promptParts.join('\n\n');

  // The previous request's size, for the turn log only: no adapter shortens a request on it,
  // tool results are never cleared before compaction (ADR-0023, ADR-0072). After a compaction
  // the earlier size no longer describes what is sent.
  const previousContextTokens = compactedNow ? null : await previousContextTokensOf(svc, input);
  const request: GenerationRequest = {
    prompt: effectivePrompt,
    // Earlier messages cannot carry a reserved tag either (the same rule as the current message).
    history: wire.history.map((t) => (t.text ? { ...t, text: neutraliseReservedTags(t.text) } : t)),
    attachments: wire.current,
    systemInstruction,
    ...(turnPreamble ? { turnPreamble } : {}),
    promptAssembly,
    mode: input.mode,
    maxOutputTokens,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(previousContextTokens !== null ? { previousContextTokens } : {}),
    providerModelId: entry.providerModelId!,
    grounded,
    codeExecution: Boolean(input.codeExecution),
    ...(availableTools.length > 0 ? { tools: availableTools } : {}),
    ...(toolExecutor ? { toolExecutor } : {}),
    signal: input.signal,
  };

  turnLog.stage('request built', {
    readWithCode: [...wire.current, ...wire.history.flatMap((t) => t.attachments ?? [])]
      .filter((a) => a.omittedReason === 'read_with_code')
      .map((a) => a.filename ?? a.id),
    previousContextTokens,
  });
  turnLog.sent(request, skills.map((s) => s.name));
  return { request, routingDecision, loadedSkills, contextEvents, reasoningEffort, releaseReservation, segments, pendingUiEvents };
}
