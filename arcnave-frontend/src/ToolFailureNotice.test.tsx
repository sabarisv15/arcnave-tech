import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { errorCopy } from "./api";
import ToolActivity, { toolFailureNotice } from "./ToolActivity";
import type { ToolCall } from "./types";

/**
 * A tool failure the server names by a stable code shows that code's copy (Invariant 5,
 * ADR-0070): `sandbox_misconfigured` when the code sandbox cannot move files.
 */
describe("tool failures named by code", () => {
  const failed: ToolCall = {
    toolCallId: "t1",
    name: "present_files",
    input: { filepaths: ["chart.png"] },
    ok: false,
    preview: "some model-facing text that the copy must not come from",
    errorCode: "sandbox_misconfigured",
  };

  it("has copy for sandbox_misconfigured and looks it up by the code", () => {
    expect(errorCopy).toHaveProperty("sandbox_misconfigured");
    expect(toolFailureNotice(failed)).toEqual(errorCopy["sandbox_misconfigured"]);
  });

  it("renders the copy on the failed step", () => {
    const html = renderToStaticMarkup(<ToolActivity calls={[failed]} working answering={false} />);
    expect(html).toContain(errorCopy["sandbox_misconfigured"]!.title);
    expect(html).toContain("activity-step-notice");
  });

  it("shows nothing for a success, a failure without a code, or a code it does not know", () => {
    expect(toolFailureNotice({ ...failed, ok: true })).toBeNull();
    expect(toolFailureNotice({ ...failed, errorCode: undefined })).toBeNull();
    expect(toolFailureNotice({ ...failed, errorCode: "teapot_on_fire" })).toBeNull();
    const html = renderToStaticMarkup(
      <ToolActivity calls={[{ ...failed, errorCode: undefined }]} working answering={false} />,
    );
    expect(html).not.toContain("activity-step-notice");
  });
});
