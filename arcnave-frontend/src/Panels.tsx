import { useCallback, useEffect, useRef, useState } from "react";
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
  History,
  Loader2,
  Pencil,
  Search,
  Telescope,
  X,
} from "lucide-react";
import { ApiError, api } from "./api";
import type { ArtifactVersionDto } from "./api";
import { useWorkspace } from "./workspace";
import { EmptyState, IconButton } from "./ui";
import { Markdown } from "./Content";
import type { Attachment, Source } from "./types";
import {
  canPreviewText,
  clearLocal,
  download,
  readLocal,
  sizeLabel,
  writeLocal,
} from "./storage";

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
  const { panel, setPanel, artifacts } = useWorkspace();
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
          ? (artifacts.find((a) => a.id === panel.id)?.title ?? "Artifact")
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
  const { panel, messages, projects, refreshProjects, toast } = useWorkspace();
  const [query, setQuery] = useState(""),
    [type, setType] = useState("All"),
    [sort, setSort] = useState("Citation order");
  const selected = useRef<HTMLDivElement>(null);
  const message =
    panel.kind === "sources"
      ? (messages[panel.chatId] ?? []).find((m) => m.id === panel.messageId)
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
      sort === "Retrieved"
        ? (b.retrievedAt || "").localeCompare(a.retrievedAt || "")
        : a.id - b.id,
    );

  const save = (s: Source, projectId: string) => {
    void api.projects
      .saveSource(projectId, {
        title: s.title,
        url: s.url,
        type: s.type,
        snippet: s.snippet,
        ...(s.retrievedAt ? { retrievedAt: s.retrievedAt } : {}),
      })
      .then(() => {
        void refreshProjects();
        toast("Source saved to project");
      })
      .catch((error) =>
        toast(
          error instanceof ApiError
            ? error.detail
            : "That source could not be saved.",
        ),
      );
  };

  return (
    <>
      <div className="panel-controls">
        <p className="panel-subtitle">
          {all.length} reference{all.length === 1 ? "" : "s"} returned with this
          answer
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
            <option>Retrieved</option>
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
            {s.unresolved ? (
              <span className="source-title">{s.title}</span>
            ) : (
              <a
                className="source-title"
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {s.title}
                <ArrowUpRight size={15} />
              </a>
            )}
            {s.retrievedAt && (
              <time className="source-date">
                Retrieved{" "}
                {new Date(s.retrievedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
            )}
            <p>{s.snippet}</p>
            {s.passage && <blockquote>{s.passage}</blockquote>}
            {s.unresolved && (
              <p className="source-warning">
                The provider cited this source but gave no resolvable address,
                so there is no link to open.
              </p>
            )}
            <div className="source-bottom">
              {!s.unresolved && (
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  Open original
                  <ArrowUpRight size={13} />
                </a>
              )}
              {projects.length > 0 && (
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
                    {projects.map((p) => (
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
  const { panel, messages } = useWorkspace();
  const message =
    panel.kind === "research"
      ? (messages[panel.chatId] ?? []).find((m) => m.id === panel.messageId)
      : undefined;
  const events = message?.events ?? [];
  return (
    <div className="panel-scroll research-panel">
      <div className="research-callout">
        <Telescope size={22} />
        <h3>An open view of the evidence</h3>
        <p>
          Each step below was reported by the model provider while the answer
          was produced.
        </p>
      </div>
      <ol className="research-timeline">
        {events.map((event, i) => (
          <li key={`${event.at ?? i}-${i}`}>
            <span className="timeline-node">
              <Check size={13} />
            </span>
            <strong>{event.label}</strong>
            <p>{event.detail}</p>
            {event.at && (
              <time className="source-date">
                {new Date(event.at).toLocaleTimeString()}
              </time>
            )}
          </li>
        ))}
      </ol>
      {!events.length &&
        !["submitting", "generating"].includes(message?.status || "") && (
          <p className="field-help">
            The provider reported no intermediate steps for this response.
          </p>
        )}
      {["submitting", "generating"].includes(message?.status || "") && (
        <p className="loading-line">
          <Loader2 size={16} className="spin" />
          Working…
        </p>
      )}
      {message?.status === "stopped" && (
        <p>
          Response stopped. Any references already returned are still listed.
        </p>
      )}
      {message?.status === "error" && (
        <p className="source-warning">
          The run was interrupted. Retry from the conversation.
        </p>
      )}
      {message?.modelAlias && (
        <p className="field-help">
          Answered by {message.modelAlias}
          {message.providerModelId ? ` (${message.providerModelId})` : ""}.
        </p>
      )}
    </div>
  );
}

/**
 * The artifact workspace.
 *
 * History is append-only on the server: saving writes a new version and moves the pointer,
 * and restoring an old version appends a copy of it rather than truncating. The panel mirrors
 * that — stepping back through versions is a read, and returning to one is an explicit
 * "Restore", so nothing is lost by browsing.
 *
 * The unsaved draft is kept in this browser only. It is not a version until it is saved, and
 * the footer says so rather than implying it synced.
 */
function ArtifactPanel({ id }: { id: string }) {
  const { artifacts, refreshArtifacts, toast } = useWorkspace();
  const meta = artifacts.find((a) => a.id === id);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [content, setContent] = useState("");
  const [readVersion, setReadVersion] = useState(0);
  const [concurrency, setConcurrency] = useState(0);
  const [versions, setVersions] = useState<ArtifactVersionDto[]>([]);
  const [currentVersion, setCurrentVersion] = useState(0);
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [failedPreview, setFailedPreview] = useState(false);
  const draftKey = `artifact-draft:${id}`;

  const load = useCallback(
    async (version?: number) => {
      try {
        const [artifact, history] = await Promise.all([
          api.artifacts.read(id, version),
          api.artifacts.versions(id),
        ]);
        setContent(artifact.content);
        setReadVersion(artifact.readVersion ?? artifact.currentVersion);
        setCurrentVersion(history.currentVersion);
        setConcurrency(artifact.version);
        setVersions(history.items);
        setState("ready");
      } catch {
        setState("failed");
      }
    },
    [id],
  );

  useEffect(() => {
    setState("loading");
    void load();
    const saved = readLocal(draftKey);
    if (saved !== null) {
      setDraft(saved);
      setTab("edit");
    }
  }, [load, draftKey]);

  if (state === "loading")
    return (
      <div className="panel-scroll loading-line">
        <Loader2 className="spin" size={16} />
        Loading artifact…
      </div>
    );
  if (state === "failed")
    return (
      <EmptyState
        icon={<FileText />}
        title="Artifact unavailable"
        description="It may have been deleted, or it belongs to another account."
        action={
          <button className="button" onClick={() => void load()}>
            Try again
          </button>
        }
      />
    );

  const kind = meta?.kind ?? "document";
  const viewingOld = readVersion !== currentVersion;
  const index = versions.findIndex((v) => v.version === readVersion);
  const older = index >= 0 ? versions[index + 1] : undefined;
  const newer = index > 0 ? versions[index - 1] : undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tab === "edit" ? draft : content);
      toast("Artifact copied");
    } catch {
      toast("Clipboard unavailable. Use Download to save a copy.");
    }
  };

  const save = () => {
    setSaving(true);
    void api.artifacts
      .addVersion(id, draft, concurrency)
      .then(async (saved) => {
        setContent(saved.content);
        setConcurrency(saved.version);
        clearLocal(draftKey);
        setTab("preview");
        await load();
        await refreshArtifacts();
        toast("New version saved");
      })
      .catch((error) =>
        toast(
          error instanceof ApiError
            ? error.detail
            : "The new version could not be saved.",
        ),
      )
      .finally(() => setSaving(false));
  };

  const restore = () => {
    setSaving(true);
    void api.artifacts
      .restore(id, readVersion, concurrency)
      .then(async (saved) => {
        setContent(saved.content);
        setConcurrency(saved.version);
        await load();
        await refreshArtifacts();
        toast(`Version ${readVersion} restored as a new version`);
      })
      .catch((error) =>
        toast(
          error instanceof ApiError
            ? error.detail
            : "That version could not be restored.",
        ),
      )
      .finally(() => setSaving(false));
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
            disabled={viewingOld}
            onClick={() => {
              setDraft(readLocal(draftKey) || content);
              setTab("edit");
            }}
          >
            {kind === "document" ? <Pencil size={13} /> : <Code2 size={13} />}
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
              `${meta?.title.replace(/[^a-z0-9 -]/gi, "") || "artifact"}.${
                kind === "webpage" ? "html" : kind === "code" ? "js" : "md"
              }`,
              kind === "webpage" ? "text/html" : "text/plain",
            )
          }
        >
          <ArrowDownToLine size={17} />
        </IconButton>
      </div>
      {viewingOld && (
        <div className="edit-notice">
          Viewing version {readVersion} of {currentVersion}.
          <button onClick={restore} disabled={saving}>
            Restore this version
          </button>
        </div>
      )}
      <div
        className={`artifact-content ${kind === "webpage" && tab === "preview" ? "web-preview" : ""}`}
      >
        {tab === "edit" ? (
          <>
            <textarea
              className="artifact-editor"
              aria-label="Edit artifact content"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                writeLocal(draftKey, e.target.value);
              }}
              spellCheck={false}
            />
            <p className="field-help">
              Unsaved drafts stay in this browser. Save a version to keep it on
              the server.
            </p>
            <div className="artifact-save">
              <button
                className="button"
                onClick={() => {
                  setDraft(content);
                  clearLocal(draftKey);
                  setTab("preview");
                }}
              >
                Discard draft
              </button>
              <button
                className="button primary"
                onClick={save}
                disabled={draft === content || saving}
              >
                {saving && <Loader2 size={14} className="spin" />}
                Save new version
              </button>
            </div>
          </>
        ) : kind === "webpage" ? (
          failedPreview ? (
            <EmptyState
              icon={<Code2 />}
              title="Preview could not load"
              description="The source is still available in Edit."
              action={
                <button
                  className="button"
                  onClick={() => setFailedPreview(false)}
                >
                  Retry preview
                </button>
              }
            />
          ) : (
            <iframe
              title={`${meta?.title ?? "Artifact"} preview`}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${content}`}
              onError={() => setFailedPreview(true)}
            />
          )
        ) : kind === "code" ? (
          <Markdown text={"```javascript\n" + content + "\n```"} />
        ) : (
          <Markdown text={content} />
        )}
      </div>
      <footer className="artifact-footer">
        <IconButton
          label="Older version"
          disabled={!older || tab === "edit"}
          onClick={() => older && void load(older.version)}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <span>
          Version {readVersion} of {currentVersion}
        </span>
        <IconButton
          label="Newer version"
          disabled={!newer || tab === "edit"}
          onClick={() => newer && void load(newer.version)}
        >
          <ChevronRight size={16} />
        </IconButton>
        <span className="spacer" />
        <span>
          <History size={13} /> {versions.length} saved
        </span>
      </footer>
    </>
  );
}

/**
 * File preview.
 *
 * The bytes live on the server behind an authenticated route, so everything here is fetched
 * with credentials and turned into a blob URL, which is revoked when the panel closes.
 */
function FilePanel({ file }: { file: Attachment }) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    blob?: Blob;
    text?: string;
    url?: string;
  }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let canceled = false;
    let url: string | undefined;
    setState({ status: "loading" });
    if (!file.downloadUrl) {
      setState({ status: "error" });
      return;
    }
    fetch(file.downloadUrl, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        const text = canPreviewText(file)
          ? await blob.slice(0, 200000).text()
          : undefined;
        url = URL.createObjectURL(blob);
        if (!canceled) setState({ status: "ready", blob, text, url });
      })
      .catch(() => {
        if (!canceled) setState({ status: "error" });
      });
    return () => {
      canceled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, attempt]);

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
        title="File unavailable"
        description="It could not be downloaded. It may have been deleted, or the storage backend may be unreachable."
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
        <span>
          {sizeLabel(file.size)}
          {file.hasText === false ? " · no text extracted" : ""}
        </span>
        <button
          className="button"
          onClick={() => state.blob && download(state.blob, file.name)}
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
            title="No preview for this format"
            description="Download it to open in its native application."
          />
        )}
      </div>
    </>
  );
}
