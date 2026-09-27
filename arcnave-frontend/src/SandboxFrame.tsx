import { useCallback, useEffect, useRef, useState } from "react";
import { SANDBOX_BASE_CSS, currentTheme, type SandboxTheme } from "./sandboxTheme";

/**
 * The only place model-written HTML runs (ADR-0035).
 *
 * `allow-scripts` alone gives the frame an opaque origin: it cannot read ArcNave's cookies,
 * storage or DOM, or call the API as the user. Never add `allow-same-origin` here: together with
 * `allow-scripts` it lets the frame remove its own sandbox.
 */
export const SANDBOX_TOKENS = "allow-scripts";

/**
 * `eval` is allowed only for a React artifact (ADR-0048), whose JSX is compiled in the frame.
 * It adds nothing a script could not already do there: inline scripts run, and the frame has no
 * network, no storage and an opaque origin either way.
 */
export function sandboxCsp(allowEval: boolean): string {
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${allowEval ? " 'unsafe-eval'" : ""} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export const SANDBOX_CSP = sandboxCsp(false);

export const PROMPT_MAX_CHARS = 500;
export const MIN_HEIGHT = 80;
export const MAX_HEIGHT = 2000;

// Runs before the content: reports the document height, exposes window.arcnave (and sendPrompt,
// the name show_widget's code uses), applies the theme
// ArcNave sends, draws a visual that is still being written (as markup: its scripts wait for the
// finished document, ADR-0037), and gives Chart.js the theme's colours when the page loads it. It posts to the
// parent with "*" because an opaque origin cannot name its parent's.
const BRIDGE = `(function(){var p=window.parent,d=document.documentElement,subs=[],C;function h(){try{p.postMessage({type:"arcnave:resize",height:Math.ceil(d.scrollHeight)},"*")}catch(e){}}function v(n){return getComputedStyle(d).getPropertyValue("--"+n).trim()}function colors(){return{text:v("text"),muted:v("text-muted"),faint:v("text-faint"),border:v("border"),surface:v("surface"),accent:v("accent"),good:v("good"),bad:v("bad"),series:[1,2,3,4,5,6].map(function(i){return v("c"+i)})}}function chart(x){try{var c=colors();x.defaults.color=c.muted;x.defaults.borderColor=c.border;x.defaults.font.family=v("font")}catch(e){}}try{Object.defineProperty(window,"Chart",{configurable:true,get:function(){return C},set:function(x){C=x;chart(x)}})}catch(e){}window.addEventListener("message",function(e){if(e.source!==p||!e.data)return;if(e.data.type==="arcnave:draft"){if(document.body)document.body.innerHTML=String(e.data.html);h();return}if(e.data.type!=="arcnave:theme")return;var t=e.data.theme==="dark"?"dark":"light";if(d.getAttribute("data-theme")===t)return;d.setAttribute("data-theme",t);if(C)chart(C);subs.forEach(function(f){try{f(t)}catch(x){}})});window.arcnave={prompt:function(t){p.postMessage({type:"arcnave:prompt",text:String(t)},"*")},theme:function(){return d.getAttribute("data-theme")},colors:colors,onThemeChange:function(f){if(typeof f==="function")subs.push(f)}};window.sendPrompt=window.arcnave.prompt;window.addEventListener("load",h);if(window.ResizeObserver){new ResizeObserver(h).observe(d)}setTimeout(h,50)})();`;

/**
 * The document the frame loads: ArcNave's CSP first, then the bridge and the base styles, then
 * the content. `color-scheme` lets the frame stay transparent over ArcNave's page in both themes.
 */
export function buildSrcDoc(html: string, theme: SandboxTheme = "light", layout: SandboxLayout = "inline", allowEval = false): string {
  const layoutAttr = layout === "page" ? ' data-layout="page"' : "";
  return (
    `<!doctype html><html data-theme="${theme === "dark" ? "dark" : "light"}"${layoutAttr}><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${sandboxCsp(allowEval)}">` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light dark">` +
    `<script>${BRIDGE}</script>` +
    `<style>${SANDBOX_BASE_CSS}</style>` +
    `</head><body>${html}</body></html>`
  );
}

/** "inline" sits in a reply with the text around it; "page" fills the artifact panel. */
export type SandboxLayout = "inline" | "page";

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
  layout = "inline",
  draft = false,
  className,
  onPrompt,
  allowEval = false,
}: {
  html: string;
  title: string;
  /** Size to the content (inline visuals); otherwise fill the container (artifact panel). */
  autoHeight?: boolean;
  layout?: SandboxLayout;
  /**
   * The HTML is unfinished and still growing: it is sent to a fixed, empty document as markup
   * instead of rebuilding the document, which would reload the frame on every piece.
   */
  draft?: boolean;
  className?: string;
  onPrompt?: (text: string) => void;
  /** A React artifact compiles its JSX in the frame (see sandboxCsp). */
  allowEval?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const loads = useRef(0);
  const [generation, setGeneration] = useState(0);
  const [height, setHeight] = useState(240);
  const [blocked, setBlocked] = useState(false);
  // The document is built once with the theme of the moment; later changes are sent as messages,
  // because a new srcdoc would reload the frame and lose what the user has done in it.
  const [initialTheme] = useState(currentTheme);

  const latest = useRef(html);
  latest.current = html;
  const sendDraft = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "arcnave:draft", html: latest.current }, "*");
  }, []);
  // Pieces arrive many times a second; the frame is redrawn at most every 100ms.
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(sendDraft, 100);
    return () => clearTimeout(timer);
  }, [draft, html, sendDraft]);

  const sendTheme = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type: "arcnave:theme", theme: currentTheme() }, "*");
  }, []);

  useEffect(() => {
    const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(sendTheme);
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", sendTheme);
    return () => {
      observer?.disconnect();
      media?.removeEventListener?.("change", sendTheme);
    };
  }, [sendTheme]);

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
  const documentHtml = draft ? "" : html;
  useEffect(() => {
    loads.current = 0;
  }, [generation, documentHtml]);

  // The first load is the document. Any later load means the frame navigated itself (a link or
  // a script), which the sandbox cannot prevent, so the original document is put back.
  const onLoad = useCallback(() => {
    sendTheme();
    if (draft) sendDraft();
    loads.current += 1;
    if (loads.current > 1) {
      setBlocked(true);
      setGeneration((g) => g + 1);
    }
  }, [sendTheme, draft, sendDraft]);

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
        srcDoc={buildSrcDoc(documentHtml, initialTheme, layout, allowEval)}
        onLoad={onLoad}
        style={autoHeight ? { height } : undefined}
      />
    </div>
  );
}
