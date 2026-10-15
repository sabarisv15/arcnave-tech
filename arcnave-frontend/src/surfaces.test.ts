import { describe, expect, it } from "vitest";
import { fileTile, savedAgo } from "./surfaces";

describe("file tiles (BS-Project side card)", () => {
  it("tint XLSX green, DOCX sky and PDF terracotta, as the board does, and label by extension", () => {
    expect(fileTile("UT2_marks.xlsx")).toEqual({ label: "XLSX", tone: "g" });
    expect(fileTile("Parents meeting notes.docx")).toEqual({ label: "DOCX", tone: "s" });
    expect(fileTile("Syllabus R2021 EEE.pdf")).toEqual({ label: "PDF", tone: "t" });
    expect(fileTile("deck.pptx")).toEqual({ label: "PPTX", tone: "m" });
    expect(fileTile("main.py")).toEqual({ label: "PY", tone: "v" });
    expect(fileTile("README")).toEqual({ label: "FILE", tone: "v" });
  });
});

describe("saved-ago label (BS-Artifact header)", () => {
  const at = Date.parse("2026-10-14T12:00:00Z");
  it("reads in minutes, then hours, then a date, and is empty when there is no time", () => {
    expect(savedAgo("2026-10-14T11:59:40Z", at)).toBe("saved just now");
    expect(savedAgo("2026-10-14T11:57:00Z", at)).toBe("saved 3 min ago");
    expect(savedAgo("2026-10-14T09:00:00Z", at)).toBe("saved 3 h ago");
    expect(savedAgo("2026-10-10T09:00:00Z", at)).toMatch(/^saved /);
    expect(savedAgo(null, at)).toBe("");
    expect(savedAgo("not a date", at)).toBe("");
  });
});
