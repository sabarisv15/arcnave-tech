/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the API lives. Defaults to `/v1`, which the dev server proxies to the backend. */
  readonly VITE_API_BASE?: string;
  /** OAuth client id (Web) for Google sign-in (ADR-0056). Unset hides the Google button. */
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
