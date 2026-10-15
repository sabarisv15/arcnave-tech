/**
 * The dots logo engine (logo D1 "glowing dots + sky seed", touch effects C/A/B).
 *
 * Ported from docs/brand/Logo-Live.dc.html `liveLogo()` (the same engine is used by the
 * sign-in panel and the splash, per that board's "One engine" note). Numbers, easing and
 * geometry are the board's; only the types and the handle are new.
 *
 * Behaviour (Logo-Live "How it behaves"):
 *  1. Gather: dots fly in and land in 1.6 s; at big sizes a few papers turn into light first.
 *  2. Breathe: dots twinkle, the sky seed glows, a light wave crosses the leaf every 6.5 s.
 *  3. Touch (mode "papers"): dots near the pointer turn back into college papers; click: all of them.
 *  4. Touch effects only at 64 px and up. Under 64 px a solid leaf sits under the dots.
 *  5. Stays still: reduced motion draws one finished frame. Stops drawing while the tab is hidden.
 */

export type LiveLogoMode = "none" | "papers" | "tilt" | "sprout" | "pick";
export type LiveLogoTheme = "light" | "dark";

export interface LiveLogoOptions {
  /** Logo edge in CSS px (the leaf tile is 100 units wide). */
  size: number;
  /** Canvas edge as a multiple of `size`, so glow and papers can spill past the tile. */
  pad: number;
  theme: LiveLogoTheme;
  mode?: LiveLogoMode;
  /** Play the 1.6 s gather on mount. */
  intro?: boolean;
  /** Draw one frozen frame at this time (seconds) instead of animating. */
  still?: number;
  /** Element that receives pointer events; defaults to the canvas. */
  hover?: Element;
  /** Draw a finished frame and never animate (reduced motion). */
  reduceMotion?: boolean;
}

export interface LiveLogoHandle {
  stop(): void;
  replay(): void;
}

interface Dot {
  tx: number;
  ty: number;
  sky: 0 | 1;
  sx: number;
  sy: number;
  ph: number;
  f: number;
  d: number;
  q: number;
  z: number;
  pp: number;
  paper: boolean;
  rot: number;
  flip: number;
}

interface SproutDot {
  x: number;
  y: number;
  o: number;
  leaf: 0 | 1;
}

const TWO_PI = 6.283;

const clamp = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const ease2 = (u0: number): number => {
  const u = clamp(u0);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

/** Soft round sprite used for the glowing dots on dark backgrounds. */
function sprite(inner: string, outer: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (!g) return c;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.25, outer);
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return c;
}

const noopHandle: LiveLogoHandle = { stop() {}, replay() {} };

export function createLiveLogo(cv: HTMLCanvasElement, opt: LiveLogoOptions): LiveLogoHandle {
  const ctx = cv.getContext("2d");
  if (!ctx || typeof Path2D === "undefined" || typeof DOMMatrix === "undefined") return noopHandle;

  const size = opt.size;
  const pad = opt.pad;
  const theme = opt.theme;
  const mode: LiveLogoMode = opt.mode ?? "none";
  const W = size * pad;
  const H = size * pad;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  const ox = (W - size) / 2;
  const oy = (H - size) / 2;
  const k = size / 100;
  const cx = ox + 50 * k;
  const cy = oy + 50 * k;

  // Seeded so the same size always lays out the same dots.
  let seedState = 5 + Math.round(size);
  const rnd = (): number => {
    seedState = (seedState * 16807) % 2147483647;
    return (seedState - 1) / 2147483646;
  };

  const tile = new Path2D("M50 12 H84 Q88 12 88 16 V50 A38 38 0 0 1 50 88 H16 Q12 88 12 84 V50 A38 38 0 0 1 50 12 Z");
  const drop = new Path2D("M0 -24 C6 -14 11 -8 11 -1 A11 11 0 0 1 -11 -1 C-11 -8 -6 -14 0 -24Z");
  const seed = new Path2D();
  seed.addPath(drop, new DOMMatrix().translate(67, 33).rotate(225).scale(0.62));
  const offCtx = document.createElement("canvas").getContext("2d");
  if (!offCtx) return noopHandle;

  const step = Math.max(2.7, 290 / size);
  const sstep = step * 0.78;
  const jit = size > 120 ? 0.45 : 0.2;
  const P: Dot[] = [];
  const fresh = (tx: number, ty: number, sky: 0 | 1): Dot => ({
    tx, ty, sky, sx: 0, sy: 0, ph: 0, f: 0, d: 0, q: 0, z: 0, pp: 0, paper: false, rot: 0, flip: 0,
  });
  for (let y = 12 + step / 2; y < 88; y += step) {
    for (let x = 12 + step / 2; x < 88; x += step) {
      const jx = x + (rnd() - 0.5) * step * jit;
      const jy = y + (rnd() - 0.5) * step * jit;
      if (offCtx.isPointInPath(tile, jx, jy) && !offCtx.isPointInPath(seed, jx, jy)) P.push(fresh(jx, jy, 0));
    }
  }
  for (let y = 14; y < 52; y += sstep) {
    for (let x = 48; x < 86; x += sstep) {
      if (offCtx.isPointInPath(seed, x, y)) P.push(fresh(x, y, 1));
    }
  }
  for (const p of P) {
    const a = rnd() * TWO_PI;
    const R = 34 + rnd() * 46;
    p.sx = 50 + Math.cos(a) * R;
    p.sy = 50 + Math.sin(a) * R;
    p.ph = rnd() * TWO_PI;
    p.f = 0.8 + rnd() * 1.6;
    p.d = rnd();
    p.q = rnd();
    p.z = rnd() * 2 - 1;
    p.pp = 0;
    p.paper = size > 120 && rnd() < 0.14;
    p.rot = rnd() * 6.28;
    p.flip = 1.5 + rnd() * 2.5;
  }

  // sprout (mode "sprout"/"pick"): a stem from the seed and two leaves, all dots, in 100-unit space
  const SP: SproutDot[] = [];
  const ds = Math.max(1.7, step * 0.72);
  const bez = (u: number): [number, number] => {
    const a = [66.4, 31];
    const c = [62.5, 17];
    const b = [69.5, 3];
    const m = 1 - u;
    return [
      m * m * (a[0] ?? 0) + 2 * m * u * (c[0] ?? 0) + u * u * (b[0] ?? 0),
      m * m * (a[1] ?? 0) + 2 * m * u * (c[1] ?? 0) + u * u * (b[1] ?? 0),
    ];
  };
  for (let u = 0; u <= 1.0001; u += ds / 30) {
    const [x, y] = bez(u);
    SP.push({ x, y, o: u * 0.55, leaf: 0 });
  }
  const leaf = (lx: number, ly: number, rx: number, ry: number, ang: number, o0: number, side: number): void => {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let yy = -ry; yy <= ry; yy += ds * 0.9) {
      for (let xx = -rx; xx <= rx; xx += ds * 0.9) {
        const lim = ry * (1 - (xx * xx) / (rx * rx));
        if (Math.abs(yy) > lim) continue;
        SP.push({ x: lx + xx * ca - yy * sa, y: ly + xx * sa + yy * ca, o: o0 + ((side * xx) / rx + 1) * 0.2, leaf: 1 });
      }
    }
  };
  leaf(60.2, 8.6, 7.6, 3.6, -0.62, 0.5, -1);
  leaf(76.4, 4.2, 8.2, 3.8, 0.5, 0.55, 1);

  const SG = sprite("rgba(235,255,245,1)", "rgba(111,203,157,.55)");
  const SS = sprite("rgba(240,250,255,1)", "rgba(124,200,238,.6)");
  const SL = sprite("rgba(245,255,235,1)", "rgba(160,226,150,.6)");

  const INTRO = opt.intro === false ? 0 : 1.6;
  const SOLID = size < 64;
  const LIVE = !SOLID && mode !== "none";
  let t0 = performance.now();
  let last = t0;
  let raf = 0;
  let dead = false;
  let nowT = 0;
  let inside = false;
  let px = cx;
  let py = cy;
  let hov = 0;
  let nx = 0;
  let ny = 0;
  let clickT = -99;
  let grow = 0;

  const paperAt = (x: number, y: number, w: number, a: number, rot: number, fl: number): void => {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(Math.max(0.2, Math.abs(Math.cos(fl))), 1);
    const h = w * 1.3;
    if (theme === "dark") {
      ctx.fillStyle = `rgba(0,0,0,${a * 0.3})`;
      ctx.fillRect(-w / 2 + 1, -h / 2 + 1.5, w, h);
      ctx.fillStyle = `rgba(240,237,226,${a})`;
    } else {
      ctx.fillStyle = `rgba(20,35,32,${a * 0.1})`;
      ctx.fillRect(-w / 2 + 1, -h / 2 + 1.5, w, h);
      ctx.fillStyle = `rgba(252,250,244,${a})`;
    }
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (theme !== "dark") {
      ctx.strokeStyle = `rgba(20,35,32,${a * 0.35})`;
      ctx.lineWidth = 0.7;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    ctx.fillStyle = `rgba(90,110,100,${a * 0.75})`;
    for (let i = 1; i < 4; i++) {
      ctx.fillRect(-w * 0.34, -h / 2 + (h * i) / 4.4, w * (i === 1 ? 0.42 : 0.68), Math.max(0.5, h * 0.05));
    }
    ctx.restore();
    ctx.globalCompositeOperation = theme === "dark" ? "lighter" : "source-over";
  };

  const draw = (t: number, dt: number): void => {
    nowT = t;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const sm = (a: number, b: number, r: number): number => a + (b - a) * Math.min(1, dt * r);
    hov = sm(hov, inside ? 1 : 0, 5);
    nx = sm(nx, inside ? Math.max(-1, Math.min(1, (px - cx) / (size * 0.62))) : 0, 6);
    ny = sm(ny, inside ? Math.max(-1, Math.min(1, (py - cy) / (size * 0.62))) : 0, 6);
    const sinceClick = t - clickT;
    const wantGrow = (mode === "sprout" && inside) || ((mode === "sprout" || mode === "pick") && sinceClick < 2.4);
    grow += ((wantGrow ? 1 : 0) - grow) * Math.min(1, dt * (wantGrow ? 2.6 : 2.0));
    const shimmer = ((t % 6.5) / 6.5) * 260 - 60;
    const pulse = 0.55 + 0.45 * Math.sin(t * 1.7);
    const done = INTRO ? clamp((t - 0.2) / INTRO) : 1;
    // tilt (modes "tilt"/"pick"): the leaf turns toward the pointer like a leaf to sunlight
    const tilt = mode === "tilt" || mode === "pick" ? hov : 0;
    const ay = nx * 0.34 * tilt;
    const ax = -ny * 0.34 * tilt;
    const cay = Math.cos(ay);
    const say = Math.sin(ay);
    const cax = Math.cos(ax);
    const sax = Math.sin(ax);
    const proj = (X: number, Y: number, z: number): [number, number, number] => {
      const u = X - 50;
      const v = Y - 50;
      const w = z * 3.2;
      const u1 = u * cay + w * say;
      const w1 = -u * say + w * cay;
      const v1 = v * cax - w1 * sax;
      const w2 = v * sax + w1 * cax;
      const f = 150 / (150 - w2);
      return [50 + u1 * f, 50 + v1 * f, w2];
    };
    if (theme === "dark") {
      const hx = cx + nx * size * 0.08 * tilt;
      const hy = cy + ny * size * 0.08 * tilt;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, size * 0.72);
      g.addColorStop(0, `rgba(46,139,99,${(0.32 + 0.1 * tilt) * done})`);
      g.addColorStop(1, "rgba(46,139,99,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const [sgx, sgy] = proj(66.6 + nx * 3 * tilt, 33.4 + ny * 3 * tilt, 0.6);
    const flare = Math.max(grow * 0.6, tilt * 0.35, sinceClick < 1.2 ? 1 - sinceClick / 1.2 : 0);
    const gs = ctx.createRadialGradient(ox + sgx * k, oy + sgy * k, 0, ox + sgx * k, oy + sgy * k, size * (0.2 + 0.08 * flare));
    gs.addColorStop(
      0,
      `rgba(124,200,238,${Math.min(0.85, (theme === "dark" ? 0.5 : 0.35) * done * (0.6 + 0.4 * pulse) + flare * 0.3)})`,
    );
    gs.addColorStop(1, "rgba(124,200,238,0)");
    ctx.fillStyle = gs;
    ctx.fillRect(0, 0, W, H);
    const tileA = SOLID ? (INTRO ? clamp((t - INTRO * 0.85) / 0.35) : 1) : 0;
    if (tileA > 0) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(k, k);
      ctx.globalAlpha = tileA;
      ctx.fillStyle = "#2E8B63";
      ctx.fill(tile);
      ctx.fillStyle = theme === "dark" ? "#DDF3FC" : "#E6F6FD";
      ctx.fill(seed);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = theme === "dark" ? "lighter" : "source-over";
    const R = size * 0.26;
    for (const p of P) {
      const b = INTRO ? ease2((t - p.d * 0.5) / (INTRO - 0.45)) : 1;
      const br = Math.sin(t * p.f + p.ph);
      let X = p.tx + br * 0.22;
      let Y = p.ty + Math.cos(t * p.f * 0.8 + p.ph) * 0.22;
      let z = p.z;
      if (p.sky) {
        X += nx * 3 * tilt;
        Y += ny * 3 * tilt;
        z = 0.6;
      }
      const [qx, qy, wz] = proj(X, Y, z);
      const x = ox + (p.sx + (qx - p.sx) * b) * k;
      const y = oy + (p.sy + (qy - p.sy) * b) * k;
      const wave = Math.max(0, 1 - Math.abs(p.tx + p.ty - shimmer) / 18);
      // the side turned to the light is brighter
      const lit = 1 + 0.35 * tilt * ((wz + (X - 50) * Math.sin(ay) * 0.4 - (Y - 50) * Math.sin(ax) * 0.4) / 9);
      // papers: dots near the pointer turn back into the college papers they came from
      if (mode === "papers" && LIVE) {
        const near = inside ? clamp(1 - Math.hypot(x - px, y - py) / R) : 0;
        const want = Math.max(near * near * 1.4, sinceClick < 1.1 + p.d * 0.4 && sinceClick > p.d * 0.3 ? 1 : 0);
        p.pp += (Math.min(1, want) - p.pp) * Math.min(1, dt * 7);
      }
      if (p.paper && b < 0.9) paperAt(x, y, 7 * (1 - b) * k * 0.5 + 2, (1 - b) * 0.7, p.rot + t * 2, t * 3 + p.rot);
      if (p.pp > 0.03) paperAt(x, y, step * k * 1.55, p.pp * 0.88, p.rot * 0.4 - 0.2, t * p.flip + p.ph);
      const keep = 1 - p.pp;
      if (keep < 0.03) continue;
      const tw = 0.72 + 0.28 * br;
      if (theme === "dark") {
        const r = step * k * (p.sky ? 1.05 : 0.95) * (1 + wave * 0.3) * (p.sky ? 1 + flare * 0.25 : 1);
        ctx.globalAlpha = clamp(
          (((p.paper ? b : 0.25 + 0.75 * b) * (0.62 + 0.38 * p.q) * tw + wave * 0.45) * lit + (p.sky ? flare * 0.3 : 0)) *
            (1 - tileA * 0.75) *
            keep,
        );
        ctx.drawImage(p.sky ? SS : SG, x - r, y - r, r * 2, r * 2);
      } else {
        const r = Math.max(0.7, step * k * 0.3) * (p.sky ? 1.05 : 1) * (1 + wave * 0.15);
        const a = clamp(((0.25 + 0.75 * b) * (0.55 + 0.45 * p.q) * (0.8 + 0.2 * br) + wave * 0.35) * lit) * keep;
        ctx.globalAlpha = 1;
        ctx.fillStyle =
          tileA > 0
            ? p.sky
              ? `rgba(124,200,238,${a * (1 - tileA * 0.3)})`
              : `rgba(255,255,255,${a * (1 - tileA) + tileA * (0.14 + 0.22 * p.q) * (0.6 + 0.4 * br) + wave * 0.25 * tileA})`
            : p.sky
              ? `rgba(79,174,221,${a})`
              : wave > 0.3
                ? `rgba(63,165,118,${a})`
                : `rgba(46,139,99,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TWO_PI);
        ctx.fill();
      }
    }
    // sprout: the seed grows a little stem with two leaves, then folds back
    if (grow > 0.01 && LIVE) {
      for (const q of SP) {
        const g = clamp((grow * 1.15 - q.o) / 0.18);
        if (g <= 0) continue;
        const sway = (Math.sin(t * 1.3) * 0.8 * (31 - q.y)) / 28;
        const [qx, qy] = proj(q.x + sway, q.y, 0.8);
        const x = ox + qx * k;
        const y = oy + qy * k;
        if (theme === "dark") {
          const r = step * k * (q.leaf ? 0.95 : 0.8) * (0.4 + 0.6 * g);
          ctx.globalAlpha = clamp(g * (q.leaf ? 0.9 : 0.75));
          ctx.drawImage(q.leaf ? SL : SS, x - r, y - r, r * 2, r * 2);
        } else {
          ctx.globalAlpha = 1;
          ctx.fillStyle = q.leaf ? `rgba(63,165,118,${g})` : `rgba(79,174,221,${g * 0.9})`;
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.7, step * k * 0.3) * (0.5 + 0.5 * g), 0, TWO_PI);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  const reduce = opt.reduceMotion === true;
  const loop = (now: number): void => {
    if (dead) return;
    const t = (now - t0) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) draw(t, dt);
    raf = requestAnimationFrame(loop);
  };
  if (reduce || opt.still) draw(opt.still || 30, 0);
  else raf = requestAnimationFrame(loop);

  const host: Element = opt.hover ?? cv;
  const mm = (e: Event): void => {
    const pe = e as PointerEvent;
    const r = cv.getBoundingClientRect();
    px = (pe.clientX - r.left) * (W / r.width);
    py = (pe.clientY - r.top) * (H / r.height);
    inside = true;
  };
  const ml = (): void => {
    inside = false;
  };
  const ck = (e: Event): void => {
    mm(e);
    clickT = nowT;
  };
  const interactive = LIVE && !reduce && !opt.still;
  if (interactive) {
    host.addEventListener("pointermove", mm);
    host.addEventListener("pointerleave", ml);
    host.addEventListener("click", ck);
  }
  return {
    stop() {
      dead = true;
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", mm);
      host.removeEventListener("pointerleave", ml);
      host.removeEventListener("click", ck);
    },
    replay() {
      t0 = performance.now();
      clickT = -99;
      grow = 0;
      for (const p of P) p.pp = 0;
    },
  };
}
