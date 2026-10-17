/** P13 (ADR-0080): the chat list is read again only while a chat still has its placeholder title. */
import { describe, expect, it } from "vitest";

import type { Chat } from "./types";
import { needsGeneratedTitle, TITLE_REFRESH_DELAYS_MS } from "./workspace";

const chat = (id: string, title: string) => ({ id, title }) as unknown as Chat;

describe("needsGeneratedTitle", () => {
  const prompt = "x".repeat(120);

  it("is true while the chat shows the prompt's first 80 characters", () => {
    expect(needsGeneratedTitle([chat("a", prompt.slice(0, 80))], "a", prompt)).toBe(true);
  });

  it("is false once the title job (or a rename) changed it, and without a list or a prompt", () => {
    expect(needsGeneratedTitle([chat("a", "Trip planning")], "a", prompt)).toBe(false);
    expect(needsGeneratedTitle(undefined, "a", prompt)).toBe(false);
    expect(needsGeneratedTitle([chat("a", "")], "a", undefined)).toBe(false);
    expect(needsGeneratedTitle([chat("b", prompt.slice(0, 80))], "a", prompt)).toBe(false);
  });

  it("reads again a bounded number of times", () => {
    expect(TITLE_REFRESH_DELAYS_MS.length).toBeLessThanOrEqual(2);
  });
});
