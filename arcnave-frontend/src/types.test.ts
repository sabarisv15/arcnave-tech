import { describe, expect, it } from "vitest";
import { toMessage, toPreferences, toProjectFile, toSource } from "./types";
import type {
  MessageDto,
  PreferencesDto,
  ProjectFileDto,
  SourceDto,
} from "./api";
import { describeError, errorCopy } from "./api";
import { MAX_ATTACHMENT_BYTES, validateFile } from "./storage";

const source = (patch: Partial<SourceDto> = {}): SourceDto => ({
  id: 1,
  title: "A paper",
  url: "https://example.org/a",
  urlResolved: true,
  domain: "example.org",
  type: "Academic",
  snippet: "A snippet.",
  passage: "",
  retrievedAt: null,
  ...patch,
});

const message = (patch: Partial<MessageDto> = {}): MessageDto => ({
  id: "m1",
  seq: 1,
  role: "assistant",
  text: "Hello",
  mode: "chat",
  status: "complete",
  errorCode: null,
  researchStage: null,
  questions: [],
  feedback: null,
  modelAlias: null,
  providerModelId: null,
  finishReason: null,
  artifactId: null,
  searchEntryPoint: null,
  createdAt: null,
  completedAt: null,
  sources: [],
  events: [],
  toolCalls: [],
  attachments: [],
  usage: null,
  ...patch,
});

describe("evidence integrity", () => {
  it("marks a citation the provider could not resolve instead of linking it", () => {
    expect(toSource(source({ urlResolved: false })).unresolved).toBe(true);
  });

  it("leaves a resolved citation linkable", () => {
    expect(toSource(source()).unresolved).toBeUndefined();
  });

  it("keeps a source's ordinal, which is what the inline citation refers to", () => {
    expect(toSource(source({ id: 4 })).id).toBe(4);
  });

  it("never invents a retrieval date the server did not report", () => {
    expect(toSource(source({ retrievedAt: null })).retrievedAt).toBeUndefined();
  });
});

describe("message mapping", () => {
  it("does not crash when a legacy transcript omits optional evidence arrays", () => {
    const legacyMessage = {
      ...message(),
      sources: undefined,
      events: undefined,
      toolCalls: undefined,
      attachments: undefined,
      questions: undefined,
    } as unknown as MessageDto;

    expect(toMessage(legacyMessage)).toMatchObject({ id: "m1", text: "Hello" });
  });

  it("carries an error code through without turning it into prose", () => {
    const mapped = toMessage(
      message({ status: "error", errorCode: "budget_exceeded" }),
    );
    expect(mapped.error).toBe("budget_exceeded");
    expect(mapped.errorTitle).toBeUndefined();
  });

  it("omits usage entirely when the transcript reports none", () => {
    expect(toMessage(message()).usage).toBeUndefined();
  });

  it("preserves `exact: false` so zeros are never shown as measurements", () => {
    const mapped = toMessage(
      message({
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          exact: false,
          costUsd: null,
        },
      }),
    );
    expect(mapped.usage?.exact).toBe(false);
    expect(mapped.usage?.costUsd).toBeNull();
  });

  it("does not turn a null cost into zero", () => {
    const mapped = toMessage(
      message({
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          exact: true,
          costUsd: null,
        },
      }),
    );
    expect(mapped.usage?.costUsd).toBeNull();
  });
});

describe("project files", () => {
  const file = (patch: Partial<ProjectFileDto> = {}): ProjectFileDto => ({
    id: "f1",
    projectId: "p1",
    filename: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 120,
    status: "ready",
    error: "",
    chunkCount: 3,
    checksumSha256: "",
    indexedAt: null,
    createdAt: null,
    ...patch,
  });

  it("only claims a file has text when chunks were actually indexed", () => {
    expect(toProjectFile(file({ chunkCount: 0 })).hasText).toBe(false);
    expect(
      toProjectFile(file({ status: "unsupported", chunkCount: 0 })).hasText,
    ).toBe(false);
    expect(toProjectFile(file()).hasText).toBe(true);
  });

  it("points a file at its authenticated download route", () => {
    expect(toProjectFile(file()).downloadUrl).toContain(
      "/projects/p1/files/f1/download",
    );
  });
});

describe("preferences mapping", () => {
  const prefs = (patch: Partial<PreferencesDto> = {}): PreferencesDto => ({
    theme: "system",
    font: "sans",
    modelAlias: "Auto",
    instructions: "",
    enterToSend: true,
    reducedMotion: false,
    defaultMode: "chat",
    sourceScope: "All sources",
    saveHistory: true,
    maxOutputTokens: 4096,
    dailyTokenBudget: null,
    monthlyTokenBudget: null,
    warnThresholdPct: 80,
    routingPreference: "balanced",
    timezone: "UTC",
    version: 3,
    updatedAt: null,
    ...patch,
  });

  it("keeps the version, which optimistic concurrency depends on", () => {
    expect(toPreferences(prefs()).version).toBe(3);
  });

  it("falls back to a value the interface can render for an unknown theme or mode", () => {
    const mapped = toPreferences(
      prefs({ theme: "solarized", defaultMode: "banana" }),
    );
    expect(mapped.theme).toBe("system");
    expect(mapped.defaultMode).toBe("chat");
  });
});

describe("error copy", () => {
  it("has wording for every code the server can put on a stored message", () => {
    for (const code of [
      "budget_exceeded",
      "no_model_available",
      "model_unavailable",
      "capability_unavailable",
      "provider_error",
      "provider_payload_limit",
      "model_refused",
      "provider_timeout",
      "turn_deadline_exceeded",
      "empty_response",
      "context_overflow",
      "rate_limit",
      "unauthorized",
    ])
      expect(errorCopy).toHaveProperty(code);
  });

  it("does not pretend to recognise a code it has never seen", () => {
    expect(describeError("teapot_on_fire").detail).toContain(
      "does not recognise",
    );
  });
});

describe("upload policy", () => {
  it("rejects an executable before any bytes are sent", () => {
    expect(validateFile({ name: "unsafe.exe", size: 100 })).toContain(
      "not supported",
    );
  });

  it("rejects a file past the server's 30 MB ceiling", () => {
    expect(
      validateFile({ name: "large.pdf", size: 31 * 1024 * 1024 }),
    ).toContain("30 MB");
  });

  it("rejects an empty file, which the server also refuses", () => {
    expect(validateFile({ name: "empty.txt", size: 0 })).toContain("empty");
  });

  it("accepts supported formats case-insensitively", () => {
    expect(validateFile({ name: "NOTES.TXT", size: 50 })).toBeNull();
    expect(validateFile({ name: "photo.webp", size: 2048 })).toBeNull();
    expect(validateFile({ name: "sheet.xlsx", size: 2048 })).toBeNull();
    expect(validateFile({ name: "notes.odt", size: 2048 })).toBeNull();
    expect(validateFile({ name: "letter.rtf", size: 2048 })).toBeNull();
    expect(validateFile({ name: "book.epub", size: 2048 })).toBeNull();
  });

  it("lets a chat attachment reach Claude's 500 MB, and no further", () => {
    expect(validateFile({ name: "big.pdf", size: 400 * 1024 * 1024 }, MAX_ATTACHMENT_BYTES)).toBeNull();
    expect(
      validateFile({ name: "huge.pdf", size: MAX_ATTACHMENT_BYTES + 1 }, MAX_ATTACHMENT_BYTES),
    ).toContain("500 MB");
  });
});

describe("cutOffReason", () => {
  it("names an answer that hit its output or tool limit, and nothing else", async () => {
    const { cutOffReason } = await import("./types");
    expect(cutOffReason("MAX_TOKENS")).toBe("output_limit");
    expect(cutOffReason("max_tokens")).toBe("output_limit");
    expect(cutOffReason("tool_limit")).toBe("tool_limit");
    expect(cutOffReason("STOP")).toBeNull();
    expect(cutOffReason(undefined)).toBeNull();
  });
});
