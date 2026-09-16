import { useState } from "react";
import {
  Check,
  Download,
  Moon,
  Sun,
  Monitor,
  SlidersHorizontal,
  Palette,
  UserRound,
  Cpu,
  Telescope,
  Shield,
  Keyboard,
} from "lucide-react";
import { useWorkspace } from "./workspace";
import { Modal } from "./ui";
import type { Preferences } from "./types";
import { modelOptions } from "./types";
import { download } from "./storage";
const categories = [
  ["General", SlidersHorizontal],
  ["Appearance", Palette],
  ["Personalization", UserRound],
  ["Models", Cpu],
  ["Search & research", Telescope],
  ["Data & privacy", Shield],
  ["Keyboard shortcuts", Keyboard],
] as const;
export default function Settings() {
  const { data, setData, settings, setSettings, toast, fault, setFault } =
    useWorkspace();
  const [category, setCategory] = useState("General");
  const p = data.preferences;
  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setData((w) => ({ ...w, preferences: { ...w.preferences, [key]: value } }));
  const toggle = (
    label: string,
    desc: string,
    key: "enterToSend" | "reducedMotion" | "saveHistory",
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
        onClick={() => update(key, !p[key])}
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
                  <strong>Your name</strong>
                  <p>What should ArcNave call you?</p>
                </div>
                <input
                  aria-label="Your name"
                  value={p.name}
                  maxLength={40}
                  onChange={(e) => update("name", e.target.value)}
                />
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
                    update(
                      "defaultMode",
                      e.target.value as Preferences["defaultMode"],
                    )
                  }
                >
                  <option value="chat">Chat</option>
                  <option value="search">Search</option>
                  <option value="research">Research</option>
                </select>
              </div>
              <div className="settings-note">
                <strong>A local demonstration workspace</strong>
                <p>
                  Conversations use prepared responses. No AI provider, web
                  search service, or account is connected. Your files and work
                  are stored in this browser.
                </p>
              </div>
              <details className="demo-controls">
                <summary>Preview recovery states</summary>
                <p>
                  Apply one simulated failure to your next message. Retry clears
                  it.
                </p>
                <select
                  aria-label="Next response simulation"
                  value={fault || ""}
                  onChange={(e) =>
                    setFault((e.target.value as typeof fault) || undefined)
                  }
                >
                  <option value="">Normal response</option>
                  <option value="network">Network interruption</option>
                  <option value="generation">Generation failure</option>
                  <option value="research">Research failure</option>
                  <option value="partial">One source unavailable</option>
                  <option value="session">Session expired</option>
                  <option value="model">Model unavailable</option>
                  <option value="rate-limit">Rate limit</option>
                </select>
              </details>
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
                    onClick={() => update("theme", value)}
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
                    update("font", e.target.value as Preferences["font"])
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
          {category === "Personalization" && (
            <>
              <p className="section-description">
                A little context for future conversations.
              </p>
              <label className="field-label">
                Your preferences
                <textarea
                  rows={7}
                  placeholder="How would you like responses to be written?"
                  value={p.instructions}
                  onChange={(e) => update("instructions", e.target.value)}
                />
              </label>
              <p className="field-help">
                Saved for a future model connection. Prepared demo responses do
                not adapt to these instructions.
              </p>
            </>
          )}
          {category === "Models" && (
            <>
              <p className="section-description">
                Keep Auto selected, or choose a different demo playback speed.
              </p>
              {modelOptions.map((model) => (
                <button
                  key={model.name}
                  className={`model-option ${p.model === model.name ? "selected" : ""}`}
                  onClick={() => update("model", model.name)}
                  aria-pressed={p.model === model.name}
                >
                  <Cpu size={20} />
                  <span>
                    <strong>{model.name}</strong>
                    <small>{model.description}</small>
                  </span>
                  {p.model === model.name && <Check size={17} />}
                </button>
              ))}
              <p className="field-help">
                These are interface routing choices, not connected AI models.
              </p>
            </>
          )}
          {category === "Search & research" && (
            <>
              <div className="setting-row">
                <div>
                  <strong>Default source scope</strong>
                  <p>Filter the demo reference collection.</p>
                </div>
                <select
                  aria-label="Default source scope"
                  value={p.sourceScope}
                  onChange={(e) =>
                    update(
                      "sourceScope",
                      e.target.value as Preferences["sourceScope"],
                    )
                  }
                >
                  {["All sources", "Government", "Academic"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <div className="settings-note">
                <strong>Evidence before confidence</strong>
                <p>
                  Citations open the corresponding reference. Source type
                  describes the publication, not a reliability score. The
                  example collection was checked on 14 September 2026; the app
                  does not retrieve live sources.
                </p>
              </div>
            </>
          )}
          {category === "Data & privacy" && (
            <>
              <div className="settings-note">
                <strong>Your work stays in this browser</strong>
                <p>
                  Chats and preferences use local storage. Files use this
                  device’s browser database. Clearing browser data removes them.
                  There is no cloud synchronization or account authentication.
                </p>
              </div>
              {toggle(
                "Save conversation history",
                "When off, conversations will not survive a page reload. Projects and artifacts remain saved.",
                "saveHistory",
              )}
              <div className="setting-row">
                <div>
                  <strong>Export workspace</strong>
                  <p>
                    Download conversations, projects, and artifact text.
                    Uploaded file binaries are not included.
                  </p>
                </div>
                <button
                  className="button"
                  onClick={() => {
                    download(
                      JSON.stringify(data, null, 2),
                      "arcnave-workspace.json",
                      "application/json",
                    );
                    toast("Workspace exported");
                  }}
                >
                  <Download size={15} />
                  Export
                </button>
              </div>
            </>
          )}
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
          <p className="settings-saved">
            <Check size={13} />
            Preferences save automatically on this device
          </p>
        </section>
      </div>
    </Modal>
  );
}
