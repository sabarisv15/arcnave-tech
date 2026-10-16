/**
 * Application configuration.
 *
 * Everything that varies by environment is parsed and validated here, once, at boot. No model
 * ID, project ID, region, credential, or origin is hardcoded anywhere else in the codebase.
 * A bad value fails startup with a readable message rather than surfacing as a 500 later.
 */
import { z } from 'zod';

import { NUMBERS } from './config/numbers.js';

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

/**
 * A positive decimal with a documented default. Unlike `int`, a bad value fails the boot: this
 * one multiplies money, and a silent fallback would print a wrong rupee figure with no warning.
 * Empty counts as unset (compose passes `${VAR:-}`).
 */
const positiveNumber = (fallback: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().positive().default(fallback),
  );

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

/**
 * A model id with a documented default. Unset takes the default; set to an empty string turns
 * the alias off (reported `not_configured`, never swapped for another model).
 */
const modelId = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? fallback : v.trim() === '' ? undefined : v.trim()));

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
  /** N-49 (repo value, absolute session lifetime). */
  SESSION_TTL_HOURS: int(NUMBERS.SESSION_TTL_HOURS.value),
  /** Only set true behind HTTPS; a Secure cookie is silently dropped over plain HTTP. */
  SESSION_COOKIE_SECURE: bool(false),
  /** Signs the cookie so tampering is detectable. Required in production. */
  COOKIE_SECRET: optionalStr,
  /** Off closes POST /auth/register with a typed error. Default on; flip off for single-account testing.
   *  It also stops Google sign-in from creating accounts (existing ones still sign in). */
  REGISTRATION_ENABLED: bool(true),
  /** OAuth client id (Web) for Google sign-in, ADR-0056. Not a secret (the browser sees it).
   *  Unset, POST /auth/google answers `google_signin_disabled`. */
  GOOGLE_OAUTH_CLIENT_ID: optionalStr,

  // --- Database -----------------------------------------------------------
  DATABASE_URL: z.string().default('postgres://arcnave:arcnave@localhost:5432/arcnave'),
  /** N-66 (repo value). */
  DB_POOL_MAX: int(NUMBERS.DB_POOL_MAX.value),
  /**
   * Cloud SQL's Unix-domain-socket directory (e.g. `/cloudsql/project:region:instance`).
   * `postgres.js` has no equivalent of `pg`'s `?host=` query-string convention — passing a
   * socket path that way parses as an empty URL host and throws `ERR_INVALID_URL` before any
   * query runs. The socket path must be given here and passed as the `host` option instead;
   * `DATABASE_URL` still needs a syntactically valid (if unused) hostname when this is set.
   */
  DB_SOCKET_PATH: optionalStr,

  // --- Vertex AI (Gemini) ------------------------------------------------
  GOOGLE_CLOUD_PROJECT: optionalStr,
  /** Vertex endpoint for Gemini. Claude no longer goes through Vertex (ADR-0054). */
  VERTEX_LOCATION: z.string().default('global'),
  /** Gemini 3.8 Flash is global-only, so it gets its own knob. */
  GEMINI_LOCATION: optionalStr,

  // --- Claude API (first party, ADR-0054) ---------------------------------
  /**
   * Secret. Read from the environment (backend/.env locally, Secret Manager in a deployment),
   * never committed. Unset, the Claude aliases report `anthropic_not_configured`; in production
   * a Claude model id set explicitly without a key fails the boot.
   */
  ANTHROPIC_API_KEY: optionalStr,

  // --- Model registry (ADR-0055: three models) ----------------------------
  // Each is an exact model id. Unset means "not configured" for Gemini (no documented default
  // for this deployment's Vertex project). The Claude ids default to the first-party ids on
  // https://docs.claude.com/en/docs/about-claude/models (read 2026-10-14); an empty value
  // turns the alias off.
  MODEL_GEMINI_FLASH: optionalStr,
  MODEL_SONNET: modelId('claude-sonnet-5-5'),
  MODEL_OPUS: modelId('claude-opus-5-5'),

  AUTO_ROUTE_LONG_PROMPT_CHARS: int(2000),
  AUTO_ROUTE_LONG_CONTEXT_CHARS: int(8000),
  MODEL_PROBE_TTL_SECONDS: int(300),
  /** N-43 (repo value, ADR-0024/0054): one provider request, stream included; no first-token cutoff. */
  PROVIDER_TIMEOUT_MS: int(NUMBERS.PROVIDER_TIMEOUT_MS.value),
  PROVIDER_CONNECT_TIMEOUT_MS: int(10_000),
  /** N-42: retries before the first token (Stage 15 ER-2). The SDKs' own retries stay 0. */
  PROVIDER_MAX_RETRIES: int(NUMBERS.PROVIDER_MAX_RETRIES.value),
  /** N-42: backoff base; attempt k waits a full-jitter random part of base·2^(k-1), capped. */
  PROVIDER_RETRY_BASE_MS: int(NUMBERS.PROVIDER_RETRY_BASE_MS.value),
  /** N-42: backoff cap. */
  PROVIDER_RETRY_MAX_BACKOFF_MS: int(NUMBERS.PROVIDER_RETRY_MAX_BACKOFF_MS.value),
  /** N-42: the longest provider Retry-After waited for; a longer one fails the turn instead. */
  PROVIDER_RETRY_AFTER_MAX_MS: int(NUMBERS.PROVIDER_RETRY_AFTER_MAX_MS.value),
  /** Whole-turn deadline. Keep it under the platform request timeout (Cloud Run: set to
   *  3600 s) so a slow turn ends with a typed error, not a severed connection. */
  /** N-43 (repo value; register says turn 10 min). */
  TURN_DEADLINE_MS: int(NUMBERS.TURN_DEADLINE_MS.value),

  // --- Generation limits --------------------------------------------------
  // 64,000 for agentic work (128,000 at xhigh or max effort). A turn
  // never asks for more than its model's own maximum (capabilitiesTable maxOutputTokens).
  /** N-74 (repo value; register has per-profile limits). */
  DEFAULT_MAX_OUTPUT_TOKENS: int(NUMBERS.DEFAULT_MAX_OUTPUT_TOKENS.value),
  MAX_OUTPUT_TOKENS_CEILING: int(128_000),
  /** How hard models think (ReasoningEffort). Clamped per model to the levels it supports.
   *  Medium is the default of Gemini 3.8 Flash (thinkingLevel MEDIUM).
   *  High made every round of every turn think at the maximum, including a plain summary
   *  (ADR-0032). Raise it per deployment only after an eval shows quality needs it. */
  REASONING_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  /** Project files go into the prompt whole while their text totals at most this many
   *  characters; past it, the model searches them with search_project_files (ADR-0020).
   *  This one is ArcNave's: about 50,000 tokens, a fraction of every configured model's
   *  1M-token window, so the conversation keeps its room. */
  PROJECT_FULL_CONTEXT_MAX_CHARS: int(200_000),
  /** Bytes of earlier turns' image/PDF data sent inline to a model whose request limit is not
   *  verified (Gemini inline data), total, per generate call. Oldest drop first past it; a file
   *  of the current turn never does. The Anthropic adapter (verified request limit) and Gemini PDFs sent by
   *  gs:// URI are not held to it (ADR-0019). */
  HISTORY_MAX_ATTACHMENT_BYTES: int(12_000_000),

  // --- Search -------------------------------------------------------------
  ENABLE_GOOGLE_SEARCH_GROUNDING: bool(false),
  ENABLE_ANTHROPIC_WEB_SEARCH: bool(false),
  ENABLE_WEB: bool(false),
  SERPAPI_API_KEY: optionalStr,
  GOOGLE_SEARCH_API_KEY: optionalStr,
  GOOGLE_SEARCH_ENGINE_ID: optionalStr,
  GROUNDING_REDIRECT_TIMEOUT_MS: int(5000),

  /**
   * Gemini's server-side `code_execution` tool (Python sandbox). The Anthropic adapter has no
   * equivalent on Vertex (ADR-0004), so this only ever grows Gemini's capability set.
   */
  ENABLE_GEMINI_CODE_EXECUTION: bool(false),
  /** ADR-0037: ask Vertex to stream function-call arguments so a visual draws while written. */
  GEMINI_STREAM_TOOL_ARGS: bool(true),

  /**
   * Master gate for the item-9 tool-calling loop. Off by default: a deployment gains nothing
   * from it without a project, and it changes both adapters' wire shape.
   */
  ENABLE_TOOL_USE: bool(false),
  /** One round = one provider request + every tool call it made (ADR-0026). The loop answers with
   *  `finishReason: 'tool_limit'` rather than looping forever once this is hit, and the UI offers
   *  Continue at the per-turn tool-use limit. 16, not 8:
   *  search, skill, extract, analyze, one repair and the answer must all fit, and on the real
   *  statement 8 ran out before analysis (G11). TURN_DEADLINE_MS bounds the time. */
  /** N-06 (repo value; register has per-profile tool steps). */
  TOOL_MAX_ROUNDS: int(NUMBERS.TOOL_MAX_ROUNDS.value),
  /** Hard server-side cap on `read_project_file`'s returned text, regardless of what `maxChars`
   *  the model requests. Keeps one large document from ever being handed over whole. */
  /** N-09 (repo value, characters). */
  READ_PROJECT_FILE_MAX_CHARS: int(NUMBERS.READ_PROJECT_FILE_MAX_CHARS.value),
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
  /** N-08 (repo value). */
  RUN_PYTHON_WARM_CODE_TIMEOUT_MS: int(NUMBERS.RUN_PYTHON_WARM_CODE_TIMEOUT_MS.value),
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
  /** N-08 (repo value). */
  RUN_PYTHON_CODE_TIMEOUT_MS: int(NUMBERS.RUN_PYTHON_CODE_TIMEOUT_MS.value),
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
   *  TOOL_RESULT_PREVIEW_CHARS, unchanged. 30,000 is the usual read-back size;
   *  past it, the head and tail are kept. */
  /** N-09 (repo value, characters). */
  RUN_PYTHON_MAX_OUTPUT_CHARS: int(NUMBERS.RUN_PYTHON_MAX_OUTPUT_CHARS.value),
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

  // --- Skills System (Item 11) -------------------------------------------
  /** Master gate for the skills registry, progressive disclosure, and skill tools. */
  ENABLE_SKILLS: bool(true),
  /** Directory path containing ArcNave production SKILL.md bundles (relative to backend root). */
  SKILLS_DIR: z.string().default('skills'),

  // --- Phase 5: Context Intelligence -------------------------------------
  /** Master gate for provider prompt caching (prefix stability & cache_control). */
  ENABLE_PROMPT_CACHE: bool(true),

  /** Persistent memory (memory_items). On by default (ADR-0025). */
  ENABLE_MEMORY: bool(true),
  /** Background conservative distillation of durable user-stated facts. */
  /** Maximum total characters allocated to standing context memories. */
  /** Characters of memory topics a conversation starts with; the rest stay searchable. */
  MEMORY_CONTEXT_MAX_CHARS: int(8000),

  /** Master gate for context pressure-driven conversation compaction (ADR-0019). */
  ENABLE_CONTEXT_COMPACTION: bool(true),
  /** Tokens of the previous request at which a chat compacts, used only when the model's window
   *  is unknown; otherwise compaction runs as the window fills (ADR-0027). */
  COMPACTION_TRIGGER_TOKENS: int(150_000),
  /** Headroom threshold in tokens below which compaction triggers. */
  COMPACTION_TRIGGER_HEADROOM_TOKENS: int(10_000),
  /** Headroom ratio (remaining context / total context window) below which compaction triggers. */
  COMPACTION_TRIGGER_HEADROOM_RATIO: z.coerce.number().min(0.01).max(0.99).default(0.15),

  // --- Phase 6: Generative UI & Phase 7: Analytics ------------------------
  /** Master gate for structured Generative UI (render_ui tool). */
  ENABLE_GENERATIVE_UI: bool(true),
  /** Maximum bytes for a validated Generative UI response payload. */
  UI_MAX_RESPONSE_BYTES: int(100_000),

  // --- Storage ------------------------------------------------------------
  STORAGE_BACKEND: z.enum(['local', 'gcs']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./var/uploads'),
  STORAGE_GCS_BUCKET: optionalStr,
  /**
   * Bucket Gemini reads rendered PDF pages from, by `gs://` URI (ADR-0016). Unset, pages go
   * inline in the request. Only Vertex's service agent needs read access to it.
   */
  MODEL_INPUT_BUCKET: optionalStr,
  /** A deleted chat's rows and uploaded files are removed this long after deletion. */
  /** N-33 (repo value; register says soft delete 7 d, total <= 30 d). */
  CHAT_PURGE_AFTER_DAYS: int(NUMBERS.CHAT_PURGE_AFTER_DAYS.value),
  /** An upload never sent with a message is removed after this long. */
  UNSENT_UPLOAD_TTL_HOURS: int(24),
  /** A chat's sandbox workspace is checkpointed after this long without a run. */
  SANDBOX_CHECKPOINT_IDLE_SECONDS: int(300),
  /** A checkpoint is kept this long after the chat last ran code. */
  SANDBOX_STATE_RETENTION_DAYS: int(30),
  /**
   * Ceiling for uploads that pass through the backend as one request (multipart routes):
   * project files, whose limit is 30 MB. The body limit adds 1 MiB for framing, which
   * keeps the request under Cloud Run's 32 MiB cap.
   */
  /** N-10 (repo value). */
  MAX_UPLOAD_BYTES: int(NUMBERS.MAX_UPLOAD_BYTES.value),
  /**
   * Ceiling for a chat attachment, which the browser uploads straight to storage (the
   * per-file limit). Cloud Run caps a request at 32 MiB, so only the direct path can reach it.
   */
  /** N-10 (repo value). */
  ATTACHMENT_MAX_BYTES: int(NUMBERS.ATTACHMENT_MAX_BYTES.value),
  /**
   * Parser memory one instance may hold at once. Each isolated extraction child gets this
   * divided by EXTRACTION_CONCURRENCY as its heap limit (isolatedExtract.ts); a file whose
   * parser needs more is kept with a `not_extracted` note, and code can still open it. Keep it
   * at about half the instance memory; the backend runs with 8 GiB (2026-09-25), so 4 GiB.
   */
  EXTRACTION_MEMORY_BUDGET_BYTES: int(4 * 1024 * 1024 * 1024),

  // --- File pipeline (Stage 9 PIPE, ADR-0062) --------------------------------
  /**
   * `jobs`: `POST /files/:id/complete` queues a file job and answers 202; the chip polls.
   * `sync`: the same pipeline runs inside the request and the answer is final (the old shape,
   * kept behind this flag; `filePipelineParity.integration.test.ts` holds the two equal).
   */
  FILE_PIPELINE: z.enum(['jobs', 'sync']).default('jobs'),
  /** File jobs one instance runs at once. One slot is always kept for the fast lane. */
  FILE_WORKER_CONCURRENCY: int(3),
  /**
   * A job's lease; renewed by a heartbeat and at every stage, taken over by another worker once
   * it lapses. Longer than the longest single step a job takes without reaching a stage
   * (EXTRACTION_TIMEOUT_MS 5 min; OCR_BATCH_DEADLINE_MS × 2 attempts 6 min) plus margin, so a
   * heartbeat starved by request-based CPU on Cloud Run never hands a healthy job to a second
   * worker (ADR-0063). A job that dies waits this long to be resumed.
   */
  FILE_JOB_LEASE_MS: int(900_000),
  /**
   * `GET /files/:id` (and the project-file read) wakes the worker and holds the poll open up to
   * this long while the file is still being read, returning as soon as its status moves. With
   * request-based CPU, a job advances while a request is open; the chip's polls keep one open
   * (ADR-0063). 0 answers at once.
   */
  FILE_POLL_HOLD_MS: int(5_000),
  /** How often an idle worker looks for queued or abandoned jobs. Enqueueing also wakes it. */
  FILE_WORKER_POLL_MS: int(2_000),
  /** Files up to this size take the fast lane (ours: Stage 9 G30 asks for a fast lane, no size). */
  FILE_FAST_LANE_MAX_BYTES: int(2 * 1024 * 1024),
  /**
   * Isolated extractions one instance runs at once. Each child's heap is
   * EXTRACTION_MEMORY_BUDGET_BYTES / this, so the instance's total stays inside the budget.
   */
  EXTRACTION_CONCURRENCY: int(2),
  /** Re-index project files written by an older indexer (retrieval.ts INDEX_VERSION) on start. */
  FILE_REINDEX_BACKFILL: bool(true),
  /** One isolated extraction's wall clock. Past it the child is killed: `timeout`. */
  EXTRACTION_TIMEOUT_MS: int(300_000),
  /**
   * Malware scanning. `none` runs the `scanning` stage with a scanner that passes every file:
   * the state exists, the scan arrives with the malware phase (P19). Never claim a file was
   * scanned when this is `none`.
   */
  FILE_SCANNER: z.enum(['none', 'clamd']).default('none'),
  /** clamd's TCP address for FILE_SCANNER=clamd (Stage 9 SCAN). The daemon is infra (owner). */
  CLAMD_HOST: z.string().default('127.0.0.1'),
  CLAMD_PORT: int(3310),
  /** One scan's wall clock; past it the file fails `scan_incomplete`. */
  CLAMD_TIMEOUT_MS: int(120_000),
  /**
   * Bytes clamd accepts per INSTREAM (its StreamMaxLength). Stage 9 SCAN wants it at least our
   * largest file (N-10, 500 MB); a longer stream is cut by clamd and the file is `scan_incomplete`.
   */
  CLAMD_STREAM_MAX_BYTES: int(NUMBERS.ATTACHMENT_MAX_BYTES.value),

  // --- OCR, audio, images (Stage 9 OCR-M11 / AUDIO / IMAGES, P09, ADR-0063) --------------
  /** Pages per OCR request: Stage 9 OCR-M11 "≤ 15 pages online" (no N-id). */
  OCR_BATCH_PAGES: int(15),
  /** One OCR request's own deadline (OCR-M11 "own deadline"); one retry after it (≤ 1 retry). */
  OCR_BATCH_DEADLINE_MS: int(180_000),
  /** OCR requests in flight for one file. */
  OCR_CONCURRENCY: int(3),
  /** Audio is cut into pieces this long, each one 60–120 s segment (Stage 9 AUDIO / M10). */
  AUDIO_SEGMENT_SECONDS: int(90),
  /** Overlap read before each piece, so a word cut at a boundary is heard whole once. */
  AUDIO_OVERLAP_SECONDS: int(2),
  /** One transcription request's deadline. */
  AUDIO_SEGMENT_DEADLINE_MS: int(120_000),
  AUDIO_CONCURRENCY: int(4),
  /** Normalised image copy: long edge (Stage 9 IMAGES G14/G15). */
  IMAGE_MAX_LONG_EDGE_PX: int(2_576),
  /**
   * Normalised image copy: encoded size. Stage 9 IMAGES says ≤ 5 MB for Claude; Claude checks
   * the base64 form (capabilitiesTable `maxEncodedImageBytes`), so the bytes are kept at 3/4.
   */
  IMAGE_MAX_BYTES: int(Math.floor((5 * 1024 * 1024 * 3) / 4)),
  /** Long edge when a request carries more than 20 images (Stage 9 IMAGES G48, CLAUDE-IMG). */
  IMAGE_MANY_LONG_EDGE_PX: int(2_000),
  /**
   * Text sent to a count API at most (ours). A larger file is not counted: its count is null,
   * and it goes through retrieval, never whole (ADR-0063; no local estimator, Invariant 3).
   */
  TOKEN_COUNT_MAX_CHARS: int(2_000_000),
  /**
   * Text kept in `attachments.extracted_text` at most (ours). The whole text is always in the
   * derivative's Markdown object; a file beyond this cap is read through retrieval or code.
   */
  EXTRACTED_TEXT_MAX_CHARS: int(2_000_000),
  /** ZIP containers (ZIP uploads and OOXML): refused above this inflate ratio (ours, UD-2 "ratio"). */
  ZIP_MAX_RATIO: int(100),
  /** N-11 (Stage 18 final, 50 uploads/user/day). */
  UPLOADS_PER_USER_PER_DAY: int(NUMBERS.UPLOADS_PER_USER_PER_DAY.value),
  /** N-44 (Stage 15 ER-7 file-blocking: 3 attempts). */
  FILE_JOB_MAX_ATTEMPTS: int(NUMBERS.FILE_JOB_MAX_ATTEMPTS.value),

  // --- Rate limiting ------------------------------------------------------
  /** N-01 (user 20 req/min). */
  RATE_LIMIT_GENERATE_PER_MINUTE: int(NUMBERS.RATE_LIMIT_GENERATE_PER_MINUTE.value),
  /** N-01 (repo value). */
  RATE_LIMIT_WRITE_PER_MINUTE: int(NUMBERS.RATE_LIMIT_WRITE_PER_MINUTE.value),
  RATE_LIMIT_AUTH_PER_MINUTE: int(10),
  /** Anonymous reads of shared links, per IP (ADR-0039). */
  RATE_LIMIT_PUBLIC_SHARE_PER_MINUTE: int(60),

  // --- Pricing ------------------------------------------------------------
  /**
   * N-37: rupees per US dollar, used to put `costInr` beside every `costUsd`. A planning rate
   * (Stage 18 cost log), not an invoice rate. A null cost stays null in rupees too.
   */
  PRICING_INR_PER_USD: positiveNumber(NUMBERS.PRICING_INR_PER_USD.value),
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
  /**
   * Output cap for one media reading (OCR, transcription; `describeMedia` / `readMedia`), D2 X-7.
   * Ours, no N-id: Gemini 3.8 Flash's own maximum (capabilitiesTable), so only the model, never
   * a smaller limit of ours, can cut a reading, and a cut one ends MAX_TOKENS and is marked.
   */
  MEDIA_MAX_OUTPUT_TOKENS: int(65_536),

  // --- Platform and security quick fixes (P04, ADR-0065) -----------------------------------
  /**
   * Proxies in front of this process that append to X-Forwarded-For (ours, no N-id). The client
   * address is the entry that many hops from the right; anything further left was written by the
   * client and is never read. 1 is Cloud Run's front end. 0 trusts no header (the socket peer).
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /**
   * Swagger UI at /docs. Unset: on, except when NODE_ENV=production (off). Set: exactly what it
   * says, in any environment (ADR-0065).
   */
  DOCS_ENABLED: z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()),
    ),
  /** safeFetch: response body ceiling, streamed (Stage 8 08d web_fetch "up to 5 MB"; no N-id). */
  SAFE_FETCH_MAX_BYTES: int(5 * 1024 * 1024),
  /** safeFetch: redirects followed, each re-checked (ours; Stage 8 C2 asks for a per-hop check). */
  SAFE_FETCH_MAX_REDIRECTS: int(3),
  /** N-43: tools fetch_url 10 s, the whole fetch including redirects. */
  SAFE_FETCH_TIMEOUT_MS: int(NUMBERS.FETCH_URL_TIMEOUT_MS.value),
  /**
   * Service account that signs the Cloud Run Job sandbox's staging URLs. Unset, inputs and outputs
   * are not given signed URLs (an identifier is never a code default, PH-4).
   */
  SANDBOX_SIGNING_SA: optionalStr,

  // --- File pipeline: review fixes (tech-build.3 Part D, ADR-0066) ---------
  /**
   * Where the file pipeline writes its working copies (ours). Empty = `os.tmpdir()`, which on
   * Cloud Run is in memory and counts against the instance's memory limit (review M1).
   */
  FILE_TMP_DIR: z.string().default(''),
  /**
   * Files above this size are "large" (ours): at most one large file job runs per instance at
   * a time, so working copies of two large files never sit in one instance at once (review M1).
   */
  FILE_LARGE_JOB_BYTES: int(100 * 1024 * 1024),
  /**
   * A file left `queued` with no live job for longer than this (ours) gets a job on its next
   * status poll (review N3: a crash between a status move and the job insert).
   */
  FILE_ORPHAN_GRACE_MS: int(60_000),
  /** Wall clock of the ZIP pre-flight's streaming pass over every member (ours, review M3). */
  ZIP_PREFLIGHT_TIMEOUT_MS: int(120_000),

  // --- safeFetch: review fixes (tech-build.3 Part B, ADR-0065) -------------
  /**
   * Redirects followed when resolving a grounding citation (ours). Its chains (Vertex redirect,
   * then http → https → www → a language path) are longer than a fetched page's; every hop is
   * still checked.
   */
  SAFE_FETCH_GROUNDING_MAX_REDIRECTS: int(8),
  /** One TCP connect attempt before safeFetch tries the host's next checked address (ours). */
  SAFE_FETCH_CONNECT_TIMEOUT_MS: int(3_000),
});

export type Env = z.infer<typeof envSchema>;

export interface Config extends Env {
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly vertexConfigured: boolean;
  readonly anthropicConfigured: boolean;
  readonly geminiLocation: string;
  readonly sessionTtlMs: number;
  /** DOCS_ENABLED resolved against NODE_ENV (ADR-0065). */
  readonly docsEnabled: boolean;
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
    // A Claude model named on purpose with no key would show as unavailable at every turn;
    // the defaults alone do not count, so a Gemini-only deployment needs no key.
    const claudeNamed = [source.MODEL_SONNET, source.MODEL_OPUS].some((v) => v !== undefined && v.trim() !== '');
    if (claudeNamed && !env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY must be set when MODEL_SONNET or MODEL_OPUS is set in production.');
    }
  }

  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    vertexConfigured: Boolean(env.GOOGLE_CLOUD_PROJECT),
    anthropicConfigured: Boolean(env.ANTHROPIC_API_KEY),
    geminiLocation: env.GEMINI_LOCATION ?? env.VERTEX_LOCATION,
    sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
    docsEnabled: env.DOCS_ENABLED ?? env.NODE_ENV !== 'production',
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
