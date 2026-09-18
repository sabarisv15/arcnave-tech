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
import { AuthService } from './services/auth.js';
import { GenerationService } from './services/generation.js';
import type { Retriever } from './services/retrieval.js';
import { LexicalRetriever } from './services/retrieval.js';
import type { ObjectStorage } from './services/storage.js';
import { buildStorage } from './services/storage.js';
import { UsageService } from './services/usage.js';

export interface Services {
  cfg: Config;
  db: Database;
  registry: ModelRegistry;
  auth: AuthService;
  usage: UsageService;
  generation: GenerationService;
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
  const generation = new GenerationService(db, cfg, registry, usage, retriever, storage);

  return {
    cfg,
    db,
    registry,
    auth: new AuthService(db, cfg),
    usage,
    generation,
    storage,
    retriever,
    visionProvider: providers.google!,
    activeRuns: new Map(),
  };
}
