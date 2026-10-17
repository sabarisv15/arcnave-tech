/**
 * The data map (Stage 5 P5; ADR-0079): every table, what it holds, how long it is kept and what
 * deletes it. `dataMap.test.ts` fails when a table exists without an entry here (a new table
 * must say how it is deleted before it ships), and when a table that holds a person's data has
 * no cascade path to `users` (account deletion would leave it behind).
 *
 * Retention classes (ours; the values they name are in the register where one exists):
 * - `account`: the person's account; deleted by account deletion.
 * - `chat`: a conversation and what hangs off it; purged by the retention sweep N-33 days after
 *   the chat is deleted (OQ-15 keeps today's value), and by account deletion.
 * - `project`: a project's files and their derived rows; deleted with the project or account.
 * - `library`: the person's own artifacts, memory, styles and saved sources; outlive a chat.
 * - `files`: an upload's pipeline rows; deleted with the file (or its chat / account).
 * - `ledger`: usage and money (usage rows, counters, reservations, model calls); kept with the
 *   account, deleted by account deletion. A purged chat leaves them, with its id set null.
 * - `short_lived`: expires on its own (idempotency keys 24 h N-34, exports 24 h, claims).
 * - `reference`: no personal data (the price book).
 *
 * The deletion ledger itself is not a table: it lives in object storage, outside the
 * restorable database (Stage 5 P11, `services/deletionLedger.ts`).
 */

export const RETENTION_CLASSES = ['account', 'chat', 'project', 'library', 'files', 'ledger', 'short_lived', 'reference'] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export interface DataMapEntry {
  retention: RetentionClass;
  /** True when a row can hold or point at one person's data (then account deletion must reach it). */
  personal: boolean;
  /** What removes a row. */
  deletedBy: string;
}

export const DATA_MAP: Readonly<Record<string, DataMapEntry>> = {
  users: { retention: 'account', personal: true, deletedBy: 'account deletion' },
  sessions: { retention: 'account', personal: true, deletedBy: 'sign-out, expiry, account deletion' },
  preferences: { retention: 'account', personal: true, deletedBy: 'account deletion' },
  projects: { retention: 'project', personal: true, deletedBy: 'project delete, account deletion' },
  project_files: { retention: 'project', personal: true, deletedBy: 'file delete, project delete, account deletion' },
  file_chunks: { retention: 'project', personal: true, deletedBy: 'with its project file' },
  saved_sources: { retention: 'library', personal: true, deletedBy: 'user delete, account deletion' },
  chats: { retention: 'chat', personal: true, deletedBy: 'retention sweep after chat delete, account deletion' },
  messages: { retention: 'chat', personal: true, deletedBy: 'with its chat' },
  message_sources: { retention: 'chat', personal: true, deletedBy: 'with its message' },
  research_events: { retention: 'chat', personal: true, deletedBy: 'with its message' },
  tool_calls: { retention: 'chat', personal: true, deletedBy: 'with its message' },
  attachments: { retention: 'files', personal: true, deletedBy: 'with its message, unsent-upload sweep, account deletion' },
  file_jobs: { retention: 'files', personal: true, deletedBy: 'with its file' },
  file_derivatives: { retention: 'files', personal: true, deletedBy: 'with its file' },
  file_derivative_pages: { retention: 'files', personal: true, deletedBy: 'with its derivative' },
  derivative_chunks: { retention: 'files', personal: true, deletedBy: 'with its derivative' },
  upload_quota: { retention: 'short_lived', personal: true, deletedBy: 'account deletion' },
  sandbox_workspaces: { retention: 'chat', personal: true, deletedBy: 'with its chat, sandbox-state sweep' },
  share_links: { retention: 'chat', personal: true, deletedBy: 'revoke, with its chat' },
  account_exports: { retention: 'short_lived', personal: true, deletedBy: 'retention sweep at link expiry (24 h), account deletion' },
  turn_logs: { retention: 'chat', personal: true, deletedBy: 'with its message' },
  artifacts: { retention: 'library', personal: true, deletedBy: 'user delete, account deletion' },
  artifact_versions: { retention: 'library', personal: true, deletedBy: 'with its artifact' },
  usage_records: { retention: 'ledger', personal: true, deletedBy: 'account deletion' },
  usage_counters: { retention: 'ledger', personal: true, deletedBy: 'account deletion' },
  idempotency_keys: { retention: 'short_lived', personal: true, deletedBy: 'turn sweeper after 24 h (N-34), account deletion' },
  sandbox_claims: { retention: 'short_lived', personal: false, deletedBy: 'when the run ends' },
  goals: { retention: 'chat', personal: true, deletedBy: 'with its chat' },
  goal_events: { retention: 'chat', personal: true, deletedBy: 'with its goal' },
  memory_items: { retention: 'library', personal: true, deletedBy: 'user delete, account deletion' },
  conversation_compactions: { retention: 'chat', personal: true, deletedBy: 'with its chat' },
  styles: { retention: 'library', personal: true, deletedBy: 'user delete, account deletion' },
  turns: { retention: 'chat', personal: true, deletedBy: 'with its chat' },
  budget_reservations: { retention: 'ledger', personal: true, deletedBy: 'account deletion' },
  price_table: { retention: 'reference', personal: false, deletedBy: 'never (a price row is history)' },
  model_calls: { retention: 'ledger', personal: true, deletedBy: 'account deletion' },
};
