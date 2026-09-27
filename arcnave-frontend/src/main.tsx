import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import PublicSite, { cleanPath, publicPaths } from "./Landing";
// Open-licensed (OFL) fonts, bundled with the app so no page load depends on another host.
import "@fontsource-variable/inter";
import "@fontsource-variable/inter/wght-italic.css";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/700.css";
import "./styles.css";
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
