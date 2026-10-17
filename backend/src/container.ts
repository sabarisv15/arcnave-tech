/**
 * Service container.
 *
 * Built once at startup and attached to the Fastify instance. Constructing services here
 * rather than importing singletons into each route is what lets a test swap the database or
 * a provider without monkey-patching module state.
 */
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { getDb } from './db/client.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { GeminiProvider } from './providers/gemini.js';
import { ModelRegistry } from './providers/registry.js';
import type { Provider } from './providers/types.js';
import { buildCapabilityRegistry } from './capabilities/factory.js';
import type { CapabilityRegistry } from './capabilities/registry.js';
import { AuthService } from './services/auth.js';
import { GisTokenVerifier, type GoogleTokenVerifier } from './services/googleSignIn.js';
import { GenerationService } from './services/generation.js';
import type { Retriever } from './services/retrieval.js';
import { LexicalRetriever } from './services/retrieval.js';
import type { ObjectStorage } from './services/storage.js';
import { buildStorage } from './services/storage.js';
import { SkillService } from './services/skills.js';
import { UsageService } from './services/usage.js';
import { PricingService } from './services/pricing.js';
import { LedgerService } from './services/ledger.js';
import { DeletionLedger } from './services/deletionLedger.js';
import { ExecutionRuntime } from './tools/execution/executionRuntime.js';
import { ProcessSandboxClient } from './tools/sandbox/processSandboxClient.js';
import { CloudRunSandboxClient } from './tools/sandbox/cloudRunSandboxClient.js';
import type { SandboxClient } from './tools/sandbox/client.js';
import { GoogleAuth, type IdTokenClient } from 'google-auth-library';
import { RunHub } from './services/runHub.js';
import { SandboxSemaphore } from './tools/sandbox/semaphore.js';
import { SemaphoreSandboxClient } from './tools/sandbox/semaphoreSandboxClient.js';
import { usesWarmSandbox } from './tools/catalog.js';
import { WarmSandboxClient } from './tools/sandbox/warmSandboxClient.js';
import { WorkspaceStateStore } from './tools/sandbox/workspaceState.js';
import { GcsModelInputStore, type ModelInputStore } from './services/attachments/modelInputStore.js';
import { Storage as GcsClient } from '@google-cloud/storage';
import { logger } from './logger.js';
import { FileService, type WorkerOptions } from './services/attachments/fileJobs.js';
import { HelperJobs } from './services/helpers/helperJobs.js';
import { ProviderGateway } from './providers/gateway.js';

const log = logger.child({ module: 'container' });

export interface Services {
  cfg: Config;
  db: Database;
  registry: ModelRegistry;
  capabilities: CapabilityRegistry;
  auth: AuthService;
  /** Null when GOOGLE_OAUTH_CLIENT_ID is unset: Google sign-in is off (ADR-0056). */
  googleVerifier: GoogleTokenVerifier | null;
  usage: UsageService;
  generation: GenerationService;
  skills: SkillService;
  storage: ObjectStorage;
  retriever: Retriever;
  executionRuntime: ExecutionRuntime;
  /**
   * The provider used for OCR and audio/video transcription during project-file indexing
   * (`retrieval.ts`'s `describeMedia` calls) — always the Gemini adapter, since it is the only
   * one with a `describeMedia` implementation on Vertex today. See ADR-0004, items 3 and 5.
   */
  visionProvider: Provider;
  /** Each chat's current run on this instance and its buffered events, so a client can reattach
   *  after its connection drops; a cache of the `turns` rows (ADR-0078). See `services/runHub.ts`.
   *  One run per chat is the database's rule (`uq_turns_running_chat`), not this map's, and a Stop
   *  reaches a run on any instance through `turns.cancel_requested`. */
  runHub: RunHub;
  /** This process, as the owner of the turn leases it holds. */
  instanceId: string;
  /** Set by `drain()` on SIGTERM: a new generate is refused with 503 `server_shutdown`. */
  lifecycle: { draining: boolean };
  /** The warm sandbox, when it is the engine: `index.ts` checkpoints its idle workspaces. */
  warmSandbox: WarmSandboxClient | null;
  /** The file pipeline: job queue, worker and in-request reading (ADR-0062). */
  files: FileService;
  // --- P22 (ADR-0079)
  /** Prices a call from the price book (or the env JSON, `PRICE_SOURCE`). */
  pricing: PricingService;
  /** The model-call ledger (`model_calls`), written in each turn's settle. */
  ledger: LedgerService;
  /** Deletion records in object storage, outside the database (Stage 5 P11). */
  deletionLedger: DeletionLedger;

  /** P13 (ADR-0080): the helper jobs (title, summary, router shadow), run in the background. */
  helperJobs: HelperJobs;
  /** P11 (ADR-0081): the provider gateway (retries, breaker, kill switch, fallback chain). */
  gateway: ProviderGateway;
}

export interface BuildOptions {
  db?: Database;
  /** Test seam: a fake Google ID-token verifier, so tests never call Google. */
  googleVerifier?: GoogleTokenVerifier;
  providers?: Partial<Record<'google' | 'anthropic', Provider>>;
  storage?: ObjectStorage;
  retriever?: Retriever;
  skills?: SkillService;
  /** Test seam — a real `CloudRunSandboxClient` is never constructed unless a GCP project is
   *  configured, mirroring how the provider adapters lazily construct their own Vertex clients. */
  sandboxClient?: SandboxClient;
  /** Test seam: where Gemini reads page images from. Built from MODEL_INPUT_BUCKET otherwise. */
  modelInputs?: ModelInputStore;
  /** Test seam for the trusted executor. With an injected `sandboxClient` and no trusted client,
   *  trusted work goes to the injected sandbox, as it did before ADR-0008. */
  trustedClient?: SandboxClient;
  executionRuntime?: ExecutionRuntime;
  /** Test seam: the file worker's lease, polling and stage hook. */
  fileWorker?: WorkerOptions;
}

export function buildServices(cfg: Config, options: BuildOptions = {}): Services {
  const db = options.db ?? getDb();

  const providers = options.providers ?? {
    google: new GeminiProvider(cfg),
    anthropic: new AnthropicProvider(cfg),
  };

  const registry = new ModelRegistry(cfg, providers);
  const pricing = new PricingService(cfg);
  const ledger = new LedgerService(pricing);
  const usage = new UsageService(db, cfg, pricing, ledger);
  const retriever = options.retriever ?? new LexicalRetriever();
  const storage = options.storage ?? buildStorage(cfg);

  const isProduction = process.env.NODE_ENV === 'production';
  let rawSandboxClient = options.sandboxClient;
  // G20: one sandbox, built when any of its three grants is on. Each grant is enforced by the
  // runtime, so building it for pdftoppm never exposes run_python.
  const runtimePermissions = {
    pythonAllowed: cfg.ENABLE_RUN_PYTHON,
    trustedCliAllowed: cfg.ENABLE_TRUSTED_CLI,
    skillScriptAllowed: cfg.ENABLE_SKILL_SCRIPTS,
  };
  // ADR-0008: trusted work (poppler, packaged skill scripts) runs as a sanitized local child
  // process, so the Cloud Run sandbox is built only for what still needs it.
  const trustedGrant = runtimePermissions.trustedCliAllowed || runtimePermissions.skillScriptAllowed;
  const trustedLocal = cfg.TRUSTED_WORK_ENGINE === 'local';
  let trustedClient = options.trustedClient;
  if (!trustedClient && trustedGrant && trustedLocal && !options.sandboxClient) {
    trustedClient = new ProcessSandboxClient({
      pythonPath: cfg.TRUSTED_PYTHON_PATH,
      codeTimeoutMs: cfg.TRUSTED_WORK_TIMEOUT_MS,
      maxStdoutBytes: cfg.MAX_STDOUT_BYTES,
      maxStderrBytes: cfg.MAX_STDERR_BYTES,
      // Packaged scripts are read whole; input and output travel as workspace files.
      maxCodeBytes: 512 * 1024,
      inheritEnv: false,
    });
  }
  // The sandbox still serves run_python, and trusted CLIs the local executor lacks (soffice,
  // pandoc for visual QA).
  const anySandboxGrant = runtimePermissions.pythonAllowed || runtimePermissions.trustedCliAllowed || (trustedGrant && !trustedLocal);
  if (!rawSandboxClient && anySandboxGrant) {
    const isCloudRunConfigured = Boolean(
      cfg.GOOGLE_CLOUD_PROJECT && cfg.SANDBOX_LOCATION && cfg.SANDBOX_JOB_NAME,
    );
    // One rule for both the engine and the tool description the model sees (catalog.ts).
    const useWarm = usesWarmSandbox(cfg);
    const useCloudRun =
      !useWarm &&
      (cfg.SANDBOX_ENGINE === 'cloud-run' || (cfg.SANDBOX_ENGINE === 'auto' && isCloudRunConfigured));

    if (useWarm) {
      if (!cfg.SANDBOX_SERVICE_URL) {
        log.error('Warm sandbox requested but SANDBOX_SERVICE_URL is unset; failing closed (run_python disabled).');
      } else if (cfg.SANDBOX_SERVICE_AUTH === 'none' && isProduction) {
        log.error('SANDBOX_SERVICE_AUTH=none is refused in production; failing closed (run_python disabled).');
      } else {
        rawSandboxClient = new WarmSandboxClient({
          baseUrl: cfg.SANDBOX_SERVICE_URL,
          authorization: cfg.SANDBOX_SERVICE_AUTH === 'none' ? async () => null : idTokenAuthorization(cfg.SANDBOX_SERVICE_URL),
          codeTimeoutMs: cfg.RUN_PYTHON_WARM_CODE_TIMEOUT_MS,
          transferBudgetMs: cfg.RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS,
          maxCodeBytes: 512 * 1024,
          state: new WorkspaceStateStore(db, storage),
        });
        log.info({ url: cfg.SANDBOX_SERVICE_URL }, 'run_python uses the warm sandbox service');
      }
    } else if (useCloudRun) {
      if (!cfg.GOOGLE_CLOUD_PROJECT) {
        log.warn('Cloud Run sandbox requested but GOOGLE_CLOUD_PROJECT is unset; failing closed (run_python disabled).');
      } else {
        // The signing account used to be a code default (PH-4, ADR-0065); without it no staged file
        // gets a signed URL, so a run that moves a file fails typed (ADR-0070), and start-up says why.
        if (cfg.SANDBOX_STAGE_BUCKET && !cfg.SANDBOX_SIGNING_SA) {
          log.error('SANDBOX_STAGE_BUCKET is set but SANDBOX_SIGNING_SA is unset; runs that move files fail with sandbox_misconfigured.');
        }
        rawSandboxClient = CloudRunSandboxClient.withAdc(
          cfg.GOOGLE_CLOUD_PROJECT,
          cfg.SANDBOX_LOCATION,
          cfg.SANDBOX_JOB_NAME,
          {
            maxCodeBytes: cfg.MAX_CODE_BYTES,
            codeTimeoutMs: cfg.RUN_PYTHON_CODE_TIMEOUT_MS,
            orchestrationTimeoutMs: cfg.RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS,
            maxStdoutBytes: cfg.MAX_STDOUT_BYTES,
            maxStderrBytes: cfg.MAX_STDERR_BYTES,
            stagingBucket: cfg.SANDBOX_STAGE_BUCKET,
            signingSaEmail: cfg.SANDBOX_SIGNING_SA,
          },
        );
      }
    } else if (cfg.SANDBOX_ENGINE === 'process') {
      if (isProduction) {
        log.error('ProcessSandboxClient is strictly forbidden in production mode; failing closed (run_python disabled).');
      } else {
        rawSandboxClient = new ProcessSandboxClient({
          codeTimeoutMs: cfg.RUN_PYTHON_CODE_TIMEOUT_MS,
          maxStdoutBytes: cfg.MAX_STDOUT_BYTES,
          maxStderrBytes: cfg.MAX_STDERR_BYTES,
          maxCodeBytes: cfg.MAX_CODE_BYTES,
        });
      }
    } else {
      // Auto mode with no Cloud Run configured, or unknown engine
      log.info('No secure sandbox engine configured; failing closed (run_python disabled).');
    }
  }

  // Every run_python call, real or test-injected, is capped by the same Postgres-backed
  // semaphore — the limit protects the project's shared Cloud Run quota, not just the real
  // client, so it applies uniformly rather than only when GOOGLE_CLOUD_PROJECT is set.
  const sandboxClient = rawSandboxClient
    ? new SemaphoreSandboxClient(
        rawSandboxClient,
        new SandboxSemaphore(
          db,
          cfg.MAX_CONCURRENT_RUN_PYTHON,
          // A claim must outlive the longest call it guards, or a slow run frees its slot early.
          (rawSandboxClient instanceof WarmSandboxClient ? cfg.RUN_PYTHON_WARM_CODE_TIMEOUT_MS : 0) +
            cfg.RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS +
            cfg.SANDBOX_CLAIM_LEASE_BUFFER_MS,
        ),
      )
    : undefined;

  const executionRuntime =
    options.executionRuntime ?? new ExecutionRuntime(sandboxClient, undefined, runtimePermissions, trustedClient);
  const capabilities = buildCapabilityRegistry(cfg);
  const skills = options.skills ?? new SkillService(process.cwd(), cfg.SKILLS_DIR, capabilities);
  void skills.load();

  const modelInputs =
    options.modelInputs ?? (cfg.MODEL_INPUT_BUCKET ? new GcsModelInputStore(new GcsClient().bucket(cfg.MODEL_INPUT_BUCKET)) : undefined);
  const helperJobs = new HelperJobs({ db, cfg, registry, ledger, log: logger.child({ module: 'helpers' }) });
  // P11 (ADR-0081): retries, breaker, kill switch and the fallback chain, one per instance.
  const gateway = new ProviderGateway(cfg);
  const generation = new GenerationService(
    db,
    cfg,
    registry,
    usage,
    retriever,
    storage,
    sandboxClient,
    skills,
    capabilities,
    executionRuntime,
    modelInputs,
    helperJobs,
    gateway,
  );

  return {
    cfg,
    db,
    registry,
    capabilities,
    auth: new AuthService(db, cfg),
    googleVerifier: cfg.GOOGLE_OAUTH_CLIENT_ID ? (options.googleVerifier ?? new GisTokenVerifier(cfg.GOOGLE_OAUTH_CLIENT_ID)) : null,
    usage,
    generation,
    skills,
    storage,
    retriever,
    executionRuntime,
    visionProvider: providers.google!,
    runHub: new RunHub(cfg.RUN_BUFFER_MAX_EVENTS),
    instanceId: `${hostname().slice(0, 40)}:${String(process.pid)}:${randomUUID().slice(0, 8)}`,
    lifecycle: { draining: false },
    warmSandbox: rawSandboxClient instanceof WarmSandboxClient ? rawSandboxClient : null,
    helperJobs,
    files: new FileService(
      {
        db,
        storage,
        cfg,
        visionProvider: providers.google!,
        // Stage 9 TOKENS: each family's own count API (Gemini countTokens, Claude count_tokens).
        tokenCounters: { gemini: providers.google!, claude: providers.anthropic! },
        ...(modelInputs ? { modelInputs } : {}),
        log: logger.child({ module: 'files' }),
      },
      options.fileWorker,
    ),
    pricing,
    ledger,
    deletionLedger: new DeletionLedger(storage, cfg.DELETION_LEDGER_PREFIX),
    gateway,
  };
}

/**
 * An `Authorization` header for a Cloud Run service that requires IAM: an ID token for the
 * service's URL, minted from Application Default Credentials (the backend's workload identity
 * on Cloud Run; `gcloud auth application-default login` locally). The client caches and
 * refreshes the token itself.
 */
function idTokenAuthorization(audience: string): () => Promise<string | null> {
  let client: Promise<IdTokenClient> | undefined;
  return async () => {
    client ??= new GoogleAuth().getIdTokenClient(audience);
    const headers = await (await client).getRequestHeaders();
    return headers.get('authorization');
  };
}
