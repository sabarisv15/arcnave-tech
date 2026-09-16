import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Expand,
  FileText,
  Globe2,
  Loader2,
  Pencil,
  Search,
  Telescope,
  X,
} from "lucide-react";
import { useWorkspace } from "./workspace";
import { EmptyState, IconButton } from "./ui";
import { Markdown } from "./Content";
import type { Attachment, Source } from "./types";
import { canPreviewText, download, readFile, sizeLabel } from "./storage";
export function useMobile(query = "(max-width: 1050px)") {
  const [mobile, setMobile] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const update = () => setMobile(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [query]);
  return mobile;
}
export default function ContextPanel() {
  const { panel, setPanel, data } = useWorkspace();
  const overlay = useMobile();
  const [expanded, setExpanded] = useState(false);
  const [width, setWidth] = useState(400);
  const [resize, setResize] = useState(false);
  const title =
    panel.kind === "sources"
      ? "Sources"
      : panel.kind === "research"
        ? "Research details"
        : panel.kind === "artifact"
          ? data.artifacts.find((a) => a.id === panel.id)?.title || "Artifact"
          : panel.kind === "file"
            ? panel.file.name
            : "";
  useEffect(() => {
    setExpanded(false);
  }, [panel.kind]);
  useEffect(() => {
    if (panel.kind === "closed") return;
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !document.querySelector('[role="dialog"], [role="menu"]')
      )
        setPanel({ kind: "closed" });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [panel.kind, setPanel]);
  if (panel.kind === "closed") return null;
  const content = (
    <>
      <header className="panel-header">
        <h2>{title}</h2>
        <div className="spacer" />
        {panel.kind === "artifact" && !overlay && (
          <IconButton
            label={expanded ? "Restore panel size" : "Expand artifact"}
            onClick={() => setExpanded(!expanded)}
          >
            <Expand size={16} />
          </IconButton>
        )}
        <IconButton
          label="Close context panel"
          onClick={() => setPanel({ kind: "closed" })}
        >
          <X size={18} />
        </IconButton>
      </header>
      {panel.kind === "sources" ? (
        <SourcesPanel />
      ) : panel.kind === "research" ? (
        <ResearchPanel />
      ) : panel.kind === "artifact" ? (
        <ArtifactPanel key={panel.id} id={panel.id} />
      ) : (
        <FilePanel file={panel.file} />
      )}
    </>
  );
  if (overlay || expanded)
    return (
      <Dialog.Root
        open
        onOpenChange={(open) => !open && setPanel({ kind: "closed" })}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content
            className={`context-panel panel-overlay ${expanded ? "expanded-panel" : ""}`}
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            {content}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  return (
    <aside className="context-panel" style={{ width }} aria-label={title}>
      <div
        role="separator"
        aria-label="Resize context panel"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={600}
        aria-valuenow={width}
        tabIndex={0}
        className={`panel-resizer ${resize ? "resizing" : ""}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setWidth((w) => Math.min(600, w + 20));
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            setWidth((w) => Math.max(320, w - 20));
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setResize(true);
        }}
        onPointerMove={(e) => {
          if (resize)
            setWidth(
              Math.max(320, Math.min(600, window.innerWidth - e.clientX)),
            );
        }}
        onPointerUp={() => setResize(false)}
        onPointerCancel={() => setResize(false)}
      />
      {content}
    </aside>
  );
}
function SourcesPanel() {
  const { panel, data, setData, toast } = useWorkspace();
  const [query, setQuery] = useState(""),
    [type, setType] = useState("All"),
    [sort, setSort] = useState("Citation order");
  const selected = useRef<HTMLDivElement>(null);
  const message =
    panel.kind === "sources"
      ? data.chats
          .find((c) => c.id === panel.chatId)
          ?.messages.find((m) => m.id === panel.messageId)
      : undefined;
  const all = message?.sources || [];
  const selectedId = panel.kind === "sources" ? panel.selected : undefined;
  useEffect(() => {
    setQuery("");
    setType("All");
  }, [selectedId]);
  useEffect(() => {
    selected.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId, query, type]);
  const filtered = all
    .filter(
      (s) =>
        (type === "All" || s.type === type) &&
        `${s.title} ${s.domain} ${s.snippet}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "Publication date"
        ? (b.date || "").localeCompare(a.date || "")
        : a.id - b.id,
    );
  const save = (s: Source, projectId: string) => {
    setData((w) => ({
      ...w,
      projects: w.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              savedSources: p.savedSources.some((x) => x.url === s.url)
                ? p.savedSources
                : [...p.savedSources, s],
            }
          : p,
      ),
    }));
    toast("Source saved to project");
  };
  return (
    <>
      <div className="panel-controls">
        <p className="panel-subtitle">
          {all.length} references · Curated example
        </p>
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Filter sources"
            placeholder="Find in sources…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="source-filters">
          <select
            aria-label="Source type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option>All</option>
            {[...new Set(all.map((s) => s.type))].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Sort sources"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option>Citation order</option>
            <option>Publication date</option>
          </select>
        </div>
      </div>
      <div className="panel-scroll">
        {filtered.map((s) => (
          <div
            ref={selectedId === s.id ? selected : undefined}
            className={`source-card ${selectedId === s.id ? "selected" : ""}`}
            key={s.id}
            tabIndex={0}
          >
            <div className="source-meta">
              <span className="source-number">{s.id}</span>
              <span className="source-domain">{s.domain}</span>
              <span className="source-type">{s.type}</span>
            </div>
            <a
              className="source-title"
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {s.title}
              <ArrowUpRight size={15} />
            </a>
            {s.date && (
              <time className="source-date">
                {new Date(s.date).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
            )}
            <p>{s.snippet}</p>
            {s.passage && <blockquote>{s.passage}</blockquote>}
            {s.unavailable && (
              <p className="source-warning">
                Preview unavailable in this example. Try the original
                publication.
              </p>
            )}
            <div className="source-bottom">
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                Open original
                <ArrowUpRight size={13} />
              </a>
              {data.projects.length > 0 && (
                <label className="save-source">
                  <Bookmark size={13} />
                  <select
                    aria-label={`Save source ${s.id} to project`}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) save(s, e.target.value);
                    }}
                  >
                    <option value="">Save to project</option>
                    {data.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        ))}
        {!filtered.length && (
          <EmptyState
            icon={<Globe2 size={24} />}
            title={all.length ? "No matching sources" : "No sources yet"}
            description={
              all.length
                ? "Try another phrase or source type."
                : "References appear here when a response provides them."
            }
          />
        )}
      </div>
    </>
  );
}
function ResearchPanel() {
  const { panel, data } = useWorkspace();
  const message =
    panel.kind === "research"
      ? data.chats
          .find((c) => c.id === panel.chatId)
          ?.messages.find((m) => m.id === panel.messageId)
      : undefined;
  return (
    <div className="panel-scroll research-panel">
      <div className="research-callout">
        <Telescope size={22} />
        <h3>An open view of the evidence</h3>
        <p>
          Demo replay. These events describe loading prepared content, not a
          live investigation.
        </p>
      </div>
      <ol className="research-timeline">
        {message?.events?.map((event, i) => (
          <li key={`${event.at}-${i}`}>
            <span className="timeline-node">
              <Check size={13} />
            </span>
            <strong>{event.label}</strong>
            <p>{event.detail}</p>
          </li>
        ))}
      </ol>
      {["submitting", "generating"].includes(message?.status || "") && (
        <p className="loading-line">
          <Loader2 size={16} className="spin" />
          Loading the example…
        </p>
      )}
      {message?.status === "stopped" && (
        <p>Response stopped. Loaded references are still available.</p>
      )}
      {message?.status === "error" && (
        <p className="source-warning">
          The workflow was interrupted. Retry from the conversation.
        </p>
      )}
      <p className="field-help">
        Source counts reflect records actually loaded by the adapter. A future
        live service can emit searching, reading, and synthesis events through
        the same interface.
      </p>
    </div>
  );
}
function ArtifactPanel({ id }: { id: string }) {
  const { data, setData, toast } = useWorkspace();
  const artifact = data.artifacts.find((a) => a.id === id);
  const [tab, setTab] = useState<"preview" | "edit">(
      artifact?.draft !== undefined ? "edit" : "preview",
    ),
    [draft, setDraft] = useState(
      artifact?.draft ?? artifact?.versions[artifact.version] ?? "",
    );
  const [failed, setFailed] = useState(false);
  if (!artifact)
    return (
      <EmptyState
        icon={<FileText />}
        title="Artifact unavailable"
        description="This artifact may have been removed."
      />
    );
  const content = artifact.versions[artifact.version];
  const changeVersion = (version: number) => {
    setData((w) => ({
      ...w,
      artifacts: w.artifacts.map((a) => (a.id === id ? { ...a, version } : a)),
    }));
    setDraft(artifact.versions[version]);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tab === "edit" ? draft : content);
      toast("Artifact copied");
    } catch {
      toast("Clipboard unavailable. Use Download to save a copy.");
    }
  };
  const save = () => {
    setData((w) => ({
      ...w,
      artifacts: w.artifacts.map((a) =>
        a.id === id
          ? {
              ...a,
              versions: [...a.versions, draft],
              version: a.versions.length,
              draft: undefined,
              updatedAt: Date.now(),
            }
          : a,
      ),
    }));
    setTab("preview");
    toast("New version saved");
  };
  return (
    <>
      <div className="artifact-toolbar">
        <div className="segmented" aria-label="Artifact view">
          <button
            className={tab === "preview" ? "active" : ""}
            aria-pressed={tab === "preview"}
            onClick={() => setTab("preview")}
          >
            Preview
          </button>
          <button
            className={tab === "edit" ? "active" : ""}
            aria-pressed={tab === "edit"}
            onClick={() => {
              setDraft(artifact.draft ?? content);
              setTab("edit");
            }}
          >
            {artifact.kind === "document" ? (
              <Pencil size={13} />
            ) : (
              <Code2 size={13} />
            )}
            Edit
          </button>
        </div>
        <span className="spacer" />
        <IconButton label="Copy artifact" onClick={() => void copy()}>
          <Copy size={16} />
        </IconButton>
        <IconButton
          label="Download artifact"
          onClick={() =>
            download(
              content,
              `${artifact.title.replace(/[^a-z0-9 -]/gi, "") || "artifact"}.${artifact.kind === "webpage" ? "html" : artifact.kind === "code" ? "js" : "md"}`,
              artifact.kind === "webpage" ? "text/html" : "text/plain",
            )
          }
        >
          <ArrowDownToLine size={17} />
        </IconButton>
      </div>
      <div
        className={`artifact-content ${artifact.kind === "webpage" && tab === "preview" ? "web-preview" : ""}`}
      >
        {tab === "edit" ? (
          <>
            <textarea
              className="artifact-editor"
              aria-label="Edit artifact content"
              value={draft}
              onChange={(e) => {
                const value = e.target.value;
                setDraft(value);
                setData((w) => ({
                  ...w,
                  artifacts: w.artifacts.map((a) =>
                    a.id === id ? { ...a, draft: value } : a,
                  ),
                }));
              }}
              spellCheck={false}
            />
            <p className="field-help">
              Draft saved automatically on this device.
            </p>
            <div className="artifact-save">
              <button
                className="button"
                onClick={() => {
                  setDraft(content);
                  setData((w) => ({
                    ...w,
                    artifacts: w.artifacts.map((a) =>
                      a.id === id ? { ...a, draft: undefined } : a,
                    ),
                  }));
                  setTab("preview");
                }}
              >
                Cancel
              </button>
              <button
                className="button primary"
                onClick={save}
                disabled={draft === content}
              >
                Save new version
              </button>
            </div>
          </>
        ) : artifact.kind === "webpage" ? (
          failed ? (
            <EmptyState
              icon={<Code2 />}
              title="Preview could not load"
              description="The source is still available in Edit."
              action={
                <button className="button" onClick={() => setFailed(false)}>
                  Retry preview
                </button>
              }
            />
          ) : (
            <iframe
              title={`${artifact.title} preview`}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${content}`}
              onError={() => setFailed(true)}
            />
          )
        ) : artifact.kind === "code" ? (
          <Markdown text={"```javascript\n" + content + "\n```"} />
        ) : (
          <Markdown text={content} />
        )}
      </div>
      <footer className="artifact-footer">
        <IconButton
          label="Previous artifact version"
          disabled={artifact.version === 0 || tab === "edit"}
          onClick={() => changeVersion(artifact.version - 1)}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <span>
          Version {artifact.version + 1} of {artifact.versions.length}
        </span>
        <IconButton
          label="Next artifact version"
          disabled={
            artifact.version === artifact.versions.length - 1 || tab === "edit"
          }
          onClick={() => changeVersion(artifact.version + 1)}
        >
          <ChevronRight size={16} />
        </IconButton>
        <span className="spacer" />
        <span>Saved on this device</span>
      </footer>
    </>
  );
}
function FilePanel({ file }: { file: Attachment }) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    file?: File;
    text?: string;
    url?: string;
  }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let canceled = false;
    let url: string | undefined;
    setState({ status: "loading" });
    readFile(file.id)
      .then(async (f) => {
        if (!f) throw Error("missing");
        const text = canPreviewText(file)
          ? await f.slice(0, 200000).text()
          : undefined;
        url = URL.createObjectURL(f);
        if (!canceled) setState({ status: "ready", file: f, text, url });
      })
      .catch(() => {
        if (!canceled) setState({ status: "error" });
      });
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.id, attempt]);
  if (state.status === "loading")
    return (
      <div className="panel-scroll loading-line">
        <Loader2 className="spin" />
        Loading file…
      </div>
    );
  if (state.status === "error")
    return (
      <EmptyState
        icon={<FileText />}
        title="File unavailable on this device"
        description="The file may have been cleared from browser storage. Reattach it to restore access."
        action={
          <button className="button" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        }
      />
    );
  return (
    <>
      <div className="file-meta">
        <span>{sizeLabel(file.size)} · Local file</span>
        <button
          className="button"
          onClick={() => state.file && download(state.file, file.name)}
        >
          <ArrowDownToLine size={14} />
          Download
        </button>
      </div>
      <div className="panel-scroll file-content">
        {file.type.startsWith("image/") ? (
          <img alt={file.name} src={state.url} />
        ) : state.text !== undefined ? (
          <>
            <pre>{state.text}</pre>
            {file.size > 200000 && (
              <p className="field-help">
                Preview limited to the first 200 KB. Download for the complete
                file.
              </p>
            )}
          </>
        ) : file.type === "application/pdf" ? (
          <iframe title={`Preview ${file.name}`} src={state.url} />
        ) : (
          <EmptyState
            icon={<FileText size={28} />}
            title="Your file is ready"
            description="This format is stored securely in your browser. Download it to view in its native app. A document extraction service is not connected."
          />
        )}
      </div>
    </>
  );
}
