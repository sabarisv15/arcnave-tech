import { afterEach, describe, expect, it, vi } from "vitest";
import { generate } from "./adapter";
import { api, errorCopy } from "./api";
import type { PreferencesDto } from "./api";
import { BUILTIN_STYLE_PRESETS } from "./StylesModal";
import { toPreferences } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

const basePrefsDto = (
  patch: Partial<PreferencesDto> = {},
): PreferencesDto => ({
  theme: "system",
  font: "sans",
  modelAlias: "Auto",
  instructions: "",
  enterToSend: true,
  reducedMotion: false,
  defaultMode: "chat",
  sourceScope: "All sources",
  saveHistory: true,
  memoryEnabled: true,
  chatSearchEnabled: true,
  maxOutputTokens: 4096,
  dailyTokenBudget: null,
  monthlyTokenBudget: null,
  warnThresholdPct: 80,
  routingPreference: "balanced",
  timezone: "UTC",
  version: 1,
  updatedAt: null,
  ...patch,
});

describe("WP-05 Styles frontend support", () => {
  it("provides the 4 built-in presets with Normal adding no instructions", () => {
    expect(BUILTIN_STYLE_PRESETS.map((p) => p.id)).toEqual([
      "normal",
      "concise",
      "explanatory",
      "formal",
    ]);
    const normal = BUILTIN_STYLE_PRESETS.find((p) => p.id === "normal");
    expect(normal?.instructions).toBe("");
    for (const id of ["concise", "explanatory", "formal"]) {
      const preset = BUILTIN_STYLE_PRESETS.find((p) => p.id === id);
      expect(preset?.instructions.length).toBeGreaterThan(20);
    }
  });

  it("maps styleId in toPreferences and defaults to normal when absent", () => {
    expect(toPreferences(basePrefsDto()).styleId).toBe("normal");
    expect(toPreferences(basePrefsDto({ styleId: "concise" })).styleId).toBe(
      "concise",
    );
  });

  it("includes typed error copy for style_not_found, style_too_long, and sample_too_long", () => {
    expect(errorCopy).toHaveProperty("style_not_found");
    expect(errorCopy).toHaveProperty("style_too_long");
    expect(errorCopy).toHaveProperty("sample_too_long");
  });

  it("forwards styleId in the POST /chats/:id/generate body", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `event: done\ndata: ${JSON.stringify({
                  type: "done",
                  questions: [],
                  usage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    exact: true,
                    costUsd: null,
                  },
                  finishReason: "stop",
                })}\n\n`,
              ),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );

    const events = [];
    for await (const ev of generate(
      "chat-123",
      {
        prompt: "Explain gravity",
        mode: "chat",
        model: "Auto",
        styleId: "explanatory",
      },
      new AbortController().signal,
    )) {
      events.push(ev);
    }

    expect(events).toHaveLength(1);
    expect(capturedBody).toMatchObject({
      prompt: "Explain gravity",
      styleId: "explanatory",
    });
  });

  it("calls /styles and /styles/summarize through api.styles", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = String(input);
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url: urlStr, method, body });

        if (urlStr.endsWith("/styles/summarize")) {
          return new Response(
            JSON.stringify({ instructions: "Use short sentences." }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (urlStr.endsWith("/styles") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "11111111-1111-1111-1111-111111111111",
              userId: "u1",
              name: "Direct",
              instructions: "Use short sentences.",
              isPreset: false,
              version: 1,
              createdAt: null,
              updatedAt: null,
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ presets: BUILTIN_STYLE_PRESETS, items: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const summary = await api.styles.summarize(["Sample 1", "Sample 2"]);
    expect(summary.instructions).toBe("Use short sentences.");

    const created = await api.styles.create({
      name: "Direct",
      instructions: summary.instructions,
    });
    expect(created.name).toBe("Direct");

    expect(calls[0]?.url).toContain("/styles/summarize");
    expect(calls[0]?.body).toEqual({ samples: ["Sample 1", "Sample 2"] });
    expect(calls[1]?.url).toContain("/styles");
    expect(calls[1]?.method).toBe("POST");
  });
});
