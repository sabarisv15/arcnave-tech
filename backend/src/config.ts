/**
 * Application configuration.
 *
 * Everything that varies by environment is parsed and validated here, once, at boot. No model
 * ID, project ID, region, credential, or origin is hardcoded anywhere else in the codebase.
 * A bad value fails startup with a readable message rather than surfacing as a 500 later.
 */
import { z } from 'zod';

const csv = (fallback: string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? fallback
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    );

const int = (fallback: number) =>
  z.coerce.number().int().catch(fallback).default(fallback);

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

/** Optional string where empty means "not configured", never "use a default". */
const optionalStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const pricingSchema = z.record(
  z.string(),
  z.object({
    input: z.number().nonnegative().default(0),
    output: z.number().nonnegative().default(0),
    cacheRead: z.number().nonnegative().default(0),
    cacheWrite: z.number().nonnegative().default(0),
  }),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(8080),
  HOST: z.string().default('0.0.0.0'),
  // 'silent' is a real pino level, not a sentinel. Tests and the OpenAPI generator need a way
  // to run the app without writing a log line per request.
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // --- HTTP ---------------------------------------------------------------
  API_PREFIX: z.string().default('/v1'),
  CORS_ORIGINS: csv(['http://127.0.0.1:5173', 'http://localhost:5173']),
  SESSION_COOKIE_NAME: z.string().default('arcnave_session'),
  SESSION_TTL_HOURS: int(24 * 14),
  /** Only set true behind HTTPS; a Secure cookie is silently dropped over plain HTTP. */
  SESSION_COOKIE_SECURE: bool(false),
  /** Signs the cookie so tampering is detectable. Required in production. */
  COOKIE_SECRET: optionalStr,
  /** Off closes POST /auth/register with a typed error. Default on; flip off for single-account testing. */
  REGISTRATION_ENABLED: bool(true),

  // --- Database -----------------------------------------------------------
  DATABASE_URL: z.string().default('postgres://arcnave:arcnave@localhost:5432/arcnave'),
  DB_POOL_MAX: int(10),
  /**
   * Cloud SQL's Unix-domain-socket directory (e.g. `/cloudsql/project:region:instance`).
   * `postgres.js` has no equivalent of `pg`'s `?host=` query-string convention — passing a
   * socket path that way parses as an empty URL host and throws `ERR_INVALID_URL` before any
   * query runs. The socket path must be given here and passed as the `host` option instead;
   * `DATABASE_URL` still needs a syntactically valid (if unused) hostname when this is set.
   */
  DB_SOCKET_PATH: optionalStr,

  // --- Vertex AI ----------------------------------------------------------
  GOOGLE_CLOUD_PROJECT: optionalStr,
  /**
   * "global" is the only endpoint type that serves Opus 5 / Sonnet 5 and it carries no pricing
   * premium; regional endpoints top out at Sonnet 4.6. See docs/backend-research.md section 2.
   */
  VERTEX_LOCATION: z.string().default('global'),
  /** Gemini 3.8 Flash is global-only, so it gets its own knob. */
  GEMINI_LOCATION: optionalStr,
  /**
   * gpt-oss is a Model-as-a-Service open model and is NOT served at the `global` endpoint —
   * a request there 404s. Verified 2026-09-17: present in `us-central1`, absent from
   * `global`. It therefore needs its own location, because VERTEX_LOCATION must stay
   * `global` for Opus 5 / Sonnet 5.
   */
  GPT_OSS_LOCATION: optionalStr,

  // --- Model registry -----------------------------------------------------
  // Each is an exact publisher model ID, verified present in your project and region.
  // Unset means "not configured" -> the alias reports unavailable. Never guessed.
  MODEL_GEMINI_FLASH: optionalStr,
  MODEL_SONNET: optionalStr,
  MODEL_OPUS: optionalStr,
  MODEL_GPT_OSS: optionalStr,

  AUTO_ROUTE_LONG_PROMPT_CHARS: int(2000),
  AUTO_ROUTE_LONG_CONTEXT_CHARS: int(8000),
  MODEL_PROBE_TTL_SECONDS: int(300),
  PROVIDER_TIMEOUT_MS: int(120_000),
  PROVIDER_CONNECT_TIMEOUT_MS: int(10_000),
  PROVIDER_MAX_RETRIES: int(2),
  /** Whole-turn deadline. Keep it under the platform request timeout (Cloud Run: set to
   *  3600 s) so a slow turn ends with a typed error, not a severed connection. */
  TURN_DEADLINE_MS: int(3_540_000),
  /** Chat-mode wait for a provider's first event; search, research and attachments scale it. */
  PROVIDER_TTFT_BUDGET_MS: int(12_000),

  // --- Generation limits --------------------------------------------------
  DEFAULT_MAX_OUTPUT_TOKENS: int(32_000),
  MAX_OUTPUT_TOKENS_CEILING: int(32_000),
  /** Character budget for retrieved project context injected into a prompt. */
  PROJECT_CONTEXT_MAX_CHARS: int(12_000),
  PROJECT_CONTEXT_MAX_CHUNKS: int(8),
  HISTORY_MAX_TURNS: int(20),
  /** Bytes of image/PDF attachment data carried forward from earlier turns in one chat, total,
   *  per generate call. Oldest carried-forward attachments drop first past this cap; a file
   *  newly attached to the current turn is never dropped by it. */
  HISTORY_MAX_ATTACHMENT_BYTES: int(12_000_000),
  /** Characters of text-extracted attachment content carried forward per older turn, per
   *  generate call: "how much of a file to re-pay for on every later turn of the same chat".
   *  Upload keeps the whole text (ADR-0011). */
  HISTORY_MAX_ATTACHMENT_TEXT_CHARS: int(8000),

  // --- Search -------------------------------------------------------------
  ENABLE_GOOGLE_SEARCH_GROUNDING: bool(false),
  ENABLE_ANTHROPIC_WEB_SEARCH: bool(false),
  ENABLE_WEB: bool(false),
  SERPAPI_API_KEY: optionalStr,
  GOOGLE_SEARCH_API_KEY: optionalStr,
  GOOGLE_SEARCH_ENGINE_ID: optionalStr,
  GROUNDING_REDIRECT_TIMEOUT_MS: int(5000),

  /**
   * Gemini's server-side `code_execution` tool (Python sandbox). Claude has no equivalent on
   * Vertex — see ADR-0004 — so this only ever grows Gemini's capability set, never Claude's.
   */
  ENABLE_GEMINI_CODE_EXECUTION: bool(false),

  /**
   * Master gate for the item-9 tool-calling loop. Off by default: a deployment gains nothing
   * from it without a project, and it changes both adapters' wire shape.
   */
  ENABLE_TOOL_USE: bool(false),
  /** One round = one provider request + at most one tool execution. The loop answers with
   *  `finishReason: 'tool_limit'` rather than looping forever once this is hit. 16, not 8:
   *  search, skill, extract, analyze, one repair and the answer must all fit, and on the real
   *  statement 8 ran out before analysis (G11). TURN_DEADLINE_MS bounds the time. */
  TOOL_MAX_ROUNDS: int(16),
  /** Hard server-side cap on `read_project_file`'s returned text, regardless of what `maxChars`
   *  the model requests. Keeps one large document from ever being handed over whole. */
  READ_PROJECT_FILE_MAX_CHARS: int(6000),
  /** Length of the `tool_result` SSE preview string. Independent of what the model receives
   *  (the full bounded result) and what is persisted (the same full bounded result) — this is
   *  the UI's budget only. */
  TOOL_RESULT_PREVIEW_CHARS: int(300),

  /**
   * Second, independent gate on top of ENABLE_TOOL_USE — arbitrary code execution is a
   * materially larger blast radius than read-only project-file search, and must be
   * independently toggleable. Both must be true for run_python to appear in the tool list.
   */
  ENABLE_RUN_PYTHON: bool(false),
  /** G20: the allowlisted CLI utilities (pdftoppm, soffice, pandoc, pdftotext, pdfinfo) in the
   *  same sandbox, independent of ENABLE_RUN_PYTHON. Page rendering for table extraction and
   *  Office visual QA needs this, not arbitrary code. */
  ENABLE_TRUSTED_CLI: bool(false),
  /** G20: packaged `.py` scripts shipped inside skills (`backend/skills/<skill>/scripts/`),
   *  independent of ENABLE_RUN_PYTHON. Model-written code never runs through this grant. */
  ENABLE_SKILL_SCRIPTS: bool(false),
  /** Pages one extract_scanned_table_rows call reads. Larger PDFs are extracted in chunks the
   *  model asks for, accumulating under one extractionId. */
  TABLE_EXTRACTION_MAX_PAGES: int(30),
  /** Where trusted work runs: poppler CLIs (pdftoppm, pdfinfo, pdftotext) and packaged skill
   *  scripts. 'local' runs them as a sanitized child process of the backend (ADR-0008): they are
   *  repository code, and a cold Cloud Run Job per call made one extraction take minutes.
   *  'sandbox' sends them to the run_python sandbox, as before. Model-written code never runs
   *  locally, whatever this says. */
  TRUSTED_WORK_ENGINE: z.enum(['local', 'sandbox']).default('local'),
  /** Interpreter for local trusted work. Debian images have python3, not python. */
  TRUSTED_PYTHON_PATH: z.string().default(process.platform === 'win32' ? 'python' : 'python3'),
  /** Per-call deadline for local trusted work (a 12-page 300 dpi render included). */
  TRUSTED_WORK_TIMEOUT_MS: int(120_000),
  /** Sandbox engine: 'warm' (the long-lived sandbox service, ADR-0010), 'cloud-run' (a
   *  single-use Cloud Run Job per call), 'process' (local development only), or 'auto'
   *  (warm when SANDBOX_SERVICE_URL is set, else the Job when it is configured). */
  SANDBOX_ENGINE: z.enum(['warm', 'cloud-run', 'process', 'auto']).default('auto'),
  /** Base URL of the warm sandbox service (ADR-0010), e.g. its Cloud Run https URL. */
  SANDBOX_SERVICE_URL: optionalStr,
  /** 'id-token' authenticates to the service as the backend's service account (Cloud Run IAM).
   *  'none' is for a local sandbox server in development and is refused in production. */
  SANDBOX_SERVICE_AUTH: z.enum(['id-token', 'none']).default('id-token'),
  /** How long one run_python call's code may run on the warm service. Real document work
   *  (OCR, a 12-page render) takes minutes, not the Job's 10 s. */
  RUN_PYTHON_WARM_CODE_TIMEOUT_MS: int(300_000),
  /** Region for the arcnave-python-sandbox Cloud Run Job, independent of VERTEX_LOCATION/
   *  GEMINI_LOCATION (which cover only the two model APIs). See docs/decisions/0005-cloud-run-sandbox.md. */
  SANDBOX_LOCATION: z.string().default('us-central1'),
  /** Name of the Cloud Run Job resource run_python launches a fresh execution of per call. */
  SANDBOX_JOB_NAME: z.string().default('arcnave-python-sandbox'),
  /** Dedicated GCS bucket for temporary per-run staging (runs/<runId>/input/ and runs/<runId>/output/). */
  SANDBOX_STAGE_BUCKET: optionalStr,
  /** Raw UTF-8 byte ceiling on submitted code, enforced client-side before any network call.
   *  Cloud Run caps a single env-var value at 32,768 bytes and base64 expands by ~33%, so the
   *  real ceiling is ~24.5 KiB; this stays comfortably under that. */
  MAX_CODE_BYTES: int(20 * 1024),
  /** In-container deadline (passed as RUN_PYTHON_CODE_TIMEOUT_MS) bounding only the user's
   *  Python subprocess — never reused as the client-side orchestration deadline below. */
  RUN_PYTHON_CODE_TIMEOUT_MS: int(10_000),
  /** Client-side deadline covering the entire jobs:run -> Operation -> Execution -> Cloud
   *  Logging round trip. Must stay comfortably larger than RUN_PYTHON_CODE_TIMEOUT_MS plus
   *  realistic Cloud Run scheduling and Cloud Logging indexing lag. */
  RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS: int(45_000),
  /** Streaming-capture cap enforced by the in-container runner as it reads each pipe — not a
   *  post-hoc slice, so an unbounded print loop can't OOM the container before this applies. */
  MAX_STDOUT_BYTES: int(64 * 1024),
  MAX_STDERR_BYTES: int(64 * 1024),
  /** Same three-tier shape as READ_PROJECT_FILE_MAX_CHARS/TOOL_RESULT_PREVIEW_CHARS above: this
   *  bounds what the model receives and what is persisted; the SSE preview is bounded again by
   *  TOOL_RESULT_PREVIEW_CHARS, unchanged. */
  RUN_PYTHON_MAX_OUTPUT_CHARS: int(8000),
  /** Global cap on concurrent run_python executions, across every backend instance — enforced in
   *  Postgres (tools/sandbox/semaphore.ts), not per-instance, since the service autoscales.
   *  Chosen well under the project's Cloud Run quotas (RunningExecutionsPerProject: 1000;
   *  JobRunPerMinutePerProjectRegion: 180 — the latter is the binding one at this default). */
  MAX_CONCURRENT_RUN_PYTHON: int(20),
  /** Extra time added on top of RUN_PYTHON_ORCHESTRATION_TIMEOUT_MS before a claim's lease
   *  expires and it stops counting against the cap. Must be positive slack, not a separate
   *  guess — an unreleased claim from a real still-running call must never be reaped as
   *  abandoned while it's genuinely in flight. */
  SANDBOX_CLAIM_LEASE_BUFFER_MS: int(30_000),

  // --- Agent Loop & Goals (Item 10) ---------------------------------------
  /** Master gate for the autonomous multi-step agent loop and goal bookkeeping tools. */
  ENABLE_AGENT_LOOP: bool(false),
  /** Default token budget allocated to an autonomous agent goal. */
  GOAL_DEFAULT_TOKEN_BUDGET: int(100_000),
  /** Maximum number of autonomous turns / steps executed in one agent run before stopping. */
  AGENT_MAX_STEPS: int(12),
  /** Maximum total tool calls executed across an entire agent run before stopping. */
  AGENT_MAX_TOOL_CALLS: int(30),
  /** Maximum wall-clock time in milliseconds allowed for an autonomous agent loop run. */
  AGENT_LOOP_TIMEOUT_MS: int(120_000),

  // --- Skills System (Item 11) -------------------------------------------
  /** Master gate for the skills registry, progressive disclosure, and skill tools. */
  ENABLE_SKILLS: bool(true),
  /** Directory path containing ArcNave production SKILL.md bundles (relative to backend root). */
  SKILLS_DIR: z.string().default('skills'),
  /** Maximum number of distinct skills that can be loaded in one step. */
  MAX_LOADED_SKILLS_PER_STEP: int(3),
  /** Maximum character/token budget allocated to injected skill instructions in context. */
  MAX_SKILL_CONTEXT_TOKENS: int(12_000),

  // --- Artifacts ----------------------------------------------------------
  /** Maximum bytes of content allowed in a model-generated artifact (create/update). */
  ARTIFACT_MAX_CONTENT_BYTES: int(500_000),

  // --- Phase 5: Context Intelligence -------------------------------------
  /** Master gate for provider prompt caching (prefix stability & cache_control). */
  ENABLE_PROMPT_CACHE: bool(true),
  /** Minimum prefix token count required before Anthropic cache_control is placed. */
  PROMPT_CACHE_MIN_TOKENS_ANTHROPIC: int(1024),
  /** Minimum prefix token count expected before Gemini Vertex implicit caching kicks in. */
  PROMPT_CACHE_MIN_TOKENS_GEMINI: int(2048),

  /** Master gate for persistent memory (PostgreSQL durable memory_items). */
  ENABLE_MEMORY: bool(false),
  /** Background conservative distillation of durable user-stated facts. */
  ENABLE_MEMORY_BACKGROUND_DISTILL: bool(false),
  /** Maximum total characters allocated to standing context memories. */
  MEMORY_STANDING_MAX_CHARS: int(2000),
  /** Maximum relevant memory items injected per turn. */
  MEMORY_RELEVANT_MAX_ITEMS: int(5),

  /** Master gate for context pressure-driven conversation compaction. */
  ENABLE_CONTEXT_COMPACTION: bool(false),
  /** Headroom threshold in tokens below which compaction triggers. */
  COMPACTION_TRIGGER_HEADROOM_TOKENS: int(10_000),
  /** Headroom ratio (remaining context / total context window) below which compaction triggers. */
  COMPACTION_TRIGGER_HEADROOM_RATIO: z.coerce.number().min(0.01).max(0.99).default(0.15),

  // --- Phase 6: Generative UI & Phase 7: Analytics ------------------------
  /** Master gate for structured Generative UI (render_ui tool). */
  ENABLE_GENERATIVE_UI: bool(true),
  /** Master gate for image generation and editing via Gemini Image hierarchy. */
  ENABLE_IMAGE_GENERATION: bool(true),
  /** Maximum bytes for a validated Generative UI response payload. */
  UI_MAX_RESPONSE_BYTES: int(100_000),
  /** Master gate for advanced data analytics sessions and profiling. */
  ENABLE_ANALYTICS: bool(true),
  /** Gate for composed interactive dashboards. */
  ENABLE_ANALYTICS_DASHBOARDS: bool(true),
  /** Sliding TTL in hours for ephemeral derived datasets before recomputation. */
  DERIVED_DATASET_TTL_HOURS: int(168),

  // --- Storage ------------------------------------------------------------
  STORAGE_BACKEND: z.enum(['local', 'gcs']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./var/uploads'),
  STORAGE_GCS_BUCKET: optionalStr,
  /** Ceiling for uploads that pass through the backend as one request (multipart routes). */
  MAX_UPLOAD_BYTES: int(20 * 1024 * 1024),
  /**
   * Ceiling for a chat attachment, which the browser uploads straight to storage (Claude's
   * per-file limit). Cloud Run caps a request at 32 MiB, so only the direct path can reach it.
   */
  ATTACHMENT_MAX_BYTES: int(500 * 1024 * 1024),
  /**
   * Peak memory one upload's text extraction may take; extractions run one at a time per
   * instance. With EXTRACTION_MEMORY_PER_BYTE this gives each type's size limit for extraction
   * (larger files are stored, not extracted). Keep it at about half the instance memory; the
   * backend runs with 8 GiB (2026-09-25), so 4 GiB. Lower it with the memory, never above it.
   */
  EXTRACTION_MEMORY_BUDGET_BYTES: int(4 * 1024 * 1024 * 1024),

  // --- Rate limiting ------------------------------------------------------
  RATE_LIMIT_GENERATE_PER_MINUTE: int(20),
  RATE_LIMIT_WRITE_PER_MINUTE: int(120),
  RATE_LIMIT_AUTH_PER_MINUTE: int(10),

  // --- Pricing ------------------------------------------------------------
  /**
   * JSON: {"<providerModelId>": {"input": <usd per 1M>, "output": <usd per 1M>,
   *        "cacheRead": <usd per 1M>, "cacheWrite": <usd per 1M>}}
   * Cost is reported ONLY for models present here. No entry means cost is null, never zero.
   */
  PRICING_TABLE: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || v.trim() === '') return {};
      try {
        return pricingSchema.parse(JSON.parse(v));
      } catch (err) {
        ctx.addIssue({
          code: 'custom',
          message: `PRICING_TABLE is not valid JSON matching the expected shape: ${String(err)}`,
        });
        return z.NEVER;
      }
    }),
});

export type Env = z.infer<typeof envSchema>;

export interface Config extends Env {
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly vertexConfigured: boolean;
  readonly geminiLocation: string;
  readonly gptOssLocation: string;
  readonly sessionTtlMs: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    // These are footguns that only bite in production, so they fail the boot there and
    // nowhere else: a dev machine must stay runnable with zero configuration.
    if (!env.COOKIE_SECRET || env.COOKIE_SECRET.length < 32) {
      throw new Error('COOKIE_SECRET must be set to at least 32 characters in production.');
    }
    if (env.CORS_ORIGINS.some((o) => o === '*')) {
      throw new Error('CORS_ORIGINS cannot be "*" in production.');
    }
    if (!env.SESSION_COOKIE_SECURE) {
      throw new Error('SESSION_COOKIE_SECURE must be true in production.');
    }
  }

  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    vertexConfigured: Boolean(env.GOOGLE_CLOUD_PROJECT),
    geminiLocation: env.GEMINI_LOCATION ?? env.VERTEX_LOCATION,
    gptOssLocation: env.GPT_OSS_LOCATION ?? env.VERTEX_LOCATION,
    sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  };
}

let cached: Config | undefined;

export function config(): Config {
  cached ??= loadConfig();
  return cached;
}

/** Test hook: drop the memoised config so a suite can vary the environment. */
export function resetConfig(): void {
  cached = undefined;
}
