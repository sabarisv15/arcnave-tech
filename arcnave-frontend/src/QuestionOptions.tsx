import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, CornerDownLeft, GripVertical } from "lucide-react";
import type { AskUserQuestion, Message } from "./types";

const TYPES = new Set(["single_select", "multi_select", "rank_priorities"]);

/**
 * The questions of the latest ask_user_input_v0 call in an assistant message (ADR-0048), or
 * null when there is none to answer. A reply that asked with the older ask_user_options still
 * shows its one question.
 */
export function extractAskUserInput(message: Message | undefined): AskUserQuestion[] | null {
  if (!message || message.role !== "assistant" || !message.toolCalls?.length) return null;
  const call = [...message.toolCalls]
    .reverse()
    .find((c) => (c.name === "ask_user_input_v0" || c.name === "ask_user_options") && c.ok !== false);
  if (!call || !call.input || typeof call.input !== "object") return null;
  const raw = call.input as Record<string, unknown>;

  if (call.name === "ask_user_options") {
    const kind = raw.kind ?? raw.mode;
    const type = kind === "multi" ? "multi_select" : kind === "rank" ? "rank_priorities" : kind === "single" ? "single_select" : null;
    const options = Array.isArray(raw.options) ? raw.options.map((o) => (o as { label?: unknown })?.label) : [];
    if (!type || typeof raw.question !== "string" || !raw.question.trim()) return null;
    if (options.length < 2 || !options.every((o): o is string => typeof o === "string" && !!o.trim())) return null;
    return [{ question: raw.question.trim(), type, options: options.map((o) => o.trim()) }];
  }

  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 3) return null;
  const out: AskUserQuestion[] = [];
  for (const item of raw.questions) {
    const q = (item ?? {}) as Record<string, unknown>;
    const type = (q.type ?? "single_select") as AskUserQuestion["type"];
    if (typeof q.question !== "string" || !q.question.trim() || !TYPES.has(type)) return null;
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return null;
    if (!q.options.every((o): o is string => typeof o === "string" && !!o.trim())) return null;
    out.push({ question: q.question.trim(), type, options: q.options.map((o) => o.trim()) });
  }
  return out;
}

export function reorderOptions(items: string[], fromIndex: number, toIndex: number): string[] {
  if (toIndex < 0 || toIndex >= items.length || fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (moved !== undefined) next.splice(toIndex, 0, moved);
  return next;
}

export function formatMultiSelection(options: string[], selected: ReadonlySet<number>): string {
  return options.filter((_, i) => selected.has(i)).join(", ");
}

export function formatRankSelection(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join("\n");
}

/** The message the answers send: the answer alone for one question, each under its question for more. */
export function formatAnswers(questions: AskUserQuestion[], answers: string[]): string {
  if (questions.length === 1) return answers[0] ?? "";
  return questions.map((q, i) => `${q.question}\n${answers[i] ?? ""}`).join("\n\n");
}

export default function QuestionOptions({
  data,
  onSubmit,
  disabled = false,
}: {
  data: AskUserQuestion[];
  onSubmit: (replyText: string) => void;
  disabled?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [ranked, setRanked] = useState<string[]>(data[0]?.options ?? []);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    setStep(0);
    setAnswers([]);
  }, [data]);
  useEffect(() => {
    setSelected(new Set());
    setRanked(data[step]?.options ?? []);
    setDragIndex(null);
  }, [data, step]);

  const q = data[step];
  if (!q) return null;
  const last = step === data.length - 1;

  const answer = (text: string) => {
    if (disabled) return;
    const all = [...answers.slice(0, step), text];
    if (last) onSubmit(formatAnswers(data, all));
    else {
      setAnswers(all);
      setStep(step + 1);
    }
  };

  const toggle = (index: number) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const move = (from: number, to: number) => !disabled && setRanked((prev) => reorderOptions(prev, from, to));

  return (
    <div className="question-options" data-testid="question-options" role="region" aria-label={q.question}>
      <div className="question-options-header">
        <p className="question-options-prompt" data-testid="question-prompt">{q.question}</p>
        {data.length > 1 && (
          <span className="question-options-hint">
            {step + 1} of {data.length}
          </span>
        )}
        {q.type !== "single_select" && (
          <span className="question-options-hint">
            {q.type === "multi_select" ? "Select all that apply" : "Order by preference"}
          </span>
        )}
      </div>

      {q.type === "single_select" && (
        <div className="question-options-list" role="group" aria-label={q.question}>
          {q.options.map((opt, idx) => (
            <button key={`${opt}-${idx}`} type="button" className="question-option-item is-single" disabled={disabled} onClick={() => answer(opt)}>
              <span className="question-option-content">
                <span className="question-option-label">{opt}</span>
              </span>
              <CornerDownLeft size={14} className="question-option-enter" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {q.type === "multi_select" && (
        <div className="question-options-list" role="group" aria-label={q.question}>
          {q.options.map((opt, idx) => {
            const checked = selected.has(idx);
            return (
              <label key={`${opt}-${idx}`} className={`question-option-item is-multi ${checked ? "is-selected" : ""}`}>
                <input type="checkbox" className="question-option-checkbox" checked={checked} disabled={disabled} onChange={() => toggle(idx)} />
                <span className="question-option-box" aria-hidden="true">
                  {checked && <Check size={12} strokeWidth={2.5} />}
                </span>
                <span className="question-option-content">
                  <span className="question-option-label">{opt}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {q.type === "rank_priorities" && (
        <ol className="question-options-list is-rank-list" aria-label={q.question}>
          {ranked.map((opt, idx) => (
            <li
              key={opt}
              className={`question-option-item is-rank ${dragIndex === idx ? "is-dragging" : ""}`}
              draggable={!disabled}
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null && dragIndex !== idx) move(dragIndex, idx);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <span className="question-option-grip" aria-hidden="true">
                <GripVertical size={14} />
              </span>
              <span className="question-option-rank-badge">{idx + 1}</span>
              <span className="question-option-content">
                <span className="question-option-label">{opt}</span>
              </span>
              <span className="question-option-rank-controls">
                <button type="button" className="question-option-move" aria-label={`Move ${opt} up`} disabled={disabled || idx === 0} onClick={() => move(idx, idx - 1)}>
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  className="question-option-move"
                  aria-label={`Move ${opt} down`}
                  disabled={disabled || idx === ranked.length - 1}
                  onClick={() => move(idx, idx + 1)}
                >
                  <ArrowDown size={13} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {q.type !== "single_select" && (
        <div className="question-options-footer">
          <button
            type="button"
            className="question-options-submit"
            disabled={disabled || (q.type === "multi_select" && selected.size === 0)}
            onClick={() => answer(q.type === "multi_select" ? formatMultiSelection(q.options, selected) : formatRankSelection(ranked))}
          >
            {last ? "Send" : "Next"}
          </button>
        </div>
      )}
    </div>
  );
}
