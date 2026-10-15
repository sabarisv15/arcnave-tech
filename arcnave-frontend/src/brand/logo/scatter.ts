/**
 * "Scattered -> one point": the brand motion (Brand-Locked "Logo motion", Brand-Motion,
 * Splash-v3). Two painters, both ported from the boards:
 *
 *  - `createSplashPainter` (Splash-v3.dc.html `make()`): the app-open splash. "first" is 3 s with
 *    college papers that turn into dots of light and gather into the leaf; "quick" is 1 s, no
 *    papers, dots gather 0-0.65 s then the logo. The rich logo element fades in over the dots.
 *  - `createLoopPainter` (Brand-Motion.dc.html `init()`): the 16 s sign-in / website loop on the
 *    night-green backdrop.
 *
 * Painters only draw one frame for a given time; ScatterToPoint.tsx owns the clock.
 */

export type SplashVariant = "first" | "quick";
export type SplashTheme = "light" | "dark";

export interface SplashPainter {
  /** Seconds of motion: 3 for "first", 1 for "quick" (Splash-v3). */
  readonly duration: number;
  /** Draws one frame; returns the wordmark opacity 0..1 for that time (board `wordA`). */
  draw(t: number): number;
}

const clamp = (u: number): number => (u < 0 ? 0 : u > 1 ? 1 : u);
const ease = (u0: number): number => {
  const u = clamp(u0);
  return u * u * (3 - 2 * u);
};
const ease2 = (u0: number): number => {
  const u = clamp(u0);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

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

const TILE_D = "M50 12 H84 Q88 12 88 16 V50 A38 38 0 0 1 50 88 H16 Q12 88 12 84 V50 A38 38 0 0 1 50 12 Z";
const DROP_D = "M0 -24 C6 -14 11 -8 11 -1 A11 11 0 0 1 -11 -1 C-11 -8 -6 -14 0 -24Z";

function logoPaths(): { tile: Path2D; seed: Path2D; off: CanvasRenderingContext2D } | null {
  const off = document.createElement("canvas").getContext("2d");
  if (!off || typeof Path2D === "undefined" || typeof DOMMatrix === "undefined") return null;
  const tile = new Path2D(TILE_D);
  const seed = new Path2D();
  seed.addPath(new Path2D(DROP_D), new DOMMatrix().translate(67, 33).rotate(225).scale(0.62));
  return { tile, seed, off };
}

const THEMES = {
  // Splash-v3 TH: light, dark. (The board's "green" Android system splash is native, not web.)
  light: { bg: "#FFFFFF", dot: [46, 139, 99], seed: [124, 200, 238], glow: false },
  dark: { bg: "#151C1A", dot: [111, 203, 157], seed: [155, 218, 246], glow: true },
} as const;

export interface SplashOptions {
  canvas: HTMLCanvasElement;
  variant: SplashVariant;
  theme: SplashTheme;
  /** Edge of the logo the dots gather into, in px (board: 96). */
  logoSize: number;
  /** Logo centre as a fraction of the canvas height (board: 0.44). */
  logoY: number;
}

interface SplashDot {
  tx: number; ty: number; sky: number; x0: number; y0: number; a: number; rr: number; d: number;
  vx: number; vy: number; rot: number; spin: number; flip: number; z: number; paper: boolean; pw: number;
}

export function createSplashPainter(o: SplashOptions): SplashPainter | null {
  const ctx = o.canvas.getContext("2d");
  const paths = logoPaths();
  if (!ctx || !paths) return null;
  const { tile, seed: seedP, off } = paths;
  const mode = o.variant === "first" ? "full" : "quick";
  const TH = THEMES[o.theme];
  const duration = mode === "full" ? 3.0 : 1.0;
  let s = 5;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const step = 3.3;
  const sstep = 2.4;
  const T: Array<[number, number, number]> = [];
  for (let y = 12 + step / 2; y < 88; y += step) {
    for (let x = 12 + step / 2; x < 88; x += step) {
      const jx = x + (rnd() - 0.5) * step * 0.45;
      const jy = y + (rnd() - 0.5) * step * 0.45;
      if (off.isPointInPath(tile, jx, jy) && !off.isPointInPath(seedP, jx, jy)) T.push([jx, jy, 0]);
    }
  }
  for (let y = 16; y < 50; y += sstep) {
    for (let x = 50; x < 84; x += sstep) {
      if (off.isPointInPath(seedP, x, y)) T.push([x, y, 1]);
    }
  }
  const P: SplashDot[] = T.map((t) => ({
    tx: t[0], ty: t[1], sky: t[2], x0: rnd(), y0: rnd(), a: rnd() * 6.283, rr: rnd(), d: rnd(),
    vx: (rnd() - 0.5) * 26, vy: (rnd() - 0.5) * 26, rot: rnd() * 6.283, spin: (rnd() - 0.5) * 2.4,
    flip: 1 + rnd() * 2, z: 0.45 + rnd() * 0.55, paper: mode === "full" && rnd() < 0.24, pw: 10 + rnd() * 9,
  }));
  const SG = sprite("rgba(235,255,245,1)", "rgba(111,203,157,.55)");
  const SS = sprite("rgba(240,250,255,1)", "rgba(124,200,238,.6)");
  const rgba = (c: readonly number[], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  const draw = (t: number): number => {
    const r = o.canvas.getBoundingClientRect();
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const W = r.width;
    const H = r.height;
    const w = Math.round(W * DPR);
    const h = Math.round(H * DPR);
    if (o.canvas.width !== w || o.canvas.height !== h) {
      o.canvas.width = w;
      o.canvas.height = h;
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = TH.bg;
    ctx.fillRect(0, 0, W, H);
    const L = o.logoSize;
    const cx = W / 2;
    const cy = H * o.logoY;
    const k = L / 100;
    const ox = cx - L / 2;
    const oy = cy - L / 2;
    // phase curves (Splash-v3)
    let conv: (p: SplashDot) => number;
    let wordA: number;
    if (mode === "full") {
      conv = (p) => ease((t - 0.7 - p.d * 0.3) / 0.4);
      wordA = ease((t - 2.35) / 0.5);
    } else {
      conv = () => 1;
      wordA = ease((t - 0.6) / 0.3);
    }
    const tileA = 0;
    const gath = (p: SplashDot): number =>
      mode === "full" ? ease2((t - 0.95 - p.d * 0.35) / 0.95) : ease2((t - p.d * 0.15) / 0.5);
    for (const p of P) {
      let sx: number;
      let sy: number;
      if (mode === "full") {
        sx = p.x0 * W + p.vx * t;
        sy = p.y0 * H + p.vy * t;
      } else {
        const R = 0.34 * Math.min(W, H) * (1 + p.rr * 1.1);
        sx = cx + Math.cos(p.a) * R;
        sy = cy + Math.sin(p.a) * R;
      }
      const b = gath(p);
      const c = conv(p);
      const tx = ox + p.tx * k;
      const ty = oy + p.ty * k;
      const x = sx + (tx - sx) * b;
      const y = sy + (ty - sy) * b;
      // paper (first open only)
      if (p.paper && c < 1) {
        const a = (1 - c) * (0.35 + 0.55 * p.z);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot + t * p.spin);
        ctx.scale(Math.max(0.18, Math.abs(Math.cos(t * p.flip + p.rot))), 1);
        const pw = p.pw * (1 - 0.6 * c);
        const ph = pw * 1.32;
        ctx.fillStyle = TH.glow ? `rgba(0,0,0,${a * 0.35})` : `rgba(20,35,32,${a * 0.16})`;
        ctx.fillRect(-pw / 2 + 1.5, -ph / 2 + 2, pw, ph);
        ctx.fillStyle = TH.glow ? `rgba(240,237,226,${a})` : `rgba(250,248,242,${a})`;
        ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
        if (!TH.glow) {
          ctx.strokeStyle = `rgba(20,35,32,${a * 0.38})`;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
        }
        ctx.fillStyle = `rgba(90,110,100,${a * 0.7})`;
        for (let i = 1; i < 5; i++) {
          ctx.fillRect(-pw * 0.36, -ph / 2 + (ph * i) / 5.6, pw * (i === 1 ? 0.45 : 0.72), Math.max(0.6, ph * 0.03));
        }
        ctx.restore();
      }
      if (!p.paper || c > 0) {
        const vis = (p.paper ? c : mode === "full" ? 0.35 + 0.65 * c : 1) * (1 - tileA);
        if (vis <= 0.01) continue;
        const col = p.sky ? TH.seed : TH.dot;
        if (TH.glow) {
          ctx.globalCompositeOperation = "lighter";
          const rad = 4.2 * (0.75 + 0.25 * b);
          ctx.globalAlpha = vis * (0.55 + 0.4 * p.z);
          ctx.drawImage(p.sky ? SS : SG, x - rad, y - rad, rad * 2, rad * 2);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
        } else {
          const rad = (0.95 + 0.55 * b) * (p.sky ? 1.15 : 1);
          ctx.fillStyle = rgba(col, vis * (0.45 + 0.55 * Math.max(b, p.z * 0.6)));
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, 6.283);
          ctx.fill();
        }
      }
    }
    // The dots stay as the logo (Splash-v3: web/iOS splash keep tileA = 0); the wordmark beat is
    // returned so the caller can fade a Wordmark in with the same curve.
    return wordA;
  };
  return { duration, draw };
}

// ----------------------------------------------------------------------------------------------
// 16 s loop (Brand-Motion.dc.html)

export interface LoopOptions {
  canvas: HTMLCanvasElement;
  /** Logo size as a fraction of the shorter canvas side (board data-s, default .62). */
  scale?: number;
  /** Logo centre as fractions of the canvas (board data-x / data-y, default .5 / .44). */
  x?: number;
  y?: number;
}

export interface LoopPainter {
  draw(time: number): void;
}

export const LOOP_SECONDS = 16;

export function createLoopPainter(o: LoopOptions): LoopPainter | null {
  const cv = o.canvas;
  const ctx = cv.getContext("2d");
  const paths = logoPaths();
  if (!ctx || !paths) return null;
  const { tile, seed, off } = paths;
  const CF = { s: o.scale ?? 0.62, x: o.x ?? 0.5, y: o.y ?? 0.44 };
  let W = 0;
  let H = 0;
  let DPR = 1;
  const size = (): void => {
    const r = cv.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(r.width * DPR));
    const h = Math.max(2, Math.round(r.height * DPR));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    W = r.width;
    H = r.height;
  };
  let s = 7;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
  const inTile = (x: number, y: number): boolean => off.isPointInPath(tile, x, y) && !off.isPointInPath(seed, x, y);
  const inSeed = (x: number, y: number): boolean => off.isPointInPath(seed, x, y);
  const T: Array<[number, number, number]> = [];
  for (let y = 12.6; y < 88; y += 2.6) {
    for (let x = 12.6; x < 88; x += 2.6) {
      const jx = x + (rnd() - 0.5) * 1.5;
      const jy = y + (rnd() - 0.5) * 1.5;
      if (inTile(jx, jy)) T.push([jx, jy, 0]);
    }
  }
  for (let y = 18; y < 48; y += 1.9) {
    for (let x = 52; x < 82; x += 1.9) {
      const jx = x + (rnd() - 0.5) * 0.5;
      const jy = y + (rnd() - 0.5) * 0.5;
      if (inSeed(jx, jy)) T.push([jx, jy, 1]);
    }
  }
  const P = T.map((t) => ({
    tx: t[0], ty: t[1], sky: t[2], x0: rnd(), y0: rnd(), vx: (rnd() - 0.5) * 18, vy: -6 - rnd() * 10,
    a0: rnd() * 6.28, spin: (rnd() - 0.5) * 0.9, z: 0.35 + rnd() * 0.65, pw: 9 + rnd() * 12, ph: rnd() * 6.28,
    f1: 0.6 + rnd() * 0.8, d: rnd() * 1.4, r: 1.1 + rnd() * 0.9, paper: rnd() < 0.22, flip: 0.4 + rnd() * 0.9,
  }));
  const B = Array.from({ length: 16 }, () => ({
    x: rnd(), y: rnd(), r: 40 + rnd() * 90, sp: 0.004 + rnd() * 0.01, ph: rnd() * 6.28, a: 0.05 + rnd() * 0.08,
  }));
  const SG = sprite("rgba(235,255,245,1)", "rgba(111,203,157,.55)");
  const SS = sprite("rgba(240,250,255,1)", "rgba(124,200,238,.6)");

  const draw = (time: number): void => {
    size();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const t = time % LOOP_SECONDS;
    const U = Math.min(W, H) / 700;
    // backdrop: Night greens (tokens --color-night-1/2/3)
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.42, 10, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#163A2E");
    bg.addColorStop(0.6, "#0C2219");
    bg.addColorStop(1, "#06120D");
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // bokeh
    ctx.globalCompositeOperation = "lighter";
    for (const b of B) {
      const x = (((b.x + time * b.sp) % 1.2) - 0.1) * W;
      const y = (b.y + Math.sin(time * 0.1 + b.ph) * 0.03) * H;
      const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
      g.addColorStop(0, `rgba(120,190,150,${b.a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - b.r, y - b.r, b.r * 2, b.r * 2);
    }
    const L = Math.min(W, H) * CF.s;
    const ox = W * CF.x - L / 2;
    const oy = H * CF.y - L / 2;
    const k = L / 100;
    const gAll = t < 5 ? 0 : t < 9.5 ? ease((t - 5) / 4.5) : t < 12.5 ? 1 : 1 - ease((t - 12.5) / 3);
    if (gAll > 0) {
      const cx = ox + 50 * k;
      const cy = oy + 50 * k;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, L * 0.75);
      g.addColorStop(0, `rgba(80,180,130,${0.18 * gAll})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - L, cy - L, 2 * L, 2 * L);
      const sx = ox + 67 * k;
      const sy = oy + 33 * k;
      const pulse = 0.55 + 0.45 * Math.sin(Math.max(0, t - 9) * 2.2);
      const gs = ctx.createRadialGradient(sx, sy, 0, sx, sy, L * 0.28);
      gs.addColorStop(0, `rgba(155,218,246,${0.16 * gAll * pulse})`);
      gs.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gs;
      ctx.fillRect(sx - L, sy - L, 2 * L, 2 * L);
    }
    for (const p of P) {
      // scattered position: drifting paper (continuous in time)
      const sx = ((((p.x0 * (W + 120) + time * p.vx + Math.sin(time * 0.23 * p.f1 + p.ph) * 30) % (W + 120)) + (W + 120)) % (W + 120)) - 60;
      const sy = ((((p.y0 * (H + 120) + time * p.vy + Math.sin(time * 0.17 * p.f1 + p.ph * 2) * 22) % (H + 120)) + (H + 120)) % (H + 120)) - 60;
      let b: number;
      if (t < 5) b = 0;
      else if (t < 9.5) b = ease2((t - 5 - p.d) / 3.0);
      else if (t < 12.5) b = 1;
      else b = 1 - ease2((t - 12.5 - p.d * 0.6) / 2.6);
      const br = Math.sin(time * 1.6 + p.ph) * 0.35;
      const tx = ox + (p.tx + br * 0.4) * k;
      const ty = oy + (p.ty + br * 0.3) * k;
      const lift = (t > 12.5 ? -60 : 0) * Math.sin(Math.PI * (1 - b)) * (1 - b);
      const x = sx + (tx - sx) * b;
      const y = sy + (ty - sy) * b + lift;
      if (b < 0.98 && p.paper) {
        ctx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.a0 + time * p.spin * (1 - b));
        ctx.scale(Math.max(0.15, Math.abs(Math.cos(time * p.flip + p.ph))), 1);
        const sc = (1 - b) * (0.5 + 0.9 * p.z);
        const w = (p.pw + 6) * sc * Math.max(0.45, U);
        const h = (p.pw + 6) * 1.32 * sc * Math.max(0.45, U);
        const a = (0.08 + 0.5 * p.z * p.z) * (1 - b);
        ctx.fillStyle = `rgba(0,0,0,${a * 0.35})`;
        ctx.fillRect(-w / 2 + 2, -h / 2 + 3, w, h);
        ctx.fillStyle = `rgba(240,237,226,${a})`;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = `rgba(90,110,100,${a * 0.8})`;
        for (let i = 1; i < 5; i++) {
          ctx.fillRect(-w * 0.36, -h / 2 + (h * i) / 5.6, w * (i === 1 ? 0.45 : 0.72), Math.max(0.5, h * 0.028));
        }
        ctx.restore();
      } else if (b < 0.98) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = (1 - b) * 0.25 * p.z;
        ctx.drawImage(SG, x - 3, y - 3, 6, 6);
        ctx.globalAlpha = 1;
      }
      if (b > 0.02) {
        ctx.globalCompositeOperation = "lighter";
        const r = p.r * 4.3 * Math.max(0.55, U) * (0.7 + 0.3 * b) * (p.sky ? 1.1 : 1);
        ctx.globalAlpha = Math.min(1, b * (0.55 + 0.35 * p.z));
        ctx.drawImage(p.sky ? SS : SG, x - r, y - r, 2 * r, 2 * r);
        ctx.globalAlpha = 1;
      }
    }
    // vignette
    ctx.globalCompositeOperation = "source-over";
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  };
  return { draw };
}
