import { describe, expect, it } from "vitest";
import { languageFromFilename, EXTENSION_TO_LANGUAGE } from "./codeLanguage";

describe("languageFromFilename", () => {
  it("maps all canonical extensions required by WP-01", () => {
    expect(languageFromFilename("main.py")).toBe("python");
    expect(languageFromFilename("app.ts")).toBe("typescript");
    expect(languageFromFilename("Component.tsx")).toBe("tsx");
    expect(languageFromFilename("index.js")).toBe("javascript");
    expect(languageFromFilename("query.sql")).toBe("sql");
    expect(languageFromFilename("deploy.sh")).toBe("bash");
    expect(languageFromFilename("config.json")).toBe("json");
    expect(languageFromFilename("page.html")).toBe("html");
    expect(languageFromFilename("styles.css")).toBe("css");
    expect(languageFromFilename("server.go")).toBe("go");
    expect(languageFromFilename("Main.java")).toBe("java");
    expect(languageFromFilename("script.rb")).toBe("ruby");
    expect(languageFromFilename("lib.rs")).toBe("rust");
    expect(languageFromFilename("Program.cs")).toBe("csharp");
    expect(languageFromFilename("api.php")).toBe("php");
    expect(languageFromFilename("docker-compose.yaml")).toBe("yaml");
    expect(languageFromFilename("ci.yml")).toBe("yaml");
  });

  it("handles case-insensitive extensions", () => {
    expect(languageFromFilename("SCRIPT.PY")).toBe("python");
    expect(languageFromFilename("App.TSX")).toBe("tsx");
    expect(languageFromFilename("DATA.JSON")).toBe("json");
  });

  it("extracts extension when filename has multiple dots", () => {
    expect(languageFromFilename("archive.tar.gz")).toBeUndefined();
    expect(languageFromFilename("component.test.tsx")).toBe("tsx");
    expect(languageFromFilename("my.custom.script.py")).toBe("python");
  });

  it("returns undefined when filename has no extension", () => {
    expect(languageFromFilename("Makefile")).toBeUndefined();
    expect(languageFromFilename("Dockerfile")).toBeUndefined();
    expect(languageFromFilename("")).toBeUndefined();
    expect(languageFromFilename(undefined)).toBeUndefined();
    expect(languageFromFilename("trailingdot.")).toBeUndefined();
  });

  it("returns undefined for unrecognized extensions", () => {
    expect(languageFromFilename("document.xyz")).toBeUndefined();
    expect(languageFromFilename("data.bin")).toBeUndefined();
  });
});
