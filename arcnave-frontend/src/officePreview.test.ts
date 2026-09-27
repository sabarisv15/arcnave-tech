// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { formatCell } from "./FilePreviews";
import { officeKind, renderPptx } from "./officePreview";

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

async function deck(slideBody: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file("ppt/slides/slide1.xml", `<p:sld ${NS}><p:cSld><p:spTree>${slideBody}</p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

const textBox = (text: string, extra = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="12700" y="25400"/><a:ext cx="1270000" cy="635000"/></a:xfrm></p:spPr>` +
  `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="2400" b="1"${extra}/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;

describe("officeKind", () => {
  it("names the kind by extension or media type", () => {
    expect(officeKind("a.DOCX", "")).toBe("docx");
    expect(officeKind("deck", "application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe("pptx");
    expect(officeKind("b.xlsx", "")).toBe("xlsx");
    expect(officeKind("c.pdf", "application/pdf")).toBeNull();
  });
});

describe("renderPptx", () => {
  it("draws each slide's text where the file puts it, at its size", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const count = await renderPptx(await deck(textBox("Quarterly review")), target);
    expect(count).toBe(1);
    const shape = target.querySelector<HTMLElement>(".slide .shape")!;
    expect(shape.style.left).toBe("1pt");
    expect(shape.style.top).toBe("2pt");
    expect(shape.style.width).toBe("100pt");
    const run = shape.querySelector<HTMLElement>("span")!;
    expect(run.textContent).toBe("Quarterly review");
    expect(run.style.fontSize).toBe("24pt");
    expect(run.style.fontWeight).toBe("700");
  });

  it("shows markup in a slide as text, never as elements", async () => {
    const target = document.createElement("div");
    await renderPptx(await deck(textBox("&lt;img src=x onerror=alert(1)&gt;")), target);
    expect(target.querySelector("img")).toBeNull();
    expect(target.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("formatCell", () => {
  it("shows cells as a spreadsheet would", () => {
    expect(formatCell({ value: 0.256, type: "number", numFmt: "0.0%" })).toBe("25.6%");
    expect(formatCell({ value: 1234567.5, type: "number", numFmt: "#,##0.00" })).toBe("12,34,567.50");
    expect(formatCell({ value: 3, type: "number" })).toBe("3");
    expect(formatCell({ value: true, type: "boolean" })).toBe("TRUE");
    expect(formatCell({ value: "2026-01-15T00:00:00.000Z", type: "date" })).toBe("2026-01-15");
    expect(formatCell({ value: null, type: null })).toBe("");
  });
});
