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
  numeric,
  primaryKey,
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
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();

/** A note about a readable file (fileErrors.ts). */
export interface FileWarning {
  code: string;
  detail: string;
}
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
    /** Null for an account made with Google sign-in (ADR-0056); password sign-in then fails. */
    passwordHash: text('password_hash'),
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
    // ADR-0052: the model cannot turn memory or past-chat search off itself; these are the
    // settings it names when asked, and generation declares neither tool set while one is off.
    memoryEnabled: boolean('memory_enabled').notNull().default(true),
    chatSearchEnabled: boolean('chat_search_enabled').notNull().default(true),
    styleId: varchar('style_id', { length: 64 }).notNull().default('normal'),

    // Usage & limits
    maxOutputTokens: integer('max_output_tokens').notNull().default(64000),
    dailyTokenBudget: integer('daily_token_budget'),
    monthlyTokenBudget: integer('monthly_token_budget'),
    warnThresholdPct: integer('warn_threshold_pct').notNull().default(80),
    routingPreference: varchar('routing_preference', { length: 16 }).notNull().default('balanced'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('UTC'),

    version: integer('version').notNull().default(1),
    effort: varchar('effort', { length: 16 }),
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
    check(
      'ck_effort',
      sql`${t.effort} is null or ${t.effort} in ('low', 'medium', 'high', 'xhigh', 'max')`,
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
    /** Stage 15 ER-9 code for `failed` / `unsupported` (fileErrors.ts); '' when none. */
    errorCode: varchar('error_code', { length: 32 }).notNull().default(''),
    /** Things the user should know about a `ready` file, e.g. `chunk_cap` (fileErrors.ts). */
    warnings: jsonb('warnings').$type<FileWarning[]>().notNull().default([]),
    chunkCount: integer('chunk_count').notNull().default(0),
    /**
     * Which indexer wrote this file's chunks. A file below `INDEX_VERSION` (retrieval.ts) is
     * re-indexed by a `reindex` file job, so the Unicode tokenizer and the chunk cap reach
     * files indexed before them.
     */
    indexVersion: integer('index_version').notNull().default(1),
    /** The storage object's generation when it was stored or replaced (D1 #35). */
    objectGeneration: varchar('object_generation', { length: 64 }).notNull().default(''),
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
    /**
     * Versions (ADR-0038). Editing a prompt copies the conversation before it into a new chat;
     * that chat is another version of the same conversation, not a new one. `rootChatId` names
     * the family (null on the chat that started it) and is not a foreign key, so purging one
     * member never splits the family. `forkSeq` is the seq of the edited prompt: from there on
     * this chat's messages are its own, before it they are copies of `parentChatId`'s.
     */
    parentChatId: uuid('parent_chat_id').references((): AnyPgColumn => chats.id, { onDelete: 'set null' }),
    rootChatId: uuid('root_chat_id'),
    forkSeq: integer('fork_seq'),
    /** P22 (ADR-0079): on the family's root, the version the user chose last; the list shows it. Not a foreign key (a purge never splits the family). */
    activeChatId: uuid('active_chat_id'),
    /** P13 (ADR-0080): who named the chat: default | prompt | generated | user. A user rename wins. */
    titleSource: varchar('title_source', { length: 16 }).notNull().default('default'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('ck_chats_title_source', sql`${t.titleSource} in ('default', 'prompt', 'generated', 'user')`),
    index('ix_chats_user_updated').on(t.userId, t.updatedAt),
    index('ix_chats_project').on(t.projectId),
    index('ix_chats_root').on(t.rootChatId),
  ],
);

/** One stretch of an answer: thinking, text, or a run of consecutive tool calls. */
export type MessageSegment =
  | { type: 'ui'; blockIds: string[] }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tools'; toolCallIds: string[] };

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
    effort: varchar('effort', { length: 16 }),
    provider: varchar('provider', { length: 32 }),
    providerModelId: varchar('provider_model_id', { length: 128 }),
    finishReason: varchar('finish_reason', { length: 48 }),
    /** Not a foreign key: deleting an artifact must not cascade into conversation history. */
    artifactId: uuid('artifact_id'),
    /** Google's terms require rendering this widget when Search grounding is used. */
    searchEntryPoint: text('search_entry_point'),
    /** The model's thought summary for this answer, shown collapsed.
     *  Null when the model gave none. Never sent back to a model. */
    thinking: text('thinking'),
    /** The answer's thinking, text and tool steps in the order they happened. Null for answers
     *  stored before it existed; the client then shows them grouped. */
    segments: jsonb('segments').$type<MessageSegment[]>(),
    // P13 turn stamps (Stage 6 STAMPS, ADR-0080), on the assistant row; ids and counts only.
    historyTurns: integer('history_turns'),
    historyDroppedTurns: integer('history_dropped_turns'),
    ctxTokens: integer('ctx_tokens'),
    /** Ours: the fixed part (system instruction + tool declarations) of `ctx_tokens`, read by the summary trigger. */
    ctxFixedTokens: integer('ctx_fixed_tokens'),
    /** provider | none */
    ctxCountSource: varchar('ctx_count_source', { length: 16 }),
    overBudget: boolean('over_budget'),
    summaryVersion: integer('summary_version'),
    promptVersion: varchar('prompt_version', { length: 64 }),
    /** Null until the registry is versioned (P10). */
    registryVersion: varchar('registry_version', { length: 32 }),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_message_seq').on(t.chatId, t.seq),
    index('ix_messages_chat').on(t.chatId),
    // P08: the sweeper finds rows still `generating` past the turn deadline without a table scan.
    index('ix_messages_generating').on(t.createdAt).where(sql`${t.status} = 'generating'`),
    check('ck_message_role', sql`${t.role} in ('user','assistant')`),
    check('ck_message_feedback', sql`${t.feedback} is null or ${t.feedback} in ('up','down')`),
    check(
      'ck_message_effort',
      sql`${t.effort} is null or ${t.effort} in ('low', 'medium', 'high', 'xhigh', 'max')`,
    ),
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
    /** Gemini's opaque signature on the call's part. A later turn replays the call with it, as
     *  the in-turn loop does; without it the call is replayed as text (ADR-0022). */
    thoughtSignature: text('thought_signature'),
    /** Written only by the context editing ADR-0023 removed, and no longer read: every result is
     *  replayed in full. Left in place so a revision still serving during a rollout can query it. */
    resultCleared: boolean('result_cleared').notNull().default(false),
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
    /**
     * uploading (bytes not yet confirmed) | queued | scanning | extracting | ocr | transcribing |
     * indexing (the file job's stage, Stage 9 PIPE) | ready | failed. Rows written before
     * ADR-0062 can also be `unsupported`. Only `ready` may be sent (409 `file_not_ready`).
     */
    status: varchar('status', { length: 16 }).notNull().default('ready'),
    /** What the user is told about the file: the failure, or a `ready` file's notes. */
    error: text('error').notNull().default(''),
    /** Stage 15 ER-9 code for a `failed` file (fileErrors.ts); '' otherwise. */
    errorCode: varchar('error_code', { length: 32 }).notNull().default(''),
    /** Notes about a `ready` file, each with a code (fileErrors.ts); shown on the chip. */
    warnings: jsonb('warnings').$type<FileWarning[]>().notNull().default([]),
    extractedText: text('extracted_text'),
    /** Pages in a PDF, counted at upload; null for every other type and for unreadable PDFs. */
    pageCount: integer('page_count'),
    /**
     * A member of an uploaded ZIP points at the ZIP's own row (Stage 9 ZIP, P14). `set null`, not
     * cascade: a member sent in a message must outlive its unsent ZIP being cleaned up.
     */
    parentAttachmentId: uuid('parent_attachment_id').references((): AnyPgColumn => attachments.id, {
      onDelete: 'set null',
    }),
    /** SHA-256 of the stored bytes, taken at `complete` (D1 #35); '' before ADR-0063. */
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull().default(''),
    /** The storage object's generation at `complete` (GCS generation; mtime locally), so a job
     *  reads exactly the bytes that were checked (D1 #35). */
    objectGeneration: varchar('object_generation', { length: 64 }).notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('ix_attachments_key').on(t.storageKey),
    index('ix_attachments_message').on(t.messageId),
    index('ix_attachments_user').on(t.userId),
    index('ix_attachments_parent').on(t.parentAttachmentId),
  ],
);

/**
 * One unit of file work: reading an uploaded attachment, or re-indexing a project file
 * (ADR-0062). Workers claim a row with `FOR UPDATE SKIP LOCKED` and hold it by a lease, so a
 * worker that dies mid-job leaves a row another worker takes over once the lease lapses.
 * Idempotent per (file, kind, version): a retry is a new version, never a second copy.
 * No `company_id`: single user until Phase 5 (owner default, OQ-25).
 */
export const fileJobs = pgTable(
  'file_jobs',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').references(() => attachments.id, { onDelete: 'cascade' }),
    projectFileId: uuid('project_file_id').references(() => projectFiles.id, { onDelete: 'cascade' }),
    /** attachment | project | reindex */
    kind: varchar('kind', { length: 16 }).notNull(),
    version: integer('version').notNull().default(1),
    /** fast | normal | large: small files never wait behind large ones; `large` is a ZIP waiting for the large slot (ADR-0070). */
    lane: varchar('lane', { length: 8 }).notNull().default('normal'),
    /** queued | running | done | failed */
    state: varchar('state', { length: 16 }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    leaseOwner: varchar('lease_owner', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 32 }).notNull().default(''),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_file_jobs_attachment').on(t.attachmentId, t.kind, t.version),
    uniqueIndex('uq_file_jobs_project_file').on(t.projectFileId, t.kind, t.version),
    index('ix_file_jobs_claim').on(t.state, t.lane, t.createdAt),
    check('ck_file_jobs_target', sql`${t.attachmentId} is not null or ${t.projectFileId} is not null`),
  ],
);

/** A token count from a provider's count API, per model family (Stage 9 TOKENS, ADR-0063). */
export interface TokenCount {
  /** Null when no count could be had: the file then goes through retrieval, never whole. */
  tokens: number | null;
  /** True only for a number the provider's count API returned (Invariant 3). */
  exact: boolean;
  /** The model the count API was asked about. */
  model: string;
  /** Why `tokens` is null: `too_large`, `unavailable`, `no_text`. */
  reason?: string;
}

/** Where one unit of a file sits, so an excerpt or a citation can name it (Stage 9 NORM). */
export interface Locator {
  /** page | slide | sheet | section | segment | form | comments */
  kind: string;
  /** 1-based position among its kind. */
  index: number;
  /** What a person would call it: "p. 3", "Slide 2", "Sheet Budget!A1:F40", "01:30–03:00". */
  label: string;
}

/**
 * What the pipeline made of one file (Stage 9 NORM / TOKENS, P12): normalised Markdown in object
 * storage (TC1), a JSON sidecar of locators and facts, the file's warnings, the extractor's
 * version, token counts per model family, and a normalised copy for images. One current row per
 * file; a re-read replaces it inside the job's fenced transaction.
 */
export const fileDerivatives = pgTable(
  'file_derivatives',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').references(() => attachments.id, { onDelete: 'cascade' }),
    projectFileId: uuid('project_file_id').references(() => projectFiles.id, { onDelete: 'cascade' }),
    /** The job version that wrote it. */
    version: integer('version').notNull().default(1),
    /** pdf | xlsx | pptx | docx | csv | text | image | audio | document | zip */
    kind: varchar('kind', { length: 16 }).notNull(),
    extractorVersion: varchar('extractor_version', { length: 32 }).notNull(),
    /** The normalised Markdown, stored under its own key (generateStorageKey); null when empty. */
    markdownKey: varchar('markdown_key', { length: 300 }),
    markdownChars: integer('markdown_chars').notNull().default(0),
    sidecar: jsonb('sidecar').$type<Record<string, unknown>>().notNull().default({}),
    warnings: jsonb('warnings').$type<FileWarning[]>().notNull().default([]),
    /** { gemini: TokenCount, claude: TokenCount } */
    tokenCounts: jsonb('token_counts').$type<Record<string, TokenCount>>().notNull().default({}),
    /** Images: the EXIF-stripped, rotated, resized copy every model is sent (Stage 9 IMAGES). */
    normalizedKey: varchar('normalized_key', { length: 300 }),
    normalizedMimeType: varchar('normalized_mime_type', { length: 160 }),
    /** The bytes it was made from; a later upload with the same checksum reuses it (G3). */
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_file_derivatives_attachment').on(t.attachmentId),
    uniqueIndex('uq_file_derivatives_project_file').on(t.projectFileId),
    index('ix_file_derivatives_checksum').on(t.userId, t.checksumSha256),
    check('ck_file_derivatives_target', sql`${t.attachmentId} is not null or ${t.projectFileId} is not null`),
  ],
);

/** One page, slide, sheet, section or audio segment of a derivative, with how it was read. */
export const fileDerivativePages = pgTable(
  'file_derivative_pages',
  {
    derivativeId: uuid('derivative_id')
      .notNull()
      .references(() => fileDerivatives.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    label: varchar('label', { length: 120 }).notNull().default(''),
    text: text('text').notNull().default(''),
    /** text | ocr | transcript | parsed | failed */
    source: varchar('source', { length: 16 }).notNull(),
    /** Stage 9 OCR-M11: each OCR'd page records the engine and its version. */
    ocrEngine: varchar('ocr_engine', { length: 32 }),
    ocrVersion: varchar('ocr_version', { length: 64 }),
    tStartMs: integer('t_start_ms'),
    tEndMs: integer('t_end_ms'),
  },
  (t) => [uniqueIndex('uq_file_derivative_pages').on(t.derivativeId, t.ordinal)],
);

/**
 * Retrieval units of a derivative (Stage 9 CHUNK, N-14), for a chat file too large to send
 * whole. Project files keep `file_chunks`, which project search reads.
 */
export const derivativeChunks = pgTable(
  'derivative_chunks',
  {
    id: id(),
    derivativeId: uuid('derivative_id')
      .notNull()
      .references(() => fileDerivatives.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    page: integer('page'),
    locator: varchar('locator', { length: 120 }).notNull().default(''),
  },
  (t) => [uniqueIndex('uq_derivative_chunks').on(t.derivativeId, t.ordinal)],
);

/**
 * Uploads started per user per day (N-11, Stage 1 FT-15). One row per user and UTC day,
 * incremented with an upsert, so two uploads at once cannot both read the old count.
 */
export const uploadQuota = pgTable(
  'upload_quota',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: varchar('day', { length: 10 }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [uniqueIndex('uq_upload_quota_user_day').on(t.userId, t.day)],
);

/**
 * A chat's sandbox workspace, checkpointed to storage so its files outlive the sandbox instance
 * (ADR-0015), restorable for 30 days. The manifest names
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

/**
 * A public link to a snapshot of a chat or an artifact (ADR-0039). The token is the only thing
 * that opens it: 32 random bytes, never derived from an id. `snapshotSeq` is the last message
 * seq shown for a chat, or the artifact version shown; later work stays private until the owner
 * updates the link. A revoked link is kept, so the owner's list can say when it was turned off.
 */
export const shareLinks = pgTable(
  'share_links',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: varchar('token', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 16 }).notNull(),
    /** Not a foreign key: the target's own delete revokes the link (see the routes). */
    targetId: uuid('target_id').notNull(),
    snapshotSeq: integer('snapshot_seq').notNull(),
    /** When the snapshot was last taken; artifacts in a shared chat are shown as of this. */
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_share_token').on(t.token),
    index('ix_share_links_user').on(t.userId),
    index('ix_share_links_target').on(t.targetType, t.targetId),
    check('ck_share_target_type', sql`${t.targetType} in ('chat','artifact')`),
  ],
);

/**
 * A data export the owner asked for (ADR-0040). The zip is stored under the owner's keys, so
 * account deletion removes it with everything else; retention removes it once it expires.
 */
export const accountExports = pgTable(
  'account_exports',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storageKey: varchar('storage_key', { length: 300 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('ix_account_exports_user').on(t.userId), index('ix_account_exports_expires').on(t.expiresAt)],
);

/**
 * What each reply did, as Markdown: the model, what the request carried (page images included),
 * the tools declared and every call with its input and result (ADR-0050). One per reply.
 */
export const turnLogs = pgTable('turn_logs', {
  messageId: uuid('message_id')
    .primaryKey()
    .references(() => messages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  markdown: text('markdown').notNull(),
  createdAt: createdAt(),
});

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
    check('ck_artifact_kind', sql`${t.kind} in ('document','code','webpage','svg','slides')`),
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
    /**
     * `costUsd` x the planning rate PRICING_INR_PER_USD (N-37) at the time of the call. Null
     * exactly when `costUsd` is null, and for rows written before this column existed (their
     * rate is unknown; they are not back-filled with today's). Null != 0.
     */
    costInr: doublePrecision('cost_inr'),
    /** P22: the price-book rate set the cost was taken from (`model_calls` has one per call). */
    priceVersion: varchar('price_version', { length: 64 }),
    /** P22 OD-8 clocks, null when not measured (never 0 for "unknown"): request sent → first stream event. */
    providerTtftMs: integer('provider_ttft_ms'),
    /** P22 OD-8: turn start → first answer text sent to the client. */
    firstVisibleMs: integer('first_visible_ms'),
    /** P22 OD-8: turn start → settle. */
    turnTotalMs: integer('turn_total_ms'),
    /** P22 OD-8: output tokens per second of generation; null unless the counts are exact. */
    outputTps: doublePrecision('output_tps'),
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

/* -------------------------------------------------------------------------- styles */

export const styles = pgTable(
  'styles',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 60 }).notNull(),
    instructions: text('instructions').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ix_styles_user').on(t.userId),
    check('ck_style_instructions_len', sql`length(${t.instructions}) <= 4000`),
  ],
);

/* -------------------------------------------------------------------------- relations */

export const usersRelations = relations(users, ({ one, many }) => ({
  preferences: one(preferences, { fields: [users.id], references: [preferences.userId] }),
  chats: many(chats),
  projects: many(projects),
  styles: many(styles),
}));

export const stylesRelations = relations(styles, ({ one }) => ({
  user: one(users, { fields: [styles.userId], references: [users.id] }),
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
export type Style = typeof styles.$inferSelect;
export type NewStyle = typeof styles.$inferInsert;


// --- P08: durable runs, one turn per chat (ADR-0078) ---------------------------------------

/**
 * What a turn was started with: ids and enums only, never the prompt or any other text
 * (Stage 17 NO_CONTENT). The prompt is the user message's own row. Enough to run the turn again
 * from its id (`loadTurnInput`), the seam for an executor that is not the request's process.
 */
export interface TurnParams {
  mode: 'chat' | 'search' | 'research';
  modelAlias: string;
  attachmentIds: string[];
  codeExecution: boolean;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** A preset key or a custom style's id. */
  styleId?: string;
  clientPlatform?: 'mobile' | 'desktop';
  projectId: string | null;
  /** The model that answered, written when the turn's `start` is sent; the sweeper bills it. */
  resolved?: { alias: string; provider: string; providerModelId: string };
}

/**
 * One turn of a chat: a user message and the assistant row that answers it (or a regenerated
 * answer). At most one turn per chat is queued or running (`uq_turns_running_chat`). The runner
 * holds a lease it renews; every write it makes is fenced on `fencing_token`, which a takeover
 * (the sweeper) increments, so a runner that lost its lease cannot write after the takeover.
 */
export const turns = pgTable(
  'turns',
  {
    id: id(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userMessageId: uuid('user_message_id').references(() => messages.id, { onDelete: 'set null' }),
    assistantMessageId: uuid('assistant_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** send | regenerate */
    kind: varchar('kind', { length: 16 }).notNull(),
    /** queued | running | done | cancelled | failed | interrupted */
    state: varchar('state', { length: 16 }).notNull().default('queued'),
    /** How the turn ended, as a stable code (`stop`, `cancelled`, an error code, `interrupted`). */
    finishCode: varchar('finish_code', { length: 48 }),
    requestId: varchar('request_id', { length: 64 }).notNull(),
    params: jsonb('params').$type<TurnParams>().notNull(),
    fencingToken: integer('fencing_token').notNull().default(1),
    leaseOwner: varchar('lease_owner', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    deadline: timestamp('deadline', { withTimezone: true }).notNull(),
    /** The stream event index the stored message row covers (the `snapshot` frame's id). */
    lastSeq: integer('last_seq').notNull().default(-1),
    createdAt: createdAt(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_turns_running_chat').on(t.chatId).where(sql`${t.state} in ('queued', 'running')`),
    index('ix_turns_lease').on(t.leaseExpiresAt).where(sql`${t.state} in ('queued', 'running')`),
    index('ix_turns_chat_created').on(t.chatId, t.createdAt),
    index('ix_turns_assistant').on(t.assistantMessageId),
    check('ck_turns_kind', sql`${t.kind} in ('send', 'regenerate')`),
    check('ck_turns_state', sql`${t.state} in ('queued', 'running', 'done', 'cancelled', 'failed', 'interrupted')`),
  ],
);

/**
 * A budget reservation with an owner and an expiry (A-05, A-06): the worst-case output held
 * against the user's day and month counters while a call runs. The periods are stored, so the
 * hold is given back to the counters it was taken from even when a turn crosses midnight. A hold
 * nobody settles (a crashed instance) expires, and the sweeper gives it back.
 */
export const budgetReservations = pgTable(
  'budget_reservations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    turnId: uuid('turn_id').references(() => turns.id, { onDelete: 'set null' }),
    /** turn | utility (a call outside a turn, e.g. a style generated from samples) */
    owner: varchar('owner', { length: 16 }).notNull(),
    tokens: integer('tokens').notNull(),
    /** The counter periods held against; null where that period had no limit. */
    dayStart: timestamp('day_start', { withTimezone: true }),
    monthStart: timestamp('month_start', { withTimezone: true }),
    /** held | settled | released | expired */
    status: varchar('status', { length: 16 }).notNull().default('held'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** P22: the usage row this hold was settled against (status `settled`). */
    settledUsageRecordId: uuid('settled_usage_record_id').references(() => usageRecords.id, { onDelete: 'set null' }),
    /** P22: the price-book rate set of that usage row. */
    priceVersion: varchar('price_version', { length: 64 }),
  },
  (t) => [
    index('ix_reservations_held').on(t.expiresAt).where(sql`${t.status} = 'held'`),
    index('ix_reservations_turn').on(t.turnId),
    check('ck_reservations_owner', sql`${t.owner} in ('turn', 'utility')`),
    check('ck_reservations_status', sql`${t.status} in ('held', 'settled', 'released', 'expired')`),
  ],
);

export type TurnRow = typeof turns.$inferSelect;
export type BudgetReservation = typeof budgetReservations.$inferSelect;

// --- P22: data model and the ledger (ADR-0079) ---------------------------------------------

/**
 * The price book in the database (Stage 5 TF, Stage 18 CD-1): the rows of `config/priceBook.ts`,
 * upserted at boot. Effective-dated; no two rows of one model, token type and tier overlap in
 * time (`price_table_no_overlap` trigger, migration 0031). Money as `numeric`, not a double.
 */
export const priceTable = pgTable(
  'price_table',
  {
    id: id(),
    providerModelId: varchar('provider_model_id', { length: 128 }).notNull(),
    /** input | output | cache_read | cache_write_5m */
    tokenType: varchar('token_type', { length: 16 }).notNull(),
    trafficTier: varchar('traffic_tier', { length: 16 }).notNull().default('standard'),
    usdPerMtok: numeric('usd_per_mtok', { precision: 12, scale: 6 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    priceVersion: varchar('price_version', { length: 64 }).notNull(),
    source: text('source').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_price_row').on(t.providerModelId, t.tokenType, t.trafficTier, t.effectiveFrom),
    check('ck_price_token_type', sql`${t.tokenType} in ('input', 'output', 'cache_read', 'cache_write_5m')`),
    check('ck_price_dates', sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`),
    check('ck_price_nonnegative', sql`${t.usdPerMtok} >= 0`),
  ],
);

/**
 * One row per model call (Stage 4 E19, Stage 17 OD-13, Stage 5 TF): the ledger. A turn's
 * `usage_records` row is the sum of its calls. Partitioned by month on `started_at` (with a
 * DEFAULT partition) in the hand-edited migration 0031; `ensureLedgerPartitions` creates this
 * and next month's. Ids, codes and counts only: no text (Stage 17 NO_CONTENT).
 */
export const modelCalls = pgTable(
  'model_calls',
  {
    id: uuid('id').notNull().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    usageRecordId: uuid('usage_record_id').references(() => usageRecords.id, { onDelete: 'set null' }),
    turnId: uuid('turn_id').references(() => turns.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    ordinal: integer('ordinal').notNull(),
    attempt: integer('attempt').notNull().default(1),
    /** answer | forced_answer | title | style | summary | router */
    role: varchar('role', { length: 16 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerModelId: varchar('provider_model_id', { length: 128 }).notNull(),
    /** message_id | response_id | request_id; null when the provider gave none. */
    providerRefType: varchar('provider_ref_type', { length: 16 }),
    providerRef: varchar('provider_ref', { length: 128 }),
    finishReason: varchar('finish_reason', { length: 48 }),
    /** ok | partial (stopped mid-request) | no_usage | error (the request failed) */
    outcome: varchar('outcome', { length: 16 }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    tokensExact: boolean('tokens_exact').notNull().default(false),
    /** provider | provider_partial | none (no `estimated`: Invariant 3). */
    usageSource: varchar('usage_source', { length: 16 }).notNull(),
    trafficTier: varchar('traffic_tier', { length: 16 }).notNull().default('standard'),
    priceVersion: varchar('price_version', { length: 64 }),
    /** Null when the call has no verified price. Null != 0. */
    costUsd: doublePrecision('cost_usd'),
    costInr: doublePrecision('cost_inr'),
    /** The rate `cost_inr` was taken at (N-37), null when there is no cost. */
    fxInrPerUsd: doublePrecision('fx_inr_per_usd'),
    providerTtftMs: integer('provider_ttft_ms'),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.startedAt] }),
    index('ix_model_calls_usage').on(t.usageRecordId),
    index('ix_model_calls_user_started').on(t.userId, t.startedAt),
    check('ck_model_calls_role', sql`${t.role} in ('answer', 'forced_answer', 'title', 'style', 'summary', 'router')`),
    check('ck_model_calls_source', sql`${t.usageSource} in ('provider', 'provider_partial', 'none')`),
    check('ck_model_calls_outcome', sql`${t.outcome} in ('ok', 'partial', 'no_usage', 'error')`),
  ],
);

export type ModelCallRow = typeof modelCalls.$inferSelect;
export type PriceTableRow = typeof priceTable.$inferSelect;

// --- P13: history summaries (ADR-0080) ------------------------------------------------------

/**
 * A rolling summary of a chat's earlier turns (Stage 6 CXD-5, N-77). It stands in for every
 * message up to and including `covers_upto_message_id`, and is used only while that message is
 * in this chat, below the current user message, and still exists (the FK cascades). A branch
 * copies the summaries whose covered message it keeps. Text only, at most N-77 6,000 characters.
 */
export const summaries = pgTable(
  'summaries',
  {
    id: id(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    coversUptoMessageId: uuid('covers_upto_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    coversUptoSeq: integer('covers_upto_seq').notNull(),
    summaryVersion: integer('summary_version').notNull(),
    text: text('text').notNull(),
    /** The provider model id that wrote it. */
    model: varchar('model', { length: 128 }).notNull(),
    /** ready | discarded */
    status: varchar('status', { length: 16 }).notNull().default('ready'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('uq_summaries_chat_covers').on(t.chatId, t.coversUptoMessageId),
    uniqueIndex('uq_summaries_chat_version').on(t.chatId, t.summaryVersion),
    index('ix_summaries_chat_seq').on(t.chatId, t.coversUptoSeq),
    check('ck_summaries_status', sql`${t.status} in ('ready', 'discarded')`),
    check('ck_summaries_text_len', sql`char_length(${t.text}) <= 6000`),
  ],
);

export type SummaryRow = typeof summaries.$inferSelect;
