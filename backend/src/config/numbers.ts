/**
 * Numbers that have an id in the numbers register
 * (`docs/architecture/00-Handoff/00-numbers-register.md`).
 *
 * config.ts reads its defaults from here, so a value with an N-id is written once, beside the
 * id and the source it came from. A deployment can still override it through the environment;
 * the register is the default, not a lock. Values with no N-id stay in config.ts.
 */

export interface RegisteredNumber {
  readonly value: number;
  /** The register row, e.g. `N-42`. */
  readonly nId: string;
  /** Where the value comes from (register row text, stage decision, or ADR when the repo differs). */
  readonly source: string;
}

const n = (value: number, nId: string, source: string): RegisteredNumber => ({ value, nId, source });

export const NUMBERS = {
  // --- Model calls: Stage 15 ER-1 / ER-2 / ER-4 -----------------------------------------
  /** ER-2: at most two retries, only before the first token. */
  PROVIDER_MAX_RETRIES: n(2, 'N-42', 'Stage 15 ER-2: ≤2 retries before first token'),
  /** ER-2: first backoff 1 s, then 2 s, full jitter. */
  PROVIDER_RETRY_BASE_MS: n(1_000, 'N-42', 'Stage 15 ER-2: backoff 1 s → 2 s + full jitter'),
  /** ER-2: backoff cap. */
  PROVIDER_RETRY_MAX_BACKOFF_MS: n(8_000, 'N-42', 'Stage 15 ER-2: backoff cap 8 s'),
  /** ER-2: a provider Retry-After above this is not waited for; the turn fails instead. */
  PROVIDER_RETRY_AFTER_MAX_MS: n(10_000, 'N-42', 'Stage 15 ER-2: Retry-After honoured up to 10 s'),
  /**
   * One provider request, stream included. N-43 sets first-token, stall and turn timers but no
   * per-request total; the repo keeps the Claude SDK's 10-minute default and no first-token
   * cutoff (ADR-0024, kept by ADR-0054).
   */
  PROVIDER_TIMEOUT_MS: n(600_000, 'N-43', 'ADR-0024 (repo differs from N-43 first-token 20/45/90 s, ADR-0054)'),

  // --- Turn and tool limits: Stage 4 O-2, Stage 8 TD-6 / TD-5c, Stage 15 ER-4, Stage 7 ---
  /** Whole-turn deadline. Kept under the Cloud Run request timeout (N-65: 3,600 s). */
  TURN_DEADLINE_MS: n(3_540_000, 'N-43', 'repo value (59 min, under the 3,600 s platform timeout, N-65); register says turn 10 min (N-43, N-06)'),
  /** Default max output tokens incl. thinking, one turn. */
  DEFAULT_MAX_OUTPUT_TOKENS: n(64_000, 'N-74', 'repo value (agentic default, 64,000); register says per profile Fast 8,192 / Normal 16,384 / Deep 32,768'),
  /** Tool rounds per turn (one round = one provider request + its tool calls). */
  TOOL_MAX_ROUNDS: n(16, 'N-06', 'repo value (ADR-0026); register says tool steps Fast 1-2 / Normal 5 / Deep 15'),
  /** Server-side cap on read_project_file output. */
  READ_PROJECT_FILE_MAX_CHARS: n(6_000, 'N-09', 'repo value, characters; register says tool result cap ~8k tokens + pagination'),
  /** Server-side cap on run_python output read back by the model. */
  RUN_PYTHON_MAX_OUTPUT_CHARS: n(30_000, 'N-09', 'repo value, characters; register says tool result cap ~8k tokens + pagination'),

  // --- Sandbox execution time: Stage 8 TD-5c, N-68 ----------------------------------------
  /** In-container deadline for the user's Python on the Cloud Run Job path. */
  RUN_PYTHON_CODE_TIMEOUT_MS: n(10_000, 'N-08', 'repo value (Cloud Run Job path); register says sandbox time 60 s (Deep 120 s), N-68'),
  /** Code deadline on the warm sandbox service. */
  RUN_PYTHON_WARM_CODE_TIMEOUT_MS: n(300_000, 'N-08', 'repo value (ADR-0010, OCR / renders take minutes); register says sandbox time 60 s (Deep 120 s), N-68'),

  // --- Uploads and retention: Stage 9, Stage 4 AS-D4 ---------------------------------------
  /** Multipart ceiling for project files that pass through the backend. */
  MAX_UPLOAD_BYTES: n(30 * 1024 * 1024, 'N-10', 'repo value (project files, 30 MB); register lists docs 100 MB / XLSX 50 MB / images 20 MB / audio 500 MB / ZIP 100 MB'),
  /** Per-file ceiling for a chat attachment uploaded straight to storage. */
  ATTACHMENT_MAX_BYTES: n(500 * 1024 * 1024, 'N-10', 'repo value (largest per-type limit, audio 500 MB); register lists docs 100 MB / XLSX 50 MB / images 20 MB / ZIP 100 MB'),
  /** A deleted chat's rows and files are purged this long after deletion. */
  CHAT_PURGE_AFTER_DAYS: n(30, 'N-33', 'repo value; register says soft delete 7 d, deletion SLA <= 30 d total'),

  // --- Rate limits: Stage 4 L3 A-3 ----------------------------------------------------------
  /** Generate requests per user per minute. */
  RATE_LIMIT_GENERATE_PER_MINUTE: n(20, 'N-01', 'Stage 18 final: user 20 req/min (repo applies it to the generate route)'),
  /** Write requests per user per minute. */
  RATE_LIMIT_WRITE_PER_MINUTE: n(120, 'N-01', 'repo value; register (Stage 18) says user 20 req/min, company 300, edge 600'),

  // --- Database and sessions ---------------------------------------------------------------
  /** Max connections in the backend pool. */
  DB_POOL_MAX: n(10, 'N-66', 'repo value 10; register says API pool 5 + overflow 5'),
  /** Absolute session lifetime. */
  SESSION_TTL_HOURS: n(24 * 14, 'N-49', 'repo value (14 d); register says user idle 24 h / absolute 28 d'),

  // --- Money: Stage 18 -----------------------------------------------------------------------
  /**
   * Planning exchange rate for the INR figure beside every USD cost. The register says the FX
   * source is Google's monthly rate + FBIL reference (N-37); 88 is the planning rate of the
   * cost decision log (`00-cost-decision-log.md`, header: every rupee figure is at planning FX
   * 88 per USD, N-37). It is a
   * planning rate, not an invoice rate; set PRICING_INR_PER_USD to override.
   */
  PRICING_INR_PER_USD: n(88, 'N-37', 'Stage 18 / FD log: planning FX INR 88 per USD'),
} as const satisfies Record<string, RegisteredNumber>;

export type NumberKey = keyof typeof NUMBERS;
