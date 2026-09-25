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
} from "lucide-react";
import { ApiError, api } from "./api";
import type { LimitsDto, MemoryItemDto, UsageSummaryDto } from "./api";
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
                  <option value="sans">Sans serif</option>
                  <option value="serif">Serif</option>
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
                ["New conversation", "Ctrl / ⌘ + K"],
                ["Search conversations", "Ctrl / ⌘ + P"],
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
  const [memories, setMemories] = useState<MemoryItemDto[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadMemories = () => {
    setLoadingMemories(true);
    api.memory
      .list()
      .then((res) => setMemories(res.items))
      .catch(() => {})
      .finally(() => setLoadingMemories(false));
  };

  useEffect(() => {
    loadMemories();
  }, []);

  const handleDeleteMemory = async (id: string) => {
    setDeletingId(id);
    try {
      await api.memory.delete(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {}
    setDeletingId(null);
  };

  const handleClearAll = async () => {
    if (!window.confirm("Are you sure you want to delete all stored persistent memories?")) return;
    setLoadingMemories(true);
    try {
      await api.memory.clearAll();
      setMemories([]);
    } catch {}
    setLoadingMemories(false);
  };

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div>
          <strong style={{ fontSize: "14px" }}>Persistent Memories</strong>
          <p className="field-help" style={{ margin: "2px 0 0" }}>
            Durable preferences, constraints, and facts remembered across chats.
          </p>
        </div>
        {memories.length > 0 && (
          <button
            className="button"
            style={{ fontSize: "12px", color: "var(--danger, #ff6b6b)" }}
            onClick={handleClearAll}
            disabled={loadingMemories}
          >
            Clear all
          </button>
        )}
      </div>

      {loadingMemories ? (
        <p className="loading-line" style={{ fontSize: "13px" }}>
          <Loader2 size={14} className="spin" />
          Loading memories…
        </p>
      ) : memories.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--text-muted, #888)", fontStyle: "italic" }}>
          No memories stored yet. ArcNave remembers durable preferences when instructed (e.g. &quot;remember that...&quot;).
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "260px", overflowY: "auto" }}>
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
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 5px",
                      borderRadius: "4px",
                      background: m.isStanding ? "rgba(76, 175, 80, 0.2)" : "rgba(33, 150, 243, 0.2)",
                      color: m.isStanding ? "#81c784" : "#64b5f6",
                    }}
                  >
                    {m.isStanding ? "Standing" : "Retrieved"}
                  </span>
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "1px 5px",
                      borderRadius: "4px",
                      background: "rgba(255, 255, 255, 0.08)",
                      color: "#aaa",
                    }}
                  >
                    {m.scope}
                  </span>
                </div>
                <p style={{ margin: 0, color: "var(--text, #eee)", wordBreak: "break-word" }}>{m.content}</p>
              </div>
              <button
                className="button-icon"
                title="Forget this memory"
                disabled={deletingId === m.id}
                onClick={() => handleDeleteMemory(m.id)}
                style={{ padding: "4px", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted, #888)" }}
              >
                {deletingId === m.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
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
    </>
  );
}
