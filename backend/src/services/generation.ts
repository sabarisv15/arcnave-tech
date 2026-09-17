/**
 * Generation orchestration.
 *
 * Owns the whole life of one assistant turn: resolve the model, assemble context, reserve
 * budget, stream from the provider, persist what happened, and record usage — including when
 * the run is cancelled or fails.
 *
 * Two behaviours worth naming because they are easy to get subtly wrong:
 *
 * - **Retries only happen before the first token reaches the client.** Once a delta has been
 *   emitted, retrying would duplicate visible text, so a mid-stream failure is reported as a
 *   failure rather than silently restarted.
 * - **Cancellation still writes a usage row.** A run that streamed 800 tokens before the user
 *   pressed stop cost those tokens; dropping the record would understate real spend.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import {
  chats,
  messages,
  messageSources,
  preferences as preferencesTable,
  projectFiles,
  projects,
  researchEvents,
} from '../db/schema.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import type { ModelEntry, ModelRegistry } from '../providers/registry.js';
import { AUTO_ALIAS } from '../providers/registry.js';
import type { RoutingDecision } from '../providers/routing.js';
import { routeAuto } from '../providers/routing.js';
import type {
  GenerationRequest,
  Mode,
  ProviderEvent,
  ProviderSource,
  ProviderUsage,
  Turn,
} from '../providers/types.js';
import { EMPTY_USAGE, isAbort, ModelNotFoundError, ProviderError, totalTokens } from '../providers/types.js';
import type { Retriever } from './retrieval.js';
import { formatContext } from './retrieval.js';
import type { UsageService } from './usage.js';

const log = logger.child({ module: 'generation' });

/* -------------------------------------------------------------------------- SSE shapes */

/**
 * Events sent to the browser.
 *
 * Intentionally close to the frontend's existing `AdapterEvent` union so the mock generator
 * can be replaced without redesigning the UI, extended with the ids, usage, and routing
 * metadata a real backend has to report.
 */
export type StreamEvent =
  | { type: 'start'; messageId: string; chatId: string; requestId: string; model: ModelInfo }
  | { type: 'research'; event: { stage: string; label: string; detail: string; at: string } }
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: SourceDto[]; searchEntryPoint?: string }
  | { type: 'done'; questions: string[]; usage: UsageDto; finishReason: string }
  | { type: 'error'; code: string; title: string; detail: string; usage?: UsageDto };

export interface ModelInfo {
  requested: string;
  resolved: string;
  provider: string;
  providerModelId: string;
  /** Present only when the request asked for `Auto`, so routing is never opaque. */
  routing?: { rule: string; considered: string[] };
  grounded: boolean;
}

export interface SourceDto {
  id: number;
  title: string;
  url: string;
  urlResolved: boolean;
  domain: string;
  type: string;
  snippet: string;
  passage: string;
  retrievedAt: string;
}

export interface UsageDto {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** False means the provider reported nothing. The UI must not present zeros as measured. */
  exact: boolean;
  costUsd: number | null;
}

export function toUsageDto(usage: ProviderUsage, costUsd: number | null): UsageDto {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: totalTokens(usage),
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    exact: usage.exact,
    costUsd,
  };
}

/* -------------------------------------------------------------------------- input */

export interface GenerateInput {
  userId: string;
  requestId: string;
  chatId: string;
  /** The assistant message row to fill in. Created by the route before streaming starts. */
  messageId: string;
  prompt: string;
  mode: Mode;
  modelAlias: string;
  projectId: string | null;
  hasAttachments: boolean;
  attachmentText: string;
  signal: AbortSignal;
}

interface PreferencesRow {
  instructions: string;
  maxOutputTokens: number;
  dailyTokenBudget: number | null;
  monthlyTokenBudget: number | null;
  warnThresholdPct: number;
  routingPreference: string;
  timezone: string;
}

/* -------------------------------------------------------------------------- service */

export class GenerationService {
  constructor(
    private readonly db: Database,
    private readonly cfg: Config,
    private readonly registry: ModelRegistry,
    private readonly usage: UsageService,
    private readonly retriever: Retriever,
  ) {}

  /**
   * Run one turn, yielding events for the SSE transport.
   *
   * The generator is the unit of cancellation: when the transport stops pulling (because the
   * client disconnected), the `finally` runs, the provider stream is abandoned, and the usage
   * row is written with whatever the provider had already reported.
   */
  async *run(input: GenerateInput): AsyncGenerator<StreamEvent> {
    const startedAt = new Date();
    const prefs = await this.loadPreferences(input.userId);

    const project = input.projectId ? await this.loadProject(input.userId, input.projectId) : null;

    // --- resolve the model ------------------------------------------------
    const requiresGrounding = input.mode !== 'chat';
    const { entry, routing } = await this.resolveModel(
      input,
      prefs,
      requiresGrounding,
      project?.instructions.length ?? 0,
    );
    const provider = this.registry.providerFor(entry);
    if (!provider) {
      throw new ApiError('model_unavailable', {
        detail: `No adapter is registered for provider "${entry.provider}".`,
      });
    }

    const grounded = requiresGrounding && entry.supportsGrounding && provider.supportsGrounding();
    if (requiresGrounding && !grounded) {
      // Search and research promise cited answers. Rather than quietly degrade to an
      // uncited chat reply, say the capability is off and let the user choose.
      throw new ApiError('capability_unavailable', {
        detail:
          `${input.mode === 'research' ? 'Research' : 'Search'} needs a grounding provider, ` +
          'which is not enabled for the selected model. Switch to Chat, or enable ' +
          'grounding in the server configuration.',
        meta: { mode: input.mode, alias: entry.alias },
      });
    }

    const modelInfo: ModelInfo = {
      requested: input.modelAlias,
      resolved: entry.alias,
      provider: entry.provider,
      providerModelId: entry.providerModelId!,
      ...(routing ? { routing: { rule: routing.rule, considered: routing.considered } } : {}),
      grounded,
    };

    yield {
      type: 'start',
      messageId: input.messageId,
      chatId: input.chatId,
      requestId: input.requestId,
      model: modelInfo,
    };

    // --- assemble context -------------------------------------------------
    const history = await this.loadHistory(input.chatId, input.messageId);
    const { systemInstruction, contextEvents } = await this.buildSystemInstruction(
      input,
      prefs,
      project,
    );
    for (const event of contextEvents) {
      yield event;
      await this.persistEvent(input.messageId, event);
    }

    const maxOutputTokens = Math.min(
      prefs.maxOutputTokens || this.cfg.DEFAULT_MAX_OUTPUT_TOKENS,
      this.cfg.MAX_OUTPUT_TOKENS_CEILING,
    );

    // --- reserve budget ---------------------------------------------------
    // The reservation is the worst case for this request; it is released as soon as the real
    // numbers land, so a large ceiling does not lock out the rest of the day.
    await this.usage.reserve(input.userId, prefs, maxOutputTokens);
    let reservationHeld = true;
    const releaseReservation = async (): Promise<void> => {
      if (!reservationHeld) return;
      reservationHeld = false;
      await this.usage.release(input.userId, prefs, maxOutputTokens).catch((err: unknown) => {
        log.error({ err, userId: input.userId }, 'failed to release budget reservation');
      });
    };

    const request: GenerationRequest = {
      prompt: input.prompt,
      history,
      systemInstruction,
      mode: input.mode,
      maxOutputTokens,
      providerModelId: entry.providerModelId!,
      grounded,
      signal: input.signal,
    };

    let usage: ProviderUsage = EMPTY_USAGE;
    let finishReason = 'stop';
    let status: 'complete' | 'cancelled' | 'error' = 'complete';
    let errorCode: string | null = null;
    const collectedText: string[] = [];
    const collectedSources: ProviderSource[] = [];
    let searchEntryPoint: string | undefined;
    let eventOrdinal = contextEvents.length;

    try {
      const stream = this.streamWithRetry(provider.stream.bind(provider), request);

      for await (const event of stream) {
        switch (event.type) {
          case 'delta':
            collectedText.push(event.text);
            yield { type: 'delta', text: event.text };
            break;

          case 'sources': {
            collectedSources.push(...event.sources);
            if (event.searchEntryPoint) searchEntryPoint = event.searchEntryPoint;
            const dtos = event.sources.map((s, i) => toSourceDto(s, i + 1));
            yield {
              type: 'sources',
              sources: dtos,
              ...(event.searchEntryPoint ? { searchEntryPoint: event.searchEntryPoint } : {}),
            };
            break;
          }

          case 'progress': {
            const out: StreamEvent = {
              type: 'research',
              event: {
                stage: event.stage,
                label: event.label,
                detail: event.detail,
                at: new Date().toISOString(),
              },
            };
            yield out;
            await this.persistEvent(input.messageId, out, eventOrdinal++);
            break;
          }

          case 'completed':
            usage = event.usage;
            finishReason = event.finishReason;
            break;
        }
      }
    } catch (err) {
      if (isAbort(err) || input.signal.aborted) {
        status = 'cancelled';
      } else {
        status = 'error';
        const mapped = mapProviderError(err);
        errorCode = mapped.code;
        await this.finalise(input, {
          text: collectedText.join(''),
          sources: collectedSources,
          searchEntryPoint,
          status: 'error',
          errorCode: mapped.code,
          finishReason: null,
          entry,
          mode: input.mode,
        });
        await releaseReservation();
        await this.usage.record({
          userId: input.userId,
          prefs,
          requestId: input.requestId,
          chatId: input.chatId,
          messageId: input.messageId,
          projectId: input.projectId,
          modelAlias: entry.alias,
          provider: entry.provider,
          providerModelId: entry.providerModelId!,
          usage,
          startedAt,
          status: 'error',
          errorCode: mapped.code,
        });
        yield {
          type: 'error',
          code: mapped.code,
          title: mapped.title,
          detail: mapped.detail,
          usage: toUsageDto(usage, null),
        };
        return;
      }
    } finally {
      await releaseReservation();
    }

    // --- persist ----------------------------------------------------------
    const text = collectedText.join('');
    const questions = status === 'complete' ? suggestFollowUps(input.mode, collectedSources) : [];

    await this.finalise(input, {
      text,
      sources: collectedSources,
      searchEntryPoint,
      status: status === 'cancelled' ? 'stopped' : 'complete',
      errorCode,
      finishReason: status === 'cancelled' ? 'cancelled' : finishReason,
      entry,
      mode: input.mode,
      questions,
    });

    await this.usage.record({
      userId: input.userId,
      prefs,
      requestId: input.requestId,
      chatId: input.chatId,
      messageId: input.messageId,
      projectId: input.projectId,
      modelAlias: entry.alias,
      provider: entry.provider,
      providerModelId: entry.providerModelId!,
      usage,
      startedAt,
      status: status === 'cancelled' ? 'cancelled' : 'complete',
      finishReason: status === 'cancelled' ? 'cancelled' : finishReason,
    });

    // A cancelled run has no terminal `done`: the client already knows it stopped, and
    // emitting "done" would claim a completion that did not happen.
    if (status === 'complete') {
      yield {
        type: 'done',
        questions,
        usage: toUsageDto(usage, computeCostFor(this.cfg, entry.providerModelId!, usage)),
        finishReason,
      };
    }
  }

  /* ------------------------------------------------------------------ model resolution */

  private async resolveModel(
    input: GenerateInput,
    prefs: PreferencesRow,
    requiresGrounding: boolean,
    contextChars: number,
  ): Promise<{ entry: ModelEntry; routing: RoutingDecision | null }> {
    if (input.modelAlias !== AUTO_ALIAS) {
      const status = await this.registry.status(input.modelAlias);
      if (!status) {
        throw new ApiError('model_unavailable', {
          detail: `"${input.modelAlias}" is not a known model.`,
        });
      }
      if (!status.available) {
        throw new ApiError('model_unavailable', {
          detail: status.detail,
          meta: { alias: input.modelAlias, reason: status.reason },
        });
      }
      return { entry: status.entry, routing: null };
    }

    const available = await this.registry.availableEntries();
    const decision = routeAuto(
      {
        mode: input.mode,
        promptChars: input.prompt.length,
        contextChars,
        hasAttachments: input.hasAttachments,
        routingPreference: normalizeTier(prefs.routingPreference),
        requiresGrounding,
      },
      this.cfg,
      available,
    );
    if (!decision) {
      throw new ApiError('no_model_available', {
        detail: requiresGrounding
          ? 'No configured model supports grounded search. Enable grounding or use Chat mode.'
          : 'No model in the registry is configured and reachable. Check the MODEL_* environment variables.',
      });
    }
    return { entry: decision.entry, routing: decision };
  }

  /* ------------------------------------------------------------------ retry */

  /**
   * Retry transient provider failures with exponential backoff.
   *
   * Only retries before the first event is yielded downstream. Once the client has seen a
   * token, a restart would duplicate text, so the failure propagates instead.
   */
  private async *streamWithRetry(
    open: (req: GenerationRequest) => AsyncGenerator<ProviderEvent>,
    request: GenerationRequest,
  ): AsyncGenerator<ProviderEvent> {
    let attempt = 0;
    for (;;) {
      let emitted = false;
      try {
        for await (const event of open(request)) {
          emitted = true;
          yield event;
        }
        return;
      } catch (err) {
        if (isAbort(err) || request.signal.aborted) throw err;
        const retryable = err instanceof ProviderError && err.retryable;
        if (emitted || !retryable || attempt >= this.cfg.PROVIDER_MAX_RETRIES) throw err;
        attempt += 1;
        // Exponential backoff with jitter, so a burst of failed requests does not retry in
        // lockstep and re-create the spike that caused the failure.
        const base = 300 * 2 ** (attempt - 1);
        const delay = base + Math.random() * base * 0.5;
        log.warn({ attempt, delay, err: String(err) }, 'retrying provider call');
        await sleep(delay, request.signal);
      }
    }
  }

  /* ------------------------------------------------------------------ context */

  private async loadPreferences(userId: string): Promise<PreferencesRow> {
    const [row] = await this.db
      .select({
        instructions: preferencesTable.instructions,
        maxOutputTokens: preferencesTable.maxOutputTokens,
        dailyTokenBudget: preferencesTable.dailyTokenBudget,
        monthlyTokenBudget: preferencesTable.monthlyTokenBudget,
        warnThresholdPct: preferencesTable.warnThresholdPct,
        routingPreference: preferencesTable.routingPreference,
        timezone: preferencesTable.timezone,
      })
      .from(preferencesTable)
      .where(eq(preferencesTable.userId, userId))
      .limit(1);
    if (!row) throw new ApiError('internal_error', { detail: 'Preferences are missing.' });
    return row;
  }

  private async loadProject(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; title: string; instructions: string } | null> {
    const [row] = await this.db
      .select({ id: projects.id, title: projects.title, instructions: projects.instructions })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.userId, userId),
          sql`${projects.deletedAt} is null`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Prior turns, oldest first, excluding the assistant row we are about to fill. */
  private async loadHistory(chatId: string, excludeMessageId: string): Promise<Turn[]> {
    const rows = await this.db
      .select({ role: messages.role, text: messages.text, seq: messages.seq })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), sql`${messages.id} <> ${excludeMessageId}`))
      .orderBy(desc(messages.seq))
      .limit(Math.min(this.cfg.HISTORY_MAX_TURNS, 12));

    // Keep the newest complete context within a predictable character budget. Without this
    // guard, a long chat sends the full recent transcript on every turn and input-token usage
    // grows linearly until the provider context limit is reached.
    const turns = rows
      .reverse()
      .filter((r) => r.text.trim() !== '')
      .map((r) => ({ role: r.role === 'user' ? 'user' : 'assistant', text: r.text }) as Turn);
    const budget = 24_000;
    let used = 0;
    const kept: Turn[] = [];
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (!turn) continue;
      const cost = turn.text.length;
      if (kept.length > 0 && used + cost > budget) break;
      kept.unshift(turn);
      used += cost;
    }
    return kept;
  }

  private async buildSystemInstruction(
    input: GenerateInput,
    prefs: PreferencesRow,
    project: { id: string; title: string; instructions: string } | null,
  ): Promise<{ systemInstruction: string; contextEvents: StreamEvent[] }> {
    const parts: string[] = [];
    const events: StreamEvent[] = [];

    if (prefs.instructions.trim()) {
      parts.push(`The person you are helping has these standing instructions:\n${prefs.instructions.trim()}`);
    }

    if (project) {
      if (project.instructions.trim()) {
        parts.push(
          `Instructions for the project "${project.title}":\n${project.instructions.trim()}`,
        );
      }

      // Retrieve only the relevant slices. Injecting whole files would blow the context
      // window and Vertex's 30 MB payload cap on any real knowledge base.
      const chunks = await this.retriever.search(
        this.db,
        project.id,
        input.prompt,
        this.cfg.PROJECT_CONTEXT_MAX_CHUNKS,
      );
      const context = formatContext(chunks, this.cfg.PROJECT_CONTEXT_MAX_CHARS);
      if (context) {
        parts.push(context);
        const files = new Set(chunks.map((c) => c.filename));
        events.push({
          type: 'research',
          event: {
            stage: 'reading',
            label: `Retrieved ${chunks.length} excerpt${chunks.length === 1 ? '' : 's'} from project files`,
            detail: `Matched by keyword relevance in: ${[...files].join(', ')}.`,
            at: new Date().toISOString(),
          },
        });
      } else {
        const [counts] = await this.db
          .select({ total: sql<number>`count(*)::int` })
          .from(projectFiles)
          .where(and(eq(projectFiles.projectId, project.id), eq(projectFiles.status, 'ready')));
        if ((counts?.total ?? 0) > 0) {
          events.push({
            type: 'research',
            event: {
              stage: 'reading',
              label: 'No project files matched this question',
              detail: 'Project instructions are still applied.',
              at: new Date().toISOString(),
            },
          });
        }
      }
    }

    if (input.attachmentText.trim()) {
      parts.push(
        `Text extracted from files attached to this message:\n${input.attachmentText.trim()}`,
      );
    }

    if (input.mode !== 'chat') {
      parts.push(
        'Answer using the web search results available to you. Cite the sources you actually ' +
          'used. Do not invent citations, and say plainly when the evidence does not settle ' +
          'the question.',
      );
    }

    return { systemInstruction: parts.join('\n\n'), contextEvents: events };
  }

  /* ------------------------------------------------------------------ persistence */

  private async persistEvent(
    messageId: string,
    event: StreamEvent,
    ordinal?: number,
  ): Promise<void> {
    if (event.type !== 'research') return;
    const index =
      ordinal ??
      (
        await this.db
          .select({ next: sql<number>`coalesce(max(${researchEvents.ordinal}), -1) + 1` })
          .from(researchEvents)
          .where(eq(researchEvents.messageId, messageId))
      )[0]?.next ??
      0;
    await this.db
      .insert(researchEvents)
      .values({
        messageId,
        ordinal: index,
        stage: event.event.stage,
        label: event.event.label.slice(0, 300),
        detail: event.event.detail,
        at: new Date(event.event.at),
      })
      .onConflictDoNothing();
  }

  private async finalise(
    input: GenerateInput,
    result: {
      text: string;
      sources: ProviderSource[];
      searchEntryPoint: string | undefined;
      status: 'complete' | 'stopped' | 'error';
      errorCode: string | null;
      finishReason: string | null;
      entry: ModelEntry;
      mode: Mode;
      questions?: string[];
    },
  ): Promise<void> {
    const researchStage =
      result.mode === 'chat'
        ? null
        : result.status === 'error'
          ? 'error'
          : result.status === 'stopped'
            ? 'partial'
            : result.sources.length > 0
              ? 'complete'
              : 'partial';

    await this.db
      .update(messages)
      .set({
        text: result.text,
        status: result.status,
        errorCode: result.errorCode,
        researchStage,
        questions: result.questions ?? [],
        modelAlias: result.entry.alias,
        provider: result.entry.provider,
        providerModelId: result.entry.providerModelId ?? null,
        finishReason: result.finishReason,
        searchEntryPoint: result.searchEntryPoint ?? null,
        completedAt: new Date(),
      })
      .where(eq(messages.id, input.messageId));

    if (result.sources.length > 0) {
      // Replace rather than append: a retry of the same message must not double its citations.
      await this.db.delete(messageSources).where(eq(messageSources.messageId, input.messageId));
      await this.db.insert(messageSources).values(
        result.sources.map((s, i) => ({
          messageId: input.messageId,
          ordinal: i + 1,
          title: s.title.slice(0, 500),
          url: s.url,
          urlResolved: s.urlResolved,
          domain: s.domain.slice(0, 255),
          sourceType: s.sourceType,
          snippet: s.snippet,
          passage: s.passage,
          retrievedAt: s.retrievedAt,
        })),
      );
    }

    await this.db
      .update(chats)
      .set({ updatedAt: new Date() })
      .where(eq(chats.id, input.chatId));
  }
}

/* -------------------------------------------------------------------------- helpers */

function normalizeTier(value: string): 'quality' | 'balanced' | 'economy' {
  return value === 'quality' || value === 'economy' ? value : 'balanced';
}

export function toSourceDto(source: ProviderSource, id: number): SourceDto {
  return {
    id,
    title: source.title,
    url: source.url,
    urlResolved: source.urlResolved,
    domain: source.domain,
    type: source.sourceType,
    snippet: source.snippet,
    passage: source.passage,
    retrievedAt: source.retrievedAt.toISOString(),
  };
}

function computeCostFor(cfg: Config, providerModelId: string, usage: ProviderUsage): number | null {
  const row = cfg.PRICING_TABLE[providerModelId];
  if (!row || !usage.exact) return null;
  const cost =
    (usage.inputTokens * row.input +
      usage.outputTokens * row.output +
      usage.cacheReadTokens * row.cacheRead +
      usage.cacheWriteTokens * row.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export function mapProviderError(err: unknown): { code: string; title: string; detail: string } {
  if (err instanceof ModelNotFoundError) {
    return {
      code: 'model_unavailable',
      title: 'This model is unavailable',
      detail:
        `The model "${err.modelId}" was not found in "${err.location}". It may not be ` +
        'enabled for this project, or the configured region may not serve it.',
    };
  }
  if (err instanceof ProviderError) {
    const api = new ApiError(err.code);
    return { code: err.code, title: api.title, detail: api.detail };
  }
  if (err instanceof ApiError) {
    return { code: err.code, title: err.title, detail: err.detail };
  }
  const api = new ApiError('provider_error');
  return { code: api.code, title: api.title, detail: api.detail };
}

/**
 * Follow-up suggestions.
 *
 * Deliberately generic and derived from what the turn actually produced. Asking the model for
 * suggestions would double the cost of every reply; inventing topic-specific ones without
 * reading the answer would be theatre.
 */
function suggestFollowUps(mode: Mode, sources: ProviderSource[]): string[] {
  if (mode === 'chat') return [];
  if (sources.length === 0) return [];
  const domains = [...new Set(sources.map((s) => s.domain).filter(Boolean))].slice(0, 2);
  const out = ['What does the strongest evidence here actually establish?'];
  if (domains.length > 0) out.push(`Summarise what ${domains.join(' and ')} say on this.`);
  out.push('What would change this conclusion?');
  return out;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export { asc };
