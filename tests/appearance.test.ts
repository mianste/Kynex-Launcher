import { describe, expect, it } from "vitest";
import { normalizeUiOpacity } from "../src/lib/appearance";

describe("saved panel opacity", () => {
  it("preserves zero and old values below 35 across reloads", () => {
    for (const value of [0, 1, 20, 34, 82, 100]) {
      expect(normalizeUiOpacity(value)).toBe(value);
    }
  });
  it("bounds invalid saved values without changing valid transparency", () => {
    expect(normalizeUiOpacity(-1)).toBe(0);
    expect(normalizeUiOpacity(101)).toBe(100);
    for (const value of [undefined, NaN, Infinity]) {
      expect(normalizeUiOpacity(value)).toBe(82);
    }
  });
});
