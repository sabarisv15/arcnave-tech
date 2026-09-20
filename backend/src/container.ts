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
import { CloudRunSandboxClient } from './tools/sandbox/cloudRunSandboxClient.js';
import type { SandboxClient } from './tools/sandbox/client.js';
import { SandboxSemaphore } from './tools/sandbox/semaphore.js';
import { SemaphoreSandboxClient } from './tools/sandbox/semaphoreSandboxClient.js';

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
  const rawSandboxClient =
    options.sandboxClient ??
    (cfg.GOOGLE_CLOUD_PROJECT
      ? CloudRunSandboxClient.withAdc(cfg.GOOGLE_CLOUD_PROJECT, cfg.SANDBOX_LOCATION, cfg.SANDBOX_JOB_NAME, {
          maxCodeBytes: cfg.MAX_CODE_BYTES,
          codeTimeoutMs: cfg.RUN_PYTHON_CODE_TIMEOUT_MS,
          orchestrationTimeoutMs: cfg.RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS,
          maxStdoutBytes: cfg.MAX_STDOUT_BYTES,
          maxStderrBytes: cfg.MAX_STDERR_BYTES,
        })
      : undefined);
  // Every run_python call, real or test-injected, is capped by the same Postgres-backed
  // semaphore — the limit protects the project's shared Cloud Run quota, not just the real
  // client, so it applies uniformly rather than only when GOOGLE_CLOUD_PROJECT is set.
  const sandboxClient = rawSandboxClient
    ? new SemaphoreSandboxClient(
        rawSandboxClient,
        new SandboxSemaphore(
          db,
          cfg.MAX_CONCURRENT_RUN_PYTHON,
          cfg.RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS + cfg.SANDBOX_CLAIM_LEASE_BUFFER_MS,
        ),
      )
    : undefined;
  const capabilities = buildCapabilityRegistry(cfg);
  const skills = options.skills ?? new SkillService(process.cwd(), cfg.SKILLS_DIR, capabilities);
  void skills.load();

  const agentLoop = new AgentLoop(db, cfg, registry, usage, retriever, storage, sandboxClient, skills);
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
    visionProvider: providers.google!,
    activeRuns: new Map(),
  };
}
