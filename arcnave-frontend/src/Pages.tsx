import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpRight,
  Bookmark,
  Code2,
  FileText,
  FolderClosed,
  MessageCircleMore,
  MoreHorizontal,
  PanelsTopLeft,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { useWorkspace } from "./workspace";
import { Dropdown, EmptyState, IconButton, Modal } from "./ui";
import type { Artifact, Attachment, Project } from "./types";
import { uid } from "./types";
import { ChatMenu } from "./Navigation";
import Composer, { AttachmentChip } from "./Composer";
import { storeFile, validateFile } from "./storage";
export const relativeDate = (time: number) =>
  new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
export function ChatsPage() {
  const { data } = useWorkspace();
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("Recent");
  const list = data.chats
    .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === "Recent"
        ? b.updatedAt - a.updatedAt
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
                    ? data.projects.find((p) => p.id === c.projectId)?.title
                    : "Personal workspace"}{" "}
                  · {c.messages.filter((m) => m.role === "user").length}{" "}
                  messages{c.demo ? " · Example" : ""}
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
  const { setData, toast } = useWorkspace();
  const navigate = useNavigate();
  const [title, setTitle] = useState(project?.title || ""),
    [description, setDescription] = useState(project?.description || ""),
    [instructions, setInstructions] = useState(project?.instructions || "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const id = project?.id || uid();
        setData((w) => ({
          ...w,
          projects: project
            ? w.projects.map((p) =>
                p.id === id
                  ? {
                      ...p,
                      title: title.trim(),
                      description,
                      instructions,
                      updatedAt: Date.now(),
                    }
                  : p,
              )
            : [
                {
                  id,
                  title: title.trim(),
                  description,
                  instructions,
                  files: [],
                  savedSources: [],
                  updatedAt: Date.now(),
                },
                ...w.projects,
              ],
        }));
        onClose();
        navigate(`/project/${id}`);
        toast(project ? "Project updated" : "Project created");
      }}
    >
      <label className="field-label">
        Project name
        <input
          autoFocus
          placeholder="What are you working on?"
          value={title}
          maxLength={120}
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
      </label>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button className="button primary" disabled={!title.trim()}>
          {project ? "Save changes" : "Create project"}
        </button>
      </div>
    </form>
  );
}
export function ProjectsPage() {
  const { data } = useWorkspace();
  const [create, setCreate] = useState(false),
    [query, setQuery] = useState("");
  const list = data.projects.filter((p) =>
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
                {data.chats.filter((c) => c.projectId === p.id).length}{" "}
                conversations
              </span>
              <span>{p.demo ? "Example" : relativeDate(p.updatedAt)}</span>
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
  const { data, setData, toast, setPanel } = useWorkspace();
  const p = data.projects.find((p) => p.id === id);
  const [tab, setTab] = useState("Conversations"),
    [editing, setEditing] = useState(false),
    [removing, setRemoving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [replacement, setReplacement] = useState<string>();
  if (!p)
    return (
      <EmptyState
        icon={<FolderClosed />}
        title="Project not found"
        description="This project is not in this browser’s workspace."
        action={
          <Link className="button" to="/projects">
            Go to projects
          </Link>
        }
      />
    );
  const chats = data.chats.filter((c) => c.projectId === id),
    arts = data.artifacts.filter((a) => a.projectId === id);
  async function upload(list: FileList | null) {
    if (!list) return;
    for (const f of Array.from(list)) {
      const error = validateFile(f);
      const file: Attachment = {
        id: uid(),
        name: f.name,
        size: f.size,
        type: f.type,
        status: error ? "unsupported" : "processing",
        error: error || undefined,
      };
      setData((w) => ({
        ...w,
        projects: w.projects.map((x) =>
          x.id === id
            ? {
                ...x,
                files: [...x.files.filter((x) => x.id !== replacement), file],
              }
            : x,
        ),
      }));
      if (!error)
        try {
          await storeFile(file.id, f);
          setData((w) => ({
            ...w,
            projects: w.projects.map((x) =>
              x.id === id
                ? {
                    ...x,
                    files: x.files.map((a) =>
                      a.id === file.id ? { ...a, status: "ready" } : a,
                    ),
                  }
                : x,
            ),
          }));
        } catch {
          setData((w) => ({
            ...w,
            projects: w.projects.map((x) =>
              x.id === id
                ? {
                    ...x,
                    files: x.files.map((a) =>
                      a.id === file.id
                        ? {
                            ...a,
                            status: "failed",
                            error: "Could not save the file. Try replacing it.",
                          }
                        : a,
                    ),
                  }
                : x,
            ),
          }));
        }
    }
    setReplacement(undefined);
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
                {chats.map((c) => (
                  <div className="conversation-list-row" key={c.id}>
                    <Link to={`/chat/${c.id}`}>
                      <MessageCircleMore size={18} />
                      <span>
                        <strong>{c.title}</strong>
                        <small>
                          {relativeDate(c.updatedAt)}
                          {c.demo ? " · Example" : ""}
                        </small>
                      </span>
                      <ArrowUpRight size={16} />
                    </Link>
                    <ChatMenu chat={c} />
                  </div>
                ))}
              </div>
              {!chats.length && (
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
                  Reference material, kept on this device.
                </p>
                <button
                  className="button"
                  onClick={() => {
                    setReplacement(undefined);
                    fileInput.current?.click();
                  }}
                >
                  <Upload size={15} />
                  Add files
                </button>
              </div>
              {p.files.map((f) => (
                <div className="project-file" key={f.id}>
                  <AttachmentChip file={f} />
                  <IconButton
                    label={`Replace ${f.name}`}
                    onClick={() => {
                      setReplacement(f.id);
                      fileInput.current?.click();
                    }}
                  >
                    <Upload size={15} />
                  </IconButton>
                  <IconButton
                    label={`Remove ${f.name} from project`}
                    onClick={() =>
                      setData((w) => ({
                        ...w,
                        projects: w.projects.map((x) =>
                          x.id === id
                            ? {
                                ...x,
                                files: x.files.filter((a) => a.id !== f.id),
                              }
                            : x,
                        ),
                      }))
                    }
                  >
                    <XIcon />
                  </IconButton>
                </div>
              ))}
              {!p.files.length && (
                <EmptyState
                  icon={<FileText />}
                  title="A place for your reference material"
                  description="Add documents, images, spreadsheets, or code. They stay on this device."
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
                multiple={!replacement}
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
                  description="Create an artifact from the plus menu in a project conversation."
                />
              )}
            </>
          )}
          {tab === "Saved sources" && (
            <>
              {p.savedSources.map((s) => (
                <div className="saved-source" key={s.url}>
                  <Bookmark size={18} />
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    <small>
                      {s.domain} · {s.type}
                    </small>
                    <strong>{s.title}</strong>
                  </a>
                  <IconButton
                    label={`Remove saved source ${s.title}`}
                    onClick={() =>
                      setData((w) => ({
                        ...w,
                        projects: w.projects.map((x) =>
                          x.id === id
                            ? {
                                ...x,
                                savedSources: x.savedSources.filter(
                                  (a) => a.url !== s.url,
                                ),
                              }
                            : x,
                        ),
                      }))
                    }
                  >
                    <XIcon />
                  </IconButton>
                </div>
              ))}
              {!p.savedSources.length && (
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
            <small>{chats.length} recent</small>
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
              {p.files.length
                ? `${p.files.length} local file${p.files.length === 1 ? "" : "s"}`
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
              {p.savedSources.length
                ? `${p.savedSources.length} saved`
                : "No saved sources"}
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
        description="The project context will be removed. Its conversations and artifacts will remain in your personal workspace."
      >
        <div className="dialog-actions">
          <button className="button" onClick={() => setRemoving(false)}>
            Cancel
          </button>
          <button
            className="button destructive"
            onClick={() => {
              setData((w) => ({
                ...w,
                projects: w.projects.filter((x) => x.id !== id),
                chats: w.chats.map((c) =>
                  c.projectId === id ? { ...c, projectId: undefined } : c,
                ),
                artifacts: w.artifacts.map((a) =>
                  a.projectId === id ? { ...a, projectId: undefined } : a,
                ),
              }));
              setPanel({ kind: "closed" });
              navigate("/projects");
              toast("Project deleted; conversations kept");
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
  const { setPanel, setData } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="artifact-card">
      <button onClick={() => setPanel({ kind: "artifact", id: a.id })}>
        <div
          className={`artifact-card-preview ${a.kind === "webpage" ? "preview-blue" : ""}`}
        >
          {a.kind === "document" ? (
            <>
              <p>PROJECT BRIEF</p>
              <h3>{a.title}</h3>
              <span />
              <span />
              <span />
            </>
          ) : a.kind === "webpage" ? (
            <>
              <p>FIELD NOTES / 01</p>
              <h3>
                Make room
                <br />
                for a thought.
              </h3>
            </>
          ) : (
            <>
              <Code2 size={28} />
              <code>
                function idea() {"{"}
                <br /> return possibility;
                <br />
                {"}"}
              </code>
            </>
          )}
        </div>
        <div className="artifact-card-info">
          <strong>{a.title}</strong>
          <small>
            {a.kind} · {a.versions.length} version
            {a.versions.length > 1 ? "s" : ""}
            {a.demo ? " · Example" : ""}
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
        description={`“${a.title}” and its saved versions will be removed. Download a copy first if you want to keep it.`}
      >
        <div className="dialog-actions">
          <button className="button" onClick={() => setConfirm(false)}>
            Cancel
          </button>
          <button
            className="button destructive"
            onClick={() => {
              setData((w) => ({
                ...w,
                artifacts: w.artifacts.filter((x) => x.id !== a.id),
              }));
              setPanel({ kind: "closed" });
              setConfirm(false);
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
  const { data, setData, setPanel, toast } = useWorkspace();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All"),
    [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState<Artifact["kind"]>("document");
  const list = data.artifacts.filter(
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
            const id = uid();
            const content =
              kind === "document"
                ? `# ${title}\n\nYour next idea starts here.`
                : kind === "code"
                  ? "// Your code starts here.\n"
                  : '<!doctype html><html><head><meta charset="UTF-8"></head><body><h1>Your next idea starts here.</h1></body></html>';
            setData((w) => ({
              ...w,
              artifacts: [
                {
                  id,
                  title: title.trim(),
                  kind,
                  versions: [content],
                  version: 0,
                  updatedAt: Date.now(),
                },
                ...w.artifacts,
              ],
            }));
            setCreating(false);
            setTitle("");
            setPanel({ kind: "artifact", id });
            toast("Artifact created");
          }}
        >
          <label className="field-label">
            Title
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={120}
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
            <button className="button primary" disabled={!title.trim()}>
              Create artifact
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
