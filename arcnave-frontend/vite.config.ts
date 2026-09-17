import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The dev server proxies `/v1` to the backend.
 *
 * Same-origin in development is not only convenience: the session is an HttpOnly,
 * SameSite=Lax cookie, and a proxy keeps every request first-party, so the cookie travels
 * without loosening SameSite or widening CORS. `VITE_API_BASE` can still point the app at an
 * absolute URL when that is what you want.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env["VITE_API_PROXY"] || "http://127.0.0.1:8080";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/v1": {
          target,
          changeOrigin: false,
          // Server-sent events must not be buffered; without this a streamed answer would
          // arrive all at once when the run finished.
          ws: false,
        },
      },
    },
  };
});
