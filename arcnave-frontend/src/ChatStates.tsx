/**
 * The states a reply can end in, drawn as the locked board "Chat: every other state"
 * (docs/brand/S6-Chat-States.dc.html, S6-Chat-States-Dark.dc.html): a model label under every
 * answer, an inline editor in place of the bubble, a note for a stopped, cut-short or dropped
 * answer, and one card for a failure. Styles are in chat-states.css.
 *
 * Every state here is chosen from a machine-readable value, never from prose: the failure card
 * from the error `code`, the cut-short note from the stored `finishReason` (types.ts
 * `cutOffReason`). The words below are ours or the board's; a server title or detail is shown
 * only where the code has no copy of its own, or where it adds a specific the code cannot
 * (which budget, why a model declined).
 */
import { useEffect, useRef, useState } from "react";
import { CircleAlert, RotateCcw, Shield, Square } from "lucide-react";
import { AiStateMark } from "./brand";
import { errorCopy } from "./api";
import { EFFORT_COPY } from "./Composer";
import { cutOffReason } from "./types";
import type { ReasoningEffort } from "./types";

export type FailureTone = "err" | "warn" | "info";

export interface FailureView {
  tone: FailureTone;
  title: string;
  detail: string;
  /** The failure is a limit the person can change in Settings, so the card links there. */
  limits: boolean;
}

/**
 * Board copy (S6-Chat-States, "7 · Couldn't answer"). Every other code uses the copy already in
 * `api.errorCopy`, the same words a stored transcript shows, so a live card and a reloaded one
 * read alike.
 */
const BOARD_COPY: Record<string, { title: string; detail: string }> = {
  provider_error: {
    title: "arcnave couldn’t answer this time.",
    detail: "Try again in a moment.",
  },
  model_refused: {
    title: "arcnave can’t help with this one.",
    detail: "You can ask in a different way.",
  },
};

/** Codes that are a limit, not a fault: shown in the board's amber note. */
const LIMIT_CODES = new Set(["budget_exceeded", "rate_limit", "provider_limit"]);

const UNKNOWN = {
  title: "That did not work",
  detail:
    "ArcNave received an error it does not recognise. Retrying may help; the request ID helps trace it.",
};

/**
 * What a failed reply shows, from its error code.
 *
 * `server` is what a live frame carried. It never changes the tone or the action; it supplies
 * the title only for a code this build has no words for, and the detail whenever it is present,
 * because the server knows things the code does not (which budget was reached and how much was
 * used; the explanation a model gave for declining).
 */
export function failureView(
  code: string | null | undefined,
  server?: { title?: string; detail?: string },
): FailureView {
  const known = code ? (BOARD_COPY[code] ?? errorCopy[code]) : undefined;
  const base = known ?? UNKNOWN;
  const tone: FailureTone = code === "model_refused" ? "info" : code && LIMIT_CODES.has(code) ? "warn" : "err";
  return {
    tone,
    title: known ? base.title : server?.title || base.title,
    detail: server?.detail || base.detail,
    limits: code === "budget_exceeded",
  };
}

const TONE_ICON = { err: CircleAlert, warn: CircleAlert, info: Shield } as const;

/**
 * A failed reply: what happened, then the way forward (board rule "Plain words, one button").
 * An error that is a fault shows the AI "error" mark at chat size; a limit or a refusal shows the
 * board's small icon, because nothing broke.
 */
export function FailureCard({
  code,
  title,
  detail,
  onRetry,
  retryDisabled = false,
  onOpenLimits,
}: {
  code: string | null | undefined;
  title?: string;
  detail?: string;
  onRetry: () => void;
  retryDisabled?: boolean;
  onOpenLimits?: () => void;
}) {
  const view = failureView(code, { title, detail });
  const Glyph = TONE_ICON[view.tone];
  return (
    <div className={`cs-note cs-${view.tone} cs-failure`} role="alert" data-code={code ?? "unknown"}>
      {view.tone === "err" ? (
        <AiStateMark state="error" size={32} decorative />
      ) : (
        <Glyph size={14} aria-hidden="true" className="cs-glyph" />
      )}
      <span className="cs-text">
        <b>{view.title}</b>
        <span>{view.detail}</span>
      </span>
      <span className="cs-actions">
        {view.limits && onOpenLimits && (
          <button type="button" className="cs-btn" onClick={onOpenLimits}>
            Usage &amp; limits
          </button>
        )}
        <button type="button" className="cs-btn" onClick={onRetry} disabled={retryDisabled}>
          <RotateCcw size={14} aria-hidden="true" />
          Retry
        </button>
      </span>
    </div>
  );
}

/** "You stopped it" (board 5): the written part stays, and the person chooses what next. */
export function StoppedNote({
  onContinue,
  onRegenerate,
  disabled = false,
}: {
  onContinue: () => void;
  onRegenerate: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="cs-note cs-stopped">
      <Square size={12} aria-hidden="true" className="cs-glyph" />
      <span className="cs-text">
        <b>You stopped this answer. The part above is kept.</b>
      </span>
      <span className="cs-actions">
        <button type="button" className="cs-btn" onClick={onContinue} disabled={disabled}>
          Continue
        </button>
        <button type="button" className="cs-btn" onClick={onRegenerate} disabled={disabled}>
          <RotateCcw size={14} aria-hidden="true" />
          Regenerate
        </button>
      </span>
    </div>
  );
}

/**
 * "Cut short" (board 6) for an answer that reached its output limit (`max_tokens`) or used
 * every tool step the turn allows (`tool_limit`). Both can be continued; null for an answer
 * that ended normally.
 */
export function CutShortNote({
  finishReason,
  onContinue,
  disabled = false,
}: {
  finishReason: string | undefined;
  onContinue: () => void;
  disabled?: boolean;
}) {
  const reason = cutOffReason(finishReason);
  if (!reason) return null;
  return (
    <div className="cs-note cs-warn cs-cut" data-reason={reason}>
      <CircleAlert size={14} aria-hidden="true" className="cs-glyph" />
      <span className="cs-text">
        <b>
          {reason === "output_limit"
            ? "This answer was cut short. It hit the length limit."
            : reason === "partial"
              ? "This answer stopped early. The model failed after a tool had already run; the tool was not run again."
              : "This answer was cut short. It used every tool step this turn allows."}
        </b>
      </span>
      <span className="cs-actions">
        <button type="button" className="cs-btn cs-primary" onClick={onContinue} disabled={disabled}>
          Continue
        </button>
      </span>
    </div>
  );
}

/** "The connection dropped mid-answer" (board 6): the part already written is kept. */
export function DroppedNote({
  onContinue,
  disabled = false,
}: {
  onContinue: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="cs-note cs-warn cs-dropped" role="alert" data-code="network">
      <CircleAlert size={14} aria-hidden="true" className="cs-glyph" />
      <span className="cs-text">
        <b>The connection dropped mid-answer. The part above is kept.</b>
      </span>
      <span className="cs-actions">
        <button type="button" className="cs-btn cs-primary" onClick={onContinue} disabled={disabled}>
          Continue
        </button>
      </span>
    </div>
  );
}

/**
 * Which model wrote an answer and at what effort, under every answer (board 2). What the
 * server resolved is shown; a model the person did not name is not described as one they chose.
 */
export function ModelLabel({
  modelAlias,
  effort,
}: {
  modelAlias: string | undefined;
  effort: ReasoningEffort | undefined;
}) {
  if (!modelAlias) return null;
  return (
    <span className="cs-mlab">
      <b>{modelAlias}</b>
      {effort && <span> · {EFFORT_COPY[effort].label}</span>}
    </span>
  );
}

/**
 * Edit a message in place of its bubble (board 3). Sending makes a new version of the
 * conversation and keeps the old one (ADR-0038); Escape cancels, Ctrl or Cmd + Enter sends.
 */
export function InlineEdit({
  initial,
  onSend,
  onCancel,
}: {
  initial: string;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const send = () => {
    if (text.trim()) onSend(text);
  };
  return (
    <div className="cs-edit">
      <textarea
        ref={field}
        aria-label="Edit your message"
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="cs-edit-row">
        <span className="cs-edit-hint">Sending makes a new version. The old one stays.</span>
        <button type="button" className="cs-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="cs-btn cs-primary" onClick={send} disabled={!text.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
