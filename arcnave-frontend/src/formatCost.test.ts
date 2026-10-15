import { describe, expect, it } from "vitest";

import { formatCost } from "./formatCost";

describe("formatCost", () => {
  it("shows rupees first and dollars second", () => {
    expect(formatCost(0.14, 12.32)).toBe("₹12.32 · $0.1400");
  });

  it("is null, not zero, when nothing is priced", () => {
    expect(formatCost(null, null)).toBeNull();
  });

  it("shows a real zero as zero", () => {
    expect(formatCost(0, 0)).toBe("₹0.00 · $0.0000");
  });

  it("shows dollars alone when there is no rupee figure", () => {
    expect(formatCost(0.5, null)).toBe("$0.5000");
  });
});
