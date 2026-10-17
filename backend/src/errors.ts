/**
 * Normalized error envelope.
 *
 * Every failure a client can see is an `ApiError` with a stable machine-readable `code`.
 * The frontend switches on `code`, never on prose, so copy can change without breaking
 * behaviour. HTTP status is derived from the code, so one code always maps to one status.
 */

export interface ErrorBody {
  error: {
    code: string;
    title: string;
    detail: string;
    requestId: string;
    meta?: Record<string, unknown>;
  };
}

interface CatalogEntry {
  status: number;
  title: string;
  detail: string;
}

export const ERROR_CATALOG = {
  tool_protocol_in_text: {
    status: 502,
    title: 'The response could not be displayed',
    detail: 'The model returned internal tool data as answer text. Retry this response.',
  },
  // --- client -------------------------------------------------------------
  validation_error: {
    status: 422,
    title: 'That request could not be processed',
    detail: 'Check the highlighted fields and try again.',
  },
  not_found: {
    status: 404,
    title: 'Not found',
    detail: 'That item does not exist, or you do not have access to it.',
  },
  conflict: {
    status: 409,
    title: 'This changed somewhere else',
    detail: 'Reload to get the latest version, then reapply your edit.',
  },
  unauthorized: {
    status: 401,
    title: 'Sign in to continue',
    detail: 'Your session has ended. Sign in again.',
  },
  forbidden: { status: 403, title: 'Not permitted', detail: 'You do not have access to that.' },
  email_taken: {
    status: 409,
    title: 'That email is already registered',
    detail: 'Sign in instead, or use a different address.',
  },
  invalid_credentials: {
    status: 401,
    title: 'That email or password is incorrect',
    detail: 'Check both and try again.',
  },
  weak_password: {
    status: 422,
    title: 'Choose a longer password',
    detail: 'Passwords must be at least 12 characters.',
  },
  google_signin_disabled: {
    status: 404,
    title: 'Google sign-in is not available',
    detail: 'This workspace has not set up Google sign-in. Use your e-mail and password.',
  },
  registration_closed: {
    status: 403,
    title: 'Registration is closed',
    detail: 'New accounts are not being accepted right now.',
  },
  payload_too_large: {
    status: 413,
    title: 'That file is too large',
    detail: 'Choose a smaller file.',
  },
  unsupported_media_type: {
    status: 415,
    title: 'That file type is not supported',
    detail: 'Try a document, image, spreadsheet, or code file.',
  },
  too_many_files: {
    status: 409,
    title: 'Too many files in this chat',
    detail: 'A chat can hold at most 20 files. Start a new chat to add more.',
  },
  upload_incomplete: {
    status: 409,
    title: 'The upload did not finish',
    detail: 'Not all of the file arrived. Remove it and upload it again.',
  },
  file_not_ready: {
    status: 409,
    title: 'A file is not ready',
    detail: 'Wait for every file to finish reading, or remove the ones that failed, then send.',
  },
  file_already_attached: {
    status: 409,
    title: 'This file is already in a sent message',
    detail: 'Attach the file again to use it in a new message.',
  },
  upload_quota_exceeded: {
    status: 429,
    title: 'Daily upload limit reached',
    detail: 'You have reached today’s upload limit. Try again tomorrow.',
  },
  rate_limit: { status: 429, title: 'Too many requests', detail: 'Wait a moment, then try again.' },
  idempotency_conflict: {
    status: 409,
    title: 'Duplicate request',
    detail: 'This idempotency key was already used with a different body.',
  },

  // --- product / capability -----------------------------------------------
  model_unavailable: {
    status: 400,
    title: 'This model is unavailable',
    detail: 'It is not configured for this workspace. Choose another model.',
  },
  no_model_available: {
    status: 503,
    title: 'No model is available',
    detail: 'No model in the registry is currently configured and reachable.',
  },
  capability_unavailable: {
    status: 400,
    title: 'That capability is not configured',
    detail:
      'Search and research need a grounding provider. Ordinary chat still works.',
  },
  budget_exceeded: {
    status: 402,
    title: 'Token budget reached',
    detail:
      'You have reached your configured limit. Raise or clear it in Settings under Usage & limits.',
  },
  run_in_progress: {
    status: 409,
    title: 'A response is already running',
    detail: 'Stop the current response before starting another.',
  },
  /**
   * P08 (ADR-0078): the instance running this reply stopped before it finished (its lease lapsed);
   * the text written so far is kept on the message.
   */
  interrupted: {
    status: 503,
    title: 'This response was interrupted',
    detail: 'The server running it stopped before it finished. What was written so far is kept. You can retry.',
  },
  /** P08: the server is restarting; a new reply is refused, and a running one is stopped and saved. */
  server_shutdown: {
    status: 503,
    title: 'The server is restarting',
    detail: 'The server restarted while this response was running, or before it could start. Retry in a moment.',
  },
  /** P08 (Stage 15 ER-6a): the database timed out or is out of connections; retried by the client. */
  unavailable: {
    status: 503,
    title: 'The service is busy',
    detail: 'The request could not be completed in time. Try again in a few seconds.',
  },
  no_active_run: {
    status: 404,
    title: 'No response is running here',
    detail: 'The reply has finished or is running elsewhere. Reload the chat to see it.',
  },
  export_unsupported: {
    status: 422,
    title: 'This version cannot be exported to that format',
    detail: 'Its content has none of the structure that format needs.',
  },

  password_incorrect: {
    status: 403,
    title: 'That password is not right',
    detail: 'Enter the password you sign in with to confirm.',
  },
  export_expired: {
    status: 410,
    title: 'This export has expired',
    detail: 'Export links last 24 hours. Ask for a new export in Settings.',
  },
  share_not_found: {
    status: 404,
    title: 'This link is not available',
    detail: 'It may have been turned off by the person who shared it, or it was never valid.',
  },
  share_empty: {
    status: 422,
    title: 'Nothing to share yet',
    detail: 'Share the conversation once it has a finished reply.',
  },

  preview_unsupported: {
    status: 422,
    title: 'No preview for this file',
    detail: 'Download it to open it in its own application.',
  },

  empty_response: {
    status: 502,
    title: 'No response generated',
    detail: 'The model completed its operations but produced no written answer. You can retry.',
  },
  model_refused: {
    status: 422,
    title: 'The model declined this request',
    detail: 'The model stopped and declined to answer. Rephrase the request or choose another model.',
  },
  provider_payload_limit: {
    status: 400,
    title: 'Attachment exceeds model limits',
    detail: 'This attachment exceeds the provider limit. Choose a smaller file or switch to Gemini Flash.',
  },
  context_overflow: {
    status: 400,
    title: 'Conversation exceeded context limit',
    detail:
      "The conversation and its files are larger than this model's context window, even after trimming history. Ask about a smaller part of a large file, or start a new chat. Code can still work on the whole file.",
  },
  provider_error: {
    status: 502,
    title: 'The response could not finish',
    detail: 'The model provider returned an error. You can retry.',
  },
  provider_limit: {
    status: 402,
    title: "This model's account limit is reached",
    detail:
      'The account behind this model has reached its spending or usage limit. Choose another model, or ask the owner to raise the limit.',
  },
  provider_timeout: {
    status: 504,
    title: 'The model took too long',
    detail: 'The provider did not respond in time. You can retry.',
  },
  turn_deadline_exceeded: {
    status: 504,
    title: 'This request ran out of time',
    detail: 'The work took longer than one turn allows and was stopped. Try a smaller part of the document, or retry.',
  },
  storage_error: {
    status: 500,
    title: 'That file could not be stored',
    detail: 'Try again. If it keeps failing, the storage backend may be unavailable.',
  },
  style_not_found: {
    status: 404,
    title: 'Style not found',
    detail: 'That style does not exist, or you do not have access to it.',
  },
  style_too_long: {
    status: 422,
    title: 'Style instructions too long',
    detail: 'Style instructions cannot exceed 4000 characters.',
  },
  sample_too_long: {
    status: 422,
    title: 'Writing sample too long',
    detail: 'Each writing sample cannot exceed 10000 characters.',
  },
  internal_error: {
    status: 500,
    title: 'Something went wrong',
    detail: 'An unexpected error occurred. The request ID helps trace it.',
  },
  /** Stage 15 ER-2g: a quota-0 429 is configuration, not load; never retried (ADR-0072). */
  provider_quota_unavailable: {
    status: 503,
    title: 'This model has no quota here',
    detail:
      'The project behind this model has no quota for it in this region, so retrying will not help. Choose another model, or ask the owner to request quota.',
  },
  /**
   * Stage 15 ER-2b: the model failed after a tool had already run in the turn. The tool is not run
   * twice, so the turn ends with what it has, marked partial in the done event (ADR-0072).
   */
  partial_after_tool_run: {
    status: 502,
    title: 'The answer stopped early',
    detail:
      'The model failed after a tool had already run. The tool was not run again, so this answer may be incomplete. Ask to continue.',
  },
  origin_not_allowed: {
    status: 403,
    title: 'Request blocked',
    detail: 'This request came from a site that is not allowed to change your account. Open ArcNave directly and try again.',
  },
  /**
   * A code run that moves a file, on a sandbox whose staging bucket has no signing account
   * (SANDBOX_SIGNING_SA): carried on the failed tool result (`tool_result.errorCode`), ADR-0070.
   */
  sandbox_misconfigured: {
    status: 503,
    title: 'Running code with files is not set up',
    detail: 'This server cannot pass files to or from the code sandbox yet, so code cannot run in a chat that has files, or make a file. Code still runs in a chat without files. Ask the owner to finish the sandbox setup.',
  },
} as const satisfies Record<string, CatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options: { detail?: string; title?: string; meta?: Record<string, unknown> } = {},
  ) {
    const entry = ERROR_CATALOG[code];
    super(`${code}: ${options.detail ?? entry.detail}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = entry.status;
    this.title = options.title ?? entry.title;
    this.detail = options.detail ?? entry.detail;
    if (options.meta) this.meta = options.meta;
  }

  toBody(requestId: string): ErrorBody {
    return {
      error: {
        code: this.code,
        title: this.title,
        detail: this.detail,
        requestId,
        ...(this.meta ? { meta: this.meta } : {}),
      },
    };
  }
}

export function notFound(what = 'item'): ApiError {
  return new ApiError('not_found', {
    detail: `That ${what} does not exist, or you do not have access to it.`,
  });
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
