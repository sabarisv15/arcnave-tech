import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Brain,
  ChevronRight,
  FilePlus2,
  FileSearch,
  FileText,
  Globe,
  ImageIcon,
  LayoutPanelTop,
  Search,
  Table2,
  Target,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { ToolCall } from "./types";

interface Verb {
  icon: LucideIcon;
  running: string;
  done: string;
  failed: string;
  /** How the collapsed summary counts it: "ran" + "a command" / "4 commands". */
  past: string;
  one: string;
  many: string;
}

const verb = (
  icon: LucideIcon,
  running: string,
  done: string,
  past: string,
  one: string,
  many: string,
): Verb => {
  const noun = one.replace(/^(a|an|the) /, "");
  return { icon, running, done, failed: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} failed`, past, one, many };
};

const VERBS: Record<string, Verb> = {
  run_python: verb(Terminal, "Running command", "Ran command", "ran", "a command", "commands"),
  load_skill: verb(BookOpen, "Loading skill", "Loaded skill", "loaded", "a skill", "skills"),
  read_skill: verb(BookOpen, "Loading skill", "Loaded skill", "loaded", "a skill", "skills"),
  list_skills: verb(BookOpen, "Listing skills", "Listed skills", "listed", "skills", "skills"),
  search_skills: verb(Search, "Finding a skill", "Found a skill", "searched", "skills", "skills"),
  search_tools: verb(Wrench, "Finding tools", "Found tools", "looked up", "tools", "tools"),
  read_uploaded_file: verb(FileText, "Reading file", "Read file", "read", "a file", "files"),
  read_project_file: verb(FileText, "Reading project file", "Read project file", "read", "a project file", "project files"),
  search_project_files: verb(FileSearch, "Searching project files", "Searched project files", "searched", "project files", "project files"),
  generate_deliverable: verb(FilePlus2, "Creating file", "Created file", "created", "a file", "files"),
  create_artifact: verb(FilePlus2, "Creating artifact", "Created artifact", "created", "an artifact", "artifacts"),
  read_artifact: verb(FileText, "Reading artifact", "Read artifact", "read", "an artifact", "artifacts"),
  update_artifact: verb(FilePlus2, "Updating artifact", "Updated artifact", "updated", "an artifact", "artifacts"),
  web_search: verb(Globe, "Searching the web", "Searched the web", "searched", "the web", "the web"),
  web_fetch: verb(Globe, "Fetching page", "Fetched page", "fetched", "a page", "pages"),
  generate_image: verb(ImageIcon, "Generating image", "Generated image", "generated", "an image", "images"),
  extract_scanned_table_rows: verb(Table2, "Extracting table", "Extracted table", "extracted", "a table", "tables"),
  analyze_table_rows: verb(Table2, "Analysing table", "Analysed table", "analysed", "a table", "tables"),
  save_memory: verb(Brain, "Saving to memory", "Saved to memory", "saved", "a memory", "memories"),
  search_chats: verb(Search, "Searching past chats", "Searched past chats", "searched", "past chats", "past chats"),
  read_memory: verb(Brain, "Checking memory", "Checked memory", "checked", "memory", "memory"),
  search_memory: verb(Brain, "Searching memory", "Searched memory", "searched", "memory", "memory"),
  update_memory: verb(Brain, "Updating memory", "Updated memory", "updated", "memory", "memory"),
  forget_memory: verb(Brain, "Updating memory", "Updated memory", "updated", "memory", "memory"),
  get_goal: verb(Target, "Checking goal", "Checked goal", "checked", "the goal", "the goal"),
  update_goal: verb(Target, "Updating goal", "Updated goal", "updated", "the goal", "the goal"),
  render_ui: verb(LayoutPanelTop, "Building view", "Built view", "built", "a view", "views"),
};

function verbFor(name: string): Verb {
  const known = VERBS[name];
  if (known) return known;
  const readable = name.replaceAll("_", " ");
  return verb(Wrench, `Using ${readable}`, `Used ${readable}`, "used", readable, readable);
}

/** The label the live status line shows for one call. */
export function toolStepLabel(call: ToolCall): string {
  const v = verbFor(call.name);
  return call.ok === undefined ? v.running : call.ok ? v.done : v.failed;
}

/** "Loaded a skill, ran 4 commands, created a file": each tool once, in first-use order. */
export function summariseToolCalls(calls: ToolCall[]): string {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  // Two tools that read the same ("Loaded a skill") merge rather than repeat.
  const phrases = new Map<string, number>();
  const order: string[] = [];
  for (const [name, n] of counts) {
    const v = verbFor(name);
    const key = `${v.past}|${v.one}|${v.many}`;
    if (!phrases.has(key)) order.push(key);
    phrases.set(key, (phrases.get(key) ?? 0) + n);
  }
  const text = order
    .map((key) => {
      const [past, one, many] = key.split("|");
      const n = phrases.get(key)!;
      return `${past} ${n === 1 || one === many ? one : `${n} ${many}`}`;
    })
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** An animated spark, shown while the turn is working. */
export function WorkingSpark({ active }: { active: boolean }) {
  return (
    <svg
      className={`working-spark ${active ? "is-active" : ""}`}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
    >
      {[0, 45, 90, 135].map((deg) => (
        <rect key={deg} x="11" y="2" width="2" height="20" rx="1" transform={`rotate(${deg} 12 12)`} />
      ))}
    </svg>
  );
}

function stepDetail(call: ToolCall): { input: string; output: string } {
  const input =
    call.input && typeof call.input === "object" && typeof (call.input as { code?: unknown }).code === "string"
      ? (call.input as { code: string }).code
      : call.input === undefined
        ? ""
        : JSON.stringify(call.input, null, 2);
  const output =
    call.content?.map((c) => (c.type === "text" ? c.text : JSON.stringify(c.data))).join("\n") ??
    call.preview ??
    "";
  return { input, output };
}

function Step({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const running = call.ok === undefined;
  const Icon = call.ok === false ? X : verbFor(call.name).icon;
  const { input, output } = stepDetail(call);
  const expandable = !running && (input || output);
  return (
    <li className={`activity-step ${running ? "is-running" : ""} ${call.ok === false ? "is-failed" : ""}`}>
      <span className="activity-step-icon" aria-hidden="true">
        <Icon size={13} />
      </span>
      <div className="activity-step-body">
        <button
          type="button"
          className="activity-step-label"
          onClick={() => expandable && setOpen((v) => !v)}
          aria-expanded={expandable ? open : undefined}
          disabled={!expandable}
        >
          <span className={running ? "shimmer-text" : ""}>{toolStepLabel(call)}</span>
          {expandable && <ChevronRight size={12} className={open ? "activity-chevron open" : "activity-chevron"} />}
        </button>
        {open && (
          <div className="activity-step-detail">
            {input && <pre>{input}</pre>}
            {output && <pre className="activity-output">{output}</pre>}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The turn's tool calls as one activity block: while the turn works it is open and names the
 * step in progress; once the answer arrives it folds into a one-line summary that expands.
 */
export default function ToolActivity({
  calls,
  working,
  answering,
}: {
  calls: ToolCall[];
  /** The turn has not finished. */
  working: boolean;
  /** Answer text has started to arrive. */
  answering: boolean;
}) {
  const visible = calls.filter((c) => c.name !== "render_ui" && c.name !== "ask_user_options");
  const live = working && !answering;
  const [open, setOpen] = useState(live);
  useEffect(() => setOpen(live), [live]);
  const [seconds, setSeconds] = useState(1);
  useEffect(() => {
    if (!live) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000))), 500);
    return () => window.clearInterval(timer);
  }, [live]);

  if (visible.length === 0) return null;
  const current = [...visible].reverse().find((c) => c.ok === undefined);
  const headline = live && current ? toolStepLabel(current) : summariseToolCalls(visible);

  return (
    <div className={`tool-activity ${live ? "is-live" : ""}`}>
      <button type="button" className="tool-activity-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <WorkingSpark active={live} />
        <span className={live ? "shimmer-text" : ""}>{headline}</span>
        {live && <time>{seconds}s</time>}
        <ChevronRight size={13} className={open ? "activity-chevron open" : "activity-chevron"} />
      </button>
      {open && (
        <ol className="activity-steps">
          {visible.map((call, i) => (
            <Step key={`${call.toolCallId}-${i}`} call={call} />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The line a thought summary shows when folded, as Claude shows one line per stretch of
 * thinking: its latest "**Heading**", else its first sentence.
 */
export function thoughtHeadline(text: string): string {
  const headings = [...text.matchAll(/\*\*([^*\n]+)\*\*/g)].map((m) => m[1]!.trim());
  if (headings.length > 0) return headings.at(-1)!;
  const first = text.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
}

/** A thought summary's text with its "**Heading**" lines shown as headings. */
function ThoughtText({ text }: { text: string }) {
  return (
    <div className="thinking-text">
      {text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => {
          const heading = /^\*\*([^*]+)\*\*$/.exec(p);
          return heading ? <strong key={i}>{heading[1]}</strong> : <p key={i}>{p.replaceAll("**", "")}</p>;
        })}
    </div>
  );
}

/**
 * One stretch of the model's thinking, as Claude shows it: a single line naming what it is
 * thinking about (live while it thinks), which opens to the full summary.
 */
export function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  // Claude's app shows "a 'Thinking' indicator with a timer" while it thinks (Help Center).
  const [seconds, setSeconds] = useState(1);
  useEffect(() => {
    if (!live) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000))), 500);
    return () => window.clearInterval(timer);
  }, [live]);
  if (!text.trim()) return null;
  const headline = thoughtHeadline(text) || "Thinking";
  return (
    <div className={`tool-activity thinking-block ${live ? "is-live" : ""}`}>
      <button type="button" className="tool-activity-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Brain size={14} aria-hidden="true" />
        <span className={live ? "shimmer-text" : ""}>{headline}</span>
        {live && <time>{seconds}s</time>}
        <ChevronRight size={13} className={open ? "activity-chevron open" : "activity-chevron"} />
      </button>
      {open && <ThoughtText text={text} />}
    </div>
  );
}
