import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "./api";
import { remarkPlugins } from "./markdownPlugins";
import { SandboxFrame } from "./SandboxFrame";
import { SlideThumbnail } from "./SlidesView";
import type { Artifact } from "./types";

// A version's content never changes, so one read per version is enough for the whole session.
const cache = new Map<string, string>();
const key = (a: Artifact) => `${a.id}:${a.currentVersion}`;

const SVG_CENTRE =
  "<style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:0}</style>";

/** Lines of a document or code file a card has room to show. */
export function excerpt(content: string, lines: number): string {
  return content.split("\n").slice(0, lines).join("\n");
}

/**
 * A card's picture of its artifact, drawn from the artifact itself: webpages and SVGs render in
 * the same sandbox as the panel, documents and code show their opening lines. The content is
 * read only once the card scrolls into view. Until then, or if the read fails, the card keeps
 * its plain placeholder (`fallback`).
 */
export function ArtifactThumbnail({ artifact, fallback }: { artifact: Artifact; fallback: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const [content, setContent] = useState<string | null>(() => cache.get(key(artifact)) ?? null);

  useEffect(() => {
    if (visible || !box.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const k = key(artifact);
    const known = cache.get(k);
    if (known !== undefined) {
      setContent(known);
      return;
    }
    let live = true;
    api.artifacts
      .read(artifact.id)
      .then((a) => {
        cache.set(k, a.content);
        if (live) setContent(a.content);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [visible, artifact]);

  let body: React.ReactNode = fallback;
  if (content) {
    if (artifact.kind === "webpage" || artifact.kind === "svg") {
      // An image is shown whole and centred; a page is shown from its top, as it opens.
      const html = artifact.kind === "svg" ? SVG_CENTRE + content : content;
      body = (
        <div className={`artifact-thumb-frame ${artifact.kind === "svg" ? "is-image" : ""}`}>
          <SandboxFrame html={html} title={`${artifact.title} thumbnail`} layout="page" />
        </div>
      );
    } else if (artifact.kind === "slides") {
      body = (
        <div className="artifact-thumb-slides">
          <SlideThumbnail markdown={content} />
        </div>
      );
    } else if (artifact.kind === "document") {
      body = (
        <div className="artifact-thumb-doc">
          <ReactMarkdown remarkPlugins={remarkPlugins}>{excerpt(content, 40)}</ReactMarkdown>
        </div>
      );
    } else {
      body = <pre className="artifact-thumb-code">{excerpt(content, 18)}</pre>;
    }
  }

  // A thumbnail is a picture: the card's button is the only thing to click or tab to.
  return (
    <div ref={box} className="artifact-thumb" aria-hidden={content ? true : undefined} inert={content ? true : undefined}>
      {body}
    </div>
  );
}
