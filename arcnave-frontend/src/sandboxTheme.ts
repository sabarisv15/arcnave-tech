/**
 * The look a sandboxed visual gets for free (ADR-0036).
 *
 * The frame has an opaque origin and cannot read ArcNave's stylesheet, so the tokens are written
 * into its document. Every element rule sits inside `:where()`, which has no specificity: the
 * model's own CSS always wins, and these rules only fill in what it did not say.
 */

export type SandboxTheme = "light" | "dark";

// One palette per theme, chosen so each series colour stays readable on the surface of that theme.
const LIGHT = `
--text:#282b30;--text-muted:#686d72;--text-faint:#989ea3;
--surface:#ffffff;--surface-2:#f3f4f1;--border:rgba(40,43,48,.14);--border-strong:rgba(40,43,48,.3);
--accent:#4b6378;--good:#3d7a2b;--bad:#a64040;--warn:#946510;--info:#3f6fa8;
--c1:#3f6fa8;--c2:#2b8472;--c3:#b0731a;--c4:#b04a58;--c5:#6a58a6;--c6:#5b7c2c;
color-scheme:light;`;

const DARK = `
--text:#e1e5e7;--text-muted:#a3acb2;--text-faint:#79838a;
--surface:#282c30;--surface-2:#30353a;--border:rgba(225,229,231,.14);--border-strong:rgba(225,229,231,.3);
--accent:#7898b1;--good:#7ab35f;--bad:#df8c8c;--warn:#d8a94c;--info:#7aa5d6;
--c1:#7aa5d6;--c2:#5fbfab;--c3:#e0a84a;--c4:#e07f8c;--c5:#a596d9;--c6:#97b865;
color-scheme:dark;`;

export const SANDBOX_BASE_CSS = `
:root{${LIGHT}
--font:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
--mono:ui-monospace,"Cascadia Code",Consolas,monospace;
--radius:8px;--radius-lg:12px}
:root[data-theme="dark"]{${DARK}}
:where(html,body){margin:0;background:transparent}
:where(body){padding:4px 2px;font:15px/1.55 var(--font);color:var(--text);-webkit-font-smoothing:antialiased}
:where([data-layout="page"]) :where(body){padding:16px 20px}
:where(*,*::before,*::after){box-sizing:border-box}
:where(h1,h2,h3,h4){margin:0 0 .5em;font-weight:500;line-height:1.25}
:where(h1){font-size:22px}:where(h2){font-size:18px}:where(h3){font-size:16px}:where(h4){font-size:14px}
:where(p){margin:0 0 .75em}
:where(small,.muted){color:var(--text-muted)}
:where(a){color:var(--info)}
:where(code,kbd,pre){font-family:var(--mono);font-size:.9em}
:where(hr){border:0;border-top:.5px solid var(--border);margin:16px 0}
:where(button){font:inherit;font-size:14px;color:var(--text);background:var(--surface);border:.5px solid var(--border-strong);border-radius:var(--radius);padding:6px 12px;cursor:pointer}
:where(button:hover){background:var(--surface-2)}
:where(button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible){outline:2px solid var(--accent);outline-offset:1px}
:where(button.primary,button[aria-pressed="true"]){background:var(--text);color:var(--surface);border-color:var(--text)}
:where(input,select,textarea){font:inherit;font-size:14px;color:var(--text);background:var(--surface);border:.5px solid var(--border-strong);border-radius:var(--radius);padding:6px 10px}
:where(input[type="range"]){padding:0;border:0;background:none;width:100%;accent-color:var(--accent)}
:where(input[type="checkbox"],input[type="radio"]){accent-color:var(--accent)}
:where(label){font-size:14px;color:var(--text-muted)}
:where(table){border-collapse:collapse;width:100%;font-size:14px}
:where(th){text-align:left;font-weight:500;color:var(--text-muted)}
:where(th,td){padding:8px 10px;border-bottom:.5px solid var(--border)}
:where(td.num,th.num){text-align:right;font-variant-numeric:tabular-nums}
:where(svg){max-width:100%;font-family:var(--font)}
:where(canvas){max-width:100%}
:where(.card){background:var(--surface);border:.5px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px}
:where(.grid){display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
:where(.row){display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
:where(.stat){font-size:26px;font-weight:500;line-height:1.2;font-variant-numeric:tabular-nums}
:where(.stat-label){font-size:13px;color:var(--text-muted)}
:where(.chip){display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--text-muted)}
:where(.up){color:var(--good)}:where(.down){color:var(--bad)}
:where(.tone-1){--tone:var(--c1)}:where(.tone-2){--tone:var(--c2)}:where(.tone-3){--tone:var(--c3)}
:where(.tone-4){--tone:var(--c4)}:where(.tone-5){--tone:var(--c5)}:where(.tone-6){--tone:var(--c6)}
:where(.label){fill:var(--text);font-size:13px}
:where(.label-muted){fill:var(--text-muted);font-size:12px}
:where(.node){fill:var(--surface-2);stroke:var(--border-strong);stroke-width:1}
:where(.node[class*="tone-"],[class*="tone-"] .node){fill:color-mix(in srgb,var(--tone) 16%,var(--surface));stroke:var(--tone)}
:where(.edge){fill:none;stroke:var(--text-muted);stroke-width:1.25}
:where(.series){fill:var(--tone,var(--c1));stroke:var(--tone,var(--c1))}
`.replace(/\n/g, "");

/** The theme ArcNave is showing now, read the same way the rest of the app reads it. */
export function currentTheme(): SandboxTheme {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.dataset["theme"];
  if (attr === "dark" || attr === "light") return attr;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
