/**
 * A slides artifact as a deck (ADR-0041): one slide at a time on a 16:9 canvas, a filmstrip of
 * every slide, arrow keys, full-screen presenting, speaker notes, and a print to PDF.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, Maximize2, NotebookText } from "lucide-react";
import { Markdown } from "./Content";
import { splitSlides, type Slide } from "./slides";

/** The canvas every slide is laid out on before it is scaled to fit. */
export const SLIDE_W = 960;
export const SLIDE_H = 540;

export function SlideCanvas({ slide, index }: { slide: Slide; index: number }) {
  // An opening slide with only a line or two under its title is laid out as a title slide.
  const cover = index === 0 && slide.body.split("\n").filter((l) => l.trim()).length <= 2 && !/^\s*[-*|]/m.test(slide.body);
  return (
    <div className={`slide-canvas ${cover ? "is-cover" : ""}`} style={{ width: SLIDE_W, height: SLIDE_H }}>
      <h2 className="slide-title">{slide.title}</h2>
      {slide.body && (
        <div className="slide-body">
          <Markdown text={slide.body} />
        </div>
      )}
    </div>
  );
}

/** Scales a fixed-size canvas to the width of its box, keeping 16:9. */
function Fit({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const byWidth = el.clientWidth / SLIDE_W;
      const byHeight = el.clientHeight > 0 && className.includes("fit-height") ? el.clientHeight / SLIDE_H : Infinity;
      setScale(Math.min(byWidth, byHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [className]);
  return (
    <div ref={box} className={`slide-fit ${className}`} style={className.includes("fit-height") ? undefined : { height: SLIDE_H * scale }}>
      <div className="slide-scale" style={{ transform: `scale(${scale})`, width: SLIDE_W, height: SLIDE_H }}>
        {children}
      </div>
    </div>
  );
}

/** A deck's first slide, for an artifact card. */
export function SlideThumbnail({ markdown }: { markdown: string }) {
  const first = useMemo(() => splitSlides(markdown)[0], [markdown]);
  if (!first) return null;
  return (
    <Fit>
      <SlideCanvas slide={first} index={0} />
    </Fit>
  );
}

/** Opens the deck in a print window, one slide per landscape page, for "Save as PDF". */
function printDeck(title: string, source: HTMLElement | null) {
  if (!source) return;
  const win = window.open("", "_blank", "noopener=no,width=1100,height=800");
  if (!win) return;
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((el) => el.outerHTML)
    .join("");
  const pages = Array.from(source.querySelectorAll(".slide-canvas"))
    .map((el) => `<div class="print-page">${el.outerHTML}</div>`)
    .join("");
  win.document.write(
    `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title>${styles}` +
      `<style>@page{size:${SLIDE_W}px ${SLIDE_H}px;margin:0}html,body{margin:0;background:#fff}` +
      `.print-page{width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;page-break-after:always;break-after:page}</style></head>` +
      `<body>${pages}</body></html>`,
  );
  win.document.close();
  win.addEventListener("load", () => {
    win.focus();
    win.print();
  });
}

export function SlidesView({ markdown, title }: { markdown: string; title: string }) {
  const slides = useMemo(() => splitSlides(markdown), [markdown]);
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const count = slides.length;
  const current = slides[Math.min(index, count - 1)];

  useEffect(() => {
    if (index > count - 1) setIndex(Math.max(0, count - 1));
  }, [count, index]);

  const go = useCallback((delta: number) => setIndex((i) => Math.max(0, Math.min(count - 1, i + delta))), [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (!presenting && !stage.current?.contains(document.activeElement)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (presenting && e.key === " ")) {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, presenting]);

  useEffect(() => {
    const onChange = () => setPresenting(document.fullscreenElement === stage.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-slide="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);

  if (!current)
    return (
      <p className="field-help slides-empty">
        This deck has no slides yet. Each slide starts with a <code>#</code> or <code>##</code> heading.
      </p>
    );

  return (
    <div className="slides-view">
      <div
        ref={stage}
        className={`slides-stage ${presenting ? "is-presenting" : ""}`}
        tabIndex={0}
        aria-roledescription="slide deck"
        aria-label={`${title}, slide ${index + 1} of ${count}`}
        onClick={() => presenting && go(1)}
      >
        <Fit className={presenting ? "fit-height" : ""}>
          <SlideCanvas slide={current} index={index} />
        </Fit>
      </div>
      <div className="slides-controls">
        <button className="icon-button" aria-label="Previous slide" disabled={index === 0} onClick={() => go(-1)}>
          <ChevronLeft size={16} />
        </button>
        <span className="slides-count" aria-live="polite">
          {index + 1} / {count}
        </span>
        <button className="icon-button" aria-label="Next slide" disabled={index === count - 1} onClick={() => go(1)}>
          <ChevronRight size={16} />
        </button>
        <span className="spacer" />
        <button className={`button ${notes ? "active" : ""}`} aria-pressed={notes} onClick={() => setNotes((n) => !n)}>
          <NotebookText size={14} /> Notes
        </button>
        <button className="button" onClick={() => printDeck(title, strip.current)}>
          <FileDown size={14} /> PDF
        </button>
        <button className="button primary" onClick={() => void stage.current?.requestFullscreen?.()}>
          <Maximize2 size={14} /> Present
        </button>
      </div>
      {notes && <div className="slides-notes">{current.notes || <span className="field-help">No notes for this slide.</span>}</div>}
      <div ref={strip} className="slides-strip" role="list" aria-label="Slides">
        {slides.map((s, i) => (
          <button
            key={i}
            role="listitem"
            data-slide={i}
            className={`slides-thumb ${i === index ? "active" : ""}`}
            aria-label={`Slide ${i + 1}: ${s.title}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => setIndex(i)}
          >
            <Fit>
              <SlideCanvas slide={s} index={i} />
            </Fit>
            <span className="slides-thumb-number">{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
