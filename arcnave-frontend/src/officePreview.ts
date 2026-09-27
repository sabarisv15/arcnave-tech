/**
 * Word and PowerPoint previews (WP-11), drawn into a document the caller owns: in the file panel
 * that is a frame with scripts off, so a file's styles cannot reach the page and a link in it
 * cannot run anything.
 *
 * Word goes through `docx-preview`. PowerPoint is drawn here: the open-source renderers tried
 * drew nothing for the decks ArcNave itself generates. This one reads each slide's shapes, text,
 * pictures and tables with their positions, which is what a deck is recognised by; effects,
 * charts and animations are not drawn. Everything is built with `createElement` and
 * `textContent`, never from markup in the file.
 */
import type JSZipType from "jszip";

export type OfficeKind = "docx" | "pptx";

export function officeKind(name: string, mimeType: string): OfficeKind | "xlsx" | null {
  const n = name.toLowerCase();
  if (n.endsWith(".docx") || mimeType.includes("wordprocessingml")) return "docx";
  if (n.endsWith(".pptx") || mimeType.includes("presentationml")) return "pptx";
  if (n.endsWith(".xlsx") || mimeType.includes("spreadsheetml")) return "xlsx";
  return null;
}

export async function renderDocx(bytes: ArrayBuffer, target: HTMLElement): Promise<void> {
  const { renderAsync } = await import("docx-preview");
  await renderAsync(bytes, target, target, {
    inWrapper: true,
    ignoreLastRenderedPageBreak: true,
    // Images as data URLs: blob URLs would outlive the frame.
    useBase64URL: true,
    renderChanges: false,
    experimental: false,
  });
  // Pages keep their paper size; shrink them to the frame's width, as a reader zoomed to fit.
  const win = target.ownerDocument.defaultView;
  const wrapper = target.querySelector<HTMLElement>(".docx-wrapper");
  const fit = () => {
    if (!wrapper) return;
    wrapper.style.zoom = "1";
    const page = wrapper.querySelector<HTMLElement>("section.docx");
    const style = win?.getComputedStyle(target);
    const room = target.clientWidth - parseFloat(style?.paddingLeft ?? "0") - parseFloat(style?.paddingRight ?? "0");
    if (page && page.offsetWidth > room) wrapper.style.zoom = String(room / page.offsetWidth);
  };
  fit();
  win?.addEventListener("resize", fit);
}

/* ------------------------------------------------------------------------------------ pptx */

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EMU_PER_PT = 12700;

type Rels = Map<string, string>;
interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Ctx {
  zip: JSZipType;
  doc: Document;
  theme: Map<string, string>;
  rels: Rels;
  dir: string;
  placeholders: Map<string, Xfrm>;
}

const child = (el: Element | null | undefined, ns: string, name: string): Element | null => {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.namespaceURI === ns && c.localName === name) return c;
  return null;
};
const children = (el: Element | null | undefined, ns: string, name: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === name) : [];
const num = (v: string | null | undefined, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

async function xml(zip: JSZipType, path: string): Promise<Document | null> {
  const file = zip.file(path);
  if (!file) return null;
  const doc = new DOMParser().parseFromString(await file.async("string"), "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

function resolve(dir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : `${dir}/${target}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

async function relsOf(zip: JSZipType, path: string): Promise<Rels> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const name = path.slice(path.lastIndexOf("/") + 1);
  const doc = await xml(zip, `${dir}/_rels/${name}.rels`);
  const rels: Rels = new Map();
  for (const r of Array.from(doc?.getElementsByTagName("Relationship") ?? [])) {
    const id = r.getAttribute("Id");
    const target = r.getAttribute("Target");
    if (id && target && r.getAttribute("TargetMode") !== "External") rels.set(id, resolve(dir, target));
  }
  return rels;
}

function xfrmOf(spPr: Element | null): Xfrm | null {
  return boxOf(child(spPr, A, "xfrm"));
}

/** An `a:xfrm` or a graphic frame's `p:xfrm`: both hold `a:off` and `a:ext`. */
function boxOf(x: Element | null): Xfrm | null {
  const off = child(x, A, "off");
  const ext = child(x, A, "ext");
  if (!off || !ext) return null;
  return {
    x: num(off.getAttribute("x")),
    y: num(off.getAttribute("y")),
    w: num(ext.getAttribute("cx")),
    h: num(ext.getAttribute("cy")),
  };
}

function placeholderKey(sp: Element): string | null {
  const nv = child(sp, P, "nvSpPr") ?? child(sp, P, "nvPicPr") ?? child(sp, P, "nvGraphicFramePr");
  const ph = nv?.getElementsByTagNameNS(P, "ph")[0];
  if (!ph) return null;
  return `${ph.getAttribute("type") ?? "body"}:${ph.getAttribute("idx") ?? ""}`;
}

async function placeholdersOf(zip: JSZipType, path: string, into: Map<string, Xfrm>): Promise<void> {
  const doc = await xml(zip, path);
  for (const sp of Array.from(doc?.getElementsByTagNameNS(P, "sp") ?? [])) {
    const key = placeholderKey(sp);
    const box = xfrmOf(child(sp, P, "spPr"));
    if (!key || !box) continue;
    into.set(key, box);
    // A slide's placeholder often names only its type, or only its index.
    const [type, idx] = key.split(":");
    if (!into.has(`${type}:`)) into.set(`${type}:`, box);
    if (idx && !into.has(`*:${idx}`)) into.set(`*:${idx}`, box);
  }
}

function colour(fillParent: Element | null, ctx: Ctx): string | null {
  const fill = child(fillParent, A, "solidFill");
  if (!fill) return null;
  const srgb = child(fill, A, "srgbClr");
  if (srgb) return `#${srgb.getAttribute("val")}`;
  const scheme = child(fill, A, "schemeClr");
  if (scheme) {
    const name = scheme.getAttribute("val") ?? "";
    const alias: Record<string, string> = { tx1: "dk1", tx2: "dk2", bg1: "lt1", bg2: "lt2" };
    return ctx.theme.get(alias[name] ?? name) ?? null;
  }
  return null;
}

function textBody(txBody: Element, ctx: Ctx, defaultPt: number): HTMLElement {
  const { doc } = ctx;
  const box = doc.createElement("div");
  box.className = "tx";
  const anchor = child(txBody, A, "bodyPr")?.getAttribute("anchor");
  box.style.justifyContent = anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start";
  for (const p of children(txBody, A, "p")) {
    const para = doc.createElement("p");
    const pPr = child(p, A, "pPr");
    const algn = pPr?.getAttribute("algn");
    para.style.textAlign = algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left";
    const level = num(pPr?.getAttribute("lvl"));
    const marL = pPr?.getAttribute("marL");
    if (marL !== null && marL !== undefined) para.style.paddingLeft = `${num(marL) / EMU_PER_PT}pt`;
    else if (level) para.style.paddingLeft = `${level * 18}pt`;
    if (pPr?.getAttribute("indent")) para.style.textIndent = `${num(pPr.getAttribute("indent")) / EMU_PER_PT}pt`;
    const lineSpacing = child(child(pPr, A, "lnSpc"), A, "spcPct")?.getAttribute("val");
    if (lineSpacing) para.style.lineHeight = String((num(lineSpacing) / 100000) * 1.2);
    const after = child(child(pPr, A, "spcAft"), A, "spcPts")?.getAttribute("val");
    if (after) para.style.marginBottom = `${num(after) / 100}pt`;
    const before = child(child(pPr, A, "spcBef"), A, "spcPts")?.getAttribute("val");
    if (before) para.style.marginTop = `${num(before) / 100}pt`;
    const bullet = child(pPr, A, "buChar")?.getAttribute("char");
    if (bullet && !child(pPr, A, "buNone")) {
      const b = doc.createElement("span");
      b.textContent = `${bullet} `;
      para.append(b);
    }
    let size = defaultPt;
    for (const r of Array.from(p.children)) {
      if (r.namespaceURI !== A) continue;
      if (r.localName === "br") {
        para.append(doc.createElement("br"));
        continue;
      }
      if (r.localName !== "r" && r.localName !== "fld") continue;
      const rPr = child(r, A, "rPr");
      const span = doc.createElement("span");
      span.textContent = child(r, A, "t")?.textContent ?? "";
      if (rPr?.getAttribute("sz")) size = num(rPr.getAttribute("sz")) / 100;
      span.style.fontSize = `${size}pt`;
      if (rPr?.getAttribute("b") === "1") span.style.fontWeight = "700";
      if (rPr?.getAttribute("i") === "1") span.style.fontStyle = "italic";
      if (rPr?.getAttribute("u") && rPr.getAttribute("u") !== "none") span.style.textDecoration = "underline";
      const c = colour(rPr, ctx);
      if (c) span.style.color = c;
      const face = child(rPr, A, "latin")?.getAttribute("typeface");
      // Theme font references (+mj-lt, +mn-lt) fall back to the frame's own font.
      if (face && !face.startsWith("+")) span.style.fontFamily = `"${face.replace(/"/g, "")}", Carlito, Calibri, system-ui, sans-serif`;
      para.append(span);
    }
    para.style.fontSize = `${size}pt`;
    if (!para.textContent) para.append(doc.createElement("br"));
    box.append(para);
  }
  return box;
}

function place(el: HTMLElement, box: Xfrm): void {
  el.style.left = `${box.x / EMU_PER_PT}pt`;
  el.style.top = `${box.y / EMU_PER_PT}pt`;
  el.style.width = `${box.w / EMU_PER_PT}pt`;
  el.style.height = `${box.h / EMU_PER_PT}pt`;
}

async function picture(pic: Element, ctx: Ctx, box: Xfrm): Promise<HTMLElement | null> {
  const blip = pic.getElementsByTagNameNS(A, "blip")[0];
  const id = blip?.getAttributeNS(R, "embed");
  const path = id ? ctx.rels.get(id) : undefined;
  const file = path ? ctx.zip.file(path) : null;
  if (!file) return null;
  const ext = path!.split(".").pop()!.toLowerCase();
  const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" } as Record<string, string>)[ext];
  if (!mime) return null;
  const img = ctx.doc.createElement("img");
  img.className = "shape";
  img.alt = "";
  img.src = `data:${mime};base64,${await file.async("base64")}`;
  place(img, box);
  return img;
}

function table(frame: Element, ctx: Ctx, box: Xfrm): HTMLElement | null {
  const tbl = frame.getElementsByTagNameNS(A, "tbl")[0];
  if (!tbl) return null;
  const { doc } = ctx;
  const wrap = doc.createElement("div");
  wrap.className = "shape";
  place(wrap, box);
  wrap.style.height = "auto";
  const t = doc.createElement("table");
  const grid = children(child(tbl, A, "tblGrid"), A, "gridCol");
  if (grid.length) {
    const cols = doc.createElement("colgroup");
    for (const g of grid) {
      const col = doc.createElement("col");
      col.style.width = `${num(g.getAttribute("w")) / EMU_PER_PT}pt`;
      cols.append(col);
    }
    t.append(cols);
    t.style.tableLayout = "fixed";
  }
  for (const tr of children(tbl, A, "tr")) {
    const row = doc.createElement("tr");
    for (const tc of children(tr, A, "tc")) {
      if (tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1") continue;
      const cell = doc.createElement("td");
      const span = num(tc.getAttribute("gridSpan"), 1);
      if (span > 1) cell.colSpan = span;
      const fill = colour(child(tc, A, "tcPr"), ctx);
      if (fill) cell.style.background = fill;
      const body = child(tc, A, "txBody");
      if (body) cell.append(textBody(body, ctx, 12));
      row.append(cell);
    }
    t.append(row);
  }
  wrap.append(t);
  return wrap;
}

async function shapes(tree: Element, ctx: Ctx, into: HTMLElement): Promise<void> {
  for (const el of Array.from(tree.children)) {
    if (el.namespaceURI !== P) continue;
    if (el.localName === "grpSp") {
      await shapes(el, ctx, into);
      continue;
    }
    const key = placeholderKey(el);
    const own = xfrmOf(child(el, P, "spPr")) ?? boxOf(child(el, P, "xfrm"));
    const box =
      own ??
      (key
        ? ctx.placeholders.get(key) ?? ctx.placeholders.get(`${key.split(":")[0]}:`) ?? ctx.placeholders.get(`*:${key.split(":")[1]}`)
        : undefined);
    if (!box) continue;

    if (el.localName === "pic") {
      const img = await picture(el, ctx, box);
      if (img) into.append(img);
    } else if (el.localName === "graphicFrame") {
      const t = table(el, ctx, box);
      if (t) into.append(t);
    } else if (el.localName === "sp") {
      const div = ctx.doc.createElement("div");
      div.className = "shape";
      place(div, box);
      const spPr = child(el, P, "spPr");
      const fill = colour(spPr, ctx);
      if (fill) div.style.background = fill;
      const line = colour(child(spPr, A, "ln"), ctx);
      if (line) div.style.border = `1pt solid ${line}`;
      if (spPr?.getElementsByTagNameNS(A, "prstGeom")[0]?.getAttribute("prst") === "ellipse") div.style.borderRadius = "50%";
      const type = key?.split(":")[0];
      const body = child(el, P, "txBody");
      if (body) div.append(textBody(body, ctx, type === "title" || type === "ctrTitle" ? 32 : 18));
      if (type === "title" || type === "ctrTitle") div.classList.add("title");
      into.append(div);
    }
  }
}

function background(doc: Document | null, ctx: Ctx): string | null {
  const bg = doc?.getElementsByTagNameNS(P, "bgPr")[0];
  return bg ? colour(bg, ctx) : null;
}

/** Draws every slide of a deck into `target`, each scaled to the target's width. */
export async function renderPptx(bytes: ArrayBuffer, target: HTMLElement): Promise<number> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(bytes);
  const doc = target.ownerDocument;
  const pres = await xml(zip, "ppt/presentation.xml");
  if (!pres) throw new Error("not a presentation");
  const size = pres.getElementsByTagNameNS(P, "sldSz")[0];
  const cx = num(size?.getAttribute("cx"), 12192000);
  const cy = num(size?.getAttribute("cy"), 6858000);
  const presRels = await relsOf(zip, "ppt/presentation.xml");
  const slidePaths = Array.from(pres.getElementsByTagNameNS(P, "sldId"))
    .map((s) => presRels.get(s.getAttributeNS(R, "id") ?? ""))
    .filter((p): p is string => !!p);

  const theme = new Map<string, string>();
  const themeDoc = await xml(zip, "ppt/theme/theme1.xml");
  const scheme = themeDoc?.getElementsByTagNameNS(A, "clrScheme")[0];
  for (const c of Array.from(scheme?.children ?? [])) {
    const v = child(c, A, "srgbClr")?.getAttribute("val") ?? child(c, A, "sysClr")?.getAttribute("lastClr");
    if (v) theme.set(c.localName, `#${v}`);
  }

  const widthPt = cx / EMU_PER_PT;
  const heightPt = cy / EMU_PER_PT;
  for (const [i, path] of slidePaths.entries()) {
    const slideDoc = await xml(zip, path);
    const tree = slideDoc?.getElementsByTagNameNS(P, "spTree")[0];
    if (!tree) continue;
    const rels = await relsOf(zip, path);
    const layout = [...rels.values()].find((t) => t.includes("slideLayouts/"));
    const layoutRels = layout ? await relsOf(zip, layout) : new Map<string, string>();
    const master = [...layoutRels.values()].find((t) => t.includes("slideMasters/"));
    const placeholders = new Map<string, Xfrm>();
    if (layout) await placeholdersOf(zip, layout, placeholders);
    if (master) {
      const fromMaster = new Map<string, Xfrm>();
      await placeholdersOf(zip, master, fromMaster);
      for (const [k, v] of fromMaster) if (!placeholders.has(k)) placeholders.set(k, v);
    }
    const ctx: Ctx = { zip, doc, theme, rels, dir: path, placeholders };

    const frame = doc.createElement("section");
    frame.className = "slide-frame";
    frame.setAttribute("aria-label", `Slide ${i + 1}`);
    const slide = doc.createElement("div");
    slide.className = "slide";
    slide.style.width = `${widthPt}pt`;
    slide.style.height = `${heightPt}pt`;
    slide.style.background =
      background(slideDoc, ctx) ??
      (layout ? background(await xml(zip, layout), ctx) : null) ??
      (master ? background(await xml(zip, master), ctx) : null) ??
      theme.get("lt1") ??
      "#fff";
    await shapes(tree, ctx, slide);
    const label = doc.createElement("div");
    label.className = "slide-number";
    label.textContent = String(i + 1);
    frame.append(slide, label);
    target.append(frame);
  }

  // Scale each slide to the frame's width; the frame keeps the slide's aspect ratio.
  const fit = () => {
    for (const frame of Array.from(target.querySelectorAll<HTMLElement>(".slide-frame"))) {
      const slide = frame.querySelector<HTMLElement>(".slide")!;
      const scale = frame.clientWidth / ((widthPt * 96) / 72);
      slide.style.transform = `scale(${scale})`;
      frame.style.height = `${((heightPt * 96) / 72) * scale}px`;
    }
  };
  fit();
  doc.defaultView?.addEventListener("resize", fit);
  return slidePaths.length;
}

/** Styles for the frame the previews draw into. */
export const OFFICE_FRAME_CSS = `
html,body{margin:0;background:#f3f3f1;color:#222;font-family:Calibri,Carlito,"Segoe UI",system-ui,sans-serif}
body{padding:16px}
a{pointer-events:none;color:inherit}
.docx-wrapper{background:transparent!important;padding:0!important}
.docx-wrapper>section.docx{box-shadow:0 1px 4px rgba(0,0,0,.15);margin:0 auto 16px!important}
.slide-frame{position:relative;margin:0 0 22px;overflow:hidden;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.18)}
.slide{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden}
.slide-number{position:absolute;right:8px;bottom:6px;font:11px system-ui;color:#888;background:rgba(255,255,255,.8);padding:0 5px;border-radius:3px}
.shape{position:absolute;box-sizing:border-box;overflow:hidden}
.tx{display:flex;flex-direction:column;height:100%;padding:3.6pt 7.2pt;box-sizing:border-box}
.tx p{margin:0;line-height:1.15}
.title .tx p{font-weight:600}
table{border-collapse:collapse;width:100%}
td{border:1pt solid #9a9a9a;vertical-align:top;padding:0}
td .tx{padding:2pt 4pt}
`;
