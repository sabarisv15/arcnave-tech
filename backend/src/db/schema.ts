/**
 * Database schema (Drizzle / PostgreSQL).
 *
 * Conventions:
 * - UUID primary keys, generated in the database.
 * - All timestamps are `timestamptz` and stored in UTC. ISO 8601 over the wire.
 * - `version` columns back optimistic concurrency on anything a user can overwrite.
 * - `deletedAt` soft-deletes chats and projects so a stray DELETE is recoverable; everything
 *   else cascades, because an orphaned message or chunk has no independent meaning.
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- identity */

export const users = pgTable(
  'users',
  {
    id: id(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 120 }).notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('uq_users_email').on(sql`lower(${t.email})`)],
);

/**
 * Server-side session. The cookie carries an opaque token; only its SHA-256 is stored, so
 * reading the table does not yield a usable credential.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: varchar('user_agent', { length: 300 }).notNull().default(''),
  },
  (t) => [
    uniqueIndex('uq_sessions_token').on(t.tokenHash),
    index('ix_sessions_user').on(t.userId),
    index('ix_sessions_expires').on(t.expiresAt),
  ],
);

export const preferences = pgTable(
  'preferences',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    theme: varchar('theme', { length: 16 }).notNull().default('system'),
    font: varchar('font', { length: 16 }).notNull().default('sans'),
    modelAlias: varchar('model_alias', { length: 64 }).notNull().default('Auto'),
    instructions: text('instructions').notNull().default(''),
    enterToSend: boolean('enter_to_send').notNull().default(true),
    reducedMotion: boolean('reduced_motion').notNull().default(false),
    defaultMode: varchar('default_mode', { length: 16 }).notNull().default('chat'),
    sourceScope: varchar('source_scope', { length: 32 }).notNull().default('All sources'),
    saveHistory: boolean('save_history').notNull().default(true),

    // Usage & limits
    maxOutputTokens: integer('max_output_tokens').notNull().default(32000),
    dailyTokenBudget: integer('daily_token_budget'),
    monthlyTokenBudget: integer('monthly_token_budget'),
    warnThresholdPct: integer('warn_threshold_pct').notNull().default(80),
    routingPreference: varchar('routing_preference', { length: 16 }).notNull().default('balanced'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),

    version: integer('version').notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('ck_warn_threshold', sql`${t.warnThresholdPct} between 1 and 100`),
    check('ck_max_output_positive', sql`${t.maxOutputTokens} > 0`),
    check(
      'ck_budgets_positive',
      sql`(${t.dailyTokenBudget} is null or ${t.dailyTokenBudget} > 0)
          and (${t.monthlyTokenBudget} is null or ${t.monthlyTokenBudget} > 0)`,
    ),
  ],
);

/* -------------------------------------------------------------------------- projects */

export const projects = pgTable(
  'projects',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    instructions: text('instructions').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
    position: integer('position').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('ix_projects_user_updated').on(t.userId, t.updatedAt),
    index('ix_projects_user_order').on(t.userId, t.pinned, t.position),
  ],
);

export const projectFiles = pgTable(
  'project_files',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Server-generated. Never derived from the client filename. */
    storageKey: varchar('storage_key', { length: 300 }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull().default(''),
    /** pending | indexing | ready | failed | unsupported */
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    error: text('error').notNull().default(''),
    chunkCount: integer('chunk_count').notNull().default(0),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_project_files_key').on(t.storageKey),
    index('ix_project_files_project').on(t.projectId),
  ],
);

/**
 * A retrievable slice of a project file.
 *
 * There is deliberately no `embedding` column: retrieval is lexical (BM25), and we do not
 * store a vector we cannot search or claim a capability we have not built.
 */
export const fileChunks = pgTable(
  'file_chunks',
  {
    id: id(),
    projectFileId: uuid('project_file_id')
      .notNull()
      .references(() => projectFiles.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    charCount: integer('char_count').notNull().default(0),
    /** 1-based source page, when the format has pages (PDF). Null, never 0 — no page is "page
     *  zero", and null distinguishes "not paginated" from "page number unknown". */
    page: integer('page'),
  },
  (t) => [
    uniqueIndex('uq_chunk_ordinal').on(t.projectFileId, t.ordinal),
    index('ix_chunks_project').on(t.projectId),
  ],
);

export const savedSources = pgTable(
  'saved_sources',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 500 }).notNull(),
    url: text('url').notNull(),
    domain: varchar('domain', { length: 255 }).notNull(),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('Web'),
    snippet: text('snippet').notNull().default(''),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index('ix_saved_sources_project').on(t.projectId)],
);

/* -------------------------------------------------------------------------- chats */

export const chats = pgTable(
  'chats',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 200 }).notNull(),
    pinned: boolean('pinned').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('ix_chats_user_updated').on(t.userId, t.updatedAt),
    index('ix_chats_project').on(t.projectId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Monotonic within a chat. Stable ordering without depending on timestamp ties. */
    seq: integer('seq').notNull(),
    role: varchar('role', { length: 16 }).notNull(),
    text: text('text').notNull().default(''),
    mode: varchar('mode', { length: 16 }).notNull().default('chat'),
    status: varchar('status', { length: 16 }).notNull().default('complete'),
    errorCode: varchar('error_code', { length: 48 }),
    researchStage: varchar('research_stage', { length: 24 }),
    questions: jsonb('questions').$type<string[]>().notNull().default([]),
    feedback: varchar('feedback', { length: 8 }),
    modelAlias: varchar('model_alias', { length: 64 }),
    provider: varchar('provider', { length: 32 }),
    providerModelId: varchar('provider_model_id', { length: 128 }),
    finishReason: varchar('finish_reason', { length: 48 }),
    /** Not a foreign key: deleting an artifact must not cascade into conversation history. */
    artifactId: uuid('artifact_id'),
    /** Google's terms require rendering this widget when Search grounding is used. */
    searchEntryPoint: text('search_entry_point'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_message_seq').on(t.chatId, t.seq),
    index('ix_messages_chat').on(t.chatId),
    check('ck_message_role', sql`${t.role} in ('user','assistant')`),
    check('ck_message_feedback', sql`${t.feedback} is null or ${t.feedback} in ('up','down')`),
  ],
);

/**
 * A citation. Every row came from a provider's grounding metadata.
 *
 * `urlResolved` is false when we could not turn a provider redirect into a canonical URL; in
 * that case `url` holds the redirect and the UI says so. We never fabricate a destination.
 */
export const messageSources = pgTable(
  'message_sources',
  {
    id: id(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    url: text('url').notNull(),
    urlResolved: boolean('url_resolved').notNull().default(false),
    domain: varchar('domain', { length: 255 }).notNull(),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('Web'),
    snippet: text('snippet').notNull().default(''),
    passage: text('passage').notNull().default(''),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_source_ordinal').on(t.messageId, t.ordinal)],
);

/** Progress record. Each row describes work the server actually performed. */
export const researchEvents = pgTable(
  'research_events',
  {
    id: id(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    stage: varchar('stage', { length: 24 }).notNull(),
    label: varchar('label', { length: 300 }).notNull(),
    detail: text('detail').notNull().default(''),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_event_ordinal').on(t.messageId, t.ordinal)],
);

/**
 * One row per tool call/result pair the model made while answering a message. `input` and
 * `content` are `jsonb` and `NOT NULL` — the insert always supplies `input ?? {}`, never `null`,
 * so the column constraint and the write path can never contradict each other. No separate
 * requested/running state: execution here is one synchronous `await`, with no externally
 * observable "running" window to record (same reasoning as `researchEvents`, which also
 * persists only after the fact). Revisit if a future tool is genuinely long-running/async.
 */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: id(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    /** The provider's own id for this call (Anthropic's `tool_use.id`, Gemini's `FunctionCall.id`
     *  when present, or a synthesised id when the provider did not supply one). */
    toolCallId: varchar('tool_call_id', { length: 128 }).notNull(),
    name: varchar('name', { length: 64 }).notNull(),
    input: jsonb('input').notNull(),
    /** The full bounded `ToolResult.content` the model actually received — not a further-
     *  truncated copy. See generation.ts's three-tier persist/preview split. */
    content: jsonb('content').notNull(),
    ok: boolean('ok').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('uq_tool_call_ordinal').on(t.messageId, t.ordinal)],
);

/** A file attached to a single message, as opposed to durable project knowledge. */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    /**
     * Set when this attachment reuses an existing project file's bytes rather than a fresh
     * upload. Its `storageKey` is then a copy of that file's key, not one of its own — the same
     * project file can be attached to more than one message, which is why the key is no longer
     * unique below.
     */
    projectFileId: uuid('project_file_id').references(() => projectFiles.id, {
      onDelete: 'set null',
    }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: varchar('storage_key', { length: 300 }).notNull(),
    /** uploading (bytes not yet confirmed) | ready | unsupported (stored, but no text). */
    status: varchar('status', { length: 16 }).notNull().default('ready'),
    error: text('error').notNull().default(''),
    extractedText: text('extracted_text'),
    /** Pages in a PDF, counted at upload; null for every other type and for unreadable PDFs. */
    pageCount: integer('page_count'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ix_attachments_key').on(t.storageKey),
    index('ix_attachments_message').on(t.messageId),
    index('ix_attachments_user').on(t.userId),
  ],
);

/**
 * A chat's sandbox workspace, checkpointed to storage so its files outlive the sandbox instance
 * (ADR-0015), as Claude's code-execution containers are restored for 30 days. The manifest names
 * every stored object of the checkpoint; this row is how restore and retention find it.
 */
export const sandboxWorkspaces = pgTable(
  'sandbox_workspaces',
  {
    workspaceId: varchar('workspace_id', { length: 32 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null until the first checkpoint. */
    savedAt: timestamp('saved_at', { withTimezone: true }),
    /** Storage key of the current checkpoint's manifest; null until the first checkpoint. */
    manifestKey: varchar('manifest_key', { length: 200 }),
    savedBytes: bigint('saved_bytes', { mode: 'number' }).notNull().default(0),
  },
  (t) => [index('ix_sandbox_workspaces_chat').on(t.chatId), index('ix_sandbox_workspaces_last_run').on(t.lastRunAt)],
);

/* -------------------------------------------------------------------------- artifacts */

export const artifacts = pgTable(
  'artifacts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 200 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('document'),
    currentVersion: integer('current_version').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ix_artifacts_user').on(t.userId),
    index('ix_artifacts_project').on(t.projectId),
    check('ck_artifact_kind', sql`${t.kind} in ('document','code','webpage')`),
  ],
);

export const artifactVersions = pgTable(
  'artifact_versions',
  {
    id: id(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Empty for a binary version — the bytes live in storage, not here. */
    content: text('content').notNull(),
    /**
     * `markdown` reads `content`, above. Any other value is a deterministic export of an
     * earlier markdown version's own content (see ADR-0004, item 8) and reads `storageKey`
     * instead — independent of `artifacts.kind`, which describes the editor surface, not any
     * one version's format.
     */
    format: varchar('format', { length: 16 }).notNull().default('markdown'),
    storageKey: varchar('storage_key', { length: 300 }),
    mimeType: varchar('mime_type', { length: 160 }),
    sizeBytes: integer('size_bytes'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_artifact_version').on(t.artifactId, t.version),
    check(
      'ck_artifact_version_format',
      sql`${t.format} in ('markdown','xlsx','docx','pptx')`,
    ),
  ],
);

/* -------------------------------------------------------------------------- usage */

/**
 * One row per generation attempt, including failures and cancellations.
 *
 * `tokensExact` records whether counts came from provider metadata. We never write an
 * estimate into these columns and call it exact; absent metadata means zeros plus a false
 * flag, which the API surfaces rather than hides.
 */
export const usageRecords = pgTable(
  'usage_records',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestId: varchar('request_id', { length: 64 }).notNull(),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),

    modelAlias: varchar('model_alias', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerModelId: varchar('provider_model_id', { length: 128 }).notNull(),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    tokensExact: boolean('tokens_exact').notNull().default(false),
    /**
     * The turn's last provider request, prompt plus answer: what the next turn resends. The
     * totals above sum every request of a tool loop; compaction reads this. Null when not exact.
     */
    contextTokens: integer('context_tokens'),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    latencyMs: integer('latency_ms'),
    finishReason: varchar('finish_reason', { length: 48 }),
    /** complete | cancelled | error | blocked */
    status: varchar('status', { length: 16 }).notNull().default('complete'),
    errorCode: varchar('error_code', { length: 48 }),

    /** Null unless a verified pricing entry exists. Null != 0. */
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => [
    index('ix_usage_user_started').on(t.userId, t.startedAt),
    index('ix_usage_user_model').on(t.userId, t.modelAlias),
    index('ix_usage_request').on(t.requestId),
  ],
);

/**
 * Pre-aggregated spend per budget window.
 *
 * Budget enforcement reserves against this row inside a transaction with `FOR UPDATE`, which
 * is what stops two concurrent requests from each seeing headroom only one of them has.
 */
export const usageCounters = pgTable(
  'usage_counters',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    periodKind: varchar('period_kind', { length: 8 }).notNull(), // day | month
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    tokensUsed: integer('tokens_used').notNull().default(0),
    tokensReserved: integer('tokens_reserved').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('uq_usage_period').on(t.userId, t.periodKind, t.periodStart)],
);

/** Replay protection for creates and retried writes. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 200 }).notNull(),
    endpoint: varchar('endpoint', { length: 120 }).notNull(),
    requestFingerprint: varchar('request_fingerprint', { length: 64 }).notNull(),
    responseJson: jsonb('response_json').$type<unknown>().notNull(),
    statusCode: integer('status_code').notNull().default(200),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('uq_idempotency').on(t.userId, t.key, t.endpoint)],
);

/**
 * A global concurrency semaphore for `run_python`, claimed for the duration of one Cloud Run
 * sandbox execution and released when it finishes. Not user-scoped: the resource being protected
 * is the project's shared Cloud Run quota (`RunningExecutionsPerProject`,
 * `JobRunPerMinutePerProjectRegion`), which every user draws from together. A row per claim
 * (rather than a single counter column) means a claim a crashed backend instance never released
 * self-heals via `expiresAt` instead of leaking capacity forever — see
 * `tools/sandbox/semaphore.ts`.
 */
export const sandboxClaims = pgTable('sandbox_claims', {
  id: id(),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/**
 * Item 10: Multi-step Autonomous Agent Goals.
 * Persists an active goal bound to a chat with multi-turn token budget, live spent tokens,
 * failure counters, and status. Enforces at most one active goal per chat via a partial unique index.
 */
export const goals = pgTable(
  'goals',
  {
    id: id(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    originMessageId: uuid('origin_message_id').references(() => messages.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'), // 'active' | 'complete' | 'blocked' | 'abandoned'
    tokenBudget: integer('token_budget'),
    spentTokens: integer('spent_tokens').notNull().default(0),
    blockedReason: text('blocked_reason'),
    lastFailureFingerprint: text('last_failure_fingerprint'),
    consecutiveFailureCount: integer('consecutive_failure_count').notNull().default(0),
    lastFailedTool: text('last_failed_tool'),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('ix_goals_chat').on(t.chatId),
    uniqueIndex('uq_active_goal_per_chat').on(t.chatId).where(sql`${t.status} = 'active'`),
  ],
);

/**
 * Audit events and checkpoints for a goal.
 * Records checkpoints, status changes, tool outcomes, and recovery attempts across multi-turn runs.
 */
export const goalEvents = pgTable(
  'goal_events',
  {
    id: id(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    runId: varchar('run_id', { length: 64 }),
    type: varchar('type', { length: 32 }).notNull(), // 'checkpoint' | 'tool_success' | 'tool_failure' | 'recovery_attempt' | 'status_change' | 'budget_update'
    toolName: text('tool_name'),
    failureFingerprint: text('failure_fingerprint'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('ix_goal_events_goal').on(t.goalId),
    index('ix_goal_events_created').on(t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- persistent memory & compaction */

/**
 * Phase 5.2: Persistent Memory.
 * Stores durable cross-session facts, preferences, profile details, and project decisions.
 * Supports optimistic concurrency via `version`, scope isolation (global vs project),
 * standing context classification (`isStanding`), and PostgreSQL GIN Full-Text Search.
 */
export const memoryItems = pgTable(
  'memory_items',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 16 }).notNull().default('global'), // 'global' | 'project'
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 24 }).notNull().default('preference'), // 'profile' | 'preference' | 'feedback' | 'project'
    key: varchar('key', { length: 200 }).notNull(),
    content: text('content').notNull(),
    summary: text('summary').notNull().default(''),
    isStanding: boolean('is_standing').notNull().default(false),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('user_statement'), // 'user_statement' | 'explicit_memory_command' | 'project_decision'
    sourceChatId: uuid('source_chat_id').references(() => chats.id, { onDelete: 'set null' }),
    sourceMessageId: uuid('source_message_id').references(() => messages.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ix_memory_user_scope').on(t.userId, t.scope, t.projectId),
    index('ix_memory_user_standing').on(t.userId, t.isStanding),
    uniqueIndex('uq_memory_user_scope_key').on(
      t.userId,
      t.scope,
      sql`coalesce(${t.projectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.key,
    ),
    // Real PostgreSQL GIN Full-Text Search index
    index('ix_memory_fts').using(
      'gin',
      sql`to_tsvector('simple', coalesce(${t.key}, '') || ' ' || coalesce(${t.summary}, '') || ' ' || coalesce(${t.content}, ''))`,
    ),
  ],
);

/**
 * Phase 5.3: Conversation Compactions.
 * Records structured, 11-point context summaries of earlier conversation turns when context pressure triggers.
 * Preserves narrative continuity across compactions without deleting the underlying raw messages in Postgres.
 */
export const conversationCompactions = pgTable(
  'conversation_compactions',
  {
    id: id(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    throughMessageId: uuid('through_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    throughSeq: integer('through_seq').notNull(),
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
    tokenCountBefore: integer('token_count_before'),
    tokenCountAfter: integer('token_count_after'),
    provider: varchar('provider', { length: 32 }),
    model: varchar('model', { length: 128 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_compactions_chat_seq').on(t.chatId, t.throughSeq),
    index('ix_compactions_chat').on(t.chatId),
  ],
);

/* -------------------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ one, many }) => ({
  preferences: one(preferences, { fields: [users.id], references: [preferences.userId] }),
  chats: many(chats),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
  files: many(projectFiles),
  savedSources: many(savedSources),
  chats: many(chats),
}));

export const projectFilesRelations = relations(projectFiles, ({ one, many }) => ({
  project: one(projects, { fields: [projectFiles.projectId], references: [projects.id] }),
  chunks: many(fileChunks),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  project: one(projects, { fields: [chats.projectId], references: [projects.id] }),
  messages: many(messages),
  goals: many(goals),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  chat: one(chats, { fields: [messages.chatId], references: [chats.id] }),
  sources: many(messageSources),
  events: many(researchEvents),
  toolCalls: many(toolCalls),
  attachments: many(attachments),
}));

export const messageSourcesRelations = relations(messageSources, ({ one }) => ({
  message: one(messages, { fields: [messageSources.messageId], references: [messages.id] }),
}));

export const researchEventsRelations = relations(researchEvents, ({ one }) => ({
  message: one(messages, { fields: [researchEvents.messageId], references: [messages.id] }),
}));

export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
  message: one(messages, { fields: [toolCalls.messageId], references: [messages.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  message: one(messages, { fields: [attachments.messageId], references: [messages.id] }),
}));

export const artifactsRelations = relations(artifacts, ({ many }) => ({
  versions: many(artifactVersions),
}));

export const artifactVersionsRelations = relations(artifactVersions, ({ one }) => ({
  artifact: one(artifacts, { fields: [artifactVersions.artifactId], references: [artifacts.id] }),
}));

export const goalsRelations = relations(goals, ({ one, many }) => ({
  chat: one(chats, { fields: [goals.chatId], references: [chats.id] }),
  originMessage: one(messages, { fields: [goals.originMessageId], references: [messages.id] }),
  events: many(goalEvents),
}));

export const goalEventsRelations = relations(goalEvents, ({ one }) => ({
  goal: one(goals, { fields: [goalEvents.goalId], references: [goals.id] }),
}));

export const memoryItemsRelations = relations(memoryItems, ({ one }) => ({
  user: one(users, { fields: [memoryItems.userId], references: [users.id] }),
  project: one(projects, { fields: [memoryItems.projectId], references: [projects.id] }),
  sourceChat: one(chats, { fields: [memoryItems.sourceChatId], references: [chats.id] }),
  sourceMessage: one(messages, { fields: [memoryItems.sourceMessageId], references: [messages.id] }),
}));

export const conversationCompactionsRelations = relations(conversationCompactions, ({ one }) => ({
  chat: one(chats, { fields: [conversationCompactions.chatId], references: [chats.id] }),
  throughMessage: one(messages, { fields: [conversationCompactions.throughMessageId], references: [messages.id] }),
}));

/* -------------------------------------------------------------------------- inferred types */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Preferences = typeof preferences.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type FileChunk = typeof fileChunks.$inferSelect;
export type SavedSource = typeof savedSources.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageSource = typeof messageSources.$inferSelect;
export type ResearchEvent = typeof researchEvents.$inferSelect;
export type ToolCallRow = typeof toolCalls.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type ArtifactVersion = typeof artifactVersions.$inferSelect;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type GoalEvent = typeof goalEvents.$inferSelect;
export type NewGoalEvent = typeof goalEvents.$inferInsert;
export type MemoryItem = typeof memoryItems.$inferSelect;
export type NewMemoryItem = typeof memoryItems.$inferInsert;
export type ConversationCompaction = typeof conversationCompactions.$inferSelect;
export type NewConversationCompaction = typeof conversationCompactions.$inferInsert;
export type SandboxWorkspace = typeof sandboxWorkspaces.$inferSelect;

