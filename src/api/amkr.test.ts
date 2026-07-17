import { describe, expect, it } from "vitest";
import { isAmkrVersionCompatible } from "./amkr";

describe("AMKR version compatibility", () => {
  it("accepts the minimum and newer semantic versions", () => {
    expect(isAmkrVersionCompatible("3.2.1")).toBe(true);
    expect(isAmkrVersionCompatible("3.2.0")).toBe(false);
    expect(isAmkrVersionCompatible("4.0.0")).toBe(true);
  });

  it("rejects older and malformed versions", () => {
    expect(isAmkrVersionCompatible("3.1.0")).toBe(false);
    expect(isAmkrVersionCompatible("2.9.9")).toBe(false);
    expect(isAmkrVersionCompatible("unknown")).toBe(false);
  });
});
