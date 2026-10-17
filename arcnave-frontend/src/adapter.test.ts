import { afterEach, describe, expect, it, vi } from "vitest";
import { generate, reconnectDelay, RECONNECT_BASES_MS } from "./adapter";
import type { StreamEvent } from "./adapter";
import { ApiError } from "./api";

const noActiveRun = () =>
  new Response(
    JSON.stringify({ error: { code: "no_active_run", title: "t", detail: "d" } }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );

/** Build a fetch that streams `chunks` as the SSE body, split exactly where given. A reattach
 *  (`/stream`) finds no run, as it would once the run has ended. */
function streaming(chunks: string[], init: ResponseInit = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/stream")) return noActiveRun();
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

/** Every frame the stream yields. A stream that closes without an end frame reattaches, finds
 *  no run, and ends in `no_active_run`: that is the end of the stream here, not a failure. */
const collect = async (signal = new AbortController().signal, keep = false) => {
  const out: StreamEvent[] = [];
  try {
    for await (const event of generate(
      "chat-1",
      { prompt: "hi", mode: "chat", model: "Auto" },
      signal,
      // No jitter wait in tests; the bounds are tested on `reconnectDelay` itself.
      { random: () => 0, idempotencyKey: "key-1" },
    ))
      // The reconnect notices are the adapter's own, not server frames.
      if (keep || (event.type !== "reconnecting" && event.type !== "reconnected")) out.push(event);
  } catch (error) {
    if (!(error instanceof ApiError && error.code === "no_active_run")) throw error;
  }
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

describe("reconnect", () => {
  it("reattaches after a dropped connection from the last frame id, without repeats", async () => {
    const urls: string[] = [];
    const encoder = new TextEncoder();
    const body = (text: string) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode(text));
            c.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        if (urls.length === 1)
          return body(`id: 0\n${frame({ type: "delta", text: "a" })}id: 1\n${frame({ type: "delta", text: "b" })}`);
        return body(
          `id: 2\n${frame({ type: "delta", text: "c" })}id: 3\n${frame({ type: "done", questions: [], usage: usageZero(), finishReason: "stop" })}`,
        );
      }),
    );
    const events = await collect();
    expect(urls[1]).toContain("/chats/chat-1/stream?after=1");
    expect(events.map((e) => (e.type === "delta" ? e.text : e.type))).toEqual(["a", "b", "c", "done"]);
  });

  it("does not reconnect once the run has ended", async () => {
    const fetcher = streaming([frame({ type: "error", code: "x", title: "t", detail: "d" })]);
    vi.stubGlobal("fetch", fetcher);
    await collect();
    expect(fetcher).toHaveBeenCalledTimes(1);
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
    costInr: null,
  };
}

describe("P08 reconnect contract (ADR-0078)", () => {
  const sse = (text: string) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(text));
          c.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  const header = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);

  it("sends Last-Event-ID (and after=) with the last frame id on a reattach", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        if (calls.length === 1) return sse(`id: 0\n${frame({ type: "delta", text: "a" })}id: 4\n${frame({ type: "delta", text: "b" })}`);
        return sse(`id: 5\n${frame({ type: "done", questions: [], usage: usageZero(), finishReason: "stop" })}`);
      }),
    );
    await collect();
    expect(calls[1]!.url).toContain("after=4");
    expect(header(calls[1]!.init, "Last-Event-ID")).toBe("4");
  });

  it("P22: reconnects to the version a regenerate moved to (ack names its chat)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        if (calls.length === 1)
          return sse(`id: 0\n${frame({ type: "ack", turnId: "t", chatId: "chat-2", messageId: "m2", userMessageId: "u2" })}id: 1\n${frame({ type: "delta", text: "a" })}`);
        return sse(`id: 2\n${frame({ type: "done", questions: [], usage: usageZero(), finishReason: "stop" })}`);
      }),
    );
    await collect();
    expect(calls[0]).toContain("/chats/chat-1/generate");
    expect(calls[1]).toContain("/chats/chat-2/stream");
  });

  it("waits with full jitter over 1/2/4/8/16 s, and gives up after 5 attempts", async () => {
    expect(RECONNECT_BASES_MS).toEqual([1000, 2000, 4000, 8000, 16000]);
    RECONNECT_BASES_MS.forEach((base, i) => {
      expect(reconnectDelay(i, () => 0)).toBe(0);
      const top = reconnectDelay(i, () => 0.999999);
      expect(top).toBeLessThan(base);
      expect(top).toBeGreaterThanOrEqual(base - 1);
    });
    let streams = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/stream")) {
          streams += 1;
          throw new TypeError("Failed to fetch");
        }
        return sse(`id: 0\n${frame({ type: "delta", text: "a" })}`);
      }),
    );
    const out: StreamEvent[] = [];
    await expect(
      (async () => {
        for await (const e of generate("chat-1", { prompt: "hi", mode: "chat", model: "Auto" }, new AbortController().signal, { random: () => 0 })) out.push(e);
      })(),
    ).rejects.toMatchObject({ code: "network" });
    expect(streams).toBe(5);
    expect(out.filter((e) => e.type === "reconnecting").map((e) => (e as { attempt: number }).attempt)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ignores ping frames", async () => {
    vi.stubGlobal(
      "fetch",
      streaming([
        `event: ping\ndata: {"type":"ping"}\n\n` +
          `id: 0\n${frame({ type: "delta", text: "x" })}` +
          `event: ping\ndata: {"type":"ping"}\n\n` +
          `id: 1\n${frame({ type: "done", questions: [], usage: usageZero(), finishReason: "stop" })}`,
      ]),
    );
    const events = await collect(undefined, true);
    expect(events.map((e) => e.type)).toEqual(["delta", "done"]);
  });

  it("reuses one Idempotency-Key when the POST itself fails on the network", async () => {
    const keys: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        keys.push(header(init, "Idempotency-Key"));
        if (keys.length < 3) throw new TypeError("Failed to fetch");
        return sse(`id: 0\n${frame({ type: "done", questions: [], usage: usageZero(), finishReason: "stop" })}`);
      }),
    );
    const events = await collect();
    expect(events.map((e) => e.type)).toEqual(["done"]);
    expect(keys).toEqual(["key-1", "key-1", "key-1"]);
  });

  it("ends on a snapshot of a finished row, without reconnecting", async () => {
    const fetcher = streaming([
      `id: 3\n${frame({ type: "snapshot", turnId: "t", state: "done", seq: 3, message: { status: "complete" } as never })}`,
    ]);
    vi.stubGlobal("fetch", fetcher);
    const events = await collect();
    expect(events.map((e) => e.type)).toEqual(["snapshot"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

