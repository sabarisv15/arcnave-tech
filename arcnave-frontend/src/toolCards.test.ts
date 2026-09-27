import { describe, expect, it } from "vitest";

import { extractToolCardData } from "./toolCards";
import type { ToolCall } from "./types";

const saved = (id: string, names: string[]): ToolCall =>
  ({
    toolCallId: id,
    name: "run_python",
    ok: true,
    content: [
      {
        type: "json",
        data: {
          persistedFiles: names.map((filename) => ({
            filename,
            mimeType: "application/xml",
            sizeBytes: 100,
            downloadUrl: `/v1/files/${id}-${filename}/download`,
          })),
        },
      },
    ],
  }) as unknown as ToolCall;

describe("extractToolCardData", () => {
  it("shows a file saved twice in one turn once, as its latest version", () => {
    const { deliverables } = extractToolCardData([
      saved("a", ["KVB_Masters.xml", "KVB_Transactions.xml"]),
      saved("b", ["KVB_Masters.xml", "KVB_Transactions.xml", "Federal_Masters.xml"]),
    ]);
    expect(deliverables.map((d) => d.filename)).toEqual([
      "KVB_Masters.xml",
      "KVB_Transactions.xml",
      "Federal_Masters.xml",
    ]);
    expect(deliverables[0]!.downloadUrl).toBe("/v1/files/b-KVB_Masters.xml/download");
  });

  it("shows image_search results from the web, and drops anything that is not a web address", () => {
    const found = {
      toolCallId: "i",
      name: "image_search",
      ok: true,
      content: [
        {
          type: "json",
          data: {
            images: [
              { title: "Temple", imageUrl: "https://a.example/t.jpg", thumbnailUrl: "https://a.example/t_s.jpg", sourceUrl: "https://a.example/page" },
              { title: "Bad", imageUrl: "javascript:alert(1)", thumbnailUrl: "javascript:alert(1)", sourceUrl: "" },
            ],
          },
        },
      ],
    } as unknown as ToolCall;
    const { webImages, deliverables } = extractToolCardData([found]);
    expect(deliverables).toEqual([]);
    expect(webImages).toEqual([
      { title: "Temple", imageUrl: "https://a.example/t.jpg", thumbnailUrl: "https://a.example/t_s.jpg", sourceUrl: "https://a.example/page" },
    ]);
  });
});
