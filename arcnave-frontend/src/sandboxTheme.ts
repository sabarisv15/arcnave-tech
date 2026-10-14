/**
 * The look a sandboxed visual gets for free (ADR-0036).
 *
 * The frame has an opaque origin and cannot read ArcNave's stylesheet, so the tokens are written
 * into its document. Every element rule sits inside `:where()`, which has no specificity: the
 * model's own CSS always wins, and these rules only fill in what it did not say.
 */

export type SandboxTheme = "light" | "dark";

// One palette per theme. Every value is a brand token copied from the locked boards (BS-Base
// ".t-light/.t-dark", V2-Tokens), so a visual a model draws with these variables is in the same
// colours as the app around it:
//   text / muted / faint  --color-text, --color-muted, #7E918A (the shell's quiet label colour)
//   surface / surface-2   --color-surface, --color-soft (light) and --color-raised (dark)
//   border / strong       --color-line, --color-line-strong
//   accent                --color-primary (Kulam green) / --color-brand in dark
//   good bad warn info    --color-ok, --color-err, --color-warn, --color-info (always with words
//                         or an icon in the visual, never colour alone: BS-Base rule)
//   c1..c6                chart colours in the board's fixed order: Kulam green, Marigold, Sky,
//                         Terracotta, Jamun, Neem (BS-PartsB "Chart colours")
//   grid / axis           BS-Base --grid / --axis, thin chart lines
// src/chartColors.test.ts keeps these in step with brand/tokens.css.
const LIGHT = `
--text:#142320;--text-muted:#53625e;--text-faint:#7e918a;
--surface:#ffffff;--surface-2:#f6f9f8;--border:rgba(20,35,32,.1);--border-strong:rgba(20,35,32,.16);
--accent:#134e45;--good:#1e6e47;--bad:#b3261e;--warn:#8a5300;--info:#1c6690;
--c1:#2e8b63;--c2:#c98512;--c3:#2f7fb8;--c4:#c2553a;--c5:#7a5bb0;--c6:#8e9a2c;
--grid:rgba(20,35,32,.08);--axis:rgba(20,35,32,.22);
color-scheme:light;`;

const DARK = `
--text:#e8eeeb;--text-muted:#9aa8a3;--text-faint:#7e918a;
--surface:#1c2522;--surface-2:#212b28;--border:rgba(230,238,235,.1);--border-strong:rgba(230,238,235,.16);
--accent:#4fb585;--good:#8fd9b1;--bad:#f2b8b5;--warn:#f3c77a;--info:#9bd3f2;
--c1:#3fa676;--c2:#c2841f;--c3:#4a93cc;--c4:#d66a4c;--c5:#9478cb;--c6:#8f9b35;
--grid:rgba(230,238,235,.08);--axis:rgba(230,238,235,.24);
color-scheme:dark;`;

export const SANDBOX_BASE_CSS = `
:root{${LIGHT}
--font:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
--mono:ui-monospace,"Cascadia Code",Consolas,monospace;
--radius:12px;--radius-lg:16px}
:root[data-theme="dark"]{${DARK}}
:where(html,body){margin:0;background:transparent}
:where(body){padding:4px 2px;font:15px/1.55 var(--font);color:var(--text);-webkit-font-smoothing:antialiased}
:where([data-layout="page"]) :where(body){padding:16px 20px}
:where(*,*::before,*::after){box-sizing:border-box}
:where(h1,h2,h3,h4){margin:0 0 .5em;font-weight:700;line-height:1.25}
:where(h1){font-size:22px}:where(h2){font-size:18px}:where(h3){font-size:16px}:where(h4){font-size:14px}
:where(p){margin:0 0 .75em}
:where(small,.muted){color:var(--text-muted)}
:where(a){color:var(--info)}
:where(code,kbd,pre){font-family:var(--mono);font-size:.9em}
:where(hr){border:0;border-top:1px solid var(--border);margin:16px 0}
:where(button){font:inherit;font-size:14px;font-weight:600;color:var(--text);background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius);padding:6px 12px;cursor:pointer}
:where(button:hover){background:var(--surface-2)}
:where(button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible){outline:2px solid var(--accent);outline-offset:1px}
:where(button.primary,button[aria-pressed="true"]){background:var(--text);color:var(--surface);border-color:var(--text)}
:where(input,select,textarea){font:inherit;font-size:14px;color:var(--text);background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius);padding:6px 10px}
:where(input[type="range"]){padding:0;border:0;background:none;width:100%;accent-color:var(--accent)}
:where(input[type="checkbox"],input[type="radio"]){accent-color:var(--accent)}
:where(label){font-size:14px;color:var(--text-muted)}
:where(table){border-collapse:collapse;width:100%;font-size:14px}
:where(th){text-align:left;font-weight:600;color:var(--text-muted)}
:where(th,td){padding:8px 10px;border-bottom:1px solid var(--border)}
:where(td.num,th.num){text-align:right;font-variant-numeric:tabular-nums}
:where(svg){max-width:100%;font-family:var(--font)}
:where(canvas){max-width:100%}
:where(.card){background:var(--surface);border:1px solid var(--border);border-radius:18px 6px 18px 6px;padding:16px 18px}
:where(.grid){display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
:where(.row){display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
:where(.stat){font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.2;font-variant-numeric:tabular-nums}
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
