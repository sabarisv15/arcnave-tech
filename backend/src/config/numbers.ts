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
  /**
   * Per-type upload limits (Stage 9 LIMITS, Stage 1 FT-7). Applied by `checkUpload` before any
   * byte is sent and again by the browser's `validateFile`. "Docs" covers PDF, Word, PowerPoint,
   * CSV / TXT / MD and the extra text and document types kept from before (EXTRA_TYPES).
   */
  UPLOAD_DOC_MAX_BYTES: n(100 * 1024 * 1024, 'N-10', 'register: docs 100 MB'),
  UPLOAD_XLSX_MAX_BYTES: n(50 * 1024 * 1024, 'N-10', 'register: XLSX 50 MB'),
  /** Was 10 MB in the repo (ADR-0011); the register says 20 MB. */
  UPLOAD_IMAGE_MAX_BYTES: n(20 * 1024 * 1024, 'N-10', 'register: images 20 MB'),
  /** Audio, and the video kept from before (EXTRA_TYPES), share the media limit. */
  UPLOAD_AUDIO_MAX_BYTES: n(500 * 1024 * 1024, 'N-10', 'register: audio 500 MB / 3 h (duration not checked yet)'),
  UPLOAD_ZIP_MAX_BYTES: n(100 * 1024 * 1024, 'N-10', 'register: ZIP 100 MB'),
  /** Checked with ffprobe before transcription (P09). */
  AUDIO_MAX_SECONDS: n(3 * 3600, 'N-10', 'register: audio ≤3 h'),
  ZIP_MAX_MEMBERS: n(20, 'N-10', 'register: ZIP ≤20 files'),
  ZIP_MAX_UNPACKED_BYTES: n(500 * 1024 * 1024, 'N-10', 'register: ZIP ≤500 MB unpacked'),
  PDF_MAX_PAGES: n(1_000, 'N-10', 'register: docs ≤1,000 pages'),
  FILES_PER_MESSAGE: n(10, 'N-10', 'register: ≤10 files per message'),
  FILES_PER_CHAT: n(20, 'N-10', 'register: ≤20 files per chat'),
  /** FT-15: counted when an upload starts, before any byte is accepted. */
  UPLOADS_PER_USER_PER_DAY: n(50, 'N-11', 'Stage 18 final: uploads 50/user/day'),
  /** File jobs: attempts before a job is failed (Stage 15 ER-7 file-blocking queue). */
  FILE_JOB_MAX_ATTEMPTS: n(3, 'N-44', 'Stage 15 ER-7: file-blocking 3 attempts (Cloud Tasks deferred; in-process worker)'),
  // --- File ingest: Stage 9 TOKENS / CHUNK / PDF->MODEL, Stage 6 CXD-4 (P12) ------------------
  /**
   * A file whose provider token count (per model family) is at most this goes to the model
   * whole; above it, or with no count, it goes through retrieval.
   */
  WHOLE_FILE_MAX_TOKENS: n(30_000, 'N-05', 'register: whole-file limit 30k (Deep 100k test arm, Stage 21)'),
  /**
   * Page images sent for a PDF too large to send whole: images of the retrieved (or first)
   * pages only. Normal profile; Fast 3 / Deep 20 arrive with the profiles (P10).
   */
  PDF_PAGE_IMAGES_PER_TURN: n(8, 'N-13', 'register: page images to model Fast 3 / Normal 8 / Deep 20 (Normal)'),
  /** A PDF within the token budget is sent whole, every page's image, up to this many pages. */
  PDF_WHOLE_MAX_PAGES: n(20, 'N-13', 'register: page images Deep 20, the most any profile sends'),
  CHUNK_TARGET_TOKENS: n(800, 'N-14', 'register: chunk ~800 tokens'),
  CHUNK_OVERLAP_PERCENT: n(15, 'N-14', 'register: overlap ~15 %'),

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

  // --- Outbound fetch: Stage 15 ER-4 -----------------------------------------------------------
  /** One user-URL fetch (safeFetch), redirects included. */
  FETCH_URL_TIMEOUT_MS: n(10_000, 'N-43', 'register: tools fetch_url 10 s'),

  // --- P08: durable runs, one turn per chat (ADR-0078) --------------------------------------
  /** A running turn's lease; another instance may take the turn over once it lapses. */
  TURN_LEASE_MS: n(30_000, 'N-73', 'register: turn lease 30 s'),
  /** How often the runner renews its lease. */
  TURN_HEARTBEAT_MS: n(10_000, 'N-73', 'register: heartbeat 10 s'),
  /** How often the runner reads `cancel_requested` (a Stop sent to another instance). */
  TURN_CANCEL_CHECK_MS: n(2_000, 'N-73', 'register: runner idle cancel check 2 s'),
  /** Named `ping` frame on every open stream. */
  SSE_PING_MS: n(15_000, 'N-24', 'register: SSE ping interval 15 s (mandatory, LV-111)'),
  /** A frame the socket has not taken within this long ends the connection. */
  SSE_SEND_TIMEOUT_MS: n(15_000, 'N-73', 'register: SSE send timeout = N-24 15 s'),
  /** An open stream re-checks its session and its chat this often. */
  SSE_SESSION_RECHECK_MS: n(60_000, 'N-73', 'register: open-stream session re-check 60 s'),
  /** A stream of a run held by another instance polls the stored row this often. */
  SSE_RELAY_POLL_MS: n(250, 'N-73', 'register: Postgres stream-store relay poll 250 ms'),
  /** SIGTERM: runs are stopped and settled inside this budget, under Cloud Run's 10 s. */
  SHUTDOWN_DRAIN_MS: n(5_000, 'N-73', 'register (N-76): SIGTERM budget = N-73 5 s'),
  /** The turn sweeper: expired leases, expired reservations, old idempotency keys. */
  TURN_SWEEP_INTERVAL_MS: n(60_000, 'N-76', 'register: sweep tick 60 s'),
  /** An Idempotency-Key is honoured, then forgotten, after this long. */
  IDEMPOTENCY_KEY_TTL_HOURS: n(24, 'N-34', 'register: idempotency keys 24 h'),
  /** Every API statement. */
  DB_STATEMENT_TIMEOUT_MS: n(5_000, 'N-45', 'register: statement timeout API 5 s'),
  /** Sweeps, exports and file jobs (`SET LOCAL`). */
  DB_LONG_STATEMENT_TIMEOUT_MS: n(30_000, 'N-45', 'register: statement timeout executor 30 s'),
  DB_LOCK_TIMEOUT_MS: n(2_000, 'N-45', 'register: lock_timeout 2 s'),
  DB_IDLE_IN_TRANSACTION_MS: n(30_000, 'N-45', 'register: idle_in_transaction 30 s'),
  /** A pooled connection is closed and reopened after this long. */
  DB_MAX_LIFETIME_S: n(1_800, 'N-45', 'register: pool_recycle 1,800 s'),
  /** A whole settle transaction is retried at most this often on a serialization failure or deadlock. */
  DB_TX_MAX_RETRIES: n(2, 'N-45', 'register: whole-tx retry ≤2'),

  // --- P11: error matrix, breaker, fallback (ADR-0081) ------------------------------------
  /** A model's breaker opens after this many counted failures inside the window. */
  BREAKER_FAILURES: n(5, 'N-47', 'register: open after 5 failures / 30 s'),
  BREAKER_WINDOW_MS: n(30_000, 'N-47', 'register: open after 5 failures / 30 s'),
  /** …or when this share of the last BREAKER_MIN_CALLS outcomes failed. */
  BREAKER_RATIO: n(0.5, 'N-47', 'register: or ≥50 % of 20 calls'),
  BREAKER_MIN_CALLS: n(20, 'N-47', 'register: or ≥50 % of 20 calls'),
  /** An open breaker admits one trial call after this long. */
  BREAKER_HALF_OPEN_MS: n(30_000, 'N-47', 'register: half-open 30 s'),
  /** At most this share of an instance's provider calls may be retries. */
  RETRY_BUDGET_RATIO: n(0.1, 'N-47', 'register: retry budget ≤10 %'),
  /** Tool timers (ER-4c); fetch_url is FETCH_URL_TIMEOUT_MS above, run_code is P18's. */
  TOOL_TIMEOUT_WEB_SEARCH_MS: n(20_000, 'N-43', 'register: tools web_search 20 s'),
  TOOL_TIMEOUT_FILE_SEARCH_MS: n(2_000, 'N-43', 'register: tools file_search 2 s'),
  TOOL_TIMEOUT_MEMORY_MS: n(2_000, 'N-43', 'register: tools memory 2 s'),
} as const satisfies Record<string, RegisteredNumber>;

export type NumberKey = keyof typeof NUMBERS;
