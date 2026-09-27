import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, CornerDownLeft, GripVertical } from "lucide-react";
import type { AskUserOptionItem, AskUserOptionsInput, Message } from "./types";

/**
 * Extracts and validates the latest `ask_user_options` tool call from an assistant message.
 * Returns null if the message is not an assistant message or has no valid `ask_user_options` call.
 */
export function extractAskUserOptions(message: Message | undefined): AskUserOptionsInput | null {
  if (!message || message.role !== "assistant" || !message.toolCalls?.length) {
    return null;
  }

  const call = [...message.toolCalls]
    .reverse()
    .find((c) => c.name === "ask_user_options" && c.ok !== false);
  if (!call || !call.input || typeof call.input !== "object") {
    return null;
  }

  const raw = call.input as Record<string, unknown>;
  if (typeof raw.question !== "string" || !raw.question.trim()) {
    return null;
  }
  const kind = (raw.kind ?? raw.mode) as string | undefined;
  if (kind !== "single" && kind !== "multi" && kind !== "rank") {
    return null;
  }
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 6) {
    return null;
  }

  const options: AskUserOptionItem[] = [];
  for (const item of raw.options) {
    if (!item || typeof item !== "object") return null;
    const opt = item as Record<string, unknown>;
    if (typeof opt.label !== "string" || !opt.label.trim()) return null;
    options.push({
      label: opt.label.trim(),
      ...(typeof opt.description === "string" && opt.description.trim()
        ? { description: opt.description.trim() }
        : {}),
    });
  }

  return {
    question: raw.question.trim(),
    kind,
    options,
  };
}

export function reorderOptions(
  items: AskUserOptionItem[],
  fromIndex: number,
  toIndex: number,
): AskUserOptionItem[] {
  if (toIndex < 0 || toIndex >= items.length || fromIndex === toIndex || fromIndex < 0 || fromIndex >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (moved) next.splice(toIndex, 0, moved);
  return next;
}

export function formatMultiSelection(
  options: AskUserOptionItem[],
  selectedIndices: ReadonlySet<number>,
): string {
  return options
    .filter((_, idx) => selectedIndices.has(idx))
    .map((o) => o.label)
    .join(", ");
}

export function formatRankSelection(items: AskUserOptionItem[]): string {
  return items.map((item, idx) => `${idx + 1}. ${item.label}`).join("\n");
}

export default function QuestionOptions({
  data,
  onSubmit,
  disabled = false,
}: {
  data: AskUserOptionsInput;
  onSubmit: (replyText: string) => void;
  disabled?: boolean;
}) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [rankedItems, setRankedItems] = useState<AskUserOptionItem[]>(data.options);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    setSelectedIndices(new Set());
    setRankedItems(data.options);
    setDragIndex(null);
  }, [data]);

  const toggleMulti = (index: number) => {
    if (disabled) return;
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const moveRankItem = (fromIndex: number, toIndex: number) => {
    if (disabled) return;
    setRankedItems((prev) => reorderOptions(prev, fromIndex, toIndex));
  };

  const submitMulti = () => {
    if (disabled || selectedIndices.size === 0) return;
    onSubmit(formatMultiSelection(data.options, selectedIndices));
  };

  const submitRank = () => {
    if (disabled || rankedItems.length === 0) return;
    onSubmit(formatRankSelection(rankedItems));
  };

  return (
    <div className="question-options" data-testid="question-options" role="region" aria-label={data.question}>
      <div className="question-options-header">
        <p className="question-options-prompt" data-testid="question-prompt">{data.question}</p>
        {data.kind !== "single" && (
          <span className="question-options-hint">
            {data.kind === "multi" ? "Select all that apply" : "Order by preference"}
          </span>
        )}
      </div>

      {data.kind === "single" && (
        <div className="question-options-list" role="group" aria-label={data.question}>
          {data.options.map((opt, idx) => (
            <button
              key={`${opt.label}-${idx}`}
              type="button"
              className="question-option-item is-single"
              disabled={disabled}
              onClick={() => onSubmit(opt.label)}
            >
              <span className="question-option-content">
                <span className="question-option-label">{opt.label}</span>
                {opt.description && (
                  <span className="question-option-desc">{opt.description}</span>
                )}
              </span>
              <CornerDownLeft size={14} className="question-option-enter" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {data.kind === "multi" && (
        <>
          <div className="question-options-list" role="group" aria-label={data.question}>
            {data.options.map((opt, idx) => {
              const checked = selectedIndices.has(idx);
              return (
                <label
                  key={`${opt.label}-${idx}`}
                  className={`question-option-item is-multi ${checked ? "is-selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="question-option-checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleMulti(idx)}
                  />
                  <span className="question-option-box" aria-hidden="true">
                    {checked && <Check size={12} strokeWidth={2.5} />}
                  </span>
                  <span className="question-option-content">
                    <span className="question-option-label">{opt.label}</span>
                    {opt.description && (
                      <span className="question-option-desc">{opt.description}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="question-options-footer">
            <button
              type="button"
              className="question-options-submit"
              disabled={disabled || selectedIndices.size === 0}
              onClick={submitMulti}
            >
              Send
            </button>
          </div>
        </>
      )}

      {data.kind === "rank" && (
        <>
          <ol className="question-options-list is-rank-list" aria-label={data.question}>
            {rankedItems.map((opt, idx) => (
              <li
                key={opt.label}
                className={`question-option-item is-rank ${dragIndex === idx ? "is-dragging" : ""}`}
                draggable={!disabled}
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== idx) {
                    moveRankItem(dragIndex, idx);
                  }
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
              >
                <span className="question-option-grip" aria-hidden="true">
                  <GripVertical size={14} />
                </span>
                <span className="question-option-rank-badge">{idx + 1}</span>
                <span className="question-option-content">
                  <span className="question-option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="question-option-desc">{opt.description}</span>
                  )}
                </span>
                <span className="question-option-rank-controls">
                  <button
                    type="button"
                    className="question-option-move"
                    aria-label={`Move ${opt.label} up`}
                    disabled={disabled || idx === 0}
                    onClick={() => moveRankItem(idx, idx - 1)}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="question-option-move"
                    aria-label={`Move ${opt.label} down`}
                    disabled={disabled || idx === rankedItems.length - 1}
                    onClick={() => moveRankItem(idx, idx + 1)}
                  >
                    <ArrowDown size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <div className="question-options-footer">
            <button
              type="button"
              className="question-options-submit"
              disabled={disabled}
              onClick={submitRank}
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}
