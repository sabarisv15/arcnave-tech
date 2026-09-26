import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The only place model-written HTML runs (ADR-0035).
 *
 * `allow-scripts` alone gives the frame an opaque origin: it cannot read ArcNave's cookies,
 * storage or DOM, or call the API as the user. Never add `allow-same-origin` here: together with
 * `allow-scripts` it lets the frame remove its own sandbox.
 */
export const SANDBOX_TOKENS = "allow-scripts";

export const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export const PROMPT_MAX_CHARS = 500;
export const MIN_HEIGHT = 80;
export const MAX_HEIGHT = 2000;

// Runs before the content: reports the document height and exposes window.arcnave.prompt. It
// posts to the parent with "*" because an opaque origin cannot name its parent's.
const BRIDGE = `(function(){var p=window.parent;function h(){try{p.postMessage({type:"arcnave:resize",height:Math.ceil(document.documentElement.scrollHeight)},"*")}catch(e){}}window.arcnave={prompt:function(t){p.postMessage({type:"arcnave:prompt",text:String(t)},"*")}};window.addEventListener("load",h);if(window.ResizeObserver){new ResizeObserver(h).observe(document.documentElement)}setTimeout(h,50)})();`;

/** The document the frame loads: ArcNave's CSP first, then the bridge, then the content. */
export function buildSrcDoc(html: string): string {
  return (
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<script>${BRIDGE}</script>` +
    `<style>html,body{margin:0;padding:0}body{padding:12px;font-family:system-ui,sans-serif}</style>` +
    `</head><body>${html}</body></html>`
  );
}

export type FrameMessage =
  | { type: "arcnave:resize"; height: number }
  | { type: "arcnave:prompt"; text: string };

/**
 * Accepts only the two message types, with their limits. Anything else, including a prompt over
 * the limit, is dropped rather than trimmed: a script that sends too much is not a user.
 */
export function readFrameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type === "arcnave:resize" && typeof m.height === "number" && Number.isFinite(m.height)) {
    return { type: "arcnave:resize", height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(m.height))) };
  }
  if (m.type === "arcnave:prompt" && typeof m.text === "string") {
    const text = m.text.trim();
    if (!text || text.length > PROMPT_MAX_CHARS) return null;
    return { type: "arcnave:prompt", text };
  }
  return null;
}

export function SandboxFrame({
  html,
  title,
  autoHeight = false,
  className,
  onPrompt,
}: {
  html: string;
  title: string;
  /** Size to the content (inline visuals); otherwise fill the container (artifact panel). */
  autoHeight?: boolean;
  className?: string;
  onPrompt?: (text: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [height, setHeight] = useState(240);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only this frame's own window; a sibling frame or another tab cannot speak for it.
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = readFrameMessage(event.data);
      if (!message) return;
      if (message.type === "arcnave:resize") {
        if (autoHeight) setHeight(message.height);
      } else {
        onPrompt?.(message.text);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [autoHeight, onPrompt]);

  // A new document is a new frame: reset the load count with it.
  useEffect(() => {
    loads.current = 0;
  }, [generation, html]);

  // The first load is the document. Any later load means the frame navigated itself (a link or
  // a script), which the sandbox cannot prevent, so the original document is put back.
  const onLoad = useCallback(() => {
    loads.current += 1;
    if (loads.current > 1) {
      setBlocked(true);
      setGeneration((g) => g + 1);
    }
  }, []);

  return (
    <div className={`sandbox-frame ${className ?? ""}`}>
      {blocked && (
        <p className="sandbox-frame-note" role="status">
          Navigation blocked: this content tried to leave the page.
        </p>
      )}
      <iframe
        key={generation}
        ref={frame}
        title={title}
        sandbox={SANDBOX_TOKENS}
        referrerPolicy="no-referrer"
        srcDoc={buildSrcDoc(html)}
        onLoad={onLoad}
        style={autoHeight ? { height } : undefined}
      />
    </div>
  );
}
