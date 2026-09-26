// Maps common file extensions to highlight.js language identifiers.
// Used for code artifacts and snippet language detection.
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  py: "python",
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  json: "json",
  html: "html",
  css: "css",
  go: "go",
  java: "java",
  rb: "ruby",
  rs: "rust",
  cs: "csharp",
  php: "php",
  yaml: "yaml",
  yml: "yaml",
};

/**
 * Derives a highlight language from a filename or artifact title.
 * Returns undefined when the extension is absent or not in the known language map,
 * allowing caller/rehype-highlight to use automatic language detection.
 */
export function languageFromFilename(filename?: string): string | undefined {
  if (!filename) return undefined;
  const match = filename.trim().match(/\.([a-zA-Z0-9_-]+)$/);
  if (!match) return undefined;
  const ext = match[1].toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext];
}
