import { describe, expect, it } from "vitest";
import { splitSlides } from "./slides";

describe("splitSlides", () => {
  it("starts a slide at each # or ## heading, as the PowerPoint export does", () => {
    const slides = splitSlides(
      "intro text that is on no slide\n# Title\nSeptember\n## Revenue\n- Up 12%\n### A card\nbody\nNotes: say it first\n## Costs\n| a | b |\n|---|---|\n",
    );
    expect(slides.map((s) => s.title)).toEqual(["Title", "Revenue", "Costs"]);
    expect(slides[0]!.body).toBe("September");
    expect(slides[1]!.body).toBe("- Up 12%\n### A card\nbody");
    expect(slides[1]!.notes).toBe("say it first");
  });

  it("gives no slides for Markdown without a heading", () => {
    expect(splitSlides("just text\n- a bullet")).toEqual([]);
  });
});
