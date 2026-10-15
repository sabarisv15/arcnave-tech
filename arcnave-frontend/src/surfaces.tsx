/**
 * Small pieces shared by the app-surface pages: projects, project page, library, artifact panel
 * (Phase 1 item G4). Boards: BS-Base (tiles), BS-Project, BS-PartsA (projects, library, empty
 * project), BS-Artifact. Styles are in surfaces.css.
 */
import type { ReactNode } from "react";
import { Code2, FileText, Globe2, Image as ImageIcon, PanelsTopLeft, type LucideIcon } from "lucide-react";
import { Icon, LivingDots } from "./brand";
import type { Artifact } from "./types";

/** BS-Base tile tints: g green, s sky, m marigold, t terracotta, v jamun (violet). */
export type TileTone = "g" | "s" | "m" | "t" | "v";

/** The leaf-cornered tile (BS-Base `.tile`: 11/4 px corners). Decorative; the name beside it speaks. */
export function Tile({
  tone,
  children,
  size = 34,
  className = "",
}: {
  tone: TileTone;
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`sf-tile sf-tile-${tone} ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
      {children}
    </span>
  );
}

/** What an artifact kind is called, which tint it takes and which icon draws it (our mapping onto the board's tints). */
export const ARTIFACT_KINDS: Record<Artifact["kind"], { label: string; tone: TileTone; icon: LucideIcon }> = {
  document: { label: "Document", tone: "s", icon: FileText },
  slides: { label: "Slides", tone: "m", icon: PanelsTopLeft },
  code: { label: "Code", tone: "v", icon: Code2 },
  webpage: { label: "Webpage", tone: "g", icon: Globe2 },
  svg: { label: "Image", tone: "t", icon: ImageIcon },
};

export function ArtifactTile({ kind, size = 34 }: { kind: Artifact["kind"]; size?: number }) {
  const meta = ARTIFACT_KINDS[kind];
  return (
    <Tile tone={meta.tone} size={size}>
      <Icon icon={meta.icon} size={size >= 44 ? 22 : 18} />
    </Tile>
  );
}

/**
 * The extension in the tile, tinted like the board's file rows (XLSX green, DOCX sky, PDF
 * terracotta). Other types take the remaining tints; the board does not name them.
 */
export function fileTile(name: string): { label: string; tone: TileTone } {
  const ext = (name.includes(".") ? name.split(".").pop()! : "").toLowerCase();
  const label = (ext || "file").slice(0, 4).toUpperCase();
  if (["xlsx", "xls", "csv", "tsv", "ods"].includes(ext)) return { label, tone: "g" };
  if (["docx", "doc", "odt", "rtf", "txt", "md"].includes(ext)) return { label, tone: "s" };
  if (ext === "pdf") return { label, tone: "t" };
  if (["pptx", "ppt", "odp"].includes(ext)) return { label, tone: "m" };
  return { label, tone: "v" };
}

export function FileTile({ name }: { name: string }) {
  const { label, tone } = fileTile(name);
  return (
    <Tile tone={tone} className="sf-tile-file">
      {label}
    </Tile>
  );
}

/** Tint a project tile by position, the way the board alternates green, marigold, sky. */
export const PROJECT_TONES: TileTone[] = ["g", "m", "s", "t", "v"];

/**
 * An empty list or project (BS-PartsA "Empty project"): a dotted leaf-cornered box with the
 * living logo. Hover the logo and its dots turn back into papers.
 */
export function SurfaceEmpty({
  title,
  text,
  actions,
  as: Heading = "h2",
}: {
  title: string;
  text: string;
  actions?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="sf-empty">
      <LivingDots size={72} mode="papers" pad={1.6} />
      <Heading className="sf-empty-title">{title}</Heading>
      <p className="sf-empty-text">{text}</p>
      {actions && <div className="sf-empty-actions">{actions}</div>}
    </div>
  );
}

/** "saved 2 min ago" for the artifact panel header; empty when the server gave no time. */
export function savedAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "saved just now";
  if (minutes < 60) return `saved ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `saved ${hours} h ago`;
  return `saved ${new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
