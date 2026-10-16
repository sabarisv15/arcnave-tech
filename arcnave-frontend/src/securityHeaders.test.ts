/**
 * The web host's security headers (Stage 16 SE10, PH-2, ADR-0065).
 *
 * public/_headers is what production (Cloudflare static assets) serves; nginx.conf is the docker
 * compose stack. Both must carry the same set, the CSP must stay report-only until its reports
 * are clean, and its script hash must match the inline script the prerender step writes, or
 * every public page would report (and, once enforced, break).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel: string): string => readFileSync(path.join(here, rel), "utf8");

/** Header name → value from the `/*` block of a Cloudflare `_headers` file. */
function headersFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let inBlock = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) inBlock = line.trim() === "/*";
    else if (inBlock && line.trim() && !line.trim().startsWith("#")) {
      const at = line.indexOf(":");
      out.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
    }
  }
  return out;
}

/** Header name → value from nginx's server-level `add_header` lines. */
function nginxHeaders(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^ {4}add_header\s+(\S+)\s+"([^"]*)"\s+always;$/gm)) {
    out.set(m[1]!.toLowerCase(), m[2]!);
  }
  return out;
}

const web = headersFile(read("../public/_headers"));
const nginx = nginxHeaders(read("../nginx.conf"));

describe("web security headers", () => {
  it("sets nosniff, Referrer-Policy, HSTS, no framing and Permissions-Policy on every page", () => {
    expect(web.get("x-content-type-options")).toBe("nosniff");
    expect(web.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(web.get("strict-transport-security")).toMatch(/max-age=63072000; includeSubDomains/);
    expect(web.get("x-frame-options")).toBe("DENY");
    expect(web.get("content-security-policy-report-only")).toContain("frame-ancestors 'none'");
    // Dictation needs the microphone on the app's own origin (ADR-0042); nothing else here does.
    expect(web.get("permissions-policy")).toBe("camera=(), geolocation=(), payment=(), usb=(), microphone=(self)");
  });

  it("ships the CSP as report-only, never enforced", () => {
    expect(web.has("content-security-policy")).toBe(false);
    expect(nginx.has("content-security-policy")).toBe(false);
  });

  it("serves the same headers from nginx as from Cloudflare", () => {
    expect(Object.fromEntries(nginx)).toEqual(Object.fromEntries(web));
  });

  it("allows the prerender step's inline script by its hash", () => {
    const line = read("../scripts/prerender.mjs")
      .split("\n")
      .find((l) => l.includes("<script>"));
    const source = /`<script>(.*)<\/script><\/body>`/.exec(line ?? "")?.[1];
    expect(source).toBeDefined();
    // The file holds a template literal; its only escape is `\\` (one backslash in the output).
    const script = source!.replace(/\\\\/g, "\\");
    const hash = createHash("sha256").update(script).digest("base64");
    expect(web.get("content-security-policy-report-only")).toContain(`'sha256-${hash}'`);
  });
});
