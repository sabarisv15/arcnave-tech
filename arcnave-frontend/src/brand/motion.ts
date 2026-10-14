import { useEffect, useState } from "react";

/**
 * True when the logo should stay still: the OS asks for reduced motion, or the user turned
 * motion off in Settings (session.tsx writes that as `<html data-motion="reduced">`).
 * Brand-Locked: "Reduce-motion setting on -> still logo only."
 */
export function prefersStillMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset["motion"] === "reduced") {
    return true;
  }
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export type BrandTheme = "light" | "dark";

/** The theme session.tsx wrote on `<html data-theme>`; light until something says otherwise. */
export function documentTheme(): BrandTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset["theme"] === "dark" ? "dark" : "light";
}

/** Follows `<html data-theme>` so canvas logos redraw when the user switches theme. */
export function useDocumentTheme(): BrandTheme {
  const [theme, setTheme] = useState<BrandTheme>(documentTheme);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const sync = () => setTheme(documentTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
