import { useEffect, useState } from "react";
import {
  Check,
  Download,
  Gauge,
  KeyRound,
  Loader2,
  Moon,
  Sun,
  Monitor,
  RefreshCw,
  SlidersHorizontal,
  Palette,
  UserRound,
  Cpu,
  Shield,
  Keyboard,
  TriangleAlert,
  Trash2,
  Plus,
  Pencil,
} from "lucide-react";
import { ApiError, api } from "./api";
import type { LimitsDto, MemoryItemDto, ShareLinkDto, UsageSummaryDto } from "./api";
import { useSession } from "./session";
import { useWorkspace } from "./workspace";
import { Modal } from "./ui";
import type { Preferences } from "./types";

const categories = [
  ["General", SlidersHorizontal],
  ["Appearance", Palette],
  ["Personalization", UserRound],
  ["Models", Cpu],
  ["Usage & limits", Gauge],
  ["Account", KeyRound],
  ["Data & privacy", Shield],
  ["Keyboard shortcuts", Keyboard],
] as const;

export default function Settings() {
  const {
    preferences: p,
    updatePreferences,
    settings,
    setSettings,
  } = useWorkspace();
  const [category, setCategory] = useState<string>("General");
  const { user } = useSession();

  const toggle = (
    label: string,
    desc: string,
    key: "enterToSend" | "reducedMotion",
  ) => (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <p>{desc}</p>
      </div>
      <button
        role="switch"
        aria-label={label}
        aria-checked={p[key]}
        className={`switch ${p[key] ? "on" : ""}`}
        onClick={() =>
          updatePreferences({ [key]: !p[key] } as Partial<Preferences>)
        }
      >
        <span />
      </button>
    </div>
  );

  return (
    <Modal
      open={settings}
      onClose={() => setSettings(false)}
      title="Settings"
      className="settings-modal"
    >
      <div className="settings-layout">
        <nav aria-label="Settings categories">
          {categories.map(([label, Icon]) => (
            <button
              key={label}
              className={category === label ? "active" : ""}
              onClick={() => setCategory(label)}
              aria-current={category === label ? "page" : undefined}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          <h2>{category}</h2>
          {category === "General" && (
            <>
              <div className="setting-row">
                <div>
                  <strong>Signed in as</strong>
                  <p>{user?.email}</p>
                </div>
                <span className="subtle">{user?.name || "No name set"}</span>
              </div>
              {toggle(
                "Enter to send",
                "Use Shift + Enter to add a new line.",
                "enterToSend",
              )}
              <div className="setting-row">
                <div>
                  <strong>Default conversation mode</strong>
                  <p>How a new conversation begins.</p>
                </div>
                <select
                  aria-label="Default conversation mode"
                  value={p.defaultMode}
                  onChange={(e) =>
                    updatePreferences({
                      defaultMode: e.target.value as Preferences["defaultMode"],
                    })
                  }
                >
                  <option value="chat">Chat</option>
                  <option value="search">Search</option>
                  <option value="research">Research</option>
                </select>
              </div>
            </>
          )}
          {category === "Appearance" && (
            <>
              <p className="section-description">
                Make this space comfortable for you.
              </p>
              <div className="theme-options">
                {(
                  [
                    ["light", Sun, "Light"],
                    ["dark", Moon, "Dark"],
                    ["system", Monitor, "System"],
                  ] as const
                ).map(([value, Icon, label]) => (
                  <button
                    key={value}
                    className={`theme-option ${p.theme === value ? "selected" : ""}`}
                    aria-pressed={p.theme === value}
                    onClick={() => updatePreferences({ theme: value })}
                  >
                    <div className={`theme-preview ${value}`}>
                      <span />
                      <i />
                      <i />
                    </div>
                    <span>
                      <Icon size={16} />
                      {label}
                      {p.theme === value && <Check size={15} />}
                    </span>
                  </button>
                ))}
              </div>
              <div className="setting-row">
                <div>
                  <strong>Conversation font</strong>
                  <p>Choose how you like to read.</p>
                </div>
                <select
                  aria-label="Conversation font"
                  value={p.font}
                  onChange={(e) =>
                    updatePreferences({
                      font: e.target.value as Preferences["font"],
                    })
                  }
                >
                  <option value="sans">Default</option>
                  <option value="system">Match system</option>
                  <option value="dyslexic">Dyslexic friendly</option>
                </select>
              </div>
              {toggle(
                "Reduce motion",
                "Keep transitions and streaming understated.",
                "reducedMotion",
              )}
            </>
          )}
          {category === "Personalization" && <Personalization />}
          {category === "Models" && <Models />}
          {category === "Usage & limits" && <Usage />}
          {category === "Account" && <Account />}
          {category === "Data & privacy" && <Privacy />}
          {category === "Keyboard shortcuts" && (
            <div className="shortcuts">
              {[
                ["New conversation", "Ctrl / ⌘ + Shift + O or Ctrl / ⌘ + K"],
                ["Search conversations", "Ctrl / ⌘ + P"],
                ["Copy last answer", "Ctrl / ⌘ + Shift + C"],
                ["Open settings", "Ctrl / ⌘ + ,"],
                ["Close an overlay", "Esc"],
                ["Send a message", "Enter"],
                ["New line", "Shift + Enter"],
                ["Send with Enter disabled", "Ctrl / ⌘ + Enter"],
                ["Browse menu options", "↑ / ↓"],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
              <p className="section-description" style={{ marginTop: "16px" }}>
                Note: In some browsers, Ctrl + Shift + C may open Developer Tools, or Ctrl + Shift + O may open Bookmarks.
              </p>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

/**
 * Custom instructions.
 *
 * Typed locally and saved explicitly. Saving on every keystroke would send one request per
 * character and make the optimistic-concurrency version fight itself.
 */
function Personalization() {
  const { preferences, updatePreferences } = useWorkspace();
  const [text, setText] = useState(preferences.instructions);
  useEffect(
    () => setText(preferences.instructions),
    [preferences.instructions],
  );
  const dirty = text !== preferences.instructions;
  return (
    <>
      <p className="section-description">
        A little context for future conversations.
      </p>
      <label className="field-label">
        Your standing instructions
        <textarea
          rows={5}
          maxLength={20000}
          placeholder="How would you like responses to be written?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="field-help">
        Sent with every message as part of the system instructions.
      </p>
      <div className="dialog-actions">
        <button
          className="button"
          disabled={!dirty}
          onClick={() => setText(preferences.instructions)}
        >
          Revert
        </button>
        <button
          className="button primary"
          disabled={!dirty}
          onClick={() => updatePreferences({ instructions: text })}
        >
          Save instructions
        </button>
      </div>

      <hr style={{ margin: "24px 0", borderColor: "var(--border-subtle, #333)" }} />

      <MemoryTopics />
    </>
  );
}

/**
 * Memory, by topic. As in Claude's settings, every topic can be read, edited and deleted, and the
 * user can add one themselves (ADR-0025).
 */
function MemoryTopics() {
  const [memories, setMemories] = useState<MemoryItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; key: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.memory
      .list({ limit: 100 })
      .then((res) => setMemories(res.items))
      .catch(() => setError("Could not load memory."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await api.memory.delete(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      setError("Could not delete that topic.");
    }
    setBusyId(null);
  };

  const clearAll = async () => {
    if (!window.confirm("Delete everything ArcNave remembers about you?")) return;
    setLoading(true);
    try {
      await api.memory.clearAll();
      setMemories([]);
    } catch {
      setError("Could not clear memory.");
    }
    setLoading(false);
  };

  const save = async () => {
    if (!editing || !editing.key.trim() || !editing.content.trim()) return;
    setBusyId(editing.id ?? "new");
    setError(null);
    try {
      const current = editing.id ? memories.find((m) => m.id === editing.id) : undefined;
      const item = current
        ? await api.memory.update(current.id, {
            expectedVersion: current.version,
            key: editing.key.trim(),
            content: editing.content.trim(),
          })
        : await api.memory.create({ key: editing.key.trim(), content: editing.content.trim() });
      setMemories((prev) => [item, ...prev.filter((m) => m.id !== item.id)]);
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "conflict"
        ? "That topic changed since you opened it. Reload and try again."
        : "Could not save that topic.");
    }
    setBusyId(null);
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div>
          <strong style={{ fontSize: "14px" }}>Memory</strong>
          <p className="field-help" style={{ margin: "2px 0 0" }}>
            What ArcNave remembers about you, by topic. New chats start from it. ArcNave adds to it as you
            chat; you can edit or delete any topic.
          </p>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <button className="button" style={{ fontSize: "12px" }} onClick={() => setEditing({ id: null, key: "", content: "" })}>
            <Plus size={12} /> Add
          </button>
          {memories.length > 0 && (
            <button className="button" style={{ fontSize: "12px", color: "var(--danger, #ff6b6b)" }} onClick={clearAll} disabled={loading}>
              Clear all
            </button>
          )}
        </div>
      </div>
      {error && <p className="field-help" style={{ color: "var(--danger, #ff6b6b)" }}>{error}</p>}
      {editing && (
        <div className="memory-editor" style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
          <input
            placeholder="Topic, e.g. Work"
            maxLength={200}
            value={editing.key}
            onChange={(e) => setEditing({ ...editing, key: e.target.value })}
          />
          <textarea
            rows={4}
            maxLength={20000}
            placeholder="What to remember"
            value={editing.content}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          />
          <div className="dialog-actions">
            <button className="button" onClick={() => setEditing(null)}>Cancel</button>
            <button className="button primary" disabled={busyId !== null} onClick={() => void save()}>Save</button>
          </div>
        </div>
      )}
      {loading ? (
        <p className="loading-line" style={{ fontSize: "13px" }}>
          <Loader2 size={14} className="spin" />
          Loading memory…
        </p>
      ) : memories.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--text-muted, #888)", fontStyle: "italic" }}>
          Nothing remembered yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "320px", overflowY: "auto" }}>
          {memories.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                padding: "8px 12px",
                borderRadius: "6px",
                background: "var(--bg-subtle, rgba(255,255,255,0.03))",
                border: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
                fontSize: "13px",
              }}
            >
              <div style={{ flex: 1, marginRight: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                  <strong style={{ fontSize: "12px" }}>{m.key}</strong>
                  {m.scope === "project" && (
                    <span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "4px", background: "rgba(255, 255, 255, 0.08)", color: "#aaa" }}>
                      project
                    </span>
                  )}
                </div>
                <p style={{ margin: 0, color: "var(--text, #eee)", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{m.content}</p>
              </div>
              <button
                className="button-icon"
                title="Edit this topic"
                onClick={() => setEditing({ id: m.id, key: m.key, content: m.content })}
                style={{ padding: "4px", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted, #888)" }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="button-icon"
                title="Delete this topic"
                disabled={busyId === m.id}
                onClick={() => void remove(m.id)}
                style={{ padding: "4px", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted, #888)" }}
              >
                {busyId === m.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Models.
 *
 * The list comes from `GET /models`; the frontend ships no model table of its own. An alias
 * that is not configured stays visible and selectable-looking is avoided — it is disabled with
 * the server's reason attached, so "where did that model go" never has to be asked.
 */
function Models() {
  const { preferences, updatePreferences } = useWorkspace();
  const { models, refreshModels } = useSession();
  const [busy, setBusy] = useState(false);

  if (!models)
    return (
      <p className="loading-line">
        <Loader2 size={16} className="spin" />
        Loading models…
      </p>
    );

  const options = [
    {
      alias: models.auto.alias,
      description: models.auto.description,
      available: models.auto.available,
      detail: models.auto.detail,
      providerModelId: null as string | null,
      provider: "",
    },
    ...models.models,
  ];

  return (
    <>
      <p className="section-description">
        Which model answers. Auto routes by mode, attachments, and context size.
      </p>
      {options.map((model) => (
        <button
          key={model.alias}
          className={`model-option ${preferences.modelAlias === model.alias ? "selected" : ""}`}
          onClick={() => updatePreferences({ modelAlias: model.alias })}
          disabled={!model.available}
          aria-pressed={preferences.modelAlias === model.alias}
        >
          <Cpu size={20} />
          <span>
            <strong>{model.alias}</strong>
            <small>
              {model.available ? model.description : model.detail}
              {model.available && model.providerModelId
                ? ` · ${model.providerModelId}`
                : ""}
            </small>
          </span>
          {preferences.modelAlias === model.alias && <Check size={17} />}
        </button>
      ))}
      <div className="settings-note">
        <strong>
          {models.capabilities.groundedSearch
            ? "Search and research are available"
            : "Search and research are unavailable"}
        </strong>
        <p>{models.capabilities.detail}</p>
      </div>
      <div className="setting-row">
        <div>
          <strong>Re-check availability</strong>
          <p>
            Sends one probe per alias to see which are reachable right now. This
            spends a small number of tokens.
          </p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api.models
              .refresh()
              .then(() => refreshModels(true))
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
        >
          {busy ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          Probe now
        </button>
      </div>
    </>
  );
}

const number = (value: number) => value.toLocaleString();
const money = (value: number | null) =>
  value === null ? "—" : `$${value.toFixed(4)}`;

/**
 * Usage & limits.
 *
 * Two rules the layout exists to keep: a null cost is rendered as "not priced" rather than
 * `$0.00`, and a budget that is not set says "no limit" rather than showing a full bar.
 */
function Usage() {
  const { refreshPreferences, toast } = useWorkspace();
  const [summary, setSummary] = useState<UsageSummaryDto | null>(null);
  const [limits, setLimits] = useState<
    (LimitsDto & { version: number }) | null
  >(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    maxOutputTokens: "",
    dailyTokenBudget: "",
    monthlyTokenBudget: "",
    warnThresholdPct: "",
    routingPreference: "balanced",
    timezone: "UTC",
  });

  const adopt = (next: LimitsDto & { version: number }) => {
    setLimits(next);
    setForm({
      maxOutputTokens: String(next.maxOutputTokens),
      dailyTokenBudget:
        next.dailyTokenBudget === null ? "" : String(next.dailyTokenBudget),
      monthlyTokenBudget:
        next.monthlyTokenBudget === null ? "" : String(next.monthlyTokenBudget),
      warnThresholdPct: String(next.warnThresholdPct),
      routingPreference: next.routingPreference,
      timezone: next.timezone,
    });
  };

  useEffect(() => {
    let live = true;
    Promise.all([api.usage.summary(), api.usage.limits()])
      .then(([s, l]) => {
        if (!live) return;
        setSummary(s);
        adopt(l);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed)
    return (
      <div className="error-card" role="alert">
        <TriangleAlert size={19} />
        <div>
          <strong>Usage could not be loaded</strong>
          <p>The server did not answer. Close settings and try again.</p>
        </div>
      </div>
    );
  if (!summary || !limits)
    return (
      <p className="loading-line">
        <Loader2 size={16} className="spin" />
        Reading your usage…
      </p>
    );

  const save = () => {
    setSaving(true);
    setError(null);
    const numeric = (value: string) => {
      const trimmed = value.trim();
      return trimmed === "" ? null : Number(trimmed);
    };
    void api.usage
      .setLimits({
        maxOutputTokens: Number(form.maxOutputTokens) || limits.maxOutputTokens,
        dailyTokenBudget: numeric(form.dailyTokenBudget),
        monthlyTokenBudget: numeric(form.monthlyTokenBudget),
        warnThresholdPct:
          Number(form.warnThresholdPct) || limits.warnThresholdPct,
        routingPreference: form.routingPreference,
        timezone: form.timezone,
        version: limits.version,
      })
      .then(async (saved) => {
        adopt(saved);
        setSummary(await api.usage.summary());
        // The limits write bumps the shared preferences version; re-read it so the next
        // Settings change is not refused as a conflict.
        await refreshPreferences();
        toast("Limits saved");
      })
      .catch((failure) =>
        setError(
          failure instanceof ApiError
            ? failure.detail
            : "Those limits could not be saved.",
        ),
      )
      .finally(() => setSaving(false));
  };

  const period = (label: string, totals: UsageSummaryDto["today"]) => (
    <div className="usage-period" key={label}>
      <p className="eyebrow">{label.toUpperCase()}</p>
      <strong>{number(totals.totalTokens)}</strong>
      <small>
        {number(totals.inputTokens)} in · {number(totals.outputTokens)} out ·{" "}
        {number(totals.requests)} request{totals.requests === 1 ? "" : "s"}
      </small>
      <small>
        {summary.pricingConfigured ? money(totals.costUsd) : "cost not priced"}
      </small>
    </div>
  );

  const bar = (
    label: string,
    used: number,
    budget: number | null,
    pct: number | null,
  ) => (
    <div className="usage-budget">
      <div className="usage-budget-head">
        <span>{label}</span>
        <span>
          {budget === null
            ? `${number(used)} used · no limit`
            : `${number(used)} of ${number(budget)}`}
        </span>
      </div>
      {budget !== null && (
        <div
          className="usage-meter"
          role="meter"
          aria-valuenow={Math.round(pct ?? 0)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <span style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="usage-periods">
        {period("Today", summary.today)}
        {period("This month", summary.month)}
        {period("All time", summary.allTime)}
      </div>

      {!summary.pricingConfigured && (
        <div className="settings-note">
          <strong>No pricing is configured</strong>
          <p>
            Costs are reported as unavailable rather than as zero. Set{" "}
            <code>PRICING_TABLE</code> on the server to see money figures.
          </p>
        </div>
      )}

      {limits.warnings.map((warning) => (
        <div className="error-card" role="status" key={warning}>
          <TriangleAlert size={19} />
          <div>
            <strong>Approaching a limit</strong>
            <p>{warning}</p>
          </div>
        </div>
      ))}

      {bar("Today", limits.dailyUsed, limits.dailyTokenBudget, limits.dailyPct)}
      {bar(
        "This month",
        limits.monthlyUsed,
        limits.monthlyTokenBudget,
        limits.monthlyPct,
      )}
      <p className="field-help">
        Daily resets {new Date(limits.dailyResetsAt).toLocaleString()} · monthly
        resets {new Date(limits.monthlyResetsAt).toLocaleString()} (
        {limits.timezone}).
      </p>

      {summary.byModel.length > 0 && (
        <table className="usage-table">
          <caption className="sr-only">Tokens by model</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Requests</th>
              <th scope="col">Tokens</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {summary.byModel.map((row) => (
              <tr key={row.key ?? "unknown"}>
                <td>{row.key ?? "Unattributed"}</td>
                <td>{number(row.requests)}</td>
                <td>{number(row.totalTokens)}</td>
                <td>{summary.pricingConfigured ? money(row.costUsd) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="project-section-title">Limits</h3>
      {error && <p className="source-warning">{error}</p>}
      <label className="field-label">
        Maximum output tokens per response
        <input
          type="number"
          min={1}
          value={form.maxOutputTokens}
          onChange={(e) =>
            setForm({ ...form, maxOutputTokens: e.target.value })
          }
        />
      </label>
      <label className="field-label">
        Daily token budget <span className="optional">Blank for no limit</span>
        <input
          type="number"
          min={1}
          value={form.dailyTokenBudget}
          onChange={(e) =>
            setForm({ ...form, dailyTokenBudget: e.target.value })
          }
        />
      </label>
      <label className="field-label">
        Monthly token budget{" "}
        <span className="optional">Blank for no limit</span>
        <input
          type="number"
          min={1}
          value={form.monthlyTokenBudget}
          onChange={(e) =>
            setForm({ ...form, monthlyTokenBudget: e.target.value })
          }
        />
      </label>
      <label className="field-label">
        Warn at
        <input
          type="number"
          min={1}
          max={100}
          value={form.warnThresholdPct}
          onChange={(e) =>
            setForm({ ...form, warnThresholdPct: e.target.value })
          }
        />
        <span className="field-help">
          Percent of a budget before ArcNave warns you.
        </span>
      </label>
      <label className="field-label">
        Routing preference
        <select
          value={form.routingPreference}
          onChange={(e) =>
            setForm({ ...form, routingPreference: e.target.value })
          }
        >
          <option value="economy">
            Economy — prefer the cheapest capable model
          </option>
          <option value="balanced">Balanced</option>
          <option value="quality">Quality — prefer the strongest model</option>
        </select>
        <span className="field-help">
          Used by Auto. Ignored when you pick a model yourself.
        </span>
      </label>
      <label className="field-label">
        Time zone
        <input
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          placeholder="Europe/London"
        />
        <span className="field-help">
          An IANA name. Budget periods reset at midnight in this zone.
        </span>
      </label>
      <div className="dialog-actions">
        <button
          className="button"
          onClick={() => adopt(limits)}
          disabled={saving}
        >
          Revert
        </button>
        <button className="button primary" onClick={save} disabled={saving}>
          {saving && <Loader2 size={14} className="spin" />}
          Save limits
        </button>
      </div>
    </>
  );
}

function Account() {
  const { user, signOut } = useSession();
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="setting-row">
        <div>
          <strong>Account</strong>
          <p>{user?.email}</p>
        </div>
        <button className="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      <h3 className="project-section-title">Change password</h3>
      <p className="field-help">
        Changing your password ends every session, including this one. You will
        be asked to sign in again.
      </p>
      {error && <p className="source-warning">{error}</p>}
      {message && <p className="field-help">{message}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setMessage(null);
          void api.auth
            .changePassword(current, next)
            .then(() => {
              setMessage("Password changed. Sign in again to continue.");
              setCurrent("");
              setNext("");
              // The server already cleared the cookie; make the UI agree.
              void signOut();
            })
            .catch((failure) =>
              setError(
                failure instanceof ApiError
                  ? failure.detail
                  : "The password could not be changed.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <label className="field-label">
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label className="field-label">
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <span className="field-help">At least 12 characters.</span>
        </label>
        <div className="dialog-actions">
          <button
            className="button primary"
            disabled={busy || !current || !next}
          >
            {busy && <Loader2 size={14} className="spin" />}
            Change password
          </button>
        </div>
      </form>
    </>
  );
}

function Privacy() {
  const { toast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="settings-note">
        <strong>Where your work lives</strong>
        <p>
          Conversations, projects, artifacts, uploaded files, and preferences
          are stored on the ArcNave server against your account. Prompts and
          uploaded text are sent to the configured model provider to produce a
          reply. This browser keeps only interface state: the theme, the sidebar
          width, and any unsaved artifact draft.
        </p>
      </div>
      <div className="setting-row">
        <div>
          <strong>Export usage records</strong>
          <p>
            One CSV row per generation attempt, including cancellations and
            failures. An empty cost cell means no price is configured for that
            model, not zero.
          </p>
        </div>
        <a className="button" href={api.usage.exportUrl()} download>
          <Download size={15} />
          Export CSV
        </a>
      </div>
      <div className="setting-row">
        <div>
          <strong>Discard unsent uploads</strong>
          <p>
            Files you attached but never sent are kept so a reload does not lose
            them. This deletes them now.
          </p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api.files
              .cleanup()
              .then((result) =>
                toast(
                  result.deleted
                    ? `${result.deleted} unsent upload${result.deleted === 1 ? "" : "s"} discarded`
                    : "There were no unsent uploads",
                ),
              )
              .catch(() => toast("Those uploads could not be discarded."))
              .finally(() => setBusy(false));
          }}
        >
          {busy && <Loader2 size={14} className="spin" />}
          Discard
        </button>
      </div>
      <SharedLinks />
    </>
  );
}

/** Every public link this account has made, each with a way to turn it off (ADR-0039). */
function SharedLinks() {
  const { toast } = useWorkspace();
  const [links, setLinks] = useState<ShareLinkDto[] | null>(null);
  useEffect(() => {
    api.share
      .list()
      .then((r) => setLinks(r.items))
      .catch(() => setLinks([]));
  }, []);
  return (
    <div className="setting-row setting-row-stack">
      <div>
        <strong>Shared links</strong>
        <p>
          Anyone with one of these links can view its snapshot without an
          account. Turning a link off stops it opening at once, but cannot
          remove copies someone already made.
        </p>
      </div>
      {links === null ? (
        <p className="loading-line">
          <Loader2 size={14} className="spin" /> Loading…
        </p>
      ) : links.length === 0 ? (
        <p className="field-help">You have not shared anything.</p>
      ) : (
        <ul className="shared-links">
          {links.map((l) => (
            <li key={l.id}>
              <a href={l.path} target="_blank" rel="noreferrer">
                {l.title}
              </a>
              <span className="field-help">
                {l.targetType === "chat" ? "Chat" : "Artifact"} ·{" "}
                {l.snapshotAt ? new Date(l.snapshotAt).toLocaleDateString() : ""}
              </span>
              <button
                className="button"
                onClick={() =>
                  void api.share
                    .revoke(l.id)
                    .then(() => {
                      setLinks((all) => (all ?? []).filter((x) => x.id !== l.id));
                      toast("Link turned off");
                    })
                    .catch(() => toast("That link could not be turned off."))
                }
              >
                Stop sharing
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
