import { useState } from "react";
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { ApiError, api } from "./api";
import type { StyleDto, StylePresetDto } from "./api";
import { Modal } from "./ui";

export const BUILTIN_STYLE_PRESETS: StylePresetDto[] = [
  {
    id: "normal",
    name: "Normal",
    description: "Default workspace style",
    instructions: "",
  },
  {
    id: "concise",
    name: "Concise",
    description: "Clear, direct, and compact answers with minimal elaboration",
    instructions:
      "Respond concisely. Deliver essential conclusions, direct answers, and code without unnecessary background, filler, or extended exposition.",
  },
  {
    id: "explanatory",
    name: "Explanatory",
    description:
      "Detailed, concept-first explanations with helpful context and rationale",
    instructions:
      "Provide clear, well-structured explanations. Walk through key concepts, rationale, and background context so the answer is easy to understand and learn from.",
  },
  {
    id: "formal",
    name: "Formal",
    description:
      "Polished, professional, and objective tone suited for workplace communication",
    instructions:
      "Use an objective, professional, and sophisticated tone. Ensure structured phrasing, precise vocabulary, and well-organized formatting suitable for executive and professional communication.",
  },
];

type ModalView = "list" | "create" | "edit";
type CreateMode = "instructions" | "samples";

export default function StylesModal({
  open,
  onClose,
  presets,
  customStyles,
  activeStyleId,
  onSelectStyle,
  onStylesChanged,
}: {
  open: boolean;
  onClose: () => void;
  presets: StylePresetDto[];
  customStyles: StyleDto[];
  activeStyleId: string;
  onSelectStyle: (styleId: string) => void;
  onStylesChanged: () => Promise<void> | void;
}) {
  const [view, setView] = useState<ModalView>("list");
  const [createMode, setCreateMode] = useState<CreateMode>("instructions");
  const [editingStyle, setEditingStyle] = useState<StyleDto | null>(null);

  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [samples, setSamples] = useState<string[]>([""]);

  const [busy, setBusy] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setInstructions("");
    setSamples([""]);
    setEditingStyle(null);
    setError(null);
  };

  const openCreate = (mode: CreateMode = "instructions") => {
    resetForm();
    setCreateMode(mode);
    setView("create");
  };

  const openEdit = (style: StyleDto) => {
    resetForm();
    setEditingStyle(style);
    setName(style.name);
    setInstructions(style.instructions);
    setView("edit");
  };

  const handleSummarize = async () => {
    const validSamples = samples.map((s) => s.trim()).filter(Boolean);
    if (!validSamples.length) {
      setError("Paste at least one writing sample first.");
      return;
    }
    setError(null);
    setSummarizing(true);
    try {
      const res = await api.styles.summarize(validSamples);
      setInstructions(res.instructions);
      if (!name.trim()) {
        setName("Custom style");
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : "Could not summarize writing samples.",
      );
    } finally {
      setSummarizing(false);
    }
  };

  const handleSaveCreate = async () => {
    const trimmedName = name.trim();
    const trimmedInstructions = instructions.trim();
    if (!trimmedName) {
      setError("Give your style a name.");
      return;
    }
    if (!trimmedInstructions) {
      setError("Provide style instructions or generate them from samples.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const created = await api.styles.create({
        name: trimmedName,
        instructions: trimmedInstructions,
      });
      await onStylesChanged();
      onSelectStyle(created.id);
      resetForm();
      setView("list");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : "Could not create style.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingStyle) return;
    const trimmedName = name.trim();
    const trimmedInstructions = instructions.trim();
    if (!trimmedName || !trimmedInstructions) {
      setError("Name and instructions are required.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.styles.update(editingStyle.id, {
        name: trimmedName,
        instructions: trimmedInstructions,
        version: editingStyle.version,
      });
      await onStylesChanged();
      resetForm();
      setView("list");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : "Could not update style.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (style: StyleDto) => {
    setError(null);
    setBusy(true);
    try {
      await api.styles.delete(style.id);
      if (activeStyleId === style.id) {
        onSelectStyle("normal");
      }
      await onStylesChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : "Could not delete style.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        resetForm();
        setView("list");
        onClose();
      }}
      title={
        view === "create"
          ? "Create custom style"
          : view === "edit"
            ? "Edit style"
            : "Response styles"
      }
      description={
        view === "list"
          ? "Choose how ArcNave structures and phrases its responses. A style adjusts tone and format without changing what ArcNave knows."
          : undefined
      }
      className="styles-modal"
    >
      {error && (
        <div className="styles-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {view === "list" && (
        <div className="styles-list-view">
          <div className="styles-section">
            <div className="styles-section-header">
              <h3>Presets</h3>
            </div>
            <div className="styles-grid">
              {presets.map((preset) => {
                const active = activeStyleId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`style-card ${active ? "active" : ""}`}
                    onClick={() => onSelectStyle(preset.id)}
                  >
                    <div className="style-card-top">
                      <strong>{preset.name}</strong>
                      {active && <Check size={15} className="style-check" />}
                    </div>
                    <p>{preset.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="styles-section">
            <div className="styles-section-header">
              <h3>Custom styles</h3>
              <div className="styles-header-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openCreate("samples")}
                >
                  <Sparkles size={14} />
                  From writing samples
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openCreate("instructions")}
                >
                  <Plus size={14} />
                  New style
                </button>
              </div>
            </div>

            {customStyles.length === 0 ? (
              <p className="styles-empty">
                No custom styles yet. Create one from instructions or paste a
                few writing samples to match your voice.
              </p>
            ) : (
              <div className="custom-styles-list">
                {customStyles.map((style) => {
                  const active = activeStyleId === style.id;
                  return (
                    <div
                      key={style.id}
                      className={`custom-style-row ${active ? "active" : ""}`}
                    >
                      <button
                        type="button"
                        className="custom-style-select"
                        onClick={() => onSelectStyle(style.id)}
                      >
                        <div className="custom-style-title">
                          <strong>{style.name}</strong>
                          {active && (
                            <Check size={15} className="style-check" />
                          )}
                        </div>
                        <p>{style.instructions}</p>
                      </button>
                      <div className="custom-style-actions">
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Edit ${style.name}`}
                          onClick={() => openEdit(style)}
                          disabled={busy}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={`Delete ${style.name}`}
                          onClick={() => void handleDelete(style)}
                          disabled={busy}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {(view === "create" || view === "edit") && (
        <div className="styles-form-view">
          {view === "create" && (
            <div className="styles-tabs" role="tablist" aria-label="Creation method">
              <button
                type="button"
                role="tab"
                aria-selected={createMode === "instructions"}
                className={`styles-tab ${createMode === "instructions" ? "active" : ""}`}
                onClick={() => setCreateMode("instructions")}
              >
                Write instructions
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={createMode === "samples"}
                className={`styles-tab ${createMode === "samples" ? "active" : ""}`}
                onClick={() => setCreateMode("samples")}
              >
                From writing samples
              </button>
            </div>
          )}

          {view === "create" && createMode === "samples" && (
            <div className="samples-panel">
              <p className="subtle">
                Paste 1 to 3 examples of writing you want ArcNave to emulate.
                ArcNave will distill them into editable style instructions.
              </p>
              {samples.map((sample, idx) => (
                <div key={idx} className="sample-item">
                  <div className="sample-header">
                    <label htmlFor={`style-sample-${idx}`}>
                      Writing sample {idx + 1}
                    </label>
                    {samples.length > 1 && (
                      <button
                        type="button"
                        className="quiet-button"
                        aria-label={`Remove sample ${idx + 1}`}
                        onClick={() =>
                          setSamples((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <textarea
                    id={`style-sample-${idx}`}
                    rows={3}
                    maxLength={10000}
                    placeholder="Paste an excerpt, email, or document passage…"
                    value={sample}
                    onChange={(e) =>
                      setSamples((prev) =>
                        prev.map((val, i) => (i === idx ? e.target.value : val)),
                      )
                    }
                  />
                </div>
              ))}
              <div className="samples-toolbar">
                {samples.length < 3 && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setSamples((prev) => [...prev, ""])}
                  >
                    <Plus size={14} />
                    Add another sample
                  </button>
                )}
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleSummarize()}
                  disabled={summarizing || !samples.some((s) => s.trim())}
                >
                  {summarizing ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      Analyzing samples…
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      Generate style
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          <label className="field-label">
            Style name
            <input
              type="text"
              maxLength={60}
              placeholder="e.g. Executive Brief, Technical Deep-Dive"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="field-label">
            <span>
              Style instructions{" "}
              <span className="optional">
                ({instructions.length} / 4000 characters)
              </span>
            </span>
            <textarea
              rows={5}
              maxLength={4000}
              placeholder="Describe tone, structure, sentence length, and formatting preferences…"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>

          <div className="styles-form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                resetForm();
                setView("list");
              }}
              disabled={busy}
            >
              Back
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                void (view === "create" ? handleSaveCreate() : handleSaveEdit())
              }
              disabled={busy || !name.trim() || !instructions.trim()}
            >
              {busy ? "Saving…" : view === "create" ? "Save style" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
