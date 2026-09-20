import { afterEach, describe, expect, it, vi } from "vitest";
import { generate } from "./adapter";
import type { StreamEvent } from "./adapter";
import { ApiError } from "./api";

/** Build a fetch that streams `chunks` as the SSE body, split exactly where given. */
function streaming(chunks: string[], init: ResponseInit = {}) {
  return vi.fn(async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      ...init,
    });
  });
}

const frame = (event: StreamEvent) =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const collect = async (signal = new AbortController().signal) => {
  const out: StreamEvent[] = [];
  for await (const event of generate(
    "chat-1",
    { prompt: "hi", mode: "chat", model: "Auto" },
    signal,
  ))
    out.push(event);
  return out;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSE framing", () => {
  it("reassembles a frame split across two network chunks", async () => {
    const whole = frame({ type: "delta", text: "hello world" });
    const cut = Math.floor(whole.length / 2);
    vi.stubGlobal("fetch", streaming([whole.slice(0, cut), whole.slice(cut)]));
    expect(await collect()).toEqual([{ type: "delta", text: "hello world" }]);
  });

  it("parses code execution event frames", async () => {
    const whole = frame({ type: "code", code: "print(42)", language: "python", output: "42\n" });
    vi.stubGlobal("fetch", streaming([whole]));
    expect(await collect()).toEqual([
      { type: "code", code: "print(42)", language: "python", output: "42\n" },
    ]);
  });

  it("keeps every delta when chunks straddle several frames", async () => {
    const body =
      frame({ type: "delta", text: "one " }) +
      frame({ type: "delta", text: "two " }) +
      frame({ type: "delta", text: "three" });
    // Deliberately awkward boundaries: mid-frame, mid-word, and mid-terminator.
    const chunks = [
      body.slice(0, 20),
      body.slice(20, 61),
      body.slice(61, 62),
      body.slice(62),
    ];
    vi.stubGlobal("fetch", streaming(chunks));
    const text = (await collect())
      .filter(
        (e): e is Extract<StreamEvent, { type: "delta" }> => e.type === "delta",
      )
      .map((e) => e.text)
      .join("");
    expect(text).toBe("one two three");
  });

  it("ignores heartbeat comments without breaking the stream", async () => {
    vi.stubGlobal(
      "fetch",
      streaming([
        ": heartbeat\n\n",
        frame({ type: "delta", text: "after" }),
        ": heartbeat\n\n",
        frame({
          type: "done",
          questions: [],
          usage: usageZero(),
          finishReason: "stop",
        }),
      ]),
    );
    const events = await collect();
    expect(events.map((e) => e.type)).toEqual(["delta", "done"]);
  });

  it("skips a malformed frame rather than ending the answer", async () => {
    vi.stubGlobal(
      "fetch",
      streaming([
        "event: delta\ndata: {not json\n\n",
        frame({ type: "delta", text: "still here" }),
      ]),
    );
    expect(await collect()).toEqual([{ type: "delta", text: "still here" }]);
  });

  it("delivers a final frame that arrives without a trailing blank line", async () => {
    vi.stubGlobal(
      "fetch",
      streaming([`data: ${JSON.stringify({ type: "delta", text: "tail" })}`]),
    );
    expect(await collect()).toEqual([{ type: "delta", text: "tail" }]);
  });
});

describe("refusals before the stream opens", () => {
  it("raises the server's own error code and prose", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "run_in_progress",
                title: "A response is already running",
                detail: "Stop the current response before starting another.",
                requestId: "req-7",
              },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    await expect(collect()).rejects.toMatchObject({
      name: "ApiError",
      code: "run_in_progress",
      requestId: "req-7",
      status: 409,
    });
  });

  it("falls back to the status when the body is not our envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>gateway</html>", { status: 401 })),
    );
    const error = await collect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("unauthorized");
  });

  it("reports a dead network as a network error, not a generation failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(collect()).rejects.toMatchObject({ code: "network" });
  });
});

describe("cancellation", () => {
  it("lets an abort propagate rather than reporting it as a failure", async () => {
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Aborted", "AbortError");
      }),
    );
    await expect(collect(ac.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

function usageZero() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    exact: false,
    costUsd: null,
  };
}
