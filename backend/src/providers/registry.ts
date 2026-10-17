/**
 * The model registry: UI aliases -> exact provider model IDs.
 *
 * Three invariants live here so no other module has to remember them:
 *
 * 1. A model ID is read from configuration verbatim. It is never constructed from a label,
 *    pattern-matched, or defaulted.
 * 2. An alias with no configured ID, or one whose probe failed, is reported `unavailable` with
 *    a machine-readable reason. It is never silently swapped for a different model.
 * 3. `Auto` is not a model. It is the routing function in ./routing.ts, and the alias it
 *    selected is always returned to the caller in response metadata.
 *
 * Three models (ADR-0055): Gemini 3.8 Flash on Vertex, Claude Sonnet 5.5 and Opus 5.5 on the
 * first-party Claude API (ADR-0054). An alias's status comes only from configuration, probes and
 * real request outcomes; no alias is switched off by code. One more row, Claude Haiku 5.5, is a
 * helper (ADR-0080): background jobs only, kept out of every chat path.
 */
import type { Config } from '../config.js';
import type { Provider } from './types.js';
import { ProviderError } from './types.js';

export type Tier = 'quality' | 'balanced' | 'economy';
export const AUTO_ALIAS = 'Auto';

export interface ModelEntry {
  alias: string;
  description: string;
  provider: 'google' | 'anthropic';
  tier: Tier;
  /** Undefined when this deployment has not configured the alias. */
  providerModelId: string | undefined;
  location: string;
  supportsGrounding: boolean;
  supportsVision: boolean;
  contextWindow: number | null;
  /**
   * `helper` rows serve background jobs only (title, summary, router shadow; ADR-0080): never in
   * `/models`, never picked by Auto, never a chat alias, never a fallback. Absent means `chat`.
   */
  role?: 'chat' | 'helper';
}

/** The helper model's alias (ADR-0080). */
export const HELPER_ALIAS = 'Haiku 5.5';

export type UnavailableReason =
  | 'ok'
  | 'not_configured'
  | 'vertex_not_configured'
  | 'anthropic_not_configured'
  | 'probe_failed'
  | 'unknown';

export interface ModelStatus {
  entry: ModelEntry;
  available: boolean;
  reason: UnavailableReason;
  detail: string;
  checkedAt: number | null;
}

/** The alias table. Adding a model means adding a row here plus an env var. */
export function buildEntries(cfg: Config): ModelEntry[] {
  return [
    {
      alias: 'Gemini 3.8 Flash',
      description: 'Fastest for quick answers',
      provider: 'google',
      tier: 'economy',
      providerModelId: cfg.MODEL_GEMINI_FLASH,
      location: cfg.geminiLocation,
      supportsGrounding: true,
      supportsVision: true,
      contextWindow: 1_000_000,
    },
    {
      alias: 'Sonnet 5.5',
      description: 'Efficient for everyday tasks',
      provider: 'anthropic',
      tier: 'balanced',
      providerModelId: cfg.MODEL_SONNET,
      // The first-party Claude API has one global endpoint; there is no region to choose.
      location: 'global',
      supportsGrounding: true,
      supportsVision: true,
      contextWindow: 1_000_000,
    },
    {
      alias: 'Opus 5.5',
      description: 'Strongest for complex work',
      provider: 'anthropic',
      tier: 'quality',
      providerModelId: cfg.MODEL_OPUS,
      location: 'global',
      supportsGrounding: true,
      supportsVision: true,
      contextWindow: 1_000_000,
    },
    {
      alias: HELPER_ALIAS,
      description: 'Background jobs only: titles, summaries, router shadow',
      provider: 'anthropic',
      tier: 'economy',
      providerModelId: cfg.MODEL_HAIKU,
      location: 'global',
      supportsGrounding: false,
      supportsVision: false,
      contextWindow: 1_000_000,
      role: 'helper',
    },
  ];
}

export class ModelRegistry {
  private readonly entries: Map<string, ModelEntry>;
  /** Helper rows, kept apart so no chat path (aliases, statuses, Auto) ever sees them. */
  private readonly helpers: Map<string, ModelEntry>;
  private readonly statuses = new Map<string, ModelStatus>();
  private readonly inflight = new Map<string, Promise<ModelStatus>>();

  constructor(
    private readonly cfg: Config,
    private readonly providers: Partial<Record<ModelEntry['provider'], Provider>>,
  ) {
    const all = buildEntries(cfg);
    this.entries = new Map(all.filter((e) => (e.role ?? 'chat') === 'chat').map((e) => [e.alias, e]));
    this.helpers = new Map(all.filter((e) => e.role === 'helper').map((e) => [e.alias, e]));
  }

  /** A helper row by alias; never a chat model (ADR-0080). */
  helperEntry(alias: string = HELPER_ALIAS): ModelEntry | undefined {
    return this.helpers.get(alias);
  }

  /**
   * Whether a helper can be called now, without a network call: its key, its id, its adapter,
   * and the last real call's outcome (a model-not-found or a rejected key keeps it unavailable
   * for the probe TTL). No probe: a helper job is skipped, never retried on another model.
   */
  helperStatus(alias: string = HELPER_ALIAS): ModelStatus | undefined {
    const entry = this.helpers.get(alias);
    if (!entry) return undefined;
    const fixed = this.staticStatus(entry);
    if (fixed) return fixed;
    const last = this.helperOutcomes.get(alias);
    if (last && !last.available && last.checkedAt !== null && Date.now() - last.checkedAt < this.cfg.MODEL_PROBE_TTL_SECONDS * 1000) {
      return last;
    }
    return { entry, available: true, reason: 'ok', detail: '', checkedAt: last?.checkedAt ?? null };
  }

  /** What a real helper call just showed: `available: false` only for a model or key failure. */
  recordHelperOutcome(alias: string, outcome: { available: true } | { available: false; detail: string }): void {
    const entry = this.helpers.get(alias);
    if (!entry) return;
    this.helperOutcomes.set(alias, {
      entry,
      available: outcome.available,
      reason: outcome.available ? 'ok' : 'probe_failed',
      detail: outcome.available ? '' : outcome.detail,
      checkedAt: Date.now(),
    });
  }

  private readonly helperOutcomes = new Map<string, ModelStatus>();

  get aliases(): string[] {
    return [...this.entries.keys()];
  }

  entry(alias: string): ModelEntry | undefined {
    return this.entries.get(alias);
  }

  providerFor(entry: ModelEntry): Provider | undefined {
    return this.providers[entry.provider];
  }

  /** Statuses knowable without a network call. */
  private staticStatus(entry: ModelEntry): ModelStatus | null {
    if (entry.provider === 'google' && !this.cfg.vertexConfigured) {
      return {
        entry,
        available: false,
        reason: 'vertex_not_configured',
        detail: 'Set GOOGLE_CLOUD_PROJECT to enable Vertex AI models.',
        checkedAt: null,
      };
    }
    if (entry.provider === 'anthropic' && !this.cfg.anthropicConfigured) {
      return {
        entry,
        available: false,
        reason: 'anthropic_not_configured',
        detail: 'Set ANTHROPIC_API_KEY to enable the Claude models.',
        checkedAt: null,
      };
    }
    if (!entry.providerModelId) {
      return {
        entry,
        available: false,
        reason: 'not_configured',
        detail:
          `No model ID configured for "${entry.alias}". Set the corresponding MODEL_* ` +
          'environment variable to an exact model ID the provider serves.',
        checkedAt: null,
      };
    }
    if (!this.providers[entry.provider]) {
      return {
        entry,
        available: false,
        reason: 'not_configured',
        detail: `No adapter is registered for provider "${entry.provider}".`,
        checkedAt: null,
      };
    }
    return null;
  }

  /**
   * Probe an alias, honouring the cache TTL.
   *
   * Probes are real one-token calls, the same request shape a turn sends, so a probe fails for
   * the same reasons a turn would (key, model id, billing). Results
   * are cached so the composer does not spend quota on every page load, and concurrent callers
   * share a single in-flight probe rather than stampeding.
   *
   * `probe: false` means "don't force a refresh", not "never check anything" — a cold instance
   * (Cloud Run's in-memory cache does not survive a cold start) has nothing cached yet, and
   * reporting every alias unavailable until someone happens to click Settings' manual refresh
   * is a worse default than paying for one real probe. Once an alias has been checked at all,
   * a stale-but-present result is still preferred over a fresh probe when the caller asked not
   * to force one.
   */
  async status(alias: string, options: { probe?: boolean | 'never' } = {}): Promise<ModelStatus | undefined> {
    const entry = this.entries.get(alias);
    if (!entry) return undefined;

    const staticResult = this.staticStatus(entry);
    if (staticResult) return staticResult;

    const ttlMs = this.cfg.MODEL_PROBE_TTL_SECONDS * 1000;
    const cached = this.statuses.get(alias);
    if (cached?.checkedAt != null && Date.now() - cached.checkedAt < ttlMs) return cached;

    // A turn never waits on a probe (ADR-0028): the provider SDK sends the request itself, and the
    // request's own error says when a model is missing (recordOutcome keeps that). A configured
    // model not known to have failed recently is tried.
    if (options.probe === 'never') {
      return { entry, available: true, reason: 'ok', detail: 'Not checked; the request itself will tell.', checkedAt: null };
    }

    if (options.probe === false && cached) return cached;

    const existing = this.inflight.get(alias);
    if (existing) return existing;

    const run = this.runProbe(entry).finally(() => this.inflight.delete(alias));
    this.inflight.set(alias, run);
    return run;
  }

  private async runProbe(entry: ModelEntry): Promise<ModelStatus> {
    const provider = this.providers[entry.provider]!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.PROVIDER_CONNECT_TIMEOUT_MS * 3);
    let status: ModelStatus;
    try {
      await provider.probe(entry.providerModelId!, controller.signal);
      status = { entry, available: true, reason: 'ok', detail: '', checkedAt: Date.now() };
    } catch (err) {
      status = {
        entry,
        available: false,
        reason: 'probe_failed',
        detail: err instanceof ProviderError ? err.message : String(err),
        checkedAt: Date.now(),
      };
    } finally {
      clearTimeout(timer);
    }
    this.statuses.set(entry.alias, status);
    return status;
  }

  /**
   * What a real request just showed about a model: a model-not-found makes it unavailable until
   * the probe TTL passes; any answer makes it available. Settings shows the same status a turn used.
   */
  recordOutcome(alias: string, outcome: { available: true } | { available: false; detail: string }): void {
    const entry = this.entries.get(alias);
    if (!entry || this.staticStatus(entry)) return;
    this.statuses.set(alias, {
      entry,
      available: outcome.available,
      reason: outcome.available ? 'ok' : 'probe_failed',
      detail: outcome.available ? '' : outcome.detail,
      checkedAt: Date.now(),
    });
  }

  async allStatuses(options: { probe?: boolean | 'never' } = {}): Promise<ModelStatus[]> {
    const results = await Promise.all(this.aliases.map((a) => this.status(a, options)));
    return results.filter((r): r is ModelStatus => r !== undefined);
  }

  async availableEntries(options: { probe?: boolean | 'never' } = {}): Promise<ModelEntry[]> {
    return (await this.allStatuses(options)).filter((s) => s.available).map((s) => s.entry);
  }

  /** When the alias was last probed, without probing. Null if never. */
  lastProbedAt(alias: string): number | null {
    return this.statuses.get(alias)?.checkedAt ?? null;
  }

  invalidate(alias?: string): void {
    if (alias) this.statuses.delete(alias);
    else this.statuses.clear();
  }
}
