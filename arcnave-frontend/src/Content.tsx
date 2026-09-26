import { useState, useEffect } from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import ReactMarkdown from "react-markdown";
import { ExternalLink, Download, Image as ImageIcon, AlertCircle } from "lucide-react";
import type { Source } from "./types";
import { url as resolveApiUrl } from "./api";
import { downloadAuthenticated } from "./storage";
import { remarkPlugins, rehypePlugins } from "./markdownPlugins";

export function AuthenticatedImage({
  src,
  alt,
  className,
}: {
  src?: string;
  alt?: string;
  className?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    if (!src) {
      setLoading(false);
      setError(true);
      return;
    }

    // Direct data URLs or external CDN URLs without backend auth
    if (src.startsWith("data:") || src.startsWith("blob:")) {
      setBlobUrl(src);
      setLoading(false);
      return;
    }

    const resolved = resolveApiUrl(src);
    let isCancelled = false;

    // Fetch with credentials to support SameSite cookies and proxy headers
    fetch(resolved, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!isCancelled) {
          const objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          // If blob fetch fails (e.g. strict CORS), fallback to direct resolved URL
          setBlobUrl(resolved);
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      if (blobUrl && blobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [src]);

  const downloadUrl = src ? resolveApiUrl(src) : "#";

  if (loading) {
    return (
      <div className="image-loading-placeholder" aria-label="Loading image">
        <ImageIcon size={20} className="spin" />
        <span>Loading generated image…</span>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="image-error-placeholder" role="alert">
        <AlertCircle size={18} />
        <span>Image preview unavailable</span>
        {src && (
          <a
            href={downloadUrl}
            onClick={(e) => {
              e.preventDefault();
              void downloadAuthenticated(src, "generated_image.png");
            }}
            className="image-download-link"
          >
            <Download size={14} /> Download
          </a>
        )}
      </div>
    );
  }

  const imageName = (alt || "generated_image")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_") + ".png";

  return (
    <figure className={`chat-image-container ${className || ""}`}>
      <img
        src={blobUrl}
        alt={alt || "Generated visual"}
        loading="lazy"
        onError={() => setError(true)}
      />
      <figcaption className="chat-image-caption">
        <span>{alt || "Generated Image"}</span>
        <a
          href={downloadUrl}
          onClick={(e) => {
            e.preventDefault();
            if (src) void downloadAuthenticated(src, imageName);
          }}
          className="chat-image-download"
          title="Download full size"
        >
          <Download size={13} />
          Download
        </a>
      </figcaption>
    </figure>
  );
}
export function Citation({
  source,
  onSelect,
}: {
  source: Source;
  onSelect: () => void;
}) {
  return (
    <HoverCard.Root openDelay={250} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <button
          className="citation"
          onClick={onSelect}
          aria-label={`Source ${source.id}: ${source.title}`}
        >
          {source.id}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          className="citation-preview"
          sideOffset={8}
          collisionPadding={16}
        >
          <span className="source-domain">
            {source.domain} · {source.type}
          </span>
          <strong>{source.title}</strong>
          <p>{source.snippet}</p>
          <span className="field-help">
            Click citation to inspect this source
          </span>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
export function Markdown({
  text,
  sources = [],
  onCitation,
}: {
  text: string;
  sources?: Source[];
  onCitation?: (id: number) => void;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          a: ({ href, children }) => {
            const id = href?.match(/^#source-(\d+)$/)?.[1];
            const source = sources.find((s) => s.id === Number(id));
            if (source && onCitation) {
              return (
                <Citation
                  source={source}
                  onSelect={() => onCitation(source.id)}
                />
              );
            }
            if (href?.startsWith("#source-")) {
              return <span className="missing-citation">[reference unavailable]</span>;
            }

            const isDownload =
              href &&
              (href.includes("/files/") ||
                href.includes("/download") ||
                href.includes("/artifacts/") ||
                /\.(xlsx|docx|pptx|pdf|png|jpe?g|webp)$/i.test(href));

            if (isDownload && href) {
              const filename =
                typeof children === "string" && children.trim().length > 0
                  ? children.trim()
                  : href.split("/").pop() || "download";
              return (
                <a
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    void downloadAuthenticated(href, filename);
                  }}
                  className="download-link"
                >
                  {children}
                  <Download size={11} />
                </a>
              );
            }

            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
                <ExternalLink size={11} />
              </a>
            );
          },
          table: ({ children }) => (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Answer table"
            >
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
          img: ({ src, alt }) => (
            <AuthenticatedImage src={src} alt={alt || "Response image"} />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
