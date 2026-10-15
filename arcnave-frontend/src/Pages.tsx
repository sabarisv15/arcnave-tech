import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Bookmark,
  ChevronLeft,
  FileText,
  Folder,
  FolderClosed,
  Loader2,
  MessageCircleMore,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { ApiError, api } from "./api";
import { useWorkspace } from "./workspace";
import { Dropdown, EmptyState, IconButton, Modal } from "./ui";
import type { Artifact, Attachment, Project, SavedSource } from "./types";
import { toProjectFile, toSavedSource } from "./types";
import { ChatMenu } from "./Navigation";
import { ArtifactThumbnail } from "./ArtifactThumbnail";
import Composer from "./Composer";
import { Icon } from "./brand";
import { sizeLabel, validateFile } from "./storage";
import {
  ARTIFACT_KINDS,
  ArtifactTile,
  FileTile,
  PROJECT_TONES,
  SurfaceEmpty,
  Tile,
  type TileTone,
} from "./surfaces";

export const relativeDate = (time: string | null) =>
  time
    ? new Date(time).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

export function ChatsPage() {
  const { chats, projects } = useWorkspace();
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("Recent");
  const list = chats
    .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === "Recent"
        ? (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
        : a.title.localeCompare(b.title),
    );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR CONVERSATIONS</p>
          <h1>A thought worth keeping.</h1>
        </div>
        <Link className="button primary" to="/app">
          <Plus size={16} />
          New chat
        </Link>
      </div>
      <div className="list-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Filter chats"
            placeholder="Search conversation titles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Sort chats"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option>Recent</option>
          <option>Title</option>
        </select>
      </div>
      <div className="conversation-list">
        {list.map((c) => (
          <div className="conversation-list-row" key={c.id}>
            <Link to={`/chat/${c.id}`}>
              <MessageCircleMore size={19} />
              <span>
                <strong>{c.title}</strong>
                <small>
                  {c.projectId
                    ? (projects.find((p) => p.id === c.projectId)?.title ??
                      "Project")
                    : "Personal workspace"}
                </small>
              </span>
              <time>{relativeDate(c.updatedAt)}</time>
            </Link>
            <ChatMenu chat={c} />
          </div>
        ))}
      </div>
      {!list.length && (
        <EmptyState
          icon={<MessageCircleMore />}
          title={
            query ? "No matching conversations" : "Your first thought goes here"
          }
          description={
            query
              ? "Try another title."
              : "Start a conversation and return to it whenever you like."
          }
          action={
            !query && (
              <Link className="button primary" to="/app">
                Start a conversation
              </Link>
            )
          }
        />
      )}
    </div>
  );
}

/**
 * Project and artifact surfaces (Phase 1 item G4). Boards: BS-PartsA (projects list, new-project
 * dialog, empty project, library), BS-Project (project page). Styles: surfaces.css. A board item
 * with no backend behind it is not drawn: no project sharing, no member list, no storage meter.
 */

/** A project keeps its tile colour wherever it appears, so the tint comes from its id, not its position. */
const toneOf = (id: string): TileTone => {
  let sum = 0;
  for (const ch of id) sum = (sum + ch.charCodeAt(0)) % 9973;
  return PROJECT_TONES[sum % PROJECT_TONES.length]!;
};

function ProjectForm({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const { refreshProjects, toast } = useWorkspace();
  const navigate = useNavigate();
  const [title, setTitle] = useState(project?.title || ""),
    [description, setDescription] = useState(project?.description || ""),
    [instructions, setInstructions] = useState(project?.instructions || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <form
      className="sf-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        const work = project
          ? api.projects.patch(project.id, {
              title: title.trim(),
              description,
              instructions,
              version: project.version,
            })
          : api.projects.create({
              title: title.trim(),
              description,
              instructions,
            });
        void work
          .then(async (saved) => {
            await refreshProjects();
            onClose();
            if (!project) navigate(`/project/${saved.id}`);
            toast(project ? "Project updated" : "Project created");
          })
          .catch((failure) =>
            setError(
              failure instanceof ApiError
                ? failure.detail
                : "The project could not be saved.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      {error && (
        <p className="sf-form-error" role="alert">
          {error}
        </p>
      )}
      <label className="sf-label">
        Name
        <input
          className="sf-input"
          autoFocus
          placeholder="What are you working on?"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="sf-label">
        <span>
          What is it for? <span className="sf-optional">(optional)</span>
        </span>
        <textarea
          className="sf-input sf-textarea"
          placeholder="Timetable, lab batches, internals…"
          value={description}
          rows={2}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="sf-label">
        <span>
          Instructions <span className="sf-optional">(optional)</span>
        </span>
        <textarea
          className="sf-input sf-textarea"
          value={instructions}
          rows={3}
          placeholder="Tone, context, or preferences for this project…"
          onChange={(e) => setInstructions(e.target.value)}
        />
        <span className="sf-help">Added to every message sent inside this project.</span>
      </label>
      <div className="sf-dialog-actions">
        <button type="button" className="sf-gbtn" onClick={onClose}>
          Cancel
        </button>
        <button className="sf-pbtn" disabled={!title.trim() || busy}>
          {busy && <Loader2 size={14} className="spin" />}
          {project ? "Save changes" : "Create project"}
        </button>
      </div>
    </form>
  );
}

export function ProjectsPage() {
  const { projects, chats } = useWorkspace();
  const [create, setCreate] = useState(false),
    [query, setQuery] = useState("");
  const list = projects.filter((p) =>
    (p.title + " " + p.description).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="sf-page">
      <header className="sf-head">
        <div>
          <h1>Projects</h1>
          <p>Keep the context. Pick up where you left off.</p>
        </div>
        <button className="sf-pbtn" onClick={() => setCreate(true)}>
          <Icon icon={Plus} size={16} />
          New project
        </button>
      </header>
      <div className="sf-toolbar">
        <label className="sf-field">
          <Icon icon={Search} size={17} />
          <input
            aria-label="Find a project"
            placeholder="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {list.length > 0 && (
        <div className="sf-pgrid">
          {list.map((p) => {
            const chatCount =
              chats.filter((c) => c.projectId === p.id).length || p.counts.chats;
            return (
              <Link to={`/project/${p.id}`} className="sf-pcard" key={p.id}>
                <Tile tone={toneOf(p.id)}>
                  <Icon icon={Folder} size={18} />
                </Tile>
                <div>
                  <h2 className="sf-pcard-title">{p.title}</h2>
                  <p className="sf-pcard-desc">{p.description || "A fresh space for your next idea."}</p>
                </div>
                <p className="sf-pcard-meta">
                  <span>{p.counts.files} {p.counts.files === 1 ? "file" : "files"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{chatCount} {chatCount === 1 ? "chat" : "chats"}</span>
                  {p.updatedAt && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>updated {relativeDate(p.updatedAt)}</span>
                    </>
                  )}
                </p>
              </Link>
            );
          })}
          {!query && (
            <button className="sf-pcard sf-pnew" onClick={() => setCreate(true)}>
              <Icon icon={Plus} size={18} />
              New project
            </button>
          )}
        </div>
      )}
      {!list.length && (
        <SurfaceEmpty
          title={query ? "No matching projects" : "Give an idea its own space"}
          text={
            query
              ? "Try another name or description."
              : "Bring together conversations, files, and instructions. Answers in a project follow them."
          }
          actions={
            !query && (
              <button className="sf-pbtn" onClick={() => setCreate(true)}>
                <Icon icon={Plus} size={16} />
                Create a project
              </button>
            )
          }
        />
      )}
      <Modal
        open={create}
        onClose={() => setCreate(false)}
        title="New project"
        description="A little context makes it easier to keep going."
        className="sf-dialog"
      >
        <ProjectForm onClose={() => setCreate(false)} />
      </Modal>
    </div>
  );
}

/** One file of a project: tile, name (opens the preview once ready), what happened to it, and its two actions. */
function ProjectFileRow({
  file,
  onReindex,
  onRemove,
}: {
  file: Attachment;
  onReindex: () => void;
  onRemove: () => void;
}) {
  const { setPanel } = useWorkspace();
  const broken = file.status === "failed" || file.status === "unsupported";
  const busy = file.status === "uploading" || file.status === "indexing";
  const openable = file.status === "ready" && !!file.downloadUrl;
  const note = busy
    ? "Indexing…"
    : file.error
      ? file.error
      : file.status === "unsupported"
        ? "Stored, but no text could be read from it"
        : file.chunkCount !== undefined
          ? `${file.chunkCount} indexed chunk${file.chunkCount === 1 ? "" : "s"}`
          : file.hasText === false
            ? "No text"
            : "";
  return (
    <li className={`sf-frow ${broken ? "is-error" : ""}`}>
      <FileTile name={file.name} />
      <button
        type="button"
        className="sf-frow-main"
        disabled={!openable}
        onClick={() => setPanel({ kind: "file", file })}
        aria-label={`Open ${file.name}`}
      >
        <span className="sf-frow-name">{file.name}</span>
        {note && <span className="sf-frow-note">{busy && <Loader2 size={12} className="spin" />} {note}</span>}
      </button>
      <span className="sf-frow-size">{sizeLabel(file.size)}</span>
      <IconButton label={`Re-index ${file.name}`} disabled={!file.downloadUrl} onClick={onReindex}>
        <RefreshCw size={14} />
      </IconButton>
      <IconButton label={`Remove ${file.name} from project`} onClick={onRemove}>
        <X size={15} />
      </IconButton>
    </li>
  );
}

export function ProjectPage() {
  const { id } = useParams();
  const {
    projects,
    chats,
    artifacts,
    refreshProjects,
    refreshChats,
    toast,
    setPanel,
  } = useWorkspace();
  const p = projects.find((x) => x.id === id);
  const [editing, setEditing] = useState(false),
    [removing, setRemoving] = useState(false),
    [sort, setSort] = useState<"recent" | "az">("recent"),
    [files, setFiles] = useState<Attachment[]>([]),
    [sources, setSources] = useState<SavedSource[]>([]),
    [detail, setDetail] = useState<"loading" | "ready" | "missing">("loading");
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const project = await api.projects.read(id);
      setFiles(project.files.map(toProjectFile));
      setSources(project.sources.map(toSavedSource));
      setDetail("ready");
    } catch {
      setDetail("missing");
    }
  }, [id]);

  useEffect(() => {
    setDetail("loading");
    void load();
  }, [load]);

  if (detail === "missing" || (!p && detail === "ready"))
    return (
      <EmptyState
        icon={<FolderClosed />}
        title="Project not found"
        description="It may have been deleted, or it belongs to another account."
        action={
          <Link className="button" to="/projects">
            Go to projects
          </Link>
        }
      />
    );
  if (!p)
    return (
      <div className="panel-scroll loading-line">
        <Loader2 className="spin" size={16} />
        Loading this project…
      </div>
    );

  const projectChats = chats
      .filter((c) => c.projectId === id)
      .sort((a, b) =>
        sort === "recent"
          ? (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
          : a.title.localeCompare(b.title),
      ),
    arts = artifacts.filter((a) => a.projectId === id);

  /**
   * Upload straight into the project.
   *
   * Indexing happens inside the upload request, so the row that comes back already carries
   * its final status and chunk count — there is nothing to poll.
   */
  async function upload(list: FileList | null) {
    if (!list || !id) return;
    for (const f of Array.from(list)) {
      const problem = validateFile(f);
      const localId = `upload-${crypto.randomUUID()}`;
      setFiles((all) => [
        ...all,
        {
          id: localId,
          name: f.name,
          size: f.size,
          type: f.type,
          status: problem ? "unsupported" : "indexing",
          ...(problem ? { error: problem } : {}),
        },
      ]);
      if (problem) continue;
      try {
        const uploaded = await api.projects.upload(id, f);
        setFiles((all) =>
          all.map((x) => (x.id === localId ? toProjectFile(uploaded) : x)),
        );
        void refreshProjects();
      } catch (error) {
        setFiles((all) =>
          all.map((x) =>
            x.id === localId
              ? {
                  ...x,
                  status: "failed",
                  error:
                    error instanceof ApiError
                      ? error.detail
                      : "The upload failed. Try again.",
                }
              : x,
          ),
        );
      }
    }
  }

  const togglePin = () =>
    void api.projects
      .patch(p.id, { pinned: !p.pinned, version: p.version })
      .then(() => refreshProjects())
      .catch(() => toast("The project could not be updated."));

  return (
    <div className="sf-page sf-project">
      <div className="sf-project-main">
        <nav className="sf-crumb" aria-label="Breadcrumb">
          <Link to="/projects">
            <Icon icon={ChevronLeft} size={15} />
            All projects
          </Link>
        </nav>
        <header className="sf-phead">
          <Tile tone={toneOf(p.id)} size={48} className="sf-tile-lg">
            <Icon icon={Folder} size={24} />
          </Tile>
          <div className="sf-phead-text">
            <h1>{p.title}</h1>
            {p.description && <p>{p.description}</p>}
          </div>
          <div className="sf-phead-actions">
            <button
              type="button"
              className="sf-ibt"
              aria-label={p.pinned ? "Unpin project" : "Pin project"}
              aria-pressed={p.pinned}
              onClick={togglePin}
            >
              <Icon icon={Star} size={18} />
            </button>
            <Dropdown
              label="Project actions"
              align="end"
              trigger={
                <button className="sf-ibt" aria-label="Project actions">
                  <Icon icon={MoreHorizontal} size={18} />
                </button>
              }
              items={[
                {
                  label: "Edit project",
                  icon: <Pencil size={15} />,
                  onSelect: () => setEditing(true),
                },
                {
                  label: "Delete project",
                  icon: <Trash2 size={15} />,
                  danger: true,
                  onSelect: () => setRemoving(true),
                },
              ]}
            />
          </div>
        </header>
        <div className="sf-pcomposer">
          <Composer projectId={id} compact />
        </div>
        <section aria-labelledby="sf-chats-title">
          <div className="sf-chats-head">
            <h2 id="sf-chats-title">Chats in this project</h2>
            <span className="sf-count">{projectChats.length}</span>
            <div className="sf-seg" role="group" aria-label="Sort chats">
              <button className={sort === "recent" ? "on" : ""} aria-pressed={sort === "recent"} onClick={() => setSort("recent")}>
                Recent
              </button>
              <button className={sort === "az" ? "on" : ""} aria-pressed={sort === "az"} onClick={() => setSort("az")}>
                A–Z
              </button>
            </div>
          </div>
          {projectChats.length > 0 && (
            <ul className="sf-crows">
              {projectChats.map((c) => (
                <li className="sf-crow" key={c.id}>
                  <Link to={`/chat/${c.id}`}>
                    <Tile tone="g">
                      <Icon icon={MessageSquare} size={18} />
                    </Tile>
                    <span className="sf-crow-text">
                      <span className="sf-crow-title">{c.title}</span>
                      <span className="sf-crow-meta">{relativeDate(c.updatedAt)}</span>
                    </span>
                  </Link>
                  <ChatMenu chat={c} />
                </li>
              ))}
            </ul>
          )}
          {!projectChats.length && (
            <SurfaceEmpty
              as="h3"
              title="Nothing here yet"
              text="Add files and instructions. Everything for this project comes to one place, and answers here follow them. Your first chat begins in the box above."
              actions={
                <>
                  <button className="sf-gbtn" onClick={() => fileInput.current?.click()}>
                    <Icon icon={Plus} size={16} />
                    Add files
                  </button>
                  <button className="sf-pbtn" onClick={() => setEditing(true)}>
                    <Icon icon={Pencil} size={16} />
                    Write instructions
                  </button>
                </>
              }
            />
          )}
        </section>
      </div>

      <aside className="sf-side" aria-label="Project context">
        <section className="sf-sidecard" aria-labelledby="sf-instructions-title">
          <div className="sf-sidecard-head">
            <Icon icon={FileText} size={17} />
            <h2 id="sf-instructions-title">Instructions</h2>
            <button
              type="button"
              className="sf-ibt sf-ibt-sm"
              aria-label="Edit instructions"
              onClick={() => setEditing(true)}
            >
              <Icon icon={Pencil} size={15} />
            </button>
          </div>
          {p.instructions ? (
            <p className="sf-instructions">{p.instructions}</p>
          ) : (
            <p className="sf-side-empty">No instructions yet. Tell ArcNave how to work in this project.</p>
          )}
        </section>

        <section className="sf-sidecard" aria-labelledby="sf-files-title">
          <div className="sf-sidecard-head">
            <Icon icon={Paperclip} size={17} />
            <h2 id="sf-files-title">Files</h2>
            <span className="sf-count">{files.length}</span>
            <button
              type="button"
              className="sf-gbtn sf-gbtn-sm"
              onClick={() => fileInput.current?.click()}
            >
              <Icon icon={Plus} size={15} />
              Add
            </button>
          </div>
          {files.length > 0 ? (
            <>
              <ul className="sf-frows">
                {files.map((f) => (
                  <ProjectFileRow
                    key={f.id}
                    file={f}
                    onReindex={() => {
                      if (!id) return;
                      setFiles((all) =>
                        all.map((x) =>
                          x.id === f.id ? { ...x, status: "indexing" } : x,
                        ),
                      );
                      void api.projects
                        .reindex(id, f.id)
                        .then((updated) =>
                          setFiles((all) =>
                            all.map((x) =>
                              x.id === f.id ? toProjectFile(updated) : x,
                            ),
                          ),
                        )
                        .catch(() => {
                          toast("That file could not be re-indexed.");
                          void load();
                        });
                    }}
                    onRemove={() => {
                      if (!id) return;
                      void api.projects
                        .removeFile(id, f.id)
                        .then(() => {
                          setFiles((all) => all.filter((x) => x.id !== f.id));
                          void refreshProjects();
                        })
                        .catch(() => toast("That file could not be removed."));
                    }}
                  />
                ))}
              </ul>
              <p className="sf-side-note">
                {p.counts.indexedChunks} indexed chunks. Files are read and ranked against your questions in this project.
              </p>
            </>
          ) : (
            <p className="sf-side-empty">
              Add documents, spreadsheets, or code. Their text is indexed so answers in this project can draw on it.
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            aria-label="Project file upload"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </section>

        <section className="sf-sidecard" aria-labelledby="sf-made-title">
          <div className="sf-sidecard-head">
            <Icon icon={Sparkles} size={17} />
            <h2 id="sf-made-title">Made here</h2>
            <span className="sf-count">{arts.length}</span>
          </div>
          {arts.length > 0 ? (
            <ul className="sf-frows">
              {arts.map((a) => (
                <li className="sf-frow" key={a.id}>
                  <ArtifactTile kind={a.kind} />
                  <button
                    type="button"
                    className="sf-frow-main"
                    onClick={() => setPanel({ kind: "artifact", id: a.id })}
                  >
                    <span className="sf-frow-name">{a.title}</span>
                  </button>
                  <span className="sf-frow-size">{ARTIFACT_KINDS[a.kind].label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sf-side-empty">Nothing made here yet. Save a response as an artifact from a chat in this project.</p>
          )}
        </section>

        <section className="sf-sidecard" aria-labelledby="sf-sources-title">
          <div className="sf-sidecard-head">
            <Icon icon={Bookmark} size={17} />
            <h2 id="sf-sources-title">Saved sources</h2>
            <span className="sf-count">{sources.length}</span>
          </div>
          {sources.length > 0 ? (
            <ul className="sf-frows">
              {sources.map((s) => (
                <li className="sf-frow" key={s.id}>
                  <a className="sf-frow-main sf-frow-link" href={s.url} target="_blank" rel="noopener noreferrer">
                    <span className="sf-frow-name">{s.title}</span>
                    <span className="sf-frow-note">
                      {s.domain} · {s.type}
                    </span>
                  </a>
                  <IconButton
                    label={`Remove saved source ${s.title}`}
                    onClick={() => {
                      if (!id) return;
                      void api.projects
                        .removeSource(id, s.id)
                        .then(() => {
                          setSources((all) => all.filter((x) => x.id !== s.id));
                          void refreshProjects();
                        })
                        .catch(() => toast("That source could not be removed."));
                    }}
                  >
                    <X size={15} />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sf-side-empty">Save references from a conversation’s Sources panel to this project.</p>
          )}
        </section>
      </aside>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Project settings"
        className="sf-dialog"
      >
        <ProjectForm project={p} onClose={() => setEditing(false)} />
      </Modal>
      <Modal
        open={removing}
        onClose={() => setRemoving(false)}
        title="Delete this project?"
        description="The project, its uploaded files, and its saved sources are removed. Its conversations and artifacts stay in your workspace."
        className="sf-dialog"
      >
        <div className="sf-dialog-actions">
          <button className="sf-gbtn" onClick={() => setRemoving(false)}>
            Cancel
          </button>
          <button
            className="sf-pbtn sf-pbtn-danger"
            onClick={() => {
              if (!id) return;
              void api.projects
                .remove(id)
                .then(async () => {
                  await Promise.all([refreshProjects(), refreshChats()]);
                  setPanel({ kind: "closed" });
                  navigate("/projects");
                  toast("Project deleted; conversations kept");
                })
                .catch(() => toast("The project could not be deleted."));
            }}
          >
            Delete project
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** A Library card (BS-PartsA `.lcard`): the artifact drawn small above its name and where it came from. */
function ArtifactCard({ artifact: a }: { artifact: Artifact }) {
  const { setPanel, refreshArtifacts, toast, chats, projects } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  const sourceChat = chats.find((c) => c.id === a.chatId);
  const sourceProject = projects.find((p) => p.id === a.projectId);
  const meta = ARTIFACT_KINDS[a.kind];

  return (
    <li className="sf-lcard">
      <button type="button" className="sf-lcard-open" onClick={() => setPanel({ kind: "artifact", id: a.id })}>
        <span className="sf-lthumb">
          <ArtifactThumbnail
            artifact={a}
            fallback={
              <span className="sf-lthumb-fallback">
                <ArtifactTile kind={a.kind} size={44} />
              </span>
            }
          />
        </span>
        <span className="sf-lmeta">
          <b>{a.title}</b>
          <span>
            {meta.label} · version {a.currentVersion}
          </span>
          {sourceProject && <span>Project: {sourceProject.title}</span>}
          {sourceChat && <span>From chat: {sourceChat.title}</span>}
        </span>
      </button>
      <IconButton
        label={`Delete artifact ${a.title}`}
        className="delete-artifact sf-ldelete"
        onClick={() => setConfirm(true)}
      >
        <Trash2 size={14} />
      </IconButton>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete artifact?"
        description={`“${a.title}” and every saved version will be removed. Download a copy first if you want to keep it.`}
        className="sf-dialog"
      >
        <div className="sf-dialog-actions">
          <button className="sf-gbtn" onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button
            className="sf-pbtn sf-pbtn-danger"
            onClick={() => {
              void api.artifacts
                .remove(a.id)
                .then(async () => {
                  await refreshArtifacts();
                  setPanel({ kind: "closed" });
                  setConfirm(false);
                  toast("Artifact deleted");
                })
                .catch(() => toast("The artifact could not be deleted."));
            }}
          >
            Delete artifact
          </button>
        </div>
      </Modal>
    </li>
  );
}

const LIBRARY_KINDS: { value: string; label: string }[] = [
  { value: "All", label: "All" },
  { value: "document", label: "Documents" },
  { value: "slides", label: "Slides" },
  { value: "code", label: "Code" },
  { value: "webpage", label: "Webpages" },
  { value: "svg", label: "SVG" },
];

export function ArtifactsPage() {
  const { artifacts } = useWorkspace();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All"),
    [sourceFilter, setSourceFilter] = useState<"all" | "standalone" | "project">("all"),
    [creating, setCreating] = useState(false);

  const list = artifacts.filter((a) => {
    const matchesType = filter === "All" || a.kind === filter;
    const matchesQuery = a.title.toLowerCase().includes(query.toLowerCase());
    const matchesSource =
      sourceFilter === "all" ||
      (sourceFilter === "project" && Boolean(a.projectId)) ||
      (sourceFilter === "standalone" && !a.projectId);
    return matchesType && matchesQuery && matchesSource;
  });

  return (
    <div className="sf-page">
      <header className="sf-head">
        <div>
          <h1>Library</h1>
          <p>Everything ArcNave made, shown as itself.</p>
        </div>
        <button className="sf-pbtn" onClick={() => setCreating(true)}>
          <Icon icon={Plus} size={16} />
          New artifact
        </button>
      </header>
      <div className="sf-toolbar">
        <label className="sf-field">
          <Icon icon={Search} size={17} />
          <input
            aria-label="Find an artifact"
            placeholder="Find in Library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="sf-seg sf-seg-scroll" role="group" aria-label="Kind">
          {LIBRARY_KINDS.map((f) => (
            <button
              key={f.value}
              className={filter === f.value ? "on" : ""}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="sf-seg" role="group" aria-label="Made in">
          <button
            className={sourceFilter === "all" ? "on" : ""}
            aria-pressed={sourceFilter === "all"}
            onClick={() => setSourceFilter("all")}
          >
            All
          </button>
          <button
            className={sourceFilter === "project" ? "on" : ""}
            aria-pressed={sourceFilter === "project"}
            onClick={() => setSourceFilter("project")}
          >
            Project
          </button>
          <button
            className={sourceFilter === "standalone" ? "on" : ""}
            aria-pressed={sourceFilter === "standalone"}
            onClick={() => setSourceFilter("standalone")}
          >
            Standalone
          </button>
        </div>
      </div>
      {list.length > 0 && (
        <ul className="sf-lgrid" aria-label="Artifacts">
          {list.map((a) => (
            <ArtifactCard artifact={a} key={a.id} />
          ))}
        </ul>
      )}
      {!list.length && (
        <SurfaceEmpty
          title={query ? "No matching artifacts" : "Something worth making"}
          text={
            query
              ? "Try another name or type."
              : "Create a document, a code snippet, or a small webpage."
          }
          actions={
            <button className="sf-gbtn" onClick={() => setCreating(true)}>
              Create an artifact
            </button>
          }
        />
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New artifact"
        className="sf-dialog"
      >
        <div className="artifact-ai-create">
          <Composer compact artifactIntent />
        </div>
      </Modal>
    </div>
  );
}
