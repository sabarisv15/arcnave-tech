import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import PublicSite, { cleanPath, publicPaths } from "./Landing";
// Open-licensed (OFL) fonts, bundled with the app so no page load depends on another host.
// Brand fonts (Onest, Source Serif 4, Noto Serif/Sans Tamil, JetBrains Mono) and the brand tokens
// load first, so styles.css can map its older variables onto them.
import "./brand/fonts";
import "./brand/tokens.css";
// Inter is kept only for landing.css (the public site still names it); the app shell no longer does.
import "@fontsource-variable/inter";
import "@fontsource-variable/inter/wght-italic.css";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/700.css";
import "./styles.css";
// App shell M2, composer K3, messages M1 (G1); after styles.css so it wins at equal specificity.
import "./shell.css";
// Projects, project page, library, share dialog, artifact panel, chart cards (G4); after shell.css.
import "./surfaces.css";
// Chat states (G3) and the Settings page (G3); after shell.css so they win at equal specificity.
import "./chat-states.css";
import "./settings.css";
const App = lazy(() => import("./App"));
function Entry() {
  const { pathname } = useLocation();
  if (publicPaths.has(cleanPath(pathname))) return <PublicSite />;
  return <Suspense fallback={<div className="boot-screen">Opening ArcNave…</div>}><App /></Suspense>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Entry />
    </BrowserRouter>
  </React.StrictMode>,
);
