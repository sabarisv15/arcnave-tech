import * as HoverCard from "@radix-ui/react-hover-card";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ExternalLink } from "lucide-react";
import type { Source } from "./types";
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
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => {
            const id = href?.match(/^#source-(\d+)$/)?.[1];
            const source = sources.find((s) => s.id === Number(id));
            return source && onCitation ? (
              <Citation
                source={source}
                onSelect={() => onCitation(source.id)}
              />
            ) : href?.startsWith("#source-") ? (
              <span className="missing-citation">[reference unavailable]</span>
            ) : (
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
            <img src={src} alt={alt || "Response image"} loading="lazy" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
