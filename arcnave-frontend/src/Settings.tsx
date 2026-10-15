/**
 * Settings, as the locked page (docs/brand/S5-Settings.dc.html, S5-Settings-Dark.dc.html,
 * S5-Settings-States.dc.html): a page in the white sheet with a section list on the left and one
 * section at a time on the right. Styles are in settings.css.
 *
 * The board's five sections are Profile, Appearance, Memory, Sign-in & devices and Data &
 * privacy. ArcNave adds Models, Usage & limits and Keyboard shortcuts, which the app already
 * had and the board does not draw; they use the same rows.
 *
 * Only what the server can do today is a control. A board row whose backend does not exist yet
 * (changing your name, 2-step verification, the list of signed-in devices, "Log out everywhere",
 * "Delete all chats", the language and text-size settings, the college rows) is either left out
 * or shown read-only with "Not available yet". Nothing here is a button that does nothing.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Brain,
  Check,
  Download,
  Gauge,
  KeyRound,
  Loader2,
  Moon,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Sun,
  Cpu,
  Copy,
  Keyboard,
  Info,
  Lock,
  Trash2,
  TriangleAlert,
  Upload,
  UserRound,
} from "lucide-react";
import { ApiError, api } from "./api";
import type { LimitsDto, MemoryExportDto, MemoryItemDto, ShareLinkDto, UsageSummaryDto } from "./api";
import { useSession } from "./session";
import { downloadAuthenticated } from "./storage";
import { useWorkspace } from "./workspace";
import { Modal } from "./ui";
import type { Preferences } from "./types";
import { formatCost } from "./formatCost";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserRound, board: true },
  { id: "appearance", label: "Appearance", icon: Palette, board: true },
  { id: "memory", label: "Memory", icon: Brain, board: true },
  { id: "signin", label: "Sign-in & devices", icon: KeyRound, board: true },
  { id: "models", label: "Models", icon: Cpu, board: false },
  { id: "usage", label: "Usage & limits", icon: Gauge, board: false },
  { id: "data", label: "Data & privacy", icon: Shield, board: true },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard, board: false },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]["id"];

/** The section list as the page shows it, in order. Exported so a test can pin it to the board. */
export const SETTINGS_SECTIONS = SECTIONS.map(({ id, label, board }) => ({ id, label, board }));

const isSection = (value: string | null): value is SettingsSection =>
  SECTIONS.some((s) => s.id === value);

const initialsOf = (name: string | undefined, email: string | undefined) => {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 2).toUpperCase();
};

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const wanted = params.get("section");
  const section: SettingsSection = isSection(wanted) ? wanted : "profile";
  const choose = (id: SettingsSection) => setParams(id === "profile" ? {} : { section: id }, { replace: true });

  useEffect(() => {
    const previous = document.title;
    document.title = "Settings — ArcNave";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="st-page">
      <h1 className="st-title">Settings</h1>
      <div className="st-body">
        <nav className="st-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label, icon: Glyph }) => (
            <button
              key={id}
              type="button"
              className={section === id ? "on" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => choose(id)}
            >
              <Glyph size={18} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <section className="st-content" aria-labelledby="st-heading">
          {section === "profile" && <ProfileSection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "memory" && <MemorySection />}
          {section === "signin" && <SignInSection />}
          {section === "models" && (
            <Head title="Models" sub="Which model answers. Auto routes by mode, attachments, and context size.">
              <Models />
            </Head>
          )}
          {section === "usage" && (
            <Head title="Usage & limits" sub="What you have used, in rupees first, and the limits you set.">
              <Usage />
            </Head>
          )}
          {section === "data" && <DataSection />}
          {section === "shortcuts" && <ShortcutsSection />}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ small parts */

function Head({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <>
      <h2 id="st-heading" className="st-h2">
        {title}
      </h2>
      {sub && <p className="st-sub">{sub}</p>}
      {children}
    </>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <h3 className="st-grp">{children}</h3>;
}

/** A settings row: what it is, what it does, and its control on the right. */
function Row({
  title,
  hint,
  children,
  stack = false,
}: {
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
  stack?: boolean;
}) {
  return (
    <div className={`st-row${stack ? " stack" : ""}`}>
      <div className="st-tx">
        <b>{title}</b>
        {hint && <span className="st-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Shown where the board has a row and the server has nothing behind it yet. Read-only. */
function NotYet({ children = "Not available yet" }: { children?: ReactNode }) {
  return (
    <span className="st-notyet">
      <Lock size={13} aria-hidden="true" />
      {children}
    </span>
  );
}

function Toggle({
  label,
  hint,
  field,
}: {
  label: string;
  hint: string;
  field: "enterToSend" | "reducedMotion" | "memoryEnabled" | "chatSearchEnabled";
}) {
  const { preferences: p, updatePreferences } = useWorkspace();
  return (
    <Row title={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={p[field]}
        className={`st-tgl${p[field] ? " on" : ""}`}
        onClick={() => updatePreferences({ [field]: !p[field] } as Partial<Preferences>)}
      />
    </Row>
  );
}

/* ------------------------------------------------------------------ profile */

function ProfileSection() {
  const { user } = useSession();
  const { preferences: p, updatePreferences } = useWorkspace();
  return (
    <Head title="Profile" sub="How you show up in arcnave.">
      <div className="st-who">
        <span className="st-bigav" aria-hidden="true">
          {initialsOf(user?.name, user?.email)}
        </span>
        <div>
          <div className="st-who-name">{user?.name || "No name set"}</div>
          <div className="st-who-mail">{user?.email}</div>
        </div>
      </div>

      <Group>About you</Group>
      <Row title="Full name" hint={<NotYet>Changing your name is not available yet</NotYet>}>
        <span className="st-ro">{user?.name || "No name set"}</span>
      </Row>
      <Row title="E-mail" hint={<NotYet>Your sign-in e-mail cannot be changed here</NotYet>}>
        <span className="st-ro st-mono">{user?.email}</span>
      </Row>
      <Instructions />

      <Group>In chat</Group>
      <Toggle label="Enter to send" hint="Use Shift + Enter to add a new line." field="enterToSend" />
      <Row title="Default conversation mode" hint="How a new conversation begins.">
        <select
          className="st-select"
          aria-label="Default conversation mode"
          value={p.defaultMode}
          onChange={(e) =>
            updatePreferences({ defaultMode: e.target.value as Preferences["defaultMode"] })
          }
        >
          <option value="chat">Chat</option>
          <option value="search">Search</option>
          <option value="research">Research</option>
        </select>
      </Row>
    </Head>
  );
}

/**
 * Custom instructions.
 *
 * Typed locally and saved explicitly. Saving on every keystroke would send one request per
 * character and make the optimistic-concurrency version fight itself.
 */
function Instructions() {
  const { preferences, updatePreferences } = useWorkspace();
  const [text, setText] = useState(preferences.instructions);
  useEffect(() => setText(preferences.instructions), [preferences.instructions]);
  const dirty = text !== preferences.instructions;
  return (
    <div className="st-row stack">
      <div className="st-tx">
        <label htmlFor="st-instructions">
          <b>Your standing instructions</b>
        </label>
        <span className="st-hint">
          Sent with every message as part of the system instructions. How would you like responses to
          be written?
        </span>
      </div>
      <textarea
        id="st-instructions"
        className="st-field st-area"
        rows={5}
        maxLength={20000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="st-actions">
        <button type="button" className="st-btn" disabled={!dirty} onClick={() => setText(preferences.instructions)}>
          Revert
        </button>
        <button
          type="button"
          className="st-btn primary"
          disabled={!dirty}
          onClick={() => updatePreferences({ instructions: text })}
        >
          Save instructions
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ appearance */

function ThemeMini({ value }: { value: "light" | "dark" | "system" }) {
  const half = (tone: "light" | "dark") => (
    <div className={`st-mini ${tone}`}>
      <i />
      <i />
    </div>
  );
  if (value === "system")
    return (
      <div className="st-mini-split">
        {half("light")}
        {half("dark")}
      </div>
    );
  return half(value);
}

function AppearanceSection() {
  const { preferences: p, updatePreferences } = useWorkspace();
  return (
    <Head title="Appearance" sub="How arcnave looks.">
      <Group>Theme</Group>
      <div className="st-thm" role="group" aria-label="Theme">
        {(
          [
            ["light", Sun, "Light"],
            ["dark", Moon, "Dark"],
            ["system", null, "Same as device"],
          ] as const
        ).map(([value, Glyph, label]) => (
          <button
            key={value}
            type="button"
            className={`st-thc${p.theme === value ? " on" : ""}`}
            aria-pressed={p.theme === value}
            onClick={() => updatePreferences({ theme: value })}
          >
            <ThemeMini value={value} />
            <b>
              {Glyph && <Glyph size={15} aria-hidden="true" />}
              {label}
              {p.theme === value && <Check size={15} aria-hidden="true" className="st-tick" />}
            </b>
          </button>
        ))}
      </div>

      <Group>Reading</Group>
      <Row title="Conversation font" hint="Choose how you like to read.">
        <select
          className="st-select"
          aria-label="Conversation font"
          value={p.font}
          onChange={(e) => updatePreferences({ font: e.target.value as Preferences["font"] })}
        >
          <option value="sans">Default</option>
          <option value="system">Match system</option>
          <option value="dyslexic">Dyslexic friendly</option>
        </select>
      </Row>

      <Group>Motion</Group>
      <Toggle
        label="Reduce motion"
        hint="Shows the still logo and keeps transitions and streaming understated. On by itself when your device asks for less motion."
        field="reducedMotion"
      />
    </Head>
  );
}

/* ------------------------------------------------------------------ memory */

/**
 * Memory, by topic (ADR-0025, board "Memory"). Every topic can be read, edited and forgotten,
 * and the person can add one. Forget and Reset each ask first, and say what goes.
 */
function MemorySection() {
  const { preferences: p, toast } = useWorkspace();
  const [memories, setMemories] = useState<MemoryItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; key: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [forgetting, setForgetting] = useState<MemoryItemDto | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = () => {
    setLoading(true);
    api.memory
      .list({ limit: 100 })
      .then((res) => setMemories(res.items))
      .catch(() => setError("Could not load memory."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const forget = async (item: MemoryItemDto) => {
    setBusyId(item.id);
    try {
      await api.memory.delete(item.id);
      setMemories((prev) => prev.filter((m) => m.id !== item.id));
      toast("Forgotten");
    } catch {
      setError("Could not delete that topic.");
    }
    setBusyId(null);
    setForgetting(null);
  };

  const exportMemory = async () => {
    try {
      const data = await api.memory.export();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "arcnave-memory.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not export memory.");
    }
  };

  const resetAll = async () => {
    setLoading(true);
    try {
      await api.memory.clearAll();
      setMemories([]);
      toast("Memory reset");
    } catch {
      setError("Could not clear memory.");
    }
    setLoading(false);
    setResetting(false);
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
      toast("Saved");
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "conflict"
          ? "That topic changed since you opened it. Reload and try again."
          : "Could not save that topic.",
      );
    }
    setBusyId(null);
  };

  return (
    <Head
      title="Memory"
      sub="What arcnave remembers about you, by topic. New chats start from it. You can edit or delete any topic."
    >
      {!p.memoryEnabled && (
        <div className="st-banner" role="status">
          <TriangleAlert size={18} aria-hidden="true" />
          Memory is paused. Nothing is read or saved until you turn it back on. What is saved stays below.
        </div>
      )}
      {/* The assistant is told it cannot switch these off and names them by these labels. */}
      <Toggle
        label="Use and update memory"
        hint="Chats read what is remembered about you and save what you ask them to. Off: nothing is read or saved; your memory stays below."
        field="memoryEnabled"
      />
      <Toggle
        label="Search and reference past chats"
        hint="Chats can search and open your earlier conversations when you refer to them."
        field="chatSearchEnabled"
      />

      <div className="st-saved-head">
        <h3 className="st-saved">Saved</h3>
        <span className="st-count" aria-live="polite">
          {loading ? "" : `${memories.length} ${memories.length === 1 ? "topic" : "topics"}`}
        </span>
        <span className="st-spacer" />
        <button type="button" className="st-btn" onClick={() => setEditing({ id: null, key: "", content: "" })}>
          <Plus size={14} aria-hidden="true" /> Add
        </button>
        <button type="button" className="st-btn" onClick={() => setImporting(true)}>
          <Upload size={14} aria-hidden="true" /> Import
        </button>
      </div>
      {error && (
        <p className="st-error" role="alert">
          {error}
        </p>
      )}
      <MemoryImport open={importing} onClose={() => setImporting(false)} onDone={load} />

      {editing && (
        <div className="st-card st-editor">
          <label className="st-label">
            Topic
            <input
              className="st-field"
              placeholder="Topic, e.g. Work"
              maxLength={200}
              value={editing.key}
              onChange={(e) => setEditing({ ...editing, key: e.target.value })}
            />
          </label>
          <label className="st-label">
            What to remember
            <textarea
              className="st-field st-area"
              rows={4}
              maxLength={20000}
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
            />
          </label>
          <div className="st-actions">
            <button type="button" className="st-btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="st-btn primary" disabled={busyId !== null} onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="loading-line">
          <Loader2 size={14} className="spin" />
          Loading memory…
        </p>
      ) : memories.length === 0 ? (
        <p className="st-empty">Nothing remembered yet.</p>
      ) : (
        <ul className="st-topics">
          {memories.map((m) => (
            <li key={m.id} className="st-card st-topic">
              <div className="st-topic-text">
                <b>
                  {m.key}
                  {m.scope === "project" && <span className="st-tag">project</span>}
                </b>
                <p>{m.content}</p>
              </div>
              <button
                type="button"
                className="st-ibt"
                aria-label={`Edit ${m.key}`}
                onClick={() => setEditing({ id: m.id, key: m.key, content: m.content })}
              >
                <Pencil size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="st-ibt"
                aria-label={`Forget ${m.key}`}
                disabled={busyId === m.id}
                onClick={() => setForgetting(m)}
              >
                {busyId === m.id ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="st-actions between">
        <button type="button" className="st-btn" disabled={memories.length === 0} onClick={() => void exportMemory()}>
          <Download size={14} aria-hidden="true" /> Export memory
        </button>
        <button type="button" className="st-btn danger" disabled={memories.length === 0 || loading} onClick={() => setResetting(true)}>
          <Trash2 size={14} aria-hidden="true" /> Reset memory
        </button>
      </div>

      <Modal
        open={forgetting !== null}
        onClose={() => setForgetting(null)}
        title="Forget this?"
      >
        {forgetting && (
          <>
            <div className="st-card st-topic-text">
              <b>{forgetting.key}</b>
              <p>{forgetting.content}</p>
            </div>
            <p className="st-dialog-text">
              arcnave stops using it. To bring it back, tell arcnave again.
            </p>
            <div className="st-actions">
              <button type="button" className="st-btn" onClick={() => setForgetting(null)}>
                Cancel
              </button>
              <button type="button" className="st-btn primary" onClick={() => void forget(forgetting)}>
                Forget
              </button>
            </div>
          </>
        )}
      </Modal>
      <Modal open={resetting} onClose={() => setResetting(false)} title="Reset all memory?">
        <p className="st-dialog-text">
          All {memories.length} {memories.length === 1 ? "topic is" : "topics are"} deleted, including
          things you asked arcnave to remember. Your chats stay.
        </p>
        <div className="st-banner info" role="note">
          <Info size={18} aria-hidden="true" />
          You can export your memory first.
        </div>
        <div className="st-actions">
          <button type="button" className="st-btn" onClick={() => void exportMemory()}>
            <Download size={14} aria-hidden="true" /> Export first
          </button>
          <button type="button" className="st-btn primary err" onClick={() => void resetAll()}>
            Reset memory
          </button>
        </div>
      </Modal>
    </Head>
  );
}

/** The request to paste into another assistant, so it lists what it remembers one per line. */
const IMPORT_REQUEST =
  "List everything you have stored about me in your memory, exactly as it is stored. " +
  "Put each item on its own line in the form: [date, if known] - the memory. Do not summarise or leave anything out.";

/**
 * Brings memory in (ADR-0040): text another assistant listed, one memory per line, or an
 * ArcNave memory export. What is already remembered is skipped.
 */
function MemoryImport({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useWorkspace();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (body: { text: string } | { data: MemoryExportDto }) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.memory.import(body);
      toast(`${r.added} added to memory${r.skipped ? `, ${r.skipped} already known or not stored` : ""}`);
      setText("");
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Those memories could not be added.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import memory" description="Bring what another assistant remembers about you, or an ArcNave memory export.">
      <ol className="import-steps">
        <li>
          Ask the other assistant this, and copy its answer.
          <div className="import-request">
            <p>{IMPORT_REQUEST}</p>
            <button
              className="button"
              onClick={() =>
                void navigator.clipboard.writeText(IMPORT_REQUEST).then(
                  () => toast("Request copied"),
                  () => toast("Clipboard unavailable. Select the text and copy it."),
                )
              }
            >
              <Copy size={13} /> Copy
            </button>
          </div>
        </li>
        <li>
          Paste the answer here. Each line becomes one memory.
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"[2026-01-04] - Prefers answers in Tamil\n- Works as a CA in Chennai"}
            aria-label="Memories to import"
          />
        </li>
      </ol>
      {error && <p className="source-warning">{error}</p>}
      <div className="dialog-actions">
        <label className="button">
          <Upload size={14} /> Import a file
          <input
            type="file"
            accept="application/json,.json,text/plain,.txt"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const content = await file.text();
              try {
                const parsed = JSON.parse(content) as MemoryExportDto;
                if (parsed && parsed.version === 1 && Array.isArray(parsed.items)) return void submit({ data: parsed });
              } catch {
                // Not JSON: read it as lines of text.
              }
              void submit({ text: content });
            }}
          />
        </label>
        <button className="button primary" disabled={busy || !text.trim()} onClick={() => void submit({ text })}>
          {busy && <Loader2 size={14} className="spin" />}
          Add to memory
        </button>
      </div>
    </Modal>
  );
}

/**
 * Models.
 *
 * The list comes from `GET /models`; the frontend ships no model table of its own. An alias that
 * is not configured is disabled with the server's reason attached, so "where did that model go"
 * never has to be asked.
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
const money = (usd: number | null, inr: number | null) =>
  formatCost(usd, inr) ?? "—";

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
        {summary.pricingConfigured ? money(totals.costUsd, totals.costInr) : "cost not priced"}
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
                <td>{summary.pricingConfigured ? money(row.costUsd, row.costInr) : "—"}</td>
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

/* ------------------------------------------------------------------ sign-in & devices */

/**
 * Sign-in & devices. What works today is signing out of this device and changing the password.
 * Two-step verification and the list of signed-in devices have no backend yet (Phase 5), so they
 * are named and marked "Not available yet" instead of drawn as controls.
 */
function SignInSection() {
  const { user, signOut } = useSession();
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  return (
    <Head title="Sign-in & devices" sub="How you sign in, and where you are signed in.">
      <Group>This device</Group>
      <Row title="Signed in as" hint={user?.email}>
        <button type="button" className="st-btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </Row>

      <Group>Password</Group>
      <form
        className="st-form"
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
              setError(failure instanceof ApiError ? failure.detail : "The password could not be changed."),
            )
            .finally(() => setBusy(false));
        }}
      >
        <p className="st-hint">
          Changing your password ends every session, including this one. You will be asked to sign in
          again.
        </p>
        {error && (
          <p className="st-error" role="alert">
            {error}
          </p>
        )}
        {message && <p className="st-hint">{message}</p>}
        <label className="st-label">
          Current password
          <input
            className="st-field"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label className="st-label">
          New password
          <input
            className="st-field"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <span className="st-hint">At least 12 characters.</span>
        </label>
        <div className="st-actions">
          <button type="submit" className="st-btn primary" disabled={busy || !current || !next}>
            {busy && <Loader2 size={14} className="spin" />}
            Change password
          </button>
        </div>
      </form>

      <Group>2-step verification</Group>
      <Row title="Ask for a second code" hint="A code from an authenticator app, after you sign in.">
        <NotYet />
      </Row>

      <Group>Signed-in devices</Group>
      <Row title="Where you are signed in" hint="A list of your devices, and a way to log out of all of them.">
        <NotYet />
      </Row>
    </Head>
  );
}

const DELETE_PHRASE = "delete my account";

/**
 * Deletes the account and everything in it (ADR-0040). It cannot be undone, so it needs the
 * password and the phrase typed out. (The board's "Ask admin" is for college-managed accounts;
 * ArcNave has no admin, so the person deletes their own.)
 */
function DeleteAccount() {
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="st-danger">
      <Row
        title="Delete my account"
        hint="Removes your conversations, projects, artifacts, files, memory and settings. This cannot be undone."
      >
        <button type="button" className="st-btn danger" onClick={() => setOpen(true)}>
          <Trash2 size={14} aria-hidden="true" /> Delete account
        </button>
      </Row>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        description="Everything in it is deleted and cannot be recovered. Export your data first if you want a copy."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            void api.account
              .delete(password)
              .then(() => signOut())
              .catch((e) => setError(e instanceof ApiError ? e.detail : "The account could not be deleted."))
              .finally(() => setBusy(false));
          }}
        >
          <label className="st-label">
            Type <strong>{DELETE_PHRASE}</strong> to confirm
            <input className="st-field" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
          </label>
          <label className="st-label">
            Password
            <input
              className="st-field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="st-error" role="alert">
              {error}
            </p>
          )}
          <div className="st-actions">
            <button type="button" className="st-btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              className="st-btn primary err"
              disabled={busy || phrase.trim().toLowerCase() !== DELETE_PHRASE || !password}
            >
              {busy && <Loader2 size={14} className="spin" />}
              Delete account
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ data & privacy */

function DataSection() {
  const { toast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  return (
    <Head title="Data & privacy" sub="Your chats, where they live, and how to remove them.">
      <div className="st-banner info" role="note">
        <Info size={18} aria-hidden="true" />
        <span>
          Conversations, projects, artifacts, uploaded files, and preferences are stored on the ArcNave
          server against your account. Prompts and uploaded text are sent to the configured model
          provider to produce a reply. This browser keeps only interface state: the theme, the sidebar
          width, and any unsaved artifact draft.
        </span>
      </div>

      <Group>Your data</Group>
      <ExportData />
      <div className="setting-row">
        <div>
          <strong>Export usage records</strong>
          <p>
            One CSV row per generation attempt, including cancellations and failures. An empty cost cell
            means no price is configured for that model, not zero.
          </p>
        </div>
        <a className="st-btn" href={api.usage.exportUrl()} download>
          <Download size={14} aria-hidden="true" />
          Export CSV
        </a>
      </div>
      <div className="setting-row">
        <div>
          <strong>Discard unsent uploads</strong>
          <p>
            Files you attached but never sent are kept so a reload does not lose them. This deletes them
            now.
          </p>
        </div>
        <button
          type="button"
          className="st-btn"
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

      <Group>Delete</Group>
      <DeleteAccount />
    </Head>
  );
}

/* ------------------------------------------------------------------ keyboard shortcuts */

function ShortcutsSection() {
  return (
    <Head title="Keyboard shortcuts">
      <div className="shortcuts st-shortcuts">
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
        <p className="st-hint">
          Note: In some browsers, Ctrl + Shift + C may open Developer Tools, or Ctrl + Shift + O may open
          Bookmarks.
        </p>
      </div>
    </Head>
  );
}

/** Everything the account holds, as a zip whose link lasts 24 hours (ADR-0040). */
function ExportData() {
  const { toast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  return (
    <div className="setting-row">
      <div>
        <strong>Export data</strong>
        <p>
          A zip of your conversations, artifacts, memory, projects and settings. Files you
          attached to chats are listed by name. The download link works for 24 hours.
        </p>
      </div>
      <button
        className="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api.account
            .export()
            .then((r) => downloadAuthenticated(r.downloadPath, `arcnave-export-${new Date().toISOString().slice(0, 10)}.zip`))
            .then(() => toast("Export downloaded"))
            .catch((e) => toast(e instanceof ApiError ? e.detail : "The export could not be made."))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
        Export data
      </button>
    </div>
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
