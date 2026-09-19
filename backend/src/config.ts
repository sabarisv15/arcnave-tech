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

  // --- Generation limits --------------------------------------------------
  DEFAULT_MAX_OUTPUT_TOKENS: int(4096),
  MAX_OUTPUT_TOKENS_CEILING: int(32_000),
  /** Character budget for retrieved project context injected into a prompt. */
  PROJECT_CONTEXT_MAX_CHARS: int(12_000),
  PROJECT_CONTEXT_MAX_CHUNKS: int(8),
  HISTORY_MAX_TURNS: int(20),
  /** Bytes of image/PDF attachment data carried forward from earlier turns in one chat, total,
   *  per generate call. Oldest carried-forward attachments drop first past this cap; a file
   *  newly attached to the current turn is never dropped by it. */
  HISTORY_MAX_ATTACHMENT_BYTES: int(12_000_000),

  // --- Search -------------------------------------------------------------
  ENABLE_GOOGLE_SEARCH_GROUNDING: bool(false),
  ENABLE_ANTHROPIC_WEB_SEARCH: bool(false),
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
   *  `finishReason: 'tool_limit'` rather than looping forever once this is hit. */
  TOOL_MAX_ROUNDS: int(8),
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
  /** Region for the Agent Engine / sandboxEnvironments REST calls, confirmed separately from
   *  VERTEX_LOCATION/GEMINI_LOCATION (which cover only the two model APIs) — Agent Engine's
   *  supported-region list was not confirmed live in this environment. */
  SANDBOX_LOCATION: z.string().default('us-central1'), // TODO(verify): confirm against Agent Engine's region list
  /** Hard wall-clock cap on one run_python execution, enforced client-side — the sandbox
   *  :execute call has no documented request-level timeout parameter, so this is ours to
   *  enforce, not the server's. */
  RUN_PYTHON_TIMEOUT_MS: int(30_000),
  /** Same three-tier shape as READ_PROJECT_FILE_MAX_CHARS/TOOL_RESULT_PREVIEW_CHARS above: this
   *  bounds what the model receives and what is persisted; the SSE preview is bounded again by
   *  TOOL_RESULT_PREVIEW_CHARS, unchanged. */
  RUN_PYTHON_MAX_OUTPUT_CHARS: int(8000),

  // --- Storage ------------------------------------------------------------
  STORAGE_BACKEND: z.enum(['local', 'gcs']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./var/uploads'),
  STORAGE_GCS_BUCKET: optionalStr,
  MAX_UPLOAD_BYTES: int(20 * 1024 * 1024),

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
