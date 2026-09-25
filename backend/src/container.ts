/**
 * Service container.
 *
 * Built once at startup and attached to the Fastify instance. Constructing services here
 * rather than importing singletons into each route is what lets a test swap the database or
 * a provider without monkey-patching module state.
 */
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { getDb } from './db/client.js';
import { AnthropicVertexProvider } from './providers/anthropicVertex.js';
import { GeminiProvider } from './providers/gemini.js';
import { GptOssVertexProvider } from './providers/gptOssVertex.js';
import { ModelRegistry } from './providers/registry.js';
import type { Provider } from './providers/types.js';
import { buildCapabilityRegistry } from './capabilities/factory.js';
import type { CapabilityRegistry } from './capabilities/registry.js';
import { AgentLoop } from './services/agentLoop.js';
import { AuthService } from './services/auth.js';
import { GenerationService } from './services/generation.js';
import type { Retriever } from './services/retrieval.js';
import { LexicalRetriever } from './services/retrieval.js';
import type { ObjectStorage } from './services/storage.js';
import { buildStorage } from './services/storage.js';
import { SkillService } from './services/skills.js';
import { UsageService } from './services/usage.js';
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
import { logger } from './logger.js';

const log = logger.child({ module: 'container' });

export interface Services {
  cfg: Config;
  db: Database;
  registry: ModelRegistry;
  capabilities: CapabilityRegistry;
  auth: AuthService;
  usage: UsageService;
  generation: GenerationService;
  agentLoop: AgentLoop;
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
  /**
   * Active generation runs, keyed by chat id.
   *
   * Lets `POST /chats/:id/stop` abort a stream that a different HTTP connection is driving,
   * and lets a second `generate` on the same chat be rejected instead of interleaving output.
   * In-process by design: a multi-instance deployment needs a shared signal (Redis pub/sub)
   * before horizontal scaling, which is recorded as a known limitation.
   */
  activeRuns: Map<string, AbortController>;
  /** Each chat's current run and its buffered events, so a client can reattach after its
   *  connection drops. See `services/runHub.ts`. */
  runHub: RunHub;
  /** The warm sandbox, when it is the engine: `index.ts` checkpoints its idle workspaces. */
  warmSandbox: WarmSandboxClient | null;
}

export interface BuildOptions {
  db?: Database;
  providers?: Partial<Record<'google' | 'anthropic' | 'openai-oss', Provider>>;
  storage?: ObjectStorage;
  retriever?: Retriever;
  skills?: SkillService;
  /** Test seam — a real `CloudRunSandboxClient` is never constructed unless a GCP project is
   *  configured, mirroring how the provider adapters lazily construct their own Vertex clients. */
  sandboxClient?: SandboxClient;
  /** Test seam for the trusted executor. With an injected `sandboxClient` and no trusted client,
   *  trusted work goes to the injected sandbox, as it did before ADR-0008. */
  trustedClient?: SandboxClient;
  executionRuntime?: ExecutionRuntime;
}

export function buildServices(cfg: Config, options: BuildOptions = {}): Services {
  const db = options.db ?? getDb();

  const providers = options.providers ?? {
    google: new GeminiProvider(cfg),
    anthropic: new AnthropicVertexProvider(cfg),
    'openai-oss': new GptOssVertexProvider(cfg),
  };

  const registry = new ModelRegistry(cfg, providers);
  const usage = new UsageService(db, cfg);
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

  const agentLoop = new AgentLoop(
    db,
    cfg,
    registry,
    usage,
    retriever,
    storage,
    sandboxClient,
    skills,
    executionRuntime,
    providers.google,
  );
  const generation = new GenerationService(
    db,
    cfg,
    registry,
    usage,
    retriever,
    storage,
    sandboxClient,
    agentLoop,
    skills,
    capabilities,
    executionRuntime,
    providers.google,
  );

  return {
    cfg,
    db,
    registry,
    capabilities,
    auth: new AuthService(db, cfg),
    usage,
    generation,
    agentLoop,
    skills,
    storage,
    retriever,
    executionRuntime,
    visionProvider: providers.google!,
    activeRuns: new Map(),
    runHub: new RunHub(),
    warmSandbox: rawSandboxClient instanceof WarmSandboxClient ? rawSandboxClient : null,
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
