/**
 * Artifacts are files (ADR-0048): a presented file of one of these types opens in the side panel
 * and is drawn there; any other type is a download card.
 */
export type ArtifactKind = "markdown" | "html" | "react" | "mermaid" | "svg" | "pdf";

const KINDS: Record<string, ArtifactKind> = {
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  jsx: "react",
  mermaid: "mermaid",
  mmd: "mermaid",
  svg: "svg",
  pdf: "pdf",
};

export function artifactKind(filename: string): ArtifactKind | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return filename.includes(".") ? (KINDS[ext] ?? null) : null;
}

/**
 * Where a React artifact's imports come from: each a UMD build on a host the sandbox's CSP
 * allows, with the global it defines. Loaded in order, only when imported. The list is what the
 * system prompt offers (backend/src/services/systemPrompt.ts); a change must be made in both.
 */
const JSDELIVR = "https://cdn.jsdelivr.net/npm/";
export const REACT_MODULES: Record<string, { urls: string[]; global: string }> = {
  react: { urls: [`${JSDELIVR}react@18.3.1/umd/react.production.min.js`], global: "React" },
  "react-dom": { urls: [`${JSDELIVR}react-dom@18.3.1/umd/react-dom.production.min.js`], global: "ReactDOM" },
  "react-dom/client": { urls: [`${JSDELIVR}react-dom@18.3.1/umd/react-dom.production.min.js`], global: "ReactDOM" },
  "lucide-react": { urls: [`${JSDELIVR}lucide-react@0.383.0/dist/umd/lucide-react.min.js`], global: "LucideReact" },
  recharts: {
    urls: [`${JSDELIVR}prop-types@15.8.1/prop-types.min.js`, `${JSDELIVR}recharts@2.12.7/umd/Recharts.js`],
    global: "Recharts",
  },
  mathjs: { urls: [`${JSDELIVR}mathjs@12.4.2/lib/browser/math.js`], global: "math" },
  lodash: { urls: [`${JSDELIVR}lodash@4.17.21/lodash.min.js`], global: "_" },
  d3: { urls: [`${JSDELIVR}d3@7.9.0/dist/d3.min.js`], global: "d3" },
  "plotly.js": { urls: [`${JSDELIVR}plotly.js-dist-min@2.35.2/plotly.min.js`], global: "Plotly" },
  "plotly.js-dist-min": { urls: [`${JSDELIVR}plotly.js-dist-min@2.35.2/plotly.min.js`], global: "Plotly" },
  three: { urls: [`${JSDELIVR}three@0.128.0/build/three.min.js`], global: "THREE" },
  papaparse: { urls: [`${JSDELIVR}papaparse@5.4.1/papaparse.min.js`], global: "Papa" },
  xlsx: { urls: [`${JSDELIVR}xlsx@0.18.5/dist/xlsx.full.min.js`], global: "XLSX" },
  "chart.js": { urls: [`${JSDELIVR}chart.js@4.4.1/dist/chart.umd.js`], global: "Chart" },
  "chart.js/auto": { urls: [`${JSDELIVR}chart.js@4.4.1/dist/chart.umd.js`], global: "Chart" },
  tone: { urls: [`${JSDELIVR}tone@14.8.49/build/Tone.js`], global: "Tone" },
  mammoth: { urls: [`${JSDELIVR}mammoth@1.8.0/mammoth.browser.min.js`], global: "mammoth" },
  "@tensorflow/tfjs": { urls: [`${JSDELIVR}@tensorflow/tfjs@4.22.0/dist/tf.min.js`], global: "tf" },
};

const BABEL = `${JSDELIVR}@babel/standalone@7.26.4/babel.min.js`;
const TAILWIND = `${JSDELIVR}@tailwindcss/browser@4.1.4/dist/index.global.js`;

/** The module names a component imports, in the order written. */
export function importsOf(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) {
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** JSON inside a <script> element: nothing in it can close the element. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/**
 * The body of a sandbox document that runs a React component: React, Tailwind and the imported
 * libraries load from the CDN, Babel turns the JSX into CommonJS, and `require` hands each
 * import its global (lucide-react's build reads React as `window.react`, so that name is set
 * too). A failure is shown in the frame instead of a blank page.
 */
export function reactArtifactBody(code: string): string {
  const needed = ["react", "react-dom", ...importsOf(code)];
  const unknown = needed.filter((n) => !REACT_MODULES[n]);
  const urls = [...new Set([BABEL, TAILWIND, ...needed.filter((n) => REACT_MODULES[n]).flatMap((n) => REACT_MODULES[n]!.urls)])];
  const globals = Object.fromEntries(Object.entries(REACT_MODULES).map(([k, v]) => [k, v.global]));
  return (
    `<div id="root"></div>` +
    `<script>(function(){var code=${scriptJson(code)},urls=${scriptJson(urls)},globals=${scriptJson(globals)},unknown=${scriptJson(unknown)};` +
    `function fail(m){var r=document.getElementById("root");r.textContent="";var p=document.createElement("pre");p.style.cssText="white-space:pre-wrap;color:var(--bad);font-size:13px";p.textContent=m;r.appendChild(p)}` +
    `if(unknown.length){fail("This component imports "+unknown.join(", ")+", which is not available here.");return}` +
    `function load(i){if(i>=urls.length)return run();var s=document.createElement("script");s.src=urls[i];s.onload=function(){if(window.React&&!window.react)window.react=window.React;load(i+1)};s.onerror=function(){fail("Could not load "+urls[i])};document.head.appendChild(s)}` +
    `function run(){try{var out=Babel.transform(code,{presets:["react"],plugins:["transform-modules-commonjs"],filename:"artifact.jsx"}).code;` +
    `var module={exports:{}};var require=function(n){var g=globals[n];if(!g||!(g in window))throw new Error("Cannot import "+n);var v=window[g];return n==="react"||n==="react-dom"?Object.assign({default:v},v):v&&v.default?v:Object.assign({default:v},v)};` +
    `new Function("module","exports","require","React",out)(module,module.exports,require,window.React);` +
    `var C=module.exports.default||module.exports;if(typeof C!=="function")throw new Error("The component needs a default export.");` +
    `ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(C))}catch(e){fail(String(e&&e.message||e))}}` +
    `load(0)})();</script>`
  );
}
