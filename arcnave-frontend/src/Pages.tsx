import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpRight,
  Bookmark,
  Code2,
  FileText,
  FolderClosed,
  Loader2,
  MessageCircleMore,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { ApiError, api } from "./api";
import { useWorkspace } from "./workspace";
import { Dropdown, EmptyState, IconButton, Modal } from "./ui";
import type { Artifact, Attachment, Project, SavedSource } from "./types";
import { toProjectFile, toSavedSource } from "./types";
import { ChatMenu } from "./Navigation";
import Composer, { AttachmentChip } from "./Composer";
import { validateFile } from "./storage";

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
        <Link className="button primary" to="/">
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
              <Link className="button primary" to="/">
                Start a conversation
              </Link>
            )
          }
        />
      )}
    </div>
  );
}

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
      {error && <p className="source-warning">{error}</p>}
      <label className="field-label">
        Project name
        <input
          autoFocus
          placeholder="What are you working on?"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="field-label">
        Description
        <textarea
          placeholder="A little context about what you want to achieve."
          value={description}
          rows={3}
          maxLength={2000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="field-label">
        Instructions <span className="optional">Optional</span>
        <textarea
          value={instructions}
          rows={3}
          placeholder="Tone, context, or preferences for this project…"
          onChange={(e) => setInstructions(e.target.value)}
        />
        <span className="field-help">
          Prepended to every message sent inside this project.
        </span>
      </label>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" disabled={!title.trim() || busy}>
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
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ROOM FOR THE BIGGER PICTURE</p>
          <h1>Your projects.</h1>
          <p>Keep the context. Pick up where you left off.</p>
        </div>
        <button className="button primary" onClick={() => setCreate(true)}>
          <Plus size={16} />
          New project
        </button>
      </div>
      <div className="search-field page-search">
        <Search size={17} />
        <input
          aria-label="Find a project"
          placeholder="Find a project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="project-grid">
        {list.map((p, i) => (
          <Link to={`/project/${p.id}`} className="project-card" key={p.id}>
            <div className={`project-symbol color-${i % 3}`}>
              <FolderClosed size={23} />
            </div>
            <h2>{p.title}</h2>
            <p>{p.description || "A fresh space for your next idea."}</p>
            <div>
              <span>
                {chats.filter((c) => c.projectId === p.id).length ||
                  p.counts.chats}{" "}
                conversations
              </span>
              <span>{relativeDate(p.updatedAt)}</span>
            </div>
          </Link>
        ))}
      </div>
      {!list.length && (
        <EmptyState
          icon={<FolderClosed size={26} />}
          title={query ? "No matching projects" : "Give an idea its own space"}
          description={
            query
              ? "Try another name or description."
              : "Bring together conversations, files, and instructions."
          }
          action={
            !query && (
              <button
                className="button primary"
                onClick={() => setCreate(true)}
              >
                Create a project
              </button>
            )
          }
        />
      )}
      <Modal
        open={create}
        onClose={() => setCreate(false)}
        title="Create a project"
        description="A little context makes it easier to keep going."
      >
        <ProjectForm onClose={() => setCreate(false)} />
      </Modal>
    </div>
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
  const [tab, setTab] = useState("Conversations"),
    [editing, setEditing] = useState(false),
    [removing, setRemoving] = useState(false),
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

  const projectChats = chats.filter((c) => c.projectId === id),
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

  return (
    <div className="page project-page">
      <div className="project-breadcrumb">
        <Link to="/projects">Projects</Link>
        <span>/</span>
        <span>{p.title}</span>
      </div>
      <div className="page-heading">
        <div>
          <h1>{p.title}</h1>
          <p>{p.description}</p>
        </div>
        <Dropdown
          label="Project actions"
          align="end"
          trigger={
            <button className="icon-button" aria-label="Project actions">
              <MoreHorizontal size={20} />
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
      <div className="project-workspace">
        <section className="project-main-column">
          {tab === "Conversations" && (
            <>
              <div className="project-composer">
                <Composer projectId={id} compact />
              </div>
              <h2 className="project-section-title">Recent conversations</h2>
              <div className="conversation-list">
                {projectChats.map((c) => (
                  <div className="conversation-list-row" key={c.id}>
                    <Link to={`/chat/${c.id}`}>
                      <MessageCircleMore size={18} />
                      <span>
                        <strong>{c.title}</strong>
                        <small>{relativeDate(c.updatedAt)}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </Link>
                    <ChatMenu chat={c} />
                  </div>
                ))}
              </div>
              {!projectChats.length && (
                <p className="field-help center">
                  Your first project conversation begins above.
                </p>
              )}
            </>
          )}
          {tab === "Files" && (
            <>
              <div className="section-toolbar">
                <p className="subtle">
                  Uploaded files are extracted and indexed, then ranked against
                  your questions in this project.
                </p>
                <button
                  className="button"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={15} />
                  Add files
                </button>
              </div>
              {files.map((f) => (
                <div className="project-file" key={f.id}>
                  <AttachmentChip file={f} />
                  <IconButton
                    label={`Re-index ${f.name}`}
                    disabled={!f.downloadUrl}
                    onClick={() => {
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
                  >
                    <RefreshCw size={15} />
                  </IconButton>
                  <IconButton
                    label={`Remove ${f.name} from project`}
                    onClick={() => {
                      if (!id) return;
                      void api.projects
                        .removeFile(id, f.id)
                        .then(() => {
                          setFiles((all) => all.filter((x) => x.id !== f.id));
                          void refreshProjects();
                        })
                        .catch(() => toast("That file could not be removed."));
                    }}
                  >
                    <XIcon />
                  </IconButton>
                </div>
              ))}
              {!files.length && (
                <EmptyState
                  icon={<FileText />}
                  title="A place for your reference material"
                  description="Add documents, spreadsheets, or code. Their text is indexed so answers in this project can draw on it."
                  action={
                    <button
                      className="button"
                      onClick={() => fileInput.current?.click()}
                    >
                      Add your first file
                    </button>
                  }
                />
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
            </>
          )}
          {tab === "Artifacts" && (
            <>
              <div className="artifact-grid">
                {arts.map((a) => (
                  <ArtifactCard artifact={a} key={a.id} />
                ))}
              </div>
              {!arts.length && (
                <EmptyState
                  icon={<PanelsTopLeft />}
                  title="The things you make, together"
                  description="Save a response as an artifact from a conversation in this project."
                />
              )}
            </>
          )}
          {tab === "Saved sources" && (
            <>
              {sources.map((s) => (
                <div className="saved-source" key={s.id}>
                  <Bookmark size={18} />
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    <small>
                      {s.domain} · {s.type}
                    </small>
                    <strong>{s.title}</strong>
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
                        .catch(() =>
                          toast("That source could not be removed."),
                        );
                    }}
                  >
                    <XIcon />
                  </IconButton>
                </div>
              ))}
              {!sources.length && (
                <EmptyState
                  icon={<Bookmark />}
                  title="Keep the evidence close"
                  description="Save references from a conversation’s Sources panel to this project."
                />
              )}
            </>
          )}
        </section>
        <aside className="project-context-card" aria-label="Project context">
          <button
            className={tab === "Conversations" ? "active" : ""}
            onClick={() => setTab("Conversations")}
          >
            <span>
              <MessageCircleMore size={17} />
              <strong>Conversations</strong>
            </span>
            <small>{projectChats.length} recent</small>
          </button>
          <button onClick={() => setEditing(true)}>
            <span>
              <Settings size={17} />
              <strong>Instructions</strong>
            </span>
            <small>{p.instructions ? "Configured" : "Add guidance"}</small>
          </button>
          <button
            className={tab === "Files" ? "active" : ""}
            onClick={() => setTab("Files")}
          >
            <span>
              <FileText size={17} />
              <strong>Context</strong>
            </span>
            <small>
              {files.length
                ? `${files.length} file${files.length === 1 ? "" : "s"} · ${p.counts.indexedChunks} chunks`
                : "Add reference files"}
            </small>
          </button>
          <button
            className={tab === "Artifacts" ? "active" : ""}
            onClick={() => setTab("Artifacts")}
          >
            <span>
              <PanelsTopLeft size={17} />
              <strong>Artifacts</strong>
            </span>
            <small>
              {arts.length ? `${arts.length} created` : "Nothing created yet"}
            </small>
          </button>
          <button
            className={tab === "Saved sources" ? "active" : ""}
            onClick={() => setTab("Saved sources")}
          >
            <span>
              <Bookmark size={17} />
              <strong>Saved sources</strong>
            </span>
            <small>
              {sources.length ? `${sources.length} saved` : "No saved sources"}
            </small>
          </button>
        </aside>
      </div>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Project settings"
      >
        <ProjectForm project={p} onClose={() => setEditing(false)} />
      </Modal>
      <Modal
        open={removing}
        onClose={() => setRemoving(false)}
        title="Delete this project?"
        description="The project, its uploaded files, and its saved sources are removed. Its conversations and artifacts stay in your workspace."
      >
        <div className="dialog-actions">
          <button className="button" onClick={() => setRemoving(false)}>
            Cancel
          </button>
          <button
            className="button destructive"
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

function XIcon() {
  return (
    <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
      ×
    </span>
  );
}

function ArtifactCard({ artifact: a }: { artifact: Artifact }) {
  const { setPanel, refreshArtifacts, toast } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="artifact-card">
      <button onClick={() => setPanel({ kind: "artifact", id: a.id })}>
        <div
          className={`artifact-card-preview ${a.kind === "webpage" ? "preview-blue" : ""}`}
        >
          {a.kind === "document" ? (
            <>
              <p>DOCUMENT</p>
              <h3>{a.title}</h3>
              <span />
              <span />
              <span />
            </>
          ) : a.kind === "webpage" ? (
            <>
              <p>WEBPAGE</p>
              <h3>{a.title}</h3>
            </>
          ) : (
            <>
              <Code2 size={28} />
              <code>{a.title}</code>
            </>
          )}
        </div>
        <div className="artifact-card-info">
          <strong>{a.title}</strong>
          <small>
            {a.kind} · version {a.currentVersion}
          </small>
        </div>
      </button>
      <IconButton
        label={`Delete artifact ${a.title}`}
        className="delete-artifact"
        onClick={() => setConfirm(true)}
      >
        <Trash2 size={14} />
      </IconButton>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete artifact?"
        description={`“${a.title}” and every saved version will be removed. Download a copy first if you want to keep it.`}
      >
        <div className="dialog-actions">
          <button className="button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button
            className="button destructive"
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
    </div>
  );
}

export function ArtifactsPage() {
  const { artifacts, refreshArtifacts, setPanel, toast } = useWorkspace();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All"),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState<Artifact["kind"]>("document");
  const list = artifacts.filter(
    (a) =>
      (filter === "All" || a.kind === filter) &&
      a.title.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">FROM THOUGHT TO SOMETHING TANGIBLE</p>
          <h1>Made with ArcNave.</h1>
          <p>Documents, little experiments, and ideas taking shape.</p>
        </div>
        <button className="button primary" onClick={() => setCreating(true)}>
          <Plus size={16} />
          New artifact
        </button>
      </div>
      <div className="list-toolbar">
        <div className="segmented">
          {["All", "document", "code", "webpage"].map((f) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "All" ? f : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Find an artifact"
            placeholder="Find an artifact…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="artifact-grid">
        {list.map((a) => (
          <ArtifactCard artifact={a} key={a.id} />
        ))}
      </div>
      {!list.length && (
        <EmptyState
          icon={<PanelsTopLeft />}
          title={query ? "No matching artifacts" : "Something worth making"}
          description={
            query
              ? "Try another name or type."
              : "Create a document, a code snippet, or a small webpage."
          }
          action={
            <button className="button" onClick={() => setCreating(true)}>
              Create an artifact
            </button>
          }
        />
      )}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Create an artifact"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            const content =
              kind === "document"
                ? `# ${title}\n\nYour next idea starts here.`
                : kind === "code"
                  ? "// Your code starts here.\n"
                  : '<!doctype html><html><head><meta charset="UTF-8"></head><body><h1>Your next idea starts here.</h1></body></html>';
            void api.artifacts
              .create({ title: title.trim(), kind, content })
              .then(async (created) => {
                await refreshArtifacts();
                setCreating(false);
                setTitle("");
                setPanel({ kind: "artifact", id: created.id });
                toast("Artifact created");
              })
              .catch(() => toast("The artifact could not be created."))
              .finally(() => setBusy(false));
          }}
        >
          <label className="field-label">
            Title
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label className="field-label">
            Format
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Artifact["kind"])}
            >
              <option value="document">Document</option>
              <option value="code">Code</option>
              <option value="webpage">Webpage</option>
            </select>
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="button"
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
            <button className="button primary" disabled={!title.trim() || busy}>
              {busy && <Loader2 size={14} className="spin" />}
              Create artifact
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
